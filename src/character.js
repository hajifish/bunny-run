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
  const modelFile = config.model || DEFAULTS.model;
  let model, isFallback = false;
  try {
    model = (await new GLTFLoader().loadAsync(`${root}models/character/${modelFile}`)).scene;
  } catch {
    if (modelFile !== DEFAULTS.model) console.warn("[character] custom model failed to load — using the bunny instead");
    model = (await new GLTFLoader().loadAsync(`${root}models/snacky-bunny/bunny.glb`)).scene;
    isFallback = true;
  }
  const names = [];
  model.traverse((node) => {
    if (node.name) names.push(node.name);
  });
  let parts;
  try {
    parts = isFallback ? BUNNY_PARTS : resolveParts(names, config.parts || {});
  } catch {
    console.warn("[character] character.json parts config is malformed — using automatic part detection");
    parts = resolveParts(names, {});
  }
  if (typeof config.yaw === "number" && Number.isFinite(config.yaw) && config.yaw) model.rotation.y += config.yaw * Math.PI / 180;
  return { model, parts, isFallback };
}
