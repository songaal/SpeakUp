import test from "node:test";
import assert from "node:assert/strict";
import { typeSlots, checkTyped, nextStop } from "../public/js/sxcore.js";

test("typeSlots keeps punctuation outside the blank", () => {
  assert.deepEqual(typeSlots('"Hi," I said.').map(s => [s.lead, s.word, s.tail]), [['"', "Hi", ',"'], ["", "I", ""], ["", "said", "."]]);
  assert.equal(typeSlots("at 7 p.m.")[2].word, "p.m.");
});
test("checkTyped ignores case, apostrophes and typed punctuation", () => {
  const w = typeSlots("I don't know.").map(s => s.word);
  assert.deepEqual(checkTyped(w, ["i", "dont", "know."]).ok, [true, true, true]);
  assert.deepEqual(checkTyped(w, ["I", "do", ""]).ok, [true, false, false]);
});
test("nextStop: sequential, then sweep through skipped ones, then done", () => {
  assert.deepEqual(nextStop(5, 1, [0, 0, 1, 0, 0]), { to: 2, sweep: false });
  assert.deepEqual(nextStop(5, 4, [0, 1, 0, 1, 0]), { to: 1, sweep: true, entered: true });
  assert.deepEqual(nextStop(5, 1, [0, 0, 0, 1, 0], true), { to: 3, sweep: true, entered: false });
  assert.deepEqual(nextStop(5, 3, [0, 0, 0, 0, 0], true), { done: true });
  assert.deepEqual(nextStop(5, 4, [0, 0, 0, 0, 0]), { done: true });
  assert.deepEqual(nextStop(5, 4, [0, 0, 0, 0, 1]), { stay: true });
});
