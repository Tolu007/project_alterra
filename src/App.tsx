import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { dateLabel } from './engine/calendar';
import { newGame, type NewLife } from './engine/setup';
import { closeElection, continueReport, submitGovern } from './engine/sim';
import type { Game } from './engine/types';
import type { Intent } from './engine/world';
import { api, ApiError, trackVisit, type Account, type WorldUpdate } from './net/api';
import { Auth } from './ui/Auth';
import { Create } from './ui/Create';
import { ElectionModal, Ending, EventModal, GovernModal, WeekReport } from './ui/Modals';
import { loadGame, saveGame } from './ui/save';
import { StatsPage } from './ui/Stats';
import { Title } from './ui/Title';

type Screen = 'title' | 'create' | 'game' | 'auth' | 'online-create' | 'online' | 'stats';

// The 3D world (three.js) is most of the download, so it loads only when you start playing.
const Game3D = lazy(() => import('./ui3d/Game3D').then((m) => ({ default: m.Game3D })));
const preload3D = () => void import('./ui3d/Game3D');

const freshSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
/** How often the screen asks the server for news, in the foreground and when the tab is hidden. */
const POLL_MS = 4_000;
const POLL_HIDDEN_MS = 20_000;

type Net = Omit<WorldUpdate, 'game'> & { game: Game };

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => (location.hash === '#stats' ? 'stats' : 'title'));
  const [game, setGame] = useState<Game | null>(() => loadGame());
  const [account, setAccount] = useState<Account | null>(null);
  const [net, setNet] = useState<Net | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const netRef = useRef(net);
  netRef.current = net;

  useEffect(() => {
    saveGame(game);
  }, [game]);
  // Block bodies on purpose: some browsers return a Promise from scrollTo, which React would treat as a cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
  useEffect(() => {
    trackVisit(location.pathname + location.hash);
    api
      .me()
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null));
  }, []);

  const applyUpdate = useCallback((r: WorldUpdate | (Omit<WorldUpdate, 'game' | 'hasCharacter'> & { same: true })) => {
    if ('same' in r) {
      setNet((n) => (n ? { ...n, serverNow: r.serverNow, lag: r.lag, online: r.online } : n));
      return;
    }
    if (r.game) setNet({ ...r, game: r.game });
  }, []);

  // While you play online, keep the world fresh.
  useEffect(() => {
    if (screen !== 'online') return;
    let stop = false;
    let timer = 0;
    const poll = async () => {
      try {
        applyUpdate(await api.world(netRef.current?.version ?? null));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setAccount(null);
          setScreen('auth');
          return;
        }
      }
      if (!stop) timer = window.setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [screen, applyUpdate]);

  const send = useCallback(
    async (intent: Intent) => {
      try {
        const r = await api.act(intent);
        applyUpdate(r);
        return r.result ?? null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setAccount(null);
          setScreen('auth');
        }
        return null;
      }
    },
    [applyUpdate],
  );

  const goOnline = async (a: Account | null = account) => {
    if (!a) return setScreen('auth');
    if (!a.hasCharacter) {
      preload3D();
      return setScreen('online-create');
    }
    try {
      const r = await api.world(null);
      if ('same' in r || !r.game) return setScreen('online-create');
      applyUpdate(r);
      preload3D();
      setScreen('online');
    } catch {
      setScreen('auth');
    }
  };

  if (screen === 'stats') return <StatsPage onBack={() => ((location.hash = ''), setScreen('title'))} />;

  if (screen === 'auth') {
    return (
      <Auth
        onBack={() => setScreen('title')}
        onDone={(a) => {
          setAccount(a);
          void goOnline(a);
        }}
      />
    );
  }

  if (screen === 'online-create' && account) {
    return (
      <Create
        online
        fixedName={account.name}
        error={joinError}
        onBack={() => setScreen('title')}
        onStart={async (life: NewLife) => {
          setJoinError(null);
          try {
            const r = await api.join({ gender: life.gender, looks: life.looks, home: life.home, start: life.start });
            applyUpdate(r);
            setAccount({ ...account, hasCharacter: true });
            setScreen('online');
          } catch (e) {
            setJoinError(e instanceof Error ? e.message : 'Could not join the world.');
          }
        }}
      />
    );
  }

  if (screen === 'online' && net) {
    const g = net.game;
    if (g.phase === 'over') return <Ending g={g} onNew={() => setScreen('online-create')} />;
    return (
      <>
        <Suspense fallback={<div className="loading-3d">Loading the street…</div>}>
          <Game3D
            g={g}
            setGame={(next) => setNet((n) => (n ? { ...n, game: next } : n))}
            onQuit={() => setScreen('title')}
            online={{ send, serverNow: net.serverNow, lag: net.lag, rate: net.rate, count: net.online }}
          />
        </Suspense>
        {g.phase === 'week' && g.report && <WeekReport g={g} onContinue={() => void send({ kind: 'report' })} />}
        {g.phase === 'event' && g.currentEvent && <EventModal g={g} setGame={() => {}} onChoose={(i) => void send({ kind: 'event', choice: i })} onDone={() => void send({ kind: 'eventDone' })} />}
        {g.phase === 'govern' && <GovernModal g={g} onSubmit={(plan) => void send({ kind: 'govern', plan })} />}
        {g.phase === 'election' && g.showElection !== null && <ElectionModal g={g} onClose={() => void send({ kind: 'electionDone' })} />}
      </>
    );
  }

  if (screen === 'create') {
    preload3D();
    return (
      <Create
        onBack={() => setScreen('title')}
        onStart={(life: NewLife) => {
          setGame(newGame(life, freshSeed()));
          setScreen('game');
        }}
      />
    );
  }

  if (screen !== 'game' || !game) {
    return (
      <Title
        saved={game && game.phase !== 'over' ? dateLabel(game.week, game.day).split(' · ')[1] : null}
        account={account}
        onNew={() => setScreen('create')}
        onContinue={() => setScreen('game')}
        onOnline={() => void goOnline()}
        onLogout={() => {
          void api.logout().finally(() => {
            setAccount(null);
            setNet(null);
          });
        }}
        onStats={() => ((location.hash = 'stats'), setScreen('stats'))}
      />
    );
  }

  if (game.phase === 'over') {
    return (
      <Ending
        g={game}
        onNew={() => {
          setGame(null);
          setScreen('create');
        }}
      />
    );
  }

  return (
    <>
      <Suspense fallback={<div className="loading-3d">Loading the street…</div>}>
        <Game3D g={game} setGame={setGame} onQuit={() => setScreen('title')} />
      </Suspense>
      {game.phase === 'week' && game.report && <WeekReport g={game} onContinue={() => setGame(continueReport(game))} />}
      {game.phase === 'event' && game.currentEvent && <EventModal g={game} setGame={setGame} />}
      {game.phase === 'govern' && <GovernModal g={game} onSubmit={(plan) => setGame(submitGovern(game, plan))} />}
      {game.phase === 'election' && game.showElection !== null && <ElectionModal g={game} onClose={() => setGame(closeElection(game))} />}
    </>
  );
}
