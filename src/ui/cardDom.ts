import type { CardView, OwnedCardView } from './types';
import { el } from './dom';

export const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

/** Card body used by the draft (full detail). Rarity is shown as text AND colour. */
export function buildDraftCard(c: CardView, index: number): HTMLElement {
  const card = el('div', `sw-card r-${c.rarity}`);
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${c.name}, ${RARITY_LABEL[c.rarity] ?? c.rarity}. Press ${index + 1} to take.`);
  card.tabIndex = -1;
  const head = el('div', 'ch', undefined, card);
  el('span', 'rar', RARITY_LABEL[c.rarity] ?? c.rarity, head);
  el('span', 'num', String(index + 1), head);
  const body = el('div', 'cb', undefined, card);
  el('div', 'nm', c.name, body);
  el('div', 'scope', c.scopeLabel, body);
  el('div', 'fx', c.text, body);
  if (c.rankLabel) el('div', 'rk', c.rankLabel, body);
  if (c.previewLines.length) {
    const pv = el('div', 'pv', undefined, body);
    for (const l of c.previewLines) el('div', undefined, l, pv);
  }
  if (c.drawback) el('div', 'dr', c.drawback, body);
  for (const l of c.consequences) el('div', 'cons', l, body);
  for (const p of c.prereqLines) el('div', `pr ${p.met ? 'met' : 'unmet'}`, p.text, body);
  const tags = el('div', 'tags', undefined, body);
  if (c.isPact) el('span', 'sw-tagchip pact', 'Pact', tags);
  if (c.isSupply) el('span', 'sw-tagchip supply', 'Supply', tags);
  return card;
}

/** Compact owned-card entry for the inspect panel. */
export function buildOwnedCard(c: OwnedCardView): HTMLElement {
  const d = el('div', `sw-own r-${c.rarity}${c.inactive ? ' off' : ''}`);
  const t = el('div', 't', undefined, d);
  el('span', undefined, c.name, t);
  el('i', undefined, `RANK ${c.rank}/${c.maxRank}`, t);
  el('div', 'rr', `${RARITY_LABEL[c.rarity] ?? c.rarity} • ${c.scopeLabel}`, d);
  el('div', 'd', c.text, d);
  if (c.drawback) el('div', 'dr', `▲ ${c.drawback}`, d).style.color = 'var(--warn)';
  for (const p of c.prereqLines) el('div', `pq ${p.met ? 'met' : 'unmet'}`, `${p.met ? '✓' : '✗'} ${p.text}`, d);
  if (c.inactive) {
    const unmet = c.prereqLines.find((p) => !p.met);
    el('div', 'why', `Inactive: ${unmet ? unmet.text : (c.consequences[0] ?? 'weapon surrendered or requirement unmet')}`, d);
  }
  return d;
}
