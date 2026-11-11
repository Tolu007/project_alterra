import { useCallback, useEffect, useState } from 'react';
import { sound } from './sound';

// The first ten minutes: a short list of things to try, ticked off as you do them. It is only a
// helper on the screen: nothing in the game depends on it, and you can skip it.

export type GuideStep = 'go' | 'work' | 'eat' | 'talk' | 'map' | 'phone';

const STEPS: { id: GuideStep; title: string; hint: string }[] = [
  { id: 'go', title: 'Go somewhere', hint: 'Tap 🗺️ Places and pick one, or tap any building or street. Blue dots show the way.' },
  { id: 'work', title: 'Earn some money', hint: 'Go to your business or your workplace (it is at the top of Places) and work a shift.' },
  { id: 'eat', title: 'Eat something', hint: 'Watch the Food bar. Cook at home, or eat at a mama put in the market.' },
  { id: 'talk', title: 'Greet a neighbour', hint: 'Tap anyone with a name over their head to gist with them.' },
  { id: 'map', title: 'Open the big map', hint: 'Tap ＋ on the map to see the whole district, then tap anywhere to go there.' },
  { id: 'phone', title: 'Check your phone', hint: '📱 has travel, your bank alerts, prices, the news and your businesses.' },
];

interface Saved {
  done: GuideStep[];
  closed: boolean;
}

const read = (key: string): Saved | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};

/**
 * Keeps track of the getting-started list for one life (`key`). New lives (`fresh`) start it; lives already
 * under way when it was added never see it.
 */
export function useGuide(key: string, fresh: boolean, skip: GuideStep[] = []) {
  const [state, setState] = useState<Saved | null>(() => read(key) ?? (fresh ? { done: [], closed: false } : null));
  useEffect(() => {
    setState(read(key) ?? (fresh ? { done: [], closed: false } : null));
    // Only when you switch to another life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const save = useCallback(
    (next: Saved) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // No storage (private window): the list still works until you leave.
      }
      return next;
    },
    [key],
  );
  const mark = useCallback((id: GuideStep) => setState((s) => (!s || s.closed || s.done.includes(id) ? s : save({ ...s, done: [...s.done, id] }))), [save]);
  const close = useCallback(() => setState((s) => (s ? save({ ...s, closed: true }) : s)), [save]);
  const steps = STEPS.filter((s) => !skip.includes(s.id));
  return { state, steps, mark, close };
}

export function Guide({ guide }: { guide: ReturnType<typeof useGuide> }) {
  const { state, steps, close } = guide;
  const [open, setOpen] = useState(true);
  const finished = !!state && !state.closed && steps.every((s) => state.done.includes(s.id));
  useEffect(() => {
    if (finished) sound.play('done');
  }, [finished]);
  if (!state || state.closed) return null;
  const left = steps.filter((s) => !state.done.includes(s.id));
  const next = left[0];
  const done = steps.length - left.length;
  if (!next) {
    return (
      <div className="guide guide-done" role="status">
        <div className="guide-head">
          <b>🎉 You know your way around</b>
        </div>
        <p className="guide-hint">Now hustle: grow your business, save, and maybe run for office one day.</p>
        <button className="btn btn-small btn-danfo" onClick={close}>
          Let’s go
        </button>
      </div>
    );
  }
  return (
    <div className={`guide${open ? '' : ' shut'}`} role="region" aria-label="Getting started">
      <div className="guide-head">
        <button className="guide-fold" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? 'Fold away' : 'Show the list'}>
          <b>Getting started</b>
          <span className="guide-count">
            {done}/{steps.length}
          </span>
        </button>
        <button className="guide-skip" onClick={close} title="Hide this list for good">
          Skip
        </button>
      </div>
      {open && (
        <ol className="guide-list">
          {steps.map((s) => {
            const ok = state.done.includes(s.id);
            return (
              <li key={s.id} className={ok ? 'ok' : s.id === next.id ? 'now' : ''}>
                <i aria-hidden="true">{ok ? '✓' : ''}</i>
                <span>{s.title}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="guide-hint">
        {!open && <b>{next.title}: </b>}
        {next.hint}
      </p>
    </div>
  );
}
