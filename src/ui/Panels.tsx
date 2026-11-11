import { builders, holdings } from '../engine/property';
import { FURNISHINGS, ageOf, datingOf, kidsOf, owns, spouseOf } from '../engine/family';
import { useState } from 'react';
import { NIGERIA, NIGERIA_H, NIGERIA_W, STATE_GEO, STATE_H, STATE_W } from '../data/geo';
import { ROLE_NAMES } from '../data/people';
import { BUDGET_LINES, STYLES, partyById, type FedPolicy, type Level, type LgaPolicy, type StatePolicy } from '../data/politics';
import { tradeById } from '../data/trades';
import { STATES, lgaById, lgasOf, stateById, type StateId } from '../data/world';
import { dateLabel, ELECTION_WEEK, weeksUntilElection } from '../engine/calendar';
import { okadaBanned, services, tradeIncome } from '../engine/economy';
import { officeTitle } from '../engine/elections';
import { GOALS, HOUSING, naira, netWorth } from '../engine/life';
import type { Game, Gov } from '../engine/types';
import { LineChart, StatTile, type Point } from './charts';
import { Portrait } from './Portrait';

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="meter-mini" style={{ minWidth: 0 }}>
      <span>
        {label} · {Math.round(value)}
      </span>
      <div className="bar">
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
    </div>
  );
}

// ───────────── Life ─────────────

export function LifePanel({ g }: { g: Game }) {
  const p = g.player;
  const me = g.people[g.me];
  const t = tradeById(p.trade);
  const lines = p.lastWeek.slice().sort((a, b) => b.amount - a.amount);
  const net = lines.reduce((s, l) => s + l.amount, 0);
  const rentWeeks = p.rentDue - g.week;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Portrait looks={me.looks} gender={me.gender} size={72} title={me.name} />
        <div>
          <div className="card-title">{me.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {t.name}
            {p.hired ? ' (work and pay)' : ''} · {lgaById(p.home).nick}, {stateById(lgaById(p.home).state).name}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {HOUSING[p.housing].name}
            {p.housing !== 'family' && ` · rent due in ${Math.max(0, rentWeeks)} weeks`}
          </div>
          {p.office && <span className="chip" style={{ marginTop: 4, background: 'var(--danfo)' }}>{officeTitle(p.office)}</span>}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        🎂 {ageOf(g)} years old ·{' '}
        {spouseOf(g) ? `💍 married to ${spouseOf(g)!.name}` : datingOf(g) ? `💐 seeing ${datingOf(g)!.name}` : 'single'}
        {kidsOf(g) ? ` · 👶 ${kidsOf(g)} child${kidsOf(g) > 1 ? 'ren' : ''}` : ''}
        {holdings(g, g.me).length ? ` · 🏘️ ${holdings(g, g.me).length} propert${holdings(g, g.me).length > 1 ? 'ies' : 'y'} worth ${naira(holdings(g, g.me).reduce((s, x) => s + x.s.value, 0))}` : ''}
        {builders(g).some((f) => f.owner === g.me) ? ` · 🏗️ owns ${builders(g).filter((f) => f.owner === g.me).map((f) => f.name).join(', ')}` : ''}
        {FURNISHINGS.some((f) => owns(g, f.id)) && (
          <>
            <br />
            🏠 At home:{' '}
            {FURNISHINGS.filter((f) => owns(g, f.id))
              .map((f) => f.name.toLowerCase())
              .join(', ')}
          </>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <Meter label="Health" value={p.health} color="var(--good)" />
        <Meter label="Energy" value={p.energy} color="var(--danfo)" />
        <Meter label="Happiness" value={p.happiness} color="var(--chart)" />
      </div>
      <div className="stat-grid">
        <StatTile label="Cash" value={naira(p.money)} />
        <StatTile label="Dollars" value={`$${Math.round(p.usd).toLocaleString()}`} />
        <StatTile label="Net worth" value={naira(netWorth(g))} />
      </div>
      {p.loan > 0 && <p className="bad" style={{ margin: 0, fontWeight: 700 }}>You owe {naira(p.loan)} at {(g.fed.policy.mpr + 12).toFixed(0)}% a year.</p>}
      <div>
        <div className="kicker" style={{ marginBottom: 6 }}>Skills (0–5)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {(['edu', 'tech', 'biz', 'people'] as const).map((s) => (
            <Meter key={s} label={{ edu: 'Education', tech: 'Technical', biz: 'Business', people: 'People' }[s]} value={(p.skills[s] / 5) * 100} color="var(--keke)" />
          ))}
        </div>
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 4 }}>Last week’s money</div>
        {lines.length === 0 && <p className="muted" style={{ margin: 0 }}>Your first week is still running.</p>}
        {lines.map((l) => (
          <div key={l.label} className="ledger-line">
            <span>{l.label}</span>
            <span className={`num ${l.amount >= 0 ? 'good' : 'bad'}`}>
              {l.amount >= 0 ? '+' : '−'}
              {naira(Math.abs(l.amount))}
            </span>
          </div>
        ))}
        {lines.length > 0 && (
          <div className="ledger-line" style={{ fontWeight: 800, borderBottom: 'none' }}>
            <span>Net</span>
            <span className={`num ${net >= 0 ? 'good' : 'bad'}`}>
              {net >= 0 ? '+' : '−'}
              {naira(Math.abs(net))}
            </span>
          </div>
        )}
      </div>
      {p.assets.length > 0 && (
        <div>
          <div className="kicker" style={{ marginBottom: 4 }}>What you own</div>
          {p.assets.map((a, i) => (
            <div key={i} className="ledger-line">
              <span>{a.kind === 'land' ? 'Plot of land' : a.kind === 'keke' ? 'Keke on hire' : 'Okada on hire'} · {lgaById(a.lga).nick}</span>
              <span className="num muted">bought {naira(a.price)}</span>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="kicker" style={{ marginBottom: 4 }}>
          Politics {p.party ? `· ${partyById(p.party).name}, standing ${Math.round(p.standing)}` : '· not in a party'}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Influence at home {Math.round(p.influence[p.home])}/100
          {p.campaign && ` · Running for ${officeTitle(p.campaign.office)} (${p.campaign.stage})`}
          {p.scandal > 5 && ` · Scandal ${Math.round(p.scandal)}`}
        </div>
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 4 }}>Life goals</div>
        <div style={{ display: 'grid', gap: 3 }}>
          {GOALS.map((goal) => (
            <div key={goal.id} style={{ fontSize: 13.5, opacity: p.goals.includes(goal.id) ? 1 : 0.55 }}>
              {p.goals.includes(goal.id) ? '✅' : '⬜'} {goal.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────── Economy ─────────────

type Metric = 'fx' | 'inflation' | 'petrol' | 'rice' | 'fare' | 'grid';

export function EconomyPanel({ g }: { g: Game }) {
  const [metric, setMetric] = useState<Metric>('fx');
  const st = lgaById(g.player.home).state;
  const s0 = g.series[0];
  const series = g.series;
  const pr = g.prices[st];
  const pick = (m: Metric, x: (typeof series)[number]) => (m === 'fx' ? x.fx : m === 'inflation' ? x.inflation * 100 : m === 'petrol' ? x.petrol[st] : m === 'rice' ? x.rice[st] : m === 'fare' ? x.fare[st] : x.grid[st]);
  const delta = (now: number, m: Metric) => (s0 ? now / pick(m, s0) - 1 : undefined);
  const trend = (m: Metric) => series.map((x) => pick(m, x));
  const fp = g.fed.policy;
  const sp = g.states[st].policy;
  const lp = g.lgas[g.player.home].policy;
  const points: Point[] = series.map((x) => ({ x: x.week, y: pick(metric, x), label: dateLabel(x.week).split(' · ')[1].replace('Week ', 'W') }));
  const fmt: Record<Metric, (v: number) => string> = {
    fx: (v) => `₦${Math.round(v).toLocaleString()}`,
    inflation: (v) => `${v.toFixed(0)}%`,
    petrol: (v) => `₦${Math.round(v)}`,
    rice: (v) => `₦${Math.round(v / 1000)}k`,
    fare: (v) => `₦${Math.round(v)}`,
    grid: (v) => `${v.toFixed(1)}h`,
  };
  const why: string[] = [
    fp.subsidy ? `Fuel subsidy is ON: pump price fixed at ₦${fp.subsidyPrice}. It costs the federation about ₦${Math.round(g.fed.ledger.subsidy)}bn a month${pr.scarcity ? ', and stations are hoarding' : ''}.` : 'Fuel subsidy is OFF: petrol follows the dollar and the landing cost.',
    fp.fx === 'peg' ? `The naira is pegged at ₦${Math.round(g.macro.fxOfficial)}/$, but the street pays ₦${Math.round(g.macro.fxParallel)}. Reserves: $${g.macro.reserves.toFixed(0)}bn.` : `The naira floats: ₦${Math.round(g.macro.fxParallel)}/$. Reserves: $${g.macro.reserves.toFixed(0)}bn.`,
    `Central bank rate ${fp.mpr}%${fp.print > 0 ? `, and it is printing ₦${fp.print}bn a month to fund the government` : ''}.`,
    fp.riceBan ? 'Rice imports are banned: dearer rice, but Kano’s rice farmers are smiling.' : 'Rice imports are allowed.',
    `Electricity tariff is ${fp.tariff === 'cost' ? 'cost-reflective: dear, but the grid gets investment' : 'subsidised: cheap, with more rationing'}. ${stateById(st).name} gets about ${pr.grid.toFixed(1)} hours a day.`,
    sp.okada !== 'none' ? `Okada is banned ${sp.okada === 'full' ? 'everywhere' : 'in city LGAs'} in ${stateById(st).name}. Fares are higher there.` : `Okada is allowed in ${stateById(st).name}.`,
    `${lgaById(g.player.home).name} market levy is ${pct(lp.levy, 1)}; motor parks run by ${lp.park === 'touts' ? 'touts' : lp.park === 'official' ? 'the council' : 'nobody (free)'}.`,
  ];
  const homeTrades = Object.entries(g.cohorts[g.player.home]).sort((a, b) => b[1].workers - a[1].workers);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="stat-grid">
        <StatTile label="Dollar (street)" value={`₦${Math.round(g.macro.fxParallel).toLocaleString()}`} delta={delta(g.macro.fxParallel, 'fx')} upIsGood={false} trend={trend('fx')} />
        <StatTile label="Inflation (yearly)" value={pct(g.macro.inflation, 1)} trend={trend('inflation')} />
        <StatTile label={`Petrol, ${stateById(st).name}`} value={`₦${Math.round(pr.petrol)}/L`} delta={delta(pr.petrol, 'petrol')} upIsGood={false} trend={trend('petrol')} />
        <StatTile label="50kg bag of rice" value={naira(pr.rice)} delta={delta(pr.rice, 'rice')} upIsGood={false} trend={trend('rice')} />
        <StatTile label={`Bus fare, ${lgaById(g.player.home).nick}`} value={`₦${Math.round(g.fares[g.player.home])}`} delta={s0 ? g.fares[g.player.home] / s0.fare[st] - 1 : undefined} upIsGood={false} trend={trend('fare')} />
        <StatTile label="Light per day" value={`${pr.grid.toFixed(1)} hours`} delta={delta(pr.grid, 'grid')} upIsGood trend={trend('grid')} />
      </div>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {(['fx', 'inflation', 'petrol', 'rice', 'fare', 'grid'] as Metric[]).map((m) => (
            <button key={m} className="chip" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {{ fx: 'Dollar', inflation: 'Inflation', petrol: 'Petrol', rice: 'Rice', fare: 'Fare', grid: 'Light' }[m]}
            </button>
          ))}
        </div>
        <div className="kicker" style={{ marginBottom: 2 }}>
          {{ fx: 'Naira per dollar', inflation: 'Inflation, % a year', petrol: `Petrol price, ${stateById(st).name}`, rice: `50kg rice, ${stateById(st).name}`, fare: `Average fare, ${stateById(st).name}`, grid: `Hours of light, ${stateById(st).name}` }[metric]}
        </div>
        <LineChart points={points} format={fmt[metric]} title={metric} />
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 4 }}>Why prices are where they are</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, display: 'grid', gap: 4 }}>
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
      <div>
        <div className="kicker" style={{ marginBottom: 4 }}>How people in {lgaById(g.player.home).nick} are doing</div>
        <table className="table">
          <thead>
            <tr>
              <th>Trade</th>
              <th className="r">Weekly</th>
              <th className="r">Real vs start</th>
              <th className="r">Mood</th>
            </tr>
          </thead>
          <tbody>
            {homeTrades.map(([id, c]) => {
              const real = (c.income * Math.max(c.employed, 0.3)) / g.prices[st].cpi / c.base - 1;
              return (
                <tr key={id} style={id === g.player.trade ? { fontWeight: 700 } : undefined}>
                  <td>{tradeById(id as never).name.split(' (')[0]}</td>
                  <td className="r num">{naira(c.income)}</td>
                  <td className={`r num ${real >= 0 ? 'good' : 'bad'}`}>
                    {real >= 0 ? '+' : ''}
                    {(real * 100).toFixed(0)}%
                  </td>
                  <td className="r num">{Math.round(c.happiness)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────── Government ─────────────

function policyChips(level: Level, policy: FedPolicy | StatePolicy | LgaPolicy, g: Game): { text: string; hard: boolean }[] {
  if (level === 'federal') {
    const p = policy as FedPolicy;
    return [
      { text: p.subsidy ? `Subsidy ON (₦${p.subsidyPrice})` : 'No fuel subsidy', hard: !p.subsidy },
      { text: p.fx === 'peg' ? `Naira pegged ₦${Math.round(g.macro.peg)}` : 'Naira floats', hard: p.fx === 'float' },
      { text: `Rate ${p.mpr}%`, hard: p.mpr > 24 },
      { text: `Min. wage ${naira(p.minWage)}`, hard: false },
      ...(p.riceBan ? [{ text: 'Rice import ban', hard: true }] : []),
      { text: p.tariff === 'cost' ? 'Cost-reflective tariff' : 'Cheap electricity', hard: p.tariff === 'cost' },
      ...(p.print > 0 ? [{ text: `Printing ₦${p.print}bn/mo`, hard: true }] : []),
    ];
  }
  if (level === 'state') {
    const p = policy as StatePolicy;
    return [
      { text: `Levies +${(p.tax * 100).toFixed(0)}%`, hard: p.tax > 0.04 },
      { text: p.okada === 'none' ? 'Okada allowed' : p.okada === 'full' ? 'Okada banned' : 'Okada banned in city', hard: p.okada !== 'none' },
      { text: p.payMinWage ? 'Pays min. wage' : 'Ignores min. wage', hard: !p.payMinWage },
      ...(p.freeSchool ? [{ text: 'Free education', hard: false }] : []),
      ...(p.rentControl ? [{ text: 'Rent control', hard: false }] : []),
      ...(p.withholdLga ? [{ text: 'Holds LGA funds', hard: true }] : []),
    ];
  }
  const p = policy as LgaPolicy;
  return [
    { text: `Market levy ${(p.levy * 100).toFixed(1)}%`, hard: p.levy > 0.045 },
    { text: p.park === 'touts' ? 'Touts run parks' : p.park === 'official' ? 'Council park dues' : 'No park dues', hard: p.park === 'touts' },
    ...(p.sanitationDay ? [{ text: 'Sanitation day', hard: false }] : []),
  ];
}

function LeaderCard({ g, gov, title }: { g: Game; gov: Gov<FedPolicy> | Gov<StatePolicy> | Gov<LgaPolicy>; title: string }) {
  const you = gov.leader === g.me;
  const person = g.people[gov.leader];
  const party = partyById(gov.party);
  const led = gov.ledger;
  const lines = BUDGET_LINES[gov.level];
  const spent = Object.values(led.spent).reduce((a, b) => a + b, 0) || 1;
  const paid = led.wages ? led.wagesPaid / led.wages : 1;
  const next = weeksUntilElection(g.week, gov.level);
  return (
    <div className="leader">
      <Portrait looks={person.looks} gender={person.gender} size={64} title={person.name} />
      <div>
        <div className="kicker">{title}</div>
        <div style={{ fontWeight: 800, fontSize: 16 }}>
          {you ? `You · ${person.name}` : person.name}{' '}
          <span className="chip" style={{ background: party.color, color: party.ink, padding: '1px 8px', fontSize: 11 }}>
            {party.id}
          </span>
        </div>
        {!you && (
          <div className="muted" style={{ fontSize: 12.5 }}>
            Known as a <b>{STYLES[gov.style].name.toLowerCase()}</b>: {STYLES[gov.style].text}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <Meter label="Approval" value={gov.approval} color={gov.approval >= 50 ? 'var(--good)' : gov.approval >= 35 ? 'var(--warn)' : 'var(--bad)'} />
          </div>
          <span className="kicker">Election in {next} wk</span>
        </div>
        <div className="policy-chips">
          {policyChips(gov.level, gov.policy, g).map((c) => (
            <span key={c.text} className={`chip ${c.hard ? 'hard' : 'soft'}`}>
              {c.text}
            </span>
          ))}
        </div>
        {led.revenue > 0 && (
          <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-2)' }}>
            Last month: revenue {bn(led.revenue)} · wages paid {pct(paid)}
            {gov.arrears >= 0.5 && <b className="bad"> · {gov.arrears.toFixed(1)} months owed</b>} · debt {bn(gov.debt)}
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 5, gap: 2 }}>
              {lines.map((l, i) => {
                const share = (led.spent[l.id] ?? 0) / spent;
                return share > 0.005 ? <i key={l.id} title={`${l.name}: ${pct(share)}`} style={{ width: `${share * 100}%`, background: l.id === 'misc' ? '#b8352a' : l.id === 'palliatives' ? '#f2b705' : ['#2f63ad', '#1e8f5a', '#7d7466', '#0f7c84', '#7b3fa0', '#e0782a'][i % 6] }} /> : null;
              })}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {lines
                .filter((l) => (led.spent[l.id] ?? 0) / spent > 0.08)
                .map((l) => `${l.name} ${pct((led.spent[l.id] ?? 0) / spent)}`)
                .join(' · ')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const bn = (x: number) => (x >= 1000 ? `₦${(x / 1000).toFixed(1)}tn` : x >= 1 ? `₦${x.toFixed(1)}bn` : `₦${Math.round(x * 1000)}m`);

export function GovernmentPanel({ g }: { g: Game }) {
  const home = lgaById(g.player.home);
  return (
    <div>
      <LeaderCard g={g} gov={g.lgas[home.id]} title={`Chairman, ${home.name} LGA`} />
      <LeaderCard g={g} gov={g.states[home.state]} title={`Governor of ${stateById(home.state).name}`} />
      <LeaderCard g={g} gov={g.fed} title="President of Nigeria" />
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
        Council elections in April, governors in August, the presidency in November. Every term is one game year; two terms maximum.
        {g.player.office ? ' Your budget session opens at the end of each month.' : ''}
      </p>
    </div>
  );
}

// ───────────── People ─────────────

export function PeoplePanel({ g }: { g: Game }) {
  const st = lgaById(g.player.home).state;
  const known = g.people.filter(
    (x) =>
      x.id !== g.me &&
      (x.role === 'family' || x.role === 'friend' || (x.role === 'neighbour' && x.lga === g.player.home) || (['godfather', 'journalist', 'union-chairman', 'market-leader', 'area-boss'].includes(x.role) && lgaById(x.lga).state === st) || (x.office && (x.office === g.player.home || x.office === st || x.office === 'FED'))),
  );
  return (
    <div>
      {known.map((x) => (
        <div key={x.id} className="person-row">
          <Portrait looks={x.looks} gender={x.gender} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {x.office ? officeTitle(x.office) : ROLE_NAMES[x.role] ?? x.role} · {tradeById(x.trade).name.split(' (')[0]} · {lgaById(x.lga).nick}
            </div>
          </div>
          <Meter label="Relation" value={50 + x.relation / 2} color={x.relation >= 0 ? 'var(--good)' : 'var(--bad)'} />
        </div>
      ))}
    </div>
  );
}

// ───────────── News ─────────────

export function NewsPanel({ g }: { g: Game }) {
  const items = g.news.slice(-60).reverse();
  if (!items.length) return <p className="muted">Quiet week. That never lasts.</p>;
  return (
    <div>
      {items.map((n, i) => (
        <div key={i} className="news-item">
          <span className="kicker">{dateLabel(n.week).split(' · ')[1].replace('Week ', 'W')}</span>
          <span className={n.tone === 'bad' ? 'bad' : n.tone === 'good' ? 'good' : undefined}>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────── Map ─────────────

export function MapPanel({ g }: { g: Game }) {
  const here = lgaById(g.player.at);
  const [state, setState] = useState<StateId>(here.state);
  const [lga, setLga] = useState<string>(here.id);
  const geo = STATE_GEO[state];
  const l = lgaById(lga);
  const sv = services(g, lga);
  const chair = g.lgas[lga];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <svg viewBox={`0 0 ${NIGERIA_W} ${NIGERIA_H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="group" aria-label="Map of Nigeria">
        {Object.entries(NIGERIA).map(([id, s]) => {
          const playable = STATES.some((x) => x.id === id);
          return (
            <path
              key={id}
              d={s.d}
              fill={playable ? stateById(id as StateId).colour : '#e3d6ba'}
              stroke="#1f1d1a"
              strokeWidth={playable && id === state ? 4 : 1.2}
              style={{ cursor: playable ? 'pointer' : 'default' }}
              onClick={playable ? () => {
                setState(id as StateId);
                setLga(lgasOf(id as StateId)[0].id);
              } : undefined}
            >
              <title>{playable ? stateById(id as StateId).name : `${id}: coming in a later version`}</title>
            </path>
          );
        })}
      </svg>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Lagos, Kano and Rivers are live. The other 34 states are simulated in the background for national prices and presidential votes.
      </p>
      <div className="card" style={{ boxShadow: 'none' }}>
        <svg viewBox={`0 0 ${STATE_W} ${STATE_H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="group" aria-label={`Map of ${stateById(state).name}`}>
          <path d={geo.d} fill={stateById(state).colour} fillOpacity="0.35" stroke="#1f1d1a" strokeWidth="2.5" />
          {Object.entries(geo.lgas).map(([id, p]) => (
            <g key={id} onClick={() => setLga(id)} style={{ cursor: 'pointer' }} role="button" aria-label={lgaById(id).name}>
              <line x1={p.x} y1={p.y} x2={p.lx} y2={p.ly} stroke="#1f1d1a" strokeWidth="1.5" />
              <circle cx={p.x} cy={p.y} r="5" fill="#1f1d1a" />
              <rect x={p.lx - 52} y={p.ly - 15} width="104" height="30" rx="15" fill={id === lga ? '#f2b705' : '#fffaf0'} stroke="#1f1d1a" strokeWidth="2.5" />
              <text x={p.lx} y={p.ly + 5} textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="var(--body)">
                {lgaById(id).nick.length > 12 ? lgaById(id).name.split(' ')[0] : lgaById(id).nick}
              </text>
              {id === g.player.home && <text x={p.lx + 46} y={p.ly - 12} fontSize="18">🏠</text>}
            </g>
          ))}
        </svg>
      </div>
      <div>
        <div className="card-title">
          {l.name} <span className="muted" style={{ fontSize: 14 }}>· {l.nick}</span>
        </div>
        <p style={{ margin: '4px 0 6px', fontSize: 13.5 }}>{l.blurb}</p>
        <table className="table">
          <tbody>
            <tr>
              <td>Landmarks</td>
              <td className="r">{l.landmark}</td>
            </tr>
            <tr>
              <td>Chairman</td>
              <td className="r">
                {chair.leader === g.me ? 'You' : g.people[chair.leader].name} ({chair.party}) · approval {Math.round(chair.approval)}
              </td>
            </tr>
            <tr>
              <td>One-bedroom flat</td>
              <td className="r num">{naira(g.rent[lga])}/yr</td>
            </tr>
            <tr>
              <td>Bus fare</td>
              <td className="r num">₦{Math.round(g.fares[lga])}</td>
            </tr>
            <tr>
              <td>Roads · Security · Sanitation</td>
              <td className="r num">
                {Math.round(sv.roads)} · {Math.round(sv.security)} · {Math.round(sv.sanitation)}
              </td>
            </tr>
            <tr>
              <td>Okada</td>
              <td className="r">{okadaBanned(g, lga) ? 'Banned' : 'Allowed'}</td>
            </tr>
            <tr>
              <td>Trader earns / week</td>
              <td className="r num">{naira(tradeIncome(g, lga, 'trader').income)}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12.5 }}>Travel from any motor park. Council elections happen in week {ELECTION_WEEK.lga + 1} of each year.</p>
      </div>
    </div>
  );
}

