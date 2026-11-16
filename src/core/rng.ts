/**
 * Deterministic seeded RNG (mulberry32 core, FNV-1a + murmur3-finalizer hash for
 * seeding). `fork(tag)` derives an independent stream from the root seed and the
 * tag only, so consuming one stream never changes another. Draft rolls, spawn
 * templates, pickups and cosmetic noise each get their own fork.
 */

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private a: number;
  readonly key: string;

  constructor(seed: string | number) {
    this.key = String(seed);
    this.a = hashString('rng:' + this.key);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** Index chosen proportionally to weights; -1 when all weights are <= 0. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) if (w > 0) total += w;
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]!;
      if (w <= 0) continue;
      r -= w;
      if (r < 0) return i;
    }
    for (let i = weights.length - 1; i >= 0; i--) if (weights[i]! > 0) return i;
    return -1;
  }

  /** Independent child stream; depends only on this stream's key and the tag. */
  fork(tag: string): Rng {
    return new Rng(this.key + '|' + tag);
  }
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly seed like "K7QX-M2PA". */
export function randomSeed(): string {
  const bytes = new Uint32Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 2 ** 32);
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += SEED_ALPHABET[bytes[i]! % SEED_ALPHABET.length];
  }
  return s;
}

/** Normalise manual seed entry: trim, upper-case, max 24 chars; empty → null. */
export function normalizeSeed(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, '-').slice(0, 24);
  return s.length ? s : null;
}
