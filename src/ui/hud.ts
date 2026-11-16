import type { DebugModel, HudModel } from './types';
import { classSetter, clamp, el, hiddenSetter, styleSetter, textSetter } from './dom';

const RING_C = 2 * Math.PI * 30;
const DMG_POOL = 8;

export type BannerKind = 'wave' | 'clear' | 'objective' | 'warn';

/** In-game HUD. DOM is built once; updateHud only writes values that changed. */
export class Hud {
  readonly root = el('div', 'sw-hud');
  private dbg = el('div', 'sw-debug');
  private dbgLast = '';

  private health = el('div', 'hud-blk hud-health', undefined, this.root);
  private setHv!: (v: string) => void;
  private setHm!: (v: string) => void;
  private hbar!: HTMLElement;
  private setHbarW!: (v: string) => void;
  private setHLow!: (on: boolean) => void;
  private setHBarLow!: (on: boolean) => void;
  private dashEl!: HTMLElement;
  private setDashFill!: (v: string) => void;
  private setDashReady!: (on: boolean) => void;
  private setDashTxt!: (v: string) => void;

  private ammo = el('div', 'hud-blk hud-ammo', undefined, this.root);
  private setWn!: (v: string) => void;
  private setMag!: (v: string) => void;
  private setCap!: (v: string) => void;
  private setRes!: (v: string) => void;
  private setAl!: (v: string) => void;
  private setEmpty!: (on: boolean) => void;
  private setLow!: (v: string) => void;
  private setCascade!: (v: string) => void;
  private hideCascade!: (h: boolean) => void;
  private setCold!: (v: string) => void;
  private hideCold!: (h: boolean) => void;
  private setColdIdle!: (on: boolean) => void;
  private setBackupFill!: (v: string) => void;
  private setBackupFull!: (on: boolean) => void;

  private tickL!: HTMLElement; private tickR!: HTMLElement; private tickT!: HTMLElement; private tickB!: HTMLElement;
  private lastSpread = -1;
  private setRingOp!: (v: string) => void;
  private ringFg!: SVGElement;
  private lastRing = -1;
  private setHit!: (v: string) => void;
  private setKill!: (v: string) => void;
  private dmgEls: HTMLElement[] = [];
  private dmgSet: { op: (v: string) => void; tr: (v: string) => void }[] = [];

  private setObj!: (v: string) => void;
  private setWave!: (v: string) => void;
  private bossBox = el('div', 'hud-boss');
  private setBossName!: (v: string) => void;
  private setBossW!: (v: string) => void;
  private hideBoss!: (h: boolean) => void;
  private relayBox = el('div', 'hud-relay');
  private setRelayW!: (v: string) => void;
  private setRelayPct!: (v: string) => void;
  private hideRelay!: (h: boolean) => void;
  private setSalv!: (v: string) => void;
  private prompt = el('div', 'hud-blk hud-prompt', undefined, this.root);
  private setPrompt!: (v: string) => void;
  private hidePrompt!: (h: boolean) => void;
  private slots = el('div', 'hud-blk hud-slots', undefined, this.root);
  private slotsKey = '';

  private bannerEl = el('div', 'hud-blk hud-banner', undefined, this.root);
  private bannerTimer = 0;
  private subEl = el('div', 'hud-blk hud-sub', undefined, this.root);
  private subSpeaker = el('b');
  private subText = el('em');
  private subTimer = 0;

  constructor(parent: HTMLElement) {
    this.buildCrosshair();
    this.buildHealth();
    this.buildTop();
    this.buildAmmo();
    el('span', undefined, undefined, this.subEl).append(this.subSpeaker, this.subText);
    this.subText.style.fontStyle = 'normal';
    parent.appendChild(this.root);
    parent.appendChild(this.dbg);
    this.dbg.hidden = true;
    this.root.hidden = true;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  private buildCrosshair(): void {
    const x = el('div', 'hud-xhair', undefined, this.root);
    this.tickL = el('i', 'tick h', undefined, x);
    this.tickR = el('i', 'tick h', undefined, x);
    this.tickT = el('i', 'tick v', undefined, x);
    this.tickB = el('i', 'tick v', undefined, x);
    el('i', 'dot', undefined, x);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 68 68');
    const mk = (cls: string) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '34'); c.setAttribute('cy', '34'); c.setAttribute('r', '30');
      c.setAttribute('class', cls);
      svg.appendChild(c);
      return c;
    };
    mk('bg');
    this.ringFg = mk('fg');
    this.ringFg.setAttribute('stroke-dasharray', String(RING_C));
    x.appendChild(svg);
    this.setRingOp = styleSetter(svg as unknown as HTMLElement, 'opacity');
    const hit = el('i', 'hud-hit', undefined, x);
    const kill = el('i', 'hud-kill', undefined, x);
    this.setHit = styleSetter(hit, 'opacity');
    this.setKill = styleSetter(kill, 'opacity');
    const dmg = el('div', 'hud-dmg', undefined, this.root);
    for (let i = 0; i < DMG_POOL; i++) {
      const d = el('i', undefined, undefined, dmg);
      this.dmgEls.push(d);
      this.dmgSet.push({ op: styleSetter(d, 'opacity'), tr: styleSetter(d, 'transform') });
    }
    this.setSpread(8);
  }

  private setSpread(px: number): void {
    const g = Math.round(clamp(px, 2, 200) * 2) / 2;
    if (g === this.lastSpread) return;
    this.lastSpread = g;
    this.tickL.style.transform = `translateX(${-g - 10}px)`;
    this.tickR.style.transform = `translateX(${g}px)`;
    this.tickT.style.transform = `translateY(${-g - 10}px)`;
    this.tickB.style.transform = `translateY(${g}px)`;
  }

  private buildHealth(): void {
    const h = this.health;
    el('div', 'lbl', 'Integrity', h);
    const row = el('div', 'row', undefined, h);
    const hv = el('span', 'hv', undefined, row);
    const hm = el('span', 'hm', undefined, row);
    this.setHv = textSetter(hv);
    this.setHm = textSetter(hm);
    this.hbar = el('div', 'hud-bar', undefined, h);
    const fill = el('i', undefined, undefined, this.hbar);
    this.setHbarW = styleSetter(fill, 'transform');
    this.setHLow = classSetter(h, 'low');
    this.setHBarLow = classSetter(this.hbar, 'low');
    this.dashEl = el('div', 'hud-dash', undefined, h);
    const t = el('span', undefined, undefined, this.dashEl);
    this.setDashTxt = textSetter(t);
    const pip = el('div', 'pip', undefined, this.dashEl);
    this.setDashFill = styleSetter(el('i', undefined, undefined, pip), 'transform');
    this.setDashReady = classSetter(this.dashEl, 'ready');
  }

  private buildTop(): void {
    const top = el('div', 'hud-blk hud-top', undefined, this.root);
    this.setObj = textSetter(el('div', 'hud-obj', undefined, top));
    this.setWave = textSetter(el('div', 'hud-wave', undefined, top));
    top.appendChild(this.bossBox);
    this.setBossName = textSetter(el('div', 'bn', undefined, this.bossBox));
    const bb = el('div', 'hud-bar', undefined, this.bossBox);
    this.setBossW = styleSetter(el('i', undefined, undefined, bb), 'transform');
    this.hideBoss = hiddenSetter(this.bossBox);
    top.appendChild(this.relayBox);
    const rl = el('div', 'rl', undefined, this.relayBox);
    this.setRelayPct = textSetter(rl);
    const rb = el('div', 'hud-bar', undefined, this.relayBox);
    this.setRelayW = styleSetter(el('i', undefined, undefined, rb), 'transform');
    this.hideRelay = hiddenSetter(this.relayBox);
    const salv = el('div', 'hud-blk hud-salv', undefined, this.root);
    el('small', undefined, 'Salvage', salv);
    this.setSalv = textSetter(el('span', undefined, undefined, salv));
    this.setPrompt = textSetter(this.prompt);
    this.hidePrompt = hiddenSetter(this.prompt);
  }

  private buildAmmo(): void {
    const a = this.ammo;
    const chips = el('div', 'chips', undefined, a);
    const cold = el('span', 'hud-chip slug', undefined, chips);
    const casc = el('span', 'hud-chip', undefined, chips);
    this.setCold = textSetter(cold); this.hideCold = hiddenSetter(cold); this.setColdIdle = classSetter(cold, 'idle');
    this.setCascade = textSetter(casc); this.hideCascade = hiddenSetter(casc);
    this.setWn = textSetter(el('div', 'wn', undefined, a));
    const mag = el('div', 'mag', undefined, a);
    this.setMag = textSetter(el('span', undefined, undefined, mag));
    const cap = el('small', undefined, undefined, mag);
    this.setCap = textSetter(cap);
    this.setRes = textSetter(el('div', 'res', undefined, a));
    this.setAl = textSetter(el('div', 'al', undefined, a));
    this.setEmpty = classSetter(a, 'empty');
    this.setLow = textSetter(el('div', 'hud-lowammo', undefined, a));
    const bk = el('div', 'hud-backup', undefined, a);
    el('span', undefined, 'Backup [Q]', bk);
    const bb = el('div', 'hud-bar', undefined, bk);
    this.setBackupFill = styleSetter(el('i', undefined, undefined, bb), 'transform');
    this.setBackupFull = classSetter(bk, 'full');
  }

  update(m: HudModel): void {
    const frac = m.maxHealth > 0 ? clamp(m.health / m.maxHealth, 0, 1) : 0;
    this.setHv(String(Math.max(0, Math.ceil(m.health))));
    this.setHm(`/ ${Math.round(m.maxHealth)}`);
    this.setHbarW(`scaleX(${frac.toFixed(3)})`);
    this.setHLow(frac <= 0.3);
    this.setHBarLow(frac <= 0.3);
    this.setDashTxt(m.dashReady >= 1 ? 'Dash ready' : 'Dash');
    this.setDashFill(`scaleX(${clamp(m.dashReady, 0, 1).toFixed(2)})`);
    this.setDashReady(m.dashReady >= 1);

    this.setWn(m.weaponName);
    this.setMag(String(m.magazine));
    this.setCap(` / ${m.capacity}`);
    this.setRes(Number.isFinite(m.reserve) ? `RESERVE ${m.reserve}` : 'RESERVE ∞');
    this.setAl(m.ammoLabel);
    this.setEmpty(m.magazine <= 0);
    this.setLow(m.lowAmmo ? 'LOW AMMO' : '');
    this.hideCascade(!m.cascade);
    if (m.cascade) this.setCascade(`ARC ${m.cascade.count}/${m.cascade.of}`);
    this.hideCold(m.coldChamberReady === null);
    if (m.coldChamberReady !== null) {
      this.setCold(m.coldChamberReady ? 'SLUG READY' : 'CHAMBERING');
      this.setColdIdle(!m.coldChamberReady);
    }
    this.setBackupFill(`scaleX(${clamp(m.backupCharge, 0, 1).toFixed(2)})`);
    this.setBackupFull(m.backupCharge >= 1);

    this.setSpread(m.crosshairSpread);
    if (m.reloading === null) {
      this.setRingOp('0');
      this.lastRing = -1;
    } else {
      this.setRingOp('1');
      const p = Math.round(clamp(m.reloading, 0, 1) * 100) / 100;
      if (p !== this.lastRing) {
        this.lastRing = p;
        this.ringFg.setAttribute('stroke-dashoffset', String(RING_C * (1 - p)));
      }
    }
    this.setHit(m.hitMarker.toFixed(2));
    this.setKill(m.killMarker.toFixed(2));
    for (let i = 0; i < DMG_POOL; i++) {
      const d = m.damageDirs[i];
      if (d && d.alpha > 0.01) {
        this.dmgSet[i]!.op(clamp(d.alpha, 0, 1).toFixed(2));
        this.dmgSet[i]!.tr(`rotate(${d.angle.toFixed(3)}rad)`);
      } else this.dmgSet[i]!.op('0');
    }

    this.setObj(m.objective);
    const wave = [m.waveText, m.enemiesLeft !== null ? `${m.enemiesLeft} left` : null].filter(Boolean).join('  •  ');
    this.setWave(wave);
    this.hideBoss(!m.bossHealth);
    if (m.bossHealth) {
      this.setBossName(m.bossHealth.name);
      this.setBossW(`scaleX(${clamp(m.bossHealth.frac, 0, 1).toFixed(3)})`);
    }
    this.hideRelay(m.relayProgress === null);
    if (m.relayProgress !== null) {
      this.setRelayPct(`Relay uplink ${Math.round(clamp(m.relayProgress, 0, 1) * 100)}%`);
      this.setRelayW(`scaleX(${clamp(m.relayProgress, 0, 1).toFixed(3)})`);
    }
    this.setSalv(String(m.salvage));
    this.hidePrompt(!m.interactPrompt);
    if (m.interactPrompt) this.setPrompt(m.interactPrompt);

    const key = m.slots.map((s) => `${s.id}|${s.name}|${+s.locked}|${+s.active}`).join(';');
    if (key !== this.slotsKey) {
      this.slotsKey = key;
      this.slots.replaceChildren();
      let n = 0;
      for (const s of m.slots) {
        const k = s.id === 'service_emitter' ? 'Q' : String(++n);
        const d = el('div', `hud-slot${s.active ? ' active' : ''}${s.locked ? ' locked' : ''}`, undefined, this.slots);
        el('span', 'k', k, d);
        el('span', undefined, s.locked ? `${s.name} (surrendered)` : s.name, d);
      }
    }
  }

  banner(text: string, kind: BannerKind, seconds = 3.2): void {
    window.clearTimeout(this.bannerTimer);
    this.bannerEl.textContent = text;
    this.bannerEl.className = `hud-blk hud-banner ${kind} show`;
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), Math.max(2.5, seconds) * 1000);
  }

  subtitle(speaker: string, text: string, seconds: number): void {
    window.clearTimeout(this.subTimer);
    this.subSpeaker.textContent = speaker;
    this.subText.textContent = text;
    this.subEl.classList.add('show');
    this.subTimer = window.setTimeout(() => this.subEl.classList.remove('show'), Math.max(2.5, seconds) * 1000);
  }

  clearTransient(): void {
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.subTimer);
    this.bannerEl.classList.remove('show');
    this.subEl.classList.remove('show');
  }

  debug(m: DebugModel | null): void {
    if (!m) {
      this.dbg.hidden = true;
      return;
    }
    const t =
      `frame ${m.frameMs.toFixed(1)}ms  p50 ${m.p50.toFixed(1)}  p95 ${m.p95.toFixed(1)}  p99 ${m.p99.toFixed(1)}\n` +
      `enemies ${m.liveEnemies} live / ${m.queuedEnemies} queued   proj ${m.projectiles}\n` +
      `draw ${m.drawCalls}  tris ${m.triangles}\n` +
      `seed ${m.seed}  wave ${m.wave}\nweapon ${m.weapon}\ncards ${m.cards.join(', ') || '-'}`;
    this.dbg.hidden = false;
    if (t !== this.dbgLast) {
      this.dbgLast = t;
      this.dbg.textContent = t;
    }
  }
}
