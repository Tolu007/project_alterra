import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Account, Store } from './store';

// Accounts: a name (also your character's name), an email to log in with, and a password.
// Passwords are hashed with scrypt; sessions are random tokens in an HttpOnly cookie, stored only as a hash.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'nh_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export function cleanEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120 ? e : null;
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length >= 2 && n.length <= 40 && /^[\p{L}][\p{L}' .-]*$/u.test(n) ? n : null;
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

export const newId = () => randomBytes(12).toString('base64url');

/** Starts a session and returns the cookie to set. */
export async function startSession(store: Store, account: Account, secure: boolean): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await store.createSession(hashToken(token), account.id, expires);
  return cookie(token, SESSION_DAYS * 86_400, secure);
}

export const endSessionCookie = (secure: boolean) => cookie('', 0, secure);

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function tokenFrom(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE && v.join('=')) return v.join('=');
  }
  return null;
}

/** The account behind a request's session cookie, if it is valid. Marks the session as seen. */
export async function accountFrom(store: Store, cookieHeader: string | undefined): Promise<{ account: Account; token: string } | null> {
  const raw = tokenFrom(cookieHeader);
  if (!raw) return null;
  const token = hashToken(raw);
  const now = Date.now();
  const account = await store.sessionAccount(token, now);
  if (!account) return null;
  await store.touchSession(token, now);
  return { account, token };
}

export const isAdmin = (account: Account | null) =>
  !!account &&
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(account.email);

/** A small brake on password guessing: per email and per address, within one server process. */
const attempts = new Map<string, { n: number; since: number }>();
export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.since > 10 * 60_000) {
    attempts.set(key, { n: 1, since: now });
    return false;
  }
  a.n++;
  return a.n > 10;
}
