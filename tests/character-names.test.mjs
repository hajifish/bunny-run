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

test("matches Blender-style duplicate suffixes", () => {
  const names = ["arm.left.001", "hand.r.002", "Head_01", "shoe_l"];
  assert.equal(matchPart(names, "armL"), "arm.left.001");
  assert.equal(matchPart(names, "armR"), "hand.r.002");
  assert.equal(matchPart(names, "head"), "Head_01");
  assert.equal(matchPart(names, "footL"), "shoe_l");
});
