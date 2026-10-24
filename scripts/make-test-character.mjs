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
