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
