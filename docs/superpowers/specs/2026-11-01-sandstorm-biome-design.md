# Sandstorm Biome Switch — Design

Date: 2026-11-01
Status: Approved (conversation)

## Background

Bunny Run's scenery is a flower meadow built from four layers: a canvas-textured ground plane with a parallax shader (`desert-scene.js`), billboard tree/flower cards (`forest-cards.js`), green vertex-colored ridge mountains (`desert-scene.js`), and a shader sky with sun and clouds (`cloud-sky.js`). Speed is monotonic within a run (`state.speed = sqrt(280² + 16·distance)`); the HUD multiplier is `speed / 280`, so **2.00× = speed 560**, reached ≈35 s into a run. Restart resets speed to 280.

Goal: when the HUD reaches 2.00×, a sandstorm sweeps across the screen and the biome behind it becomes desert — sand ground, dune-colored ridges, sparse dry shrubs and rocks instead of the flower forest, a warm sand haze at the horizon. Obstacles (cacti), collision, scoring, and the character system are untouched.

## Goals / Non-Goals

**Goals**

1. Trigger once per run at `state.speed >= 560` during the playing phase.
2. Sandstorm sweep: a sand-colored procedural noise wall entering screen-right, exiting screen-left over ~1.6 s, hiding an instant biome swap executed at peak coverage (mid-sweep, ≈55% through; opacity is at full coverage from ≈50% to ≈60%).
3. Desert biome content: sand ground texture, sand-palette dunes, sparse shrub+rock cards, warm horizon haze. Clouds unchanged.
4. Death screen keeps the desert; restarting resets to meadow instantly (the restart transition masks the swap-back).
5. `prefers-reduced-motion`: storm becomes a short gentle fade; swap still hidden by peak opacity.

**Non-Goals**

- Wind/storm audio (game-audio is out of scope; can be added separately later).
- Any change to obstacles, spawn logic, collision, scoring, HUD, character, share card, or menu preview (they render the live scene; dying in the desert naturally yields a desert share card — accepted behavior).
- Reverting the biome mid-run (speed is monotonic; no hysteresis needed).

## Architecture

Three units, wired in `runner-scene.js`:

```
createBiomeWatcher()  ──watches state──▶ fires trigger/reset events
        │ trigger(atPeak)
        ▼
createSandstorm(scene) ──sweeps──▶ calls atPeak at max coverage
        │ atPeak
        ▼
desert.setBiome("desert" | "meadow")  ──▶ ground/mountain/forest/sky swaps
```

### 1. `src/sandstorm.js` (new) — the sweep

`createSandstorm(scene) -> { trigger({ atPeak }), update(dt, zoom, camera), active }`

- 3–4 stacked translucent planes with a shared procedural sand-noise canvas texture (same seeded-canvas idiom as the ground texture), spanning the visible width, drifting at slightly different speeds for depth.
- `trigger` starts a ~1.6 s right→left sweep (matching the scene's scroll direction — the runner runs *into* the storm). Opacity ramps up to ~full coverage around 45–55% of the sweep, back down after; `atPeak` fires exactly once near max coverage.
- Planes billboard against `camera` each update; recycle to hidden when idle.
- Reduced motion (`prefers-reduced-motion` matches): no lateral sweep — a ~0.8 s symmetric fade to peak opacity and back, `atPeak` at midpoint.
- No shadows, `depthWrite: false`, rendered above scenery but below stars' renderOrder games (storm uses its own high renderOrder; stars overlay fine — verify draw order in implementation).

### 2. `src/biome-watcher.js` (new) — trigger/reset logic

`createBiomeWatcher({ onTrigger, onReset }) -> { update(state) }`

- Fires `onTrigger` once when `state.phase === "playing" && state.speed >= 560 && !fired`.
- When `state.phase` transitions into `"playing"` from any other phase (new run, including the first), resets internal flags and fires `onReset` **iff** the desert was active (no-op otherwise). `onReset` swaps back to meadow instantly — the restart UI transition masks it.
- Pure logic, no THREE dependency.

### 3. Biome content swap — `setBiome(biome)` on existing modules

All swaps are instant (hidden by the storm); both variants are **prebuilt at load** so the swap is pointer changes, no mid-run texture generation.

| Module | Meadow (current) | Desert |
|---|---|---|
| `desert-scene.js` ground | grass canvas texture | sand canvas texture (same generator idiom, warm sand palette ≈ `#deb98f` with grain), prebuilt; swap `material.map` |
| `desert-scene.js` mountains | green vertex colors (`#64816d`→`#94ae96`) | second prebuilt geometry with sand palette (`#c9a86a`→`#e0c896`); swap `mesh.geometry` on all three ridge meshes |
| `forest-cards.js` | flower/tree/grass cards | two new canvas card kinds — dry shrub (sparse tan/olive twigs) and rock (rounded gray-brown with shading) — plus a sparse mode: on swap, fade out current cards over the storm duration, then repopulate with shrubs/rocks at roughly one-third the card count with proportionally wider spacing (same scroll/parallax/recycling system, no new machinery); `setBiome("meadow")` restores the original population |
| `cloud-sky.js` sky shader | current blue gradient | a `warmth` uniform (0→1) mixed into the horizon band toward a warm sand haze; set to 1 at swap, 0 on restore; clouds/sun untouched |

`desert.setBiome` orchestrates the four child swaps; `runner-scene.js` calls `watcher.update(state)` + `storm.update(dt, zoom, camera)` per frame and adds a tiny decaying camera nudge while `storm.active` (same math idiom as the landing shake, sub-0.02 world units).

## Error handling

- All textures/geometries prebuilt at load — a swap can never allocate or fail mid-run.
- Storm is purely visual; if reduced-motion query is unavailable it defaults to the full sweep.
- Watcher state resets are idempotent (firing reset when already meadow is a no-op).

## Testing / verification

Browser-based (existing Playwright patterns from this branch; determinism preamble + known-noise console whitelist):

1. **Sweep moment**: reach 2.00× (can be accelerated for testing via a temporary speed probe — e.g. debug `state.speed` injection, removed before commit), capture mid-sweep (storm wall visible) and post-sweep (desert: sand ground, dunes, shrubs/rocks, no flowers) screenshots.
2. **Trigger exactness**: HUD reads exactly 2.00× when the storm fires; fires once per run (ride through 2.01×, 2.05× — no second storm).
3. **Death keeps desert**: die after the swap → death screen shows desert.
4. **Restart restores**: restart → meadow back (ground/mountains/forest/sky all meadow), no storm on the new run's start; second run reaching 2.00× storms again.
5. **Reduced motion**: emulate `prefers-reduced-motion: reduce` → fade-style transition, swap still hidden.
6. **Fallback/character independence**: works with the bunny (fixtures absent) and the test figure (present); obstacles/collision unaffected (clear a cactus before and after the swap).
7. Console clean (known noise only); `node --test` suite still 4/4; `npm run build` succeeds.
