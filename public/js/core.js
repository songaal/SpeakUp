// Pure logic, no DOM: markdown/JSON parsing, text normalization, word alignment, scoring, stats.
// Everything here is unit-tested by tests/core.test.mjs (node --test).

/* ------------------------------------------------------------------ *
 * Script format (.md)
 *   # Title                  ← starts a dialogue
 *   - Speaker: English line  ← "- " and "Speaker: " are both optional
 *   - 한국어 직역 줄            ← a line containing Hangul = translation of the English line above
 *   ---                      ← separates dialogues in one file
 * ------------------------------------------------------------------ */
const HANGUL = /[ㄱ-ㆎ가-힣]/;

export function splitSpeaker(s) {
  const m = s.match(/^([^:：]{1,24})[:：]\s+(.+)$/);
  if (m && !/[.?!]/.test(m[1])) return { spk: m[1].trim(), body: m[2].trim() };
  return { spk: "", body: s };
}

export function parseMd(text) {
  const out = []; let cur = null;
  const close = () => { if (cur && cur.lines.length) out.push(cur); cur = null; };
  String(text).replace(/\r/g, "").split("\n").forEach(raw => {
    let line = raw.trim(); if (!line) return;
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) { close(); return; }
    const h = line.match(/^#{1,6}\s+(.+)$/);
    if (h) { close(); cur = { title: h[1].trim(), lines: [] }; return; }
    line = line.replace(/^[-*+]\s+/, "").replace(/^```\w*$/, "").trim(); if (!line) return;
    if (!cur) cur = { title: "", lines: [] };
    const { spk, body } = splitSpeaker(line);
    if (HANGUL.test(body)) {
      const last = cur.lines[cur.lines.length - 1];
      if (last && !last.ko) last.ko = body;   // pairs with the English line above
      return;                                   // a Korean line with no English above is ignored
    }
    cur.lines.push({ spk, en: body, ko: "" });
  });
  close();
  return out.map(d => ({ title: d.title || "제목 없는 대화", lines: d.lines }));
}

export function toMd(d) {
  return `# ${d.title}\n` + d.lines.map(l => `- ${l.spk ? l.spk + ": " : ""}${l.en}` + (l.ko ? `\n- ${l.ko}` : "")).join("\n");
}
export const libraryToMd = lib => lib.map(toMd).join("\n\n---\n\n") + "\n";

export function libraryToJson(lib) {
  return JSON.stringify({
    app: "speak-up", version: 1, exported: new Date().toISOString(),
    dialogues: lib.map(d => ({ title: d.title, lines: d.lines.map(l => ({ spk: l.spk, en: l.en, ko: l.ko })) })),
  }, null, 2);
}

// Accepts {dialogues:[…]}, a bare array, a single {title,lines}, or entries holding markdown strings.
export function parseJsonImport(text) {
  const j = JSON.parse(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j.dialogues) ? j.dialogues : [j];
  return arr.map(d => {
    if (typeof d === "string") return parseMd(d);
    if (d && typeof d.md === "string") return parseMd(d.md);
    if (d && Array.isArray(d.lines)) return [{
      title: String(d.title || "제목 없는 대화"),
      lines: d.lines.map(l => ({ spk: String(l.spk || l.speaker || ""), en: String(l.en || "").trim(), ko: String(l.ko || "").trim() })).filter(l => l.en),
    }];
    return [];
  }).flat().filter(d => d.lines.length);
}

/* ------------------------------------------------------------------ *
 * Normalization: both the answer and what was heard go through tokenize(),
 * so "I've"/"I have", "80%"/"eighty percent", "re-index"/"reindex" compare equal.
 * Each token remembers which display word (w) it came from.
 * ------------------------------------------------------------------ */
const CONTR = {"i'm":"i am","you're":"you are","we're":"we are","they're":"they are","he's":"he is","she's":"she is","it's":"it is",
"that's":"that is","what's":"what is","where's":"where is","who's":"who is","there's":"there is","here's":"here is","how's":"how is",
"i've":"i have","you've":"you have","we've":"we have","they've":"they have",
"i'll":"i will","you'll":"you will","we'll":"we will","they'll":"they will","he'll":"he will","she'll":"she will","it'll":"it will",
"i'd":"i would","you'd":"you would","we'd":"we would","they'd":"they would","he'd":"he would","she'd":"she would",
"don't":"do not","doesn't":"does not","didn't":"did not","can't":"can not","cannot":"can not","won't":"will not","wouldn't":"would not",
"shouldn't":"should not","couldn't":"could not","isn't":"is not","aren't":"are not","wasn't":"was not","weren't":"were not",
"haven't":"have not","hasn't":"has not","hadn't":"had not","let's":"let us","gonna":"going to","wanna":"want to",
"ok":"okay","mr":"mister","mrs":"missus","dr":"doctor"};
const NUM = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
const TENS = {30:"thirty",40:"forty",50:"fifty",60:"sixty",70:"seventy",80:"eighty",90:"ninety"};
function numWords(n) { n = +n; if (n <= 20) return NUM[n]; if (n < 100) { const t = Math.floor(n / 10) * 10, o = n % 10; return (t === 20 ? "twenty" : TENS[t]) + (o ? " " + NUM[o] : ""); } return String(n); }

export function tokenize(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean), toks = [];
  words.forEach((w, wi) => {
    const s = w.toLowerCase().replace(/[’‘`]/g, "'").replace(/%/g, " percent ").replace(/[^a-z0-9' ]/g, "").replace(/^'+|'+$/g, "");
    s.split(" ").forEach(part => {
      if (!part) return;
      let o = CONTR[part] || part;
      if (/^\d+$/.test(o) && +o < 100) o = numWords(o);
      else if (/^[a-z]+'s$/.test(o)) o = o.slice(0, -2) + " s";
      o.split(" ").forEach(t => { if (t) toks.push({ t, w: wi }); });
    });
  });
  return { words, toks };
}

// "off peak" heard for "off-peak" (→ "offpeak"): join two heard tokens when the joined form is in the answer.
export function mergeCompounds(h, refSet) {
  const out = [];
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[i + 1];
    if (b && (!refSet.has(a.t) || !refSet.has(b.t)) && refSet.has(a.t + b.t)) { out.push({ t: a.t + b.t, w: a.w }); i++; }
    else out.push(a);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Word-level Levenshtein alignment.
 * prefix=true (live view): the speaker may not be done, so unmatched trailing answer words are "pending".
 * refSt: ok | bad (substituted) | miss | pending   hypSt: ok | bad | extra   refSaid: heard word for "bad"
 * ------------------------------------------------------------------ */
export function align(ref, hyp, prefix = false) {
  const n = ref.length, m = hyp.length, D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = ref[i - 1] === hyp[j - 1] ? 0 : 1;
    D[i][j] = Math.min(D[i - 1][j - 1] + c, D[i - 1][j] + 1, D[i][j - 1] + 1);
  }
  let ei = n; if (prefix) { let b = Infinity; for (let i = 0; i <= n; i++) if (D[i][m] < b) { b = D[i][m]; ei = i; } }
  const refSt = new Array(n).fill(prefix ? "pending" : "miss"), hypSt = new Array(m).fill("extra"), refSaid = new Array(n).fill(null);
  let i = ei, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && D[i][j] === D[i - 1][j - 1]) { refSt[i - 1] = "ok"; hypSt[j - 1] = "ok"; i--; j--; }
    else if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + 1) { refSt[i - 1] = "bad"; hypSt[j - 1] = "bad"; refSaid[i - 1] = hyp[j - 1]; i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { refSt[i - 1] = "miss"; i--; }
    else { hypSt[j - 1] = "extra"; j--; }
  }
  return { refSt, hypSt, refSaid };
}

// Token statuses → per display word. live: "live" | "" ; final: ok | part | bad | miss (+ what was said instead).
export function foldToWords(ref, refSt, refSaid, live) {
  const per = ref.words.map(() => ({ ok: 0, total: 0, said: [] }));
  ref.toks.forEach((tk, k) => { const p = per[tk.w]; p.total++; if (refSt[k] === "ok") p.ok++; if (refSaid && refSaid[k]) p.said.push(refSaid[k]); });
  const st = per.map(p => {
    if (p.total === 0) return live ? "live" : "ok";
    if (live) return p.ok === p.total ? "live" : "";
    if (p.ok === p.total) return "ok"; if (p.ok > 0) return "part"; return p.said.length ? "bad" : "miss";
  });
  const said = live ? null : per.map((p, k) => (st[k] === "bad" || st[k] === "part") ? p.said.join(" ") : "");
  return { st, said };
}

export function heardTokens(answer, saidText) {
  const set = new Set(answer.toks.map(t => t.t));
  const h = tokenize(saidText); h.toks = mergeCompounds(h.toks, set); return h;
}

// Full scoring of one attempt. score = matched answer tokens / (answer tokens + extra spoken tokens).
export function scoreAttempt(answerText, saidText) {
  const ref = tokenize(answerText), h = heardTokens(ref, saidText);
  const R = ref.toks.map(t => t.t), a = align(R, h.toks.map(t => t.t), false);
  const { st, said } = foldToWords(ref, a.refSt, a.refSaid, false);
  const heardWordSt = h.words.map(() => []); h.toks.forEach((tk, k) => heardWordSt[tk.w].push(a.hypSt[k]));
  const ok = a.refSt.filter(s => s === "ok").length, extra = a.hypSt.filter(s => s === "extra").length;
  const bad = a.refSt.filter(s => s === "bad").length, miss = a.refSt.filter(s => s === "miss").length;
  return {
    st, said, ok, extra, bad, miss, total: R.length,
    score: R.length ? Math.round(ok / (R.length + extra) * 100) : 0,
    heard: h.words.map((w, k) => {
      const s = heardWordSt[k];
      return { w, st: !s.length || s.every(x => x === "ok") ? "ok" : s.every(x => x === "extra") ? "extra" : "bad" };
    }),
  };
}

export function dialogStats(d) {
  const words = d.lines.flatMap(l => l.en.split(/\s+/).filter(Boolean));
  const uniq = new Set(tokenize(d.lines.map(l => l.en).join(" ")).toks.map(t => t.t));
  const speakers = [...new Set(d.lines.map(l => l.spk).filter(Boolean))];
  return { sentences: d.lines.length, words: words.length, unique: uniq.size, speakers, avg: d.lines.length ? Math.round(words.length / d.lines.length * 10) / 10 : 0 };
}
