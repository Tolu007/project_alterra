import { lazy, Suspense, useEffect, useState } from 'react';
import { dateLabel } from './engine/calendar';
import { newGame, type NewLife } from './engine/setup';
import { closeElection, continueReport, submitGovern } from './engine/sim';
import type { Game } from './engine/types';
import { Create } from './ui/Create';
import { ElectionModal, Ending, EventModal, GovernModal, WeekReport } from './ui/Modals';
import { loadGame, saveGame } from './ui/save';
import { Title } from './ui/Title';

type Screen = 'title' | 'create' | 'game';

// The 3D world (three.js) is most of the download, so it loads only when you start playing.
const Game3D = lazy(() => import('./ui3d/Game3D').then((m) => ({ default: m.Game3D })));
const preload3D = () => void import('./ui3d/Game3D');

const freshSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [game, setGame] = useState<Game | null>(() => loadGame());

  useEffect(() => {
    saveGame(game);
  }, [game]);
  // Block bodies on purpose: some browsers return a Promise from scrollTo, which React would treat as a cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

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

  if (screen === 'title' || !game) {
    return <Title saved={game && game.phase !== 'over' ? dateLabel(game.week, game.day).split(' · ')[1] : null} onNew={() => setScreen('create')} onContinue={() => setScreen('game')} />;
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
