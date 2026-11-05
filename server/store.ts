import { promises as fs } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import type { Stats } from '../src/net/stats';

export type { Stats };

// Where accounts, sessions, visits and the shared world live. Postgres when DATABASE_URL is set (production);
// otherwise a JSON file under .data/ so the game runs locally with no setup.

export interface Account {
  id: string;
  name: string;
  email: string;
  pass: string;
  /** Person id of their character in the world, once they have one. */
  seat: number | null;
  createdMs: number;
}

export interface WorldRow {
  data: string;
  version: number;
}


export interface Store {
  createAccount(a: Omit<Account, 'createdMs'>): Promise<boolean>;
  accountByEmail(email: string): Promise<Account | null>;
  accountById(id: string): Promise<Account | null>;
  setSeat(accountId: string, seat: number | null): Promise<void>;
  createSession(token: string, accountId: string, expiresMs: number): Promise<void>;
  sessionAccount(token: string, nowMs: number): Promise<Account | null>;
  /** Marks a session as active now (at most every 30 seconds). */
  touchSession(token: string, nowMs: number): Promise<void>;
  deleteSession(token: string): Promise<void>;
  /** Accounts active since this moment, with when they were last seen. */
  recentlySeen(sinceMs: number): Promise<{ account: string; seenMs: number }[]>;
  worldVersion(): Promise<number | null>;
  readWorld(): Promise<WorldRow | null>;
  /** Runs fn with the world locked. fn returns the new data to save (null leaves it as it was). */
  withWorld<T>(fn: (cur: WorldRow | null) => Promise<{ data: string | null; result: T }> | { data: string | null; result: T }): Promise<T>;
  recordVisit(v: { visitor: string; account: string | null; path: string; referrer: string }, nowMs: number): Promise<void>;
  stats(nowMs: number): Promise<Stats>;
}

const ONLINE_MS = 90_000;
const DAY = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ───────────── Postgres ─────────────

const SCHEMA = `
create table if not exists nh_accounts (
  id text primary key,
  name text not null,
  email text not null unique,
  pass text not null,
  seat integer,
  created_at timestamptz not null default now()
);
create table if not exists nh_sessions (
  token text primary key,
  account_id text not null references nh_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen timestamptz not null default now()
);
create index if not exists nh_sessions_seen on nh_sessions(last_seen);
create table if not exists nh_worlds (
  id text primary key,
  data text not null,
  version integer not null,
  updated_at timestamptz not null default now()
);
create table if not exists nh_visits (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text not null,
  account_id text,
  path text,
  referrer text
);
create index if not exists nh_visits_at on nh_visits(at);
`;

class PgStore implements Store {
  private sql: postgres.Sql;
  private ready: Promise<void>;

  constructor(url: string) {
    const local = /localhost|127\.0\.0\.1/.test(url);
    this.sql = postgres(url, { ssl: local ? false : 'require', max: 3, idle_timeout: 20, onnotice: () => {} });
    this.ready = this.sql.unsafe(SCHEMA).then(() => undefined);
  }

  private async q() {
    await this.ready;
    return this.sql;
  }

  private row(r: Record<string, unknown> | undefined): Account | null {
    if (!r) return null;
    return { id: String(r.id), name: String(r.name), email: String(r.email), pass: String(r.pass), seat: r.seat === null ? null : Number(r.seat), createdMs: new Date(r.created_at as string).getTime() };
  }

  async createAccount(a: Omit<Account, 'createdMs'>) {
    const sql = await this.q();
    const r = await sql`insert into nh_accounts (id, name, email, pass, seat) values (${a.id}, ${a.name}, ${a.email}, ${a.pass}, ${a.seat}) on conflict (email) do nothing returning id`;
    return r.length > 0;
  }
  async accountByEmail(email: string) {
    const sql = await this.q();
    return this.row((await sql`select * from nh_accounts where email = ${email}`)[0]);
  }
  async accountById(id: string) {
    const sql = await this.q();
    return this.row((await sql`select * from nh_accounts where id = ${id}`)[0]);
  }
  async setSeat(accountId: string, seat: number | null) {
    const sql = await this.q();
    await sql`update nh_accounts set seat = ${seat} where id = ${accountId}`;
  }
  async createSession(token: string, accountId: string, expiresMs: number) {
    const sql = await this.q();
    await sql`insert into nh_sessions (token, account_id, expires_at) values (${token}, ${accountId}, ${new Date(expiresMs)})`;
  }
  async sessionAccount(token: string, nowMs: number) {
    const sql = await this.q();
    const r = await sql`select a.* from nh_sessions s join nh_accounts a on a.id = s.account_id where s.token = ${token} and s.expires_at > ${new Date(nowMs)}`;
    return this.row(r[0]);
  }
  async touchSession(token: string, nowMs: number) {
    const sql = await this.q();
    await sql`update nh_sessions set last_seen = ${new Date(nowMs)} where token = ${token} and last_seen < ${new Date(nowMs - 30_000)}`;
  }
  async deleteSession(token: string) {
    const sql = await this.q();
    await sql`delete from nh_sessions where token = ${token}`;
  }
  async recentlySeen(sinceMs: number) {
    const sql = await this.q();
    const r = await sql`select account_id, max(last_seen) as seen from nh_sessions where last_seen > ${new Date(sinceMs)} group by account_id`;
    return r.map((x) => ({ account: String(x.account_id), seenMs: new Date(x.seen as string).getTime() }));
  }
  async worldVersion() {
    const sql = await this.q();
    const r = await sql`select version from nh_worlds where id = 'main'`;
    return r.length ? Number(r[0].version) : null;
  }
  async readWorld() {
    const sql = await this.q();
    const r = await sql`select data, version from nh_worlds where id = 'main'`;
    return r.length ? { data: String(r[0].data), version: Number(r[0].version) } : null;
  }
  async withWorld<T>(fn: (cur: WorldRow | null) => Promise<{ data: string | null; result: T }> | { data: string | null; result: T }) {
    const sql = await this.q();
    let out!: T;
    await sql.begin(async (tx) => {
      // One writer at a time: everyone else waits for the lock.
      await tx`select pg_advisory_xact_lock(4242)`;
      const r = await tx`select data, version from nh_worlds where id = 'main'`;
      const cur = r.length ? { data: String(r[0].data), version: Number(r[0].version) } : null;
      const { data, result } = await fn(cur);
      out = result;
      if (data === null) return;
      if (cur) await tx`update nh_worlds set data = ${data}, version = ${cur.version + 1}, updated_at = now() where id = 'main'`;
      else await tx`insert into nh_worlds (id, data, version) values ('main', ${data}, 1)`;
    });
    return out;
  }
  async recordVisit(v: { visitor: string; account: string | null; path: string; referrer: string }) {
    const sql = await this.q();
    await sql`insert into nh_visits (visitor, account_id, path, referrer) values (${v.visitor}, ${v.account}, ${v.path}, ${v.referrer})`;
  }
  async stats(nowMs: number): Promise<Stats> {
    const sql = await this.q();
    const since = new Date(nowMs - ONLINE_MS);
    const online = await sql`select a.name, max(s.last_seen) as seen from nh_sessions s join nh_accounts a on a.id = s.account_id where s.last_seen > ${since} group by a.id, a.name order by seen desc`;
    const players = await sql`select count(*)::int as n, count(seat)::int as seated from nh_accounts`;
    const start = new Date(new Date(dayKey(nowMs)).getTime() - 13 * DAY);
    const visits = await sql`select to_char(date_trunc('day', at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*)::int as visits, count(distinct visitor)::int as visitors from nh_visits where at >= ${start} group by 1`;
    const signups = await sql`select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day, count(*)::int as n from nh_accounts where created_at >= ${start} group by 1`;
    const week = await sql`select count(*)::int as visits, count(distinct visitor)::int as visitors from nh_visits where at >= ${new Date(nowMs - 7 * DAY)}`;
    return buildStats(
      nowMs,
      online.map((o) => ({ name: String(o.name), seenMs: new Date(o.seen as string).getTime() })),
      Number(players[0].n),
      Number(players[0].seated),
      Object.fromEntries(visits.map((v) => [String(v.day), { visits: Number(v.visits), visitors: Number(v.visitors) }])),
      Object.fromEntries(signups.map((s) => [String(s.day), Number(s.n)])),
      { visits: Number(week[0].visits), visitors: Number(week[0].visitors) },
    );
  }
}

function buildStats(
  nowMs: number,
  online: { name: string; seenMs: number }[],
  players: number,
  seated: number,
  visits: Record<string, { visits: number; visitors: number }>,
  signups: Record<string, number>,
  week: { visits: number; visitors: number },
): Stats {
  const days: Stats['days'] = [];
  for (let i = 13; i >= 0; i--) {
    const day = dayKey(nowMs - i * DAY);
    days.push({ day, visits: visits[day]?.visits ?? 0, visitors: visits[day]?.visitors ?? 0, signups: signups[day] ?? 0 });
  }
  const today = days[days.length - 1];
  return {
    onlineNow: online.length,
    online: online.map((o) => ({ name: o.name, seenAgoS: Math.round((nowMs - o.seenMs) / 1000) })),
    players,
    playersWithCharacter: seated,
    visitsToday: today.visits,
    visitorsToday: today.visitors,
    visits7d: week.visits,
    visitors7d: week.visitors,
    days,
  };
}

// ───────────── a JSON file, for development ─────────────

interface FileData {
  accounts: Account[];
  sessions: { token: string; account: string; expiresMs: number; seenMs: number }[];
  visits: { atMs: number; visitor: string; account: string | null; path: string; referrer: string }[];
}

class FileStore implements Store {
  private data: FileData | null = null;
  private world: WorldRow | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private dir: string) {}

  private file = (name: string) => path.join(this.dir, name);

  private async load(): Promise<FileData> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await fs.readFile(this.file('store.json'), 'utf8')) as FileData;
    } catch {
      this.data = { accounts: [], sessions: [], visits: [] };
    }
    try {
      this.world = JSON.parse(await fs.readFile(this.file('world.json'), 'utf8')) as WorldRow;
    } catch {
      this.world = null;
    }
    return this.data;
  }
  private async save() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file('store.json'), JSON.stringify(this.data));
  }
  /** Runs one change at a time, like a lock. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  createAccount(a: Omit<Account, 'createdMs'>) {
    return this.serial(async () => {
      const d = await this.load();
      if (d.accounts.some((x) => x.email === a.email)) return false;
      d.accounts.push({ ...a, createdMs: Date.now() });
      await this.save();
      return true;
    });
  }
  async accountByEmail(email: string) {
    return (await this.load()).accounts.find((a) => a.email === email) ?? null;
  }
  async accountById(id: string) {
    return (await this.load()).accounts.find((a) => a.id === id) ?? null;
  }
  setSeat(accountId: string, seat: number | null) {
    return this.serial(async () => {
      const a = (await this.load()).accounts.find((x) => x.id === accountId);
      if (a) a.seat = seat;
      await this.save();
    });
  }
  createSession(token: string, accountId: string, expiresMs: number) {
    return this.serial(async () => {
      (await this.load()).sessions.push({ token, account: accountId, expiresMs, seenMs: Date.now() });
      await this.save();
    });
  }
  async sessionAccount(token: string, nowMs: number) {
    const d = await this.load();
    const s = d.sessions.find((x) => x.token === token && x.expiresMs > nowMs);
    return s ? (d.accounts.find((a) => a.id === s.account) ?? null) : null;
  }
  async touchSession(token: string, nowMs: number) {
    const s = (await this.load()).sessions.find((x) => x.token === token);
    if (s && s.seenMs < nowMs - 30_000) {
      s.seenMs = nowMs;
      await this.serial(() => this.save());
    }
  }
  deleteSession(token: string) {
    return this.serial(async () => {
      const d = await this.load();
      d.sessions = d.sessions.filter((x) => x.token !== token);
      await this.save();
    });
  }
  async recentlySeen(sinceMs: number) {
    const best = new Map<string, number>();
    for (const s of (await this.load()).sessions) if (s.seenMs > sinceMs) best.set(s.account, Math.max(best.get(s.account) ?? 0, s.seenMs));
    return [...best].map(([account, seenMs]) => ({ account, seenMs }));
  }
  async worldVersion() {
    await this.load();
    return this.world?.version ?? null;
  }
  async readWorld() {
    await this.load();
    return this.world;
  }
  withWorld<T>(fn: (cur: WorldRow | null) => Promise<{ data: string | null; result: T }> | { data: string | null; result: T }) {
    return this.serial(async () => {
      await this.load();
      const { data, result } = await fn(this.world);
      if (data !== null) {
        this.world = { data, version: (this.world?.version ?? 0) + 1 };
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.file('world.json'), JSON.stringify(this.world));
      }
      return result;
    });
  }
  recordVisit(v: { visitor: string; account: string | null; path: string; referrer: string }, nowMs: number) {
    return this.serial(async () => {
      const d = await this.load();
      d.visits.push({ atMs: nowMs, ...v });
      if (d.visits.length > 50_000) d.visits.splice(0, d.visits.length - 50_000);
      await this.save();
    });
  }
  async stats(nowMs: number) {
    const d = await this.load();
    const name = (id: string) => d.accounts.find((a) => a.id === id)?.name ?? '?';
    const online = [...new Map(d.sessions.filter((s) => s.seenMs > nowMs - ONLINE_MS).map((s) => [s.account, s.seenMs]))].map(([account, seenMs]) => ({ name: name(account), seenMs }));
    const visits: Record<string, { visits: number; visitors: number }> = {};
    const seen: Record<string, Set<string>> = {};
    for (const v of d.visits) {
      const k = dayKey(v.atMs);
      visits[k] ??= { visits: 0, visitors: 0 };
      visits[k].visits++;
      (seen[k] ??= new Set()).add(v.visitor);
      visits[k].visitors = seen[k].size;
    }
    const signups: Record<string, number> = {};
    for (const a of d.accounts) signups[dayKey(a.createdMs)] = (signups[dayKey(a.createdMs)] ?? 0) + 1;
    const recent = d.visits.filter((v) => v.atMs >= nowMs - 7 * DAY);
    return buildStats(nowMs, online, d.accounts.length, d.accounts.filter((a) => a.seat !== null).length, visits, signups, { visits: recent.length, visitors: new Set(recent.map((v) => v.visitor)).size });
  }
}

let store: Store | null = null;

/** The store for this process: Postgres if DATABASE_URL (or POSTGRES_URL) is set, else a file in .data/. */
export function getStore(): Store {
  if (store) return store;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  store = url ? new PgStore(url) : new FileStore(process.env.NH_DATA_DIR || path.resolve('.data'));
  return store;
}

/** For tests: a fresh file store in a folder of your choosing. */
export const fileStore = (dir: string): Store => new FileStore(dir);
