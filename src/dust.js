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
