import { useMemo, useState } from 'react';
import { bizType, type BizTypeId } from '../data/businesses';
import { PERKS, tradeById } from '../data/trades';
import { STATES, lgaById, lgasOf, type StateId, type TradeId } from '../data/world';
import { naira } from '../engine/life';
import { START, startOptions, type NewLife, type StartPath } from '../engine/setup';
import type { Looks } from '../engine/types';
import { ACCENT, HAIR_NAMES, OUTFIT, Portrait, SKIN } from './Portrait';

export function Create({ onStart, onBack }: { onStart: (life: NewLife) => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'m' | 'f'>('f');
  const [looks, setLooks] = useState<Looks>({ skin: 2, hair: 0, outfit: 3, accent: 0, glasses: false });
  const [state, setState] = useState<StateId>('LA');
  const [home, setHome] = useState('OSH');
  const [path, setPath] = useState<StartPath>({ kind: 'business', type: 'buka' });
  const options = useMemo(() => startOptions(home), [home]);
  const chosen: StartPath =
    path.kind === 'job' ? (options.jobs.includes(path.trade) ? path : options.jobs[0] ? { kind: 'job', trade: options.jobs[0] } : { kind: 'business', type: options.businesses[0] }) : options.businesses.includes(path.type) ? path : { kind: 'business', type: options.businesses[0] };
  const ready = name.trim().length >= 2;
  const l = lgaById(home);
  const summary = chosen.kind === 'job' ? tradeById(chosen.trade).name : bizType(chosen.type).name;

  return (
    <main className="wrap create">
      <button className="btn btn-small" onClick={onBack}>
        ← Back
      </button>
      <h1 className="h-display">Who are you?</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Everybody starts level: {naira(START.money)}, a rented room, and the same skills. What you make of it is up to you.
      </p>
      <div className="create-grid">
        <section className="card portrait-card">
          <div className="card-body" style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
            <Portrait looks={looks} gender={gender} size={180} title="Your portrait" />
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>{name.trim() || 'Your name'}</div>
            <div className="muted" style={{ fontSize: 13, textAlign: 'center' }}>
              {summary} · {l.nick}, {STATES.find((s) => s.id === state)!.name}
            </div>
          </div>
        </section>
        <section>
          <div className="step">
            <div className="step-label">Name</div>
            <input className="text-input" value={name} maxLength={32} placeholder="e.g. Bisola Adeyemi" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          </div>
          <div className="step">
            <div className="step-label">Look</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['f', 'm'] as const).map((x) => (
                  <button key={x} className="chip" aria-pressed={gender === x} onClick={() => setGender(x)}>
                    {x === 'f' ? 'Woman' : 'Man'}
                  </button>
                ))}
                <button className="chip" aria-pressed={looks.glasses} onClick={() => setLooks({ ...looks, glasses: !looks.glasses })}>
                  Glasses
                </button>
              </div>
              <div className="swatch-row" role="group" aria-label="Skin tone">
                {SKIN.map((c, i) => (
                  <button key={c} className="swatch-btn" style={{ background: c }} aria-pressed={looks.skin === i} aria-label={`Skin tone ${i + 1}`} onClick={() => setLooks({ ...looks, skin: i })} />
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Hair">
                {HAIR_NAMES[gender].map((h, i) => (
                  <button key={h} className="chip" aria-pressed={looks.hair === i} onClick={() => setLooks({ ...looks, hair: i })}>
                    {h}
                  </button>
                ))}
              </div>
              <div className="swatch-row" role="group" aria-label="Outfit colour">
                {OUTFIT.map((c, i) => (
                  <button key={c} className="swatch-btn" style={{ background: c }} aria-pressed={looks.outfit === i} aria-label={`Outfit colour ${i + 1}`} onClick={() => setLooks({ ...looks, outfit: i })} />
                ))}
              </div>
              <div className="swatch-row" role="group" aria-label="Pattern colour">
                {ACCENT.map((c, i) => (
                  <button key={c + i} className="swatch-btn" style={{ background: c, width: 26, height: 26 }} aria-pressed={looks.accent === i} aria-label={`Pattern colour ${i + 1}`} onClick={() => setLooks({ ...looks, accent: i })} />
                ))}
              </div>
            </div>
          </div>
          <div className="step">
            <div className="step-label">Where you live</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {STATES.map((s) => (
                <button
                  key={s.id}
                  className="chip"
                  aria-pressed={state === s.id}
                  onClick={() => {
                    setState(s.id);
                    setHome(lgasOf(s.id)[0].id);
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 13.5 }}>{STATES.find((s) => s.id === state)!.blurb}</p>
            <div className="option-grid">
              {lgasOf(state).map((x) => (
                <button key={x.id} className="option" aria-pressed={home === x.id} onClick={() => setHome(x.id)}>
                  <b>
                    {x.nick} <span style={{ fontWeight: 500, fontSize: 12.5 }}>· {x.name}</span>
                  </b>
                  <small>{x.landmark}</small>
                  <small>Flat: {naira(x.rent)}/yr</small>
                </button>
              ))}
            </div>
          </div>
          <div className="step">
            <div className="step-label">How you start</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="chip" aria-pressed={chosen.kind === 'business'} onClick={() => setPath({ kind: 'business', type: options.businesses[0] })}>
                Start a business
              </button>
              <button className="chip" aria-pressed={chosen.kind === 'job'} disabled={!options.jobs.length} onClick={() => setPath({ kind: 'job', trade: options.jobs[0] })}>
                Get a job
              </button>
            </div>
            <div className="option-grid">
              {chosen.kind === 'business'
                ? options.businesses.map((id: BizTypeId) => {
                    const t = bizType(id);
                    return (
                      <button key={id} className="option" aria-pressed={chosen.type === id} onClick={() => setPath({ kind: 'business', type: id })}>
                        <b>{t.name}</b>
                        <small>{t.blurb}</small>
                        <small>{t.financed ? `Work-and-pay: ${naira(t.financed)}/week to the owner` : `Costs ${naira(t.capital)} of your ${naira(START.money)}`}</small>
                        <small className="perk-none">No HMO, no pension. No ceiling either.</small>
                      </button>
                    );
                  })
                : options.jobs.map((id: TradeId) => {
                    const t = tradeById(id);
                    return (
                      <button key={id} className="option" aria-pressed={chosen.trade === id} onClick={() => setPath({ kind: 'job', trade: id })}>
                        <b>{t.name}</b>
                        <small>{t.blurb}</small>
                        <small>{naira(t.base)} a month</small>
                        <span className="perk-row">
                          {(t.perks ?? []).map((k) => (
                            <span key={k} className="perk" title={PERKS[k].detail}>
                              {PERKS[k].short}
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {chosen.kind === 'job'
                ? 'A job pays every month and comes with perks: an HMO card means free clinic visits, a pension builds up, and some jobs add a staff bus, lunch or a 13th month. But your pay has a ceiling, and government jobs stop paying when the treasury is empty.'
                : 'A business has no salary and no perks: you pay your own clinic bills, and rent, power and repairs are due whether customers come or not. But staff earn for you while you sleep, and there is no ceiling. Every business can grow, and suppliers make your other businesses cheaper to run.'}
            </p>
          </div>
        </section>
      </div>
      <div className="create-footer">
        <div className="wrap">
          <span className="muted">{ready ? 'Ready.' : 'Give yourself a name.'}</span>
          <button className="btn btn-danfo" disabled={!ready} onClick={() => onStart({ name: name.trim(), gender, looks, home, start: chosen })}>
            Begin life →
          </button>
        </div>
      </div>
    </main>
  );
}
