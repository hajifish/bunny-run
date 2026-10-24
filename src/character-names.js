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
  const stem = flat.replace(/\d+$/, "");
  const remainder = (probe) => {
    if (stem.endsWith(probe[0])) return stem.slice(0, -probe[0].length);
    if (stem.startsWith(probe[0])) return stem.slice(probe[0].length);
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
  const wantSide = /[lr]$/i.test(canonical) ? canonical.slice(-1).toLowerCase() : null;
  const wantBase = canonical.replace(/[lr]$/i, "").toLowerCase();
  for (const name of names) {
    const info = analyzeName(name);
    if (!info || info.base !== wantBase) continue;
    if (wantSide ? info.side === wantSide : info.side === null && hasCleanBoundary(name, info.base)) return name;
  }
  return null;
}
