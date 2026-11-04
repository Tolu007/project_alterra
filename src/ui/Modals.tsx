import { useEffect, useMemo, useRef, useState } from 'react';
import { BUDGET_LINES, PARTIES, partyById, type FedPolicy, type LgaPolicy, type StatePolicy } from '../data/politics';
import { lgaById, lgasOf, stateById, type StateId } from '../data/world';
import { dateLabel, yearOf } from '../engine/calendar';
import { officeTitle } from '../engine/elections';
import { eventById } from '../engine/events';
import { govById, levelOf } from '../engine/government';
import { GOALS, naira, netWorth } from '../engine/life';
import { chooseEvent, continueEvent, eventChoices, type GovernPlan } from '../engine/sim';
import { PLAYER, type Game, type News } from '../engine/types';
import { Portrait } from './Portrait';

function useFocus(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [dep]);
  return ref;
}

// ───────────── Sunday report ─────────────

export function WeekReport({ g, onContinue }: { g: Game; onContinue: () => void }) {
  const r = g.report!;
  const ref = useFocus(r.week);
  const inc = r.lines.filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount);
  const out = r.lines.filter((l) => l.amount < 0).sort((a, b) => a.amount - b.amount);
  const net = r.lines.reduce((s, l) => s + l.amount, 0);
  const money = (v: number, unit: string) => (unit === 'h/day' ? `${v.toFixed(1)}h` : `₦${Math.round(v).toLocaleString()}`);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Weekly report">
      <div className="sheet" ref={ref}>
        <div className="sheet-head night">
          <div className="kicker">{dateLabel(r.week, 6)}</div>
          <div className="sheet-title">Sunday. Count your money.</div>
        </div>
        <div className="sheet-body" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div>
              <div className="kicker">Came in</div>
              {inc.length === 0 && <div className="muted">Nothing. Sapa is real.</div>}
              {inc.map((l) => (
                <div key={l.label} className="ledger-line">
                  <span>{l.label}</span>
                  <span className="num good">+{naira(l.amount)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="kicker">Went out</div>
              {out.map((l) => (
                <div key={l.label} className="ledger-line">
                  <span>{l.label}</span>
                  <span className="num bad">−{naira(-l.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ledger-line" style={{ fontWeight: 800, fontSize: 16, borderBottom: 'none' }}>
            <span>This week</span>
            <span className={`num ${net >= 0 ? 'good' : 'bad'}`}>
              {net >= 0 ? '+' : '−'}
              {naira(Math.abs(net))}
            </span>
          </div>
          <div>
            <div className="kicker" style={{ marginBottom: 4 }}>Prices this week</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {r.priceMoves.map((m) => {
                const ch = m.after / m.before - 1;
                const upBad = m.label !== 'Light';
                const tone = Math.abs(ch) < 0.003 ? '' : (ch > 0) === upBad ? 'bad' : 'good';
                return (
                  <span key={m.label} className="chip">
                    {m.label} {money(m.after, m.unit)}
                    {Math.abs(ch) >= 0.003 && (
                      <b className={tone}>
                        {ch > 0 ? '▲' : '▼'}
                        {Math.abs(ch * 100).toFixed(1)}%
                      </b>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
          <FrontPage week={r.week} headlines={r.headlines} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-danfo" onClick={onContinue}>
              New week →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const KICKERS: Record<NonNullable<News['kind']>, string> = { politics: 'Politics', economy: 'Economy', business: 'Business', culture: 'Arts & life', sports: 'Sports', life: 'Your week' };

/** The week's biggest stories as a newspaper front page, with your own week underneath. */
function FrontPage({ week, headlines }: { week: number; headlines: News[] }) {
  const world = headlines.filter((h) => h.kind !== 'life');
  const mine = headlines.filter((h) => h.kind === 'life');
  if (!world.length && !mine.length) return null;
  const [lead, ...rest] = world;
  return (
    <div className="paper">
      <div className="paper-mast">
        <span>The Naija Weekly</span>
        <small>{dateLabel(week, 6)} · ₦500</small>
      </div>
      {lead && (
        <div className="paper-lead">
          <div className="paper-kicker">{KICKERS[lead.kind ?? 'politics']}</div>
          <h3>{lead.text}</h3>
        </div>
      )}
      {rest.length > 0 && (
        <div className="paper-grid">
          {rest.slice(0, 6).map((h, i) => (
            <div key={i} className={`paper-story ${h.tone}`}>
              <div className="paper-kicker">{KICKERS[h.kind ?? 'politics']}</div>
              <p>{h.text}</p>
            </div>
          ))}
        </div>
      )}
      {mine.length > 0 && (
        <div className="paper-mine">
          <div className="paper-kicker">Your week</div>
          <ul>
            {mine.slice(0, 5).map((h, i) => (
              <li key={i}>{h.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ───────────── events ─────────────

export function EventModal({ g, setGame }: { g: Game; setGame: (g: Game) => void }) {
  const e = g.currentEvent!;
  const def = eventById(e.id);
  const ref = useFocus(`${e.id}:${g.outcome !== null}`);
  const choices = eventChoices(g);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="ev-title">
      <div className="sheet" ref={ref} key={e.id}>
        <div className="sheet-head">
          <div className="kicker" style={{ color: 'var(--ink)' }}>{def.kicker}</div>
          <h2 id="ev-title" className="sheet-title">
            {def.title(g, e)}
          </h2>
        </div>
        <div className="sheet-body">
          <p style={{ marginTop: 0, fontSize: 16 }}>{def.body(g, e)}</p>
          {g.outcome === null ? (
            <div className="choices">
              {choices.map((c, i) => (
                <button key={i} className="choice" disabled={!!c.blocked} onClick={() => setGame(chooseEvent(g, i))}>
                  {c.label}
                  {(c.blocked || c.hint) && <small>{c.blocked ?? c.hint}</small>}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="outcome" role="status">
                {g.outcome}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-ink" onClick={() => setGame(continueEvent(g))}>
                  Continue →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────── governing ─────────────

export function GovernModal({ g, onSubmit }: { g: Game; onSubmit: (plan: GovernPlan) => void }) {
  const office = g.player.office!;
  const level = levelOf(office);
  const gov = govById(g, office);
  const ref = useFocus(office);
  const lines = BUDGET_LINES[level];
  const [budget, setBudget] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, Math.round((gov.budget[l.id] ?? 0) * 100)])));
  const [payRate, setPayRate] = useState(Math.round(gov.payRate * 100));
  const [policy, setPolicy] = useState<Record<string, unknown>>({ ...(gov.policy as object) });
  const [demolish, setDemolish] = useState<string | null>(null);
  const total = Object.values(budget).reduce((a, b) => a + b, 0) || 1;
  const led = gov.ledger;
  const estimate = Math.max(0, gov.treasury + led.revenue + led.borrowed - led.wages * (payRate / 100) - led.debtService - 0.1 * led.revenue) * 0.9;
  const cut = (estimate * (budget.misc ?? 0)) / total;
  const set = (k: string, v: unknown) => setPolicy((p) => ({ ...p, [k]: v }));
  const bn = (x: number) => (x >= 1000 ? `₦${(x / 1000).toFixed(2)}tn` : x >= 1 ? `₦${x.toFixed(1)}bn` : `₦${Math.round(x * 1000)}m`);
  const lgaOptions = useMemo(() => (level === 'state' ? lgasOf(office as StateId).filter((l) => g.demolition[l.id] <= 0) : []), [level, office, g.demolition]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Budget session">
      <div className="sheet wide" ref={ref}>
        <div className="sheet-head">
          <div className="kicker" style={{ color: 'var(--ink)' }}>Monthly budget session · {officeTitle(office)}</div>
          <div className="sheet-title">How will you spend the people’s money?</div>
        </div>
        <div className="sheet-body" style={{ display: 'grid', gap: 14 }}>
          <div className="stat-grid">
            <div className="tile">
              <div className="kicker">Revenue last month</div>
              <div className="tile-value">{bn(led.revenue)}</div>
            </div>
            <div className="tile">
              <div className="kicker">Wage bill</div>
              <div className="tile-value">{bn(led.wages)}</div>
            </div>
            <div className="tile">
              <div className="kicker">Debt service</div>
              <div className="tile-value">{bn(led.debtService)}</div>
            </div>
            <div className="tile">
              <div className="kicker">Treasury</div>
              <div className="tile-value">{bn(gov.treasury)}</div>
            </div>
            <div className="tile">
              <div className="kicker">To spend (approx.)</div>
              <div className="tile-value">{bn(estimate)}</div>
            </div>
            <div className="tile">
              <div className="kicker">Your “cut”</div>
              <div className={`tile-value ${cut > 0 ? 'bad' : ''}`}>{naira(cut * 1e9)}</div>
            </div>
          </div>

          <div>
            <div className="kicker">Pay workers</div>
            <div className="slider-row">
              <span>
                Share of salaries paid <span className="muted">{gov.arrears >= 0.5 ? `(${gov.arrears.toFixed(1)} months owed)` : ''}</span>
              </span>
              <input type="range" min={0} max={100} step={5} value={payRate} onChange={(e) => setPayRate(Number(e.target.value))} aria-label="Share of salaries paid" />
              <span className="num">{payRate}%</span>
            </div>
          </div>

          <div>
            <div className="kicker">Where the rest goes</div>
            {lines.map((l) => (
              <div key={l.id} className="slider-row">
                <span>
                  <b>{l.name}</b> <span className="muted" style={{ fontSize: 12.5 }}>{l.text}</span>
                </span>
                <input type="range" min={0} max={100} value={budget[l.id] ?? 0} onChange={(e) => setBudget((b) => ({ ...b, [l.id]: Number(e.target.value) }))} aria-label={l.name} />
                <span className="num">{Math.round(((budget[l.id] ?? 0) / total) * 100)}%</span>
              </div>
            ))}
          </div>

          <div>
            <div className="kicker">Policies</div>
            {level === 'federal' && <FedControls p={policy as FedPolicy} set={set} />}
            {level === 'state' && <StateControls p={policy as StatePolicy} set={set} />}
            {level === 'lga' && <LgaControls p={policy as LgaPolicy} set={set} />}
            {level === 'state' && (
              <div className="toggle-row">
                <span>
                  <b>“Urban renewal”</b> <span className="muted" style={{ fontSize: 12.5 }}>Demolish a market: chaos for 8 weeks, then a modern market with higher levies.</span>
                </span>
                <select className="select" style={{ width: 'auto', fontSize: 14, padding: '6px 10px' }} value={demolish ?? ''} onChange={(e) => setDemolish(e.target.value || null)} aria-label="Demolish a market">
                  <option value="">Leave the markets alone</option>
                  {lgaOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      Demolish {l.nick} market
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 13 }}>Changes take effect from next month’s budget. People notice within weeks.</span>
            <button
              className="btn btn-danfo"
              onClick={() => onSubmit({ budget: Object.fromEntries(Object.entries(budget).map(([k, v]) => [k, v / total])), payRate: payRate / 100, policy: policy as GovernPlan['policy'], demolish })}
            >
              Sign the budget →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Seg<T extends string | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </span>
  );
}

function Row({ name, text, children }: { name: string; text: string; children: React.ReactNode }) {
  return (
    <div className="toggle-row">
      <span>
        <b>{name}</b> <span className="muted" style={{ fontSize: 12.5 }}>{text}</span>
      </span>
      {children}
    </div>
  );
}

function FedControls({ p, set }: { p: FedPolicy; set: (k: string, v: unknown) => void }) {
  return (
    <>
      <Row name="Fuel subsidy" text="Cheap fuel for everyone, a hole in everybody’s budget.">
        <Seg value={p.subsidy} options={[[false, 'Off'], [true, 'On']]} onChange={(v) => set('subsidy', v)} />
      </Row>
      {p.subsidy && (
        <Row name="Pump price" text="What you fix the litre at.">
          <Seg value={String(p.subsidyPrice)} options={[['500', '₦500'], ['650', '₦650'], ['800', '₦800']]} onChange={(v) => set('subsidyPrice', Number(v))} />
        </Row>
      )}
      <Row name="Exchange rate" text="Peg: cheap official dollars, black market gap, reserves drain.">
        <Seg value={p.fx} options={[['float', 'Float'], ['peg', 'Peg']]} onChange={(v) => set('fx', v)} />
      </Row>
      <Row name="Interest rate" text="High: cools inflation, starves borrowers.">
        <Seg value={String(p.mpr)} options={[['14', '14%'], ['20', '20%'], ['27', '27%'], ['32', '32%']]} onChange={(v) => set('mpr', Number(v))} />
      </Row>
      <Row name="Minimum wage" text="States may refuse to pay it.">
        <Seg value={String(p.minWage)} options={[['70000', '₦70k'], ['100000', '₦100k'], ['150000', '₦150k']]} onChange={(v) => set('minWage', Number(v))} />
      </Row>
      <Row name="Rice import ban" text="Helps Kano farmers, hurts every pot of jollof.">
        <Seg value={p.riceBan} options={[[false, 'Open'], [true, 'Banned']]} onChange={(v) => set('riceBan', v)} />
      </Row>
      <Row name="Electricity tariff" text="Cost-reflective funds the grid.">
        <Seg value={p.tariff} options={[['subsidised', 'Cheap'], ['cost', 'Cost-reflective']]} onChange={(v) => set('tariff', v)} />
      </Row>
      <Row name="Borrowing a month" text="Spend now, pay forever.">
        <Seg value={String(p.borrow)} options={[['0', '₦0'], ['400', '₦400bn'], ['900', '₦900bn']]} onChange={(v) => set('borrow', Number(v))} />
      </Row>
      <Row name="Print money" text="Free money today, inflation tomorrow.">
        <Seg value={String(p.print)} options={[['0', 'No'], ['250', '₦250bn'], ['600', '₦600bn']]} onChange={(v) => set('print', Number(v))} />
      </Row>
    </>
  );
}

function StateControls({ p, set }: { p: StatePolicy; set: (k: string, v: unknown) => void }) {
  return (
    <>
      <Row name="Extra levies & taxes" text="Money for the state, pain for business.">
        <Seg value={String(p.tax)} options={[['0.01', 'Low'], ['0.03', 'Normal'], ['0.07', 'High']]} onChange={(v) => set('tax', Number(v))} />
      </Row>
      <Row name="Okada" text="Bans cut accidents and riders’ livelihoods.">
        <Seg value={p.okada} options={[['none', 'Allowed'], ['partial', 'City ban'], ['full', 'Full ban']]} onChange={(v) => set('okada', v)} />
      </Row>
      <Row name="Pay the minimum wage" text="Your wage bill rises with it.">
        <Seg value={p.payMinWage} options={[[true, 'Yes'], [false, 'No']]} onChange={(v) => set('payMinWage', v)} />
      </Row>
      <Row name="Free education" text="Popular and costly.">
        <Seg value={p.freeSchool} options={[[false, 'Fees'], [true, 'Free']]} onChange={(v) => set('freeSchool', v)} />
      </Row>
      <Row name="Rent control" text="Freezes rents. Landlords will remember.">
        <Seg value={p.rentControl} options={[[false, 'Off'], [true, 'On']]} onChange={(v) => set('rentControl', v)} />
      </Row>
      <Row name="LGA allocations" text="Keeping them is illegal, and common.">
        <Seg value={p.withholdLga} options={[[false, 'Release'], [true, 'Withhold']]} onChange={(v) => set('withholdLga', v)} />
      </Row>
      <Row name="Borrowing a month" text="Bonds, bank loans, contractors owed.">
        <Seg value={String(p.borrow)} options={[['0', '₦0'], ['3', '₦3bn'], ['8', '₦8bn']]} onChange={(v) => set('borrow', Number(v))} />
      </Row>
    </>
  );
}

function LgaControls({ p, set }: { p: LgaPolicy; set: (k: string, v: unknown) => void }) {
  return (
    <>
      <Row name="Market levy" text="Council money, traders’ tears.">
        <Seg value={String(p.levy)} options={[['0.01', '1%'], ['0.03', '3%'], ['0.06', '6%'], ['0.09', '9%']]} onChange={(v) => set('levy', Number(v))} />
      </Row>
      <Row name="Motor parks" text="Touts keep the boys loyal and drivers poor.">
        <Seg value={p.park} options={[['touts', 'Touts'], ['official', 'Council'], ['none', 'Free']]} onChange={(v) => set('park', v)} />
      </Row>
      <Row name="Monthly sanitation day" text="Cleaner streets, one lost trading morning.">
        <Seg value={p.sanitationDay} options={[[false, 'Off'], [true, 'On']]} onChange={(v) => set('sanitationDay', v)} />
      </Row>
    </>
  );
}

// ───────────── elections ─────────────

export function ElectionModal({ g, onClose }: { g: Game; onClose: () => void }) {
  const rec = g.elections[g.showElection!];
  const ref = useFocus(g.showElection);
  const level = levelOf(rec.office);
  const total = rec.candidates.reduce((a, c) => a + c.votes, 0) || 1;
  const ranked = rec.candidates.slice().sort((a, b) => b.votes - a.votes);
  const winner = rec.winner === PLAYER ? 'You' : g.people[rec.winner].name;
  const youWon = rec.winner === PLAYER;
  const where = level === 'federal' ? 'Nigeria' : level === 'state' ? stateById(rec.office as StateId).name : `${lgaById(rec.office).name} LGA`;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Election results">
      <div className="sheet wide" ref={ref}>
        <div className="sheet-head night">
          <div className="kicker">{level === 'federal' ? 'Presidential election' : level === 'state' ? 'Governorship election' : 'Council election'} · {yearOf(rec.week)}</div>
          <div className="sheet-title">{youWon ? `You won ${where}!` : `${winner} wins ${where}`}</div>
        </div>
        <div className="sheet-body" style={{ display: 'grid', gap: 12 }}>
          {ranked.map((c) => {
            const party = partyById(c.party);
            const person = g.people[c.person];
            return (
              <div key={c.party} className="result-bar">
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <Portrait looks={person.looks} gender={person.gender} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 }}>{c.person === PLAYER ? 'You' : person.name}</b>
                    <span className="kicker">{party.id}</span>
                  </span>
                </span>
                <span className="track">
                  <i style={{ width: `${(c.votes / total) * 100}%`, background: party.color }} />
                </span>
                <span className="num" style={{ textAlign: 'right' }}>
                  {((c.votes / total) * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Turnout {(rec.turnout * 100).toFixed(0)}% · {(total / 1e6).toFixed(2)}m votes counted
            {rec.rest && ` · ${((rec.rest.reduce((a, b) => a + b, 0) / total) * 100).toFixed(0)}% of votes from the other 34 states`}
          </p>
          {level !== 'lga' && (
            <table className="table">
              <thead>
                <tr>
                  <th>LGA</th>
                  {PARTIES.map((p) => (
                    <th key={p.id} className="r">
                      {p.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(rec.byLga).map(([id, votes]) => {
                  const sum = votes.reduce((a, b) => a + b, 0) || 1;
                  const top = votes.indexOf(Math.max(...votes));
                  return (
                    <tr key={id}>
                      <td>{lgaById(id).nick}</td>
                      {votes.map((v, i) => (
                        <td key={i} className="r num" style={i === top ? { fontWeight: 800 } : undefined}>
                          {((v / sum) * 100).toFixed(0)}%
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-danfo" onClick={onClose}>
              {youWon ? 'Take the oath →' : 'Continue →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────── endings ─────────────

export function Ending({ g, onNew }: { g: Game; onNew: () => void }) {
  const e = g.ending!;
  const me = g.people[PLAYER];
  const years = (e.week / 48).toFixed(1);
  const offices = [...new Set(g.elections.filter((r) => r.winner === PLAYER).map((r) => officeTitle(r.office)))];
  return (
    <main className="wrap" style={{ paddingBlock: 30 }}>
      <div className="sheet wide" style={{ margin: '0 auto' }}>
        <div className="sheet-head night">
          <div className="kicker">{e.kind === 'japa' ? 'You japa’d' : e.kind === 'jail' ? 'Kuje correctional centre' : 'The end'}</div>
          <div className="sheet-title">{me.name}, after {years} years</div>
        </div>
        <div className="sheet-body" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <Portrait looks={me.looks} gender={me.gender} size={88} />
            <p style={{ fontSize: 17, margin: 0 }}>{e.text}</p>
          </div>
          <div className="stat-grid">
            <div className="tile">
              <div className="kicker">Net worth</div>
              <div className="tile-value">{naira(netWorth(g))}</div>
            </div>
            <div className="tile">
              <div className="kicker">Offices won</div>
              <div className="tile-value">{offices.length}</div>
            </div>
            <div className="tile">
              <div className="kicker">Life goals</div>
              <div className="tile-value">
                {g.player.goals.length}/{GOALS.length}
              </div>
            </div>
          </div>
          {offices.length > 0 && <p style={{ margin: 0 }}>You served as: {offices.join(', ')}.</p>}
          <p className="muted" style={{ margin: 0 }}>The naira ended at ₦{Math.round(g.macro.fxParallel).toLocaleString()}/$ and a bag of rice in {stateById(lgaById(g.player.home).state).name} at {naira(g.prices[lgaById(g.player.home).state].rice)}.</p>
          <div>
            <button className="btn btn-danfo" onClick={onNew}>
              Start a new life
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

