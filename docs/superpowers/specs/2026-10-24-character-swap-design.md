# Model-Agnostic Character & Jump Feedback — Design

Date: 2026-10-24
Status: Approved (conversation)

## Background

Bunny Run's player character is hard-wired to `public/models/snacky-bunny/bunny.glb`. The loader and animation code reference bunny-specific node names (`head`, `earL/R`, `armL/R`, `footL/R`, `short_leg_footL/R`) and a material named `bunny_eye`. The jump feel is built from: rubber squash/stretch (`rubber-body.js`), ear-chain vertex physics (`elastic-ear.js`), limb spring swings, takeoff camera bounce, and a forward tumble on death (`bunny-fall.js`).

Goal: let the owner drop **any** GLB into `public/models/character/` and have the game use it everywhere (game, menu preview, share card), with graceful degradation for missing parts. Plus two gameplay changes the owner requested: **landing feedback** (camera shake + dust) and a **new death action** (keel over backward, eyes closed).

Personal/local use only; no distribution concerns are introduced by this repo change itself — the game ships no new art assets.

## Goals / Non-Goals

**Goals**

1. `character.glb` + optional `character.json` under `public/models/character/` override the bunny; absent files → exact current behavior (bunny fallback).
2. Generic part auto-detection with fuzzy name matching; manual override via config.
3. Cap/hat "flow" physics on a configured part.
4. Death = keel over backward to lying flat with a small settle bounce, eyes close; small dust puff.
5. Landing = decaying camera shake + dust puff scaled by fall height.
6. Menu preview and share card use the same character source.

**Non-Goals**

- Skeletal animation retargeting / GLB animation clips (all motion stays procedural).
- In-game character picker or settings UI.
- Shipping any new default character art.

## 1. Character loading — new `src/character.js`

Single loader used by `runner-scene.js`, `ready-bunny.js`, and the share-card path.

- Try `fetch` of `models/character/character.json` (relative to `import.meta.env.BASE_URL`); 404 → defaults. Then try `character.glb`; 404 → fall back to `models/snacky-bunny/bunny.glb` with bunny-specific behavior identical to today.
- Loader returns: `{ model, parts, config, isFallback }` where `parts` maps canonical names (`head, armL, armR, footL, footR, eyes, flowParts[]`) to resolved nodes (or `null`).
- **Auto-detection**: case-insensitive scan of node names; separators (`_`, `-`, `.`, space) ignored; left/right recognized from suffix/prefix `l/r`, `left/right`; canonical names accept synonyms (`arm/hand`, `foot/leg/shoe`, `head`).
- **Config schema** (`character.json`):

```json
{
  "parts": {
    "head": "Head_01",
    "armL": "arm.left", "armR": "arm.right",
    "footL": "shoe_l", "footR": "shoe_r",
    "flowParts": ["cap"],
    "eyes": { "nodes": ["eyeL", "eyeR"], "material": "eye" }
  },
  "yaw": 90
}
```

- `parts.*` (string) pins a canonical part to an exact node name; `flowParts` lists nodes that get pivot flow physics; `eyes` is optional — `nodes` (independent eye meshes, close by scaling Y to ~8% around the mesh center) or `material` (single mesh matched by material name; close via the existing vertex-squint path). `yaw` is degrees of facing correction applied once at load (default 0; the runner's existing `-90°` body yaw stays as-is and stacks on top).
- Materials: keep the existing vinyl `MeshPhysicalMaterial` conversion for every mesh, whatever the model.
- Scale normalization stays where it is (fits `DINO.height`), so no scale config is needed.

## 2. Animation mapping

- **Limbs**: existing pivot + spring swing; a missing part is skipped silently (no pivot created).
- **Bunny-only paths**: `short_leg_footL/R` hiding and `elastic-ear` vertex chains run only when the corresponding nodes exist (i.e., fallback bunny). Custom characters never enter these paths.
- **Flow parts (cap)**: for each configured node, create a pivot group at the part's bounding-box bottom-center (same reparent technique as limbs, [runner-scene.js:90-100]), driven by `createSpring`/`stepSpring`. Targets: lean back on takeoff (~jump impulse), settle forward on descend, spring back at rest. Amplitudes tuned small (≤ ~0.5 rad) so arbitrary geometry stays plausible.
- **Eyes on death**: if `eyes.nodes` → scale-Y close over ~0.15 s; else if `eyes.material` → existing vertex squint driven to full amount; else skipped (keel-over carries the death read).
- **Head spring** (`head` exists): unchanged behavior.
- **Share card**: uses the canonical `head` if present (icon crop + card pose); otherwise renders the full model. Eye-specific card fixups apply only when eyes were resolved.

## 3. Death action (replaces tumble)

Replace `bunny-fall.js` usage with a new keel-over:

- Pivot at the feet (group origin already sits at ground level): rotate around the scene Z axis from standing lean to lying flat (backward, i.e., head away from run direction) with an ease-out plus one small settle bounce (~0.35 s total).
- Eyes close over the first ~0.15 s (per §2).
- One small dust puff where the body lands.
- `bunny-fall.js` is deleted (both characters use the new action); its import sites updated.

## 4. Landing feedback

- **Detection**: in `runner-scene.render`, playing-phase transition of `state.y` from `> 0` to `=== 0` with prior downward `state.vy`.
- **Camera shake**: reuse the decaying-sinusoid pattern from the takeoff bounce / death shake; amplitude scaled by impact speed, clamped small (~≤ 0.05 world units, ~0.15 s). Off under `prefers-reduced-motion` (same guard as takeoff bounce).
- **Dust**: new `src/dust.js` — fixed pool of ~8 billboarded soft beige quads (matches meadow palette), spawned at the feet on landing; velocities outward+up, gravity-lite, fade+shrink over ~0.4 s, then recycled. Spawn count / initial size scale with fall height. Also used (2–3 particles) by the death keel-over.
- **Audio**: none (out of scope).

## 5. Touch points

| File | Change |
|---|---|
| `src/character.js` | **new** — loader + name matching + config merge |
| `src/dust.js` | **new** — particle pool |
| `src/runner-scene.js` | use `character.js`; cap flow pivots; keel-over death; landing shake + dust; share card via canonical parts |
| `src/ready-bunny.js` | use `character.js`; arm pivots / head icon via canonical parts |
| `src/bunny-fall.js` | **delete** (replaced by keel-over) |
| `src/elastic-ear.js`, `src/bunny-limbs.js` | kept; only invoked on the bunny fallback path |
| `README.md` | short bilingual "swap your character" section (drop-in path + config reference) |

`main.js` needs no change (state already exposes `y`, `vy`, `jumps`, `phase`).

## Error handling

- Any loader failure (bad GLB, malformed JSON) → log a console warning and fall back to the bunny. The game must never hard-fail because of a user-supplied asset.
- Missing parts at any usage site → skip that animation; never assume presence beyond the loader's resolved map.

## Testing / verification

No JS test harness exists in the repo; verification is end-to-end via the dev server + Playwright:

1. **Fallback unchanged**: with no `character/` files, game plays exactly as before (bunny, ear physics, tumble-less new death, no errors).
2. **Generic path**: generate a neutral blocky test character GLB (script under `scripts/`, parts named `Head_01`, `arm.left`, `shoe_l/r`, `cap`, `eyeL/eyeR` — deliberately non-bunny naming to exercise fuzzy matching + config) and verify: runs, jumps, cap flows, landing shake + dust visible, death keels over with eyes closing, menu preview + share card render it.
3. **Broken asset**: malformed GLB at the character path → game still boots on the bunny with a console warning.
4. Screenshot evidence for each state.
