import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountFrom, checkPassword, cleanEmail, cleanName, endSessionCookie, hashPassword, isAdmin, newId, passwordProblem, startSession, tooManyAttempts } from './auth';
import { act, join, worldView, type JoinRequest } from './game';
import { getStore, type Account } from './store';

// The game's HTTP API. The same handler runs in Vite's dev server and as a Vercel function.

type Req = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: string | object, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
  // Vercel may already have parsed it.
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 200_000) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const publicAccount = (a: Account | null) => (a ? { id: a.id, name: a.name, email: a.email, hasCharacter: a.seat !== null, admin: isAdmin(a) } : null);

export async function handle(req: Req, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  // On Vercel every /api/... request is routed to one function with the rest of the path in __path.
  const forwarded = url.searchParams.get('__path');
  const pathname = forwarded !== null ? `/api/${forwarded}` : url.pathname;
  const route = pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  const method = req.method ?? 'GET';
  const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true;
  const store = getStore();
  try {
    if (route === '/health') return send(res, 200, { ok: true });

    const me = await accountFrom(store, req.headers.cookie);

    if (route === '/me' && method === 'GET') return send(res, 200, { account: publicAccount(me?.account ?? null) });

    if (route === '/auth/signup' && method === 'POST') {
      const body = await readBody(req);
      const name = cleanName(body.name);
      const email = cleanEmail(body.email);
      const bad = passwordProblem(body.password);
      if (!name) return send(res, 400, { error: 'Use your name: 2 to 40 letters.' });
      if (!email) return send(res, 400, { error: 'That email does not look right.' });
      if (bad) return send(res, 400, { error: bad });
      const account: Account = { id: newId(), name, email, pass: await hashPassword(String(body.password)), seat: null, createdMs: Date.now() };
      if (!(await store.createAccount(account))) return send(res, 409, { error: 'That email already has an account. Log in instead.' });
      return send(res, 200, { account: publicAccount(account) }, { 'Set-Cookie': await startSession(store, account, secure) });
    }

    if (route === '/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const email = cleanEmail(body.email);
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0];
      if (tooManyAttempts(`ip:${ip}`) || (email && tooManyAttempts(`email:${email}`))) return send(res, 429, { error: 'Too many tries. Wait ten minutes.' });
      const account = email ? await store.accountByEmail(email) : null;
      if (!account || !(await checkPassword(String(body.password ?? ''), account.pass))) return send(res, 401, { error: 'Wrong email or password.' });
      return send(res, 200, { account: publicAccount(account) }, { 'Set-Cookie': await startSession(store, account, secure) });
    }

    if (route === '/auth/logout' && method === 'POST') {
      if (me) await store.deleteSession(me.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': endSessionCookie(secure) });
    }

    if (route === '/track' && method === 'POST') {
      const body = await readBody(req);
      const visitor = typeof body.visitor === 'string' ? body.visitor.slice(0, 64) : 'unknown';
      await store.recordVisit({ visitor, account: me?.account.id ?? null, path: String(body.path ?? '/').slice(0, 200), referrer: String(body.referrer ?? '').slice(0, 200) }, Date.now());
      return send(res, 200, { ok: true });
    }

    if (route === '/stats' && method === 'GET') {
      if (!isAdmin(me?.account ?? null)) return send(res, 403, { error: 'Admins only.' });
      return send(res, 200, await store.stats(Date.now()));
    }

    // Everything below needs you logged in.
    if (!me) return send(res, 401, { error: 'Log in first.' });

    if (route === '/world' && method === 'GET') {
      const v = url.searchParams.get('v');
      return send(res, 200, await worldView(store, me.account, v === null ? null : Number(v)));
    }
    if (route === '/world/join' && method === 'POST') {
      const r = await join(store, me.account, (await readBody(req)) as unknown as JoinRequest);
      return send(res, r.status, r.body);
    }
    if (route === '/world/act' && method === 'POST') {
      const body = await readBody(req);
      const r = await act(store, me.account, body.intent as never);
      return send(res, r.status, r.body);
    }
    return send(res, 404, { error: 'Not found.' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Something went wrong on the server.' });
  }
}
