import { afterEach, describe, expect, it } from 'vitest';
import { REFINERY } from '../src/content/level';
import { Run } from '../src/game/run';
import { DEFAULT_FACTORIES } from '../src/game/factories';
import { Bot, type PactPolicy } from '../src/game/bot';
import type { InputSample } from '../src/input/input';
import type { GameEvent } from '../src/sim/types';

const BASE: InputSample = {
  moveX: 0, moveZ: 0, fireHeld: false, firePressed: false, jump: false, dash: false, reload: false,
  slot1: false, slot2: false, backup: false, interactPressed: false, interactHeld: false, yaw: 0, pitch: 0,
};

interface Result {
  outcome: string | null;
  finished: boolean;
  time: number;
  offers: string[][];
  picks: string[];
  cleared: string[];
  pact: string | null;
  kills: number;
  health: number;
  events: Map<string, number>;
}

/** Assist = a handful of free medkits/ammo crates, standing in for a human's better target selection. */
function playRun(seed: string, policy: PactPolicy, assist = true, maxSeconds = 25 * 60): Promise<Result> {
  return Run.create({ level: REFINERY, seed, starter: 'coil_carbine' }, DEFAULT_FACTORIES).then((run) => {
    activeRun = run;
    const bot = new Bot(policy, REFINERY.playerStart.yaw);
    const offers: string[][] = [];
    const picks: string[] = [];
    const counts = new Map<string, number>();
    const take = (evs: GameEvent[]) => evs.forEach((e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1));
    run.start();
    bot.assistOn = assist;
    let steps = 0;
    while (!run.finished && run.time < maxSeconds && steps < maxSeconds * 60 * 2) {
      steps++;
      if (run.draft) {
        const offer = run.draft.offer;
        offers.push(offer.options.map((o) => o.id));
        const d = bot.pickDraft(offer);
        if (d.action === 'pick') {
          picks.push(offer.options[d.index]!.id);
          run.draftPick(offer.offerId, d.index);
        } else {
          picks.push('skip');
          run.draftSkip(offer.offerId);
        }
        continue;
      }
      const sample = { ...BASE, ...bot.step(run) } as InputSample;
      run.step(sample);
      take(run.drainEvents());
    }
    const r: Result = {
      outcome: run.outcome, finished: run.finished, time: run.time, offers, picks,
      cleared: [...run.director.status.cleared], pact: run.cards.pact, kills: run.kills, health: run.player.health, events: counts,
    };
    run.dispose();
    activeRun = null;
    return r;
  });
}

let activeRun: Run | null = null;
afterEach(() => {
  activeRun?.dispose();
  activeRun = null;
});

const summary = (label: string, r: Result) =>
  `${label}: outcome=${r.outcome} time=${(r.time / 60).toFixed(1)}min cleared=${r.cleared.join(',')} kills=${r.kills} pact=${r.pact} picks=${r.picks.join('|')}`;

describe('autoplayer full runs on the real level', () => {
  for (const policy of ['none', 'coil', 'arc'] as PactPolicy[]) {
    it(`completes a run (pact: ${policy})`, async () => {
      const r = await playRun('AUTOPLAY-1', policy);
      console.log(summary(policy, r));
      expect(r.outcome).toBe('extracted');
      expect(r.finished).toBe(true);
      expect(r.cleared.sort()).toEqual(['approach', 'relay', 'slag', 'yard']);
      expect(r.offers.length).toBe(4); // deployment + three caches
      if (policy === 'none') expect(r.pact).toBeNull();
      else expect(r.pact).toBe(policy === 'coil' ? 'coil_carbine' : 'arc_scattergun');
    }, 120_000);
  }

  it('reports how the unassisted bot fares (informational)', async () => {
    for (const policy of ['none', 'coil', 'arc'] as PactPolicy[]) {
      const r = await playRun('AUTOPLAY-1', policy, false, 12 * 60);
      console.log(summary(`unassisted ${policy}`, r));
      expect(r.time).toBeGreaterThan(30);
    }
  }, 240_000);

  it('same seed + same picks gives identical offers; different seed differs', async () => {
    const a = await playRun('AUTOPLAY-2', 'coil');
    const b = await playRun('AUTOPLAY-2', 'coil');
    expect(a.offers.length).toBeGreaterThanOrEqual(2);
    expect(b.offers).toEqual(a.offers);
    expect(b.picks).toEqual(a.picks);
    const c = await playRun('AUTOPLAY-OTHER', 'coil');
    expect(c.offers[0]).not.toEqual(a.offers[0]);
  }, 240_000);
});
