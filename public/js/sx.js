// 문장만들기 (sentence building) — the second mode next to 대화 (dialogues).
// Library tab "문장만들기": 훈련 list → 훈련 (parts) → 파트 (chapters, each one imported JSON file) → 챕터 (units,
// writing tips, story) → item page (content without answers + 테스트) → test (one question per page).
// Content is import-only: the only things typed in are numbers and titles.
import { t, lang } from "./i18n.js";
import { tokenize, fillWords, scoreAttempt } from "./core.js";
import { parseChapter, itemTitle, questionsOf, slashParts, chunksOf, hintList, makeBlocks, checkBlocks, nextBlockHint, numbersFromFilename, typeSlots, checkTyped, typedKey, nextStop } from "./sxcore.js";
import { putFile, getFile, delFile } from "./sxstore.js";
import { ls as store, account, sharedContent } from "./store.js";
import { createRecognizer, speechEngine } from "./speech.js";
import * as Rt from "./router.js";
import { chime, thud, tick, fanfare, unlockAudio, startConfetti, stopConfetti, say, hush, haptic } from "./fx.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const K = { meta: "speakup.sx.v1", best: "speakup.sxbest.v1", pos: "speakup.sxpos.v1", word: "speakup.sxword.v1", input: "speakup.sxinput.v2", auto: "speakup.sxauto.v1", mode: "speakup.mode.v1", sess: "speakup.sxsess.v1", keep: "speakup.sxkeep.v1", done: "speakup.sxdone.v1", act: "speakup.sxact.v1" };
const ls = {
  get(k, d) { return store.get(k, d); },
  set(k, v) { try { store.set(k, v); } catch (e) { C.toast(t("sxStoreFull")); } },
};
let C = null;   // context from app.js: {showView, view(), toast, ask, renderLib}
let meta = ls.get(K.meta, null); if (!meta || !Array.isArray(meta.trainings)) meta = { trainings: [] };
// v3.22: trainings other users shared (read-only, carry `owner`); progress is still this user's own
const okTr = x => x && x.id && Array.isArray(x.parts);
let sharedTr = (sharedContent().trainings || []).filter(okTr);
export function refreshSharedSx() { sharedTr = (sharedContent().trainings || []).filter(okTr); }
const roTr = tr => !!(tr && tr.owner);
let best = ls.get(K.best, {});      // "chapterId|itemIndex|questionKey" → best score
let doneAt = ls.get(K.done, {});  // "chapterId|itemIndex" → ms when every question of the unit/story was first answered (v3.23)
let act = ls.get(K.act, null); if (!act || typeof act !== "object") act = {};   // {last:{t,p,c,ii,at}, days:{"YYYY-MM-DD": answers}}
if (!act.days) act.days = {};
const pad2 = n => String(n).padStart(2, "0");
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
let sess = ls.get(K.sess, {});      // "chapterId|itemIndex" → unfinished run {pos, res:{qi: score}, start} (이어서)
// input mode: "type" (keyboard into the blanks — default since v3.18) | "speak" | "block" (word blocks)
// v3.19: speaking and typing are one mode ("type": blanks you can type into any time + a mic you can turn on
// any time; speech fills the blanks it hears). The other mode is "block" (word blocks). Old "speak" → "type".
let inMode = ls.get(K.input, "type"); if (inMode !== "block") inMode = "type";
let wordMode = true, blockMode = inMode === "block", typeMode = inMode === "type";
const stayOn = () => keepOn || typeMode;   // mic stays on across questions (typing mode: until you turn it off)
let autoNext = ls.get(K.auto, true), keepOn = ls.get(K.keep, false);
const saveMeta = () => ls.set(K.meta, meta);
const cache = new Map();            // chapterId → parsed chapter (loaded into memory once)
const transition = fn => (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) ? document.startViewTransition(fn) : fn();

/* ================= mode tabs (대화 | 문장만들기) ================= */
export let mode = ls.get(K.mode, "dlg") === "sx" ? "sx" : "dlg";
function paintTabs() {
  document.body.dataset.mode = mode;
  document.querySelectorAll("#modeTabs [data-mode]").forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
}
function setMode(m) { if (m !== mode) Rt.go("/" + m, { replace: true }); }
// called by the router for /dlg and /sx
export function setTabMode(m) {
  if (m === mode) { paintTabs(); return; }
  transition(() => { mode = m; ls.set(K.mode, m); paintTabs(); C.renderLib(); });
}
/* ---- routes (v3.25): /sx/<training>[/<chapter>[/<item>[/test]]] ---- */
const pathOf = (n = nav) => "/sx/" + [n.t, n.c, n.it].filter(x => x != null).join("/");
let pendingStart = null;   // {at, how} from a button, used when the /test route opens
export function sxLeave() { stopTest(true); stopConfetti($("stConfetti")); $("stResult").classList.remove("show"); }
export async function sxRoute([tid, cid, ii, test]) {
  const tr = meta.trainings.find(x => x.id === tid) || sharedTr.find(x => x.id === tid);
  if (!tr) { Rt.go("/sx", { replace: true }); return; }
  let p = null, ch = null;
  if (cid) for (const pt of tr.parts || []) { const c = (pt.chapters || []).find(x => x.id === cid); if (c) { p = pt; ch = c; break; } }
  if (cid && !ch) { Rt.go("/sx/" + tid, { replace: true }); return; }
  const it = ii != null && ii !== "" && !isNaN(+ii) ? +ii : null;
  if (nav.t !== tid) editMode = false;
  nav = { t: tid, p: p && p.id, c: ch && ch.id, it };
  if (test === "test" && ch && it != null) {
    try { await loadChapter(ch); } catch (e) { Rt.go(pathOf(), { replace: true }); return; }
    const ps = pendingStart; pendingStart = null;
    startTest(ps ? ps.at : 0, ps ? ps.how : (sess[`${ch.id}|${it}`] ? "resume" : "new"));
    return;
  }
  if (C.view() === "st") sxLeave();
  transition(() => { C.showView("sx"); renderSx(); $("sxScroll").scrollTop = 0; });
}
const openTest = (at, how) => { pendingStart = { at, how }; Rt.go(pathOf() + "/test"); };

/* ================= tree helpers ================= */
let nav = { t: null, p: null, c: null, it: null };
const trainingOf = () => meta.trainings.find(x => x.id === nav.t) || sharedTr.find(x => x.id === nav.t);
const partOf = () => { const tr = trainingOf(); return tr && tr.parts.find(x => x.id === nav.p); };
const chapterOf = () => { const p = partOf(); return p && p.chapters.find(x => x.id === nav.c); };
// v3.20: no separate part page — the training page lists every part (as a section header) with its chapters
const level = () => nav.it != null ? "item" : nav.c ? "chapter" : "training";
const byNo = (a, b) => (a.no - b.no) || (a.created - b.created);
const bestKey = (cid, ii, q) => `${cid}|${ii}|${q.key}`;
function itemStats(cid, ii, it) {
  const qs = questionsOf(it).filter(q => !q.noAnswer), sc = qs.map(q => best[bestKey(cid, ii, q)]).filter(v => v != null);
  return { total: qs.length, done: sc.length, avg: sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null };
}
async function loadChapter(ch) {
  if (cache.has(ch.id)) return cache.get(ch.id);
  const raw = await getFile(ch.id); if (raw == null) throw new Error("missing");
  const parsed = parseChapter(raw); cache.set(ch.id, parsed); return parsed;
}
// progress ring (answered / total) — no numbers: scores are not the point (owner, v3.17)
const ring = (done, total) => {
  const r = 17, c = 2 * Math.PI * r, p = total ? done / total : 0;
  return `<span class="ring ${!done ? "none" : ""}"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="${r}" class="rb"/><circle cx="20" cy="20" r="${r}" class="rf" stroke-dasharray="${c * p} ${c}"/></svg><b class="${p >= 1 ? "ck" : ""}">${p >= 1 ? "✓" : ""}</b></span>`;
};

/* ================= library tab: 훈련 list ================= */
export function renderTrainings(el) {
  const list = [...meta.trainings].sort((a, b) => b.created - a.created);
  const sh = [...sharedTr].sort((a, b) => b.created - a.created);
  const shHTML = sh.length ? `<div class="secdiv"><span>📚 ${t("sharedSec")}</span><i></i></div>` + sh.map(tr => {
    const nCh = tr.parts.reduce((a, p) => a + (p.chapters || []).length, 0);
    return `<div class="dcard sxcard shared" data-tid="${tr.id}"><span class="dno sh">📚</span>
      <div class="dmain"><div class="dt">${esc(tr.title)} <span class="shtag in">${t("sharedTag")}</span></div><div class="dm">${t("sxTrainingMeta", tr.parts.length, nCh)}</div><div class="dby">${t("sharedBy", tr.owner.name || "")}</div></div><span class="chev">›</span></div>`;
  }).join("") + `<div class="secdiv"><span>${t("mySec")}</span><i></i></div>` : "";
  const home = homeHTML();
  if (!list.length) {
    el.innerHTML = home + shHTML + `<div class="sx-empty"><div class="sx-empty-ic">🧩</div><b>${t("sxEmptyTitle")}</b><p>${t("sxEmptyBody")}</p><button class="btn pri" id="sxFirst">${t("sxNewTraining")}</button></div>`;
    $("sxFirst").onclick = newTraining;
    el.querySelectorAll("[data-tid]").forEach(c => c.onclick = () => openTraining(c.dataset.tid)); fillHome(el); return;
  }
  el.innerHTML = home + shHTML + list.map((tr, i) => {
    const nCh = tr.parts.reduce((a, p) => a + p.chapters.length, 0);
    return `<div class="dcard sxcard" data-tid="${tr.id}"><span class="dno sxno">${list.length - i}</span>
      <div class="dmain"><div class="dt">${esc(tr.title)}${tr.shared ? ` <span class="shtag">${t("sharingTag")}</span>` : ""}</div><div class="dm">${t("sxTrainingMeta", tr.parts.length, nCh)}</div></div><span class="chev">›</span></div>`;
  }).join("");
  el.querySelectorAll("[data-tid]").forEach(c => c.onclick = () => openTraining(c.dataset.tid));
  fillHome(el);
}

/* ---- Sentences home (v3.23): 이어서 하기 card + a few small stats, then the list ---- */
const allTr = () => [...meta.trainings, ...sharedTr];
function findCh(c) {
  for (const tr of allTr()) for (const p of tr.parts || []) for (const ch of p.chapters || []) if (ch.id === c) return { tr, p, ch };
  return null;
}
function streak() {
  let n = 0; const d = new Date();
  if (!act.days[ymd(d)]) d.setDate(d.getDate() - 1);          // today not practised yet: the streak can still be alive from yesterday
  while (act.days[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function homeHTML() {
  const L = act.last && findCh(act.last.c);
  const today = act.days[ymd(Date.now())] || 0, stk = streak(), nDone = Object.keys(doneAt).filter(k => findCh(k.split("|")[0])).length;
  const stats = (stk || today || nDone) ? `<div class="hstats">
      <div class="hst"><b>🔥 ${stk}</b><span>${t("hStreak")}</span></div>
      <div class="hst"><b>✏️ ${today}</b><span>${t("hToday")}</span></div>
      <div class="hst"><b>🏆 ${nDone}</b><span>${t("hUnits")}</span></div></div>` : "";
  const hero = L ? `<div class="hero" id="sxHero"><div class="hero-l">${t("hContinue")}</div>
      <div class="hero-t" id="sxHeroT">${esc(L.tr.title)} · CH ${esc(L.ch.no)}</div>
      <div class="hero-u" id="sxHeroU">…</div>
      <div class="hero-f"><div class="hero-bar"><i id="sxHeroBar"></i></div><button class="hero-go" id="sxHeroGo">▶ ${t("hGo")}</button></div></div>` : "";
  return hero + stats;
}
async function fillHome(el) {
  const L = act.last && findCh(act.last.c); if (!L || !$("sxHero")) return;
  let d; try { d = await loadChapter(L.ch); } catch (e) { $("sxHero").remove(); return; }
  if (!el.isConnected || !$("sxHero")) return;
  // the last unit, or — if it is finished — the next unit/story in that chapter that isn't
  const playable = d.items.map((it, i) => [it, i]).filter(([it]) => it.kind !== "tips");
  let ii = act.last.ii, it = d.items[ii], next = false;
  const st0 = it && itemStats(L.ch.id, ii, it);
  if (!it || it.kind === "tips" || (st0.total && st0.done >= st0.total)) {
    const nx = playable.find(([x, i]) => i > (it ? ii : -1) && (() => { const s = itemStats(L.ch.id, i, x); return !s.total || s.done < s.total; })());
    if (!nx) { $("sxHero").remove(); return; }
    [it, ii] = nx; next = true;
  }
  const s = itemStats(L.ch.id, ii, it);
  $("sxHeroU").textContent = it.kind === "unit" ? `${it.no} · ${it.focus}` : itemTitle(it);
  $("sxHeroBar").style.width = (s.total ? Math.round(s.done / s.total * 100) : 0) + "%";
  if (next) { $("sxHeroGo").textContent = "▶ " + t("hNext"); $("sxHero").querySelector(".hero-l").textContent = t("hUpNext"); }
  $("sxHeroGo").onclick = () => {
    Rt.go(`/sx/${L.tr.id}/${L.ch.id}/${ii}/test`);
  };
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
function openTraining(id) { Rt.go("/sx/" + id); }

/* ================= sx view (training / part / chapter / item) ================= */
function go(dir = "fwd") {
  stopTest(true);
  transition(() => { C.showView("sx"); renderSx(); $("sxScroll").scrollTop = 0; });
}
function back() {
  const l = level();
  Rt.back(l === "item" ? pathOf({ ...nav, it: null }) : l === "chapter" ? "/sx/" + nav.t : "/sx");
}
async function renderSx() {
  const tr = trainingOf(); if (!tr) { Rt.go("/sx", { replace: true }); return; }
  const l = level(), p = partOf(), ch = chapterOf(), body = $("sxBody");
  const crumb = [tr.title, p && `PART ${p.no}`, ch && `CH ${ch.no}`].filter(Boolean);
  $("sxCrumb").textContent = crumb.slice(0, -1).join(" › ") || t("sxTraining");
  const ro = roTr(tr);
  $("sxMore").style.visibility = l === "item" || ro ? "hidden" : "";
  if (l !== "training" || ro) editMode = false;
  $("sxMore").textContent = l === "training" ? t(editMode ? "sxDoneEdit" : "sxEdit") : t("editInfo");
  $("sxMore").classList.toggle("editon", l === "training" && editMode);
  $("sxView").classList.toggle("editing", l === "training" && editMode);
  $("sxView").classList.toggle("trlevel", l === "training");
  closeDial();
  const fab = $("sxFab"); fab.style.display = "none"; fab.classList.remove("round");
  if (l === "training") {
    $("sxTitle").textContent = tr.title;
    if (editMode) $("sxCrumb").textContent = t("sxEditing");
    const parts = [...tr.parts].sort(byNo), chs = [];
    parts.forEach(pt => [...pt.chapters].sort(byNo).forEach(c => chs.push(c)));
    const shareBar = ro ? `<div class="shbar ro">📚 ${t("sharedBy", tr.owner.name || "")} · ${t("readOnly")}</div>`
      : tr.shared ? `<div class="shstat">🔗 ${t("sharingNow")}</div>` : "";
    if (editMode) body.innerHTML = trainingEditHTML(tr, parts);
    else body.innerHTML = shareBar + (chs.length ? `<div class="trprog"><span>${t("sxProgLbl")}</span><div class="trbar"><i id="sxProgBar" style="width:0%"></i></div><b id="sxProgTxt"></b></div>` : "")
      + (parts.length ? parts.map(pt => `<div class="pdiv"><span class="pno">PART ${esc(pt.no)}</span><b>${esc(pt.title)}</b><i></i></div>`
        + ([...pt.chapters].sort(byNo).map(c => `<button class="chcard" data-cid="${c.id}" data-pc="${pt.id}"><span class="chbadge" data-cbadge="${c.id}">${esc(c.no)}</span>
            <span class="chmain"><span class="cht">CH ${esc(c.no)} · ${esc(c.title)}</span><span class="chm" data-cmeta="${c.id}">${esc(c.file || "")}</span></span>
            <svg class="chev2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join("")
          || `<div class="pempty">${t("sxNoChaptersYet")}</div>`)).join("")
      : emptyHint("📚", t("sxNoParts")));
    body.querySelectorAll(".chcard[data-cid]").forEach(c => c.onclick = () => Rt.go(`/sx/${nav.t}/${c.dataset.cid}`));
    if (editMode) { wireTrainingEdit(tr, body); return; }
    if (!ro) { fab.style.display = ""; fab.classList.add("round"); } $("sxFabLbl").textContent = ""; fab.onclick = toggleDial;
    let qT = 0, qD = 0, cDone = 0, left = chs.length;
    for (const c of chs) {   // status per chapter once its file is read
      loadChapter(c).then(d => {
        const units = d.items.map((it, i) => [it, i]).filter(([it]) => it.kind === "unit");
        let tot = 0, done = 0; units.forEach(([it, i]) => { const s = itemStats(c.id, i, it); tot += s.total; done += s.done; });
        qT += tot; qD += done; if (tot && done >= tot) cDone++;
        const st = !tot || !done ? "new" : done >= tot ? "done" : "doing";
        const m = body.querySelector(`[data-cmeta="${c.id}"]`), card = body.querySelector(`.chcard[data-cid="${c.id}"]`), b = body.querySelector(`[data-cbadge="${c.id}"]`);
        if (m) m.textContent = `${t("sxUnitsCount", units.length)} · ${st === "done" ? t("sxStDone") : st === "doing" ? t("sxStDoing", done, tot) : t("sxStNew")}`;
        if (card) card.classList.add(st);
        if (b && st === "done") b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }).catch(() => { const m = body.querySelector(`[data-cmeta="${c.id}"]`); if (m) m.textContent = t("sxFileMissing"); })
        .finally(() => { if (--left) return; const bar = $("sxProgBar"), tx = $("sxProgTxt"); if (bar) bar.style.width = (qT ? Math.round(qD / qT * 100) : 0) + "%"; if (tx) tx.textContent = t("sxProgress", cDone, chs.length); });
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
          <div class="ucard-ko">${esc(it.ko)}</div><div class="ucard-f"><span>${t("sxQCount", s.total)}${s.done ? ` · ${t("sxDoneN", s.done)}` : ""}</span>${doneTag(ch.id, i)}${ring(s.done, s.total)}</div></div>`;
      }
      if (it.kind === "tips") return `<div class="ucard tips" data-it="${i}"><div class="ucard-h"><span class="ubadge tip">💡 WRITING TIPS</span></div><div class="ucard-ko">${esc(it.topic)}</div></div>`;
      const s = itemStats(ch.id, i, it);
      return `<div class="ucard story" data-it="${i}"><div class="ucard-h"><span class="ubadge story">📖 LET'S WRITE A STORY</span></div><div class="ucard-ko">${esc(it.title)}</div>
        <div class="ucard-f"><span>${t("sxStoryLines", it.prompts.length)}${s.done ? ` · ${t("sxDoneN", s.done)}` : ""}</span>${doneTag(ch.id, i)}${s.total ? ring(s.done, s.total) : ""}</div></div>`;
    }).join("");
    body.querySelectorAll("[data-it]").forEach(c => c.onclick = () => Rt.go(`/sx/${nav.t}/${nav.c}/${c.dataset.it}`));
  } else {
    let d; try { d = await loadChapter(ch); } catch (e) { body.innerHTML = emptyHint("⚠️", t("sxFileMissing")); return; }
    if (level() !== "item" || chapterOf() !== ch) return;
    const it = d && d.items[nav.it]; if (!it) { Rt.go(pathOf({ ...nav, it: null }), { replace: true }); return; }
    $("sxTitle").textContent = it.kind === "unit" ? `${it.no} · ${it.focus}` : itemTitle(it);
    body.innerHTML = it.kind === "unit" ? unitHTML(ch.id, nav.it, it) : it.kind === "tips" ? tipsHTML(it) : storyHTML(ch.id, nav.it, it);

  }
}
const doneTag = (cid, ii) => { const at = doneAt[`${cid}|${ii}`]; return at ? `<span class="udone">✓ ${ymd(at)}</span>` : ""; };
const emptyHint = (ic, msg) => `<div class="sx-empty small"><div class="sx-empty-ic">${ic}</div><p>${msg}</p></div>`;
const hintChips = hs => hs.length ? `<div class="hchips">${hs.map(h => `<span class="hchip">${esc(h)}</span>`).join("")}</div>` : "";
const slashHTML = s => slashParts(s).map(esc).join(`<i class="sl">/</i>`);
const chunkHTML = cs => cs.length ? `<div class="chunks">${cs.map(c => `<span>${esc(c)}</span>`).join(`<i>+</i>`)}</div>` : "";
const noAnsTag = () => `<span class="noans">${t("sxNoAns")}</span>`;
// per-question mark: ✓ said/typed it all right once, • tried (no numbers)
const bsHTML = v => `<span class="bs ${v === 100 ? "p" : v != null ? "t" : ""}">${v === 100 ? "✓" : v != null ? "•" : ""}</span>`;
function startButtons(cid, ii, n) {
  if (!n) return "";
  const ss = sess[`${cid}|${ii}`], done = ss ? Object.keys(ss.res || {}).length : 0;
  return `<div class="startrow sxstart">${ss && (ss.pos > 0 || done)
    ? `<button class="btn sec" id="sxStart">▶ ${t("sxTestN", n)}</button><button class="btn pri" id="sxResume">⏯ ${t("sxResumeAt", Math.min(ss.pos, n - 1) + 1, n)}</button>`
    : `<button class="btn pri" id="sxStart">▶ ${t("sxTestN", n)}</button>`}</div>`;
}
function unitHTML(cid, ii, u) {
  const qs = questionsOf(u), idxOf = key => qs.findIndex(q => q.key === key), b = key => best[`${cid}|${ii}|${key}`];
  const s = itemStats(cid, ii, u);
  return `<div class="uhero"><div class="ucard-h"><span class="ubadge">${esc(u.no)}</span><span class="ufocus">${esc(u.focus)}</span></div>
      <div class="uhero-ko">${esc(u.ko)}</div>${chunkHTML(chunksOf(u.core))}</div>
    <div class="stats"><div class="stat"><b>${s.total}</b><span>${t("sxQuestions")}</span></div><div class="stat"><b>${s.done}</b><span>${t("sxTried")}</span></div></div>
    ${startButtons(cid, ii, qs.length)}
    <h3 class="sxh"><span class="sec s1">STEP 1</span>${t("sxSecSteps")}</h3>
    <ul class="tl qtl">${u.steps.map((st, i) => `<li role="button" tabindex="0" data-q="${idxOf("s1:" + i)}"><span class="no">${i + 1}</span><div class="tx"><div class="te">${slashHTML(st.ko)}</div>${hintChips(hintList(st.hint))}</div>${bsHTML(b("s1:" + i))}</li>`).join("")}</ul>
    ${u.variations.length ? `<h3 class="sxh"><span class="sec var">${t("sxSecVarShort")}</span>${t("sxSecVar")}</h3>
    <ul class="tl qtl">${u.variations.map((v, i) => { const k = idxOf("var:" + i);
      return `<li ${k >= 0 ? `role="button" tabindex="0" data-q="${k}"` : ""}><span class="no">${i + 1}</span><div class="tx"><div class="vtype">${esc(v.type)}</div><div class="te">${esc(v.ko)}</div>${chunkHTML(chunksOf(v.chunk))}${hintChips(v.wordHint ? [v.wordHint] : [])}</div>${v.en ? bsHTML(b("var:" + i)) : noAnsTag()}</li>`; }).join("")}</ul>` : ""}
    ${u.s2.length ? `<h3 class="sxh"><span class="sec s2">STEP 2</span>${t("sxSecS2")}</h3>
    <ul class="tl qtl">${u.s2.map((x, i) => { const k = idxOf("s2:" + i);
      return `<li ${k >= 0 ? `role="button" tabindex="0" data-q="${k}"` : ""}><span class="no">${esc(x.no)}</span><div class="tx"><div class="te">${esc(x.ko)}</div>${chunkHTML(chunksOf(x.chunk))}${hintChips(hintList(x.hint))}</div>${x.en ? bsHTML(b("s2:" + i)) : noAnsTag()}</li>`; }).join("")}</ul>` : ""}`;
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
      return `<li ${k >= 0 ? `role="button" tabindex="0" data-q="${k}"` : `class="noq"`}><span class="no">${i + 1}</span><div class="tx"><div class="te">${esc(p.ko)}</div>${/\.\.\.|…/.test(p.template) ? `<div class="tpl">${esc(p.template)}</div>` : ""}${hintChips(hintList(p.hint))}</div>${p.en ? bsHTML(best[`${cid}|${ii}|st:${i}`]) : noAnsTag()}</li>`; }).join("")}</ul>`;
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
function newChapter(p) {
  const next = p.chapters.reduce((a, c) => Math.max(a, +c.no || 0), 0) + 1;
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
  if (l === "training") { editMode = !editMode; renderSx(); return; }
  editChapter(tr, p, ch);
}
let editMode = false;   // training page: ✎ buttons only in 편집 mode (v3.21, 시안 A)
const ICON = {
  pen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></svg>`,
  bin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  dots: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  fileok: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M10 14l2 2 3-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lines: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
function trainingEditHTML(tr, parts) {
  return `<button class="trname" id="sxTrName"><span>${esc(tr.title)}</span>${ICON.pen}</button>`
    + (account() ? `<button class="shbar ${tr.shared ? "on" : ""}" id="sxShareTgl"><span class="sw"><i></i></span><span>${tr.shared ? t("shareOnTr") : t("shareOffTr")}</span></button>` : "")
    + parts.map(pt => `<div class="eprow"><span class="pno">PART ${esc(pt.no)}</span><b>${esc(pt.title)}</b>
        <button class="eadd" data-padd="${pt.id}">${ICON.plus}${t("sxTabCh")}</button><button class="eic" data-pedit="${pt.id}" aria-label="${esc(t("sxEditPart"))}">${ICON.dots}</button></div>`
      + [...pt.chapters].sort(byNo).map(c => `<div class="ecrow"><div class="chmain"><span class="cht">CH ${esc(c.no)} · ${esc(c.title)}</span><span class="chm">${esc(c.file || "")}</span></div>
        <button class="eic" data-cedit="${c.id}" data-pc="${pt.id}" aria-label="${esc(t("sxEditChapter"))}">${ICON.pen}</button><button class="eic del" data-cdel="${c.id}" data-pc="${pt.id}" aria-label="${esc(t("del"))}">${ICON.bin}</button></div>`).join("")).join("")
    + (parts.length ? "" : emptyHint("📚", t("sxNoParts")))
    + `<div class="ebar"><button class="btn sec" id="sxEAddPart">${ICON.plus}${t("sxAddPart")}</button><button class="btn sec danger2" id="sxEDelTr">${t("sxDelTraining")}</button></div>`;
}
function wireTrainingEdit(tr, body) {
  const P = id => tr.parts.find(x => x.id === id);
  $("sxTrName").onclick = renameTraining;
  if ($("sxShareTgl")) $("sxShareTgl").onclick = () => {   // 공유 only in 편집 mode (owner: no accidental toggling)
    tr.shared = !tr.shared; if (!tr.shared) delete tr.shared; saveMeta(); renderSx(); C.toast(tr.shared ? t("sharedToast") : t("unsharedToast"));
  };
  body.querySelectorAll("[data-padd]").forEach(b => b.onclick = () => openAdd("ch", b.dataset.padd));
  body.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => editPart(P(b.dataset.pedit)));
  body.querySelectorAll("[data-cedit]").forEach(b => b.onclick = () => { const p = P(b.dataset.pc); editChapter(tr, p, p.chapters.find(c => c.id === b.dataset.cedit)); });
  body.querySelectorAll("[data-cdel]").forEach(b => b.onclick = async () => {
    const p = P(b.dataset.pc), ch = p.chapters.find(c => c.id === b.dataset.cdel);
    if (!await C.ask(t("sxConfirmDelChapter", ch.no, ch.title))) return;
    dropChapter(ch); p.chapters = p.chapters.filter(x => x !== ch); saveMeta(); renderSx(); C.toast(t("deleted"));
  });
  $("sxEAddPart").onclick = () => openAdd("pt");
  $("sxEDelTr").onclick = async () => {
    if (!await C.ask(t("sxConfirmDelTraining", tr.title))) return;
    tr.parts.forEach(pt => pt.chapters.forEach(dropChapter)); meta.trainings = meta.trainings.filter(x => x !== tr); saveMeta();
    nav = { t: null, p: null, c: null, it: null }; editMode = false; Rt.go("/sx", { replace: true }); C.toast(t("deleted"));
  };
}
// ＋ speed dial (training page): 파트 추가 / 챕터 추가 (JSON)
function toggleDial() { $("sxView").classList.toggle("dial"); }
function closeDial() { $("sxView").classList.remove("dial"); }

/* ---- 추가 시트 (시안 A3): 챕터 | 파트 tabs, file card, part chips, number stepper, title ---- */
let AS = null;
const nextNo = list => list.reduce((a, x) => Math.max(a, +x.no || 0), 0) + 1;
function openAdd(tab = "ch", pid = null) {
  const tr = trainingOf(), parts = [...tr.parts].sort(byNo);
  const pick = pid || (parts.length ? parts[parts.length - 1].id : null);
  AS = { tab: parts.length ? tab : "pt", back: !parts.length && tab === "ch", pid: pick, file: null, chNo: pick ? nextNo(tr.parts.find(x => x.id === pick).chapters) : 1, chTitle: "", ptNo: nextNo(tr.parts), ptTitle: "", noFromFile: false };
  closeDial(); paintAdd(); $("sxAdd").classList.add("show");
}
function syncAdd() {
  const g = id => $(id) ? $(id).value.trim() : null;
  if (AS.tab === "ch") { if (g("asNo") != null) AS.chNo = g("asNo"); if (g("asTitle") != null) AS.chTitle = g("asTitle"); }
  else { if (g("asNo") != null) AS.ptNo = g("asNo"); if (g("asTitle") != null) AS.ptTitle = g("asTitle"); }
}
function paintAdd() {
  const tr = trainingOf(), parts = [...tr.parts].sort(byNo), f = AS.file;
  $("sxAddSeg").querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === AS.tab));
  $("sxAddErr").className = "ferr";
  const stepper = v => `<div class="stepper"><button type="button" data-step="-1" aria-label="−">−</button><input id="asNo" inputmode="numeric" value="${esc(v)}" autocomplete="off"><button type="button" data-step="1" aria-label="+">+</button></div>`;
  if (AS.tab === "ch") {
    const cnt = k => f ? f.parsed.items.filter(i => i.kind === k).length : 0;
    $("sxAddBody").innerHTML = (f
      ? `<div class="afile ok"><span class="afic">${ICON.fileok}</span><div class="afmain"><b>${esc(f.name)}</b><div class="afchips"><span class="c1">${t("sxUnitsN", cnt("unit"))}</span>${cnt("tips") ? `<span class="c2">${t("sxTipsN", cnt("tips"))}</span>` : ""}${cnt("story") ? `<span class="c3">${t("sxStoryN", cnt("story"))}</span>` : ""}</div></div><button type="button" class="afswap" id="asPick" aria-label="${esc(t("sxReplaceFile"))}">${ICON.swap}</button></div>`
      : `<button type="button" class="afile drop" id="asPick"><span class="afic up">${ICON.up}</span><b>${t("sxPickJson")}</b><small>${t("sxPickJsonSub")}</small></button>`)
      + `<div class="alab">${t("sxWhichPart")}</div><div class="pchips">${parts.map(pt => `<button type="button" class="pchip ${pt.id === AS.pid ? "on" : ""}" data-pid="${pt.id}">PART ${esc(pt.no)}${pt.id === AS.pid ? ` · ${esc(pt.title)}` : ""}</button>`).join("")}<button type="button" class="pchip new" id="asNewPart">＋ ${t("sxNewPartChip")}</button></div>`
      + `<div class="arow"><div class="acol no"><label class="alab" for="asNo">${t("sxNoLbl")}</label>${stepper(AS.chNo)}</div>
         <div class="acol"><label class="alab" for="asTitle">${t("sxTitleLbl")}${AS.titleAuto ? ` <i>· ${t("sxFromFile")}</i>` : ""}</label><input class="ainp" id="asTitle" value="${esc(AS.chTitle)}" placeholder="${esc(t("sxChapterPh"))}" autocomplete="off"></div></div>`;
    $("sxAddGo").textContent = t("sxNewChapter");
  } else {
    $("sxAddBody").innerHTML = `<div class="arow"><div class="acol no"><label class="alab" for="asNo">${t("sxNoLbl")}</label>${stepper(AS.ptNo)}</div>
      <div class="acol"><label class="alab" for="asTitle">${t("sxTitleLbl")}</label><input class="ainp" id="asTitle" value="${esc(AS.ptTitle)}" placeholder="${esc(t("sxPartPh"))}" autocomplete="off"></div></div>`;
    $("sxAddGo").textContent = t("sxNewPart");
  }
  const b = $("sxAddBody");
  b.querySelectorAll("[data-step]").forEach(x => x.onclick = () => { const i = $("asNo"); i.value = Math.max(1, (parseInt(i.value, 10) || 0) + +x.dataset.step); });
  b.querySelectorAll("[data-pid]").forEach(x => x.onclick = () => { syncAdd(); AS.pid = x.dataset.pid; if (!AS.noFromFile) AS.chNo = nextNo(tr.parts.find(p => p.id === AS.pid).chapters); paintAdd(); });
  if ($("asNewPart")) $("asNewPart").onclick = () => { syncAdd(); AS.back = true; AS.tab = "pt"; paintAdd(); };
  if ($("asPick")) $("asPick").onclick = pickAddFile;
}
function pickAddFile() {
  const inp = $("sxFileIn"); inp.value = "";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    syncAdd();
    try {
      const text = await f.text(), parsed = parseChapter(text);
      AS.file = { name: f.name, text, parsed };
      const n = numbersFromFilename(f.name), tr = trainingOf();
      if (n.part) { const p = tr.parts.find(x => +x.no === n.part); if (p) AS.pid = p.id; }
      if (n.chapter) { AS.chNo = n.chapter; AS.noFromFile = true; }
      if (parsed.title && (!AS.chTitle || AS.titleAuto)) { AS.chTitle = parsed.title; AS.titleAuto = true; }
      paintAdd();
    } catch (e) { $("sxAddErr").textContent = t("sxBadFile"); $("sxAddErr").className = "ferr show"; }
  };
  inp.click();
}
async function submitAdd() {
  syncAdd();
  const tr = trainingOf(), err = m => { $("sxAddErr").textContent = m; $("sxAddErr").className = "ferr show"; };
  if (AS.tab === "pt") {
    if (!AS.ptNo) return err(t("sxNeedNo")); if (!AS.ptTitle) return err(t("sxNeedTitle"));
    const pt = { id: uid(), no: +AS.ptNo, title: AS.ptTitle, created: Date.now(), chapters: [] };
    tr.parts.push(pt); saveMeta(); C.toast(t("sxCreated", `PART ${pt.no}`));
    if (AS.back) { AS.back = false; AS.tab = "ch"; AS.pid = pt.id; if (!AS.noFromFile) AS.chNo = 1; AS.ptTitle = ""; AS.ptNo = nextNo(tr.parts); paintAdd(); renderSx(); return; }
    $("sxAdd").classList.remove("show"); renderSx(); return;
  }
  const p = tr.parts.find(x => x.id === AS.pid);
  if (!AS.file) return err(t("sxNeedFile")); if (!p) return err(t("sxNeedPart")); if (!AS.chNo) return err(t("sxNeedNo")); if (!AS.chTitle) return err(t("sxNeedTitle"));
  const id = uid(); $("sxAddGo").disabled = true;
  try { await putFile(id, AS.file.text); } catch (e) { $("sxAddGo").disabled = false; return err(t("sxSaveFailed")); }
  $("sxAddGo").disabled = false;
  cache.set(id, AS.file.parsed);
  p.chapters.push({ id, no: +AS.chNo, title: AS.chTitle, file: AS.file.name, size: AS.file.text.length, created: Date.now() }); saveMeta();
  $("sxAdd").classList.remove("show"); renderSx(); C.toast(t("sxCreated", `CH ${AS.chNo}`));
}
function renameTraining() {
  const tr = trainingOf();
  openForm({
    title: t("sxEditTraining"), submit: t("save"), fields: [{ name: "title", label: t("sxTrainingName"), type: "text", value: tr.title }],
    onSubmit: v => { if (!v.title) return t("sxNeedTitle"); tr.title = v.title; saveMeta(); renderSx(); },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelTraining", tr.title))) return false;
      tr.parts.forEach(pt => pt.chapters.forEach(dropChapter)); meta.trainings = meta.trainings.filter(x => x !== tr); saveMeta();
      nav = { t: null, p: null, c: null, it: null }; Rt.go("/sx", { replace: true }); C.toast(t("deleted"));
    },
  });
}
function editPart(p) {
  const tr = trainingOf();
  openForm({
    title: t("sxEditPart"), submit: t("save"),
    fields: [{ name: "no", label: t("sxPartNo"), type: "number", value: p.no }, { name: "title", label: t("sxPartTitle"), type: "text", value: p.title }],
    onSubmit: v => { if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle"); p.no = +v.no; p.title = v.title; saveMeta(); renderSx(); },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelPart", p.no, p.chapters.length))) return false;
      p.chapters.forEach(dropChapter); tr.parts = tr.parts.filter(x => x !== p); saveMeta(); renderSx(); C.toast(t("deleted"));
    },
  });
}
function editChapter(tr, p, ch) {
  openForm({
    title: t("sxEditChapter"), submit: t("save"),
    fields: [{ name: "file", label: t("sxReplaceFile"), type: "file", current: ch.file }, { name: "no", label: t("sxChapterNo"), type: "number", value: ch.no }, { name: "title", label: t("sxChapterTitle"), type: "text", value: ch.title }],
    onSubmit: async v => {
      if (!v.no) return t("sxNeedNo"); if (!v.title) return t("sxNeedTitle");
      if (v.file) { try { await putFile(ch.id, v.file.text); } catch (e) { return t("sxSaveFailed"); } cache.set(ch.id, v.file.parsed); ch.file = v.file.name; ch.size = v.file.text.length; }
      ch.no = +v.no; ch.title = v.title; saveMeta(); renderSx();
    },
    onDelete: async () => {
      if (!await C.ask(t("sxConfirmDelChapter", ch.no, ch.title))) return false;
      dropChapter(ch); p.chapters = p.chapters.filter(x => x !== ch); saveMeta(); Rt.go("/sx/" + nav.t, { replace: true }); C.toast(t("deleted"));
    },
  });
}
function dropChapter(ch) {
  delFile(ch.id); cache.delete(ch.id);
  const pre = ch.id + "|";
  Object.keys(best).forEach(k => { if (k.startsWith(pre)) delete best[k]; }); Object.keys(sess).forEach(k => { if (k.startsWith(pre)) delete sess[k]; });
  Object.keys(doneAt).forEach(k => { if (k.startsWith(pre)) delete doneAt[k]; });
  ls.set(K.best, best); ls.set(K.sess, sess); ls.set(K.done, doneAt);
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
let T = {};            // qi → typing state {slots, vals, ok (locked green), bad (red), done}
let keep = {};         // qi → Set of filled word indices (speaking; retries never un-fill)
let filled = new Set(), liveSt = null, hintLv = 0, autoT = null, silenceT = null, resultShown = false;
const qOf = () => S.qs[S.order[S.pos]], qiOf = () => S.order[S.pos];
const refCache = new Map(); const refOf = q => refCache.get(q.en) || (refCache.set(q.en, tokenize(q.en)), refCache.get(q.en));
const rec = createRecognizer({
  bias: () => S && new Set(refOf(qOf()).toks.map(x => x.t)),
  onUpdate: live,
  onEnd: ({ text, parts, interim, dropped }) => {
    clearTimeout(silenceT); paintMic(); if (dropped || !S) return;
    if (typeMode && !qOf().noAnswer) { const h = $("stHeard"); if (h) h.innerHTML = ""; return; }   // mic off = no check
    if (!text && S.res[qiOf()]) { paintAnswer(); return; }        // 유지: mic turned off after the question was scored
    evaluate(text, parts, interim);
  },
  onError: code => { $("stErr").textContent = code === "not-allowed" || code === "service-not-allowed" ? t("errMic") : code === "network" ? t("errNetwork") : code === "unsupported" ? t("errUnsupported") : t("errOther", code); $("stErr").className = "err show"; },
  onResume: () => C.toast(t("resumed")),
});
const SEC = { s1: "STEP 1", var: null, s2: "STEP 2", story: "STORY" };
const secLabel = q => q.sec === "s1" ? `STEP 1 · ${q.n}/${q.of}` : q.sec === "var" ? (q.type || t("sxSecVarShort")) : q.sec === "s2" ? `STEP 2 · ${q.no ?? q.n}` : `STORY · ${q.n}/${q.of}`;

// how: "new" (테스트 = fresh run from question 1), "resume" (이어서 = saved run at its last question),
//      "row" (a question tapped on the item page = saved run, at that question). order = retry round of misses.
function startTest(at = 0, how = "new", order = null) {
  const ch = chapterOf(), it = cache.get(ch.id).items[nav.it], qs = questionsOf(it);
  if (!qs.length) return;
  const key = `${ch.id}|${nav.it}`, saved = !order && how !== "new" ? sess[key] : null;
  S = { t: nav.t, p: nav.p, cid: ch.id, ii: nav.it, item: it, qs, order: order || qs.map((_, i) => i), pos: 0, res: {}, start: Date.now(), round: order ? 2 : 1 };
  if (saved) { Object.entries(saved.res || {}).forEach(([qi, sc]) => { if (qs[qi]) S.res[qi] = { kind: "saved", score: sc }; }); S.start = saved.start || S.start; }
  if (how === "new" && !order) { delete sess[key]; ls.set(K.sess, sess); }
  S.pos = Math.max(0, Math.min(S.order.length - 1, order ? 0 : how === "resume" && saved ? saved.pos : at));
  W = {}; T = {}; keep = {}; resultShown = false; S.sweep = false;
  $("stTitle").textContent = it.kind === "unit" ? `${it.no} · ${it.focus}` : itemTitle(it);
  $("stResult").classList.remove("show");
  const show = () => { C.showView("st"); paintMode(); renderQ(0); };
  typeMode ? show() : transition(show);   // typing: render inside the tap so focusing the first blank opens the keyboard (iOS)
}
function saveSess() {
  if (!S || S.round !== 1) return;
  const res = {}; Object.entries(S.res).forEach(([qi, r]) => res[qi] = r.score);
  sess[`${S.cid}|${S.ii}`] = { pos: S.pos, res, start: S.start }; ls.set(K.sess, sess);
}
function stopTest() { if (rec.listening) rec.stop(true); clearTimeout(autoT); clearTimeout(silenceT); hush(); }
function quitTest() { Rt.back(pathOf()); }

function paintMode() {
  $("stView").classList.toggle("wordmode", wordMode); $("stView").classList.toggle("typemode", typeMode);
  $("stInMode").querySelectorAll("[data-im]").forEach(b => { const on = b.dataset.im === inMode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  $("stAutoBtn").classList.toggle("on", autoNext);
}
const scoreCls = r => !r ? "" : r.score == null ? "f" : r.score === 100 ? "g" : "m";   // all right / tried (no score levels)
function paintProg() {
  $("stCount").textContent = `${S.pos + 1}/${S.order.length}`;
  $("stProg").innerHTML = S.order.map((qi, k) => { const r = S.res[qi];
    return `<i class="${scoreCls(r)}${k === S.pos ? " cur" : ""}"></i>`; }).join("");
}

function renderQ(dir) {
  drEnd(); clearTimeout(autoT); hintLv = 0; liveSt = null; $("stErr").className = "err";
  const q = qOf(), qi = qiOf(), r = S.res[qi];
  filled = new Set(keep[qi] || []);
  saveSess();
  const prev = S.pos > 0 ? S.qs[S.order[S.pos - 1]] : null;
  const intro = dir > 0 && !S.sweep && prev && prev.sec !== q.sec ? `<div class="secintro">🎉 ${t("sxSecDone", secName(prev.sec))} <b>${t("sxSecNext", secName(q.sec))}</b></div>` : "";
  const card = `<div class="qcard ${dir > 0 ? "in-r" : dir < 0 ? "in-l" : "in"}">${intro}
      <div class="qtop"><span class="sec ${q.sec}">${esc(secLabel(q))}</span>${q.derived ? `<span class="qnote">${t("sxBuildUp")}</span>` : ""}${q.noAnswer ? `<span class="qnote">${t("sxFreeSpeak")}</span>` : ""}${bsHTML(best[bestKey(S.cid, S.ii, q)])}${q.noAnswer ? "" : `<button class="qplay" id="stSay" title="${esc(t("listen"))}" aria-label="${esc(t("listen"))}"><svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`}</div>
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
  if (rec.listening && typeMode) live({ finalText: "", interim: "", parts: [] });   // mic still on: listening on the new question
  // ready to type in the first blank — but not on the test's first screen (dir 0) and not while the mic is on (v3.20.1)
  if (typeMode && dir && !rec.listening && !q.noAnswer && !tstate(qi).done) focusSlot(firstOpen(tstate(qi)));
}
const secName = sec => sec === "s1" ? `STEP 1 · ${t("sxSecSteps")}` : sec === "var" ? t("sxSecVarShort") : sec === "s2" ? "STEP 2" : "STORY";
function paintResultPill(r) {
  const el = $("stResPill");
  if (!r) { el.className = "result"; return; }
  if (r.score == null) { el.innerHTML = `<span>🗣 ${t("sxFreeDone")}</span>`; el.className = "result show free"; return; }
  // no numbers — just a friendly word; red marks show what to look at
  const msg = r.score === 100 ? "Perfect! 🎉" : typeMode ? t("sxTypeRed") : blockMode ? t("sxBlockRed") : t("sxSpeakRed");
  el.innerHTML = `<span>${msg}</span>`;
  el.className = "result show " + (r.score === 100 ? "good" : "mid");
}

/* ---- answer area: speaking (masked word slots) or word blocks ---- */
function paintAnswer() {
  const q = qOf(), qi = qiOf(), el = $("stAns"); if (!el) return;
  if (typeMode && !q.noAnswer) { paintType(); return; }
  if (blockMode) { paintBlocks(); return; }
  if (typeMode) { $("stCheck").disabled = false; $("stCheck").classList.add("next"); }   // free speaking: → moves on
  if (q.noAnswer) {
    const r = S.res[qi];
    el.innerHTML = `<div class="freebox">${t("sxNoAnsHelp")}</div><div class="heard" id="stHeard">${r && r.said ? `<span class="label">${t("youSaid")}</span>${esc(r.said)}` : `<span class="ph">${speechEngine() ? t("sxSayIt") : t("errUnsupported")}</span>`}</div>`;
    return;
  }
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
let cur = { finalText: "", interim: "", parts: [] };
function live({ finalText, interim, parts }) {
  cur = { finalText, interim, parts };
  if (!S || blockMode) return;
  const q = qOf(), qi = qiOf(), full = (finalText + " " + interim).trim();
  if (typeMode && !q.noAnswer) { liveType(full, parts, interim, finalText); return; }
  if (full && S.res[qi] && S.res[qi].kind === "speak") { delete S.res[qi]; paintResultPill(null); }
  if (q.noAnswer) {
    if (full && S.res[qi]) { delete S.res[qi]; paintResultPill(null); paintAnswer(); }
    const h = $("stHeard");
    if (h) h.innerHTML = full ? `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interim)}</span>` : `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`;
    $("stDone").disabled = !full;
    clearTimeout(silenceT); if (full) silenceT = setTimeout(capDone, 30000);
    return;
  }
  const ref = refOf(q);
  if (full) fillWords(ref, [full, ...parts, interim]).forEach(k => filled.add(k));
  liveSt = ref.words.map((_, k) => filled.has(k) ? "live" : "");
  paintAnswer();
  const h = $("stHeard");
  if (h) h.innerHTML = full ? `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interim)}</span>` : `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`;
  $("stDone").disabled = !full;
  clearTimeout(silenceT); if (full) silenceT = setTimeout(capDone, 30000);
  if (full && filled.size === ref.words.length) capDone();   // every blank filled → score now
}
// The answer for this question is complete (all blanks, ✅ 완료, or 30 s of silence).
// Normal: stop the mic (onEnd scores). 유지: score now and keep the same session open for the next try / question.
function capDone() {
  if (!rec.listening) return;
  if (!stayOn()) { rec.stop(); return; }
  clearTimeout(silenceT);
  const { finalText, interim, parts } = cur, text = (finalText + " " + interim).trim();
  if (!text) return;
  rec.reset(); cur = { finalText: "", interim: "", parts: [] };
  evaluate(text, parts, interim);
  filled = new Set(keep[qiOf()] || []);
  $("stDone").disabled = true;
}
function evaluate(said, parts, interim) {
  const q = qOf(), qi = qiOf(); liveSt = null;
  if (!said) { paintAnswer(); const h = $("stHeard"); if (h) h.innerHTML = `<span class="ph">${t("nothingHeard")}</span>`; return; }
  if (q.noAnswer) { record(q, qi, { kind: "free", score: null, said }); paintAnswer(); return; }
  const r = scoreAttempt(q.en, said, [...parts, interim], [...filled]);
  keep[qi] = new Set(r.st.map((s, k) => s === "ok" ? k : -1).filter(k => k >= 0));
  record(q, qi, { kind: "speak", score: r.score, st: r.st, said: r.said,
    heardHTML: `<span class="label">${t("youSaid")}</span>` + r.heard.map(h => `<span class="h ${h.st}">${esc(h.w)}</span>`).join(" ") });
  hintLv = 0; updateHint(); paintAnswer();
}
function record(q, qi, res) {
  S.res[qi] = res;
  if (res.score == null) { paintResultPill(res); paintProg(); saveSess(); haptic(15); return; }   // free speaking: nothing to score
  const k = bestKey(S.cid, S.ii, q); if (best[k] == null || res.score > best[k]) { best[k] = res.score; ls.set(K.best, best); }
  noteActivity();
  paintResultPill(res); paintProg();
  if (res.score === 100) { chime(); haptic(20); } else if (res.kind === "word" || res.kind === "type") { thud(); haptic([10, 40, 10]); }
  const top = $("stStage").querySelector(".qtop .bs"); if (top) top.outerHTML = bsHTML(best[k]);
  saveSess();
  clearTimeout(autoT);
  if (res.score === 100 && rec.listening && stayOn()) {
    if (!pendingOthers()) rec.stop(true);                         // nothing left to answer: mic off
    else if (autoNext) rec.gate(true);                            // ignore speech until the next question is up
  }
  if (autoNext && res.score === 100) autoT = setTimeout(() => { if (S && qiOf() === qi) nextQ(); else rec.gate(false); }, 1300);
}

// v3.23: remember the last unit practised (Sentences home → 이어서 하기), answers per day (streak) and completion dates
function noteActivity() {
  const now = Date.now(), day = ymd(now), key = `${S.cid}|${S.ii}`;
  act.days[day] = (act.days[day] || 0) + 1;
  const ds = Object.keys(act.days).sort(); if (ds.length > 400) ds.slice(0, ds.length - 400).forEach(d => delete act.days[d]);
  act.last = { t: S.t, p: S.p, c: S.cid, ii: S.ii, at: now };
  ls.set(K.act, act);
  const st = itemStats(S.cid, S.ii, S.item);
  if (st.total && st.done >= st.total && !doneAt[key]) { doneAt[key] = now; ls.set(K.done, doneAt); }
}

/* ---- word blocks ---- */
function wstate(qi) {
  if (!W[qi]) { const b = makeBlocks(S.qs[qi].en); W[qi] = { ...b, placed: [], checked: false, result: null, glow: -1 }; }
  return W[qi];
}
function paintBlocks() {
  const q = qOf(), qi = qiOf(), el = $("stAns");
  if (q.noAnswer) { el.innerHTML = `<div class="freebox">${t("sxNoAnsWord")}</div>`; $("stCheck").disabled = true; $("stCheck").classList.remove("next"); return; }
  const s = wstate(qi);
  const used = new Set(s.placed), res = s.checked ? s.result : null;
  const trayBlocks = s.placed.map((p, i) => {
    const b = s.blocks[p], ok = res ? res.ok[i] : null, want = res && !ok ? s.words[i] : "";
    return `<button class="blk ${res ? (ok ? "ok" : "bad") : "in"}" data-tray="${i}">${esc(b.text)}${want ? `<span class="want">${esc(want.replace(/[.,!?;:]+$/, ""))}</span>` : ""}</button>`;
  }).join("");
  el.innerHTML = `<div class="tray ${res ? "checked" : ""} ${s.placed.length ? "" : "empty"}" id="stTray">${trayBlocks || `<span class="ph">${t("sxTapBlocks")}</span>`}</div>
    <div class="pool" id="stPool">${s.blocks.map((b, i) => `<button class="blk ${used.has(i) ? "used" : ""} ${s.glow === i ? "glow" : ""}" data-pool="${i}" ${used.has(i) || res ? "disabled" : ""}>${esc(b.text)}</button>`).join("")}</div>
    ${res ? answerLine(q) : ""}`;
  $("stCheck").disabled = !(s.placed.length === s.blocks.length && !s.checked);
  $("stCheck").classList.toggle("next", !!s.checked);
}
// at: position in the tray (default: the end). Placing the last block checks by itself.
function placeBlock(i, at = null) {
  unlockAudio(); const s = wstate(qiOf()); if (s.checked || s.placed.includes(i)) return;
  const k = at == null ? s.placed.length : at;
  s.placed.splice(k, 0, i); s.glow = -1; tick(); haptic(8);
  paintBlocks(); const b = $("stTray") && $("stTray").children[k]; if (b) b.classList.add("landed");
  if (s.placed.length === s.blocks.length) { const qi = qiOf(); setTimeout(() => { if (S && qiOf() === qi) checkWord(); }, 260); }
}
function unplace(k) { const s = wstate(qiOf()); if (s.checked) return; s.placed.splice(k, 1); tick(); paintBlocks(); }
/* ---- hold a block (150 ms) and drag it, like Word Story's block test: into the tray at any position,
 * reorder inside the tray, or drop a placed block outside the tray to send it back. Moving > 8 px before
 * the hold = a scroll (or a swipe). A ghost follows the finger; a blue bar marks where it will land. ---- */
let dr = null, drDone = 0;
const inside = (el, x, y) => { if (!el) return false; const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
function drDown(e) {
  if (!S || !blockMode || (e.pointerType === "mouse" && e.button !== 0)) return;
  const b = e.target.closest(".blk[data-pool],.blk[data-tray]"); if (!b || b.disabled || b.classList.contains("used")) return;
  if (wstate(qiOf()).checked) return;
  drEnd();
  const fromTray = b.dataset.tray != null;
  dr = { b, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, fromTray, idx: +(fromTray ? b.dataset.tray : b.dataset.pool), tgt: undefined, tm: setTimeout(drStart, 150) };
}
function drStart() {
  const d = dr; if (!d || !S) return;
  d.on = true; haptic(30);
  try { d.b.setPointerCapture(d.id); } catch (e) {}
  const r = d.b.getBoundingClientRect(); d.dx = d.x0 - r.left; d.dy = d.y0 - r.top;
  const g = d.b.cloneNode(true); g.className = "blk ghost"; g.removeAttribute("data-pool"); g.removeAttribute("data-tray"); g.style.width = r.width + "px";
  document.body.appendChild(g); d.g = g; d.b.classList.add("dsrc");
  drMove();
}
// index among the other placed blocks where the dragged block would go, or null when not over the tray
function drTarget() {
  const d = dr, tray = $("stTray"); if (!inside(tray, d.x, d.y)) return null;
  const list = [...tray.querySelectorAll("[data-tray]")].filter(b => b !== d.b);
  for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (d.y < r.top || (d.y <= r.bottom && d.x < r.left + r.width / 2)) return i; }
  return list.length;
}
function drMove() {
  const d = dr; if (!d || !d.g) return;
  d.g.style.left = (d.x - d.dx) + "px"; d.g.style.top = (d.y - d.dy) + "px";
  const t = drTarget(); if (t === d.tgt) return; d.tgt = t;
  const tray = $("stTray"); tray.querySelectorAll(".gapm").forEach(x => x.remove()); tray.classList.toggle("dropin", t != null);
  if (t == null) return;
  const m = document.createElement("span"); m.className = "gapm";
  const list = [...tray.querySelectorAll("[data-tray]")].filter(b => b !== d.b);
  if (t < list.length) tray.insertBefore(m, list[t]); else tray.appendChild(m);
}
function drDrop() {
  const d = dr, t = drTarget(), s = wstate(qiOf()); drDone = Date.now();
  drEnd();
  if (t != null) {
    if (d.fromTray) { const w = s.placed.splice(d.idx, 1)[0]; s.placed.splice(t, 0, w); tick(); haptic(20); paintBlocks(); const b = $("stTray").children[t]; if (b) b.classList.add("landed"); }
    else placeBlock(d.idx, t);
  } else if (d.fromTray) { s.placed.splice(d.idx, 1); tick(); haptic(20); paintBlocks(); }   // dropped outside the tray: back to the pool
}
function drEnd() {
  const d = dr; if (!d) return; dr = null;
  clearTimeout(d.tm); if (d.g) d.g.remove(); if (d.b) d.b.classList.remove("dsrc");
  const tray = $("stTray"); if (tray) { tray.querySelectorAll(".gapm").forEach(x => x.remove()); tray.classList.remove("dropin"); }
}
function checkWord() {
  const q = qOf(), qi = qiOf(), s = wstate(qi); if (s.checked || s.placed.length !== s.blocks.length) return;
  s.result = checkBlocks(s.answerKeys, s.placed.map(p => s.blocks[p].key)); s.checked = true;
  record(q, qi, { kind: "word", score: s.result.score });
  paintBlocks();
}
function resetWord() {
  drEnd(); const qi = qiOf(); delete W[qi];
  if (S.res[qi] && S.res[qi].kind === "word") { delete S.res[qi]; paintResultPill(null); paintProg(); }
  paintBlocks();
}
function wordHint() {
  if (qOf().noAnswer) return;
  const s = wstate(qiOf()); if (s.checked) return;
  const h = nextBlockHint(s.answerKeys, s.placed.map(p => s.blocks[p].key));
  if (h.wrongAt >= 0) { const b = $("stTray").children[h.wrongAt]; if (b) { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); } C.toast(t("sxHintWrongAt", h.wrongAt + 1)); return; }
  if (!h.key) return;
  s.glow = s.blocks.findIndex((b, i) => b.key === h.key && !s.placed.includes(i)); paintBlocks();
}

/* ---- 타자 입력: type each word into its blank ----
 * Enter / Tab / space → next blank; when every blank is filled it checks by itself: right words turn green
 * and lock, wrong ones turn red. Putting the cursor in a blank clears it (type it fresh) and lifts its red mark;
 * the other words stay as they were, so you carry on from there. No score — just green / red. */
function tstate(qi) {
  if (!T[qi]) T[qi] = { slots: typeSlots(S.qs[qi].en), vals: [], ok: [], bad: [], done: false };
  return T[qi];
}
const tph = w => hintLv === 2 ? w : hintLv === 1 ? w.slice(0, 1) : "";
const twidth = (w, v) => Math.max(w.length, (v || "").length, 2) + 1.2;
// first blank still to do: empty or red (‑1 = none)
const firstOpen = s => s.slots.findIndex((_, k) => !s.ok[k] && (!s.vals[k] || s.bad[k]));
const allFilled = s => s.slots.every((_, k) => s.ok[k] || (s.vals[k] || "").trim());
let tKeep = false;   // next focus keeps the blank's text (Backspace walking back into it)
function paintType() {
  const q = qOf(), qi = qiOf(), el = $("stAns"), btn = $("stCheck");
  if (q.noAnswer) { el.innerHTML = `<div class="freebox">${t("sxNoAnsType")}</div>`; btn.disabled = true; btn.classList.remove("next"); return; }
  const s = tstate(qi);
  el.innerHTML = `<div class="en typed" id="stTyped">${s.slots.map((sl, k) => `<span class="tw">${esc(sl.lead)}<input class="tin ${s.ok[k] ? "ok" : s.bad[k] ? "bad" : ""}" data-t="${k}" value="${esc(s.vals[k] || "")}"${s.ok[k] ? ` readonly tabindex="-1"` : ""} placeholder="${esc(tph(sl.word))}" style="width:${twidth(sl.word, s.vals[k])}ch" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="${k + 1}">${esc(sl.tail)}</span>`).join("")}</div>
    <div class="heard tyheard" id="stHeard"></div>
    ${s.done ? answerLine(q) : ""}`;
  btn.disabled = false; btn.classList.toggle("next", s.done);
}
function focusSlot(k) { const el = k >= 0 && $("stStage").querySelector(`.tin[data-t="${k}"]`); if (el) el.focus(); }
// Enter / Tab / space in blank k: go to the next blank still to do, or check when all are filled
function tAdvance(k, dir = 1) {
  const s = tstate(qiOf()), n = s.slots.length;
  if (dir < 0) { for (let d = 1; d < n; d++) { const p = (k - d + n) % n; if (!s.ok[p]) { focusSlot(p); return; } } return; }
  for (let d = 1; d < n; d++) { const p = (k + d) % n; if (!s.ok[p] && (!s.vals[p] || s.bad[p])) { focusSlot(p); return; } }
  if (allFilled(s)) checkType();
}
function checkType() {
  const q = qOf(), qi = qiOf(), s = tstate(qi); if (q.noAnswer || !allFilled(s)) return;
  const r = checkTyped(s.slots.map(x => x.word), s.vals);
  r.ok.forEach((o, k) => { s.ok[k] = s.ok[k] || o; s.bad[k] = !o; });
  s.done = r.ok.every(Boolean);
  const a = document.activeElement; if (a && a.classList && a.classList.contains("tin")) a.blur();
  paintType();
  record(q, qi, { kind: "type", score: r.score });
}
function typeHint() {
  if (qOf().noAnswer) return;
  hintLv = (hintLv + 1) % 3; updateHint();
  const s = tstate(qiOf());
  $("stStage").querySelectorAll(".tin").forEach(el => { el.placeholder = tph(s.slots[+el.dataset.t].word); });
}
// Speech in typing mode: every word heard right fills its blank (green, locked). Typed blanks stay as they are.
function liveType(full, parts, interim, finalText) {
  const q = qOf(), qi = qiOf(), s = tstate(qi), h = $("stHeard");
  if (h) h.innerHTML = full ? `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interim)}</span>` : `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`;
  if (!full || s.done) return;
  const got = [...fillWords(refOf(q), [full, ...parts, interim])].filter(k => k < s.slots.length && !s.ok[k]);
  if (!got.length) return;
  const a = document.activeElement, fk = a && a.classList && a.classList.contains("tin") ? +a.dataset.t : -1;
  got.forEach(k => { s.ok[k] = true; s.bad[k] = false; s.vals[k] = s.slots[k].word; });
  tick(); haptic(8);
  const heard = h ? h.innerHTML : "";
  paintType(); if ($("stHeard")) $("stHeard").innerHTML = heard;
  $("stStage").querySelectorAll(".tin.ok").forEach(el => { if (got.includes(+el.dataset.t)) el.classList.add("heardok"); });
  if (s.ok.length === s.slots.length && s.slots.every((_, k) => s.ok[k])) { checkType(); return; }
  if (allFilled(s)) { checkType(); return; }
  if (fk >= 0) { if (!s.ok[fk]) { tKeep = true; focusSlot(fk); tKeep = false; } else focusSlot(firstOpen(s)); }   // keep typing where you were
}
function resetType() {
  const qi = qiOf(); delete T[qi];
  if (S.res[qi] && S.res[qi].kind === "type") { delete S.res[qi]; paintResultPill(null); paintProg(); }
  paintType(); if (!rec.listening) focusSlot(0);
}
function typeEvents(stage) {
  const slotOf = e => e.target.classList && e.target.classList.contains("tin") && S && typeMode ? +e.target.dataset.t : -1;
  stage.addEventListener("focusin", e => {
    const k = slotOf(e); if (k < 0) return;
    const s = tstate(qiOf()); if (s.ok[k]) return;
    s.bad[k] = false; e.target.classList.remove("bad");
    if (tKeep) { tKeep = false; const n = e.target.value.length; e.target.setSelectionRange(n, n); return; }   // Backspace came back here: keep the text, delete from the end
    s.vals[k] = ""; e.target.value = "";   // touch a blank = type it fresh
    e.target.style.width = twidth(s.slots[k].word, "") + "ch";
  });
  stage.addEventListener("input", e => {
    const k = slotOf(e); if (k < 0) return;
    const s = tstate(qiOf()); if (s.ok[k]) return;
    let v = e.target.value;
    if (/\s/.test(v)) {   // a space (mobile keyboards) = next blank
      v = v.trim().split(/\s+/)[0] || ""; e.target.value = v; s.vals[k] = v;
      if (v) { tAdvance(k); return; }
    }
    s.vals[k] = v; e.target.style.width = twidth(s.slots[k].word, v) + "ch";
    // every blank filled → check right away (once this word is as long as the answer, or already right)
    const want = typedKey(s.slots[k].word), got = typedKey(v);
    if (allFilled(s) && (got === want || got.length >= want.length)) checkType();
  });
  stage.addEventListener("keydown", e => {
    const k = slotOf(e); if (k < 0) return;
    if (e.key === "Enter" || e.key === "Tab" || e.key === " ") {
      if (e.isComposing) return;
      e.preventDefault(); unlockAudio();
      tAdvance(k, e.key === "Tab" && e.shiftKey ? -1 : 1);
    } else if (e.key === "Backspace" && !e.target.value && !e.isComposing) {   // empty blank: keep deleting in the previous one
      e.preventDefault();
      const s = tstate(qiOf());
      for (let p = k - 1; p >= 0; p--) if (!s.ok[p]) { tKeep = true; focusSlot(p); tKeep = false; return; }
    } else if (e.key === "Escape") e.target.blur();
  });
}

/* ---- controls ---- */
function paintMic() {
  const m = $("stMic"), on = rec.listening;
  m.classList.toggle("rec", on); m.disabled = !speechEngine();
  const mt = $("stMicT"); mt.classList.toggle("rec", on); mt.disabled = !speechEngine();
  mt.title = on ? t("sxMicOff") : t("sxMicOn"); mt.setAttribute("aria-label", mt.title);
  m.title = on ? (keepOn ? t("micKeep") : t("micTalk")) : t("micIdle"); m.setAttribute("aria-label", m.title);
  $("stKeep").classList.toggle("on", keepOn); $("stKeep").setAttribute("aria-pressed", keepOn);
  $("stDone").disabled = true;
}
function updateHint() {
  const b = $("stHint");
  if (wordMode) {   // floating round 💡 (typing cycles 💡 → 🔤 first letter → 👀 answer)
    const lv = typeMode ? hintLv : 0, w = $("stHintW");
    w.textContent = ["💡", "🔤", "👀"][lv]; w.title = t("hint" + lv); w.setAttribute("aria-label", w.title); w.classList.toggle("on", lv > 0); return;
  }
  b.textContent = t("hint" + hintLv); b.classList.toggle("on", hintLv > 0);
}
// Leaving a question: normal mode drops the mic; 유지 keeps the session and starts a fresh capture.
function leaveQ() {
  clearTimeout(silenceT);
  if (!rec.listening) return;
  if (stayOn() && !blockMode) { rec.reset(); rec.gate(false); cur = { finalText: "", interim: "", parts: [] }; }
  else rec.stop(true);
}
// Questions still to answer (free-speaking ones without an answer are optional).
const pendAt = k => { const qi = S.order[k]; return !S.res[qi] && !S.qs[qi].noAnswer; };
const pendingOthers = () => S.order.some((_, k) => k !== S.pos && pendAt(k));
// › : in order until the last question, then round the skipped ones (S.sweep) until none is left → 🏆
function nextQ() {
  const st = nextStop(S.order.length, S.pos, S.order.map((_, k) => pendAt(k)), S.sweep);
  if (st.stay) { C.toast(t("sxOnlyThis")); return; }
  leaveQ();
  if (st.done) { showResult(); return; }
  if (st.entered) C.toast(t("sxGoSkipped", S.order.filter((_, k) => pendAt(k)).length));
  S.sweep = st.sweep; S.pos = st.to; renderQ(1);
}
function prevQ() { leaveQ(); if (S.pos > 0) { S.pos--; renderQ(-1); } }
function jump(k) { leaveQ(); const d = k - S.pos; S.pos = k; renderQ(Math.sign(d)); }

// Every question answered → 🏆 + confetti + fanfare. No scores (owner: the point is to enjoy it and move on).
function showResult() {
  stopTest(true); resultShown = true;
  if (S.round === 1) { delete sess[`${S.cid}|${S.ii}`]; ls.set(K.sess, sess); }   // done → next 테스트 starts fresh
  $("stResBody").innerHTML = `<div class="fin-trophy">🏆</div>
    <h1 class="fin-title">${t("sxUnitDone")}</h1><div class="fin-dlg">${esc($("stTitle").textContent)}</div>
    <p class="fin-msg">${t("sxAllDone")}</p>
    <div class="rbtns"><button class="btn sec" id="stAgain">${t("sxAgain")}</button><button class="btn pri" id="stFinDone">${t("finDone")}</button></div>`;
  $("stResult").classList.add("show"); $("stResult").scrollTop = 0;
  $("stAgain").onclick = () => { $("stResult").classList.remove("show"); stopConfetti($("stConfetti")); startTest(0, "new"); };
  $("stFinDone").onclick = () => { $("stResult").classList.remove("show"); quitTest(); };
  fanfare(); startConfetti($("stConfetti"));
}
function openGrid() {
  $("stGridBody").innerHTML = S.order.map((qi, k) => { const r = S.res[qi], q = S.qs[qi];
    return `<button class="gcell ${scoreCls(r)} ${k === S.pos ? "cur" : ""} ${q.sec}" data-k="${k}">${k + 1}</button>`; }).join("");
  $("stGridBody").querySelectorAll("[data-k]").forEach(b => b.onclick = () => { $("stGrid").classList.remove("show"); jump(+b.dataset.k); });
  $("stGrid").classList.add("show");
}

/* ================= init ================= */
export function initSx(ctx) {
  C = ctx; paintTabs();
  $("modeTabs").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  $("sxBack").onclick = back; $("sxMore").onclick = editCurrent;
  $("sxDialPart").onclick = () => openAdd("pt"); $("sxDialCh").onclick = () => openAdd("ch");
  $("sxView").addEventListener("pointerdown", e => { if ($("sxView").classList.contains("dial") && !e.target.closest("#sxFab,.sxdial")) closeDial(); });
  $("sxAddSeg").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b || b.dataset.tab === AS.tab) return; syncAdd(); AS.tab = b.dataset.tab; if (AS.tab === "ch") AS.back = false; paintAdd(); });
  $("sxAddGo").onclick = submitAdd;
  $("sxAdd").addEventListener("click", e => { if (e.target.id === "sxAdd") $("sxAdd").classList.remove("show"); });
  // item page: one delegated handler (rows of every section, 테스트, 이어서)
  const openRow = e => {
    if (e.target.closest("#sxStart")) { openTest(0, "new"); return true; }
    if (e.target.closest("#sxResume")) { openTest(0, "resume"); return true; }
    const li = e.target.closest("[data-q]"); if (li && level() === "item") { openTest(+li.dataset.q, "row"); return true; }
    return false;
  };
  $("sxBody").addEventListener("click", openRow);
  $("sxBody").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && openRow(e)) e.preventDefault(); });
  $("sxfOverlay").addEventListener("click", e => { if (e.target.id === "sxfOverlay") $("sxfOverlay").classList.remove("show"); });
  $("stQuit").onclick = quitTest;
  $("stCount").onclick = openGrid;
  $("stGrid").addEventListener("click", e => { if (e.target.id === "stGrid" || e.target.id === "stGridClose") $("stGrid").classList.remove("show"); });
  $("stInMode").addEventListener("click", e => {
    const b = e.target.closest("[data-im]"); if (!b || b.dataset.im === inMode) return;
    if (rec.listening) rec.stop(true);
    drEnd(); inMode = b.dataset.im; ls.set(K.input, inMode);
    blockMode = inMode === "block"; typeMode = inMode === "type";
    hintLv = 0; paintMode(); updateHint(); if (!S) return;
    paintAnswer(); paintResultPill(S.res[qiOf()]);
    C.toast(t(typeMode ? "sxTypeOnToast" : blockMode ? "sxWordOnToast" : "sxWordOffToast"));
    if (typeMode) focusSlot(firstOpen(tstate(qiOf())));
  });
  typeEvents($("stStage"));
  $("stMic").onclick = () => {
    unlockAudio(); if (!S) return;
    if (rec.listening) { rec.stop(); return; }
    const qi = qiOf(); clearTimeout(autoT);
    if (S.res[qi] && S.res[qi].kind === "speak") { delete S.res[qi]; paintResultPill(null); }
    filled = new Set(keep[qi] || []); liveSt = null; $("stErr").className = "err"; hush();
    rec.start(); paintMic(); live({ finalText: "", interim: "", parts: [] });
  };
  // typing mode mic: a plain on/off switch — turning it off never checks
  // tapping the mic / ✓ / 💡 / ↺ keeps the text cursor (and the phone keyboard) where it is
  ["stMicT", "stCheck", "stHintW", "stReset"].forEach(id => $(id).addEventListener("mousedown", e => e.preventDefault()));
  $("stMicT").onclick = () => {
    unlockAudio(); if (!S) return;
    if (rec.listening) { rec.stop(); return; }
    $("stErr").className = "err"; hush(); clearTimeout(autoT);
    cur = { finalText: "", interim: "", parts: [] };
    rec.start(); paintMic(); live({ finalText: "", interim: "", parts: [] });
  };
  $("stKeep").onclick = () => { keepOn = !keepOn; ls.set(K.keep, keepOn); paintMic(); if (rec.listening) $("stDone").disabled = !(cur.finalText + cur.interim).trim(); C.toast(keepOn ? t("keepOnToast") : t("keepOffToast")); };
  $("stDone").onclick = () => { unlockAudio(); capDone(); };
  $("stHint").onclick = () => { if (wordMode) { wordHint(); return; } if (qOf().noAnswer) return; hintLv = (hintLv + 1) % 3; updateHint(); paintAnswer(); };
  // 🔊 next to the question: TTS of the answer
  $("stStage").addEventListener("click", e => { if (!S || !e.target.closest("#stSay")) return; if (qOf().noAnswer) return; if (rec.listening) rec.stop(true); say(qOf().en); });
  $("stAutoBtn").onclick = () => { autoNext = !autoNext; ls.set(K.auto, autoNext); paintMode(); };
  $("stReset").onclick = () => { if (qOf().noAnswer) return; typeMode ? resetType() : resetWord(); };
  $("stHintW").onclick = () => typeMode ? typeHint() : wordHint();
  $("stCheck").onclick = () => {
    unlockAudio(); if (qOf().noAnswer) return;
    if (typeMode) { const s = tstate(qiOf()); if (s.done) nextQ(); else { const k = firstOpen(s); k < 0 ? checkType() : focusSlot(k); } return; }
    const s = wstate(qiOf()); if (s.checked) nextQ(); else checkWord();
  };
  ["stPrev", "stPrevW"].forEach(id => $(id).onclick = prevQ);
  ["stNext", "stNextW"].forEach(id => $(id).onclick = () => { unlockAudio(); nextQ(); });
  // horizontal swipe on the question = previous / next
  // word blocks: tap = place / take back (ignored right after a drag); hold = drag (see drDown)
  $("stStage").addEventListener("click", e => {
    if (!S || !blockMode || Date.now() - drDone < 450) return;
    const p = e.target.closest("[data-pool]"), tr = e.target.closest("[data-tray]");
    if (p && !p.disabled) placeBlock(+p.dataset.pool); else if (tr) unplace(+tr.dataset.tray);
  });
  $("stStage").addEventListener("pointerdown", drDown);
  document.addEventListener("pointermove", e => {
    const d = dr; if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.on) { if (Math.hypot(d.x - d.x0, d.y - d.y0) > 8) drEnd(); return; }
    drMove();
  });
  document.addEventListener("pointerup", e => { const d = dr; if (!d || e.pointerId !== d.id) return; if (d.on) drDrop(); else drEnd(); });
  document.addEventListener("pointercancel", e => { if (dr && e.pointerId === dr.id) { if (dr.on) drDone = Date.now(); drEnd(); } });
  document.addEventListener("touchmove", e => { if (dr && dr.on) e.preventDefault(); }, { passive: false });   // no scrolling while dragging
  $("stStage").addEventListener("contextmenu", e => { if (e.target.closest(".blk")) e.preventDefault(); });
  let sx0 = null;
  $("stStage").addEventListener("pointerdown", e => { sx0 = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  $("stStage").addEventListener("pointerup", e => {
    if (!sx0) return;
    if (Date.now() - drDone < 450 || dr) { sx0 = null; return; }   // a block drag is not a swipe
    const dx = e.clientX - sx0.x, dy = e.clientY - sx0.y, dt = Date.now() - sx0.t; sx0 = null;
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
