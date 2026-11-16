import type { CardDef, MainWeaponId, PlayerStats, WeaponStats } from '../types';
import type { CardView, OwnedCardView } from '../../ui/types';
import { BASE_PLAYER, WEAPONS } from '../../content/weapons';
import { CARDS, SUPPLY_DEFS, effectOf, getCard, type SupplyId } from '../../content/cards';
import { CardState } from './state';
import { computePlayerStats, computeWeaponStats } from './stats';
import { cardDrawback, cardText, fillTemplate } from './text';

const SHORT: Record<string, string> = { coil_carbine: 'Carbine', arc_scattergun: 'Scattergun' };

function scopeLabel(c: CardDef): string {
  switch (c.scope) {
    case 'both_mains': return c.drawback ? 'Both main weapons, trade-off' : 'Both main weapons';
    case 'ammo': return 'Ammo';
    case 'player': return 'Player';
    case 'pact': return `${WEAPONS[c.pactWeapon!].name} pact`;
    case 'coil_pact': return 'Coil Covenant';
    case 'arc_pact': return 'Arc Covenant';
  }
}

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const differs = (a: number, b: number) => Math.abs(a - b) > 1e-6;

function weaponLines(before: WeaponStats, after: WeaponStats): string[] {
  const out: string[] = [];
  if (differs(before.damage, after.damage)) out.push(`Damage ${f1(before.damage)} → ${f1(after.damage)}`);
  if (differs(before.pellets, after.pellets)) out.push(`Pellets ${before.pellets} → ${after.pellets}`);
  if (differs(before.spreadDeg, after.spreadDeg)) out.push(`Spread ${f1(before.spreadDeg)}° → ${f1(after.spreadDeg)}°`);
  if (differs(before.fireInterval, after.fireInterval)) out.push(`Fire rate ${f1(1 / before.fireInterval)}/s → ${f1(1 / after.fireInterval)}/s`);
  if (differs(before.reloadTime, after.reloadTime)) out.push(`Reload ${f2(before.reloadTime)} s → ${f2(after.reloadTime)} s`);
  if (before.capacity !== after.capacity) out.push(`Magazine ${before.capacity} → ${after.capacity}`);
  if (before.pierce !== after.pierce) out.push(`Pierce ${before.pierce} → ${after.pierce}`);
  return out;
}

function playerLines(before: PlayerStats, after: PlayerStats): string[] {
  const out: string[] = [];
  if (differs(before.maxHealth, after.maxHealth)) out.push(`Max health ${before.maxHealth} → ${after.maxHealth}`);
  if (differs(before.dashCooldown, after.dashCooldown)) out.push(`Dash cooldown ${f2(before.dashCooldown)} s → ${f2(after.dashCooldown)} s`);
  if (differs(before.pickupAmmoMul, after.pickupAmmoMul)) {
    const p = (m: number) => `+${Math.round((m - 1) * 100)}%`;
    out.push(`Ammo from pickups ${p(before.pickupAmmoMul)} → ${p(after.pickupAmmoMul)}`);
  }
  return out;
}

/** Concrete stat diffs: calls the same computeWeaponStats / computePlayerStats used at runtime. */
export function previewLines(card: CardDef, state: CardState): string[] {
  const after = state.clone();
  after.add(card.id);
  const lines: string[] = [];
  const perWeapon: { w: MainWeaponId; l: string[] }[] = [];
  for (const w of state.equipped) {
    const a = computeWeaponStats(WEAPONS[w], after);
    if (!a.active) continue;
    const l = weaponLines(computeWeaponStats(WEAPONS[w], state), a);
    if (l.length) perWeapon.push({ w, l });
  }
  for (const pw of perWeapon) for (const l of pw.l) lines.push(perWeapon.length > 1 ? `${SHORT[pw.w]}: ${l}` : l);
  lines.push(...playerLines(computePlayerStats(BASE_PLAYER, state), computePlayerStats(BASE_PLAYER, after)));
  return lines.slice(0, 8);
}

function consequences(card: CardDef): string[] {
  const out: string[] = [];
  const pact = effectOf(card, 'pact');
  if (card.pactWeapon && pact) {
    const w = WEAPONS[card.pactWeapon];
    out.push('Second main weapon surrendered for this run');
    out.push(`+${Math.round((pact.params.damageBonus ?? 0) * 100)}% ${w.name} damage`);
    out.push(`Opens the ${card.name} upgrade pool`);
    out.push(`Loadout locked to the ${w.name} and Service Emitter`);
  }
  const heal = effectOf(card, 'on_pick');
  if (heal) out.push(`Restores ${heal.params.heal} health immediately`);
  return out;
}

function prereqs(card: CardDef, state: CardState): { text: string; met: boolean }[] {
  const out: { text: string; met: boolean }[] = [];
  for (const r of card.requires) out.push({ text: `Requires ${getCard(r)?.name ?? r}`, met: state.owns(r) });
  if (card.requiresPact) {
    const cov = CARDS.find((c) => c.pactWeapon === card.requiresPact);
    out.push({ text: `Requires ${cov?.name ?? 'pact'}`, met: state.pact === card.requiresPact });
  }
  if (card.pactWeapon) {
    out.push({ text: `Requires ${WEAPONS[card.pactWeapon].name} equipped`, met: state.equipped.includes(card.pactWeapon) });
    out.push({ text: 'No other pact taken', met: state.pact === null });
  }
  return out;
}

function baseView(card: CardDef, state: CardState): CardView {
  return {
    id: card.id, name: card.name, rarity: card.rarity, scopeLabel: scopeLabel(card),
    text: cardText(card), drawback: cardDrawback(card), rankLabel: null,
    previewLines: [], consequences: consequences(card), prereqLines: prereqs(card, state),
    isSupply: false, isPact: card.pactWeapon !== undefined,
  };
}

/** Candidate view: previews the change from the current state. `nextRank` defaults to rank + 1. */
export function cardView(id: string, state: CardState, nextRank?: number): CardView {
  if (id in SUPPLY_DEFS) return supplyView(id as SupplyId);
  const card = getCard(id);
  if (!card) throw new Error(`Unknown card ${id}`);
  const v = baseView(card, state);
  const cur = state.rank(id);
  const next = nextRank ?? cur + 1;
  if (card.maxRank > 1) v.rankLabel = cur > 0 ? `Rank ${cur} → ${next} of ${card.maxRank}` : `Rank ${next} of ${card.maxRank}`;
  v.previewLines = previewLines(card, state);
  return v;
}

const GROUP_ORDER = ['pact', 'damage', 'handling', 'ammo', 'proc', 'survival', 'mobility'];

export function ownedCardViews(state: CardState): OwnedCardView[] {
  const owned = CARDS.filter((c) => state.owns(c.id));
  owned.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return owned.map((c) => {
    const v = baseView(c, state);
    const rank = state.rank(c.id);
    v.rankLabel = c.maxRank > 1 ? `Rank ${rank} of ${c.maxRank}` : null;
    return { ...v, rank, maxRank: c.maxRank, inactive: state.isInactive(c.id), group: c.group };
  });
}

export function supplyView(kind: SupplyId): CardView {
  const d = SUPPLY_DEFS[kind];
  return {
    id: kind, name: d.name, rarity: 'common', scopeLabel: 'Supply',
    text: fillTemplate(d.text, { ammoFraction: d.ammoFraction ?? 0, heal: d.heal ?? 0, salvage: d.salvage ?? 0 }),
    drawback: null, rankLabel: null, previewLines: [], consequences: [], prereqLines: [], isSupply: true, isPact: false,
  };
}
