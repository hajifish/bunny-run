# Character Swap & Jump Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player character swappable via `public/models/character/character.glb` (+ optional `character.json`), add landing camera shake + beige dust, and replace the death tumble with a keel-over-backward + closed-eyes action.

**Architecture:** A new `character.js` loader resolves body parts by fuzzy node-name matching with config override, and every consumer (runner scene, menu preview, share card) works off the resolved part map with graceful degradation. Death and landing feedback are small self-contained modules (`keel-over.js`, `dust.js`) driven from `runner-scene.js`'s render loop. Spec: `docs/superpowers/specs/2026-10-24-character-swap-design.md`.

**Tech Stack:** Vite 7 + three.js (vendored ESM), plain ES modules, `node:test` for the one pure-logic module, Playwright MCP tools against the dev server for end-to-end verification.

## Global Constraints

- Node.js 22+ (`node --version` must be ≥ 22). Dev server: `npm run dev` → `http://127.0.0.1:5173/` (background task; check with `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` → `200`, start it if down).
- **No new npm dependencies.**
- No unit-test framework exists; only `src/character-names.js` gets `node:test` tests (it is dependency-free on purpose so node can import it). Everything else is verified end-to-end in the browser via Playwright MCP tools (`mcp__plugin_playwright_playwright__browser_*`; `browser_run_code_unsafe` for timed sequences, `browser_console_messages` for errors).
- Dust color is 米黄 beige `#e8dcc4` (owner-specified).
- The bunny fallback must stay byte-for-byte behavior-identical when `public/models/character/` has no files, except the death action (keel-over replaces the tumble for both characters, per spec §3).
- `public/models/character/` is added to `.gitignore` — user-supplied models never get committed.
- Every game-boot verification includes checking `browser_console_messages` for new errors (the pre-existing `favicon.ico` 404 and the MediaPipe "XNNPACK delegate" log are known noise).
- Commit at the end of each task; end commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Reference game constants ([src/dino-game.js](../../src/dino-game.js)): `JUMP_SPEED = 650` (initial upward `state.vy`), `state.vy` is zeroed by tick on the same frame `state.y` hits 0, `state.y` freezes at death, `DINO = { x: 110, width: 54 }`.

---

### Task 1: Part-name matcher (`src/character-names.js`) with node:test

**Files:**
- Create: `src/character-names.js`
- Create: `tests/character-names.test.mjs`

**Interfaces:**
- Consumes: nothing (dependency-free module).
- Produces: `matchPart(names: string[], canonical: string) -> string | null`. `canonical` is one of `"head"`, `"armL"`, `"armR"`, `"footL"`, `"footR"`, `"eyeL"`, `"eyeR"`, `"cap"`. Returns the first matching name from `names`, or `null`. Also exports `analyzeName(name: string) -> { base: "head"|"arm"|"foot"|"eye"|"cap", side: "l"|"r"|null } | null` (used by tests; `matchPart` is the only production consumer).

- [ ] **Step 1: Write the failing test**

Create `tests/character-names.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { matchPart } from "../src/character-names.js";

test("matches common rig naming styles", () => {
  const names = ["Body", "Head_01", "arm.left", "arm.right", "shoe_l", "shoe_r", "Cap", "eyeL", "eyeR"];
  assert.equal(matchPart(names, "head"), "Head_01");
  assert.equal(matchPart(names, "armL"), "arm.left");
  assert.equal(matchPart(names, "armR"), "arm.right");
  assert.equal(matchPart(names, "footL"), "shoe_l");
  assert.equal(matchPart(names, "footR"), "shoe_r");
  assert.equal(matchPart(names, "cap"), "Cap");
  assert.equal(matchPart(names, "eyeL"), "eyeL");
  assert.equal(matchPart(names, "eyeR"), "eyeR");
});

test("matches prefix and compact side spellings", () => {
  const names = ["larm", "rarm", "footleft", "footright", "head"];
  assert.equal(matchPart(names, "armL"), "larm");
  assert.equal(matchPart(names, "armR"), "rarm");
  assert.equal(matchPart(names, "footL"), "footleft");
  assert.equal(matchPart(names, "footR"), "footright");
  assert.equal(matchPart(names, "head"), "head");
});

test("rejects ambiguous or unrelated names", () => {
  const names = ["leg", "capsule", "collar", "headband", "arm"];
  assert.equal(matchPart(names, "footL"), null);
  assert.equal(matchPart(names, "cap"), null);
  assert.equal(matchPart(names, "head"), null);
  assert.equal(matchPart(names, "armL"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `Cannot find module` for `../src/character-names.js`.

- [ ] **Step 3: Implement the matcher**

Create `src/character-names.js`:

```js
const SIDES = { left: "l", right: "r" };
const BASES = {
  head: ["head"],
  arm: ["arm", "hand"],
  foot: ["foot", "feet", "leg", "shoe", "boot"],
  eye: ["eye"],
  cap: ["cap", "hat"]
};
const SIDE_PROBES = [["left", "l"], ["right", "r"], ["l", "l"], ["r", "r"]];

export function analyzeName(name) {
  const flat = String(name).toLowerCase().replace(/[_.\-\s]+/g, "");
  let base = null;
  for (const [key, synonyms] of Object.entries(BASES)) {
    if (synonyms.some((synonym) => flat.includes(synonym))) {
      base = key;
      break;
    }
  }
  if (!base) return null;
  const remainder = (probe) => {
    if (flat.endsWith(probe[0])) return flat.slice(0, -probe[0].length);
    if (flat.startsWith(probe[0])) return flat.slice(probe[0].length);
    return null;
  };
  let side = null;
  for (const probe of SIDE_PROBES) {
    const rest = remainder(probe);
    if (rest && BASES[base].some((synonym) => rest.includes(synonym))) {
      side = probe[1];
      break;
    }
  }
  return { base, side };
}

function hasCleanBoundary(name, base) {
  const flat = String(name).toLowerCase().replace(/[_.\-\s]+/g, "");
  return BASES[base].some((synonym) => flat === synonym || flat.startsWith(synonym) && !/[a-z]/.test(flat.slice(synonym.length)));
}

export function matchPart(names, canonical) {
  const wantSide = /[lr]$/.test(canonical) ? canonical.slice(-1).toLowerCase() : null;
  const wantBase = canonical.replace(/[lr]$/, "").toLowerCase();
  for (const name of names) {
    const info = analyzeName(name);
    if (!info || info.base !== wantBase) continue;
    if (wantSide ? info.side === wantSide : info.side === null && hasCleanBoundary(name, info.base)) return name;
  }
  return null;
}
```

Design notes for the implementer: side detection strips a probe word from either end and requires the remainder to still contain a base synonym (so `leg` is not `footL`, but `foot_l` is). Unsided canonicals (`head`, `cap`) additionally require the synonym to sit at the name's start with only non-letters after it (so `capsule` and `headband` don't match, but `Head_01` does). Sided canonicals accept any trailing decoration (`arm.left.001` matches).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/`
Expected: PASS — 3 tests, all assertions green. If a case fails, fix the matcher, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/character-names.js tests/character-names.test.mjs
git commit -m "feat: fuzzy body-part name matcher for generic character models

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Character loader (`src/character.js`)

**Files:**
- Create: `src/character.js`

**Interfaces:**
- Consumes: `matchPart(names, canonical)` from Task 1; vendored `GLTFLoader` at `./vendor/GLTFLoader.js`; `import.meta.env.BASE_URL` (Vite, `"/"` in dev).
- Produces: `loadCharacter() -> Promise<{ model: THREE.Object3D, parts: { head: string|null, armL: string|null, armR: string|null, footL: string|null, footR: string|null, flowParts: string[], eyes: { nodes: string[], material: string|null } | null }, isFallback: boolean }>`. **`parts` values are node NAMES** (consumers call `model.getObjectByName`). On any load failure of the custom model it falls back to `models/snacky-bunny/bunny.glb` with `isFallback: true` and hardcoded bunny part names.

- [ ] **Step 1: Write the loader**

Create `src/character.js`:

```js
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { matchPart } from "./character-names.js";

const DEFAULTS = { model: "character.glb", yaw: 0, parts: {} };
const BUNNY_PARTS = {
  head: "head",
  armL: "armL",
  armR: "armR",
  footL: "footL",
  footR: "footR",
  flowParts: [],
  eyes: { nodes: [], material: "bunny_eye" }
};

async function fetchConfig(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return { ...DEFAULTS, ...await response.json() };
  } catch {
    return null;
  }
}

function resolveParts(names, pins) {
  const pick = (key) => {
    const pinned = pins[key];
    if (typeof pinned === "string" && names.includes(pinned)) return pinned;
    return matchPart(names, key);
  };
  const byNameOrMatch = (name) => names.includes(name) ? name : matchPart(names, name);
  return {
    head: pick("head"),
    armL: pick("armL"),
    armR: pick("armR"),
    footL: pick("footL"),
    footR: pick("footR"),
    flowParts: (pins.flowParts || []).map(byNameOrMatch).filter(Boolean),
    eyes: pins.eyes ? {
      nodes: (pins.eyes.nodes || []).map(byNameOrMatch).filter(Boolean),
      material: pins.eyes.material || null
    } : null
  };
}

export async function loadCharacter() {
  const root = import.meta.env.BASE_URL;
  const config = await fetchConfig(`${root}models/character/character.json`) || DEFAULTS;
  let model, isFallback = false;
  try {
    model = (await new GLTFLoader().loadAsync(`${root}models/character/${config.model}`)).scene;
  } catch {
    if (config.model !== DEFAULTS.model) console.warn("[character] custom model failed to load — using the bunny instead");
    model = (await new GLTFLoader().loadAsync(`${root}models/snacky-bunny/bunny.glb`)).scene;
    isFallback = true;
  }
  const names = [];
  model.traverse((node) => {
    if (node.name) names.push(node.name);
  });
  const parts = isFallback ? BUNNY_PARTS : resolveParts(names, config.parts || {});
  if (config.yaw) model.rotation.y += config.yaw * Math.PI / 180;
  return { model, parts, isFallback };
}
```

Note: a missing `character.glb` (the normal no-custom-character case) fails **silently** — the warning fires only when a non-default `model` filename was configured.

- [ ] **Step 2: Verify in the browser (bunny fallback)**

Dev server must be running (see Global Constraints). In Playwright: navigate to `http://127.0.0.1:5173/`, then `browser_evaluate`:

```js
async () => {
  const { loadCharacter } = await import("/src/character.js");
  const character = await loadCharacter();
  return { isFallback: character.isFallback, parts: character.parts };
}
```

Expected result: `isFallback: true`, `parts.head === "head"`, `parts.armL === "armL"`, `parts.eyes.material === "bunny_eye"`. No new console errors.

- [ ] **Step 3: Commit**

```bash
git add src/character.js
git commit -m "feat: character loader with config override and bunny fallback

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Test-character generator (`scripts/make-test-character.mjs`)

**Files:**
- Create: `scripts/make-test-character.mjs`
- Modify: `.gitignore` (append one line)

**Interfaces:**
- Consumes: nothing (writes glTF 2.0 JSON by hand).
- Produces: `public/models/character/test-character.gltf` (blocky figure, node names `Body`, `Head_01`, `Cap`, `CapBrim`, `eyeL`, `eyeR`, `arm.left`, `arm.right`, `shoe_l`, `shoe_r`) and `public/models/character/character.json` (config pinning eyes + flow parts). Later tasks load these to verify the generic path. The generated files are **not committed** (gitignored).

- [ ] **Step 1: Add `public/models/character/` to `.gitignore`**

Append to `.gitignore` so the line block reads:

```
node_modules/
dist/
public/vendor/
public/models/character/
.DS_Store
*.log
```

- [ ] **Step 2: Write the generator**

Create `scripts/make-test-character.mjs` (complete file):

```js
// Generates a neutral blocky test character (glTF 2.0, embedded base64 buffer)
// to exercise the generic character path: deliberately non-bunny node names.
// OVERWRITES public/models/character/character.json — move any real config
// aside first. Generated files are gitignored; run: node scripts/make-test-character.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

function box(name, [w, h, d], [x, y, z], color) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const faces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] }
  ];
  const positions = [], normals = [], indices = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const [px, py, pz] of face.v) positions.push(px + x, py + y, pz + z);
    for (let i = 0; i < 4; i++) normals.push(...face.n);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { name, positions, normals, indices, color };
}

const parts = [
  box("Body", [0.5, 0.62, 0.3], [0, 0.62, 0], [0.42, 0.5, 0.62]),
  box("Head_01", [0.46, 0.4, 0.42], [0, 1.16, 0], [0.93, 0.78, 0.6]),
  box("Cap", [0.5, 0.12, 0.48], [0, 1.42, 0.02], [0.3, 0.62, 0.36]),
  box("CapBrim", [0.42, 0.05, 0.18], [0, 1.39, 0.3], [0.26, 0.54, 0.31]),
  box("eyeL", [0.07, 0.09, 0.02], [-0.11, 1.2, 0.22], [0.1, 0.1, 0.12]),
  box("eyeR", [0.07, 0.09, 0.02], [0.11, 1.2, 0.22], [0.1, 0.1, 0.12]),
  box("arm.left", [0.12, 0.5, 0.14], [-0.33, 0.92, 0], [0.85, 0.7, 0.3]),
  box("arm.right", [0.12, 0.5, 0.14], [0.33, 0.92, 0], [0.85, 0.7, 0.3]),
  box("shoe_l", [0.16, 0.12, 0.26], [-0.15, 0.06, 0.04], [0.45, 0.32, 0.2]),
  box("shoe_r", [0.16, 0.12, 0.26], [0.15, 0.06, 0.04], [0.45, 0.32, 0.2])
];

const bin = [], bufferViews = [], accessors = [], meshes = [], materials = [], nodes = [];
let byteOffset = 0;
function addView(typedArray, target) {
  const pad = (4 - (byteOffset % 4)) % 4;
  if (pad) {
    bin.push(Buffer.alloc(pad));
    byteOffset += pad;
  }
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  bin.push(Buffer.from(bytes));
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
  byteOffset += bytes.byteLength;
  return bufferViews.length - 1;
}
function addAccessor(typedArray, componentType, type, count, target, minMax) {
  const view = addView(typedArray, target);
  const accessor = { bufferView: view, componentType, type, count };
  if (minMax) {
    accessor.min = minMax.min;
    accessor.max = minMax.max;
  }
  accessors.push(accessor);
  return accessors.length - 1;
}

const nameToNode = {};
for (const part of parts) {
  const positions = new Float32Array(part.positions);
  const normals = new Float32Array(part.normals);
  const indices = new Uint16Array(part.indices);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  materials.push({ name: part.name, pbrMetallicRoughness: { baseColorFactor: [...part.color, 1] } });
  const primitive = {
    attributes: {
      POSITION: addAccessor(positions, 5126, "VEC3", positions.length / 3, 34962, { min, max }),
      NORMAL: addAccessor(normals, 5126, "VEC3", normals.length / 3, 34962)
    },
    indices: addAccessor(indices, 5123, "SCALAR", indices.length, 34963),
    material: materials.length - 1
  };
  meshes.push({ name: part.name, primitives: [primitive] });
  nodes.push({ name: part.name, mesh: meshes.length - 1 });
  nameToNode[part.name] = nodes.length - 1;
}

nodes[nameToNode.Head_01].children = [nameToNode.Cap, nameToNode.eyeL, nameToNode.eyeR];
nodes[nameToNode.Cap].children = [nameToNode.CapBrim];

const gltf = {
  asset: { version: "2.0", generator: "bunny-run test-character generator" },
  scene: 0,
  scenes: [{ nodes: [nameToNode.Body, nameToNode.Head_01, nameToNode["arm.left"], nameToNode["arm.right"], nameToNode.shoe_l, nameToNode.shoe_r] }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: byteOffset, uri: `data:application/octet-stream;base64,${Buffer.concat(bin).toString("base64")}` }]
};

const target = join(process.cwd(), "public/models/character");
await mkdir(target, { recursive: true });
await writeFile(join(target, "test-character.gltf"), JSON.stringify(gltf));
await writeFile(join(target, "character.json"), JSON.stringify({
  model: "test-character.gltf",
  yaw: 0,
  parts: {
    flowParts: ["Cap"],
    eyes: { nodes: ["eyeL", "eyeR"] }
  }
}, null, 2));
console.log(`Wrote ${join(target, "test-character.gltf")} and character.json`);
```

Notes: the figure faces +Z (three.js convention) — the runner scene's existing `-90°` body yaw turns it to face the run direction, so `yaw: 0` is correct here. Head/eyes/cap are `Head_01`'s children so flow-pivot reparenting (Task 8) behaves like a real rig. `Cap` sits above the head bbox top; its own bbox bottom (the pivot base) is at the crown.

- [ ] **Step 3: Generate and verify the loader resolves it**

Run: `node scripts/make-test-character.mjs`
Expected: `Wrote .../public/models/character/test-character.gltf and character.json`

In Playwright (dev server running): reload `http://127.0.0.1:5173/`, then `browser_evaluate`:

```js
async () => {
  const { loadCharacter } = await import("/src/character.js");
  const character = await loadCharacter();
  return { isFallback: character.isFallback, parts: character.parts };
}
```

Expected: `isFallback: false`; `parts.head === "Head_01"`, `parts.armL === "arm.left"`, `parts.footR === "shoe_r"`, `parts.flowParts` contains `"Cap"` (matched fuzzily from the config pin), `parts.eyes.nodes` is `["eyeL","eyeR"]`. No console errors.

- [ ] **Step 4: Commit (script and .gitignore only — generated files stay local)**

```bash
git add scripts/make-test-character.mjs .gitignore
git commit -m "feat: blocky test-character generator for the generic model path

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Wire the loader into the runner scene

**Files:**
- Modify: `src/runner-scene.js` (imports at line 1-13; model load at lines 43-118; share-card head lookup at line 299-300)

**Interfaces:**
- Consumes: `loadCharacter()` from Task 2.
- Produces: inside `createRunnerScene`, the closure now provides `parts`, `isFallback`, `scaleEyeStates` (array of `{ mesh, base }`), and `head` (Object3D|null) — used by Tasks 5-8 and Task 10.

- [ ] **Step 1: Swap the imports**

In `src/runner-scene.js`, delete the line `import { GLTFLoader } from "./vendor/GLTFLoader.js";` and add `import { loadCharacter } from "./character.js";` (keep the `simplifyBunnyLimbs` import).

- [ ] **Step 2: Replace the hardcoded bunny load (lines 43-47)**

Replace:

```js
  const bunny = new THREE.Group();
  const model = (await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/snacky-bunny/bunny.glb`)).scene;
  simplifyBunnyLimbs(model);
  bunny.add(model);
```

with:

```js
  const bunny = new THREE.Group();
  const { model, parts, isFallback } = await loadCharacter();
  if (isFallback) simplifyBunnyLimbs(model);
  bunny.add(model);
```

- [ ] **Step 3: Generalize eye resolution (lines 49-61)**

Replace `o.material?.name === "bunny_eye"` with `o.material?.name === parts.eyes?.material` inside the existing traverse, and wrap the whole existing vertex-eyes traverse in `if (parts.eyes?.material) { ... }`. Immediately after the traverse, add scale-type eyes:

```js
  const scaleEyeStates = (parts.eyes?.nodes || []).map((name) => model.getObjectByName(name)).filter(Boolean).map((mesh) => ({ mesh, base: mesh.scale.y }));
```

- [ ] **Step 4: Generalize head, limbs, bunny-only parts (lines 78-118)**

Replace `const head = model.getObjectByName("head");` with:

```js
  const head = parts.head ? model.getObjectByName(parts.head) : null;
```

Replace the hardcoded limb loop input (lines 85-90) with part lookups (keep the pivot/spring body of the loop identical):

```js
  const limbSpecs = [
    [parts.armL, 1, false],
    [parts.armR, -1, false],
    [parts.footL, 1, true],
    [parts.footR, -1, true]
  ];
  for (const [partName, side, isLeg] of limbSpecs) {
    const node = partName ? model.getObjectByName(partName) : null;
    if (!node) continue;
```

(then the existing pivot-creation code unchanged, closing the loop as before).

Guard the bunny-only blocks: wrap the `short_leg_footL/R` hiding loop (lines 101-104) and the `ears` construction (lines 105-118) in `if (isFallback) { ... }`. For the ears block, assign `const ears = isFallback ? [ /* existing map over ["earL","earR"] */ ] : [];` so the render-loop `for (const ear of ears)` needs no change.

- [ ] **Step 5: Close scale-eyes on death**

In the render function, find the death-eye block driven by `amount` (the `if (amount !== lastEyeAmount) for (const { mesh, rest, centers } of eyes)` loop). Immediately after that loop (still inside the same `if (amount !== lastEyeAmount)`), add:

```js
      for (const { mesh, base } of scaleEyeStates) mesh.scale.y = base * (1 - 0.92 * amount);
```

- [ ] **Step 6: Generalize the share-card head (line 299-300)**

Replace `const cardHead = cardBunny.getObjectByName("head");` with `const cardHead = parts.head ? cardBunny.getObjectByName(parts.head) : null;` (the existing `if (cardHead)` guard handles null).

- [ ] **Step 7: Verify both characters end-to-end**

1. Remove the test fixtures: `rm -rf public/models/character` (regenerable via Task 3 script). Reload the page in Playwright. Play with Space (press Space to start, Space to jump). Expected: bunny renders and plays exactly as before; console has no new errors. Screenshot the running game.
2. Regenerate fixtures: `node scripts/make-test-character.mjs`. Reload. Expected: the blocky figure runs/jumps in place of the bunny; arms/legs swing (limb pivots resolved); eyes are visible; console clean. Screenshot.
3. Reload with DevTools-independent check via `browser_console_messages` after both runs: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/runner-scene.js
git commit -m "feat: runner scene drives any character via the generic loader

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Keel-over death (replaces the tumble)

**Files:**
- Create: `src/keel-over.js`
- Modify: `src/runner-scene.js` (fall state vars ~line 153, reset ~165-168, creation ~173-176, application ~198-204, eye amount ~205)
- Delete: `src/bunny-fall.js`

**Interfaces:**
- Consumes: `createSpring`/`stepSpring` from `src/rubber-body.js`.
- Produces: `createKeelOver() -> { step(dt) -> { angle: number, eyeClose: number, age: number, justSettled: boolean } }`. `angle` is relative additional Z-rotation (radians, 0 → ≈ π/2); `eyeClose` ramps 0→1 over 0.15 s; `justSettled` is true exactly once when the body reaches lying-flat. Task 7 consumes `justSettled` for the death dust puff.

- [ ] **Step 1: Write `src/keel-over.js`**

```js
import { createSpring, stepSpring } from "./rubber-body.js";

export function createKeelOver() {
  const spring = createSpring(0);
  spring.velocity = 9;
  const target = Math.PI / 2;
  let age = 0, settled = false;
  return { step(dt) {
    age += dt;
    const angle = Math.min(Math.PI / 2, Math.max(0, stepSpring(spring, target, dt, 55, 6.5)));
    let justSettled = false;
    if (!settled && target - angle < 0.06) {
      settled = true;
      justSettled = true;
    }
    return { angle, eyeClose: Math.min(1, age / 0.15), age, justSettled };
  } };
}
```

(The initial velocity 9 rad/s tips the body to ~90° in ~0.2 s; the spring's damping gives one small settle bounce. `Math.min/max` clamp any spring overshoot past flat.)

- [ ] **Step 2: Rewire `runner-scene.js`**

1. Imports: replace `import { createBunnyFall } from "./bunny-fall.js";` with `import { createKeelOver } from "./keel-over.js";`. Delete the file `src/bunny-fall.js`.
2. State vars (line ~153): delete `let fall = null, lastBodyAngle = -0.1, fallShape = null;` and add `let keel = null, keelStartY = 0, keelPose = null;`.
3. Reset (lines ~165-168): replace the `if (state.phase !== "over") { fall = null; fallShape = null; }` block with `if (state.phase !== "over") keel = null;`.
4. Delete the fall-creation block (lines ~173-176, `if (state.phase === "over" && !fall) { ... createBunnyFall ... }`).
5. Replace the fall-application block (lines ~198-204):

```js
    if (state.phase === "over" && !keel) {
      keel = createKeelOver();
      keelStartY = bunny.position.y;
    }
    if (keel) {
      keelPose = keel.step(dt);
      bunny.position.y = Math.max(0, keelStartY * (1 - Math.min(1, keelPose.age / 0.22)));
      bunny.rotation.z += keelPose.angle;
      // Task 7 fills this in: when keelPose.justSettled, burst dust at the body.
    }
```

(The +Z rotation tips the — after yaw — right-facing character backward, head away from the run direction; dropping `position.y` to 0 over 0.22 s handles mid-air deaths, where `state.y` freezes. Leave `keelPose.justSettled` unconsumed in this task — consuming it is Task 7's job.)

6. Eye amount (line ~205): replace `const amount = state.phase === "over" ? Math.min(1, deathAge / 0.1) : 0;` with `const amount = keelPose ? keelPose.eyeClose : 0;`, and reset `keelPose = null;` alongside the other per-frame resets (add it to the `if (state.phase !== "over") keel = null;` line: `if (state.phase !== "over") { keel = null; keelPose = null; }`).

- [ ] **Step 3: Verify death for both characters**

1. No-fixture fallback: `rm -rf public/models/character`, reload. Start with Space, deliberately don't jump → cactus hit. Expected: character tips backward to lying flat with one small settle; NOT a forward roll; mid-air deaths also end flat on the ground. Screenshot after settling. Eyes: bunny eyes squint closed (vertex path).
2. Test fixtures: `node scripts/make-test-character.mjs`, reload, die again. Expected: blocky figure keels over; `eyeL`/`eyeR` visibly squash shut (scale path). Screenshot.
3. `browser_console_messages`: no new errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: death keels the character over backward with eyes closing

Replaces the physics tumble (bunny-fall) with a spring-driven keel-over
that works for any character; eyes close over 150ms.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Landing camera shake

**Files:**
- Modify: `src/runner-scene.js` (state vars near line 155; shake block inserted after the takeoff camera-bounce block ~line 188)

**Interfaces:**
- Consumes: `state.y` / `state.vy` / `state.phase` (see Global Constraints: use previous frame's `vy`), `reducedMotion` (existing), `zoom` (existing local).
- Produces: closure vars `wasAirborne`, `lastVy`, `shakeAge`, `shakeStrength`; and a `shakeActive` boolean local used only for the shake application. Task 8 hooks `capKick` into the landing branch.

- [ ] **Step 1: Add state vars** (next to `let takeoffAge = 10;` line ~155):

```js
  let wasAirborne = false, lastVy = 0, shakeAge = 10, shakeStrength = 0;
```

- [ ] **Step 2: Insert the landing + shake block** directly after the takeoff-bounce block (after the `if (!reducedMotion.matches && takeoffAge < 0.18) { ... }` closing brace, before `camera.updateProjectionMatrix();`):

```js
    const airborne = state.y > 0;
    if (state.phase === "playing" && wasAirborne && !airborne) {
      shakeAge = 0;
      shakeStrength = Math.min(1, Math.abs(lastVy) / 650);
    }
    if (state.phase === "playing") {
      lastVy = state.vy;
      wasAirborne = airborne;
    }
    shakeAge += dt;
    if (!reducedMotion.matches && shakeAge < 0.16) {
      const decay = Math.exp(-shakeAge * 20);
      camera.position.y += Math.sin(shakeAge * 70) * 0.032 * shakeStrength * decay * zoom;
      camera.position.x += Math.sin(shakeAge * 53 + 1.3) * 0.016 * shakeStrength * decay;
    }
```

(`lastVy` holds the pre-landing downward velocity because the game zeroes `vy` on the landing frame; full-jump impact ≈ 650 gives `shakeStrength ≈ 1`.)

- [ ] **Step 3: Verify**

1. Fallback bunny (no fixtures), reload, start with Space, jump once, and capture a screenshot ~0.1 s after landing via `browser_run_code_unsafe`:

```js
async (page) => {
  await page.getByRole("main").focus?.().catch(() => {});
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1150);
  await page.screenshot({ path: ".playwright-mcp/landing-shake.png" });
  return "captured";
}
```

Expected: the frame shows the game running with no errors; the landed bunny may appear slightly offset/blurred from the shake. Repeat the capture 2-3× if the frame lands between shake peaks.
2. Console check: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/runner-scene.js
git commit -m "feat: decaying camera shake on landing, scaled by fall speed

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Dust particles (`src/dust.js`)

**Files:**
- Create: `src/dust.js`
- Modify: `src/runner-scene.js` (import; `createDust` after lights ~line 41; burst calls in the Task-6 landing branch and Task-5 `justSettled` branch; `dust.update` near `desert.update` ~line 287)

**Interfaces:**
- Consumes: `THREE` (vendored), the scene and camera.
- Produces: `createDust(scene, count = 12) -> { burst(x, y, strength = 1), update(dt, camera) }`. `burst` spawns up to `3 + 5×strength` puffs (beige `#e8dcc4`, ~0.35-0.46 s life); `update` billboards against `camera`, applies lite gravity, fades+grows each puff, recycles.

- [ ] **Step 1: Write `src/dust.js`**

```js
import * as THREE from "./vendor/three.module.min.js";

export function createDust(scene, count = 12) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const particles = [];
  for (let i = 0; i < count; i++) {
    const material = new THREE.MeshBasicMaterial({ color: "#e8dcc4", transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 15;
    scene.add(mesh);
    particles.push({ mesh, material, life: 0, ttl: 1, vx: 0, vy: 0, size: 0.06 });
  }
  return {
    burst(x, y, strength = 1) {
      const wanted = Math.min(particles.length, 3 + Math.round(strength * 5));
      let spawned = 0;
      for (const p of particles) {
        if (spawned >= wanted) break;
        if (p.life > 0) continue;
        p.life = p.ttl = 0.34 + Math.random() * 0.12;
        const side = Math.random() < 0.5 ? -1 : 1;
        p.vx = side * (0.25 + Math.random() * 0.45) * (0.7 + strength * 0.6);
        p.vy = 0.5 + Math.random() * 0.7;
        p.size = (0.05 + Math.random() * 0.05) * (0.8 + strength * 0.7);
        p.mesh.position.set(x + (Math.random() - 0.5) * 0.15, y + 0.02, 0.35 + Math.random() * 0.15);
        spawned++;
      }
    },
    update(dt, camera) {
      for (const p of particles) {
        if (p.life <= 0) {
          p.mesh.visible = false;
          continue;
        }
        p.life -= dt;
        const t = Math.max(0, p.life / p.ttl);
        p.vy -= 1.6 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y = Math.max(0.01, p.mesh.position.y + p.vy * dt);
        p.mesh.scale.setScalar(p.size * (1 + (1 - t) * 1.2));
        p.material.opacity = t * 0.75;
        p.mesh.quaternion.copy(camera.quaternion);
        p.mesh.visible = true;
      }
    }
  };
}
```

- [ ] **Step 2: Integrate into `runner-scene.js`**

1. Import: `import { createDust } from "./dust.js";`
2. After the lights are added (after `scene.add(light);` line ~41): `const dust = createDust(scene);`
3. Task-6 landing branch — inside `if (state.phase === "playing" && wasAirborne && !airborne) { ... }`, after setting `shakeStrength`:

```js
      dust.burst((DINO.x + DINO.width / 2) / 100 - 5, 0.02, 0.35 + shakeStrength * 0.65);
```

4. Task-5 `justSettled` branch — replace the placeholder comment with:

```js
        dust.burst(bunny.position.x - 0.15, 0.02, 0.5);
```

5. Per-frame update — directly before `desert.update(...)` (line ~287): `dust.update(dt, camera);`

- [ ] **Step 3: Verify**

1. No-fixture fallback, reload, jump: `browser_run_code_unsafe` with the Task-6 timing (screenshot ~0.15 s after landing). Expected: small beige puffs around the bunny's feet, fading. Screenshot.
2. Die (don't jump): screenshot right after the keel-over settles. Expected: a small puff where the body lands.
3. Console check: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/dust.js src/runner-scene.js
git commit -m "feat: beige landing dust puffs, also on death settle

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Cap flow physics (`flowParts`)

**Files:**
- Modify: `src/runner-scene.js` (pivot construction after the limbs block ~line 118; drive + kick in render)

**Interfaces:**
- Consumes: `parts.flowParts` (node names), `createSpring`/`stepSpring`, `state.vy`, the Task-6 landing branch.
- Produces: closure `flowPivots` (array of `{ pivot, spring }`) and `capKick(strength)` — also consumed by Task 9's menu preview in spirit (same construction recipe, driven by its own bounce).

- [ ] **Step 1: Build flow pivots** (insert after the limbs `for` loop, before the guarded ears block):

```js
  const flowPivots = [];
  for (const name of parts.flowParts || []) {
    const node = model.getObjectByName(name);
    if (!node || !node.parent) continue;
    node.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const pivot = new THREE.Group();
    const base = box.getCenter(new THREE.Vector3());
    base.y = box.min.y;
    pivot.position.copy(base);
    node.parent.add(pivot);
    node.position.sub(pivot.position);
    pivot.add(node);
    flowPivots.push({ pivot, spring: createSpring() });
  }
```

(Same reparent-at-pivot technique as the limbs. Pivot sits at the part's bounding-box bottom-center so a cap hinges at its crown line.)

- [ ] **Step 2: Kick on landing** — in the Task-6 landing branch, after the dust burst:

```js
      for (const { spring } of flowPivots) spring.velocity -= 6 * (0.4 + shakeStrength);
```

- [ ] **Step 3: Drive the springs in render** — insert after the limbs drive loop (`for (const { pivot, side, isLeg, spring } of limbs) { ... }`):

```js
    for (const { pivot, spring } of flowPivots) {
      const target = state.phase === "over" ? 0.5 : -Math.max(-1, Math.min(1, state.vy / 650)) * 0.42;
      pivot.rotation.x = stepSpring(spring, target, motionDt, 80, 7);
    }
```

(Rising → negative x-rotation tilts the cap backward in model space; falling → slight forward; death → flopped forward at rest. If verification shows the tilt inverted for the test model, negate the sign of `target` — model-space conventions differ between rigs; pick whichever reads as "cap lags the head" and note the choice in the commit body.)

- [ ] **Step 4: Verify**

1. Test fixtures present (`node scripts/make-test-character.mjs` if removed), reload, start, jump: capture screenshots at apex (~0.5 s after Space) and just after landing. Expected: the green cap visibly tilts back at apex and flops on landing, springing back while running; body parts stay attached (no orphaned geometry).
2. Die: cap rests tilted forward; no detach.
3. Fallback bunny (remove fixtures, reload): plays exactly as Task 5 left it — `flowParts` is empty so nothing changes. Quick screenshot to confirm.
4. Console check: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/runner-scene.js
git commit -m "feat: spring-driven flow physics for configured cap/hat parts

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Menu preview via the loader (`ready-bunny.js`)

**Files:**
- Modify: `src/ready-bunny.js` (full rewrite of the model-acquisition and animation sections; renderer/scene/camera/icon scaffolding stays)

**Interfaces:**
- Consumes: `loadCharacter()` (Task 2), `simplifyBunnyLimbs` (bunny fallback only).
- Produces: same export signature `renderReadyBunny(canvas, iconCanvas) -> { render(now, visible, animate) }` — `main.js` needs no change.

- [ ] **Step 1: Rewrite `src/ready-bunny.js`**

```js
import { loadCharacter } from "./character.js";
import { simplifyBunnyLimbs } from "./bunny-limbs.js";
import * as THREE from "./vendor/three.module.min.js";
export async function renderReadyBunny(canvas, iconCanvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(180, 126, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(16777215, 10462875, 2.2));
  const light = new THREE.DirectionalLight(16774631, 2.4);
  light.position.set(-3, 5, 6);
  scene.add(light);
  const { model, parts, isFallback } = await loadCharacter();
  scene.add(model);
  if (isFallback) {
    simplifyBunnyLimbs(model);
    for (const name of ["short_leg_footL", "short_leg_footR"]) {
      const node = model.getObjectByName(name);
      if (node) node.visible = false;
    }
    for (const name of ["earL", "earR"]) {
      const node = model.getObjectByName(name);
      if (node) node.scale.y *= 1.1;
    }
  }
  const armPivots = [];
  for (const name of [parts.armL, parts.armR]) {
    const arm = name ? model.getObjectByName(name) : null;
    if (!arm) continue;
    const pivot = new THREE.Group();
    pivot.position.copy(arm.position);
    pivot.position.y += 0.09;
    arm.parent.add(pivot);
    arm.position.sub(pivot.position);
    pivot.add(arm);
    pivot.rotation.x = Math.PI / 2;
    armPivots.push(pivot);
  }
  const flowPivots = [];
  for (const name of parts.flowParts || []) {
    const node = model.getObjectByName(name);
    if (!node || !node.parent) continue;
    node.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const pivot = new THREE.Group();
    const base = box.getCenter(new THREE.Vector3());
    base.y = box.min.y;
    pivot.position.copy(base);
    node.parent.add(pivot);
    node.position.sub(pivot.position);
    pivot.add(node);
    flowPivots.push(pivot);
  }
  model.rotation.y = Math.PI;
  model.traverse((o) => {
    if (o.isMesh) {
      const convert = (m) => new THREE.MeshPhysicalMaterial({ color: m.color, map: m.map, roughness: 0.29, clearcoat: 0.28, clearcoatRoughness: 0.34 });
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    }
  });
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const half = Math.max(size.y * 0.56, size.x * 0.56 / (180 / 126));
  const camera = new THREE.OrthographicCamera(-half * 180 / 126, half * 180 / 126, half, -half, 0.1, 20);
  camera.position.set(center.x, center.y + 0.12, 8);
  camera.lookAt(center);
  if (iconCanvas) {
    const head = parts.head ? model.getObjectByName(parts.head) : null;
    if (head) {
      const visibility = model.children.map((child) => [child, child.visible]);
      for (const child of model.children) child.visible = child === head;
      const headBox = new THREE.Box3().setFromObject(head), headSize = headBox.getSize(new THREE.Vector3()), headCenter = headBox.getCenter(new THREE.Vector3());
      const aspect = iconCanvas.width / iconCanvas.height, halfHeight = Math.max(headSize.y, headSize.x / aspect) * 0.54;
      const iconCamera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, -0.1, 20);
      iconCamera.position.set(headCenter.x, headCenter.y, 8);
      iconCamera.lookAt(headCenter);
      renderer.setSize(iconCanvas.width, iconCanvas.height, false);
      renderer.render(scene, iconCamera);
      iconCanvas.getContext("2d").drawImage(canvas, 0, 0, iconCanvas.width, iconCanvas.height);
      for (const [child, visible] of visibility) child.visible = visible;
      renderer.setSize(180, 126, false);
    }
  }
  renderer.render(scene, camera);
  return { render(now, visible, animate = true) {
    if (!visible) return;
    const phase = now % 1800 / 1e3;
    const local = phase < 0.6 ? phase : -1;
    const bounce = animate && local >= 0 ? Math.sin(local / 0.6 * Math.PI) : 0;
    model.position.y = bounce * size.y * 0.22;
    model.scale.set(1 - bounce * 0.04, 1 + bounce * 0.06, 1 - bounce * 0.04);
    for (const pivot of armPivots) pivot.rotation.x = -0.15 - bounce * 0.2;
    for (const pivot of flowPivots) pivot.rotation.x = -0.18 - bounce * 0.5;
    camera.zoom = 0.76;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  } };
}
```

Differences from the original to be aware of: GLTFLoader is replaced by `loadCharacter()`; bunny-only tweaks (limb simplification, short-leg hiding, ear scaling) are guarded by `isFallback`; icon rendering falls back to nothing when `parts.head` is absent (whole model shows in the menu, icon canvas stays as-is); flow parts (cap) bounce with the menu hop.

- [ ] **Step 2: Verify**

1. Test fixtures present, reload: the menu card shows the blocky figure (not the bunny) bouncing; its cap tilts with each hop; the brand icon top-left may show the head or stay default (both acceptable). Screenshot.
2. Remove fixtures, reload: menu shows the bunny as before; the head-only brand icon renders (fallback path restores ear scaling + head icon). Screenshot.
3. Console check: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/ready-bunny.js
git commit -m "feat: menu preview renders the active character via the loader

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Share card uses canonical parts

**Files:**
- Modify: `src/runner-scene.js` — only if Task 4 Step 6 left any hardcoded part reference in `captureShareBackground()`. Re-read the function and confirm every part lookup goes through `parts` (`parts.head`) and `eyes` (already empty for custom characters).

**Interfaces:**
- Consumes: Task 4's `parts` / `eyes` closures.
- Produces: share card renders the active character for both fallback and custom paths.

- [ ] **Step 1: Audit `captureShareBackground()`** — `grep -n "getObjectByName\|bunny_eye\|earL" src/runner-scene.js`. Any remaining hardcoded bunny name inside the share-card function gets switched to the canonical `parts` lookup exactly like Task 4 Step 6. (Task 4 Step 6 already switched `head`; this step is the verification that nothing else remains.)

- [ ] **Step 2: Verify**

1. Test fixtures, reload, play until score > 0, click the Share button (`browser_click` on the "Share" button). Expected: dialog shows a card with the blocky figure between two cacti. Screenshot the dialog.
2. Remove fixtures, reload, repeat. Expected: card shows the bunny as before (with head-pose + eye fixups). Screenshot.
3. Console check: no new errors.

- [ ] **Step 3: Commit** (only if Step 1 changed code)

```bash
git add src/runner-scene.js
git commit -m "fix: share card resolves character parts canonically

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: README section + full regression pass

**Files:**
- Modify: `README.md` (new subsection inside the existing "Run locally · 本地运行" `<details>` block)

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing swap instructions; verified final state.

- [ ] **Step 1: Add the swap section to README.md**

Inside the `<details>` block after the build command fence, add:

````markdown
Swap the character · 更换角色

Drop any GLB at `public/models/character/character.glb` and it replaces the bunny
everywhere (game, menu, share card). Parts are found by name — `head`, `armL/R`,
`footL/R` (variants like `arm.left`, `shoe_r`, `Head_01` all work). For unusual
names, or to add cap-flow physics and closing eyes, add a config file:

把任意 GLB 放到 `public/models/character/character.glb`，即可在小游戏、菜单和成绩卡中
替换小兔子。部件按名称自动识别（`head`、`armL/R`、`footL/R`，`arm.left`、`shoe_r`、
`Head_01` 这类写法都可以）。命名特殊时，或想开启帽子飘动、死亡闭眼，请加配置文件：

```json
// public/models/character/character.json
{
  "model": "character.glb",
  "yaw": 0,
  "parts": {
    "head": "Head_01",
    "armL": "arm.left", "armR": "arm.right",
    "footL": "shoe_l", "footR": "shoe_r",
    "flowParts": ["Cap"],
    "eyes": { "nodes": ["eyeL", "eyeR"], "material": "eye" }
  }
}
```

Missing parts are simply not animated. Delete the folder to restore the bunny.
部件缺失时相应动画自动跳过；删除该目录即可恢复小兔子。
````

- [ ] **Step 2: Full regression pass** (fixtures present, then absent)

1. `node scripts/make-test-character.mjs`, reload. Full session: menu → Space start → several jumps (see cap flow + landing dust + shake) → death (keel-over, closed eyes) → restart → Share card. Screenshots of each state. Console clean.
2. `rm -rf public/models/character`, reload. Same session on the bunny. Confirm: death is now the keel-over (the one intentional fallback change), ears still flow, landing feedback present, share card fine. Console clean.
3. Broken asset check: `mkdir -p public/models/character && echo "not a glb" > public/models/character/character.glb`, reload. Expected: console warning `[character] custom model failed to load — using the bunny instead`; game boots and plays on the bunny. Then `rm -rf public/models/character`.
4. `npm run build` — expected: completes without errors (static build sanity).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: how to swap the player character

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** loader + config + fuzzy matching (§1 → Tasks 1-3), animation mapping incl. flow parts + eyes + share card + menu (§2 → Tasks 4, 8, 9, 10), keel-over death + closed eyes (§3 → Task 5), landing shake + beige dust (§4 → Tasks 6-7), touch-point table (§5 → Tasks 4-11 incl. README + `bunny-fall.js` deletion), error handling (§ Error handling → Task 2 silent default / Task 11 broken-asset check), verification matrix (§ Testing → each task's verify steps + Task 11).
- **Placeholder scan:** the Task 5 `justSettled` branch and Task 8 landing-branch contain markers that later tasks explicitly fill (Task 7 Step 2.4, Task 8 Step 2) — sequenced, not vague. No TBDs.
- **Type consistency:** `loadCharacter` returns name strings; consumers `getObjectByName` (Tasks 4, 8, 9, 10 all do). `createKeelOver().step` returns `{ angle, eyeClose, age, justSettled }` — Task 5 uses all four; Task 7 uses `justSettled`. `createDust().burst(x, y, strength)` / `update(dt, camera)` match both call sites. `flowPivots` entries `{ pivot, spring }` in Task 8 match the drive loop.
