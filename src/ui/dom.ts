/** Tiny DOM helpers. All text goes through textContent (seeds etc. are user input). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  parent?: Node,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

/** Text setter that only touches the DOM when the value changes. */
export function textSetter(node: HTMLElement): (v: string) => void {
  let last: string | null = null;
  return (v: string) => {
    if (v !== last) {
      last = v;
      node.textContent = v;
    }
  };
}

/** Style/attribute setter that only writes when the string changes. */
export function styleSetter(node: HTMLElement, prop: 'transform' | 'opacity' | 'width' | 'display'): (v: string) => void {
  let last: string | null = null;
  return (v: string) => {
    if (v !== last) {
      last = v;
      node.style[prop] = v;
    }
  };
}

export function classSetter(node: HTMLElement, cls: string): (on: boolean) => void {
  let last: boolean | null = null;
  return (on: boolean) => {
    if (on !== last) {
      last = on;
      node.classList.toggle(cls, on);
    }
  };
}

export function hiddenSetter(node: HTMLElement): (hidden: boolean) => void {
  let last: boolean | null = null;
  return (h: boolean) => {
    if (h !== last) {
      last = h;
      node.hidden = h;
    }
  };
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Stops specific input from reaching the game after an overlay consumed it:
 * the keyup / auto-repeat keydown of a key that confirmed something, and the
 * trailing `click` of a mouse press that confirmed something.
 * Installed once on window in the capture phase.
 */
export class InputGuard {
  private codes = new Map<string, number>();
  private clickUntil = 0;
  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('keyup', (e) => this.onKey(e, true), true);
    window.addEventListener('click', (e) => this.onClick(e), true);
  }
  /** Swallow the release (and auto-repeat) of this key for up to 1.5 s. */
  swallowKey(code: string): void {
    this.codes.set(code, performance.now() + 1500);
  }
  /** Swallow the next click event (the one that follows the mouseup we just consumed). */
  swallowClick(): void {
    this.clickUntil = performance.now() + 400;
  }
  private onKey(e: KeyboardEvent, up = false): void {
    const until = this.codes.get(e.code);
    if (until === undefined) return;
    if (performance.now() > until) {
      this.codes.delete(e.code);
      return;
    }
    if (up) this.codes.delete(e.code);
    e.stopImmediatePropagation();
    e.preventDefault();
  }
  private onClick(e: Event): void {
    if (performance.now() > this.clickUntil) return;
    this.clickUntil = 0;
    e.stopImmediatePropagation();
  }
}
