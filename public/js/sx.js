// 문장만들기 (sentence building) — the second mode next to 대화 (dialogues).
// Library tab "문장만들기": 훈련 list → 훈련 (parts) → 파트 (chapters, each one imported JSON file) → 챕터 (units,
// writing tips, story) → item page (content without answers + 테스트) → test (one question per page).
// Content is import-only: the only things typed in are numbers and titles.
import { t, lang } from "./i18n.js";
import { tokenize, fillWords, scoreAttempt } from "./core.js";
import { parseChapter, itemTitle, questionsOf, slashParts, chunksOf, hintList, makeBlocks, checkBlocks, nextBlockHint, numbersFromFilename } from "./sxcore.js";
import { putFile, getFile, delFile } from "./sxstore.js";
import { createRecognizer, speechEngine } from "./speech.js";
import { chime, thud, tick, fanfare, unlockAudio, startConfetti, stopConfetti, say, hush, haptic } from "./fx.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const K = { meta: "speakup.sx.v1", best: "speakup.sxbest.v1", pos: "speakup.sxpos.v1", word: "speakup.sxword.v1", auto: "speakup.sxauto.v1", mode: "speakup.mode.v1" };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { C.toast(t("sxStoreFull")); } },
};
let C = null;   // context from app.js: {showView, view(), toast, ask, renderLib}
let meta = ls.get(K.meta, null); if (!meta || !Array.isArray(meta.trainings)) meta = { trainings: [] };
let best = ls.get(K.best, {});      // "chapterId|itemIndex|questionKey" → best score
let posMap = ls.get(K.pos, {});     // "chapterId|itemIndex" → question index to resume at
let wordMode = ls.get(K.word, false), autoNext = ls.get(K.auto, true);
const saveMeta = () => ls.set(K.meta, meta);
const cache = new Map();            // chapterId → parsed chapter (loaded into memory once)
const transition = fn => (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) ? document.startViewTransition(fn) : fn();

/* ================= mode tabs (대화 | 문장만들기) ================= */
export let mode = ls.get(K.mode, "dlg") === "sx" ? "sx" : "dlg";
function paintTabs() {
  document.body.dataset.mode = mode;
  document.querySelectorAll("#modeTabs [data-mode]").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
}
function setMode(m) {
  if (m === mode) return;
  transition(() => { mode = m; ls.set(K.mode, m); paintTabs(); C.renderLib(); });
}

/* ================= tree helpers ================= */
let nav = { t: null, p: null, c: null, it: null };
const trainingOf = () => meta.trainings.find(x => x.id === nav.t);
const partOf = () => { const tr = trainingOf(); return tr && tr.parts.find(x => x.id === nav.p); };
const chapterOf = () => { const p = partOf(); return p && p.chapters.find(x => x.id === nav.c); };
const level = () => nav.it != null ? "item" : nav.c ? "chapter" : nav.p ? "part" : "training";
const byNo = (a, b) => (a.no - b.no) || (a.created - b.created);
const bestKey = (cid, ii, q) => `${cid}|${ii}|${q.key}`;
function itemStats(cid, ii, it) {
  const qs = questionsOf(it), sc = qs.map(q => best[bestKey(cid, ii, q)]).filter(v => v != null);
  return { total: qs.length, done: sc.length, avg: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null };
}
async function loadChapter(ch) {
  if (cache.has(ch.id)) return cache.get(ch.id);
  const raw = await getFile(ch.id); if (raw == null) throw new Error("missing");
  const parsed = parseChapter(raw); cache.set(ch.id, parsed); return parsed;
}
const ring = (pct, label) => {
  const r = 17, c = 2 * Math.PI * r, p = pct == null ? 0 : pct;
  return `<span class="ring ${pct == null ? "none" : p >= 80 ? "g" : p >= 50 ? "m" : "l"}"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="${r}" class="rb"/><circle cx="20" cy="20" r="${r}" class="rf" stroke-dasharray="${c * p / 100} ${c}"/></svg><b>${label ?? (pct == null ? "–" : pct)}</b></span>`;
};

/* ================= library tab: 훈련 list ================= */
export function renderTrainings(el) {
  const list = [...meta.trainings].sort((a, b) => b.created - a.created);
  if (!list.length) {
    el.innerHTML = `<div class="sx-empty"><div class="sx-empty-ic">🧩</div><b>${t("sxEmptyTitle")}</b><p>${t("sxEmptyBody")}</p><button class="btn pri" id="sxFirst">${t("sxNewTraining")}</button></div>`;
    $("sxFirst").onclick = newTraining; return;
  }
  el.innerHTML = list.map((tr, i) => {
    const nCh = tr.parts.reduce((a, p) => a + p.chapters.length, 0);
    return `<div class="dcard sxcard" data-tid="${tr.id}"><span class="dno sxno">${list.length - i}</span>
      <div class="dmain"><div class="dt">${esc(tr.title)}</div><div class="dm">${t("sxTrainingMeta", tr.parts.length, nCh)}</div></div><span class="chev">›</span></div>`;
  }).join("");
  el.querySelectorAll("[data-tid]").forEach(c => c.onclick = () => openTraining(c.dataset.tid));
}
export function newTraining() {
  openForm({
    title: t("sxNewTraining"), submit: t("sxCreate"),
    fields: [{ name: "title", label: t("sxTrainingName"), type: "text", ph: t("sxTrainingPh") }],
    onSubmit: v => {
      if (!v.title) return t("sxNeedTitle");
      const tr = { id: uid(), title: v.title, created: Date.now(), parts: [] };
      meta.trainings.push(tr); saveMeta(); C.renderLib(); C.toast(t("sxCreated", v.title)); openTraining(tr.id);
    },
  });
}
function openTraining(id) { nav = { t: id, p: null, c: null, it: null }; go(); }

/* ================= sx view (training / part / chapter / item) ================= */
function go(dir = "fwd") {
  stopTest(true);
  transition(() => { C.showView("sx"); renderSx(); $("sxScroll").scrollTop = 0; });
}
function back() {
  const l = level();
  if (l === "item") nav.it = null; else if (l === "chapter") nav.c = null; else if (l === "part") nav.p = null;
  else { transition(() => { C.showView("lib"); C.renderLib(); }); return; }
  go("back");
}
async function renderSx() {
  const tr = trainingOf(); if (!tr) { C.showView("lib"); C.renderLib(); return; }
  const l = level(), p = partOf(), ch = chapterOf(), body = $("sxBody");
  const crumb = [tr.title, p && `PART ${p.no}`, ch && `CH ${ch.no}`].filter(Boolean);
  $("sxCrumb").textContent = crumb.slice(0, -1).join(" › ") || t("sxTraining");
  $("sxMore").style.visibility = l === "item" ? "hidden" : "";
  const fab = $("sxFab"); fab.style.display = "none";
  if (l === "training") {
    $("sxTitle").textContent = tr.title;
    const parts = [...tr.parts].sort(byNo);
    body.innerHTML = parts.length ? parts.map(pt => `<div class="dcard sxcard" data-pid="${pt.id}">
        <span class="nobadge part"><small>PART</small>${esc(pt.no)}</span>
        <div class="dmain"><div class="dt">${esc(pt.title)}</div><div class="dm">${t("sxChapters", pt.chapters.length)}</div></div><span class="chev">›</span></div>`).join("")
      : emptyHint("📚", t("sxNoParts"));
    body.querySelectorAll("[data-pid]").forEach(c => c.onclick = () => { nav.p = c.dataset.pid; go(); });
    fab.style.display = ""; $("sxFabLbl").textContent = t("sxNewPart"); fab.onclick = newPart;
  } else if (l === "part") {
    $("sxTitle").textContent = `PART ${p.no}. ${p.title}`;
    const chs = [...p.chapters].sort(byNo);
    body.innerHTML = chs.length ? chs.map(c => `<div class="dcard sxcard" data-cid="${c.id}">
        <span class="nobadge"><small>CH</small>${esc(c.no)}</span>
        <div class="dmain"><div class="dt">${esc(c.title)}</div><div class="dm" data-cmeta="${c.id}">${esc(c.file || "")}</div></div>
        <span class="cring" data-cring="${c.id}"></span><span class="chev">›</span></div>`).join("")
      : emptyHint("📄", t("sxNoChapters"));
    body.querySelectorAll("[data-cid]").forEach(c => c.onclick = () => { nav.c = c.dataset.cid; go(); });
    fab.style.display = ""; $("sxFabLbl").textContent = t("sxNewChapter"); fab.onclick = newChapter;
    for (const c of chs) {   // fill unit counts / progress once the files are read
      loadChapter(c).then(d => {
        const units = d.items.map((it, i) => [it, i]).filter(([it]) => it.kind === "unit");
        let tot = 0, done = 0; units.forEach(([it, i]) => { const s = itemStats(c.id, i, it); tot += s.total; done += s.done; });
        const m = body.querySelector(`[data-cmeta="${c.id}"]`), r = body.querySelector(`[data-cring="${c.id}"]`);
        if (m) m.textContent = t("sxChapterMeta", units.length, done, tot);
        if (r) r.innerHTML = ring(tot ? Math.round(done / tot * 100) : null, tot ? Math.round(done / tot * 100) + "%" : "");
      }).catch(() => { const m = body.querySelector(`[data-cmeta="${c.id}"]`); if (m) m.textContent = t("sxFileMissing"); });
    }
  } else if (l === "chapter") {
    $("sxTitle").textContent = `CH ${ch.no}. ${ch.title}`;
    body.innerHTML = `<div class="sx-loading">…</div>`;
    let d; try { d = await loadChapter(ch); } catch (e) { body.innerHTML = emptyHint("⚠️", t("sxFileMissing")); return; }
    if (level() !== "chapter" || chapterOf() !== ch) return;
    body.innerHTML = (d.title ? `<div class="sx-book">${esc(d.title)}</div>` : "") + d.items.map((it, i) => {
      if (it.kind === "unit") {
        const s = itemStats(ch.id, i, it);
        return `<div class="ucard" data-it="${i}"><div class="ucard-h"><span class="ubadge">${esc(it.no)}</span><span class="ufocus">${esc(it.focus)}</span></div>
          <div class="ucard-ko">${esc(it.ko)}</div><div class="ucard-f"><span>${t("sxQCount", s.total)}${s.done ? ` · ${t("sxDoneN", s.done)}` : ""}</span>${ring(s.avg)}</div></div>`;
      }
      if (it.kind === "tips") return `<div class="ucard tips" data-it="${i}"><div class="ucard-h"><span class="ubadge tip">💡 WRITING TIPS</span></div><div class="ucard-ko">${esc(it.topic)}</div></div>`;
      const s = itemStats(ch.id, i, it);
      return `<div class="ucard story" data-it="${i}"><div class="ucard-h"><span class="ubadge story">📖 LET'S WRITE A STORY</span></div><div class="ucard-ko">${esc(it.title)}</div>
        <div class="ucard-f"><span>${t("sxStoryLines", it.prompts.length)}${s.done ? ` · ${t("sxDoneN", s.done)}` : ""}</span>${s.total ? ring(s.avg) : ""}</div></div>`;
    }).join("");
    body.querySelectorAll("[data-it]").forEach(c => c.onclick = () => { nav.it = +c.dataset.it; go(); });
  } else {
    const d = cache.get(ch.id), it = d && d.items[nav.it]; if (!it) { nav.it = null; renderSx(); return; }
    $("sxTitle").textContent = it.kind === "unit" ? `${it.no} · ${it.focus}` : itemTitle(it);
    body.innerHTML = it.kind === "unit" ? unitHTML(ch.id, nav.it, it) : it.kind === "tips" ? tipsHTML(it) : storyHTML(ch.id, nav.it, it);
    body.querySelectorAll("[data-q]").forEach(el => el.onclick = () => startTest(+el.dataset.q));
    const st = $("sxStart"), rs = $("sxResume");
    if (st) st.onclick = () => startTest(0);
    if (rs) rs.onclick = () => startTest(+rs.dataset.at);
  }
}
const emptyHint = (ic, msg) => `<div class="sx-empty small"><div class="sx-empty-ic">${ic}</div><p>${msg}</p></div>`;
const hintChips = hs => hs.length ? `<div class="hchips">${hs.map(h => `<span class="hchip">${esc(h)}</span>`).join("")}</div>` : "";
const slashHTML = s => slashParts(s).map(esc).join(`<i class="sl">/</i>`);
const chunkHTML = cs => cs.length ? `<div class="chunks">${cs.map(c => `<span>${esc(c)}</span>`).join(`<i>+</i>`)}</div>` : "";
const bsHTML = v => `<span class="bs ${v === 100 ? "p" : ""}">${v != null ? v + "%" : ""}</span>`;
function startButtons(cid, ii, n) {
  if (!n) return "";
  const at = Math.min(posMap[`${cid}|${ii}`] || 0, n - 1);
  return `<div class="startrow sxstart">${at > 0
    ? `<button class="btn sec" id="sxStart">${t("fromStart")}</button><button class="btn pri" id="sxResume" data-at="${at}">${t("resumeAt", at + 1)}</button>`
    : `<button class="btn pri" id="sxStart">▶ ${t("sxTestN", n)}</button>`}</div>`;
}
function unitHTML(cid, ii, u) {
  const qs = questionsOf(u), idxOf = key => qs.findIndex(q => q.key === key), b = key => best[`${cid}|${ii}|${key}`];
  const s = itemStats(cid, ii, u);
  return `<div class="uhero"><div class="ucard-h"><span class="ubadge">${esc(u.no)}</span><span class="ufocus">${esc(u.focus)}</span></div>
      <div class="uhero-ko">${esc(u.ko)}</div>${chunkHTML(chunksOf(u.core))}</div>
    <div class="stats"><div class="stat"><b>${s.total}</b><span>${t("sxQuestions")}</span></div><div class="stat"><b>${s.done}</b><span>${t("sxTried")}</span></div><div class="stat"><b>${s.avg != null ? s.avg + "%" : "–"}</b><span>${t("sxAvg")}</span></div></div>
    ${startButtons(cid, ii, qs.length)}
    <h3 class="sxh"><span class="sec s1">STEP 1</span>${t("sxSecSteps")}</h3>
    <ul class="tl qtl">${u.steps.map((st, i) => `<li data-q="${idxOf("s1:" + i)}"><span class="no">${i + 1}</span><div class="tx"><div class="te">${slashHTML(st.ko)}</div>${hintChips(hintList(st.hint))}</div>${bsHTML(b("s1:" + i))}</li>`).join("")}</ul>
    ${u.variations.length ? `<h3 class="sxh"><span class="sec var">${t("sxSecVarShort")}</span>${t("sxSecVar")}</h3>
    <ul class="tl qtl">${u.variations.map((v, i) => { const k = idxOf("var:" + i);
      return `<li ${k >= 0 ? `data-q="${k}"` : ""}><span class="no">${i + 1}</span><div class="tx"><div class="vtype">${esc(v.type)}</div><div class="te">${esc(v.ko)}</div>${chunkHTML(chunksOf(v.chunk))}${hintChips(v.wordHint ? [v.wordHint] : [])}</div>${bsHTML(b("var:" + i))}</li>`; }).join("")}</ul>` : ""}
    ${u.s2.length ? `<h3 class="sxh"><span class="sec s2">STEP 2</span>${t("sxSecS2")}</h3>
    <ul class="tl qtl">${u.s2.map((x, i) => { const k = idxOf("s2:" + i);
      return `<li ${k >= 0 ? `data-q="${k}"` : ""}><span class="no">${esc(x.no)}</span><div class="tx"><div class="te">${esc(x.ko)}</div>${chunkHTML(chunksOf(x.chunk))}${hintChips(hintList(x.hint))}</div>${bsHTML(b("s2:" + i))}</li>`; }).join("")}</ul>` : ""}`;
}
function tipsHTML(it) {
  const pt = p => { const m = p.match(/^예\s*[:：]\s*(.+)$/) || p.match(/^(?:e\.g\.|ex)\s*[:：]?\s*(.+)$/i);
    return m ? `<li class="ex">${esc(m[1])}</li>` : `<li>${esc(p)}</li>`; };
  return `<div class="tiphero"><span class="ubadge tip">💡 WRITING TIPS</span><div class="tiphero-t">${esc(it.topic)}</div>${it.description ? `<p>${esc(it.description)}</p>` : ""}</div>
    ${it.sections.map(s => `<div class="tipsec"><h4>${esc(s.title)}</h4>${s.points.length ? `<ul>${s.points.map(pt).join("")}</ul>` : ""}${s.examples.length ? `<ul>${s.examples.map(e => `<li class="ex">${esc(e)}</li>`).join("")}</ul>` : ""}</div>`).join("")}
    ${it.scale.length ? `<div class="scale">${it.scale.map((s, i, a) => `<div class="scl" style="--lv:${(i + 1) / a.length}"><span class="scl-n">${esc(s.level)}</span><div><div class="scl-e">${esc(s.example)}</div><div class="scl-m">${esc(s.meaning)}</div></div><i class="scl-bar"></i></div>`).join("")}<div class="scale-ax"><span>${t("sxWeaker")}</span><span>${t("sxStronger")}</span></div></div>` : ""}`;
}
function storyHTML(cid, ii, st) {
  const qs = questionsOf(st);
  return `<div class="tiphero story"><span class="ubadge story">📖 LET'S WRITE A STORY</span><div class="tiphero-t">${esc(st.title)}</div></div>
    ${startButtons(cid, ii, qs.length)}
    <ul class="tl qtl">${st.prompts.map((p, i) => { const k = qs.findIndex(q => q.key === "st:" + i);
      return `<li ${k >= 0 ? `data-q="${k}"` : `class="noq"`}><span class="no">${i + 1}</span><div class="tx"><div class="te">${esc(p.ko)}</div>${/\.\.\.|…/.test(p.template) ? `<div class="tpl">${esc(p.template)}</div>` : ""}${hintChips(hintList(p.hint))}</div>${bsHTML(k >= 0 ? best[`${cid}|${ii}|st:${i}`] : null)}</li>`; }).join("")}</ul>`;
}

/* ---- create / edit sheets ---- */
function newPart() {
  const tr = trainingOf(), next = tr.parts.reduce((a, p) => Math.max(a, +p.no || 0), 0) + 1;
  openForm({
    title: t("sxNewPart"), submit: t("sxCreate"),
    fields: [{ name: "no", label: t("sxPartNo"), type: "number", value: next }, { name: "title", label: t("sxPartTitle"), type: "text", ph: t("sxPartPh") }],
    onSubmit: v => {
      if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle");
      tr.parts.push({ id: uid(), no: +v.no, title: v.title, created: Date.now(), chapters: [] }); saveMeta(); renderSx(); C.toast(t("sxCreated", `PART ${v.no}`));
    },
  });
}
function newChapter() {
  const p = partOf(), next = p.chapters.reduce((a, c) => Math.max(a, +c.no || 0), 0) + 1;
  openForm({
    title: t("sxNewChapter"), submit: t("sxCreate"),
    fields: [{ name: "file", label: t("sxJsonFile"), type: "file" }, { name: "no", label: t("sxChapterNo"), type: "number", value: next }, { name: "title", label: t("sxChapterTitle"), type: "text", ph: t("sxChapterPh") }],
    onFile: (f, parsed, set) => { const n = numbersFromFilename(f.name); if (n.chapter) set("no", n.chapter); if (parsed.title) set("title", parsed.title, true); },
    onSubmit: async v => {
      if (!v.file) return t("sxNeedFile"); if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle");
      const id = uid();
      try { await putFile(id, v.file.text); } catch (e) { return t("sxSaveFailed"); }
      cache.set(id, v.file.parsed);
      p.chapters.push({ id, no: +v.no, title: v.title, file: v.file.name, size: v.file.text.length, created: Date.now() }); saveMeta(); renderSx();
      C.toast(t("sxCreated", `CH ${v.no}`));
    },
  });
}
function editCurrent() {
  const l = level(), tr = trainingOf(), p = partOf(), ch = chapterOf();
  if (l === "training") openForm({
    title: t("sxEditTraining"), submit: t("save"), fields: [{ name: "title", label: t("sxTrainingName"), type: "text", value: tr.title }],
    onSubmit: v => { if (!v.title) return t("sxNeedTitle"); tr.title = v.title; saveMeta(); renderSx(); },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelTraining", tr.title))) return false;
      tr.parts.forEach(pt => pt.chapters.forEach(dropChapter)); meta.trainings = meta.trainings.filter(x => x !== tr); saveMeta();
      nav = { t: null, p: null, c: null, it: null }; C.showView("lib"); C.renderLib(); C.toast(t("deleted"));
    },
  });
  else if (l === "part") openForm({
    title: t("sxEditPart"), submit: t("save"),
    fields: [{ name: "no", label: t("sxPartNo"), type: "number", value: p.no }, { name: "title", label: t("sxPartTitle"), type: "text", value: p.title }],
    onSubmit: v => { if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle"); p.no = +v.no; p.title = v.title; saveMeta(); renderSx(); },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelPart", p.no, p.chapters.length))) return false;
      p.chapters.forEach(dropChapter); tr.parts = tr.parts.filter(x => x !== p); saveMeta(); nav.p = null; renderSx(); C.toast(t("deleted"));
    },
  });
  else if (l === "chapter") openForm({
    title: t("sxEditChapter"), submit: t("save"),
    fields: [{ name: "file", label: t("sxReplaceFile"), type: "file", current: ch.file }, { name: "no", label: t("sxChapterNo"), type: "number", value: ch.no }, { name: "title", label: t("sxChapterTitle"), type: "text", value: ch.title }],
    onSubmit: async v => {
      if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle");
      if (v.file) { try { await putFile(ch.id, v.file.text); } catch (e) { return t("sxSaveFailed"); } cache.set(ch.id, v.file.parsed); ch.file = v.file.name; ch.size = v.file.text.length; }
      ch.no = +v.no; ch.title = v.title; saveMeta(); renderSx();
    },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelChapter", ch.no, ch.title))) return false;
      dropChapter(ch); p.chapters = p.chapters.filter(x => x !== ch); saveMeta(); nav.c = null; renderSx(); C.toast(t("deleted"));
    },
  });
}
function dropChapter(ch) {
  delFile(ch.id); cache.delete(ch.id);
  const pre = ch.id + "|";
  Object.keys(best).forEach(k => { if (k.startsWith(pre)) delete best[k]; }); Object.keys(posMap).forEach(k => { if (k.startsWith(pre)) delete posMap[k]; });
  ls.set(K.best, best); ls.set(K.pos, posMap);
}

// Generic bottom-sheet form. fields: {name, label, type: text|number|file, value, ph, current}
function openForm({ title, fields, submit, onSubmit, onDelete, onFile }) {
  $("sxfTitle").textContent = title; $("sxfErr").className = "ferr";
  const vals = {};
  $("sxfFields").innerHTML = fields.map(f => f.type === "file"
    ? `<label class="fld"><span>${esc(f.label)}</span><button type="button" class="filebtn" data-file="${f.name}"><span class="fic">📄</span><span class="fname">${esc(f.current || t("sxPickFile"))}</span><span class="fpick">${t("sxChoose")}</span></button><span class="finfo" data-finfo="${f.name}"></span></label>`
    : `<label class="fld"><span>${esc(f.label)}</span><input class="inp" data-name="${f.name}" type="${f.type === "number" ? "number" : "text"}" ${f.type === "number" ? `inputmode="numeric" min="0"` : ""} value="${esc(f.value ?? "")}" placeholder="${esc(f.ph || "")}" autocomplete="off"></label>`).join("");
  const set = (name, v, onlyEmpty) => { const i = $("sxfFields").querySelector(`[data-name="${name}"]`); if (i && (!onlyEmpty || !i.value.trim())) i.value = v; };
  $("sxfFields").querySelectorAll("[data-file]").forEach(b => b.onclick = () => {
    const inp = $("sxFileIn"); inp.value = "";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const info = $("sxfFields").querySelector(`[data-finfo="${b.dataset.file}"]`);
      try {
        const text = await f.text(), parsed = parseChapter(text);
        vals[b.dataset.file] = { name: f.name, text, parsed };
        b.querySelector(".fname").textContent = f.name; b.classList.add("ok");
        const c = k => parsed.items.filter(i => i.kind === k).length;
        info.className = "finfo ok"; info.textContent = t("sxFileSummary", c("unit"), c("tips"), c("story"), parsed.items.reduce((a, it) => a + questionsOf(it).length, 0));
        onFile && onFile(f, parsed, set);
      } catch (e) { delete vals[b.dataset.file]; b.classList.remove("ok"); info.className = "finfo bad"; info.textContent = t("sxBadFile"); }
    };
    inp.click();
  });
  $("sxfSave").textContent = submit;
  $("sxfDel").style.display = onDelete ? "" : "none";
  const close = () => $("sxfOverlay").classList.remove("show");
  $("sxfCancel").onclick = close;
  $("sxfDel").onclick = async () => { close(); await onDelete(); };
  $("sxfSave").onclick = async () => {
    $("sxfFields").querySelectorAll("[data-name]").forEach(i => vals[i.dataset.name] = i.value.trim());
    $("sxfSave").disabled = true;
    const err = await onSubmit(vals); $("sxfSave").disabled = false;
    if (err) { $("sxfErr").textContent = err; $("sxfErr").className = "ferr show"; return; }
    close();
  };
  $("sxfOverlay").classList.add("show");
  const first = $("sxfFields").querySelector("input[type=text]");
  if (first && !fields.some(f => f.type === "file")) setTimeout(() => first.focus(), 60);
}

/* ================= TEST (one question per page) ================= */
let S = null;          // {cid, ii, item, qs, order, pos, res, start, round}
let W = {};            // qi → word-mode state {blocks, answerKeys, placed:[block pos], checked, result}
let keep = {};         // qi → Set of filled word indices (speaking; retries never un-fill)
let filled = new Set(), liveSt = null, hintLv = 0, autoT = null, silenceT = null, resultShown = false;
const qOf = () => S.qs[S.order[S.pos]], qiOf = () => S.order[S.pos];
const refCache = new Map(); const refOf = q => refCache.get(q.en) || (refCache.set(q.en, tokenize(q.en)), refCache.get(q.en));
const rec = createRecognizer({
  bias: () => S && new Set(refOf(qOf()).toks.map(x => x.t)),
  onUpdate: live,
  onEnd: ({ text, parts, interim, dropped }) => { clearTimeout(silenceT); paintMic(); if (!dropped && S) evaluate(text, parts, interim); },
  onError: code => { $("stErr").textContent = code === "not-allowed" || code === "service-not-allowed" ? t("errMic") : code === "network" ? t("errNetwork") : code === "unsupported" ? t("errUnsupported") : t("errOther", code); $("stErr").className = "err show"; },
  onResume: () => C.toast(t("resumed")),
});
const SEC = { s1: "STEP 1", var: null, s2: "STEP 2", story: "STORY" };
const secLabel = q => q.sec === "s1" ? `STEP 1 · ${q.n}/${q.of}` : q.sec === "var" ? (q.type || t("sxSecVarShort")) : q.sec === "s2" ? `STEP 2 · ${q.no ?? q.n}` : `STORY · ${q.n}/${q.of}`;

function startTest(at = 0, order = null) {
  const ch = chapterOf(), it = cache.get(ch.id).items[nav.it], qs = questionsOf(it);
  if (!qs.length) return;
  S = { cid: ch.id, ii: nav.it, item: it, qs, order: order || qs.map((_, i) => i), pos: 0, res: {}, start: Date.now(), round: order ? 2 : 1 };
  S.pos = Math.max(0, Math.min(S.order.length - 1, order ? 0 : at));
  W = {}; keep = {}; resultShown = false;
  $("stTitle").textContent = it.kind === "unit" ? `${it.no} · ${it.focus}` : itemTitle(it);
  $("stResult").classList.remove("show");
  transition(() => { C.showView("st"); paintMode(); renderQ(0); });
}
function stopTest() { if (rec.listening) rec.stop(true); clearTimeout(autoT); clearTimeout(silenceT); hush(); }
function quitTest() {
  stopTest(true); stopConfetti($("stConfetti"));
  transition(() => { C.showView("sx"); renderSx(); });
}

function paintMode() {
  $("stView").classList.toggle("wordmode", wordMode);
  $("stWordTg").setAttribute("aria-checked", wordMode); $("stWordTg").classList.toggle("on", wordMode);
  $("stAutoBtn").classList.toggle("on", autoNext);
}
function paintProg() {
  $("stCount").textContent = `${S.pos + 1}/${S.order.length}`;
  $("stProg").innerHTML = S.order.map((qi, k) => { const r = S.res[qi];
    return `<i class="${r ? (r.score === 100 ? "g" : r.score >= 50 ? "m" : "l") : ""}${k === S.pos ? " cur" : ""}"></i>`; }).join("");
}

function renderQ(dir) {
  clearTimeout(autoT); hintLv = 0; liveSt = null; $("stErr").className = "err";
  const q = qOf(), qi = qiOf(), r = S.res[qi];
  filled = new Set(keep[qi] || []);
  posMap[`${S.cid}|${S.ii}`] = qi; ls.set(K.pos, posMap);
  const card = `<div class="qcard ${dir > 0 ? "in-r" : dir < 0 ? "in-l" : "in"}">
      <div class="qtop"><span class="sec ${q.sec}">${esc(secLabel(q))}</span>${q.derived ? `<span class="qnote">${t("sxBuildUp")}</span>` : ""}${bsHTML(best[bestKey(S.cid, S.ii, q)])}</div>
      <div class="qko">${q.parts.length > 1 ? q.parts.map((p, i) => `<span class="${i === q.parts.length - 1 ? "new" : ""}">${esc(p)}</span>`).join(`<i class="sl">/</i>`) : esc(q.ko)}</div>
      ${chunkHTML(q.chunks)}
      ${q.hints.length ? `<div class="hchips">${q.hints.map(h => `<span class="hchip">🔑 ${esc(h)}</span>`).join("")}</div>` : ""}
      ${q.template ? `<div class="tpl">${esc(q.template)}</div>` : ""}
      <div class="qans" id="stAns"></div>
    </div>`;
  $("stStage").innerHTML = card; $("stStage").scrollTop = 0;
  paintAnswer();
  paintProg(); paintMic(); updateHint();
  paintResultPill(r);
}
function paintResultPill(r) {
  const el = $("stResPill");
  if (!r) { el.className = "result"; return; }
  const [cls, title] = r.score === 100 ? ["good", "Perfect! 🎉"] : r.score >= 80 ? ["good", "Great!"] : r.score >= 50 ? ["mid", "Good try!"] : ["low", "One more time!"];
  el.innerHTML = `<span class="score">${r.score}%</span><span>${title} <span class="sub">${esc(r.sub || "")}</span></span>`;
  el.className = "result show " + cls;
}

/* ---- answer area: speaking (masked word slots) or word blocks ---- */
function paintAnswer() {
  const q = qOf(), qi = qiOf(), el = $("stAns"); if (!el) return;
  if (wordMode) { paintBlocks(); return; }
  const r = S.res[qi], att = r && r.kind === "speak" ? r : null, ref = refOf(q);
  const slot = (w, k) => {
    let st = att ? att.st[k] : (liveSt && liveSt[k] === "live") || (!att && filled.has(k) && rec.listening) ? "live" : "";
    const shown = !!att || st === "live" || hintLv === 2;
    const said = att && att.said[k] ? att.said[k] : "";
    return `<span class="w ${st}${shown ? "" : " hid" + (hintLv === 1 ? " fl1" : "")}"><span class="fl">${esc(w.slice(0, 1))}</span><span class="rest">${esc(w.slice(1))}</span><span class="said">${esc(said)}</span></span>`;
  };
  const anySaid = att && att.said.some(Boolean);
  el.innerHTML = `<div class="en ${anySaid ? "has-said" : ""}" id="stEn">${ref.words.map(slot).join("")}</div>
    <div class="heard" id="stHeard">${att ? att.heardHTML : `<span class="ph">${speechEngine() ? t("sxSayIt") : t("errUnsupported")}</span>`}</div>
    ${att ? answerLine(q) : ""}`;
}
const answerLine = q => (q.raw !== q.en ? `<div class="rawans">${esc(q.raw)}</div>` : "") + (q.derived ? `<div class="rawnote">ⓘ ${t("sxAnswerFromMain")}</div>` : "");
function live({ finalText, interim, parts }) {
  if (!S || wordMode) return;
  const q = qOf(), qi = qiOf(), full = (finalText + " " + interim).trim();
  if (full && S.res[qi] && S.res[qi].kind === "speak") { delete S.res[qi]; paintResultPill(null); }
  const ref = refOf(q);
  if (full) fillWords(ref, [full, ...parts, interim]).forEach(k => filled.add(k));
  liveSt = ref.words.map((_, k) => filled.has(k) ? "live" : "");
  paintAnswer();
  const h = $("stHeard");
  if (h) h.innerHTML = full ? `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interim)}</span>` : `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`;
  $("stDone").disabled = !full;
  clearTimeout(silenceT); if (full) silenceT = setTimeout(() => rec.stop(), 30000);
  if (filled.size === ref.words.length) rec.stop();          // every blank filled → score now
}
function evaluate(said, parts, interim) {
  const q = qOf(), qi = qiOf(); liveSt = null;
  if (!said) { paintAnswer(); const h = $("stHeard"); if (h) h.innerHTML = `<span class="ph">${t("nothingHeard")}</span>`; return; }
  const r = scoreAttempt(q.en, said, [...parts, interim], [...filled]);
  keep[qi] = new Set(r.st.map((s, k) => s === "ok" ? k : -1).filter(k => k >= 0));
  const parts2 = [t("blanks", r.ok, r.total)]; if (r.bad) parts2.push(t("wrongN", r.bad)); if (r.miss) parts2.push(t("missedN", r.miss));
  record(q, qi, { kind: "speak", score: r.score, st: r.st, said: r.said, sub: parts2.join(" · "),
    heardHTML: `<span class="label">${t("youSaid")}</span>` + r.heard.map(h => `<span class="h ${h.st}">${esc(h.w)}</span>`).join(" ") });
  hintLv = 0; updateHint(); paintAnswer();
}
function record(q, qi, res) {
  S.res[qi] = res;
  const k = bestKey(S.cid, S.ii, q); if (best[k] == null || res.score > best[k]) { best[k] = res.score; ls.set(K.best, best); }
  paintResultPill(res); paintProg();
  if (res.score === 100) { chime(); haptic(20); } else if (res.kind === "word") { thud(); haptic([10, 40, 10]); }
  const top = $("stStage").querySelector(".qtop .bs"); if (top) top.outerHTML = bsHTML(best[k]);
  clearTimeout(autoT);
  if (autoNext && res.score === 100) autoT = setTimeout(() => { if (S && qiOf() === qi) nextQ(); }, 1300);
}

/* ---- word blocks ---- */
function wstate(qi) {
  if (!W[qi]) { const b = makeBlocks(S.qs[qi].en); W[qi] = { ...b, placed: [], checked: false, result: null, glow: -1 }; }
  return W[qi];
}
function paintBlocks() {
  const q = qOf(), qi = qiOf(), s = wstate(qi), el = $("stAns");
  const used = new Set(s.placed), res = s.checked ? s.result : null;
  const trayBlocks = s.placed.map((p, i) => {
    const b = s.blocks[p], ok = res ? res.ok[i] : null, want = res && !ok ? s.words[i] : "";
    return `<button class="blk ${res ? (ok ? "ok" : "bad") : "in"}" data-tray="${i}">${esc(b.text)}${want ? `<span class="want">${esc(want.replace(/[.,!?;:]+$/, ""))}</span>` : ""}</button>`;
  }).join("");
  el.innerHTML = `<div class="tray ${res ? "checked" : ""} ${s.placed.length ? "" : "empty"}" id="stTray">${trayBlocks || `<span class="ph">${t("sxTapBlocks")}</span>`}</div>
    <div class="pool" id="stPool">${s.blocks.map((b, i) => `<button class="blk ${used.has(i) ? "used" : ""} ${s.glow === i ? "glow" : ""}" data-pool="${i}" ${used.has(i) || res ? "disabled" : ""}>${esc(b.text)}</button>`).join("")}</div>
    ${res ? answerLine(q) : ""}`;
  el.querySelectorAll("[data-pool]").forEach(b => b.onclick = () => placeBlock(+b.dataset.pool));
  el.querySelectorAll("[data-tray]").forEach(b => b.onclick = () => unplace(+b.dataset.tray));
  $("stCheck").disabled = !(s.placed.length === s.blocks.length && !s.checked);
  $("stCheck").classList.toggle("next", !!s.checked);
}
function placeBlock(i) {
  unlockAudio(); const s = wstate(qiOf()); if (s.checked || s.placed.includes(i)) return;
  s.placed.push(i); s.glow = -1; tick(); haptic(8);
  if (s.placed.length === s.blocks.length) { paintBlocks(); setTimeout(checkWord, 220); return; }   // last block → check by itself
  paintBlocks(); const tray = $("stTray"); if (tray && tray.lastElementChild) tray.lastElementChild.classList.add("pop");
}
function unplace(k) { const s = wstate(qiOf()); if (s.checked) return; s.placed.splice(k, 1); tick(); paintBlocks(); }
function checkWord() {
  const q = qOf(), qi = qiOf(), s = wstate(qi); if (s.checked || s.placed.length !== s.blocks.length) return;
  s.result = checkBlocks(s.answerKeys, s.placed.map(p => s.blocks[p].key)); s.checked = true;
  record(q, qi, { kind: "word", score: s.result.score, sub: t("sxRightPos", s.result.right, s.result.total) });
  paintBlocks();
}
function resetWord() {
  const qi = qiOf(); delete W[qi];
  if (S.res[qi] && S.res[qi].kind === "word") { delete S.res[qi]; paintResultPill(null); paintProg(); }
  paintBlocks();
}
function wordHint() {
  const s = wstate(qiOf()); if (s.checked) return;
  const h = nextBlockHint(s.answerKeys, s.placed.map(p => s.blocks[p].key));
  if (h.wrongAt >= 0) { const b = $("stTray").children[h.wrongAt]; if (b) { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); } C.toast(t("sxHintWrongAt", h.wrongAt + 1)); return; }
  if (!h.key) return;
  s.glow = s.blocks.findIndex((b, i) => b.key === h.key && !s.placed.includes(i)); paintBlocks();
}

/* ---- controls ---- */
function paintMic() {
  const m = $("stMic"), on = rec.listening;
  m.classList.toggle("rec", on); m.disabled = !speechEngine();
  m.title = on ? t("micTalk") : t("micIdle"); m.setAttribute("aria-label", m.title);
  $("stDone").disabled = true;
}
function updateHint() {
  const b = $("stHint");
  if (wordMode) { b.textContent = t("hint0"); b.classList.remove("on"); return; }
  b.textContent = t("hint" + hintLv); b.classList.toggle("on", hintLv > 0);
}
function nextQ() {
  if (rec.listening) rec.stop(true);
  if (S.pos < S.order.length - 1) { S.pos++; renderQ(1); }
  else if (Object.keys(S.res).length) showResult();
  else C.toast(t("sxLastQ"));
}
function prevQ() { if (rec.listening) rec.stop(true); if (S.pos > 0) { S.pos--; renderQ(-1); } }
function jump(k) { if (rec.listening) rec.stop(true); const d = k - S.pos; S.pos = k; renderQ(Math.sign(d)); }

function showResult() {
  stopTest(true); resultShown = true;
  const done = S.order.map(qi => S.res[qi]).filter(Boolean), n = S.order.length;
  const avg = done.length ? Math.round(done.reduce((a, r) => a + r.score, 0) / done.length) : 0;
  const perfect = done.filter(r => r.score === 100).length, secs = Math.round((Date.now() - S.start) / 1000);
  const misses = S.order.filter(qi => !S.res[qi] || S.res[qi].score < 100);
  const secs2 = ["s1", "var", "s2", "story"].map(sec => { const qis = S.order.filter(qi => S.qs[qi].sec === sec); if (!qis.length) return "";
    const sc = qis.map(qi => S.res[qi] ? S.res[qi].score : 0), a = Math.round(sc.reduce((x, y) => x + y, 0) / qis.length);
    return `<div class="rsec"><span class="sec ${sec}">${sec === "var" ? t("sxSecVarShort") : SEC[sec]}</span><i><b style="width:${a}%"></b></i><span>${a}%</span></div>`; }).join("");
  $("stResBody").innerHTML = `<div class="fin-trophy">${avg >= 90 ? "🏆" : avg >= 60 ? "🎯" : "💪"}</div>
    <h1 class="fin-title">${S.round > 1 ? t("sxRetryDone") : t("sxUnitDone")}</h1><div class="fin-dlg">${esc($("stTitle").textContent)}</div>
    <div class="fin-score">${avg}%</div><div class="fin-score-l">${t("finAvg")}</div>
    <div class="fin-stats"><div><b>${perfect}/${n}</b><span>${t("finPerfect")}</span></div><div><b>${done.length}/${n}</b><span>${t("sxAnswered")}</span></div><div><b>${t("minSec", Math.floor(secs / 60), secs % 60)}</b><span>${t("finTime")}</span></div></div>
    <div class="rsecs">${secs2}</div>
    <ul class="rlist">${S.order.map((qi, k) => { const q = S.qs[qi], r = S.res[qi];
      return `<li data-k="${k}"><span class="sec ${q.sec}">${esc(secLabel(q))}</span><div class="rq"><div class="rko">${esc(q.ko)}</div><div class="ren">${esc(q.raw)}</div></div>${r ? `<span class="badge ${r.score >= 80 ? "g" : r.score >= 50 ? "m" : "l"}">${r.score}%</span>` : `<span class="badge">–</span>`}</li>`; }).join("")}</ul>
    <div class="rbtns">${misses.length ? `<button class="btn pri" id="stRetry">↻ ${t("sxRetryMissed", misses.length)}</button>` : ""}
      <button class="btn sec" id="stAgain">${t("sxAgain")}</button><button class="btn ${misses.length ? "sec" : "pri"}" id="stFinDone">${t("finDone")}</button></div>`;
  $("stResult").classList.add("show"); $("stResult").scrollTop = 0;
  $("stResBody").querySelectorAll("[data-k]").forEach(li => li.onclick = () => { $("stResult").classList.remove("show"); jump(+li.dataset.k); });
  if ($("stRetry")) $("stRetry").onclick = () => { const o = misses; $("stResult").classList.remove("show"); stopConfetti($("stConfetti")); startTest(0, o); };
  $("stAgain").onclick = () => { $("stResult").classList.remove("show"); stopConfetti($("stConfetti")); startTest(0); };
  $("stFinDone").onclick = () => { $("stResult").classList.remove("show"); posMap[`${S.cid}|${S.ii}`] = 0; ls.set(K.pos, posMap); quitTest(); };
  fanfare(); if (avg >= 60) startConfetti($("stConfetti"));
}
function openGrid() {
  $("stGridBody").innerHTML = S.order.map((qi, k) => { const r = S.res[qi], q = S.qs[qi];
    return `<button class="gcell ${r ? (r.score === 100 ? "g" : r.score >= 50 ? "m" : "l") : ""} ${k === S.pos ? "cur" : ""} ${q.sec}" data-k="${k}">${k + 1}</button>`; }).join("");
  $("stGridBody").querySelectorAll("[data-k]").forEach(b => b.onclick = () => { $("stGrid").classList.remove("show"); jump(+b.dataset.k); });
  $("stGrid").classList.add("show");
}

/* ================= init ================= */
export function initSx(ctx) {
  C = ctx; paintTabs();
  $("modeTabs").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  $("sxBack").onclick = back; $("sxMore").onclick = editCurrent;
  $("sxfOverlay").addEventListener("click", e => { if (e.target.id === "sxfOverlay") $("sxfOverlay").classList.remove("show"); });
  $("stQuit").onclick = quitTest;
  $("stCount").onclick = openGrid;
  $("stGrid").addEventListener("click", e => { if (e.target.id === "stGrid" || e.target.id === "stGridClose") $("stGrid").classList.remove("show"); });
  $("stWordTg").onclick = () => {
    if (rec.listening) rec.stop(true);
    wordMode = !wordMode; ls.set(K.word, wordMode); paintMode(); updateHint(); paintAnswer(); paintResultPill(S && S.res[qiOf()]);
    C.toast(wordMode ? t("sxWordOnToast") : t("sxWordOffToast"));
  };
  $("stMic").onclick = () => {
    unlockAudio(); if (!S) return;
    if (rec.listening) { rec.stop(); return; }
    const qi = qiOf(); clearTimeout(autoT);
    if (S.res[qi] && S.res[qi].kind === "speak") { delete S.res[qi]; paintResultPill(null); }
    filled = new Set(keep[qi] || []); liveSt = null; $("stErr").className = "err"; hush();
    rec.start(); paintMic(); live({ finalText: "", interim: "", parts: [] });
  };
  $("stDone").onclick = () => { unlockAudio(); if (rec.listening) rec.stop(); };
  $("stHint").onclick = () => { if (wordMode) { wordHint(); return; } hintLv = (hintLv + 1) % 3; updateHint(); paintAnswer(); };
  [$("stPlay"), $("stPlayW")].forEach(b => b.onclick = () => { if (rec.listening) rec.stop(true); say(qOf().en); });
  $("stAutoBtn").onclick = () => { autoNext = !autoNext; ls.set(K.auto, autoNext); paintMode(); };
  $("stReset").onclick = resetWord; $("stHintW").onclick = wordHint;
  $("stCheck").onclick = () => { unlockAudio(); const s = wstate(qiOf()); if (s.checked) nextQ(); else checkWord(); };
  ["stPrev", "stPrevW"].forEach(id => $(id).onclick = prevQ);
  ["stNext", "stNextW"].forEach(id => $(id).onclick = () => { unlockAudio(); nextQ(); });
  // horizontal swipe on the question = previous / next
  let sx0 = null;
  $("stStage").addEventListener("pointerdown", e => { sx0 = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  $("stStage").addEventListener("pointerup", e => {
    if (!sx0) return; const dx = e.clientX - sx0.x, dy = e.clientY - sx0.y, dt = Date.now() - sx0.t; sx0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && dt < 600) dx < 0 ? nextQ() : prevQ();
  });
  document.addEventListener("keydown", e => {
    const v = C.view();
    if (/TEXTAREA|INPUT/.test(e.target.tagName) || document.querySelector(".overlay.show,.modal.show")) return;
    if (v === "sx" && e.key === "Escape") { back(); return; }
    if (v !== "st" || $("stResult").classList.contains("show")) { if (v === "st" && e.key === "Escape") quitTest(); return; }
    if (e.key === "Escape") quitTest();
    else if (e.key === "ArrowRight") { e.preventDefault(); nextQ(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prevQ(); }
    else if (e.code === "Space") { e.preventDefault(); (wordMode ? $("stCheck") : $("stMic")).click(); }
    else if (e.key === "Enter") { e.preventDefault(); wordMode ? $("stCheck").click() : $("stDone").click(); }
    else if (e.key === "h" || e.key === "H") $("stHint").click();
    else if (e.key === "l" || e.key === "L") say(qOf().en);
  });
}
export function sxApplyLang() {
  paintTabs();
  const v = C.view();
  if (v === "sx") renderSx();
  else if (v === "st" && S) { if ($("stResult").classList.contains("show")) showResult(); else renderQ(0); paintMode(); }
}
