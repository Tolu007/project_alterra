import { useEffect, useState } from 'react';
import { api, ApiError } from '../net/api';
import type { Stats } from '../net/stats';
import { StatTile } from './charts';

/** Admin page: who is online, how many people play, and visits over the last two weeks. */
export function StatsPage({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .stats()
        .then((s) => live && (setStats(s), setError(null)))
        .catch((e) => live && setError(e instanceof ApiError && e.status === 403 ? 'Admins only. Log in with an admin email (set ADMIN_EMAILS on the server).' : e instanceof Error ? e.message : 'Could not load stats.'));
    void load();
    const t = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  return (
    <main className="wrap stats-page">
      <button className="btn btn-small" onClick={onBack}>
        ← Back
      </button>
      <h1 className="h-display">Players and visits</h1>
      {error && <p className="auth-error">{error}</p>}
      {stats && (
        <>
          <div className="stat-grid stats-tiles">
            <StatTile label="Online now" value={String(stats.onlineNow)} />
            <StatTile label="Accounts" value={String(stats.players)} />
            <StatTile label="With a character" value={String(stats.playersWithCharacter)} />
            <StatTile label="Visits today" value={String(stats.visitsToday)} />
            <StatTile label="Visitors today" value={String(stats.visitorsToday)} />
            <StatTile label="Visitors, 7 days" value={String(stats.visitors7d)} />
          </div>
          <section className="card">
            <div className="card-body">
              <div className="kicker">Visits per day, last 14 days (UTC)</div>
              <VisitsChart days={stats.days} />
            </div>
          </section>
          <div className="stats-cols">
            <section className="card">
              <div className="card-body">
                <div className="kicker">Online now (active in the last 90 seconds)</div>
                {stats.online.length === 0 && <p className="muted">Nobody right now.</p>}
                <ul className="online-list">
                  {stats.online.map((o) => (
                    <li key={o.name + o.seenAgoS}>
                      <span className="dot" aria-hidden="true" /> {o.name} <span className="muted">· {o.seenAgoS}s ago</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <section className="card">
              <div className="card-body">
                <div className="kicker">By day</div>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Visits</th>
                      <th>Visitors</th>
                      <th>Sign-ups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.days
                      .slice()
                      .reverse()
                      .map((d) => (
                        <tr key={d.day}>
                          <td>{d.day.slice(5)}</td>
                          <td className="num">{d.visits}</td>
                          <td className="num">{d.visitors}</td>
                          <td className="num">{d.signups}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            A visit is one page load. A visitor is one browser, counted by a random id kept in that browser; no IP addresses are stored.
          </p>
        </>
      )}
    </main>
  );
}

/** Single-series bars with a hover readout. */
function VisitsChart({ days }: { days: Stats['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 200;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const max = Math.max(4, ...days.map((d) => d.visits));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = (W - pad.l - pad.r) / days.length;
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="visits-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visits per day over the last 14 days">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(i * step)} y2={y(i * step)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(i * step) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
              {i * step}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.l + i * bw + 2;
          const top = y(d.visits);
          const height = Math.max(0, H - pad.b - top);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {height > 0 && <path d={bar(x, top, bw - 4, height)} fill="var(--chart)" opacity={hover === null || hover === i ? 1 : 0.45} />}
              {(i % 2 === 1 || days.length <= 7) && (
                <text x={x + (bw - 4) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
                  {d.day.slice(8)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-readout" aria-live="polite">
        {h ? `${h.day}: ${h.visits} visits, ${h.visitors} visitors, ${h.signups} sign-ups` : 'Hover a day for its numbers.'}
      </div>
    </div>
  );
}

/** A bar with a 4px rounded top, square at the baseline. */
function bar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
