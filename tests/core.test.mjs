// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMd, toMd, libraryToMd, parseJsonImport, libraryToJson, scoreAttempt, dialogStats } from "../public/js/core.js";
import { SAMPLE_MD } from "../public/js/content.js";

test("sample parses into one dialogue, every line translated", () => {
  const [d, ...rest] = parseMd(SAMPLE_MD);
  assert.equal(rest.length, 0);
  assert.equal(d.title, "카페에서 커피 주문하기");
  assert.equal(d.lines.length, 17);
  assert.ok(d.lines.every(l => l.spk && l.en && l.ko));
  assert.deepEqual(d.lines[3], { spk: "Customer", en: "A medium, please.", ko: "중간 것 하나, 부탁합니다." });
});

test("speaker and '- ' are optional; Korean speaker prefix is dropped; --- and # split dialogues", () => {
  const ds = parseMd("# A\nHello there.\n안녕.\nJin: Second line\n진: 두번째\nNo translation\n---\nuntitled line\n번역\n# C\n* Kim: hi\n* 안녕\n```\n");
  assert.equal(ds.length, 3);
  assert.deepEqual(ds[0].lines, [{ spk: "", en: "Hello there.", ko: "안녕." }, { spk: "Jin", en: "Second line", ko: "두번째" }, { spk: "", en: "No translation", ko: "" }]);
  assert.equal(ds[1].title, "제목 없는 대화");
  assert.deepEqual(ds[2].lines, [{ spk: "Kim", en: "hi", ko: "안녕" }]);
});

test("md and json export round-trip", () => {
  const ds = parseMd(SAMPLE_MD + "\n---\n# News\nThe market rose today.\n시장이 오늘 올랐습니다.");
  assert.deepEqual(parseMd(libraryToMd(ds)), ds);
  assert.deepEqual(parseJsonImport(libraryToJson(ds)), ds);
  assert.equal(toMd(ds[1]), "# News\n- The market rose today.\n- 시장이 오늘 올랐습니다.");
});

test("scoring tolerates contractions, numbers, percent and compounds", () => {
  for (const [ans, said] of [
    ["The indexing pipeline migration is about eighty percent done.", "the indexing pipeline migration is about 80% done"],
    ["Can we schedule full reindexes during off-peak hours from now on?", "can we schedule full re-indexes during off peak hours from now on"],
    ["I've been working here for about three years.", "I have been working here for about 3 years"],
    ["That comes to eight dollars and fifty cents.", "that comes to $8.50"],
    ["That comes to eight dollars and fifty cents.", "that comes to $8 and 50 cents"],
  ]) assert.equal(scoreAttempt(ans, said).score, 100, said);
});

test("score = blanks filled; wrong/extra words don't cost", () => {
  const r = scoreAttempt("I've been working here for about three years.", "I have been work here for about 3 years now");
  assert.deepEqual(r.st, ["ok", "ok", "bad", "ok", "ok", "ok", "ok", "ok"]);
  assert.equal(r.said[2], "work");
  assert.equal(r.score, 88);   // 7 of 8 blanks
});

test("several tries in one attempt still fill every blank → 100", () => {
  const ans = "Hi there! What can I get for you today?";
  assert.equal(scoreAttempt(ans, "hi there what cat uh what can I get for you", ["hi there what cat uh", "what can I get for you", "today"]).score, 100);
  assert.equal(scoreAttempt(ans, "for you today", ["for you today"], [0, 1, 2, 3, 4, 5]).score, 100);   // earlier blanks filled live
  const r = scoreAttempt(ans, "for you today");
  assert.deepEqual(r.st, ["miss", "miss", "miss", "miss", "miss", "miss", "ok", "ok", "ok"]);
});

test("stats", () => {
  const s = dialogStats(parseMd(SAMPLE_MD)[0]);
  assert.equal(s.sentences, 17);
  assert.deepEqual(s.speakers, ["Barista", "Customer"]);
});
