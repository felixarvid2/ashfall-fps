/** Registry entry for a shipped asset (see src/content/assets.ts and docs/ASSETS.md). */
export interface AssetEntry {
  id: string;
  /** Path under public/assets/, e.g. 'props/the_pillar.glb'. */
  file: string;
  lods?: string[];
  kind: 'model' | 'skinned' | 'texture' | 'audio';
  /** Recorded real-world height in meters (models). */
  heightMeters?: number;
  /** Logical state → clip name inside the GLB (skinned). */
  clips?: Partial<Record<'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death', string>>;
  /** True when the GLB uses EXT_meshopt_compression. */
  meshopt?: boolean;
  /** Model forward axis before import rotation (default '-z'). */
  forward?: '+x' | '-x' | '+z' | '-z';
}

/** Resolve an asset path against Vite's base URL. */
export function assetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/${file}`;
}
