// Small doors into the engine for tests.
import { holdElection } from './elections';
import type { Game } from './types';

export const holdElectionForTest = (g: Game, office: string) => holdElection(g, office);
