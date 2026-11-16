import { describe, expect, it } from 'vitest';
import { CARDS, CardState, DraftSystem, isEligible, type DraftContext } from '../src/sim/cards';
import { Rng } from '../src/core/rng';

const mk = (seed = 'S1', equipped: ('coil_carbine' | 'arc_scattergun')[] = ['coil_carbine']) => {
  const state = new CardState(equipped);
  const ctx: DraftContext = { state, salvage: 50, depth: 0 };
  return { d: new DraftSystem(new Rng(seed).fork('draft')), state, ctx };
};

describe('offers', () => {
  it('three distinct options, at least one weapon card', () => {
    for (let i = 0; i < 40; i++) {
      const { d, ctx } = mk('seed' + i);
      const o = d.open(0, ctx);
      expect(o.options).toHaveLength(3);
      expect(new Set(o.options.map((x) => x.id)).size).toBe(3);
      expect(o.options.some((x) => x.kind === 'card' && CARDS.find((c) => c.id === x.id)!.affectsWeapons)).toBe(true);
      expect(o.options.every((x) => x.kind === 'card' && !CARDS.find((c) => c.id === x.id)!.pactWeapon)).toBe(true);
    }
  });

  it('roughly two thirds weapon-affecting over many drafts', () => {
    let weapon = 0, total = 0;
    for (let i = 0; i < 200; i++) {
      const { d, ctx } = mk('r' + i);
      for (const o of d.open(0, ctx).options) {
        total++;
        if (CARDS.find((c) => c.id === o.id)?.affectsWeapons) weapon++;
      }
    }
    expect(weapon / total).toBeGreaterThan(0.6);
    expect(weapon / total).toBeLessThan(0.85);
  });

  it('same seed + same sequence reproduces identical offers', () => {
    const run = () => {
      const { d, state, ctx } = mk('REPRO', ['coil_carbine', 'arc_scattergun']);
      const log: unknown[] = [];
      let o = d.open(0, ctx);
      log.push(o);
      const r = d.reroll(o.offerId, ctx);
      if ('offer' in r) { o = r.offer; log.push(o); }
      d.pick(o.offerId, 1, ctx);
      o = d.open(1, ctx);
      log.push(o);
      d.pick(o.offerId, 0, ctx);
      o = d.open(2, ctx);
      log.push(o);
      d.skip(o.offerId, ctx);
      o = d.open(3, ctx);
      log.push(o, [...state.ranks]);
      return JSON.stringify(log);
    };
    expect(run()).toBe(run());
  });

  it('yard reward offers a pact per equipped main plus flexible fill', () => {
    const { d, ctx } = mk('Y', ['coil_carbine', 'arc_scattergun']);
    const ids = d.open(1, ctx).options.map((o) => o.id);
    expect(ids).toContain('coil_covenant');
    expect(ids).toContain('arc_covenant');
    const one = mk('Y2').d.open(1, mk('Y2').ctx).options.map((o) => o.id);
    expect(one).toContain('coil_covenant');
    expect(one).not.toContain('arc_covenant');
  });

  it('eligibility: prereqs, equipment, pact exclusivity', () => {
    const s = new CardState();
    const el = (id: string) => isEligible(CARDS.find((c) => c.id === id)!, s);
    expect(el('breaker_fuse')).toBe(false);
    s.add('ion_primer');
    expect(el('breaker_fuse')).toBe(true);
    expect(el('arc_covenant')).toBe(false); // scattergun not equipped
    expect(el('coil_covenant')).toBe(true);
    expect(el('cascade_bus')).toBe(false);
    s.add('coil_covenant');
    expect(el('coil_covenant')).toBe(false);
    expect(el('cascade_bus')).toBe(true);
    expect(el('ion_fan')).toBe(false);
    expect(el('rupture_relay')).toBe(false);
    s.add('cascade_bus');
    expect(el('rupture_relay')).toBe(true);
  });

  it('pact guarantee in rewards 2 and 3 while candidates exist', () => {
    for (let i = 0; i < 30; i++) {
      const { d, state, ctx } = mk('g' + i, ['coil_carbine', 'arc_scattergun']);
      state.add('arc_covenant');
      const upgrades = new Set(['ion_fan', 'cold_chamber', 'repulsion_chamber', 'backwash']);
      for (const ri of [2, 3]) {
        const o = d.open(ri, ctx);
        const hit = o.options.find((x) => upgrades.has(x.id));
        expect(hit, `reward ${ri}`).toBeDefined();
        expect(o.options.some((x) => x.id === 'coil_covenant')).toBe(false);
        d.pick(o.offerId, o.options.indexOf(hit!), ctx);
      }
    }
  });

  it('exhausted pools fill with distinct supplies', () => {
    const { d, state, ctx } = mk('ex');
    for (const c of CARDS) for (let r = 0; r < c.maxRank; r++) state.add(c.id);
    // everything owned/eligible exhausted except what pact blocked: still must be 3 distinct
    const o = d.open(2, ctx);
    expect(o.options).toHaveLength(3);
    expect(new Set(o.options.map((x) => x.id)).size).toBe(3);
    const empty = new CardState(['coil_carbine']);
    for (const c of CARDS) empty.ranks.set(c.id, c.maxRank);
    const o2 = new DraftSystem(new Rng('x')).open(2, { state: empty, salvage: 0, depth: 3 });
    expect(o2.options.map((x) => x.id)).toEqual(['supply_ammo', 'supply_health', 'supply_salvage']);
    expect(o2.options.every((x) => x.kind === 'supply')).toBe(true);
  });
});

describe('reroll / pick / skip', () => {
  it('reroll costs 20, once, excludes shown cards, invalidates the old offer', () => {
    const { d, ctx } = mk('rr');
    const o = d.open(0, ctx);
    const r = d.reroll(o.offerId, ctx);
    expect('offer' in r).toBe(true);
    if (!('offer' in r)) return;
    expect(r.cost).toBe(20);
    expect(r.offer.rerollsLeft).toBe(0);
    expect(r.offer.offerId).not.toBe(o.offerId);
    const shown = new Set(o.options.map((x) => x.id));
    expect(r.offer.options.filter((x) => shown.has(x.id))).toHaveLength(0);
    expect(d.reroll(r.offer.offerId, ctx)).toEqual({ error: 'no_rerolls_left' });
    expect(d.pick(o.offerId, 0, ctx)).toEqual({ error: 'stale_offer' });
  });

  it('reroll is not charged (no offer returned) without salvage or alternatives', () => {
    const { d, ctx } = mk('poor');
    ctx.salvage = 19;
    const o = d.open(0, ctx);
    expect(d.reroll(o.offerId, ctx)).toEqual({ error: 'not_enough_salvage' });
    expect(d.currentOffer()!.offerId).toBe(o.offerId);
    const empty = new CardState();
    for (const c of CARDS) empty.ranks.set(c.id, c.maxRank);
    const d2 = new DraftSystem(new Rng('q'));
    const c2: DraftContext = { state: empty, salvage: 100, depth: 0 };
    const o2 = d2.open(0, c2);
    expect(d2.reroll(o2.offerId, c2)).toEqual({ error: 'no_alternative_offer' });
  });

  it('double pick is rejected and rank applied once', () => {
    const { d, state, ctx } = mk('dp');
    const o = d.open(0, ctx);
    const first = d.pick(o.offerId, 0, ctx);
    expect('error' in first).toBe(false);
    expect(d.pick(o.offerId, 0, ctx)).toEqual({ error: 'stale_offer' });
    expect(d.skip(o.offerId, ctx)).toEqual({ error: 'stale_offer' });
    const total = [...state.ranks.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  it('pick reports pact, heal and supplies; skip gives 10 salvage', () => {
    const { d, state, ctx } = mk('pk');
    state.add('ion_primer');
    let o = d.open(1, ctx);
    let i = o.options.findIndex((x) => x.id === 'coil_covenant');
    const r = d.pick(o.offerId, i, ctx);
    expect(r).toMatchObject({ pact: 'coil_carbine', newRank: 1 });
    expect(state.pact).toBe('coil_carbine');
    o = d.open(0, { ...ctx, state: new CardState() });
    expect(d.skip(o.offerId, ctx)).toEqual({ salvage: 10 });
    const empty = new CardState();
    for (const c of CARDS) empty.ranks.set(c.id, c.maxRank);
    const e: DraftContext = { state: empty, salvage: 0, depth: 0 };
    o = d.open(0, e);
    i = o.options.findIndex((x) => x.id === 'supply_health');
    expect(d.pick(o.offerId, i, e)).toMatchObject({ supply: 'supply_health', heal: 40 });
    const s2 = new CardState();
    const dd = new DraftSystem(new Rng('liner'));
    s2.ranks.clear();
    let got = false;
    for (let k = 0; k < 40 && !got; k++) {
      const of = dd.open(0, { state: s2, salvage: 0, depth: 0 });
      const idx = of.options.findIndex((x) => x.id === 'reactive_liner');
      if (idx >= 0) { expect(dd.pick(of.offerId, idx, { state: s2, salvage: 0, depth: 0 })).toMatchObject({ heal: 20 }); got = true; }
      else dd.skip(of.offerId, { state: s2, salvage: 0, depth: 0 });
    }
    expect(got).toBe(true);
  });

  it('later rewards lean toward rarer cards', () => {
    const count = (depth: number) => {
      let rare = 0;
      for (let i = 0; i < 300; i++) {
        const state = new CardState();
        const d = new DraftSystem(new Rng('w' + i));
        for (const o of d.open(0, { state, salvage: 0, depth }).options) {
          const c = CARDS.find((x) => x.id === o.id);
          if (c && c.rarity !== 'common') rare++;
        }
      }
      return rare;
    };
    expect(count(3)).toBeGreaterThan(count(0));
  });
});
