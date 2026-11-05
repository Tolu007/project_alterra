import type { Game } from '../engine/types';
import type { Intent } from '../engine/world';
import type { Stats } from './stats';

// Talks to the game server (/api). Everything here is for online play; offline play never calls it,
// except to count a visit.

export interface Account {
  id: string;
  name: string;
  email: string;
  hasCharacter: boolean;
  admin: boolean;
}

/** What the server sends with every update. */
export interface Sync {
  version: number;
  /** Real time on the server when it answered, and how many game minutes the world had run past its last step. */
  serverNow: number;
  lag: number;
  rate: number;
  online: number;
}

export interface WorldUpdate extends Sync {
  game: Game | null;
  hasCharacter: boolean;
  result?: { ok: boolean; text: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.ok ? 'The server sent something odd.' : 'The game server is not reachable.', res.status);
  }
  if (!res.ok) throw new ApiError((json as { error?: string })?.error ?? 'Something went wrong.', res.status);
  return json as T;
}

export const api = {
  me: () => call<{ account: Account | null }>('/me'),
  signup: (name: string, email: string, password: string) => call<{ account: Account }>('/auth/signup', { name, email, password }),
  login: (email: string, password: string) => call<{ account: Account }>('/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('/auth/logout', {}),
  world: (since: number | null) => call<WorldUpdate | (Sync & { same: true })>(`/world${since === null ? '' : `?v=${since}`}`),
  join: (req: { gender: 'm' | 'f'; looks: Game['people'][number]['looks']; home: string; start: unknown }) => call<WorldUpdate>('/world/join', req),
  act: (intent: Intent) => call<WorldUpdate>('/world/act', { intent }),
  stats: () => call<Stats>('/stats'),
};

/** A random id for this browser, so visits can be counted without knowing who you are. */
function visitorId(): string {
  try {
    let v = localStorage.getItem('nh:visitor');
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem('nh:visitor', v);
    }
    return v;
  } catch {
    return 'no-storage';
  }
}

/** Counts a visit. Silent if there is no server (a static copy of the game). */
export function trackVisit(path: string) {
  void fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitor: visitorId(), path, referrer: document.referrer.slice(0, 200) }),
  })
    .then((r) => r.text())
    .catch(() => {});
}
