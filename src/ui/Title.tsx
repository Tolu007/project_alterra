import type { Account } from '../net/api';

interface Props {
  saved: string | null;
  account: Account | null;
  onNew: () => void;
  onContinue: () => void;
  onOnline: () => void;
  onLogout: () => void;
  onStats: () => void;
}

export function Title({ saved, account, onNew, onContinue, onOnline, onLogout, onStats }: Props) {
  return (
    <>
      <main className="wrap title-screen">
        <div className="kicker">A Nigerian life sim · Lagos · Kano · Rivers</div>
        <h1 className="h-display logo">
          Naija <span>Hustle</span>
        </h1>
        <p className="title-lede">
          Start with a room and a hustle. Trade, drive, build, borrow, vote. Run for council, governor, president. Every
          leader’s choice moves the price of rice, and yours will too.
        </p>
        <section className="mode-card">
          <div className="kicker">Online · one shared world</div>
          <p>Play alongside everyone else: the same economy, the same elections, real people on the same streets.</p>
          <div className="title-actions">
            <button className="btn btn-danfo" onClick={onOnline}>
              {account ? (account.hasCharacter ? `Continue as ${account.name}` : `Create your character, ${account.name.split(' ')[0]}`) : 'Play online'}
            </button>
            {account && (
              <button className="btn btn-small" onClick={onLogout}>
                Log out
              </button>
            )}
            {account?.admin && (
              <button className="btn btn-small" onClick={onStats}>
                Players and visits
              </button>
            )}
          </div>
        </section>
        <section className="mode-card mode-offline">
          <div className="kicker">Offline · your own world</div>
          <p>A world of your own, saved in this browser. Pause it, speed it up, play at your pace.</p>
          <div className="title-actions">
            <button className="btn" onClick={onNew}>
              Start a new life
            </button>
            {saved && (
              <button className="btn" onClick={onContinue}>
                Continue · {saved}
              </button>
            )}
          </div>
        </section>
        <p className="muted" style={{ fontSize: 12.5, maxWidth: '70ch' }}>
          Satire and simulation. Real states and places; invented people and parties. Prices and figures are game numbers inspired by 2026
          Nigeria, not statistics. Maps: geoBoundaries / GRID3, CC BY 4.0.
        </p>
      </main>
      <div className="road-strip" aria-hidden="true">
        <svg width="200" height="60" viewBox="0 0 120 50">
          <rect x="2" y="2" width="112" height="36" rx="8" fill="#f2b705" stroke="#1f1d1a" strokeWidth="3" />
          <rect x="2" y="22" width="112" height="5" fill="#1f1d1a" />
          <rect x="10" y="7" width="24" height="12" rx="2" fill="#a8d8ea" stroke="#1f1d1a" strokeWidth="2" />
          <rect x="40" y="7" width="24" height="12" rx="2" fill="#a8d8ea" stroke="#1f1d1a" strokeWidth="2" />
          <rect x="70" y="7" width="30" height="12" rx="2" fill="#a8d8ea" stroke="#1f1d1a" strokeWidth="2" />
          <circle cx="26" cy="40" r="8" fill="#1f1d1a" />
          <circle cx="90" cy="40" r="8" fill="#1f1d1a" />
        </svg>
      </div>
    </>
  );
}
