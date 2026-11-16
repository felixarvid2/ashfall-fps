import type { CardDef } from '../types';

/** Params + modifier values of a card, merged into one lookup bag. */
export function cardParamBag(card: CardDef): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const m of card.modifiers) bag[m.stat] = (bag[m.stat] ?? 0) + m.value;
  for (const e of card.effects) Object.assign(bag, e.params);
  return bag;
}

export function fillTemplate(tpl: string, bag: Record<string, number>): string {
  return tpl.replace(/\{(\w+)(%?)\}/g, (_m, key: string, pct: string) => {
    const v = bag[key];
    if (v === undefined) throw new Error(`Missing text param ${key} in "${tpl}"`);
    const a = Math.abs(v);
    return pct ? String(Math.round(a * 100)) : String(Math.round(a * 1000) / 1000);
  });
}

export function cardText(card: CardDef): string {
  return fillTemplate(card.text, cardParamBag(card));
}
export function cardDrawback(card: CardDef): string | null {
  return card.drawback ? fillTemplate(card.drawback, cardParamBag(card)) : null;
}
