import { beforeEach, describe, expect, it } from 'vitest';
import {
  PROFILE_KEY,
  defaultProfile,
  defaultSettings,
  loadProfile,
  recordRunEnd,
  saveProfile,
} from '../src/profile/profile';

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return data;
}

describe('profile', () => {
  beforeEach(() => stubStorage());

  it('returns defaults when nothing is stored', () => {
    expect(loadProfile()).toEqual(defaultProfile());
    expect(defaultProfile().unlocks.arcScattergun).toBe(false);
  });

  it('recovers from corrupt JSON', () => {
    stubStorage({ [PROFILE_KEY]: '{not json' });
    expect(loadProfile()).toEqual(defaultProfile());
    stubStorage({ [PROFILE_KEY]: '42' });
    expect(loadProfile()).toEqual(defaultProfile());
  });

  it('clamps and repairs bad values', () => {
    stubStorage({
      [PROFILE_KEY]: JSON.stringify({
        version: 1,
        settings: { mouseSensitivity: 99, fov: 10, masterVolume: -3, renderScale: 'x', invertY: 'yes', showDebug: true },
        unlocks: { arcScattergun: 1 },
        stats: { runs: -4, extractions: 2.7, deaths: 'a', bestTimeSec: -1 },
      }),
    });
    const p = loadProfile();
    expect(p.settings.mouseSensitivity).toBe(5);
    expect(p.settings.fov).toBe(70);
    expect(p.settings.masterVolume).toBe(0);
    expect(p.settings.renderScale).toBe(defaultSettings().renderScale);
    expect(p.settings.invertY).toBe(false);
    expect(p.settings.showDebug).toBe(true);
    expect(p.unlocks.arcScattergun).toBe(false);
    expect(p.stats).toEqual({ runs: 0, extractions: 2, deaths: 0, bestTimeSec: null });
  });

  it('drops unknown ids and keys', () => {
    stubStorage({
      [PROFILE_KEY]: JSON.stringify({
        version: 1,
        feats: ['first_extraction', 'removed_feat', 7, 'first_extraction'],
        unlocks: { arcScattergun: true, laserCannon: true },
        extra: 1,
      }),
    });
    const p = loadProfile();
    expect(p.feats).toEqual(['first_extraction']);
    expect(p.unlocks).toEqual({ arcScattergun: true });
    expect('extra' in p).toBe(false);
  });

  it('round-trips through storage', () => {
    const p = defaultProfile();
    p.settings.fov = 100;
    expect(saveProfile(p)).toBe(true);
    expect(loadProfile().settings.fov).toBe(100);
  });

  it('works with storage disabled', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(loadProfile()).toEqual(defaultProfile());
    expect(saveProfile(defaultProfile())).toBe(false);
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('unlocks Arc Scattergun on first extraction only', () => {
    stubStorage();
    const p = defaultProfile();
    expect(recordRunEnd(p, 'dead', 120)).toEqual([]);
    expect(p.unlocks.arcScattergun).toBe(false);
    expect(recordRunEnd(p, 'extracted', 600)).toEqual(['Arc Scattergun']);
    expect(p.unlocks.arcScattergun).toBe(true);
    expect(recordRunEnd(p, 'extracted', 500)).toEqual([]);
    expect(p.stats).toMatchObject({ runs: 3, extractions: 2, deaths: 1, bestTimeSec: 500 });
  });
});
