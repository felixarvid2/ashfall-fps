import type { DraftView, UiActions } from './types';
import { InputGuard, el } from './dom';
import { buildDraftCard } from './cardDom';

const OPEN_GUARD_MS = 250;
const FAILSAFE_MS = 1500;

/**
 * Card draft overlay. Keys: 1/2/3 pick, Left/Right focus, Enter/Space confirm,
 * R reroll, S skip. Esc/Tab are swallowed (Esc is reserved, never skips).
 */
export class DraftOverlay {
  readonly node = el('div', 'sw-screen sw-dim sw-draft');
  private view: DraftView | null = null;
  private cards: HTMLElement[] = [];
  private focus = 0;
  private openedAt = 0;
  private locked = false;
  private token = 0;
  private mouseDown = -1;
  private rerollBtn = el('button', 'sw-btn');
  private skipBtn = el('button', 'sw-btn');
  private listening = false;
  private onKey = (e: KeyboardEvent) => this.keydown(e);

  constructor(
    parent: HTMLElement,
    private actions: UiActions,
    private guard: InputGuard,
  ) {
    this.node.hidden = true;
    parent.appendChild(this.node);
    this.node.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    this.node.addEventListener('mouseup', (e) => e.stopPropagation());
    this.node.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get open(): boolean {
    return !this.node.hidden;
  }

  show(view: DraftView): void {
    this.view = view;
    this.locked = false;
    this.token++;
    this.focus = 0;
    this.mouseDown = -1;
    this.openedAt = performance.now();
    const n = this.node;
    n.replaceChildren();
    el('div', 'dtitle', view.title, n);
    el('div', 'dsub', 'Choose one', n);
    const row = el('div', 'sw-cards', undefined, n);
    this.cards = view.cards.map((c, i) => {
      const card = buildDraftCard(c, i);
      card.addEventListener('mouseenter', () => this.setFocus(i));
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.mouseDown = i;
      });
      card.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        const down = this.mouseDown;
        this.mouseDown = -1;
        if (down === i) this.pick(i, true);
      });
      row.appendChild(card);
      return card;
    });
    const bar = el('div', 'sw-draftbar', undefined, n);
    el('div', 'sal', `SALVAGE ${view.salvage}`, bar);
    const rr = this.rerollBtn;
    rr.className = 'sw-btn';
    const canAfford = view.salvage >= view.rerollCost;
    const can = view.canReroll && canAfford;
    rr.textContent = `Reroll [R] — ${view.rerollCost} Salvage` + (view.canReroll ? (canAfford ? '' : ' (need more)') : ' (used)');
    rr.disabled = !can;
    rr.onclick = () => this.reroll();
    const sk = this.skipBtn;
    sk.className = 'sw-btn';
    sk.textContent = `Skip [S] (+${view.skipSalvage} Salvage)`;
    sk.onclick = () => this.skip();
    for (const b of [rr, sk]) {
      b.tabIndex = -1;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      bar.appendChild(b);
    }
    el('div', 'keyhint', '1 / 2 / 3 take card  •  ← → + Enter  •  R reroll  •  S skip  •  Esc is disabled while choosing', n);
    this.setFocus(0);
    n.hidden = false;
    if (!this.listening) {
      this.listening = true;
      window.addEventListener('keydown', this.onKey, true);
    }
  }

  hide(): void {
    this.node.hidden = true;
    this.view = null;
    this.token++;
    if (this.listening) {
      this.listening = false;
      window.removeEventListener('keydown', this.onKey, true);
    }
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.cards.forEach((c, j) => c.classList.toggle('focus', j === i));
  }

  private ready(): boolean {
    return !!this.view && !this.locked && performance.now() - this.openedAt >= OPEN_GUARD_MS;
  }

  private lock(): void {
    this.locked = true;
    const t = this.token;
    window.setTimeout(() => {
      if (this.token === t) this.locked = false; // the game never answered; let the player retry
    }, FAILSAFE_MS);
  }

  private pick(i: number, byMouse: boolean, code?: string): void {
    const v = this.view;
    if (!v || !this.ready() || i < 0 || i >= v.cards.length) return;
    this.lock();
    if (code) this.guard.swallowKey(code);
    if (byMouse) this.guard.swallowClick();
    this.cards.forEach((c, j) => c.classList.toggle('chosen', j === i));
    this.actions.draftPick(v.offer.offerId, i);
  }

  private reroll(code?: string): void {
    const v = this.view;
    if (!v || !this.ready() || !v.canReroll || v.salvage < v.rerollCost) return;
    this.lock();
    if (code) this.guard.swallowKey(code);
    this.actions.draftReroll(v.offer.offerId);
  }

  private skip(code?: string): void {
    const v = this.view;
    if (!v || !this.ready()) return;
    this.lock();
    if (code) this.guard.swallowKey(code);
    this.actions.draftSkip(v.offer.offerId);
  }

  private keydown(e: KeyboardEvent): void {
    if (!this.view) return;
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return; // browser shortcuts
    // Everything else is kept away from the game while the draft is up.
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      this.pick(Number(m[1]) - 1, false, e.code);
      return;
    }
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.setFocus((this.focus + this.cards.length - 1) % this.cards.length);
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.setFocus((this.focus + 1) % this.cards.length);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        this.pick(this.focus, false, e.code);
        break;
      case 'KeyR':
        this.reroll(e.code);
        break;
      case 'KeyS':
        this.skip(e.code);
        break;
      default:
        break; // Esc, Tab, movement: swallowed, no effect
    }
  }
}
