// Speak Up — UI. Views: library → info → player. Data: localStorage via store.js (synced to the server when signed in).
import { parseMd, toMd, libraryToMd, libraryToJson, parseJsonImport, tokenize, fillWords, dialogStats } from "./core.js";
import { makeBlocks, checkBlocks, nextBlockHint, typeSlots, checkTyped, typedKey, nextStop } from "./sxcore.js";
import { SAMPLE_MD, OLD_SAMPLE, CONVERT_PROMPT, CONVERT_PROMPT_EN } from "./content.js";
import { t, lang, setLang, langChoice, setLangChoice, resolveLang, applyStatic, QUOTES } from "./i18n.js";
import { unlockAudio, chime, thud, tick, haptic, say, hush, fanfare, startConfetti as confettiOn, stopConfetti as confettiOff } from "./fx.js";
import { hub, createRecognizer, speechEngine } from "./speech.js";
import { go, back as goBack, onRoute, dispatch } from "./router.js";
import { initSx, sxApplyLang, renderTrainings, newTraining, refreshSharedSx, sxRoute, sxLeave, mode as sxMode, setTabMode } from "./sx.js";
import { ls as store, account, sharedContent, refreshShared, logout, onSync } from "./store.js";
const VERSION = "3.25.0";
const promptText = () => lang() === "en" ? CONVERT_PROMPT_EN : CONVERT_PROMPT;

/* ================= store (localStorage) ================= */
const K = { lib: "speakup.lib.v3", best: "speakup.best.v3", pos: "speakup.pos.v3", count: "speakup.count.v3", last: "speakup.last.v3", days: "speakup.days.v3", done: "speakup.done.v3" };
let storageOK = true;
try { localStorage.setItem("speakup.probe", "1"); localStorage.removeItem("speakup.probe"); } catch (e) { storageOK = false; }
const ls = {
  get(k, d) { return store.get(k, d); },
  set(k, v) { try { store.set(k, v); } catch (e) { storageOK = false; showStoreWarn(); } },
};
const me = account();                          // null = guest
const isShared = d => !!(d && d.owner);        // someone else's dialogue (read-only)
let sharedLib = (sharedContent().dialogs || []).filter(d => d && d.id && Array.isArray(d.lines));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const newDialog = (d, t = Date.now()) => ({ id: uid(), title: d.title, lines: d.lines, created: t, updated: t });

let lib = ls.get(K.lib, null);                 // [{id,title,lines:[{spk,en,ko}],created,updated}] — array order = list order
if (!Array.isArray(lib)) { lib = parseMd(SAMPLE_MD).map(d => newDialog(d)); ls.set(K.lib, lib); }
else {   // swap the pre-v3.4.0 sample (team meeting) for the new one if it is still unedited
  const i = lib.findIndex(d => d.title === OLD_SAMPLE.title && d.lines.length === OLD_SAMPLE.lines && d.lines[0] && d.lines[0].en === OLD_SAMPLE.firstEn);
  if (i >= 0) { lib[i] = newDialog(parseMd(SAMPLE_MD)[0]); ls.set(K.lib, lib); }
}
let best = ls.get(K.best, {});                 // "dialogId|english sentence" → best score (survives line reordering/edits)
let posMap = ls.get(K.pos, {});                // dialogId → last sentence index
let countMap = ls.get(K.count, {});            // dialogId → total sentences practised (every scored attempt)
let lastMap = ls.get(K.last, {});              // dialogId → timestamp (ms) of the last scored attempt
let dayMap = ls.get(K.days, {});              // "YYYY-MM-DD" → lines answered that day (streak, today) — v3.25
let doneMap = ls.get(K.done, {});             // dialogId → ms when every line had been answered at least once
const pad2 = n => String(n).padStart(2, "0");
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const saveLib = () => ls.set(K.lib, lib);
const bestOf = (d, l) => best[d.id + "|" + l.en];
function relDate(ms) {                         // 오늘 / 어제 / N일 전 (≤6) / M월 D일 / YYYY. M. D.
  const d = new Date(ms), now = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff <= 0) return t("today"); if (diff === 1) return t("yesterday"); if (diff < 7) return t("daysAgo", diff);
  return d.getFullYear() === now.getFullYear() ? t("dateMD", d) : t("dateYMD", d);
}

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SPK_COLORS = ["#1CB0F6", "#CE82FF", "#FF9600", "#FF4B4B", "#2B70C9", "#58CC02", "#E5A000"];
let spkColor = {};
const colorFor = s => (s in spkColor) ? spkColor[s] : (spkColor[s] = SPK_COLORS[Object.keys(spkColor).length % SPK_COLORS.length]);
const mark = v => `<span class="bs ${v === 100 ? "p" : v != null ? "t" : ""}">${v === 100 ? "✓" : v != null ? "•" : ""}</span>`;   // ✓ all right once · • tried (no scores)
const spkChip = s => s ? `<span class="spk" style="background:${colorFor(s)}">${esc(s)}</span>` : "";
let toastT = null;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200); }
function showStoreWarn() { $("storeWarn").classList.toggle("show", !storageOK); }
function ask(text, yes = t("del")) {
  return new Promise(res => {
    $("mText").textContent = text; $("mYes").textContent = yes; $("modal").classList.add("show");
    const done = v => { $("modal").classList.remove("show"); $("mYes").onclick = $("mNo").onclick = null; res(v); };
    $("mYes").onclick = () => done(true); $("mNo").onclick = () => done(false);
  });
}
let view = "lib";
function showView(v) {
  if (view === "play" && v !== "play") leavePlayer();
  if (view === "st" && v !== "st") sxLeave();
  ["setView"].forEach(id => $(id).classList.toggle("on", v === "set")); document.body.classList.toggle("v-set", v === "set");
  view = v;
  ["lib", "info", "play", "sx", "st"].forEach(n => { $(n + "View").classList.toggle("on", n === v); document.body.classList.toggle("v-" + n, n === v); });
}
let dlg = null;   // the dialogue open in info/player

/* ================= LIBRARY ================= */
let editing = false; const selected = new Set();
function renderLib() {
  showStoreWarn();
  const sxOn = document.body.dataset.mode === "sx";
  $("dlist").style.display = $("dlgHome").style.display = sxOn ? "none" : ""; $("sxList").style.display = sxOn ? "" : "none";
  if (sxOn) { if (editing) { editing = false; selected.clear(); } $("libView").classList.remove("editing"); setFab(false); renderTrainings($("sxList")); return; }
  $("libView").classList.toggle("editing", editing);
  $("editModeBtn").textContent = editing ? t("done") : t("edit"); $("editModeBtn").classList.toggle("on", editing);
  renderDlgHome();
  const el = $("dlist");
  const shTop = !editing && sharedLib.length ? `<div class="secdiv"><span>📚 ${t("sharedSec")}</span><i></i></div>`
    + [...sharedLib].sort((a, b) => (b.created || 0) - (a.created || 0)).map(d => {
      const n = d.lines.length, cnt = countMap[d.id] || 0, last = lastMap[d.id];
      return `<div class="dcard shared" data-id="${d.id}"><span class="dno sh">📚</span>
        <div class="dmain"><div class="dt">${esc(d.title)} <span class="shtag in">${t("sharedTag")}</span></div>
          <div class="dm">${t("cardMeta", n, cnt, last ? relDate(last) : "")}</div><div class="dby">${t("sharedBy", d.owner.name || "")}</div></div>
        <span class="chev">›</span></div>`;
    }).join("") + `<div class="secdiv"><span>${t("mySec")}</span><i></i></div>` : "";
  if (!lib.length) {
    el.innerHTML = shTop + `<div class="empty">${t("empty")}<br><button class="btn pri" id="addSample">${t("addSample")}</button></div>`;
    $("addSample").onclick = () => addDialogs(parseMd(SAMPLE_MD));
  } else {
    const sorted = [...lib].sort((a, b) => (b.created || 0) - (a.created || 0));   // newest first, numbered N…1
    el.innerHTML = shTop + sorted.map((d, i) => {
      const n = d.lines.length, cnt = countMap[d.id] || 0, last = lastMap[d.id], sel = selected.has(d.id);
      return `<div class="dcard ${sel ? "sel" : ""}" data-id="${d.id}">
        <span class="chk">${sel ? "✓" : ""}</span>
        <span class="dno">${sorted.length - i}</span>
        <div class="dmain"><div class="dt">${esc(d.title)}${d.shared ? ` <span class="shtag">${t("sharingTag")}</span>` : ""}</div>
          <div class="dm">${t("cardMeta", n, cnt, last ? relDate(last) : "")}</div></div>
        <span class="chev">›</span></div>`;
    }).join("");
  }
  $("delSelBtn").disabled = $("exSelBtn").disabled = !selected.size;
  $("exSelBtn").textContent = selected.size ? t("exportN", selected.size) : t("export");
  $("delSelBtn").textContent = selected.size ? t("delN", selected.size) : t("del");
  $("selAllBtn").textContent = selected.size === lib.length && lib.length ? t("deselectAll") : t("selectAll");
}
$("dlist").addEventListener("click", e => {
  const c = e.target.closest(".dcard"); if (!c) return;
  const id = c.dataset.id;
  if (editing) { if (c.classList.contains("shared")) return; selected.has(id) ? selected.delete(id) : selected.add(id); renderLib(); }
  else go("/dlg/" + id);
});
$("editModeBtn").onclick = () => { editing = !editing; selected.clear(); setFab(false); renderLib(); };
// floating ＋: tap → 새 대화 / 가져오기 pop up above it; outside tap closes
function setFab(open) { $("fab").classList.toggle("open", open); $("fabBtn").setAttribute("aria-expanded", open); }
$("fabBtn").onclick = () => { if (document.body.dataset.mode === "sx") { newTraining(); return; } setFab(!$("fab").classList.contains("open")); };
document.addEventListener("pointerdown", e => { if (!e.target.closest("#fab")) setFab(false); });
$("selAllBtn").onclick = () => { if (selected.size === lib.length) selected.clear(); else lib.forEach(d => selected.add(d.id)); renderLib(); };
$("delSelBtn").onclick = async () => {
  if (!selected.size) return;
  if (!await ask(t("confirmDeleteN", selected.size))) return;
  const n = selected.size;
  lib = lib.filter(d => !selected.has(d.id)); selected.forEach(id => { delete posMap[id]; delete countMap[id]; delete lastMap[id]; }); selected.clear();
  saveLib(); ls.set(K.pos, posMap); ls.set(K.count, countMap); ls.set(K.last, lastMap); editing = false; renderLib(); toast(t("deletedN", n));
};
/* ---- 대화 home (v3.25): 이어서 하기 card + small stats, like 문장만들기 ---- */
const answeredN = d => d.lines.filter(l => best[d.id + "|" + l.en] != null).length;
function streak() {
  let n = 0; const d = new Date();
  if (!dayMap[ymd(d)]) d.setDate(d.getDate() - 1);
  while (dayMap[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderDlgHome() {
  const el = $("dlgHome"); if (editing) { el.innerHTML = ""; return; }
  const all = [...sharedLib, ...lib];
  let L = all.filter(d => lastMap[d.id]).sort((a, b) => lastMap[b.id] - lastMap[a.id])[0], next = false;
  if (L && answeredN(L) >= L.lines.length) {   // finished: suggest the newest one not finished yet
    L = all.filter(d => d !== L && answeredN(d) < d.lines.length).sort((a, b) => (lastMap[b.id] || 0) - (lastMap[a.id] || 0) || (b.created || 0) - (a.created || 0))[0]; next = true;
  }
  const today = dayMap[ymd(Date.now())] || 0, stk = streak(), nDone = all.filter(d => doneMap[d.id]).length;
  const hero = L ? `<div class="hero dlg" id="dHero"><div class="hero-l">${t(next ? "hUpNext" : "hContinue")}</div>
      <div class="hero-t">${t("lineOf", Math.min((posMap[L.id] || 0) + 1, L.lines.length), L.lines.length)}</div>
      <div class="hero-u">${esc(L.title)}</div>
      <div class="hero-f"><div class="hero-bar"><i style="width:${Math.round(answeredN(L) / L.lines.length * 100)}%"></i></div><button class="hero-go" id="dHeroGo">▶ ${t(next ? "hNext" : "hGo")}</button></div></div>` : "";
  const stats = (stk || today || nDone) ? `<div class="hstats">
      <div class="hst"><b>🔥 ${stk}</b><span>${t("hStreak")}</span></div>
      <div class="hst"><b>✏️ ${today}</b><span>${t("hTodayLines")}</span></div>
      <div class="hst"><b>🏆 ${nDone}</b><span>${t("hDlgsDone")}</span></div></div>` : "";
  el.innerHTML = hero + stats;
  if (L) $("dHeroGo").onclick = () => { unlockAudio(); go(`/dlg/${L.id}/play`); };
}
function addDialogs(ds) { const t = Date.now(); ds.forEach((d, i) => lib.push(newDialog(d, t + i))); saveLib(); renderLib(); }

/* ---- prompt popover: opens + copies on click, closes on outside click / blur / Esc ---- */
async function copyPrompt() {
  try { await navigator.clipboard.writeText(promptText()); $("promptState").textContent = t("copied"); toast(t("promptCopiedToast")); }
  catch (e) { $("promptState").textContent = t("copyManually"); const r = document.createRange(); r.selectNodeContents($("promptText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
function setPrompt(open) { $("promptPop").classList.toggle("show", open); $("promptBtn").classList.toggle("on", open); $("promptBtn").setAttribute("aria-expanded", open); }
$("promptBtn").onclick = () => { const open = !$("promptPop").classList.contains("show"); setPrompt(open); if (open) copyPrompt(); };
$("promptCopy").onclick = copyPrompt;
document.addEventListener("pointerdown", e => { if (!e.target.closest(".popwrap")) setPrompt(false); });
window.addEventListener("blur", () => setPrompt(false));

/* ---- editor sheet (add / edit) ---- */
let edMode = "add";
function openEditor(mode) {
  edMode = mode;
  $("edTitle").textContent = mode === "add" ? t("addTitle") : t("editTitle");
  $("edDelete").style.display = mode === "edit" ? "" : "none";
  $("editor").value = mode === "edit" ? toMd(dlg) : "";
  edShared = mode === "edit" && !!dlg.shared; paintEdShare();
  $("edErr").className = "ferr";
  $("edOverlay").classList.add("show");
  setTimeout(() => $("editor").focus(), 50);
}
const closeEditor = () => $("edOverlay").classList.remove("show");
// 공유 switch lives only in the editor (owner: no accidental toggling on the info page); saved with 저장
let edShared = false;
function paintEdShare() {
  const b = $("edShare"); b.style.display = me && edMode === "edit" ? "" : "none";
  b.classList.toggle("on", edShared); $("edShareTx").textContent = edShared ? t("shareOn") : t("shareOff");
}
$("edShare").onclick = () => { edShared = !edShared; paintEdShare(); };
$("addBtn").onclick = () => { setFab(false); openEditor("add"); };
$("infoEdit").onclick = () => openEditor("edit");
$("editDlgBtn").onclick = () => { if (rec.listening) rec.stop(true); openEditor("edit"); };
$("edCancel").onclick = closeEditor;
$("edSave").onclick = () => {
  const ds = parseMd($("editor").value);
  if (!ds.length) { $("edErr").textContent = t("noEnglish"); $("edErr").className = "ferr show"; return; }
  if (edMode === "add") { addDialogs(ds); closeEditor(); toast(ds.length > 1 ? t("addedN", ds.length) : t("addedOne", ds[0].title)); return; }
  const [first, ...rest] = ds;                                   // edit: first replaces this dialogue, extras are inserted after it
  dlg.title = first.title; dlg.lines = first.lines; dlg.updated = Date.now();
  const shChanged = !!dlg.shared !== edShared; if (edShared) dlg.shared = true; else delete dlg.shared;
  if (rest.length) { const at = lib.indexOf(dlg), t = Date.now(); lib.splice(at + 1, 0, ...rest.map((d, i) => newDialog(d, t + i))); }
  saveLib(); closeEditor();
  if (view === "play") openPlayer(Math.min(idx, dlg.lines.length - 1)); else renderInfo();
  toast(shChanged ? (edShared ? t("sharedToast") : t("unsharedToast")) : rest.length ? t("editedPlus", rest.length) : t("edited"));
};
$("edDelete").onclick = async () => {
  if (!await ask(t("confirmDeleteOne", dlg.title))) return;
  lib = lib.filter(d => d !== dlg); delete posMap[dlg.id]; delete countMap[dlg.id]; delete lastMap[dlg.id]; saveLib(); ls.set(K.pos, posMap); ls.set(K.count, countMap); ls.set(K.last, lastMap);
  closeEditor(); go("/dlg", { replace: true }); toast(t("deleted"));
};

/* ---- import (.md / .json, appended) ---- */
$("importBtn").onclick = () => { setFab(false); $("fileIn").click(); };
$("fileIn").onchange = async e => {
  const files = [...e.target.files]; e.target.value = "";
  let added = [], bad = 0;
  for (const f of files) {
    try {
      const text = await f.text();
      const ds = (/\.json$/i.test(f.name) || /^\s*[\[{]/.test(text)) ? parseJsonImport(text) : parseMd(text);
      ds.length ? (added = added.concat(ds)) : bad++;
    } catch (err) { bad++; }
  }
  if (added.length) { addDialogs(added); toast(t("addedN", added.length) + (bad ? t("importFailed", bad) : "")); }
  else toast(t("nothingToImport"));
};

/* ---- export (all dialogues, or the ones selected in edit mode; one .md joined by ---, or .json) ---- */
let exFmt = "md", downloads = null, exList = [];   // downloads: Claude-artifact capability, null elsewhere
const inArtifact = !!(window.claude && typeof window.claude.use === "function");
function fillExport() {
  $("exMd").classList.toggle("on", exFmt === "md"); $("exJson").classList.toggle("on", exFmt === "json");
  $("exText").value = exFmt === "md" ? libraryToMd(exList) : libraryToJson(exList);
  $("exInfo").textContent = t("exportInfo", exList.length === lib.length, exList.length, exList.reduce((a, d) => a + d.lines.length, 0));
  $("exDown").style.display = (!inArtifact || downloads) ? "" : "none";
}
function openExport(list) { exList = list; fillExport(); $("exOverlay").classList.add("show"); }
$("exportBtn").onclick = () => { if (!lib.length) { toast(t("nothingToExport")); return; } openExport(lib); };
$("exSelBtn").onclick = () => { if (selected.size) openExport(lib.filter(d => selected.has(d.id))); };   // keeps list order
$("exMd").onclick = () => { exFmt = "md"; fillExport(); };
$("exJson").onclick = () => { exFmt = "json"; fillExport(); };
$("exClose").onclick = () => $("exOverlay").classList.remove("show");
$("exCopy").onclick = async () => {
  try { await navigator.clipboard.writeText($("exText").value); toast(t("copiedToast")); }
  catch (e) { $("exText").select(); toast(t("selectedCopy")); }
};
$("exDown").onclick = async () => {
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const filename = (exList.length === 1 ? `speak-up-${exList[0].title.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 40)}-${stamp}` : `speak-up-${stamp}`) + `.${exFmt}`, data = $("exText").value;
  if (downloads) { try { await downloads.save({ filename, data }); toast(t("savedFile")); } catch (e) { toast(t("saveCancelled")); } return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: exFmt === "md" ? "text/markdown" : "application/json" })); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ================= INFO ================= */
const findDlg = id => lib.find(d => d.id === id) || sharedLib.find(d => d.id === id);
function openInfo(id) { dlg = findDlg(id); if (!dlg) { go("/dlg", { replace: true }); return; } spkColor = {}; showView("info"); renderInfo(); $("infoView").querySelector(".infoscroll").scrollTop = 0; }
const playAt = at => { posMap[dlg.id] = at; ls.set(K.pos, posMap); go(`/dlg/${dlg.id}/play`); };
function renderInfo() {
  const s = dialogStats(dlg), n = s.sentences, at = Math.min(posMap[dlg.id] || 0, n - 1);
  const ro = isShared(dlg);
  $("infoEdit").style.display = ro ? "none" : "";
  $("infoBody").innerHTML = `
    <div class="ititle">${esc(dlg.title)}</div>
    ${ro ? `<div class="shbar ro">📚 ${t("sharedBy", dlg.owner.name || "")} · ${t("readOnly")}</div>`
      : dlg.shared ? `<div class="shstat">🔗 ${t("sharingNow")}</div>` : ""}
    <div class="stats">
      <div class="stat"><b>${n}</b><span>${t("stSentences")}</span></div>
      <div class="stat"><b>${s.words}</b><span>${t("stWords")}</span></div>
      <div class="stat"><b>${countMap[dlg.id] || 0}</b><span>${t("stPracticed")}</span></div>
    </div>
    <div class="startrow">${at > 0
      ? `<button class="btn sec" id="startTop">${t("fromStart")}</button><button class="btn pri" id="startResume">${t("resumeAt", at + 1)}</button>`
      : `<button class="btn pri" id="startTop">${t("start")}</button>`}</div>
    ${s.speakers.length ? `<div class="spks">${s.speakers.map(spkChip).join("")}</div>` : ""}
    <ul class="tl">${dlg.lines.map((l, i) => { const b = bestOf(dlg, l);
      return `<li><span class="no">${i + 1}</span><div class="tx"><div class="te">${spkChip(l.spk)}${esc(l.en)}</div><div class="tk">${esc(l.ko || "")}</div></div>${mark(b)}</li>`; }).join("")}</ul>`;
  $("startTop").onclick = () => playAt(0);
  if ($("startResume")) $("startResume").onclick = () => playAt(at);
}
function showLibrary() { dlg = null; editing = false; selected.clear(); showView("lib"); renderLib(); }
$("infoBack").onclick = () => goBack("/dlg");

/* ================= PLAYER (v3.25) =================
 * Same scrolling script as before (current line in the middle, neighbours faded, Korean only), but the current
 * line is answered like 문장만들기: ⌨️🎤 = one blank per word, typeable any time, and the mic (an on/off switch that
 * stays on across lines) fills every word it hears; or 🧩 word blocks. All right → chime and straight to the next
 * line. No scores on screen (✓ = all right once, • = tried). › after the last line visits the lines still not
 * answered; when none is left → 🏆. */
const inner = $("inner"), scriptEl = $("script"), micEl = $("mic"), errEl = $("err"), resEl = $("result");
const IN_KEY = "speakup.sxinput.v2";             // shared with 문장만들기: ⌨️🎤 "type" | 🧩 "block"
let inMode = ls.get(IN_KEY, "type") === "block" ? "block" : "type";
let lines = [], idx = 0, hintLv = 0, sweep = false, autoTimer = null, sessionStart = 0;
let res = {};      // idx → {score, kind} (this session)
let T = {};        // idx → typing state {slots, vals, ok, bad, done}
let W = {};        // idx → blocks state {words, answerKeys, blocks, placed, checked, result, glow}
let refCache = {};
const refOf = i => refCache[i] || (refCache[i] = tokenize(lines[i].en));
const typeMode = () => inMode === "type";
const rec = createRecognizer({
  bias: () => new Set(refOf(idx).toks.map(x => x.t)),
  onUpdate: live, onEnd: () => { paintMic(); const h = $("heard"); if (h && typeMode()) h.innerHTML = ""; },
  onError: code => showErr(code === "not-allowed" || code === "service-not-allowed" ? t("errMic") : code === "network" ? t("errNetwork") : code === "unsupported" ? t("errUnsupported") : t("errOther", code)),
  onResume: () => nudge(t("resumed")),
});

function openPlayer(at) {
  sessionStart = Date.now();
  lines = dlg.lines; res = {}; T = {}; W = {}; refCache = {}; hintLv = 0; sweep = false;
  idx = Math.max(0, Math.min(lines.length - 1, at));
  posMap[dlg.id] = idx; ls.set(K.pos, posMap);
  $("ptitle").textContent = dlg.title; $("editDlgBtn").style.display = isShared(dlg) ? "none" : "";
  showView("play"); paintMode(); resEl.className = "result"; errEl.className = "err";
  renderAll(); requestAnimationFrame(() => centerCurrent(false));
}
function leavePlayer() { if (rec.listening) rec.stop(true); clearTimeout(autoTimer); dragEnd(); try { speechSynthesis.cancel(); } catch (e) {} }
$("backBtn").onclick = () => goBack(`/dlg/${dlg.id}`);

function lineHTML(i) {
  const L = lines[i], cur = i === idx, r = res[i];
  const m = cur ? mark(bestOf(dlg, L)) : r ? mark(r.score) : "";
  return `<div class="ln ${cur ? "cur" : ""}${Math.abs(i - idx) === 1 ? " near" : ""}" data-i="${i}">${spkChip(L.spk)}${m}<div class="ko">${esc(L.ko || t("noTranslation"))}</div>${cur ? `<div class="qans" id="curAns"></div>` : ""}</div>`;
}
function rerenderLine(i) { const el = inner.children[i]; if (el) el.outerHTML = lineHTML(i); if (i === idx) paintAnswer(); }
function renderAll() { inner.innerHTML = lines.map((_, i) => lineHTML(i)).join(""); paintAnswer(); updateCount(); }
function updateCount() {
  $("count").textContent = `${idx + 1}/${lines.length}`;
  $("prog").style.width = `${Object.keys(res).length / lines.length * 100}%`;
}
let progScrollUntil = 0;
function centerCurrent(smooth) {
  const el = inner.children[idx]; if (!el) return;
  progScrollUntil = Date.now() + (smooth ? 700 : 150);
  scriptEl.scrollTo({ top: el.offsetTop - scriptEl.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? "smooth" : "auto" });
}
// move to line i. focus: put the cursor in the first open blank (only when the mic is off — v3.20.1 rule)
function select(i, { scroll = true, focus = false } = {}) {
  i = Math.max(0, Math.min(lines.length - 1, i));
  clearTimeout(autoTimer); dragEnd();
  if (rec.listening) { rec.reset(); rec.gate(false); }       // mic stays on: fresh capture for the new line
  const old = idx; idx = i; hintLv = 0;
  resEl.className = "result"; errEl.className = "err";
  posMap[dlg.id] = idx; ls.set(K.pos, posMap);
  new Set([old - 1, old, old + 1, i - 1, i, i + 1]).forEach(j => { if (j >= 0 && j < lines.length) rerenderLine(j); });
  updateCount(); paintHint(); paintPill();
  if (scroll) centerCurrent(true); else requestAnimationFrame(() => centerCurrent(true));
  if (focus && typeMode() && !rec.listening && !tstate(idx).done) focusSlot(firstOpen(tstate(idx)));
}
let scrollT = null;
scriptEl.addEventListener("scroll", () => { clearTimeout(scrollT); scrollT = setTimeout(onScrollSettle, 130); }, { passive: true });
function onScrollSettle() {
  if (Date.now() < progScrollUntil || dragging()) return;
  if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("tin")) return;   // keyboard open: don't jump
  const mid = scriptEl.scrollTop + scriptEl.clientHeight / 2; let bi = idx, bd = Infinity;
  [...inner.children].forEach((el, i) => { const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid); if (d < bd) { bd = d; bi = i; } });
  if (bi !== idx) select(bi, { scroll: false });
}
inner.addEventListener("click", e => { const ln = e.target.closest(".ln"); if (ln && !ln.classList.contains("cur")) select(+ln.dataset.i); });

/* ---- answer area ---- */
function paintMode() {
  $("playView").classList.toggle("typemode", typeMode()); $("playView").classList.toggle("blockmode", !typeMode());
  $("pInMode").querySelectorAll("[data-im]").forEach(b => { const on = b.dataset.im === inMode; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  paintMic(); paintHint();
}
function paintAnswer() { typeMode() ? paintType() : paintBlocks(); }
function paintPill() {
  const r = res[idx];
  if (!r) { resEl.className = "result"; return; }
  resEl.innerHTML = `<span>${r.score === 100 ? "Perfect! 🎉" : typeMode() ? t("sxTypeRed") : t("sxBlockRed")}</span>`;
  resEl.className = "result show " + (r.score === 100 ? "good" : "mid");
}
function paintHint() {
  const b = $("hintBtn"), lv = typeMode() ? hintLv : 0;
  b.textContent = ["💡", "🔤", "👀"][lv]; b.title = t("hint" + lv); b.setAttribute("aria-label", b.title); b.classList.toggle("on", lv > 0);
}
function paintMic() {
  const on = rec.listening; micEl.classList.toggle("rec", on); micEl.disabled = !speechEngine();
  micEl.title = on ? t("sxMicOff") : t("sxMicOn"); micEl.setAttribute("aria-label", micEl.title);
}
function paintCheck(done, enabled = true) { const c = $("checkBtn"); c.disabled = !enabled; c.classList.toggle("next", !!done); }

/* ---- typing (+ speech fills the blanks) ---- */
function tstate(i) { if (!T[i]) T[i] = { slots: typeSlots(lines[i].en), vals: [], ok: [], bad: [], done: false }; return T[i]; }
const tph = w => hintLv === 2 ? w : hintLv === 1 ? w.slice(0, 1) : "";
const twidth = (w, v) => Math.max(w.length, (v || "").length, 2) + 1.2;
const firstOpen = s => s.slots.findIndex((_, k) => !s.ok[k] && (!s.vals[k] || s.bad[k]));
const allFilled = s => s.slots.every((_, k) => s.ok[k] || (s.vals[k] || "").trim());
let tKeep = false;
function paintType() {
  const el = $("curAns"); if (!el) return;
  const s = tstate(idx);
  el.innerHTML = `<div class="en typed">${s.slots.map((sl, k) => `<span class="tw">${esc(sl.lead)}<input class="tin ${s.ok[k] ? "ok" : s.bad[k] ? "bad" : ""}" data-t="${k}" value="${esc(s.vals[k] || "")}"${s.ok[k] ? ` readonly tabindex="-1"` : ""} placeholder="${esc(tph(sl.word))}" style="width:${twidth(sl.word, s.vals[k])}ch" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-label="${k + 1}">${esc(sl.tail)}</span>`).join("")}</div>
    <div class="heard tyheard" id="heard"></div>`;
  paintCheck(s.done);
}
function focusSlot(k) { const el = k >= 0 && inner.querySelector(`.ln.cur .tin[data-t="${k}"]`); if (el) el.focus({ preventScroll: true }); }
function tAdvance(k, dir = 1) {
  const s = tstate(idx), n = s.slots.length;
  if (dir < 0) { for (let d = 1; d < n; d++) { const p = (k - d + n) % n; if (!s.ok[p]) { focusSlot(p); return; } } return; }
  for (let d = 1; d < n; d++) { const p = (k + d) % n; if (!s.ok[p] && (!s.vals[p] || s.bad[p])) { focusSlot(p); return; } }
  if (allFilled(s)) checkType();
}
function checkType() {
  const s = tstate(idx); if (!allFilled(s)) return;
  const r = checkTyped(s.slots.map(x => x.word), s.vals);
  r.ok.forEach((o, k) => { s.ok[k] = s.ok[k] || o; s.bad[k] = !o; });
  s.done = r.ok.every(Boolean);
  const a = document.activeElement; if (a && a.classList && a.classList.contains("tin")) a.blur();
  paintType(); record(r.score, "type");
}
function live({ finalText, interim, parts }) {
  if (view !== "play" || !typeMode()) return;
  const s = tstate(idx), h = $("heard"), full = (finalText + " " + interim).trim();
  if (h) h.innerHTML = full ? `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interim)}</span>` : `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`;
  if (!full || s.done) return;
  const got = [...fillWords(refOf(idx), [full, ...parts, interim])].filter(k => k < s.slots.length && !s.ok[k]);
  if (!got.length) return;
  const a = document.activeElement, fk = a && a.classList && a.classList.contains("tin") ? +a.dataset.t : -1;
  got.forEach(k => { s.ok[k] = true; s.bad[k] = false; s.vals[k] = s.slots[k].word; });
  tick(); haptic(8);
  const heard = h ? h.innerHTML : "";
  paintType(); if ($("heard")) $("heard").innerHTML = heard;
  inner.querySelectorAll(".ln.cur .tin.ok").forEach(el => { if (got.includes(+el.dataset.t)) el.classList.add("heardok"); });
  if (allFilled(s)) { checkType(); return; }
  if (fk >= 0) { if (!s.ok[fk]) { tKeep = true; focusSlot(fk); tKeep = false; } else focusSlot(firstOpen(s)); }
}
function resetType() { delete T[idx]; if (res[idx] && res[idx].kind === "type") { delete res[idx]; paintPill(); } paintType(); if (!rec.listening) focusSlot(0); }
const slotOf = e => e.target.classList && e.target.classList.contains("tin") && view === "play" && typeMode() ? +e.target.dataset.t : -1;
inner.addEventListener("focusin", e => {
  const k = slotOf(e); if (k < 0) return;
  const s = tstate(idx); if (s.ok[k]) return;
  s.bad[k] = false; e.target.classList.remove("bad");
  if (tKeep) { tKeep = false; const n = e.target.value.length; e.target.setSelectionRange(n, n); return; }
  s.vals[k] = ""; e.target.value = ""; e.target.style.width = twidth(s.slots[k].word, "") + "ch";
});
inner.addEventListener("input", e => {
  const k = slotOf(e); if (k < 0) return;
  const s = tstate(idx); if (s.ok[k]) return;
  let v = e.target.value;
  if (/\s/.test(v)) { v = v.trim().split(/\s+/)[0] || ""; e.target.value = v; s.vals[k] = v; if (v) { tAdvance(k); return; } }
  s.vals[k] = v; e.target.style.width = twidth(s.slots[k].word, v) + "ch";
  const want = typedKey(s.slots[k].word), got = typedKey(v);
  if (allFilled(s) && (got === want || got.length >= want.length)) checkType();
});
inner.addEventListener("keydown", e => {
  const k = slotOf(e); if (k < 0) return;
  if (e.key === "Enter" || e.key === "Tab" || e.key === " ") { if (e.isComposing) return; e.preventDefault(); unlockAudio(); tAdvance(k, e.key === "Tab" && e.shiftKey ? -1 : 1); }
  else if (e.key === "Backspace" && !e.target.value && !e.isComposing) {
    e.preventDefault(); const s = tstate(idx);
    for (let p = k - 1; p >= 0; p--) if (!s.ok[p]) { tKeep = true; focusSlot(p); tKeep = false; return; }
  } else if (e.key === "Escape") e.target.blur();
});

/* ---- word blocks (tap / hold-and-drag, like 문장만들기) ---- */
function wstate(i) { if (!W[i]) { const b = makeBlocks(lines[i].en); W[i] = { ...b, placed: [], checked: false, result: null, glow: -1 }; } return W[i]; }
function paintBlocks() {
  const el = $("curAns"); if (!el) return;
  const s = wstate(idx), used = new Set(s.placed), r = s.checked ? s.result : null;
  const tray = s.placed.map((p, i) => { const b = s.blocks[p], ok = r ? r.ok[i] : null, want = r && !ok ? s.words[i] : "";
    return `<button class="blk ${r ? (ok ? "ok" : "bad") : "in"}" data-tray="${i}">${esc(b.text)}${want ? `<span class="want">${esc(want.replace(/[.,!?;:]+$/, ""))}</span>` : ""}</button>`; }).join("");
  el.innerHTML = `<div class="tray ${r ? "checked" : ""} ${s.placed.length ? "" : "empty"}" id="pTray">${tray || `<span class="ph">${t("sxTapBlocks")}</span>`}</div>
    <div class="pool">${s.blocks.map((b, i) => `<button class="blk ${used.has(i) ? "used" : ""} ${s.glow === i ? "glow" : ""}" data-pool="${i}" ${used.has(i) || r ? "disabled" : ""}>${esc(b.text)}</button>`).join("")}</div>`;
  paintCheck(s.checked && s.result.score === 100 || s.checked, s.checked || s.placed.length === s.blocks.length);
}
function placeBlock(i, at = null) {
  unlockAudio(); const s = wstate(idx); if (s.checked || s.placed.includes(i)) return;
  const k = at == null ? s.placed.length : at;
  s.placed.splice(k, 0, i); s.glow = -1; tick(); haptic(8);
  paintBlocks(); const b = $("pTray") && $("pTray").children[k]; if (b) b.classList.add("landed");
  if (s.placed.length === s.blocks.length) { const at0 = idx; setTimeout(() => { if (view === "play" && idx === at0) checkBlocksNow(); }, 260); }
}
function unplace(k) { const s = wstate(idx); if (s.checked) return; s.placed.splice(k, 1); tick(); paintBlocks(); }
function checkBlocksNow() {
  const s = wstate(idx); if (s.checked || s.placed.length !== s.blocks.length) return;
  s.result = checkBlocks(s.answerKeys, s.placed.map(p => s.blocks[p].key)); s.checked = true;
  paintBlocks(); record(s.result.score, "word");
}
function resetBlocks() { dragEnd(); delete W[idx]; if (res[idx] && res[idx].kind === "word") { delete res[idx]; paintPill(); } paintBlocks(); }
function blockHint() {
  const s = wstate(idx); if (s.checked) return;
  const h = nextBlockHint(s.answerKeys, s.placed.map(p => s.blocks[p].key));
  if (h.wrongAt >= 0) { const b = $("pTray").children[h.wrongAt]; if (b) { b.classList.remove("shake"); void b.offsetWidth; b.classList.add("shake"); } toast(t("sxHintWrongAt", h.wrongAt + 1)); return; }
  if (!h.key) return;
  s.glow = s.blocks.findIndex((b, i) => b.key === h.key && !s.placed.includes(i)); paintBlocks();
}
let dr = null, drDone = 0;
const dragging = () => !!(dr && dr.on);
const inside = (el, x, y) => { if (!el) return false; const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
inner.addEventListener("pointerdown", e => {
  if (view !== "play" || typeMode() || (e.pointerType === "mouse" && e.button !== 0)) return;
  const b = e.target.closest(".ln.cur .blk[data-pool], .ln.cur .blk[data-tray]"); if (!b || b.disabled || b.classList.contains("used") || wstate(idx).checked) return;
  dragEnd();
  const fromTray = b.dataset.tray != null;
  dr = { b, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, fromTray, idx: +(fromTray ? b.dataset.tray : b.dataset.pool), tgt: undefined, tm: setTimeout(dragStart, 150) };
});
function dragStart() {
  const d = dr; if (!d) return;
  d.on = true; haptic(30); try { d.b.setPointerCapture(d.id); } catch (e) {}
  const r = d.b.getBoundingClientRect(); d.dx = d.x0 - r.left; d.dy = d.y0 - r.top;
  const g = d.b.cloneNode(true); g.className = "blk ghost"; g.removeAttribute("data-pool"); g.removeAttribute("data-tray"); g.style.width = r.width + "px";
  document.body.appendChild(g); d.g = g; d.b.classList.add("dsrc"); dragMove();
}
function dragTarget() {
  const d = dr, tray = $("pTray"); if (!inside(tray, d.x, d.y)) return null;
  const list = [...tray.querySelectorAll("[data-tray]")].filter(b => b !== d.b);
  for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (d.y < r.top || (d.y <= r.bottom && d.x < r.left + r.width / 2)) return i; }
  return list.length;
}
function dragMove() {
  const d = dr; if (!d || !d.g) return;
  d.g.style.left = (d.x - d.dx) + "px"; d.g.style.top = (d.y - d.dy) + "px";
  const tg = dragTarget(); if (tg === d.tgt) return; d.tgt = tg;
  const tray = $("pTray"); tray.querySelectorAll(".gapm").forEach(x => x.remove()); tray.classList.toggle("dropin", tg != null);
  if (tg == null) return;
  const m = document.createElement("span"); m.className = "gapm";
  const list = [...tray.querySelectorAll("[data-tray]")].filter(b => b !== d.b);
  if (tg < list.length) tray.insertBefore(m, list[tg]); else tray.appendChild(m);
}
function dragDrop() {
  const d = dr, tg = dragTarget(), s = wstate(idx); drDone = Date.now(); dragEnd();
  if (tg != null) {
    if (d.fromTray) { const w = s.placed.splice(d.idx, 1)[0]; s.placed.splice(tg, 0, w); tick(); haptic(20); paintBlocks(); const b = $("pTray").children[tg]; if (b) b.classList.add("landed"); }
    else placeBlock(d.idx, tg);
  } else if (d.fromTray) { s.placed.splice(d.idx, 1); tick(); haptic(20); paintBlocks(); }
}
function dragEnd() {
  const d = dr; if (!d) return; dr = null;
  clearTimeout(d.tm); if (d.g) d.g.remove(); if (d.b) d.b.classList.remove("dsrc");
  const tray = $("pTray"); if (tray) { tray.querySelectorAll(".gapm").forEach(x => x.remove()); tray.classList.remove("dropin"); }
}
document.addEventListener("pointermove", e => { const d = dr; if (!d || e.pointerId !== d.id) return; d.x = e.clientX; d.y = e.clientY; if (!d.on) { if (Math.hypot(d.x - d.x0, d.y - d.y0) > 8) dragEnd(); return; } dragMove(); });
document.addEventListener("pointerup", e => { const d = dr; if (!d || e.pointerId !== d.id) return; if (d.on) dragDrop(); else dragEnd(); });
document.addEventListener("pointercancel", e => { if (dr && e.pointerId === dr.id) { if (dr.on) drDone = Date.now(); dragEnd(); } });
document.addEventListener("touchmove", e => { if (dragging()) e.preventDefault(); }, { passive: false });
inner.addEventListener("click", e => {
  if (view !== "play" || typeMode() || Date.now() - drDone < 450) return;
  const p = e.target.closest(".ln.cur [data-pool]"), tr = e.target.closest(".ln.cur [data-tray]");
  if (p && !p.disabled) placeBlock(+p.dataset.pool); else if (tr) unplace(+tr.dataset.tray);
});
inner.addEventListener("contextmenu", e => { if (e.target.closest(".blk")) e.preventDefault(); });

/* ---- a line answered ---- */
const pendAt = k => !res[k];
function record(score, kind) {
  res[idx] = { score, kind };
  countMap[dlg.id] = (countMap[dlg.id] || 0) + 1; ls.set(K.count, countMap);
  lastMap[dlg.id] = Date.now(); ls.set(K.last, lastMap);
  const day = ymd(Date.now()); dayMap[day] = (dayMap[day] || 0) + 1; ls.set(K.days, dayMap);
  const key = dlg.id + "|" + lines[idx].en; if (best[key] == null || score > best[key]) { best[key] = score; ls.set(K.best, best); }
  if (lines.every(l => best[dlg.id + "|" + l.en] != null) && !doneMap[dlg.id]) { doneMap[dlg.id] = Date.now(); ls.set(K.done, doneMap); }
  paintPill(); updateCount();
  const m = inner.children[idx] && inner.children[idx].querySelector(".bs"); if (m) m.outerHTML = mark(best[key]);
  clearTimeout(autoTimer);
  if (score === 100) {
    chime(); haptic(20);
    const others = lines.some((_, k) => k !== idx && pendAt(k));
    if (rec.listening) { if (!others) rec.stop(true); else rec.gate(true); }   // ignore speech until the next line is up
    const at = idx; autoTimer = setTimeout(() => { if (view === "play" && idx === at) nextLine(true); else rec.gate(false); }, 1000);
  } else { thud(); haptic([10, 40, 10]); }
}
// › : in order until the last line, then the lines still not answered, then 🏆
function nextLine(auto = false) {
  const st = nextStop(lines.length, idx, lines.map((_, k) => pendAt(k)), sweep);
  if (st.stay) { if (!auto) toast(t("sxOnlyThis")); return; }
  if (st.done) { if (rec.listening) rec.stop(true); showFinish(); return; }
  if (st.entered) toast(t("sxGoSkipped", lines.filter((_, k) => pendAt(k)).length));
  sweep = st.sweep; select(st.to, { focus: true });
}
function showErr(m) { errEl.textContent = m; errEl.className = "err show"; }
function nudge(m) { toast(m); micEl.classList.remove("blip"); void micEl.offsetWidth; micEl.classList.add("blip"); try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }

/* ---- TTS ---- */
function speak() { if (rec.listening) rec.stop(true); say(lines[idx].en); }

/* ---- Claude artifact: borrow the dictation capability (speech.js uses hub.dictation) ---- */
(async function initEngine() {
  if (!inArtifact) { paintMic(); return; }
  window.claude.use("downloads").then(d => { downloads = d; }).catch(() => {});
  let d = null; try { d = await window.claude.use("dictation"); } catch (e) {}
  if (d) {
    hub.dictation = d;
    d.onPartial(({ text }) => { if (hub.owner) hub.owner.partial(text); });
    d.onFinal(({ text }) => { if (hub.owner) hub.owner.final(text); });
    d.onState(({ state }) => { if (hub.owner) hub.owner.state(state); });
  }
  paintMic();
})();

/* ---- player controls ---- */
["mic", "checkBtn", "hintBtn", "resetBtn", "play"].forEach(id => $(id).addEventListener("mousedown", e => e.preventDefault()));   // keep the text cursor
micEl.onclick = () => {
  unlockAudio(); if (!speechEngine()) return;
  if (rec.listening) { rec.stop(); return; }
  errEl.className = "err"; hush(); clearTimeout(autoTimer);
  rec.start(); paintMic(); live({ finalText: "", interim: "", parts: [] });
};
$("checkBtn").onclick = () => {
  unlockAudio();
  if (typeMode()) { const s = tstate(idx); if (s.done || res[idx] && res[idx].score === 100) nextLine(); else { const k = firstOpen(s); k < 0 ? checkType() : focusSlot(k); } return; }
  const s = wstate(idx); if (s.checked) nextLine(); else checkBlocksNow();
};
$("prev").onclick = () => select(idx - 1, { focus: true });
$("next").onclick = () => { unlockAudio(); nextLine(); };
$("play").onclick = speak;
$("hintBtn").onclick = () => {
  if (!typeMode()) { blockHint(); return; }
  hintLv = (hintLv + 1) % 3; paintHint();
  const s = tstate(idx); inner.querySelectorAll(".ln.cur .tin").forEach(el => { el.placeholder = tph(s.slots[+el.dataset.t].word); });
};
$("resetBtn").onclick = () => typeMode() ? resetType() : resetBlocks();
$("pInMode").addEventListener("click", e => {
  const b = e.target.closest("[data-im]"); if (!b || b.dataset.im === inMode) return;
  if (rec.listening) rec.stop(true);
  dragEnd(); inMode = b.dataset.im; ls.set(IN_KEY, inMode); hintLv = 0;
  paintMode(); paintAnswer(); paintPill(); requestAnimationFrame(() => centerCurrent(true));
  toast(t(typeMode() ? "sxTypeOnToast" : "sxWordOnToast"));
  if (typeMode()) focusSlot(firstOpen(tstate(idx)));
});
document.addEventListener("keydown", e => {
  if (/TEXTAREA|INPUT/.test(e.target.tagName) || document.querySelector(".overlay.show,.modal.show")) return;
  if (view === "sx" || view === "st") return;                     // 문장만들기 has its own keys (sx.js)
  if (e.key === "Escape") { setPrompt(false); if (view === "play" || view === "info" || view === "set") history.back(); return; }
  if (view !== "play") return;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); nextLine(); }
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(idx - 1); }
  else if (e.code === "Space") { e.preventDefault(); micEl.click(); }
  else if (e.key === "Enter") { e.preventDefault(); $("checkBtn").click(); }
  else if (e.key === "h" || e.key === "H") $("hintBtn").click();
  else if (e.key === "l" || e.key === "L") speak();
});
window.addEventListener("resize", () => { if (view === "play" && !(document.activeElement && document.activeElement.classList.contains("tin"))) centerCurrent(false); });

/* ================= FINISH SCREEN: 🏆, confetti, fanfare, a perseverance quote (no score) ================= */
function showFinish() {
  const n = lines.length, secs = Math.round((Date.now() - sessionStart) / 1000);
  $("finDlg").textContent = dlg.title;
  $("finStats").innerHTML = [[t("stSentences"), `${n}`], [t("finTime"), t("minSec", Math.floor(secs / 60), secs % 60)]]
    .map(([l, v]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  $("finQuote").innerHTML = `<p class="q-en">“${esc(q.en)}”</p>` + (lang() === "ko" ? `<p class="q-ko">${esc(q.ko)}</p><cite>— ${esc(q.by)} (${esc(q.byKo)})</cite>` : `<cite>— ${esc(q.by)}</cite>`);
  $("finish").classList.add("show");
  fanfare(); confettiOn($("confetti"));
}
$("finDone").onclick = () => { $("finish").classList.remove("show"); confettiOff($("confetti")); go("/dlg", { replace: true }); };

/* ================= SETTINGS (full-screen page, /settings) ================= */
function paintLangSeg() { const c = langChoice(); document.querySelectorAll("#langSeg [data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === c)); }
function applyLang() {
  setLang(resolveLang()); applyStatic();
  $("promptText").textContent = promptText(); $("verText").textContent = `v${VERSION}`;
  paintMic(); paintHint();
  sxApplyLang();
  if (view === "lib") renderLib(); else if (view === "info") renderInfo(); else if (view === "play") { renderAll(); requestAnimationFrame(() => centerCurrent(false)); } else if (view === "set") paintSettings();
}
function paintSettings() {
  const b = $("acctBox");
  if (!me) {
    b.innerHTML = `<div class="pcard guest"><div class="pc-av">👋</div><div class="pc-tx"><b>${t("acctGuestT")}</b><span>${t("acctGuest")}</span></div></div>
      <button class="btn pri wide" id="acctLogin">${t("acctLogin")}</button>`;
    $("acctLogin").onclick = () => { try { sessionStorage.removeItem("speakup.guest.v1"); } catch (e) {} location.href = "/"; };
  } else {
    b.innerHTML = `<div class="pcard">${me.picture ? `<img class="pc-av" src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="pc-av">${esc((me.name || me.email || "?").slice(0, 1))}</span>`}
      <div class="pc-tx"><b>${esc(me.name || "")}</b><span>${esc(me.email || "")}</span><em id="syncTxt"></em></div></div>`;
  }
  $("logoutRow").style.display = me ? "" : "none";
  paintSync(); paintLangSeg();
}
let syncSt = "ok";
function paintSync() { const e = $("syncTxt"); if (e) { e.textContent = t("sync_" + syncSt); e.className = "sync " + syncSt; } }
if (me) onSync(s => { syncSt = s; paintSync(); });
$("settingsBtn").onclick = () => go("/settings");
$("setBack").onclick = () => goBack("/" + sxMode);
$("logoutRow").onclick = async () => { if (await ask(t("acctLogoutQ"), t("acctLogout"))) logout(); };
$("langSeg").addEventListener("click", e => { const b = e.target.closest("[data-lang]"); if (!b) return; setLangChoice(b.dataset.lang); paintLangSeg(); applyLang(); });

// No zoom: iOS Safari ignores user-scalable=no for pinch, so block its gesture events (text selection is unaffected).
["gesturestart", "gesturechange", "gestureend"].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.scale && e.scale !== 1) e.preventDefault(); }, { passive: false });

initSx({ showView, view: () => view, toast, ask, renderLib });
applyLang();

/* ================= ROUTES ================= */
onRoute(parts => {
  const [top, a, b] = parts;
  $("finish").classList.remove("show"); confettiOff($("confetti"));
  document.querySelectorAll(".overlay.show").forEach(o => o.classList.remove("show"));
  if (top === "settings") { showView("set"); paintSettings(); return; }
  if (top === "sx") { if (a) { sxRoute(parts.slice(1)); return; } setTabMode("sx"); showLibrary(); return; }
  if (top === "dlg" && a) {
    if (!findDlg(a)) { go("/dlg", { replace: true }); return; }
    if (b === "play") { dlg = findDlg(a); spkColor = {}; openPlayer(posMap[a] || 0); return; }
    openInfo(a); return;
  }
  if (top !== "dlg") { go("/" + sxMode, { replace: true }); return; }
  setTabMode("dlg"); showLibrary();
});
dispatch();
// shared list changes while the app is open: refresh when the tab comes back
if (me) document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  await refreshShared(); sharedLib = (sharedContent().dialogs || []).filter(d => d && d.id && Array.isArray(d.lines)); refreshSharedSx();
  if (view === "lib") renderLib();
});
