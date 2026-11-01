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
