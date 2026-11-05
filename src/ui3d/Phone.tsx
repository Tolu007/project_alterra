import { BIZ, WAGES, bizType } from '../data/businesses';
import { PERKS, tradeById, type PlaceId } from '../data/trades';
import { lgaById } from '../data/world';
import { businessValue, demandFor, playerBusinesses, staffCap, wageWeekly } from '../engine/business';
import { DAY_NAMES, clockLabel, dateLabel, dayPart } from '../engine/calendar';
import { KIND_NAMES } from '../engine/culture';
import { hasPerk, naira, perksOf } from '../engine/life';
import type { Game } from '../engine/types';
import { Sparkline } from '../ui/charts';
import { EconomyPanel, GovernmentPanel, LifePanel, MapPanel, NewsPanel, PeoplePanel } from '../ui/Panels';
import { TravelApp } from './Travel';

export type AppId = 'home' | 'travel' | 'alerts' | 'business' | 'prices' | 'gov' | 'contacts' | 'news' | 'map' | 'me';

const APPS: { id: Exclude<AppId, 'home'>; name: string; icon: string; color: string }[] = [
  { id: 'travel', name: 'Travel', icon: '🚌', color: '#c2552d' },
  { id: 'alerts', name: 'Bank', icon: '🏦', color: '#1e8f5a' },
  { id: 'business', name: 'Business', icon: '🏪', color: '#f2b705' },
  { id: 'prices', name: 'Prices', icon: '📈', color: '#2f63ad' },
  { id: 'gov', name: 'Gov', icon: '🏛️', color: '#7b3fa0' },
  { id: 'contacts', name: 'Contacts', icon: '👥', color: '#e0782a' },
  { id: 'news', name: 'Naija News', icon: '📰', color: '#d23c22' },
  { id: 'map', name: 'Map', icon: '🗺️', color: '#0f7c84' },
  { id: 'me', name: 'Me', icon: '🙂', color: '#1f1d1a' },
];

interface Props {
  g: Game;
  app: AppId;
  setApp: (a: AppId) => void;
  onClose: () => void;
  onWalk: (place: PlaceId) => void;
  /** Take a trip from the travel app. */
  onBook: (id: string) => void;
}

export function Phone({ g, app, setApp, onClose, onWalk, onBook }: Props) {
  const current = APPS.find((a) => a.id === app);
  return (
    <div className="phone-overlay" onClick={onClose}>
      <div className="phone" role="dialog" aria-label="Your phone" onClick={(e) => e.stopPropagation()}>
        <div className="phone-status">
          <span>{clockLabel(g.minute)}</span>
          <span className="notch" aria-hidden="true" />
          <span title="Battery is your energy">
            ▂▄▆ {Math.round(g.player.energy)}%🔋
          </span>
        </div>
        <div className="phone-bar">
          {app !== 'home' ? (
            <button className="phone-back" onClick={() => setApp('home')}>
              ‹ Apps
            </button>
          ) : (
            <span className="phone-greet">Good {dayPart(g.minute) === 'night' ? 'evening' : dayPart(g.minute)}</span>
          )}
          <b>{current?.name ?? ''}</b>
          <button className="phone-back" onClick={onClose} aria-label="Close phone">
            ✕
          </button>
        </div>
        <div className="phone-screen">
          {app === 'home' && (
            <div className="app-grid">
              {APPS.map((a) => (
                <button key={a.id} className="app-icon" onClick={() => setApp(a.id)}>
                  <span style={{ background: a.color }}>{a.icon}</span>
                  {a.name}
                </button>
              ))}
              <div className="phone-widget">
                <div className="kicker">This week</div>
                <div className="widget-money">{naira(g.player.week.reduce((s, l) => s + l.amount, 0))}</div>
                <div className="kicker">{dateLabel(g.week, g.day)}</div>
              </div>
            </div>
          )}
          {app === 'travel' && <TravelApp g={g} onWalk={onWalk} onBook={onBook} />}
          {app === 'alerts' && <Alerts g={g} />}
          {app === 'business' && <BusinessApp g={g} onWalk={onWalk} />}
          {app === 'prices' && <EconomyPanel g={g} />}
          {app === 'gov' && <GovernmentPanel g={g} />}
          {app === 'contacts' && <PeoplePanel g={g} />}
          {app === 'news' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <WhatsOn g={g} onWalk={onWalk} />
              <NewsPanel g={g} />
            </div>
          )}
          {app === 'map' && <MapPanel g={g} />}
          {app === 'me' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <Perks g={g} />
              <LifePanel g={g} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** This week's premieres, concerts, matches and parties. */
function WhatsOn({ g, onWalk }: { g: Game; onWalk: (place: PlaceId) => void }) {
  const items = g.culture.filter((e) => e.week === g.week && (e.day > g.day || (e.day === g.day && e.end > g.minute))).sort((a, b) => a.day - b.day || a.start - b.start);
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 6 }}>What’s on this week</div>
      {items.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing else this week. Check again on Monday.</p>}
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map((e) => {
          const here = e.lga === g.player.at || e.lga === '*';
          return (
            <div key={e.id} className="biz-card" style={{ gap: 2 }}>
              <div className="kicker">
                {KIND_NAMES[e.kind]} · {e.day === g.day ? 'Today' : DAY_NAMES[e.day]} {clockLabel(e.start)} · {e.lga === '*' ? 'every viewing centre' : lgaById(e.lga).nick}
              </div>
              <b>{e.title}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {e.star}. {e.ticket ? naira(e.ticket) : 'Free'}
                {e.attended ? ' · you went' : ''}
              </span>
              {here && !e.attended && (
                <button className="btn btn-small" style={{ justifySelf: 'start', marginTop: 4 }} onClick={() => onWalk(e.place)}>
                  Go there
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What your job gives you besides pay, or what you give up as your own boss. */
function Perks({ g }: { g: Game }) {
  const t = tradeById(g.player.trade);
  const perks = perksOf(g.player.trade);
  return (
    <div className="biz-card">
      <b>{t.kind === 'salary' ? `Your job: ${t.name}` : 'You are your own boss'}</b>
      {perks.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>No HMO, no pension, no 13th month. You pay your own clinic bills. Your upside is your business.</span>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {perks.map((k) => (
            <div key={k} className="ledger-line">
              <span>
                <b>{PERKS[k].name}</b> · {PERKS[k].detail}
              </span>
              <span className={hasPerk(g, k) ? 'good' : 'bad'}>{hasPerk(g, k) ? 'Active' : 'Lapsed'}</span>
            </div>
          ))}
        </div>
      )}
      <div className="ledger-line" style={{ borderBottom: 'none' }}>
        <span>Pension savings (RSA)</span>
        <span className="num">{naira(g.player.pension)}</span>
      </div>
    </div>
  );
}

/** Credit and debit alerts, the way every Nigerian phone shows money. */
function Alerts({ g }: { g: Game }) {
  const items = [...g.player.week.map((l) => ({ ...l, when: 'This week' })), ...g.player.lastWeek.map((l) => ({ ...l, when: 'Last week' }))].filter((l) => Math.abs(l.amount) >= 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="balance-card">
        <div className="kicker" style={{ color: '#cfe8da' }}>
          Available balance
        </div>
        <div className="balance">{naira(g.player.money)}</div>
        {g.player.loan > 0 && <div style={{ fontSize: 12 }}>Loan outstanding: {naira(g.player.loan)}</div>}
      </div>
      {items.length === 0 && <p className="muted">No alerts yet.</p>}
      {items.map((l, i) => (
        <div key={i} className={`alert ${l.amount >= 0 ? 'cr' : 'dr'}`}>
          <b>{l.amount >= 0 ? 'Credit Alert' : 'Debit Alert'}</b>
          <span className="num">{naira(Math.abs(l.amount))}</span>
          <span className="alert-desc">
            {l.label} · {l.when}
          </span>
        </div>
      ))}
    </div>
  );
}

function BusinessApp({ g, onWalk }: { g: Game; onWalk: (p: PlaceId) => void }) {
  const mine = playerBusinesses(g);
  const total = mine.reduce((s, b) => s + b.lastProfit, 0);
  const soFar = mine.reduce((s, b) => s + b.week.profit, 0);
  const staff = mine.reduce((s, b) => s + b.staff.length, 0);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="tile">
          <div className="kicker">Businesses</div>
          <div className="tile-value">{mine.length}</div>
        </div>
        <div className="tile">
          <div className="kicker">Staff</div>
          <div className="tile-value">{staff}</div>
        </div>
        <div className="tile">
          <div className="kicker">This week so far</div>
          <div className={`tile-value ${soFar >= 0 ? 'good' : 'bad'}`}>{naira(soFar)}</div>
        </div>
        <div className="tile">
          <div className="kicker">Last week</div>
          <div className={`tile-value ${total >= 0 ? 'good' : 'bad'}`}>{naira(total)}</div>
        </div>
      </div>
      {mine.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Takings land every night, whether or not you went to work. Staff work harder on days you come in.</p>}
      {mine.length === 0 && <p className="muted" style={{ margin: 0 }}>You don’t own a business yet. Lease a plot marked PLOT FOR LEASE and open one, or buy an okada or keke at the motor park.</p>}
      {mine.map((b) => {
        const t = bizType(b.type);
        const suppliers = mine.filter((x) => bizType(x.type).feeds.includes(b.type) && lgaById(x.lga).state === lgaById(b.lga).state);
        const customers = mine.filter((x) => t.feeds.includes(x.type) && lgaById(x.lga).state === lgaById(b.lga).state);
        return (
          <div key={b.id} className="biz-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div>
                <b>{b.name}</b>
                <div className="kicker">
                  {t.kind === 'supplier' ? 'Supplier' : t.kind === 'consumer' ? 'Serves the public' : 'Starter'} · level {b.level} · {b.staff.length}/{staffCap(b)} staff
                </div>
              </div>
              <Sparkline values={b.history.length > 1 ? b.history : [0, b.lastProfit]} width={70} />
            </div>
            {b.last.map((l) => (
              <div key={l.label} className="ledger-line">
                <span>{l.label}</span>
                <span className={`num ${l.amount >= 0 ? 'good' : 'bad'}`}>{naira(l.amount)}</span>
              </div>
            ))}
            <div className="ledger-line" style={{ fontWeight: 800, borderBottom: 'none' }}>
              <span>Profit last week</span>
              <span className={`num ${b.lastProfit >= 0 ? 'good' : 'bad'}`}>{naira(b.lastProfit)}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Pay: {WAGES[b.wage].name} ({naira(wageWeekly(g, b))}/week each) · demand {Math.round(demandFor(g, b) * 100)} · worth ~{naira(businessValue(g, b))}
              {b.financeWeeks > 0 && ` · ${b.financeWeeks} weeks of remittance left`}
            </div>
            {(suppliers.length > 0 || customers.length > 0) && (
              <div className="chain">
                {suppliers.length > 0 && <span>⬅ Supplied by your {suppliers.map((s) => bizType(s.type).name.toLowerCase()).join(', ')} (cheaper inputs)</span>}
                {customers.length > 0 && <span>➡ Supplies your {customers.map((s) => bizType(s.type).name.toLowerCase()).join(', ')}</span>}
              </div>
            )}
            {b.staff.length > 0 && <div className="muted" style={{ fontSize: 12.5 }}>Team: {b.staff.map((id) => g.people[id].name.split(' ')[0]).join(', ')}</div>}
            {b.lga === g.player.at ? (
              <button className="btn btn-small" onClick={() => onWalk(t.place)}>
                Walk there
              </button>
            ) : (
              <span className="kicker">In {lgaById(b.lga).nick}: travel from a motor park</span>
            )}
          </div>
        );
      })}
      <details>
        <summary className="kicker" style={{ cursor: 'pointer' }}>
          Business ideas and where to open them
        </summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {BIZ.filter((t) => t.kind !== 'starter').map((t) => (
            <div key={t.id} className="idea">
              <b>{t.name}</b> <span className="kicker">· {t.kind === 'supplier' ? 'supplier' : 'consumer'} · at the {t.place}</span>
              <div style={{ fontSize: 12.5 }}>{t.blurb}</div>
              {t.feeds.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Supplies: {t.feeds.map((f) => bizType(f).name.toLowerCase()).join(', ')}</div>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
