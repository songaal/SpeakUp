// 문장만들기 logic. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChapter, unitQuestions, storyQuestions, stepAnswers, cleanAnswer, makeBlocks, checkBlocks, nextBlockHint, numbersFromFilename, chunksOf, blockText } from "../public/js/sxcore.js";

const SAMPLE = {
  book_title: "테스트 교재",
  units: [
    {
      unit: "UNIT 1", grammar_focus: "현재시제",
      main_sentence_ko: "그녀는 항상 아침에 제일 먼저 이메일을 확인합니다.",
      main_sentence_en: "She always checks her email first thing in the morning.",
      core_structure: "그녀는 항상 확인합니다 + 그녀의 이메일을 + 제일 먼저 + 아침에",
      step1: {
        steps: [
          { step: 1, ko: "그녀는 항상 확인합니다", hint: "check" },
          { step: 2, ko: "그녀는 항상 확인합니다 / 그녀의 이메일을", hint: "email (불가산 명사)" },
          { step: 3, ko: "그녀는 항상 확인합니다 / 그녀의 이메일을 / 제일 먼저", hint: "first thing" },
          { step: 4, ko: "그녀는 항상 확인합니다 / 그녀의 이메일을 / 제일 먼저 / 아침에", hint: "in the morning" },
        ],
        variations: [
          { type: "응용 1", prompt: "질문?", hint: "A + B", answer: "He checks his messages every hour.", steps: [{ step: 1, ko: "A", hint: "message" }] },
          { type: "최종 응용", prompt: "마지막", hint: "C", word_hint: "the morning", answer: "Coffee helps." },
          { type: "응용 2", prompt: "정답 없음", hint: "X" },
        ],
      },
      step2: [
        { no: 1, ko: "나는 금요일마다 재택근무를 합니다.", chunk_ko: "나는 일합니다 + 집으로부터 + 금요일마다", hint: "from home / on Fridays", answer: "I work from home on Fridays (= every Friday)." },
      ],
    },
    { type: "WRITING TIPS", topic: "during / for", sections: [{ title: "1. during", points: ["a", "b"] }] },
    { type: "WRITING TIPS", topic: "강도", description: "설명", scale_order: [{ level: 1, example: "You can go now.", meaning: "허가" }] },
    { type: "LET'S WRITE A STORY", title: "Story", prompts: [
      { ko: "첫 줄", hint: "x", answer: "Today was a great day!" },
      { ko: "템플릿", hint: "y", en_template: "People were walking their dogs, and ...", answer: "People were walking their dogs, and I saw friends." },
      { ko: "빈 답", hint: "z", answer: "" },
    ] },
  ],
};

test("chapter parses into units, tips and a story", () => {
  const ch = parseChapter(JSON.stringify(SAMPLE));
  assert.equal(ch.title, "테스트 교재");
  assert.deepEqual(ch.items.map(i => i.kind), ["unit", "tips", "tips", "story"]);
  assert.equal(ch.items[0].steps.length, 4);
  assert.equal(ch.items[2].scale[0].example, "You can go now.");
  assert.throws(() => parseChapter("{}"));
  assert.throws(() => parseChapter("not json"));
});

test("step answers are prefixes of the main sentence found from the hints", () => {
  const u = parseChapter(SAMPLE).items[0];
  assert.deepEqual(stepAnswers(u.en, u.steps.map(s => s.hint)), [
    "She always checks", "She always checks her email", "She always checks her email first thing",
    "She always checks her email first thing in the morning.",
  ]);
  // "be going to start" isn't in the sentence word for word → furthest word match ("start")
  assert.deepEqual(stepAnswers("I am going to start a new exercise routine next week.", ["be going to start / begin", "a new exercise routine", "next week"]),
    ["I am going to start", "I am going to start a new exercise routine", "I am going to start a new exercise routine next week."]);
  // "in LA" must not jump to the later "in December"
  assert.deepEqual(stepAnswers("I will move to a new house in LA in December.", ["move", "a new house / a new home", "in LA", "in December"]),
    ["I will move", "I will move to a new house", "I will move to a new house in LA", "I will move to a new house in LA in December."]);
  // stems: save ~ saving; unknown hints split evenly but never empty
  assert.equal(stepAnswers("They've been saving money.", ["save", "money"])[0], "They've been saving");
  const odd = stepAnswers("One two three four", ["zzz", "yyy", "xxx"]);
  assert.equal(odd.length, 3); assert.ok(odd[0].length && odd[1].length > odd[0].length);
});

test("unit questions: steps, variations with answers, step 2", () => {
  const qs = unitQuestions(parseChapter(SAMPLE).items[0]);
  assert.deepEqual(qs.map(q => q.key), ["s1:0", "s1:1", "s1:2", "s1:3", "var:0", "var:1", "s2:0"]);
  assert.deepEqual(qs[1].parts, ["그녀는 항상 확인합니다", "그녀의 이메일을"]);
  assert.equal(qs[0].derived, true); assert.equal(qs[3].derived, false);
  assert.deepEqual(qs[4].hints, ["message"]);
  assert.deepEqual(qs[5].hints, ["the morning"]);
  assert.equal(qs[6].en, "I work from home on Fridays.");
  assert.equal(qs[6].raw, "I work from home on Fridays (= every Friday).");
  assert.deepEqual(qs[6].chunks, ["나는 일합니다", "집으로부터", "금요일마다"]);
});

test("story questions skip prompts without an answer and only keep '...' templates", () => {
  const qs = storyQuestions(parseChapter(SAMPLE).items[3]);
  assert.equal(qs.length, 2);
  assert.equal(qs[0].template, "");
  assert.equal(qs[1].template, "People were walking their dogs, and ...");
});

test("helpers", () => {
  assert.equal(cleanAnswer("I visit  them ."), "I visit them.");
  assert.deepEqual(chunksOf("A + B+C"), ["A", "B", "C"]);
  assert.deepEqual(numbersFromFilename("Part1-Chapter2.json"), { part: 1, chapter: 2 });
  assert.deepEqual(numbersFromFilename("part 3 ch 10.json"), { part: 3, chapter: 10 });
  assert.equal(blockText("morning."), "morning"); assert.equal(blockText("p.m."), "p.m."); assert.equal(blockText("“Hi,"), "Hi");
});

test("word blocks: sorted A→Z, checked by position, hint points at the next word", () => {
  const { answerKeys, blocks } = makeBlocks("She always checks her email.");
  assert.deepEqual(blocks.map(b => b.text), ["always", "checks", "email", "her", "She"]);
  assert.deepEqual(answerKeys, ["she", "always", "checks", "her", "email"]);
  const r = checkBlocks(answerKeys, ["she", "always", "her", "checks", "email"]);
  assert.deepEqual(r.ok, [true, true, false, false, true]); assert.equal(r.score, 60);
  assert.deepEqual(nextBlockHint(answerKeys, ["she", "always"]), { wrongAt: -1, key: "checks" });
  assert.deepEqual(nextBlockHint(answerKeys, ["she", "her"]), { wrongAt: 1, key: null });
  // repeated words are interchangeable
  const d = makeBlocks("in LA in December");
  assert.equal(checkBlocks(d.answerKeys, ["in", "la", "in", "december"]).score, 100);
});
