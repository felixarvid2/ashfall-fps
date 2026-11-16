import { describe, expect, it } from 'vitest';
import {
  CARDS, CardState, DEBUG_LOADOUTS, applyDebugLoadout, cardView, computePlayerStats, computeWeaponStats, getCard,
  ownedCardViews, supplyView, cardText, cardDrawback, SUPPLY_DEFS,
} from '../src/sim/cards';
import { BASE_PLAYER, STAT_LIMITS, WEAPONS } from '../src/content/weapons';

const both = () => new CardState(['coil_carbine', 'arc_scattergun']);
const coil = (s: CardState) => computeWeaponStats(WEAPONS.coil_carbine, s);
const arc = (s: CardState) => computeWeaponStats(WEAPONS.arc_scattergun, s);

describe('catalog', () => {
  it('has unique ids and fully filled text', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    expect(CARDS.length).toBe(20);
    for (const c of CARDS) {
      expect(cardText(c)).not.toMatch(/[{}]/);
      expect(cardDrawback(c) ?? '').not.toMatch(/[{}]/);
      for (const r of c.requires) expect(getCard(r)).toBeDefined();
    }
  });
});

describe('stat formulas', () => {
  it('sums like bonuses once and matches the brief examples', () => {
    const s = new CardState();
    s.add('alloy_windings');
    expect(coil(s).damage).toBeCloseTo(14.3, 5);
    s.add('alloy_windings');
    s.add('alloy_windings');
    expect(coil(s).damage).toBeCloseTo(13 * 1.3, 5);
    s.add('quick_swap_coupler');
    expect(coil(s).reloadTime).toBeCloseTo(1.4 / 1.15, 5);
    const e = new CardState();
    e.add('extended_cells');
    expect(coil(e).capacity).toBe(39);
    e.add('extended_cells');
    expect(coil(e).capacity).toBe(45); // ceil(32 * 1.4)
  });

  it('Hot Cycle trades reload for fire rate', () => {
    const s = new CardState();
    s.add('hot_cycle');
    expect(coil(s).fireInterval).toBeCloseTo(0.105 / 1.3, 6);
    expect(coil(s).reloadTime).toBeCloseTo(1.4 / 0.8, 6);
    s.add('quick_swap_coupler');
    expect(coil(s).reloadTime).toBeCloseTo(1.4 / 0.95, 6);
  });

  it('clamps to STAT_LIMITS', () => {
    const s = new CardState();
    for (let i = 0; i < 2; i++) { s.add('quick_swap_coupler'); s.add('extended_cells'); s.add('step_assist'); }
    s.add('hot_cycle');
    const st = coil(s);
    expect(st.reloadTime).toBeGreaterThanOrEqual(STAT_LIMITS.minReloadTime);
    expect(st.capacity).toBeLessThanOrEqual(Math.ceil(32 * STAT_LIMITS.maxCapacityMul));
    expect(computePlayerStats(BASE_PLAYER, s).dashCooldown).toBeCloseTo(1.4, 6);
  });

  it('player stats', () => {
    const s = new CardState();
    s.add('reactive_liner');
    s.add('reactive_liner');
    s.add('salvage_funnel');
    s.add('step_assist');
    const p = computePlayerStats(BASE_PLAYER, s);
    expect(p.maxHealth).toBe(140);
    expect(p.pickupAmmoMul).toBeCloseTo(1.25, 6);
    expect(p.dashCooldown).toBeCloseTo(1.7, 6);
  });

  it('rank caps', () => {
    const s = new CardState();
    for (let i = 0; i < 5; i++) s.add('alloy_windings');
    expect(s.rank('alloy_windings')).toBe(3);
    expect(s.add('chargeback')).toBe(1);
    expect(s.add('chargeback')).toBe(1);
  });

  it('Ion Fan adds pellets and spread; Mass Driver pierce', () => {
    const s = both();
    s.add('arc_covenant');
    s.add('ion_fan');
    expect(arc(s).pellets).toBe(11);
    expect(arc(s).spreadDeg).toBeCloseTo(13 * 1.25, 6);
    expect(arc(s).damage).toBeCloseTo(90 * 1.1 * 11 / 9, 6);
    const c = both();
    c.add('coil_covenant');
    c.add('mass_driver');
    expect(coil(c).pierce).toBe(1);
    expect(coil(c).pierceDamageMul).toBe(0.6);
  });
});

describe('pact', () => {
  it('adds +0.10 damage to the pledged weapon and surrenders the other', () => {
    const s = both();
    s.add('alloy_windings');
    s.add('coil_covenant');
    expect(s.pact).toBe('coil_carbine');
    expect(s.equipped).toEqual(['coil_carbine']);
    expect(coil(s).damageBonus).toBeCloseTo(0.2, 6);
    expect(coil(s).damage).toBeCloseTo(13 * 1.2, 6);
    expect(coil(s).active).toBe(true);
    expect(arc(s).active).toBe(false);
    expect(computeWeaponStats(WEAPONS.service_emitter, s).active).toBe(true);
  });

  it('no second pact; upgrades are inactive without the matching pact', () => {
    const s = both();
    s.add('arc_covenant');
    expect(s.add('coil_covenant')).toBe(0);
    expect(s.pact).toBe('arc_scattergun');
    expect(s.isInactive('cascade_bus')).toBe(true); // coil upgrade under an arc pact
    s.add('ion_fan');
    expect(s.isInactive('ion_fan')).toBe(false);
    expect(s.activeIds()).toContain('ion_fan');
  });

  it('owned views show inactive cards', () => {
    const s = both();
    s.add('ion_primer');
    s.add('coil_covenant');
    const v = ownedCardViews(s);
    expect(v.map((x) => x.id)).toEqual(['coil_covenant', 'ion_primer']);
    expect(v.every((x) => !x.inactive)).toBe(true);
    // force an inactive case: ranks added directly
    s.ranks.set('ion_fan', 1);
    expect(ownedCardViews(s).find((x) => x.id === 'ion_fan')!.inactive).toBe(true);
  });
});

describe('views', () => {
  it('previews use the same stats as runtime', () => {
    const s = new CardState();
    expect(cardView('quick_swap_coupler', s).previewLines).toEqual(['Reload 1.40 s → 1.22 s']);
    expect(cardView('alloy_windings', s).previewLines).toEqual(['Damage 13.0 → 14.3']);
    expect(cardView('extended_cells', s).previewLines).toEqual(['Magazine 32 → 39']);
    expect(cardView('alloy_windings', s).rankLabel).toBe('Rank 1 of 3');
    s.add('alloy_windings');
    expect(cardView('alloy_windings', s).rankLabel).toBe('Rank 1 → 2 of 3');
    expect(cardView('step_assist', s).previewLines).toEqual(['Dash cooldown 2.00 s → 1.70 s']);
  });

  it('pact consequences and prereq lines', () => {
    const s = both();
    const v = cardView('coil_covenant', s);
    expect(v.isPact).toBe(true);
    expect(v.consequences).toContain('Second main weapon surrendered for this run');
    expect(v.consequences).toContain('+10% Coil Carbine damage');
    expect(v.consequences).toContain('Opens the Coil Covenant upgrade pool');
    expect(v.previewLines).toEqual(['Damage 13.0 → 14.3']);
    const b = cardView('breaker_fuse', s);
    expect(b.prereqLines).toEqual([{ text: 'Requires Ion Primer', met: false }]);
    s.add('ion_primer');
    expect(cardView('breaker_fuse', s).prereqLines[0]!.met).toBe(true);
    expect(cardView('reactive_liner', s).consequences).toContain('Restores 20 health immediately');
  });

  it('supply views', () => {
    for (const k of Object.keys(SUPPLY_DEFS) as (keyof typeof SUPPLY_DEFS)[]) {
      const v = supplyView(k);
      expect(v.isSupply).toBe(true);
      expect(v.text).not.toMatch(/[{}]/);
    }
  });
});

describe('debug loadouts', () => {
  it('apply cleanly', () => {
    for (const key of Object.keys(DEBUG_LOADOUTS)) {
      const s = new CardState();
      applyDebugLoadout(s, key);
      for (const id of DEBUG_LOADOUTS[key]!) {
        expect(s.owns(id)).toBe(true);
        expect(s.isInactive(id)).toBe(false);
      }
    }
  });
});
