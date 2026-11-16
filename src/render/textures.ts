import * as THREE from 'three';
import type { SignDef } from '../content/levelTypes';

/** Procedural canvas textures and small texture helpers (no assets needed). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeHazardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#16120e';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#d9a21b';
  const w = 64;
  for (let i = -4; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * w, 256);
    g.lineTo(i * w + w / 2, 256);
    g.lineTo(i * w + w / 2 + 256, 0);
    g.lineTo(i * w + 256, 0);
    g.closePath();
    g.fill();
  }
  // grime
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(20,14,8,${Math.random() * 0.18})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 6, 1 + Math.random() * 3);
  }
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, mid);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return finish(c);
}

export function makeRingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  g.shadowColor = '#fff';
  g.shadowBlur = 10;
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.stroke();
  return finish(c);
}

/** Soft star/streak used for muzzle flash. */
export function makeFlashTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(64, 64);
    g.rotate((i / 6) * Math.PI + 0.2);
    g.beginPath();
    g.moveTo(-62, 0);
    g.lineTo(0, -3.5);
    g.lineTo(62, 0);
    g.lineTo(0, 3.5);
    g.fill();
    g.restore();
  }
  return finish(c);
}

export function makeDecalTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.45, 'rgba(10,6,4,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return finish(c);
}

export function makeCrossTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#e9e4dc';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#c4281c';
  g.fillRect(24, 10, 16, 44);
  g.fillRect(10, 24, 44, 16);
  return finish(c);
}

const SIGN_STYLE: Record<SignDef['style'], { bg: string; fg: string; font: string; border: string }> = {
  stencil: { bg: '#2a2825', fg: '#d8d2c4', font: '700 {s}px "Rajdhani", "Arial Narrow", sans-serif', border: '#d8d2c4' },
  warning: { bg: '#d9a21b', fg: '#16120e', font: '700 {s}px "Rajdhani", "Arial Narrow", sans-serif', border: '#16120e' },
  scrawl: { bg: '#3a2c24', fg: '#b83a22', font: 'italic 600 {s}px "Segoe Print", "Comic Sans MS", cursive', border: '#3a2c24' },
};

export function makeSignTexture(def: SignDef): THREE.CanvasTexture {
  const px = 128; // pixels per meter
  const w = Math.max(64, Math.round(def.width * px));
  const h = Math.max(64, Math.round(def.height * px));
  const [c, g] = canvas(w, h);
  const st = SIGN_STYLE[def.style];
  g.fillStyle = st.bg;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.002; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 5, 1 + Math.random() * 2);
  }
  if (def.style !== 'scrawl') {
    g.strokeStyle = st.border;
    g.lineWidth = Math.max(3, h * 0.035);
    g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  }
  const lines = def.lines.length ? def.lines : [''];
  const lh = (h * 0.8) / lines.length;
  let size = Math.min(lh * 0.82, 96);
  g.fillStyle = st.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = st.font.replace('{s}', String(size));
  const widest = Math.max(...lines.map((l) => g.measureText(l).width), 1);
  if (widest > w * 0.9) {
    size *= (w * 0.9) / widest;
    g.font = st.font.replace('{s}', String(size));
  }
  lines.forEach((l, i) => {
    g.save();
    if (def.style === 'scrawl') g.rotate(((i % 2 ? 1 : -1) * 0.025));
    g.fillText(l, w / 2, h * 0.1 + lh * (i + 0.5));
    g.restore();
  });
  const t = finish(c);
  t.anisotropy = 8;
  return t;
}

/** Emissive mask for cooling slag: only the bright orange cracks glow. */
export function makeCrackEmissive(img: CanvasImageSource & { width: number; height: number }): THREE.CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size, size);
  g.drawImage(img, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i],
      gg = d.data[i + 1],
      b = d.data[i + 2];
    const heat = Math.max(0, Math.min(1, ((r - Math.max(gg, b) - 60) / 120) * (r / 255)));
    const e = heat * heat;
    d.data[i] = 255 * e;
    d.data[i + 1] = 150 * e;
    d.data[i + 2] = 40 * e;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
