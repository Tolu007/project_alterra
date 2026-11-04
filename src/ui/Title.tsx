export function Title({ saved, onNew, onContinue }: { saved: string | null; onNew: () => void; onContinue: () => void }) {
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
        <div className="title-actions">
          <button className="btn btn-danfo" onClick={onNew}>
            Start a new life
          </button>
          {saved && (
            <button className="btn" onClick={onContinue}>
              Continue · {saved}
            </button>
          )}
        </div>
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
