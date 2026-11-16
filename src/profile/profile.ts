import type { Profile, Settings } from '../ui/types';

export const PROFILE_KEY = 'slagwire.profile.v1';
/** Feat ids the profile may hold; anything else found in storage is dropped. */
export const KNOWN_FEATS = ['first_extraction', 'first_death'] as const;

export const SETTING_LIMITS: Record<
  Exclude<keyof Settings, 'invertY' | 'showDebug'>,
  { min: number; max: number }
> = {
  mouseSensitivity: { min: 0.1, max: 5 },
  fov: { min: 70, max: 110 },
  masterVolume: { min: 0, max: 1 },
  sfxVolume: { min: 0, max: 1 },
  ambienceVolume: { min: 0, max: 1 },
  cameraBob: { min: 0, max: 1 },
  screenShake: { min: 0, max: 1 },
  flashIntensity: { min: 0, max: 1 },
  renderScale: { min: 0.5, max: 1 },
};

export function defaultSettings(): Settings {
  return {
    mouseSensitivity: 1,
    invertY: false,
    fov: 90,
    masterVolume: 0.8,
    sfxVolume: 0.9,
    ambienceVolume: 0.6,
    cameraBob: 0.5,
    screenShake: 0.6,
    flashIntensity: 0.8,
    renderScale: 1,
    showDebug: false,
  };
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    settings: defaultSettings(),
    unlocks: { arcScattergun: false },
    stats: { runs: 0, extractions: 0, deaths: 0, bestTimeSec: null },
    feats: [],
  };
}

function num(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Clamp/repair arbitrary data into valid settings. Missing or bad fields fall back to defaults. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const L = SETTING_LIMITS;
  return {
    mouseSensitivity: num(raw.mouseSensitivity, d.mouseSensitivity, L.mouseSensitivity.min, L.mouseSensitivity.max),
    invertY: bool(raw.invertY, d.invertY),
    fov: num(raw.fov, d.fov, L.fov.min, L.fov.max),
    masterVolume: num(raw.masterVolume, d.masterVolume, 0, 1),
    sfxVolume: num(raw.sfxVolume, d.sfxVolume, 0, 1),
    ambienceVolume: num(raw.ambienceVolume, d.ambienceVolume, 0, 1),
    cameraBob: num(raw.cameraBob, d.cameraBob, 0, 1),
    screenShake: num(raw.screenShake, d.screenShake, 0, 1),
    flashIntensity: num(raw.flashIntensity, d.flashIntensity, 0, 1),
    renderScale: num(raw.renderScale, d.renderScale, L.renderScale.min, L.renderScale.max),
    showDebug: bool(raw.showDebug, d.showDebug),
  };
}

/** Validate a parsed value into a Profile; never throws. Unknown ids/keys are dropped. */
export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isObj(raw)) return d;
  const unlocks = isObj(raw.unlocks) ? raw.unlocks : {};
  const stats = isObj(raw.stats) ? raw.stats : {};
  const best = stats.bestTimeSec;
  const feats = Array.isArray(raw.feats)
    ? [...new Set(raw.feats.filter((f): f is string => typeof f === 'string' && (KNOWN_FEATS as readonly string[]).includes(f)))]
    : [];
  return {
    version: 1,
    settings: sanitizeSettings(raw.settings),
    unlocks: { arcScattergun: bool(unlocks.arcScattergun, false) },
    stats: {
      runs: count(stats.runs),
      extractions: count(stats.extractions),
      deaths: count(stats.deaths),
      bestTimeSec: typeof best === 'number' && Number.isFinite(best) && best > 0 ? best : null,
    },
    feats,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadProfile(): Profile {
  try {
    const s = storage();
    const text = s?.getItem(PROFILE_KEY);
    if (!text) return defaultProfile();
    const parsed: unknown = JSON.parse(text);
    if (isObj(parsed) && typeof parsed.version === 'number' && parsed.version !== 1) {
      // Unknown future/past schema: keep it untouched in storage, run on defaults.
      return defaultProfile();
    }
    return sanitizeProfile(parsed);
  } catch {
    return defaultProfile();
  }
}

/** Returns false when storage is unavailable (private mode, quota, disabled). */
export function saveProfile(p: Profile): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(PROFILE_KEY, JSON.stringify(sanitizeProfile(p)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record a finished run. Mutates `profile` and returns display names of anything
 * newly unlocked (empty if none). Caller should saveProfile() afterwards.
 */
export function recordRunEnd(profile: Profile, outcome: 'extracted' | 'dead', timeSec: number): string[] {
  const unlocked: string[] = [];
  profile.stats.runs += 1;
  if (outcome === 'extracted') {
    profile.stats.extractions += 1;
    if (Number.isFinite(timeSec) && timeSec > 0) {
      const b = profile.stats.bestTimeSec;
      if (b === null || timeSec < b) profile.stats.bestTimeSec = timeSec;
    }
    if (!profile.feats.includes('first_extraction')) profile.feats.push('first_extraction');
    if (!profile.unlocks.arcScattergun) {
      profile.unlocks.arcScattergun = true;
      unlocked.push('Arc Scattergun');
    }
  } else {
    profile.stats.deaths += 1;
    if (!profile.feats.includes('first_death')) profile.feats.push('first_death');
  }
  return unlocked;
}
