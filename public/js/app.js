// Speak Up — UI. Views: library → info → player. All data lives in localStorage (see store below).
import { parseMd, toMd, libraryToMd, libraryToJson, parseJsonImport, tokenize, fillWords, scoreAttempt, dialogStats } from "./core.js";
import { SAMPLE_MD, OLD_SAMPLE, CONVERT_PROMPT, CONVERT_PROMPT_EN } from "./content.js";
import { t, lang, setLang, langChoice, setLangChoice, resolveLang, applyStatic, QUOTES } from "./i18n.js";
import { unlockAudio, chime, fanfare, startConfetti as confettiOn, stopConfetti as confettiOff } from "./fx.js";
import { hub } from "./speech.js";
import { initSx, sxApplyLang, renderTrainings, newTraining } from "./sx.js";
const VERSION = "3.17.0";
const promptText = () => lang() === "en" ? CONVERT_PROMPT_EN : CONVERT_PROMPT;

/* ================= store (localStorage) ================= */
const K = { lib: "speakup.lib.v3", best: "speakup.best.v3", pos: "speakup.pos.v3", count: "speakup.count.v3", last: "speakup.last.v3", auto: "speakup.auto.v3", keep: "speakup.keep.v3" };
let storageOK = true;
try { localStorage.setItem("speakup.probe", "1"); localStorage.removeItem("speakup.probe"); } catch (e) { storageOK = false; }
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { storageOK = false; return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { storageOK = false; showStoreWarn(); } },
};
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
let autoNext = ls.get(K.auto, true);
let keepOn = ls.get(K.keep, false);           // 유지: mic stays on across sentences (one recognition session → fewer iOS chimes)
const PAUSE_MS = 30000;                        // silence (after some speech) that ends a sentence; ✅ 완료 / mic tap end it sooner
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
  view = v;
  ["lib", "info", "play", "sx", "st"].forEach(n => { $(n + "View").classList.toggle("on", n === v); document.body.classList.toggle("v-" + n, n === v); });
}
let dlg = null;   // the dialogue open in info/player

/* ================= LIBRARY ================= */
let editing = false; const selected = new Set();
function renderLib() {
  showStoreWarn();
  const sxOn = document.body.dataset.mode === "sx";
  $("dlist").style.display = sxOn ? "none" : ""; $("sxList").style.display = sxOn ? "" : "none";
  if (sxOn) { if (editing) { editing = false; selected.clear(); } $("libView").classList.remove("editing"); setFab(false); renderTrainings($("sxList")); return; }
  $("libView").classList.toggle("editing", editing);
  $("editModeBtn").textContent = editing ? t("done") : t("edit"); $("editModeBtn").classList.toggle("on", editing);
  const el = $("dlist");
  if (!lib.length) {
    el.innerHTML = `<div class="empty">${t("empty")}<br><button class="btn pri" id="addSample">${t("addSample")}</button></div>`;
    $("addSample").onclick = () => addDialogs(parseMd(SAMPLE_MD));
  } else {
    const sorted = [...lib].sort((a, b) => (b.created || 0) - (a.created || 0));   // newest first, numbered N…1
    el.innerHTML = sorted.map((d, i) => {
      const n = d.lines.length, cnt = countMap[d.id] || 0, last = lastMap[d.id], sel = selected.has(d.id);
      return `<div class="dcard ${sel ? "sel" : ""}" data-id="${d.id}">
        <span class="chk">${sel ? "✓" : ""}</span>
        <span class="dno">${sorted.length - i}</span>
        <div class="dmain"><div class="dt">${esc(d.title)}</div>
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
  if (editing) { selected.has(id) ? selected.delete(id) : selected.add(id); renderLib(); }
  else openInfo(id);
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
  $("edErr").className = "ferr";
  $("edOverlay").classList.add("show");
  setTimeout(() => $("editor").focus(), 50);
}
const closeEditor = () => $("edOverlay").classList.remove("show");
$("addBtn").onclick = () => { setFab(false); openEditor("add"); };
$("infoEdit").onclick = () => openEditor("edit");
$("editDlgBtn").onclick = () => { if (listening) stopListening(true); openEditor("edit"); };
$("edCancel").onclick = closeEditor;
$("edSave").onclick = () => {
  const ds = parseMd($("editor").value);
  if (!ds.length) { $("edErr").textContent = t("noEnglish"); $("edErr").className = "ferr show"; return; }
  if (edMode === "add") { addDialogs(ds); closeEditor(); toast(ds.length > 1 ? t("addedN", ds.length) : t("addedOne", ds[0].title)); return; }
  const [first, ...rest] = ds;                                   // edit: first replaces this dialogue, extras are inserted after it
  dlg.title = first.title; dlg.lines = first.lines; dlg.updated = Date.now();
  if (rest.length) { const at = lib.indexOf(dlg), t = Date.now(); lib.splice(at + 1, 0, ...rest.map((d, i) => newDialog(d, t + i))); }
  saveLib(); closeEditor();
  if (view === "play") openPlayer(Math.min(idx, dlg.lines.length - 1)); else renderInfo();
  toast(rest.length ? t("editedPlus", rest.length) : t("edited"));
};
$("edDelete").onclick = async () => {
  if (!await ask(t("confirmDeleteOne", dlg.title))) return;
  lib = lib.filter(d => d !== dlg); delete posMap[dlg.id]; delete countMap[dlg.id]; delete lastMap[dlg.id]; saveLib(); ls.set(K.pos, posMap); ls.set(K.count, countMap); ls.set(K.last, lastMap);
  closeEditor(); goLibrary(); toast(t("deleted"));
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
$("exportBtn").onclick = () => { $("setOverlay").classList.remove("show"); if (!lib.length) { toast(t("nothingToExport")); return; } openExport(lib); };
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
function openInfo(id) { dlg = lib.find(d => d.id === id); if (!dlg) return; spkColor = {}; showView("info"); renderInfo(); $("infoView").querySelector(".infoscroll").scrollTop = 0; }
function renderInfo() {
  const s = dialogStats(dlg), n = s.sentences, at = Math.min(posMap[dlg.id] || 0, n - 1);
  $("infoBody").innerHTML = `
    <div class="ititle">${esc(dlg.title)}</div>
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
      return `<li><span class="no">${i + 1}</span><div class="tx"><div class="te">${spkChip(l.spk)}${esc(l.en)}</div><div class="tk">${esc(l.ko || "")}</div></div><span class="bs ${b === 100 ? "p" : ""}">${b != null ? b + "%" : ""}</span></li>`; }).join("")}</ul>`;
  $("startTop").onclick = () => openPlayer(0);
  if ($("startResume")) $("startResume").onclick = () => openPlayer(at);
}
function goLibrary() {
  if (listening) stopListening(true); clearTimeout(autoTimer); try { speechSynthesis.cancel(); } catch (e) {}
  dlg = null; editing = false; selected.clear(); showView("lib"); renderLib();
}
$("infoBack").onclick = goLibrary;

/* ================= PLAYER ================= */
const inner = $("inner"), scriptEl = $("script"), micEl = $("mic"), errEl = $("err"), resEl = $("result");
let lines = [], idx = 0, hintLv = 0;   // hintLv 0 blanks · 1 first letter on blanks · 2 show answer
let attempts = {};                     // idx → {st, said, score, heardHTML} (this session only)
let liveSt = null;                     // per-word "live" status of the current line while speaking
let refCache = {};
const refOf = i => refCache[i] || (refCache[i] = tokenize(lines[i].en));
const badge = s => s == null ? "" : `<span class="badge ${s >= 80 ? "g" : s >= 50 ? "m" : "l"}">${s}%</span>`;

let sessionStart = 0;
function openPlayer(at) {
  sessionStart = Date.now();
  lines = dlg.lines; attempts = {}; lineFilled = {}; refCache = {}; liveSt = null; hintLv = 0;
  idx = Math.max(0, Math.min(lines.length - 1, at));
  posMap[dlg.id] = idx; ls.set(K.pos, posMap);
  $("ptitle").textContent = dlg.title;
  showView("play"); updateHintBtn(); resEl.className = "result"; errEl.className = "err";
  renderAll(); requestAnimationFrame(() => centerCurrent(false));
}
$("backBtn").onclick = () => { if (listening) stopListening(true); clearTimeout(autoTimer); try { speechSynthesis.cancel(); } catch (e) {} showView("info"); renderInfo(); };

// A word is visible if: not the current line, already scored (right ones green, wrong ones red with what was heard
// underneath, missed ones too — the answer word is always shown after an attempt), said right live, or hint level 2.
function wordView(i, k) {
  const att = attempts[i], cur = i === idx;
  let st = att ? att.st[k] : "";
  if (cur && !att && liveSt && liveSt[k] === "live") st = "live";
  const shown = !cur || !!att || st === "live" || hintLv === 2;
  return { cls: "w " + st + (shown ? "" : " hid" + (hintLv === 1 ? " fl1" : "")), said: cur && att && att.said[k] ? att.said[k] : "" };
}
function wordsHTML(i) {
  return refOf(i).words.map((w, k) => { const v = wordView(i, k);
    return `<span class="${v.cls}"><span class="fl">${esc(w.slice(0, 1))}</span><span class="rest">${esc(w.slice(1))}</span><span class="said">${esc(v.said)}</span></span>`; }).join("");
}
function paintCurWords() {
  const en = $("curEn"); if (!en) return; let any = false;
  en.querySelectorAll(".w").forEach((el, k) => { const v = wordView(idx, k); el.className = v.cls; el.querySelector(".said").textContent = v.said; if (v.said) any = true; });
  en.classList.toggle("has-said", any);
}
function lineHTML(i) {
  const L = lines[i], cur = i === idx, att = attempts[i];
  let en = "";
  if (cur) en = `<div class="en" id="curEn">${wordsHTML(i)}</div>
      <div class="heard" id="heard">${att ? att.heardHTML : `<span class="ph">${t("sayIt")}</span>`}</div>`;
  // past and future lines never show the English (it is the answer) — Korean only
  const bdg = cur ? badge(bestOf(dlg, L)) : (i < idx && att ? badge(att.score) : "");
  return `<div class="ln ${cur ? "cur" : ""}${Math.abs(i - idx) === 1 ? " near" : ""}" data-i="${i}">${spkChip(L.spk)}${bdg}<div class="ko">${esc(L.ko || t("noTranslation"))}</div>${en}</div>`;
}
function rerenderLine(i) { const el = inner.children[i]; if (el) el.outerHTML = lineHTML(i); if (i === idx) paintCurWords(); }
function renderAll() { inner.innerHTML = lines.map((_, i) => lineHTML(i)).join(""); paintCurWords(); updateCount(); }
function updateCount() { $("count").textContent = `${idx + 1}/${lines.length}`; $("prog").style.width = `${(idx + 1) / lines.length * 100}%`; }

let progScrollUntil = 0;
function centerCurrent(smooth) {
  const el = inner.children[idx]; if (!el) return;
  progScrollUntil = Date.now() + (smooth ? 700 : 150);
  scriptEl.scrollTo({ top: el.offsetTop - scriptEl.clientHeight / 2 + el.offsetHeight / 2, behavior: smooth ? "smooth" : "auto" });
}
function select(i, { scroll = true } = {}) {
  i = Math.max(0, Math.min(lines.length - 1, i));
  if (listening && !keepOn) stopListening(true);
  clearTimeout(autoTimer);
  gated = false;
  if (listening) { resetCapture(); clearTimeout(silenceTimer); }   // keep mode: same session, fresh capture for the new line
  const old = idx; idx = i; hintLv = 0; liveSt = null; updateHintBtn();
  if (listening) filledSet = keptFilled();                       // keep mode: start the new line from its kept words
  resEl.className = "result"; errEl.className = "err";
  posMap[dlg.id] = idx; ls.set(K.pos, posMap);
  new Set([old - 1, old, old + 1, i - 1, i, i + 1]).forEach(j => { if (j >= 0 && j < lines.length) rerenderLine(j); });
  updateCount();
  if (scroll) centerCurrent(true); else requestAnimationFrame(() => centerCurrent(true));   // re-centre after the card grows
}
// Swipe/wheel: when scrolling settles, the sentence in the middle becomes current (CSS scroll-snap centres it).
let scrollT = null;
scriptEl.addEventListener("scroll", () => { clearTimeout(scrollT); scrollT = setTimeout(onScrollSettle, 130); }, { passive: true });
function onScrollSettle() {
  if (Date.now() < progScrollUntil) return;
  const mid = scriptEl.scrollTop + scriptEl.clientHeight / 2; let bi = idx, bd = Infinity;
  [...inner.children].forEach((el, i) => { const d = Math.abs(el.offsetTop + el.offsetHeight / 2 - mid); if (d < bd) { bd = d; bi = i; } });
  if (bi !== idx) select(bi, { scroll: false });
}
inner.addEventListener("click", e => { const ln = e.target.closest(".ln"); if (ln && !ln.classList.contains("cur")) select(+ln.dataset.i); });
function updateHintBtn() { const b = $("hintBtn"); b.textContent = t("hint" + hintLv); b.classList.toggle("on", hintLv > 0); }

/* ---- TTS ---- */
function speak(rate) {
  try {
    if (!("speechSynthesis" in window)) return; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(lines[idx].en); u.lang = "en-US"; u.rate = rate;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Samantha|Aria|Jenny|Natural/i.test(v.name)) || vs.find(v => /en[-_]US/i.test(v.lang));
    if (v) u.voice = v; speechSynthesis.speak(u);
  } catch (e) {}
}
try { speechSynthesis.getVoices(); } catch (e) {}

/* ---- listening & scoring ---- */
let finalText = "", interimText = "", listening = false, finished = true, abandon = false, autoTimer = null;
let finalParts = [];        // settled phrases of the current capture (each is aligned on its own to fill blanks)
let filledSet = new Set();  // answer word indices filled so far in the current capture — once filled, stays filled
let lineFilled = {};        // idx → Set of words filled in any attempt this session; a retry starts from these (never un-fills)
const keptFilled = () => new Set(lineFilled[idx] || []);
function paintKept() { liveSt = filledSet.size ? refOf(idx).words.map((_, k) => filledSet.has(k) ? "live" : "") : null; paintCurWords(); }
function showLive() {
  const heard = $("heard"); if (!heard) return;
  const full = (finalText + " " + interimText).trim();
  if (!full) { if (!attempts[idx]) heard.innerHTML = `<span class="label">${t("listening")}</span><span class="ph">${t("listeningPh")}</span>`; return; }
  if (attempts[idx]) { delete attempts[idx]; resEl.className = "result"; rerenderLine(idx); }   // speaking again = new attempt (kept words stay green)
  const ref = refOf(idx);
  fillWords(ref, [full, ...finalParts, interimText]).forEach(k => filledSet.add(k));
  liveSt = ref.words.map((_, k) => filledSet.has(k) ? "live" : ""); paintCurWords();
  heard.innerHTML = `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interimText)}</span>`;
  if (filledSet.size === ref.words.length) sentenceDone();      // every blank filled → score right away
}
function evaluate() {
  const said = (finalText + " " + interimText).trim(); liveSt = null;
  if (!said) { paintCurWords(); const h = $("heard"); if (h) h.innerHTML = `<span class="ph">${t("nothingHeard")}</span>`; return; }
  const r = scoreAttempt(lines[idx].en, said, [...finalParts, interimText], [...filledSet]);
  const heardHTML = `<span class="label">${t("youSaid")}</span>` + r.heard.map(h => `<span class="h ${h.st}">${esc(h.w)}</span>`).join(" ");
  attempts[idx] = { st: r.st, said: r.said, score: r.score, heardHTML };
  lineFilled[idx] = new Set(r.st.map((s, k) => s === "ok" ? k : -1).filter(k => k >= 0));
  hintLv = 0; updateHintBtn();                                   // hint resets once the sentence is scored
  if (r.score === 100) chime();
  countMap[dlg.id] = (countMap[dlg.id] || 0) + 1; ls.set(K.count, countMap);
  lastMap[dlg.id] = Date.now(); ls.set(K.last, lastMap);
  const key = dlg.id + "|" + lines[idx].en; if (best[key] == null || r.score > best[key]) { best[key] = r.score; ls.set(K.best, best); }
  rerenderLine(idx);
  const [cls, title] = r.score === 100 ? ["good", "Perfect! 🎉"] : r.score >= 80 ? ["good", "Great!"] : r.score >= 50 ? ["mid", "Good try!"] : ["low", "One more time!"];
  const parts = [t("blanks", r.ok, r.total)]; if (r.bad) parts.push(t("wrongN", r.bad)); if (r.miss) parts.push(t("missedN", r.miss));
  $("score").textContent = r.score + "%"; $("msgT").textContent = title; $("msgS").textContent = parts.join(" · ");
  resEl.className = "result show " + cls;
  clearTimeout(autoTimer);
  if (autoNext && r.score === 100 && idx < lines.length - 1) {
    const at = idx; if (keepOn && listening) gated = true;      // ignore speech until the next line is up
    autoTimer = setTimeout(() => { if (view === "play" && idx === at && (keepOn || !listening)) select(idx + 1); else gated = false; }, 1400);
  } else if (r.score === 100 && idx === lines.length - 1) {     // last sentence perfect → finish screen
    if (keepOn && listening) stopListening(true);
    const at = idx; autoTimer = setTimeout(() => { if (view === "play" && idx === at) showFinish(); }, 1300);
  }
}
function setMicUI(on) { micEl.classList.toggle("rec", on); micEl.title = on ? (keepOn ? t("micKeep") : t("micTalk")) : t("micIdle"); updateDone(); micEl.setAttribute("aria-label", micEl.title); }
function showErr(m) { errEl.textContent = m; errEl.className = "err show"; }
function finish() {
  if (finished) return; finished = true; listening = false; clearTimeout(silenceTimer); setMicUI(false);
  if (abandon) { abandon = false; liveSt = null; return; }
  if (!(finalText + interimText).trim() && (keepOn || attempts[idx])) { liveSt = null; paintCurWords(); return; }   // keep mode: mic turned off between sentences
  evaluate();
}
// A sentence is complete (all words matched, or the pause ran out). Normal mode: stop the mic and score.
// Keep mode: score, then keep the same session open and start a fresh capture.
function sentenceDone() {
  if (!keepOn) { stopListening(); return; }
  clearTimeout(silenceTimer);
  if (!(finalText + interimText).trim()) return;
  evaluate(); resetCapture();
}
function nudge(m) { toast(m); micEl.classList.remove("blip"); void micEl.offsetWidth; micEl.classList.add("blip"); try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }

/* ---- speech engines ----
 * Inside a Claude artifact the page can't open the mic, so it uses the `dictation` capability (window.claude.use).
 * Everywhere else (kappy.app, localhost) it uses the browser Web Speech API with lang en-US.
 * Chrome ends a session by itself after a long silence: onend restarts it and keeps what was heard (baseText). */
let engine = null, dictation = null, rec = null, silenceTimer = null, stopRequested = false, baseText = "";
let consumed = 0, lastLen = 0, basePartsN = 0;   // basePartsN: phrases carried over from a previous (auto-restarted) session     // native: results before index `consumed` belong to earlier sentences (keep mode)
let skipNextFinal = false;         // dictation: drop the rest of a phrase that was in progress when the capture reset
let gated = false;                 // keep mode: ignore speech while waiting for auto-advance
function resetCapture() {
  consumed = lastLen; skipNextFinal = !!interimText.trim();
  finalText = ""; interimText = ""; baseText = ""; liveSt = null; finalParts = []; filledSet = keptFilled(); basePartsN = 0; updateDone();
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function armSilence() { clearTimeout(silenceTimer); updateDone(); if ((finalText + interimText).trim()) silenceTimer = setTimeout(sentenceDone, PAUSE_MS); }
// ✅ 완료: score what has been said so far (not every blank has to be filled). Enabled while listening with some speech.
function updateDone() { $("doneBtn").disabled = !(listening && !gated && (finalText + interimText).trim()); }
function nativeStart() {
  rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3;
  consumed = 0; lastLen = 0;
  rec.onresult = e => {
    lastLen = e.results.length; if (gated) return;
    const refSet = new Set(refOf(idx).toks.map(t => t.t));
    let fin = "", inter = ""; const parts = [];
    for (let i = consumed; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {     // pick the alternative that overlaps the answer most
        let ba = r[0].transcript, bh = -1;
        for (let k = 0; k < r.length; k++) { const hit = tokenize(r[k].transcript).toks.filter(t => refSet.has(t.t)).length; if (hit > bh) { bh = hit; ba = r[k].transcript; } }
        fin += ba + " "; parts.push(ba);
      } else inter += r[0].transcript;
    }
    finalText = (baseText + " " + fin).trim(); interimText = inter.trim(); finalParts = basePartsN ? [...finalParts.slice(0, basePartsN), ...parts] : parts; showLive(); armSilence();
  };
  rec.onerror = e => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    stopRequested = true;
    if (e.error === "not-allowed" || e.error === "service-not-allowed") showErr(t("errMic"));
    else if (e.error === "network") showErr(t("errNetwork"));
    else showErr(t("errOther", e.error));
  };
  rec.onend = () => {
    if (listening && !stopRequested && !finished) {
      if (interimText) finalParts.push(interimText);
      baseText = (finalText + " " + interimText).trim(); finalText = baseText; interimText = ""; basePartsN = finalParts.length;
      try { nativeStart(); nudge(t("resumed")); return; } catch (e) {}
    }
    finish();
  };
  rec.start();
}
function startListening() {
  clearTimeout(autoTimer); errEl.className = "err"; resEl.className = "result";
  if (attempts[idx]) { delete attempts[idx]; rerenderLine(idx); }
  finalText = ""; interimText = ""; baseText = ""; liveSt = null; finalParts = []; filledSet = keptFilled(); basePartsN = 0; finished = false; listening = true; abandon = false; stopRequested = false; gated = false; skipNextFinal = false;
  try { speechSynthesis.cancel(); } catch (e) {}
  setMicUI(true); paintKept(); showLive();
  if (engine === "dictation") {
    dictation.start().catch(err => {    // must be called synchronously from the click
      const r = String(err && (err.code || err.message) || err);
      showErr(/not_granted/.test(r) ? t("errDictDenied") : t("errDictStart", r));
      finished = true; listening = false; setMicUI(false);
    });
  } else { try { nativeStart(); } catch (e) { showErr(t("errStart")); finished = true; listening = false; setMicUI(false); } }
}
function stopListening(drop) {
  clearTimeout(silenceTimer); stopRequested = true; if (drop) abandon = true;
  if (engine === "dictation") dictation.stop().catch(() => {}).finally(() => finish());
  else if (rec) { try { drop ? rec.abort() : rec.stop(); } catch (e) { finish(); } }
  if (drop) finish();
}
function setEngine(n) {
  engine = n; micEl.dataset.engine = n || "none";   // "dictation" (Claude artifact) | "native" (Web Speech, en-US)
  if (!n) { micEl.disabled = true; showErr(t("errUnsupported")); }
}
(async function initEngine() {
  if (inArtifact) {
    micEl.disabled = true;
    window.claude.use("downloads").then(d => { downloads = d; }).catch(() => {});
    let d = null; try { d = await window.claude.use("dictation"); } catch (e) {}
    micEl.disabled = false;
    if (d) {
      dictation = d; hub.dictation = d;   // 문장만들기 borrows it: while hub.owner is set, events go there
      d.onPartial(({ text }) => { if (hub.owner) { hub.owner.partial(text); return; } if (!listening || gated || skipNextFinal) return; interimText = text || ""; showLive(); armSilence(); });
      d.onFinal(({ text }) => { if (hub.owner) { hub.owner.final(text); return; } if (!listening) return; if (skipNextFinal || gated) { skipNextFinal = false; return; } finalText = (finalText + " " + (text || "")).trim(); if (text) finalParts.push(text); interimText = ""; showLive(); armSilence(); });
      d.onState(({ state }) => { if (hub.owner) { hub.owner.state(state); return; } if (state === "idle" && !finished) finish(); });
      setEngine("dictation"); return;
    }
  }
  setEngine(SR ? "native" : null);
})();

/* ---- player controls ---- */
micEl.addEventListener("click", () => { unlockAudio(); if (!engine) return; listening ? stopListening() : startListening(); });
$("prev").onclick = () => select(idx - 1);
$("next").onclick = () => { unlockAudio(); if (idx === lines.length - 1 && attempts[idx]) { if (listening) stopListening(true); showFinish(); } else select(idx + 1); };
$("play").onclick = () => speak(0.95);
$("hintBtn").onclick = () => { hintLv = (hintLv + 1) % 3; updateHintBtn(); paintCurWords(); };
function updateKeep() { $("keepBtn").classList.toggle("on", keepOn); $("keepBtn").setAttribute("aria-pressed", keepOn); }
$("keepBtn").onclick = () => { keepOn = !keepOn; ls.set(K.keep, keepOn); updateKeep(); setMicUI(listening); toast(keepOn ? t("keepOnToast") : t("keepOffToast")); };
function updateAuto() { $("autoBtn").classList.toggle("on", autoNext); }
$("autoBtn").onclick = () => { autoNext = !autoNext; ls.set(K.auto, autoNext); updateAuto(); };
$("doneBtn").onclick = () => { unlockAudio(); if (listening) sentenceDone(); };
document.addEventListener("keydown", e => {
  if (/TEXTAREA|INPUT/.test(e.target.tagName) || document.querySelector(".overlay.show,.modal.show")) return;
  if (view === "sx" || view === "st") return;                     // 문장만들기 has its own keys (sx.js)
  if (e.key === "Escape") { setPrompt(false); if (view === "play") $("backBtn").click(); else if (view === "info") goLibrary(); return; }
  if (view !== "play") return;
  if (e.code === "Space") { e.preventDefault(); micEl.click(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); select(idx + 1); }
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(idx - 1); }
  else if (e.key === "h" || e.key === "H") $("hintBtn").click();
  else if (e.key === "Enter") $("doneBtn").click();
  else if (e.key === "l" || e.key === "L") speak(0.95);
});
window.addEventListener("resize", () => { if (view === "play") centerCurrent(false); });

/* ================= FINISH SCREEN: score, confetti, fanfare, a perseverance quote ================= */
function showFinish() {
  const done = Object.values(attempts), n = lines.length;
  const avg = done.length ? Math.round(done.reduce((a, x) => a + x.score, 0) / done.length) : 0;
  const perfect = done.filter(x => x.score === 100).length, secs = Math.round((Date.now() - sessionStart) / 1000);
  $("finDlg").textContent = dlg.title;
  $("finScore").textContent = avg + "%";
  $("finStats").innerHTML = [[t("finPerfect"), `${perfect}/${n}`], [t("finSpoken"), `${done.length}/${n}`], [t("finTime"), t("minSec", Math.floor(secs / 60), secs % 60)]]
    .map(([l, v]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  $("finQuote").innerHTML = `<p class="q-en">“${esc(q.en)}”</p>` + (lang() === "ko" ? `<p class="q-ko">${esc(q.ko)}</p><cite>— ${esc(q.by)} (${esc(q.byKo)})</cite>` : `<cite>— ${esc(q.by)}</cite>`);
  $("finish").classList.add("show");
  fanfare(); confettiOn($("confetti"));
}
$("finDone").onclick = () => { $("finish").classList.remove("show"); confettiOff($("confetti")); goLibrary(); };

/* ================= SETTINGS: app language (system / 한국어 / English) ================= */
function paintLangSeg() { const c = langChoice(); document.querySelectorAll("#langSeg [data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === c)); }
function applyLang() {
  setLang(resolveLang()); applyStatic();
  $("promptText").textContent = promptText(); $("verText").textContent = `Speak Up v${VERSION}`;
  updateHintBtn(); setMicUI(listening);
  sxApplyLang();
  if (view === "lib") renderLib(); else if (view === "info") renderInfo(); else if (view === "play") { renderAll(); requestAnimationFrame(() => centerCurrent(false)); }
}
$("settingsBtn").onclick = () => { paintLangSeg(); $("setOverlay").classList.add("show"); };
$("setClose").onclick = () => $("setOverlay").classList.remove("show");
$("setOverlay").addEventListener("click", e => { if (e.target.id === "setOverlay") $("setOverlay").classList.remove("show"); });
$("langSeg").addEventListener("click", e => { const b = e.target.closest("[data-lang]"); if (!b) return; setLangChoice(b.dataset.lang); paintLangSeg(); applyLang(); });

// No zoom: iOS Safari ignores user-scalable=no for pinch, so block its gesture events (text selection is unaffected).
["gesturestart", "gesturechange", "gestureend"].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.scale && e.scale !== 1) e.preventDefault(); }, { passive: false });

initSx({ showView, view: () => view, toast, ask, renderLib });
applyLang(); updateAuto(); updateKeep();
