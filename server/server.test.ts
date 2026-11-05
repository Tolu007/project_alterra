import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The real HTTP API, on a file store in a temporary folder.
const dir = mkdtempSync(path.join(tmpdir(), 'nh-api-'));
process.env.NH_DATA_DIR = dir;
process.env.ADMIN_EMAILS = 'boss@example.com';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

let server: Server;
let base = '';

beforeAll(async () => {
  const { handle } = await import('./api');
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (route: string, body?: unknown) => {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    // Test responses are checked field by field, so a loose type is enough here.
    return { status: res.status, json: (await res.json()) as any, cookie: set };
  };
}
const looks = { skin: 1, hair: 2, outfit: 3, accent: 4, glasses: false };

describe('accounts', () => {
  it('signs up with name, email and password, and keeps the password hashed', async () => {
    const c = client();
    const r = await c('/auth/signup', { name: 'Ngozi Okafor', email: 'Ngozi@Example.com ', password: 'abcd1234' });
    expect(r.status).toBe(200);
    expect(r.json.account).toMatchObject({ name: 'Ngozi Okafor', email: 'ngozi@example.com', hasCharacter: false });
    expect(r.cookie).toMatch(/HttpOnly/);
    const { getStore } = await import('./store');
    const stored = await getStore().accountByEmail('ngozi@example.com');
    expect(stored!.pass).not.toContain('abcd1234');
    expect(stored!.pass.startsWith('scrypt$')).toBe(true);
  });

  it('refuses bad input and duplicate emails, and checks passwords on login', async () => {
    const c = client();
    expect((await c('/auth/signup', { name: 'X', email: 'x@example.com', password: 'abcd1234' })).status).toBe(400);
    expect((await c('/auth/signup', { name: 'Kemi Ade', email: 'not-an-email', password: 'abcd1234' })).status).toBe(400);
    expect((await c('/auth/signup', { name: 'Kemi Ade', email: 'kemi@example.com', password: 'short' })).status).toBe(400);
    expect((await c('/auth/signup', { name: 'Kemi Ade', email: 'kemi@example.com', password: 'abcd1234' })).status).toBe(200);
    expect((await client()('/auth/signup', { name: 'Kemi Two', email: 'kemi@example.com', password: 'abcd1234' })).status).toBe(409);
    expect((await client()('/auth/login', { email: 'kemi@example.com', password: 'wrong-pass' })).status).toBe(401);
    const back = client();
    expect((await back('/auth/login', { email: 'KEMI@example.com', password: 'abcd1234' })).status).toBe(200);
    expect((await back('/me')).json.account.name).toBe('Kemi Ade');
    await back('/auth/logout', {});
    expect((await back('/me')).json.account).toBeNull();
  });
});

describe('the shared world over HTTP', () => {
  it('two players join one world, see each other, and only get their own private life', async () => {
    const a = client();
    const b = client();
    await a('/auth/signup', { name: 'Ada Eze', email: 'ada@example.com', password: 'abcd1234' });
    await b('/auth/signup', { name: 'Tunde Bello', email: 'tunde@example.com', password: 'abcd1234' });
    expect((await a('/world')).json.game).toBeNull();
    const ja = await a('/world/join', { gender: 'f', looks, home: 'IKJ', start: { kind: 'business', type: 'stall' } });
    expect(ja.status).toBe(200);
    expect(ja.json.game.people[ja.json.game.me].name).toBe('Ada Eze');
    const jb = await b('/world/join', { gender: 'm', looks, home: 'IKJ', start: { kind: 'job', trade: 'factory' } });
    expect(jb.json.game.others.map((o: { id: number }) => o.id)).toContain(ja.json.game.me);
    expect(jb.json.game.seats).toEqual([]);
    expect(jb.json.game.player.money).not.toBe(ja.json.game.player.money);
    // A bad start or a second character is refused.
    expect((await a('/world/join', { gender: 'f', looks, home: 'IKJ', start: { kind: 'business', type: 'stall' } })).status).toBe(409);
    expect((await client()('/world/join', { gender: 'f', looks, home: 'IKJ', start: { kind: 'business', type: 'stall' } })).status).toBe(401);
  });

  it('applies many requests at once without losing any', async () => {
    const a = client();
    await a('/auth/login', { email: 'ada@example.com', password: 'abcd1234' });
    const b = client();
    await b('/auth/login', { email: 'tunde@example.com', password: 'abcd1234' });
    const start = (await a('/world')).json.version;
    // Walking about takes no time, so all of these should go through.
    const places = ['market', 'park', 'bank', 'clinic', 'home'];
    const all = await Promise.all([...places.map((p) => a('/world/act', { intent: { kind: 'goto', place: p, lot: null } })), ...places.map((p) => b('/world/act', { intent: { kind: 'goto', place: p, lot: null } }))]);
    expect(all.every((r) => r.json.result?.ok)).toBe(true);
    const versions = all.map((r) => r.json.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(Math.max(...versions) - start).toBeGreaterThanOrEqual(10);
    // Actions are instant: one after another with no waiting, and what pays or cheers you counts once a day.
    const cook = await a('/world/act', { intent: { kind: 'act', id: 'cook', place: 'home', lot: null } });
    expect(cook.json.result.ok).toBe(true);
    const family = await a('/world/act', { intent: { kind: 'act', id: 'family', place: 'home', lot: null } });
    expect(family.json.result.ok).toBe(true);
    const again = await a('/world/act', { intent: { kind: 'act', id: 'family', place: 'home', lot: null } });
    expect(again.json.result.ok).toBe(false);
    expect(again.json.result.text).toMatch(/Done for today/);
    // Polling with the version you have costs almost nothing.
    const v = (await a('/world')).json.version;
    const same = await a(`/world?v=${v}`);
    expect(same.json.same).toBe(true);
    expect(same.json.online).toBeGreaterThanOrEqual(2);
  });
});

describe('analytics', () => {
  it('counts visits and online players; only admins can read them', async () => {
    const c = client();
    for (const visitor of ['v1', 'v1', 'v2']) await fetch(base + '/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor, path: '/' }) });
    expect((await c('/stats')).status).toBe(403);
    await c('/auth/signup', { name: 'Site Boss', email: 'boss@example.com', password: 'abcd1234' });
    expect((await c('/me')).json.account.admin).toBe(true);
    const s = await c('/stats');
    expect(s.status).toBe(200);
    expect(s.json.visitsToday).toBe(3);
    expect(s.json.visitorsToday).toBe(2);
    expect(s.json.onlineNow).toBeGreaterThanOrEqual(3);
    expect(s.json.players).toBeGreaterThanOrEqual(4);
    expect(s.json.days).toHaveLength(14);
  });
});
