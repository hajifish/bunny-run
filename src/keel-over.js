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
