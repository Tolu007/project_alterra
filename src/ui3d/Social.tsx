import { useEffect, useMemo, useRef, useState } from 'react';
import { bizType } from '../data/businesses';
import { lgaById } from '../data/world';
import { businessValue, playerBusinesses, staffCap } from '../engine/business';
import { officeTitle } from '../engine/elections';
import { naira } from '../engine/life';
import type { ChatMsg, Offer, Social } from '../engine/social';
import type { Game } from '../engine/types';
import type { Intent } from '../engine/world';

// The other players: talk on the street or in private, send money, make deals, see who is on top.
// Online only. Everything goes to the server as a request; the answer comes back with the world.

export type SocialTab = 'street' | 'people' | 'deals' | 'top';

interface Props {
  g: Game;
  tab: SocialTab;
  setTab: (t: SocialTab) => void;
  /** The player whose conversation is open on the People tab. */
  peer: number | null;
  setPeer: (id: number | null) => void;
  send: (intent: Intent) => Promise<{ ok: boolean; text: string } | null>;
  onClose: () => void;
}

const EMPTY: Social = { next: 1, chat: [], offers: [], jobs: [], debts: [], endorsed: {} };
const SEEN = 'nh-chat-seen';

/** How many messages and offers have come in since you last looked. */
export function unreadSocial(g: Game): number {
  const s = g.social ?? EMPTY;
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(`${SEEN}:${g.me}`) ?? 0);
  } catch {
    // No storage: everything counts as new.
  }
  return s.chat.filter((m) => m.id > seen && m.from !== g.me).length + s.offers.filter((o) => o.to === g.me && o.id > seen).length;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function SocialPanel({ g, tab, setTab, peer, setPeer, send, onClose }: Props) {
  const s = g.social ?? EMPTY;
  const [text, setText] = useState('');
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState<'pay' | 'buy' | 'sell' | 'job' | 'loan' | null>(null);
  const [amount, setAmount] = useState('');
  const [repay, setRepay] = useState('');
  const [weeks, setWeeks] = useState('4');
  const [biz, setBiz] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const name = (id: number) => g.people[id]?.name ?? 'Someone';
  const others = g.others ?? [];
  const here = g.player.at;

  // Looking at the panel marks everything read.
  useEffect(() => {
    try {
      localStorage.setItem(`${SEEN}:${g.me}`, String(s.next - 1));
    } catch {
      // Nothing to remember it in.
    }
  }, [s.next, g.me]);

  const street = useMemo(() => s.chat.filter((m) => m.to === null), [s.chat]);
  const thread = useMemo(() => (peer === null ? [] : s.chat.filter((m) => m.to !== null && (m.from === peer || m.to === peer || (m.from === -1 && m.to === g.me)))), [s.chat, peer, g.me]);
  const shown = tab === 'street' ? street : thread;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [shown.length, tab, peer]);

  const ask = async (intent: Intent, clear = true) => {
    const r = await send(intent);
    if (!r) return setNote({ text: 'Could not reach the game server.', ok: false });
    if (r.text) setNote({ text: r.text, ok: r.ok });
    else setNote(null);
    if (r.ok && clear) {
      setForm(null);
      setAmount('');
      setRepay('');
    }
  };
  const say = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void ask({ kind: 'chat', text: t, to: tab === 'street' ? null : peer }, false);
  };

  const mine = playerBusinesses(g);
  const theirs = peer === null ? [] : g.businesses.filter((b) => b.owner === peer);
  const n = Number(amount.replace(/[^\d]/g, ''));
  const submit = () => {
    if (peer === null || !form) return;
    if (form === 'pay') return void ask({ kind: 'pay', to: peer, amount: n });
    if (form === 'loan') return void ask({ kind: 'offer', to: peer, offer: { type: 'loan', amount: n, repay: Number(repay.replace(/[^\d]/g, '')) || n, weeks: Number(weeks) || 4 } });
    const list = form === 'buy' ? theirs : mine;
    const id = biz ?? list[0]?.id;
    if (id === undefined) return setNote({ text: form === 'buy' ? 'They have no business to buy.' : 'You have no business for that.', ok: false });
    void ask({ kind: 'offer', to: peer, offer: { type: form, business: id, amount: n } });
  };
  const openForm = (f: typeof form) => {
    setForm(form === f ? null : f);
    setBiz(null);
    setNote(null);
    const list = f === 'buy' ? theirs : mine;
    // Start from a fair figure: what the business is worth, or a week's pay.
    setAmount(f === 'buy' || f === 'sell' ? String(list[0] ? Math.round(businessValue(g, list[0]) / 1000) * 1000 : '') : f === 'job' ? '20000' : '');
  };

  const line = (m: ChatMsg) => (
    <div key={m.id} className={`chat-line${m.from === g.me ? ' me' : m.from === -1 ? ' sys' : ''}`}>
      {m.from !== -1 && m.from !== g.me && (
        <button className="chat-who" onClick={() => (setTab('people'), setPeer(m.from))} title="Open a private chat">
          {name(m.from).split(' ')[0]}
        </button>
      )}
      <span className="chat-text">{m.text}</span>
      <span className="chat-time">{hhmm(m.ms)}</span>
    </div>
  );

  const offerText = (o: Offer) => {
    const b = g.businesses.find((x) => x.id === o.business);
    const who = name(o.from === g.me ? o.to : o.from).split(' ')[0];
    const out = o.from === g.me;
    switch (o.type) {
      case 'buy':
        return out ? `You offered ${who} ${naira(o.amount)} for ${b?.name}` : `${who} offers ${naira(o.amount)} for your ${b?.name}`;
      case 'sell':
        return out ? `You offered ${who} your ${b?.name} for ${naira(o.amount)}` : `${who} will sell you ${b?.name} for ${naira(o.amount)}`;
      case 'job':
        return out ? `You offered ${who} a job at ${b?.name}: ${naira(o.amount)} a week` : `${who} offers you a job at ${b?.name}: ${naira(o.amount)} a week`;
      case 'loan':
        return out ? `You offered to lend ${who} ${naira(o.amount)} (back: ${naira(o.repay ?? o.amount)} in ${o.weeks}w)` : `${who} will lend you ${naira(o.amount)}; pay back ${naira(o.repay ?? o.amount)} in ${o.weeks} weeks`;
    }
  };

  const peerSeat = others.find((o) => o.id === peer);
  const deals = s.offers.length + s.jobs.length + s.debts.length;
  return (
    <div className="social" role="dialog" aria-label="Other players">
      <div className="social-head">
        <div className="social-tabs" role="tablist">
          {(
            [
              ['street', `💬 ${lgaById(here).nick}`],
              ['people', `👥 Players${others.length ? ` (${others.length})` : ''}`],
              ['deals', `🤝 Deals${deals ? ` (${deals})` : ''}`],
              ['top', '🏆 Top'],
            ] as [SocialTab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <button className="x-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {tab === 'people' && peer === null && (
        <div className="social-body">
          {others.length === 0 && <p className="muted">Nobody else has joined this world yet. Share the link.</p>}
          {others.map((o) => (
            <button key={o.id} className="player-row" onClick={() => setPeer(o.id)}>
              <span className={`dot${o.online ? ' on' : ''}`} aria-hidden="true" />
              <b>{name(o.id)}</b>
              <span className="muted">
                {lgaById(o.at).nick}
                {o.at === here ? ' · here' : ''} · {o.asleep ? 'asleep' : o.online ? 'online' : 'away'}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === 'people' && peer !== null && (
        <div className="peer-bar">
          <button className="btn btn-small" onClick={() => (setPeer(null), setForm(null))}>
            ← All
          </button>
          <b>{name(peer)}</b>
          <span className="muted">{peerSeat ? `${lgaById(peerSeat.at).nick} · ${peerSeat.online ? 'online' : 'away'}` : ''}</span>
        </div>
      )}

      {(tab === 'street' || (tab === 'people' && peer !== null)) && (
        <>
          <div className="social-body chat-log">
            {shown.length === 0 && <p className="muted">{tab === 'street' ? `Nobody has said anything in ${lgaById(here).nick} yet. Players here will see what you write.` : 'No messages yet. Say hello.'}</p>}
            {shown.map(line)}
            <div ref={end} />
          </div>
          {tab === 'people' && (
            <div className="peer-acts">
              {(
                [
                  ['pay', '💸 Send money'],
                  ['loan', '🏦 Lend'],
                  ['job', '💼 Offer a job'],
                  ['buy', '🏪 Buy their business'],
                  ['sell', '🏷️ Sell them mine'],
                ] as ['pay' | 'buy' | 'sell' | 'job' | 'loan', string][]
              ).map(([id, label]) => (
                <button key={id} className={`chip${form === id ? ' on' : ''}`} onClick={() => openForm(id)}>
                  {label}
                </button>
              ))}
              <button className="chip" onClick={() => void ask({ kind: 'endorse', to: peer! })} title="Back their campaign: your standing rubs off on them">
                🗳️ Endorse
              </button>
            </div>
          )}
          {tab === 'people' && form && (
            <div className="peer-form">
              {(form === 'buy' || form === 'sell' || form === 'job') && (
                <select value={biz ?? ''} onChange={(e) => setBiz(Number(e.target.value))} aria-label="Which business">
                  {(form === 'buy' ? theirs : mine).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {bizType(b.type).name} · worth {naira(businessValue(g, b))}
                      {form === 'job' ? ` · ${b.staff.length}/${staffCap(b)} staff` : ''}
                    </option>
                  ))}
                  {(form === 'buy' ? theirs : mine).length === 0 && <option value="">{form === 'buy' ? 'They have no business' : 'You have no business'}</option>}
                </select>
              )}
              <label>
                {form === 'job' ? 'Weekly wage ₦' : form === 'pay' ? 'Amount ₦' : form === 'loan' ? 'Lend ₦' : 'Price ₦'}
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </label>
              {form === 'loan' && (
                <>
                  <label>
                    Pay back ₦
                    <input inputMode="numeric" value={repay} onChange={(e) => setRepay(e.target.value)} placeholder={String(n || 0)} />
                  </label>
                  <label>
                    Weeks
                    <input inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} style={{ width: 54 }} />
                  </label>
                </>
              )}
              <button className="btn btn-small btn-danfo" onClick={submit} disabled={!n}>
                {form === 'pay' ? 'Send' : 'Make offer'}
              </button>
            </div>
          )}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              say();
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={240} placeholder={tab === 'street' ? `Say something to ${lgaById(here).nick}…` : `Message ${name(peer!).split(' ')[0]}…`} aria-label="Your message" />
            <button className="btn btn-small btn-danfo" type="submit" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </>
      )}

      {tab === 'deals' && (
        <div className="social-body">
          {deals === 0 && <p className="muted">No deals yet. Open a player’s chat to send money, lend, offer a job, or buy and sell a business.</p>}
          {s.offers.map((o) => (
            <div key={o.id} className="deal">
              <span>{offerText(o)}</span>
              {o.to === g.me ? (
                <span className="deal-acts">
                  <button className="btn btn-small btn-danfo" onClick={() => void ask({ kind: 'answer', offer: o.id, accept: true })}>
                    Accept
                  </button>
                  <button className="btn btn-small" onClick={() => void ask({ kind: 'answer', offer: o.id, accept: false })}>
                    Decline
                  </button>
                </span>
              ) : (
                <button className="btn btn-small" onClick={() => void ask({ kind: 'withdraw', offer: o.id })}>
                  Withdraw
                </button>
              )}
            </div>
          ))}
          {s.jobs.map((j) => {
            const b = g.businesses.find((x) => x.id === j.business);
            const boss = j.worker !== g.me;
            return (
              <div key={`j${j.business}:${j.worker}`} className="deal">
                <span>{boss ? `${name(j.worker)} works at your ${b?.name}: ${naira(j.wage)} a week` : `You work at ${b?.name} for ${name(b?.owner ?? -1)}: ${naira(j.wage)} a week`}</span>
                <button className="btn btn-small" onClick={() => void ask({ kind: 'endJob', business: j.business, worker: j.worker })}>
                  {boss ? 'Let go' : 'Resign'}
                </button>
              </div>
            );
          })}
          {s.debts.map((d, i) => (
            <div key={`d${i}`} className="deal">
              <span>{d.to === g.me ? `You owe ${name(d.from)} ${naira(d.owed)}, due week ${d.due + 1}` : `${name(d.to)} owes you ${naira(d.owed)}, due week ${d.due + 1}`}</span>
              {d.to === g.me && (
                <button className="btn btn-small btn-danfo" onClick={() => void ask({ kind: 'repay', to: d.from, amount: d.owed })} disabled={g.player.money < 100}>
                  Repay
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'top' && (
        <div className="social-body">
          <table className="board">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Net worth</th>
                <th>Businesses</th>
              </tr>
            </thead>
            <tbody>
              {(s.board ?? []).map((r, i) => (
                <tr key={r.id} className={r.id === g.me ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <b>{r.name}</b>
                    <div className="muted">{r.office ? `🏛️ ${officeTitle(r.office)}` : lgaById(r.at).nick}</div>
                  </td>
                  <td>{naira(r.worth)}</td>
                  <td>
                    {r.businesses}
                    {r.staff ? ` · ${r.staff} staff` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {note && <div className={`social-note${note.ok ? '' : ' bad'}`}>{note.text}</div>}
    </div>
  );
}
