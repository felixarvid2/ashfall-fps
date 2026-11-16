# Weapon model provenance (2026-11-16)

## Pipeline note: fal.ai concept step FAILED, fell back to Meshy Text-to-3D
fal.ai could not be used: `https://fal.run/fal-ai/flux-pro/v1.1`, `https://queue.fal.run/...` and
`fal-ai/flux/dev` all returned HTTP 401 ("Authentication is required to access this application");
`https://api.fal.ai/<model path>` returns 404 (route not found) and `https://api.fal.ai/v1/models`
returns 401 "Invalid API key" with a dummy key (the proxy did not inject a real key for fal).
Therefore NO concept images exist (assets-src/weapons/*_concept.png absent) and the models were made
with Meshy Text to 3D (v2): preview (target_polycount 25000, remesh, triangle topology, ai_model latest)
then refine (enable_pbr true). Dummy `Bearer` header used; Meshy auth was proxy-injected.

## coil_carbine
- Prompt (identical for Meshy text-to-3d): "Single original fictional sci-fi weapon prop for a dark industrial first-person game, salvaged mining-colony pulse carbine. Compact squared body, a pair of exposed copper-colored coil loops inside a protective cage, scorched dark gunmetal, chipped off-white ceramic shell, restrained amber charge indicator and a chunky rectangular cell housing. Strong angular silhouette. Rear three-quarter view with the grip, rear housing, side panels and front end visible. Neutral studio lighting, plain background, entire isolated prop, clean edges, no hands, no text, no logos."
- fal model / request id: none (failed, see above)
- Meshy preview task: 01a1e43a-d457-7293-9354-ef2a33e24684 ; refine task: 01a1e43c-1a90-737a-8fdd-97e7f1356bb8
- Raw: assets-src/weapons/coil_carbine_meshy_raw.glb (9.67 MB)
- Final: public/assets/weapons/coil_carbine.glb (1.8 MB)
- Modifications: gltf-transform resize textures to 1024x1024, then webp texture compression (requires EXT_texture_webp; three.js GLTFLoader supports it in modern browsers). No meshopt/draco. No geometry edits, no re-orientation, no re-scaling.

## arc_scattergun
- Prompt: "Single original fictional sci-fi weapon prop for a dark industrial first-person game, repurposed refinery arc discharge tool. Broad short body with two heavy ceramic jaws around a fork-shaped emitter, thick ribbed heat sinks, dark scratched steel, worn burnt-orange paint and a restrained blue-white energy channel. Heavier and wider than a carbine, clear silhouette from behind. Rear three-quarter view with the grip, rear housing and full emitter visible. Neutral studio lighting, plain background, entire isolated prop, clean edges, no hands, no text, no logos."
- fal model / request id: none (failed)
- Meshy preview task: 01a1e43a-f67f-7663-87a1-c86e6a014f5c ; refine task: 01a1e43c-1b6e-7674-be5c-9be16fc98345
- Raw: assets-src/weapons/arc_scattergun_meshy_raw.glb (7.89 MB)
- Final: public/assets/weapons/arc_scattergun.glb (1.6 MB); same modifications as above.

## Geometry (both, unmodified from Meshy)
Bounding box ~1.90 x 0.77 x 0.48 (X x Y x Z) for carbine, 1.90 x 0.76 x 0.57 for scattergun, centered near origin, ~37k verts.
Barrel axis = X; muzzle at -X (wide end), stock/rear at +X (narrow). Up = +Y. The game must rotate/scale (e.g. rotate Y by +90deg so -X maps to -Z forward) and scale to first-person size.

## License notes
- Meshy outputs: per Meshy's terms, paid-plan users own generated assets (confirm plan/terms before shipping).
- No fal.ai/FLUX outputs were used, so no FLUX license applies.

## Manual cleanup suggestions
- Models are AI-generated, not hand-rigged: no separate moving parts (coil, jaws, indicator are fused into one mesh/material); fake-emissive details are baked into texture.
- Generated from text only (no concept image), so exact prompt details (coil cage, fork emitter/two jaws) are interpreted loosely; scattergun reads as a heavy cylindrical-barrel gun rather than forked ceramic jaws. Rear/stock is thin and may be slightly distorted. Hand (grip) placement not checked in game.
- Raw previews: coil carbine is a white-ceramic body with visible copper coils in a cage; scattergun is dark steel with a ribbed heat-sink barrel and orange accents.
