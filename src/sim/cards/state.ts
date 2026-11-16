import type { MainWeaponId } from '../types';
import { effectOf, getCard } from '../../content/cards';

export class CardState {
  ranks = new Map<string, number>();
  pact: MainWeaponId | null = null;
  equipped: MainWeaponId[];

  constructor(equipped: MainWeaponId[] = ['coil_carbine']) {
    this.equipped = [...equipped];
  }

  rank(id: string): number {
    return this.ranks.get(id) ?? 0;
  }
  owns(id: string): boolean {
    return this.rank(id) > 0;
  }

  /** Makes a main weapon available (picked up from a rack). Ignored under a pact. */
  equip(w: MainWeaponId): void {
    if (this.pact === null && !this.equipped.includes(w)) this.equipped.push(w);
  }

  /** Adds one rank; returns the new rank (unchanged when capped or a second pact). */
  add(id: string): number {
    const card = getCard(id);
    if (!card) throw new Error(`Unknown card ${id}`);
    const cur = this.rank(id);
    if (cur >= card.maxRank) return cur;
    if (card.pactWeapon) {
      if (this.pact !== null) return cur;
      this.equip(card.pactWeapon);
      this.pact = card.pactWeapon;
      this.equipped = [card.pactWeapon];
    }
    this.ranks.set(id, cur + 1);
    return cur + 1;
  }

  /** True when the card's scope is a weapon that was surrendered by the pact. */
  isInactive(id: string): boolean {
    const card = getCard(id);
    if (!card) return true;
    if (card.requiresPact && this.pact !== card.requiresPact) return true;
    if (this.pact) {
      for (const m of card.modifiers) {
        if (m.weapons && !m.weapons.includes(this.pact)) return true;
      }
    }
    return false;
  }

  /** Owned and not inactive. */
  has(id: string): boolean {
    return this.owns(id) && !this.isInactive(id);
  }

  activeIds(): string[] {
    return [...this.ranks.keys()].filter((id) => !this.isInactive(id));
  }

  clone(): CardState {
    const s = new CardState(this.equipped);
    s.ranks = new Map(this.ranks);
    s.pact = this.pact;
    return s;
  }

  /** Heal granted by this card's pick (Reactive Liner). */
  static pickHeal(id: string): number {
    const c = getCard(id);
    return (c && effectOf(c, 'on_pick')?.params.heal) || 0;
  }
}
