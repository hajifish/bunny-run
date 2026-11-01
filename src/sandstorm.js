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
    dismiss() {
      active = false;
      peak = null;
      for (const layer of layers) layer.mesh.visible = false;
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
