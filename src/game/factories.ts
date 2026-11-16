import { EnemyManager } from '../sim/enemies';
import { Director } from '../sim/director';
import type { RunFactories } from './run';

/** Real enemy/director implementations (kept apart so run.ts is testable with fakes). */
export const DEFAULT_FACTORIES: RunFactories = {
  createEnemies: (level, phys, rng, emit) => new EnemyManager(level, phys, rng, emit),
  createDirector: (level, enemies, rng, emit) => new Director(level, enemies as EnemyManager, rng, emit),
};
