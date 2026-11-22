// 문장만들기 (sentence building) — pure logic, no DOM. Unit-tested by tests/sx.test.mjs.
// Input: one chapter JSON file per Part > Chapter, shaped like
//   { book_title, units: [ {unit, grammar_focus, main_sentence_ko, main_sentence_en, core_structure,
//                           step1:{steps:[{step,ko,hint}], variations:[{type,prompt,hint,word_hint?,answer,steps?}]},
//                           step2:[{no,ko,chunk_ko,hint,answer}]},
//                          {type:"WRITING TIPS", topic, sections?|description?+scale_order?},
//                          {type:"LET'S WRITE A STORY", title, prompts:[{ko,hint,en_template?,answer}]} ] }

const str = v => (v == null ? "" : String(v)).trim();
// the English answer may come under several names depending on how the file was made
const ansOf = o => str(o.answer ?? o.answer_en ?? o.en ?? o.english ?? o.model_answer ?? o.sample_answer ?? o.example);
const splitBy = (s, re) => str(s).split(re).map(x => x.trim()).filter(Boolean);
export const chunksOf = s => splitBy(s, /\s+\+\s+|\s*\+\s*/);           // "A + B + C" → [A, B, C]
export const slashParts = s => splitBy(s, /\s+\/\s+/);                   // "A / B" → [A, B]
export const hintList = s => splitBy(s, /\s+\/\s+/);                     // "on time / in time" → two hints

// "I work from home on Fridays (= every Friday)." → "I work from home on Fridays."
export function cleanAnswer(s) {
  return str(s).replace(/[’‘]/g, "'").replace(/\s*\((?:=|e\.g\.)[^)]*\)/g, "").replace(/\s+([.,!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/* ---------------- chapter file → items ---------------- */
export function parseChapter(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const units = data && (Array.isArray(data.units) ? data.units : Array.isArray(data) ? data : null);
  if (!units) throw new Error("no units");
  const items = [];
  units.forEach(u => {
    if (!u || typeof u !== "object") return;
    const type = str(u.type).toUpperCase();
    if (u.unit || u.step1 || u.step2) {
      const s1 = u.step1 || {};
      items.push({
        kind: "unit", no: str(u.unit) || `UNIT ${items.filter(i => i.kind === "unit").length + 1}`,
        focus: str(u.grammar_focus), ko: str(u.main_sentence_ko), en: str(u.main_sentence_en), core: str(u.core_structure),
        steps: (s1.steps || []).map(s => ({ ko: str(s.ko), hint: str(s.hint) })).filter(s => s.ko),
        variations: (s1.variations || []).map(v => ({
          type: str(v.type), ko: str(v.prompt || v.ko), chunk: str(v.hint), wordHint: str(v.word_hint), en: ansOf(v),
          steps: (v.steps || []).map(s => ({ ko: str(s.ko), hint: str(s.hint) })).filter(s => s.ko),
        })).filter(v => v.ko),
        s2: (Array.isArray(u.step2) ? u.step2 : []).map((s, i) => ({ no: s.no ?? i + 1, ko: str(s.ko), chunk: str(s.chunk_ko), hint: str(s.hint), en: ansOf(s) })).filter(s => s.ko),
      });
    } else if (/TIP/.test(type)) {
      items.push({
        kind: "tips", topic: str(u.topic || u.title), description: str(u.description),
        sections: (u.sections || []).map(s => ({ title: str(s.title), points: (s.points || []).map(str).filter(Boolean), examples: (s.examples || []).map(str).filter(Boolean) })),
        scale: (u.scale_order || []).map(s => ({ level: s.level, example: str(s.example), meaning: str(s.meaning) })),
      });
    } else if (/STORY/.test(type) || Array.isArray(u.prompts)) {
      items.push({
        kind: "story", title: str(u.title || u.type),
        prompts: (u.prompts || []).map(p => ({ ko: str(p.ko), hint: str(p.hint), template: str(p.en_template), en: ansOf(p) })).filter(p => p.ko),
      });
    }
  });
  if (!items.length) throw new Error("no units");
  return { title: str(data.book_title || data.title), items };
}

export function itemTitle(it) { return it.kind === "unit" ? it.no : it.kind === "tips" ? "WRITING TIPS" : "LET'S WRITE A STORY"; }

/* ---------------- step answers ----------------
 * STEP 1 steps only have the growing Korean ("A / B / C") and a hint, no English. The book orders the Korean chunks
 * in English word order, so step k's answer is a prefix of main_sentence_en. Its end is found from the hint
 * ("first thing", "in the morning", "be going to start / begin"): the first place after the previous step where the
 * hint phrase appears (fuzzy per word: check ~ checks, save ~ saving), else the furthest first match of its words,
 * else an even split. The last step is always the whole sentence. */
const normW = w => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, "");
function wordMatch(h, s) {
  if (!h || !s) return false; if (h === s) return true;
  const stem = h.replace(/(ing|ed|es|e|s)$/, "");
  return stem.length >= 3 && s.startsWith(stem);
}
function findPhrase(ws, ph, from) {
  for (let i = from; i + ph.length <= ws.length; i++) if (ph.every((p, k) => wordMatch(p, ws[i + k]))) return i;
  return -1;
}
export function stepEnds(sentence, hints) {
  const words = str(sentence).split(/\s+/).filter(Boolean), ws = words.map(normW), n = words.length, N = hints.length;
  const ends = []; let prev = 0;
  hints.forEach((hint, k) => {
    if (k === N - 1) { ends.push(n); return; }
    const alts = hintList(str(hint).replace(/\([^)]*\)/g, " ")).map(a => a.split(/\s+/).map(normW).filter(w => /[a-z]/.test(w))).filter(a => a.length);
    let end = -1;
    for (const a of alts) { const i = findPhrase(ws, a, prev); if (i >= 0) { end = i + a.length; break; } }
    if (end < 0) {   // furthest first match of any hint word
      alts.flat().forEach(w => { const i = ws.findIndex((s, j) => j >= prev && wordMatch(w, s)); if (i >= 0) end = Math.max(end, i + 1); });
    }
    const remain = N - 1 - k;                                // later steps need at least one word each
    if (end <= prev) end = Math.max(prev + 1, Math.round(n * (k + 1) / N));
    end = Math.min(end, n - remain);
    if (end <= prev) end = prev + 1;
    ends.push(end); prev = end;
  });
  return ends;
}
export function stepAnswers(sentence, hints) {
  const words = str(sentence).split(/\s+/).filter(Boolean);
  return stepEnds(sentence, hints).map((e, k, all) => {
    const s = words.slice(0, e).join(" ");
    return k === all.length - 1 ? s : s.replace(/[,;:]+$/, "");
  });
}

/* ---------------- questions of a unit / story ----------------
 * q: {key, sec:"s1"|"var"|"s2"|"story", n, of, type, ko, parts[] (slash chunks of ko), chunks[] (the "A + B" guide),
 *     hints[], wordHint, template, en (answer, cleaned), raw (answer as written), derived (en built from the main sentence),
 *     noAnswer (the file has no English for it: still asked — spoken freely, not scored)} */
export function unitQuestions(u) {
  const qs = [];
  const ans = stepAnswers(u.en, u.steps.map(s => s.hint));
  u.steps.forEach((s, i) => qs.push({
    key: `s1:${i}`, sec: "s1", n: i + 1, of: u.steps.length, ko: s.ko, parts: slashParts(s.ko), chunks: [], hints: hintList(s.hint),
    en: cleanAnswer(ans[i] || u.en), raw: ans[i] || u.en, derived: i < u.steps.length - 1,
  }));
  u.variations.forEach((v, i) => { qs.push({
    key: `var:${i}`, sec: "var", n: i + 1, of: u.variations.length, type: v.type, ko: v.ko, parts: [], chunks: chunksOf(v.chunk),
    hints: [...(v.wordHint ? [v.wordHint] : []), ...v.steps.flatMap(s => hintList(s.hint))].filter((h, j, a) => a.indexOf(h) === j),
    en: cleanAnswer(v.en), raw: v.en, noAnswer: !v.en,
  }); });
  u.s2.forEach((s, i) => { qs.push({
    key: `s2:${i}`, sec: "s2", n: i + 1, of: u.s2.length, no: s.no, ko: s.ko, parts: [], chunks: chunksOf(s.chunk), hints: hintList(s.hint),
    en: cleanAnswer(s.en), raw: s.en, noAnswer: !s.en,
  }); });
  return qs;
}
export function storyQuestions(st) {
  const ps = st.prompts;
  return ps.map((p, i) => ({
    key: `st:${st.prompts.indexOf(p)}`, sec: "story", n: i + 1, of: ps.length, ko: p.ko, parts: [], chunks: [], hints: hintList(p.hint),
    template: /\.\.\.|…/.test(p.template) ? p.template : "", en: cleanAnswer(p.en), raw: p.en, noAnswer: !p.en,
  }));
}
export const questionsOf = it => it.kind === "unit" ? unitQuestions(it) : it.kind === "story" ? storyQuestions(it) : [];

/* ---------------- word blocks (단어 입력 mode) ----------------
 * One block per word of the answer, punctuation trimmed ("morning." → "morning", "p.m." stays), sorted A→Z
 * (case-insensitive, like Word Story's block test). key = lower-case form used for checking, so equal words swap freely. */
export function blockText(w) {
  let s = String(w).replace(/[’‘]/g, "'").replace(/^["“'(\[]+/, "").replace(/["”)\]]+$/, "");
  s = s.replace(/[,;:!?]+$/, "");
  if (/\.$/.test(s) && !/\..*\./.test(s)) s = s.replace(/\.+$/, "");
  return s.replace(/["”]+$/, "") || String(w);
}
export const blockKey = s => s.toLowerCase().replace(/[’‘]/g, "'");
export function makeBlocks(answer) {
  const words = str(answer).split(/\s+/).filter(Boolean);
  const answerKeys = words.map(w => blockKey(blockText(w)));
  const blocks = words.map((w, i) => ({ id: i, text: blockText(w) }))
    .sort((a, b) => a.text.localeCompare(b.text, "en", { sensitivity: "base" }) || a.id - b.id)
    .map((b, i) => ({ ...b, key: blockKey(b.text), pos: i }));
  return { words, answerKeys, blocks };
}
// placed: array of keys in the order placed → per position ok, score (% right positions)
export function checkBlocks(answerKeys, placed) {
  const ok = answerKeys.map((k, i) => placed[i] === k);
  const right = ok.filter(Boolean).length;
  return { ok, right, total: answerKeys.length, score: answerKeys.length ? Math.round(right / answerKeys.length * 100) : 0 };
}
// The block to glow for 💡: the first wrongly placed position is the problem, else the next word.
export function nextBlockHint(answerKeys, placed) {
  const bad = placed.findIndex((k, i) => k !== answerKeys[i]);
  if (bad >= 0) return { wrongAt: bad, key: null };
  return placed.length < answerKeys.length ? { wrongAt: -1, key: answerKeys[placed.length] } : { wrongAt: -1, key: null };
}

// "Part1-Chapter2.json" → {part:1, chapter:2}
export function numbersFromFilename(name) {
  const s = String(name), p = s.match(/part\s*[-_ ]?\s*(\d+)/i), c = s.match(/ch(?:apter)?\s*[-_ ]?\s*(\d+)/i);
  return { part: p ? +p[1] : null, chapter: c ? +c[1] : null };
}

/* ---------------- 타자 입력 (typing) mode ----------------
 * One blank per answer word; punctuation around the word stays outside the blank. Checking ignores case,
 * apostrophes and the punctuation the learner might type. */
export function typeSlots(answer) {
  return str(answer).split(/\s+/).filter(Boolean).map(w => {
    const core = blockText(w), at = w.indexOf(core);
    return at < 0 ? { lead: "", word: core, tail: "" } : { lead: w.slice(0, at), word: core, tail: w.slice(at + core.length) };
  });
}
export const typedKey = s => blockKey(blockText(String(s).trim())).replace(/'/g, "");
export function checkTyped(words, vals) {
  const ok = words.map((w, i) => !!(vals[i] && typedKey(vals[i]) === typedKey(w)));
  const right = ok.filter(Boolean).length;
  return { ok, right, total: words.length, score: words.length ? Math.round(right / words.length * 100) : 0 };
}

/* ---------------- where › goes ----------------
 * Sequential until the last question; from there (and from then on, "sweep") it visits the questions still
 * pending (unanswered), cycling. pend[pos] = still to answer. → {to, sweep, entered} | {done} | {stay} */
export function nextStop(n, pos, pend, sweep = false) {
  if (!sweep && pos < n - 1) return { to: pos + 1, sweep: false };
  for (let d = 1; d < n; d++) { const p = (pos + d) % n; if (pend[p]) return { to: p, sweep: true, entered: !sweep }; }
  return pend[pos] ? { stay: true } : { done: true };
}
