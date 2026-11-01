# Sandstorm Biome Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At HUD speed 2.00× (internal speed 560), a sandstorm sweeps the screen and the biome behind it becomes desert (sand ground, dunes, sparse shrubs/rocks, warm horizon); restart restores the meadow.

**Architecture:** A pure-logic watcher fires once per run at speed ≥ 560 and resets on new runs; a storm module sweeps a noise-textured wall across the view and calls an `atPeak` callback that flips prebuilt meadow↔desert variants (texture/geometry swaps and visibility toggles) across the three scenery modules. Spec: `docs/superpowers/specs/2026-11-01-sandstorm-biome-design.md`.

**Tech Stack:** Vite 7 + vendored three.js, plain ES modules, `node:test` for pure logic, Playwright MCP tools for browser verification.

## Global Constraints

- Trigger: `state.phase === "playing" && state.speed >= 560`, exactly once per run; reset (instant, no storm) when phase enters `"playing"` from another phase with desert active.
- All desert variants (textures, geometries, card populations) are **prebuilt at load**; biome swaps are reference/visibility changes only — no mid-run generation.
- Obstacles (cacti), collision, scoring, HUD, character system, share card, menu: untouched.
- Storm: ~1.6 s sweep; reduced-motion (`prefers-reduced-motion: reduce`) = ~0.8 s centered fade, no lateral sweep; `atPeak` at ≈55% of duration; storm material `depthTest: false`, `depthWrite: false`, renderOrder 18 (above dust's 15, below nothing that matters — stars at 20 with depthTest false still draw above).
- No new npm dependencies.
- Tests: `node --test 'tests/**/*.test.mjs'` (glob form — Node v25.8.1 directory-arg bug); suite must stay green (4 existing + new).
- Browser runs use the determinism preamble: `page.goto` → wait ~1.2 s → open all `<details>` → click `#stop-button` if enabled → wait 400 ms → Space starts keyboard mode. Console whitelist (ignore): favicon.ico 404, MediaPipe XNNPACK log, `odml.pa.googleapis.com` proxy error, three.js sigmaRadians warnings, `character.json`/`character.glb` 404s when no custom character.
- Speed-probe / instrumentation patches are **temporary** — revert before commit and verify `git diff` is empty of them.
- Every commit message ends with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Reference facts: HUD multiplier = `state.speed / 280`; speed formula `state.speed = Math.sqrt(280**2 + 16 * state.distance)` at src/dino-game.js:81; `reducedMotion` matchMedia already exists in runner-scene.js; scenery modules: desert-scene.js (146 lines), cloud-sky.js (129), forest-cards.js (267).

---

### Task 1: Biome watcher (`src/biome-watcher.js`) with node:test

**Files:**
- Create: `src/biome-watcher.js`
- Test: `tests/biome-watcher.test.mjs`

**Interfaces:**
- Consumes: nothing (pure logic, no THREE).
- Produces: `createBiomeWatcher({ onTrigger, onReset }) -> { update(state) }`. `onTrigger()` fires once when playing-phase speed first reaches ≥ 560; `onReset()` fires when a new run starts (phase enters `"playing"` from non-playing) **iff** the desert was active; both callbacks are optional-call safe.

- [ ] **Step 1: Write the failing test**

Create `tests/biome-watcher.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createBiomeWatcher } from "../src/biome-watcher.js";

test("fires trigger once when speed reaches 560 during play", () => {
  const events = [];
  const watcher = createBiomeWatcher({ onTrigger: () => events.push("trigger"), onReset: () => events.push("reset") });
  watcher.update({ phase: "playing", speed: 559 });
  watcher.update({ phase: "playing", speed: 560 });
  watcher.update({ phase: "playing", speed: 700 });
  assert.deepEqual(events, ["trigger"]);
});

test("reset fires on restart only when desert is active", () => {
  const events = [];
  const watcher = createBiomeWatcher({ onTrigger: () => events.push("trigger"), onReset: () => events.push("reset") });
  watcher.update({ phase: "idle", speed: 280 });
  watcher.update({ phase: "playing", speed: 280 });
  watcher.update({ phase: "playing", speed: 560 });
  watcher.update({ phase: "over", speed: 560 });
  watcher.update({ phase: "playing", speed: 280 });
  assert.deepEqual(events, ["trigger", "reset"]);
});

test("no reset after a meadow-only run", () => {
  const events = [];
  const watcher = createBiomeWatcher({ onTrigger: () => events.push("trigger"), onReset: () => events.push("reset") });
  watcher.update({ phase: "playing", speed: 300 });
  watcher.update({ phase: "over", speed: 340 });
  watcher.update({ phase: "playing", speed: 280 });
  assert.deepEqual(events, []);
});

test("second run can trigger again", () => {
  const events = [];
  const watcher = createBiomeWatcher({ onTrigger: () => events.push("trigger"), onReset: () => events.push("reset") });
  watcher.update({ phase: "playing", speed: 560 });
  watcher.update({ phase: "over", speed: 560 });
  watcher.update({ phase: "playing", speed: 280 });
  watcher.update({ phase: "playing", speed: 560 });
  assert.deepEqual(events, ["trigger", "reset", "trigger"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test 'tests/biome-watcher.test.mjs'`
Expected: FAIL — `Cannot find module` for `../src/biome-watcher.js`.

- [ ] **Step 3: Implement the watcher**

Create `src/biome-watcher.js`:

```js
const STORM_SPEED = 560;
export function createBiomeWatcher({ onTrigger, onReset }) {
  let fired = false, desert = false, wasPlaying = false;
  return { update(state) {
    const playing = state.phase === "playing";
    if (playing && !wasPlaying) {
      if (desert) {
        desert = false;
        onReset?.();
      }
      fired = false;
    }
    if (playing && !fired && state.speed >= STORM_SPEED) {
      fired = true;
      desert = true;
      onTrigger?.();
    }
    wasPlaying = playing;
  } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'tests/**/*.test.mjs'`
Expected: PASS — 8 tests total (4 existing matcher + 4 watcher), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/biome-watcher.js tests/biome-watcher.test.mjs
git commit -m "feat: biome watcher triggers the sandstorm once per run at 2.00x

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Sandstorm sweep module (`src/sandstorm.js`)

**Files:**
- Create: `src/sandstorm.js`

**Interfaces:**
- Consumes: vendored THREE at `./vendor/three.module.min.js`.
- Produces: `createSandstorm(scene) -> { trigger({ atPeak }), update(dt, zoom = 1, camera = null), active: boolean, intensity: number }`. `trigger` starts the sweep (ignored while active); `atPeak` fires once at ≈55% of the duration; `update` advances/positions/billboards the wall and returns whether still active; `intensity` is the 0..1 opacity envelope (0 when idle).

- [ ] **Step 1: Write the module**

Create `src/sandstorm.js`:

```js
import * as THREE from "./vendor/three.module.min.js";
const SWEEP = 1.6, FADE = 0.8, PEAK_AT = 0.55;
function sandTexture() {
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d"), image = ctx.createImageData(size, size);
  let seed = 4711;
  const random = () => {
    seed = seed * 1664525 + 1013904223 >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const patch = Math.sin(u * 3 + Math.cos(v * 2)) * 0.5 + Math.cos(v * 5 + u * 0.5) * 0.4 + Math.sin(u * 7 - v * 3) * 0.3 + 1.4;
    const alpha = Math.max(0, Math.min(1, patch * (0.55 + random() * 0.45)));
    const offset = (y * size + x) * 4;
    image.data[offset] = 226;
    image.data[offset + 1] = 196;
    image.data[offset + 2] = 150;
    image.data[offset + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
export function createSandstorm(scene) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const base = sandTexture();
  const layers = [0, 1, 2].map((i) => {
    const map = base.clone();
    map.needsUpdate = true;
    map.repeat.set(2 + i, 1);
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.visible = false;
    mesh.renderOrder = 18;
    scene.add(mesh);
    return { mesh, material, width: [30, 22, 15][i], height: [9, 8, 7][i], lag: i * 0.14 };
  });
  const envelope = (t) => Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) ** 0.7;
  let time = 0, active = false, peakFired = false, peak = null;
  return {
    get active() {
      return active;
    },
    get intensity() {
      return active ? envelope(time / (reducedMotion.matches ? FADE : SWEEP)) : 0;
    },
    trigger({ atPeak } = {}) {
      if (active) return;
      active = true;
      time = 0;
      peakFired = false;
      peak = atPeak || null;
    },
    update(dt, zoom = 1, camera = null) {
      if (!active) return false;
      time += dt;
      const duration = reducedMotion.matches ? FADE : SWEEP;
      const t = time / duration;
      for (const layer of layers) {
        const local = Math.min(1, Math.max(0, (t - layer.lag) / (1 - layer.lag)));
        const sweep = reducedMotion.matches ? 0 : 1 - local * 2;
        layer.mesh.position.set(sweep * (11 * zoom + layer.width * 0.2) + (zoom - 1) * 5, 1.6 * zoom + 0.4, 3);
        layer.mesh.scale.set(layer.width * zoom, layer.height, 1);
        layer.material.opacity = 0.92 * envelope(local);
        layer.mesh.visible = layer.material.opacity > 5e-3;
        if (camera) layer.mesh.quaternion.copy(camera.quaternion);
      }
      if (!peakFired && t >= PEAK_AT) {
        peakFired = true;
        peak?.();
      }
      if (t >= 1 + layers.at(-1).lag) {
        active = false;
        for (const layer of layers) layer.mesh.visible = false;
      }
      return active;
    }
  };
}
```

Design notes: three stacked translucent noise planes (leading wide wall + two trailing wisps with per-layer lag) sweep screen-right → screen-left, matching the scene's scroll direction. `depthTest: false` + renderOrder 18 draws the storm over scenery, character, and obstacles so the peak genuinely hides the swap. Reduced motion centers the wall (no lateral sweep) and shortens to 0.8 s. Texture `clone()` shares the canvas image — one generation, three repeats.

- [ ] **Step 2: Programmatic verification in the browser**

Dev server must be running (Global Constraints). Playwright: navigate to `http://127.0.0.1:5173/`, then `browser_evaluate`:

```js
async () => {
  const { createSandstorm } = await import("/src/sandstorm.js");
  const THREE = await import("/src/vendor/three.module.min.js");
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 2, -2, 0.1, 90);
  const storm = createSandstorm(scene);
  const planes = scene.children.filter((o) => o.renderOrder === 18);
  const peakAt = [];
  storm.trigger({ atPeak: () => peakAt.push(storm.intensity) });
  const dt = 1 / 60, samples = [];
  let stillActive = true;
  for (let f = 0; f < 130 && stillActive; f++) {
    stillActive = storm.update(dt, 1, camera);
    if (f % 10 === 0) samples.push({ f, x: +planes[0].position.x.toFixed(2), o: +planes[0].material.opacity.toFixed(2) });
  }
  return {
    planeCount: planes.length,
    samples,
    peakCount: peakAt.length,
    peakIntensity: peakAt[0],
    activeAtEnd: storm.active,
    allHiddenAtEnd: planes.every((p) => !p.visible),
    movedRightToLeft: planes[0].position.x < 0
  };
}
```

Expected: `planeCount: 3`; `samples` show x descending from ≈+11 toward negative and opacity rising then falling (peak ≈ 0.9); `peakCount: 1` with `peakIntensity` in (0.5, 1]; `activeAtEnd: false`; `allHiddenAtEnd: true`; `movedRightToLeft: true`. No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/sandstorm.js
git commit -m "feat: sandstorm sweep module hiding the biome swap at peak coverage

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Desert ground, dunes, and sky warmth (`desert-scene.js`, `cloud-sky.js`)

**Files:**
- Modify: `src/desert-scene.js` (grassTexture → parameterized; mountainGeometry palette param; createDesert prebuilds both variants; `setBiome`)
- Modify: `src/cloud-sky.js` (sky shader `warmth` uniform + `setWarmth`)

**Interfaces:**
- Consumes: `createForestCards(scene)` current return `{ update }` (its `setBiome` arrives in Task 4 — call via optional chaining).
- Produces: `createDesert(scene)` return gains `setBiome(biome: "meadow" | "desert")` — swaps `groundMaterial.map` between prebuilt grass/sand textures (same repeat/offset math via an active-texture pointer), swaps all three ridge meshes' `geometry` between prebuilt green/dune geometries, forwards to `forest.setBiome?.(biome)`, and calls `sky.setWarmth(biome === "desert" ? 1 : 0)`. `createCloudSky(scene)` return gains `setWarmth(value: number)` setting a `warmth` uniform mixed into the sky's horizon band.

- [ ] **Step 1: Parameterize the ground texture generator**

In `src/desert-scene.js`, rename `grassTexture()` to `groundTexture(rgb, seed)` and generate both variants in `createDesert`. Replace the existing `function grassTexture() { ... }` block with:

```js
function groundTexture([r, g, b], seed, grainScale = 1) {
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d"), image = ctx.createImageData(size, size);
  let state = seed + 1947;
  const random = () => {
    state = state * 1664525 + 1013904223 >>> 0;
    return state / 4294967296;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const patch = Math.sin(u * 2 + Math.sin(v)) * 5 + Math.cos(v * 3 + u) * 4 + Math.sin(u * 5 - v * 2) * 3;
    const grain = (random() - 0.5) * 2 * grainScale, offset = (y * size + x) * 4;
    image.data[offset] = r + patch * 0.6 + grain;
    image.data[offset + 1] = g + patch * 0.6 + grain;
    image.data[offset + 2] = b + patch * 0.4 + grain;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
```

Then in `createDesert`, replace `const nearTexture = grassTexture();` with:

```js
  const nearTexture = groundTexture([111, 163, 53], 9231);
  const sandTexture = groundTexture([222, 185, 143], 55019, 0.7);
  sandTexture.repeat.copy(nearTexture.repeat);
  sandTexture.offset.copy(nearTexture.offset);
  let groundMap = nearTexture;
```

(The original grass values — rgb(111,163,53), seed 9231 — are preserved exactly; sand is the spec's `#deb98f` with a softer grain.)

- [ ] **Step 2: Route the per-frame texture math through the active map**

In `createDesert`'s `update`, replace the two lines:

```js
    nearTexture.repeat.x = 20 * zoom;
    nearTexture.offset.x = 10 * (1 - zoom);
```

with:

```js
    groundMap.repeat.x = 20 * zoom;
    groundMap.offset.x = 10 * (1 - zoom);
```

(The initial `nearTexture.repeat.set(20, 29.5 * 9 / 26)` before these edits stays — it runs once at load on both textures via the copies above.)

- [ ] **Step 3: Parameterize the ridge geometry palette**

Change the signature `function mountainGeometry(seed)` → `function mountainGeometry(seed, low = "#64816d", high = "#94ae96")`, and change the color lerp line inside the vertex loop from:

```js
      const color = new THREE.Color("#64816d").lerp(new THREE.Color("#94ae96"), Math.pow(t, 3) * 0.7 + 0.025 * Math.sin(phase * 11 + seed));
```

to:

```js
      const color = new THREE.Color(low).lerp(new THREE.Color(high), Math.pow(t, 3) * 0.7 + 0.025 * Math.sin(phase * 11 + seed));
```

In `createDesert`, replace `const ridge = mountainGeometry(7), ...` so both variants are prebuilt:

```js
  const ridge = mountainGeometry(7), dunes = mountainGeometry(7, "#c9a86a", "#e0c896"), ridgeMaterial = ...
```

(keep the rest of that line — `new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })` — unchanged), and after the `mountains` array is built, nothing else changes; `setBiome` (Step 5) swaps `mesh.geometry`.

- [ ] **Step 4: Sky warmth uniform**

In `src/cloud-sky.js`:

1. The sky `ShaderMaterial` construction: add `uniforms: { warmth: { value: 0 } },` as a property (ShaderMaterial accepts `uniforms` in its constructor params — the material currently has none).
2. In its `fragmentShader`, declare the uniform and warm the horizon. Change:

```
      void main(){float h=smoothstep(-6.0,-.5,skyPos.y);
      vec3 color=mix(vec3(.78,.86,.88),vec3(.025,.20,.61),h);
```

to:

```
      uniform float warmth;
      void main(){float h=smoothstep(-6.0,-.5,skyPos.y);
      vec3 color=mix(vec3(.78,.86,.88),vec3(.025,.20,.61),h);
      color=mix(color,vec3(.85,.68,.46),warmth*(1.0-smoothstep(-1.5,4.0,skyPos.y))*.6);
```

3. In the returned API object (`return { update(...) {...} };`), capture the material reference before it (the `sky` mesh holds it: `sky.material`) and add:

```js
    setWarmth(value) {
      sky.material.uniforms.warmth.value = value;
    },
```

- [ ] **Step 5: `setBiome` on createDesert**

In `createDesert`, after `const sky = createCloudSky(scene);` add:

```js
  let biome = "meadow";
  function setBiome(next) {
    if (next === biome) return;
    biome = next;
    const desert = next === "desert";
    groundMap = desert ? sandTexture : nearTexture;
    groundMaterial.map = groundMap;
    mountains.forEach((mesh) => {
      mesh.geometry = desert ? dunes : ridge;
    });
    forest.setBiome?.(next);
    sky.setWarmth(desert ? 1 : 0);
  }
```

and add `setBiome` to the returned object: `return { setBiome, update(...) { ... } };`.

- [ ] **Step 6: Standalone verification in the browser**

Playwright `browser_evaluate` (page loaded first):

```js
async () => {
  const { createDesert } = await import("/src/desert-scene.js");
  const { createCloudSky } = await import("/src/cloud-sky.js");
  const THREE = await import("/src/vendor/three.module.min.js");
  const scene = new THREE.Scene();
  const sky = createCloudSky(scene);
  const desert = await createDesert(scene);
  const ground = scene.children.find((o) => o.isMesh && o.receiveShadow);
  const ridges = scene.children.filter((o) => o.isMesh && o.material?.vertexColors);
  const before = { map: ground.material.map, geo: ridges[0].geometry };
  sky.setWarmth(1);
  const warmth = scene.children[0].material.uniforms?.warmth?.value;
  desert.setBiome("desert");
  const afterDesert = { map: ground.material.map, geo: ridges[0].geometry };
  desert.setBiome("desert");
  const idempotent = afterDesert.map === ground.material.map;
  desert.update(120, 0.5, 0, 400, 1, 1 / 60);
  const repeatFollowsZoom = Math.abs(ground.material.map.repeat.x - 20) < 1e-6;
  desert.setBiome("meadow");
  const restored = { map: ground.material.map, geo: ridges[0].geometry };
  desert.update(130, 0.5, 0, 300, 1, 1 / 60);
  return {
    warmthIsOne: warmth === 1,
    groundSwapped: before.map !== afterDesert.map,
    ridgesSwapped: before.geo !== afterDesert.geo,
    idempotent,
    repeatFollowsZoom,
    restoredMeadow: restored.map === before.map && restored.geo === before.geo,
    sandRepeatMatches: afterDesert.map.repeat.y > 0
  };
}
```

Expected: every field `true`. (The `sky` uniform check reads the first scene child — createCloudSky adds the sky plane first in this fresh scene; if the assertion is brittle, instead capture the sky mesh by `renderOrder === -10`.) No console errors.

- [ ] **Step 7: Commit**

```bash
git add src/desert-scene.js src/cloud-sky.js
git commit -m "feat: prebuilt desert ground, dunes, and warm sky behind setBiome

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Desert card population (`forest-cards.js`)

**Files:**
- Modify: `src/forest-cards.js` (two new canvas kinds; sparse prebuilt desert batches; `setBiome`)

**Interfaces:**
- Consumes: existing `texture(kind)` canvas-card generator, batch scroll/parallax loop.
- Produces: `createForestCards(scene)` return gains `setBiome(biome: "meadow" | "desert")` — meadow meshes (canopy, all tree/grass/flower/cone/needle instanced meshes, tree shadows) ↔ desert meshes (prebuilt sparse shrub/rock instanced meshes, ~200 instances) via visibility toggles; the per-frame update positions whichever population is active.

- [ ] **Step 1: Add the two desert card textures**

Inside the existing `texture(kind, colorIndex = 0)` function, after the `if (kind === 9) { ... }` block, add:

```js
  if (kind === 10) {
    for (let i = 0; i < 26; i++) {
      const x = 128 + (random() - 0.5) * 60, angle = -Math.PI / 2 + (random() - 0.5) * 1.9, length = 60 + random() * 95;
      ctx.strokeStyle = ["#9a7d4e", "#b39666", "#7d6b45", "#8a815c"][i % 4];
      ctx.lineWidth = 2.5 + random() * 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x, 384);
      const midX = x + Math.cos(angle) * length * 0.5 + (random() - 0.5) * 26;
      ctx.quadraticCurveTo(midX, 384 + Math.sin(angle) * length * 0.55, x + Math.cos(angle) * length * 0.8, 384 + Math.sin(angle) * length);
      ctx.stroke();
    }
  }
  if (kind === 11) {
    const blobs = [[128, 300, 74, 58], [76, 322, 42, 34], [184, 318, 48, 36]];
    for (const [cx, cy, rx, ry] of blobs) {
      const shade = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
      shade.addColorStop(0, "#b0a290");
      shade.addColorStop(0.55, "#8d7f6d");
      shade.addColorStop(1, "#6a5e50");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,250,240,.28)";
    ctx.beginPath();
    ctx.ellipse(108, 282, 26, 13, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }
```

(Shrub: dry tan/olive twigs rooted at the card base like the flowers; rock: shaded gray-brown boulder cluster with a highlight.)

- [ ] **Step 2: Prebuild the sparse desert batches (hidden)**

In `createForestCards`, after the `needles` batch is added and before `return {`, add:

```js
  const desertMeshes = [], desertBatches = [];
  const desertRandom = rng(66413);
  const shrubItems = [];
  for (let i = 0; i < 130; i++) {
    const h = 0.28 + desertRandom() * 0.34;
    shrubItems.push({ x: desertRandom() * 40, z: -3.2 - desertRandom() * 8.5, h, w: h * (0.7 + desertRandom() * 0.4) });
  }
  const rockItems = [];
  for (let i = 0; i < 70; i++) {
    const h = 0.1 + desertRandom() * 0.22;
    rockItems.push({ x: desertRandom() * 40, z: -2.7 - desertRandom() * 9, h, w: 0.16 + desertRandom() * 0.26 });
  }
  for (const [items, kind, alphaTest] of [[shrubItems, 10, 0.3], [rockItems, 11, 0.4]]) {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ map: texture(kind), alphaTest, side: THREE.DoubleSide }), items.length);
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    desertMeshes.push(mesh);
    desertBatches.push({ mesh, items, forest: true });
  }
  const meadowMeshes = [canopy, ...batches.map((b) => b.mesh), ...shadows.map((s) => s.mesh)];
  let biome = "meadow", activeBatches = batches;
  function setBiome(next) {
    if (next === biome) return;
    biome = next;
    const desert = next === "desert";
    for (const mesh of meadowMeshes) mesh.visible = !desert;
    for (const mesh of desertMeshes) mesh.visible = desert;
    activeBatches = desert ? desertBatches : batches;
  }
```

- [ ] **Step 3: Drive the active population in update**

In the returned `update`, change the batch loop header from `for (const { mesh, items, ground, forest, meadow } of batches) {` to `for (const { mesh, items, ground, forest, meadow } of activeBatches) {`, and gate the shadow loop: wrap the existing `dummy.rotation.set(-Math.PI / 2, 0, -Math.atan2(...)); for (const { mesh, items } of shadows) { ... }` block in `if (biome === "meadow") { ... }`. Add `setBiome` to the returned object: `return { setBiome, update(...) { ... } };`.

(Desert cards live in the forest depth band — `forest: true` gives them the same retreat/parallax handling as the trees they replace.)

- [ ] **Step 4: Standalone verification in the browser**

Playwright `browser_evaluate` (page loaded first):

```js
async () => {
  const { createForestCards } = await import("/src/forest-cards.js");
  const THREE = await import("/src/vendor/three.module.min.js");
  const scene = new THREE.Scene();
  const forest = await createForestCards(scene);
  const meshes = scene.children.filter((o) => o.isInstancedMesh || o.isMesh);
  const visibleBefore = meshes.filter((m) => m.visible).length;
  const hiddenBefore = meshes.filter((m) => !m.visible).length;
  forest.update(500, 1, 1);
  forest.setBiome("desert");
  const desertVisible = meshes.filter((m) => m.visible);
  const desertHidden = meshes.filter((m) => !m.visible);
  forest.update(600, 1, 1);
  forest.setBiome("desert");
  forest.setBiome("meadow");
  const meadowBack = meshes.filter((m) => m.visible).length === visibleBefore;
  forest.update(700, 1, 1);
  return {
    hiddenBefore,
    desertVisibleCount: desertVisible.length,
    desertHiddenCount: desertHidden.length,
    desertVisibleAreSparse: desertVisible.every((m) => m.isInstancedMesh && m.count <= 130),
    meadowBack,
    updateRanInBothBiomes: true
  };
}
```

Expected: `hiddenBefore: 2` (the two prebuilt desert meshes), `desertVisibleCount: 2`, `desertHiddenCount: visibleBefore`, sparse check true, `meadowBack: true`, no exceptions from the three `update` calls. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/forest-cards.js
git commit -m "feat: sparse prebuilt shrub and rock cards for the desert biome

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Integration in `runner-scene.js`

**Files:**
- Modify: `src/runner-scene.js` (imports; storm + watcher after `createDesert` ~line 44; per-frame wiring before `camera.updateProjectionMatrix()` ~line 231)
- Modify (TEMPORARY, revert before commit): `src/dino-game.js:81` speed acceleration for verification

**Interfaces:**
- Consumes: `createBiomeWatcher` (Task 1), `createSandstorm` (Task 2), `desert.setBiome` (Tasks 3-4).
- Produces: the wired feature — watcher drives storm; storm's `atPeak` flips `desert.setBiome`; tiny storm camera nudge.

- [ ] **Step 1: Imports**

Add after line 2 (`import { createDust } from "./dust.js";`):

```js
import { createSandstorm } from "./sandstorm.js";
import { createBiomeWatcher } from "./biome-watcher.js";
```

- [ ] **Step 2: Create storm + watcher**

After `const desert = await createDesert(scene);` (line ~44) add:

```js
  const sandstorm = createSandstorm(scene);
  const watcher = createBiomeWatcher({
    onTrigger: () => sandstorm.trigger({ atPeak: () => desert.setBiome("desert") }),
    onReset: () => desert.setBiome("meadow")
  });
```

- [ ] **Step 3: Per-frame wiring**

Immediately before `camera.updateProjectionMatrix();` (line ~231) add:

```js
    watcher.update(state);
    sandstorm.update(dt, zoom, camera);
    if (sandstorm.active && !reducedMotion.matches) camera.position.y += Math.sin(now * 47) * 0.012 * sandstorm.intensity * zoom;
```

- [ ] **Step 4: End-to-end verification with a temporary speed probe**

1. Temporary probe: edit `src/dino-game.js` line 81 from `state.speed = Math.sqrt(280 ** 2 + 16 * state.distance);` to `state.speed = Math.sqrt(280 ** 2 + 128 * state.distance);` (8× distance accrual → 560 at ≈4.4 s). Do NOT commit this.
2. Playwright (`browser_run_code_unsafe`), with the determinism preamble from Global Constraints: Space to start → wait 4.4 s → screenshot mid-storm (~0.4 s after trigger; storm wall visibly covering part of the screen) → screenshot post-storm at ~7 s (desert: sand ground, dune ridges, shrubs/rocks, no flowers/trees/canopy, warm horizon) → read the HUD (`#speed` textContent) confirming ≥ "2.00×" → die on the next cactus (`waitForSelector("#game-card.crashed")`) → screenshot (death screen shows desert) → Space to restart → screenshot (meadow restored: green ground, forest, flowers).
3. Console check: whitelist only.
4. Revert the probe: `git checkout -- src/dino-game.js` and confirm `git diff src/dino-game.js` is empty.
5. Evidence under `/tmp/bunny-sandstorm/`.

- [ ] **Step 5: Commit**

```bash
git add src/runner-scene.js
git commit -m "feat: sandstorm biome switch wired into the runner at 2.00x speed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Regression pass (reduced motion, both characters, build)

**Files:**
- No code changes expected. Fix anything that regresses, in a separate commit with the failure evidence.

- [ ] **Step 1: Reduced-motion storm**

Playwright `browser_emulate_media` with `reducedMotion: "reduce"`, then the Task-5 probe flow (temporary `dino-game.js` edit, reverted after): at 2.00× the screen fades through sand tones without a lateral wall; post-fade the desert is in place. Screenshot. Reset emulation (`reducedMotion: null`).

- [ ] **Step 2: Both characters, full session**

Fixtures present (test figure) and absent (bunny): with the temporary probe, run to 2.00×, jump a cactus before and after the swap (collision unaffected), die, restart (meadow back). Screenshots + console whitelist check in both states. Leave fixtures present at the end.

- [ ] **Step 3: Suite + build**

Run: `node --test 'tests/**/*.test.mjs'` → 8/8 pass.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Commit (only if a fix was needed)**

```bash
git add -A
git commit -m "fix: regression fixes from the sandstorm biome pass

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** trigger/reset logic (§Architecture-2 → Task 1), storm sweep + reduced motion + atPeak (§1 → Task 2), ground/dunes/sky swaps + setBiome (§3 table rows 1-2 & 4 → Task 3), shrub/rock cards + visibility toggles + sparse population (§3 row 3 → Task 4), watcher→storm→swap wiring + camera nudge (§3 wiring → Task 5), prebuilt rule + restart masking + verification matrix incl. reduced-motion/both-characters/build (§Goals/Testing → Tasks 5-6). Non-goals (audio, obstacles) untouched by design.
- **Placeholder scan:** no TBDs; every code step shows complete code; the only temporary-patch steps (Task 5 Step 4, Task 6 Steps 1-2) specify the exact edit, its revert, and the cleanliness check.
- **Type consistency:** `createBiomeWatcher({onTrigger,onReset}).update(state)` matches Task 5's wiring; `createSandstorm(scene).trigger({atPeak})/update(dt,zoom,camera)/active/intensity` matches Tasks 2 and 5; `desert.setBiome("meadow"|"desert")` produced in Task 3 and consumed in Task 5; `forest.setBiome` produced in Task 4, consumed via optional chaining in Task 3 (guarded before Task 4 lands); texture kind numbers 10/11 used only in Task 4.
