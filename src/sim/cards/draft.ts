import type { CardDef, DraftOffer, DraftOption, MainWeaponId, SupplyKind } from '../types';
import type { Rng } from '../../core/rng';
import { CARDS, DRAFT_RULES, SUPPLY_DEFS, SUPPLY_IDS, getCard } from '../../content/cards';
import { CardState } from './state';

export interface DraftContext {
  state: CardState;
  salvage: number;
  depth: number;
}

export interface PickResult {
  option: DraftOption;
  newRank?: number;
  pact?: MainWeaponId;
  supply?: SupplyKind;
  /** Health to restore now (Reactive Liner on pick, Health Kit supply). */
  heal?: number;
  /** Salvage to add now (Salvage Cache supply). */
  salvage?: number;
  /** Fraction of reserve capacity to refill (Reserve Ammo supply). */
  ammoFraction?: number;
}

const isPactCard = (c: CardDef) => c.pactWeapon !== undefined;

export function isEligible(c: CardDef, state: CardState): boolean {
  if (state.rank(c.id) >= c.maxRank) return false;
  if (!c.requires.every((r) => state.owns(r))) return false;
  if (c.requiresPact && state.pact !== c.requiresPact) return false;
  if (c.pactWeapon && (state.pact !== null || !state.equipped.includes(c.pactWeapon))) return false;
  // Cards whose modifiers are scoped only to unequipped weapons are useless.
  const scoped = c.modifiers.filter((m) => m.weapons);
  if (scoped.length > 0 && !scoped.some((m) => m.weapons!.some((w) => state.equipped.includes(w)))) return false;
  return true;
}

function weightOf(c: CardDef, depth: number, state: CardState): number {
  const t = Math.max(0, depth) * 0.25;
  const base = DRAFT_RULES.rarityWeight[c.rarity];
  const mul =
    c.rarity === 'common' ? Math.max(0.25, 1 - 0.3 * t)
    : c.rarity === 'uncommon' ? 1 + 0.2 * t
    : c.rarity === 'rare' ? 1 + 0.8 * t
    : 1 + 1.5 * t;
  const favored = c.requiresPact && state.pact === c.requiresPact ? DRAFT_RULES.pactUpgradeWeight : 1;
  return base * mul * favored;
}

const cardOption = (c: CardDef, state: CardState): DraftOption => ({ kind: 'card', id: c.id, nextRank: state.rank(c.id) + 1 });

interface OpenOffer {
  offer: DraftOffer;
  rewardIndex: number;
  rerolled: boolean;
}

export class DraftSystem {
  private nextId = 1;
  private current: OpenOffer | null = null;

  constructor(private readonly rng: Rng) {}

  currentOffer(): DraftOffer | null {
    return this.current ? this.current.offer : null;
  }

  open(rewardIndex: number, ctx: DraftContext): DraftOffer {
    const options = this.build(rewardIndex, ctx, new Set());
    const offer = this.makeOffer(rewardIndex, options, 1);
    this.current = { offer, rewardIndex, rerolled: false };
    return offer;
  }

  private makeOffer(rewardIndex: number, options: DraftOption[], rerollsLeft: number): DraftOffer {
    return {
      offerId: this.nextId++, rewardIndex, options, rerollsLeft,
      rerollCost: DRAFT_RULES.rerollCost, skipSalvage: DRAFT_RULES.skipSalvage,
    };
  }

  /** The returned `cost` is only returned on success; the caller deducts it from Salvage. */
  reroll(offerId: number, ctx: DraftContext): { offer: DraftOffer; cost: number } | { error: string } {
    const cur = this.current;
    if (!cur || cur.offer.offerId !== offerId) return { error: 'stale_offer' };
    if (cur.rerolled || cur.offer.rerollsLeft <= 0) return { error: 'no_rerolls_left' };
    if (ctx.salvage < DRAFT_RULES.rerollCost) return { error: 'not_enough_salvage' };
    const shown = new Set(cur.offer.options.filter((o) => o.kind === 'card').map((o) => o.id));
    const options = this.build(cur.rewardIndex, ctx, shown);
    const ids = options.map((o) => o.id).join('|');
    if (ids === cur.offer.options.map((o) => o.id).join('|')) return { error: 'no_alternative_offer' };
    const offer = this.makeOffer(cur.rewardIndex, options, 0);
    this.current = { offer, rewardIndex: cur.rewardIndex, rerolled: true };
    return { offer, cost: DRAFT_RULES.rerollCost };
  }

  pick(offerId: number, index: number, ctx: DraftContext): PickResult | { error: string } {
    const cur = this.current;
    if (!cur || cur.offer.offerId !== offerId) return { error: 'stale_offer' };
    const option = cur.offer.options[index];
    if (!option) return { error: 'bad_index' };
    this.current = null; // applied exactly once
    if (option.kind === 'supply') {
      const d = SUPPLY_DEFS[option.id as keyof typeof SUPPLY_DEFS];
      const r: PickResult = { option, supply: option.id as SupplyKind };
      if (d.heal) r.heal = d.heal;
      if (d.salvage) r.salvage = d.salvage;
      if (d.ammoFraction) r.ammoFraction = d.ammoFraction;
      return r;
    }
    const card = getCard(option.id)!;
    const newRank = ctx.state.add(card.id);
    const r: PickResult = { option, newRank };
    if (card.pactWeapon && ctx.state.pact === card.pactWeapon) r.pact = card.pactWeapon;
    const heal = CardState.pickHeal(card.id);
    if (heal > 0) r.heal = heal;
    return r;
  }

  skip(offerId: number, _ctx: DraftContext): { salvage: number } | { error: string } {
    const cur = this.current;
    if (!cur || cur.offer.offerId !== offerId) return { error: 'stale_offer' };
    this.current = null;
    return { salvage: DRAFT_RULES.skipSalvage };
  }

  // -----------------------------------------------------------------------

  private build(rewardIndex: number, ctx: DraftContext, exclude: Set<string>): DraftOption[] {
    const { state, depth } = ctx;
    const size = DRAFT_RULES.offerSize;
    // Stable order: sorted by id before any weighting.
    const pool = CARDS.filter((c) => isEligible(c, state)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const chosen: CardDef[] = [];
    const taken = (c: CardDef) => chosen.includes(c);

    const draw = (cands: CardDef[]): CardDef | null => {
      if (cands.length === 0) return null;
      // Prefer cards not currently shown (reroll); fall back to shown ones only when nothing else qualifies.
      const fresh = cands.filter((c) => !exclude.has(c.id));
      const from = fresh.length > 0 ? fresh : cands;
      const i = this.rng.weightedIndex(from.map((c) => weightOf(c, depth, state)));
      return i < 0 ? null : from[i]!;
    };
    const take = (cands: CardDef[]): boolean => {
      const c = draw(cands.filter((x) => !taken(x)));
      if (!c) return false;
      chosen.push(c);
      return true;
    };

    // Forced slots.
    if (rewardIndex === 1 && state.pact === null) {
      // One pact card per equipped main weapon.
      for (const w of state.equipped) {
        if (chosen.length >= size) break;
        take(pool.filter((c) => c.pactWeapon === w));
      }
    }
    if (rewardIndex >= 2 && state.pact !== null && chosen.length < size) {
      take(pool.filter((c) => c.requiresPact === state.pact));
    }

    const ordinary = (c: CardDef) => !isPactCard(c) || (rewardIndex >= 2 && state.pact === null);
    const rest = pool.filter(ordinary);

    // At least one weapon-affecting card when any is eligible.
    if (!chosen.some((c) => c.affectsWeapons) && chosen.length < size) take(rest.filter((c) => c.affectsWeapons));

    // Remaining slots: ~2/3 weapon-affecting.
    while (chosen.length < size) {
      const wantWeapon = this.rng.chance(DRAFT_RULES.weaponSlotChance);
      const avail = rest.filter((c) => !taken(c));
      if (avail.length === 0) break;
      const preferred = avail.filter((c) => c.affectsWeapons === wantWeapon);
      if (!take(preferred.length > 0 ? preferred : avail)) break;
    }

    const options: DraftOption[] = chosen.map((c) => cardOption(c, state));
    for (const s of SUPPLY_IDS) {
      if (options.length >= size) break;
      options.push({ kind: 'supply', id: s });
    }
    return options;
  }
}

