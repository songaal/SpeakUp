// Speak Up — UI. Views: library → info → player. All data lives in localStorage (see store below).
import { parseMd, toMd, libraryToMd, libraryToJson, parseJsonImport, tokenize, align, foldToWords, heardTokens, scoreAttempt, dialogStats } from "./core.js";
import { SAMPLE_MD, CONVERT_PROMPT } from "./content.js";

/* ================= store (localStorage) ================= */
const K = { lib: "speakup.lib.v3", best: "speakup.best.v3", pos: "speakup.pos.v3", auto: "speakup.auto.v3", pause: "speakup.pause.v3" };
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
let best = ls.get(K.best, {});                 // "dialogId|english sentence" → best score (survives line reordering/edits)
let posMap = ls.get(K.pos, {});                // dialogId → last sentence index
let autoNext = ls.get(K.auto, true);
const PAUSES = [2000, 4000, 7000, 0];          // 0 = manual stop only
let pauseMs = ls.get(K.pause, 4000);
const saveLib = () => ls.set(K.lib, lib);
const bestOf = (d, l) => best[d.id + "|" + l.en];
const doneCount = d => d.lines.filter(l => bestOf(d, l) === 100).length;

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
function ask(text, yes = "삭제") {
  return new Promise(res => {
    $("mText").textContent = text; $("mYes").textContent = yes; $("modal").classList.add("show");
    const done = v => { $("modal").classList.remove("show"); $("mYes").onclick = $("mNo").onclick = null; res(v); };
    $("mYes").onclick = () => done(true); $("mNo").onclick = () => done(false);
  });
}
let view = "lib";
function showView(v) {
  view = v;
  ["lib", "info", "play"].forEach(n => $(n + "View").classList.toggle("on", n === v));
  document.body.className = "v-" + v;
}
let dlg = null;   // the dialogue open in info/player

/* ================= LIBRARY ================= */
let editing = false; const selected = new Set();
function renderLib() {
  showStoreWarn();
  $("libView").classList.toggle("editing", editing);
  $("editModeBtn").textContent = editing ? "완료" : "✎ 편집"; $("editModeBtn").classList.toggle("on", editing);
  const el = $("dlist");
  if (!lib.length) {
    el.innerHTML = `<div class="empty">아직 대화가 없어요.<br><button class="btn pri" id="addSample">샘플 대화 추가</button></div>`;
    $("addSample").onclick = () => addDialogs(parseMd(SAMPLE_MD));
  } else {
    el.innerHTML = lib.map((d, i) => {
      const n = d.lines.length, done = doneCount(d), sel = selected.has(d.id);
      return `<div class="dcard ${sel ? "sel" : ""}" data-id="${d.id}">
        <span class="chk">${sel ? "✓" : ""}</span>
        <div class="dmain"><div class="dt">${esc(d.title)}</div>
          <div class="dm">${n}문장 · 완벽 ${done}/${n}</div>
          <div class="pb"><i style="width:${n ? done / n * 100 : 0}%"></i></div></div>
        <div class="mv"><button data-mv="-1" ${i === 0 ? "disabled" : ""} aria-label="위로">▲</button><button data-mv="1" ${i === lib.length - 1 ? "disabled" : ""} aria-label="아래로">▼</button></div>
        <span class="chev">›</span></div>`;
    }).join("");
  }
  $("delSelBtn").disabled = !selected.size;
  $("delSelBtn").textContent = selected.size ? `${selected.size}개 삭제` : "삭제";
  $("selAllBtn").textContent = selected.size === lib.length && lib.length ? "선택 해제" : "전체 선택";
}
$("dlist").addEventListener("click", e => {
  const c = e.target.closest(".dcard"); if (!c) return;
  const id = c.dataset.id, mv = e.target.closest("[data-mv]");
  if (mv) {                                                       // reorder (edit mode)
    const i = lib.findIndex(d => d.id === id), j = i + +mv.dataset.mv;
    if (j < 0 || j >= lib.length) return;
    [lib[i], lib[j]] = [lib[j], lib[i]]; saveLib(); renderLib(); return;
  }
  if (editing) { selected.has(id) ? selected.delete(id) : selected.add(id); renderLib(); }
  else openInfo(id);
});
$("editModeBtn").onclick = () => { editing = !editing; selected.clear(); renderLib(); };
$("selAllBtn").onclick = () => { if (selected.size === lib.length) selected.clear(); else lib.forEach(d => selected.add(d.id)); renderLib(); };
$("delSelBtn").onclick = async () => {
  if (!selected.size) return;
  if (!await ask(`대화 ${selected.size}개를 삭제할까요? 되돌릴 수 없어요.`)) return;
  const n = selected.size;
  lib = lib.filter(d => !selected.has(d.id)); selected.forEach(id => delete posMap[id]); selected.clear();
  saveLib(); ls.set(K.pos, posMap); editing = false; renderLib(); toast(`${n}개 삭제했어요`);
};
function addDialogs(ds) { const t = Date.now(); ds.forEach((d, i) => lib.push(newDialog(d, t + i))); saveLib(); renderLib(); }

/* ---- prompt popover: opens + copies on click, closes on outside click / blur / Esc ---- */
$("promptText").textContent = CONVERT_PROMPT;
async function copyPrompt() {
  try { await navigator.clipboard.writeText(CONVERT_PROMPT); $("promptState").textContent = "복사됨 ✓"; toast("프롬프트를 복사했어요"); }
  catch (e) { $("promptState").textContent = "직접 복사해 주세요"; const r = document.createRange(); r.selectNodeContents($("promptText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
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
  $("edTitle").textContent = mode === "add" ? "새 대화 추가" : "대화 수정";
  $("edDelete").style.display = mode === "edit" ? "" : "none";
  $("editor").value = mode === "edit" ? toMd(dlg) : "";
  $("edErr").className = "ferr";
  $("edOverlay").classList.add("show");
  setTimeout(() => $("editor").focus(), 50);
}
const closeEditor = () => $("edOverlay").classList.remove("show");
$("addBtn").onclick = () => openEditor("add");
$("infoEdit").onclick = () => openEditor("edit");
$("editDlgBtn").onclick = () => { if (listening) stopListening(true); openEditor("edit"); };
$("edCancel").onclick = closeEditor;
$("edSave").onclick = () => {
  const ds = parseMd($("editor").value);
  if (!ds.length) { $("edErr").textContent = "영어 문장을 하나도 찾지 못했어요. 형식을 확인해 주세요."; $("edErr").className = "ferr show"; return; }
  if (edMode === "add") { addDialogs(ds); closeEditor(); toast(ds.length > 1 ? `대화 ${ds.length}개를 추가했어요` : `"${ds[0].title}" 추가했어요`); return; }
  const [first, ...rest] = ds;                                   // edit: first replaces this dialogue, extras are inserted after it
  dlg.title = first.title; dlg.lines = first.lines; dlg.updated = Date.now();
  if (rest.length) { const at = lib.indexOf(dlg), t = Date.now(); lib.splice(at + 1, 0, ...rest.map((d, i) => newDialog(d, t + i))); }
  saveLib(); closeEditor();
  if (view === "play") openPlayer(Math.min(idx, dlg.lines.length - 1)); else renderInfo();
  toast(rest.length ? `수정했고, 대화 ${rest.length}개를 새로 추가했어요` : "수정했어요");
};
$("edDelete").onclick = async () => {
  if (!await ask(`"${dlg.title}" 대화를 삭제할까요?`)) return;
  lib = lib.filter(d => d !== dlg); delete posMap[dlg.id]; saveLib(); ls.set(K.pos, posMap);
  closeEditor(); goLibrary(); toast("삭제했어요");
};

/* ---- import (.md / .json, appended) ---- */
$("importBtn").onclick = () => $("fileIn").click();
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
  if (added.length) { addDialogs(added); toast(`대화 ${added.length}개를 추가했어요` + (bad ? ` (실패 ${bad})` : "")); }
  else toast("가져올 대화를 찾지 못했어요");
};

/* ---- export (all dialogues in one .md joined by ---, or .json) ---- */
let exFmt = "md", downloads = null;   // downloads: Claude-artifact capability, null elsewhere
const inArtifact = !!(window.claude && typeof window.claude.use === "function");
function fillExport() {
  $("exMd").classList.toggle("on", exFmt === "md"); $("exJson").classList.toggle("on", exFmt === "json");
  $("exText").value = exFmt === "md" ? libraryToMd(lib) : libraryToJson(lib);
  $("exInfo").textContent = `대화 ${lib.length}개 · ${lib.reduce((a, d) => a + d.lines.length, 0)}문장`;
  $("exDown").style.display = (!inArtifact || downloads) ? "" : "none";
}
$("exportBtn").onclick = () => { if (!lib.length) { toast("내보낼 대화가 없어요"); return; } fillExport(); $("exOverlay").classList.add("show"); };
$("exMd").onclick = () => { exFmt = "md"; fillExport(); };
$("exJson").onclick = () => { exFmt = "json"; fillExport(); };
$("exClose").onclick = () => $("exOverlay").classList.remove("show");
$("exCopy").onclick = async () => {
  try { await navigator.clipboard.writeText($("exText").value); toast("복사했어요"); }
  catch (e) { $("exText").select(); toast("선택됐어요. 직접 복사해 주세요"); }
};
$("exDown").onclick = async () => {
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const filename = `speak-up-${stamp}.${exFmt}`, data = $("exText").value;
  if (downloads) { try { await downloads.save({ filename, data }); toast("저장했어요"); } catch (e) { toast("저장이 취소됐어요"); } return; }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: exFmt === "md" ? "text/markdown" : "application/json" })); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ================= INFO ================= */
function openInfo(id) { dlg = lib.find(d => d.id === id); if (!dlg) return; spkColor = {}; showView("info"); renderInfo(); $("infoView").querySelector(".infoscroll").scrollTop = 0; }
function renderInfo() {
  const s = dialogStats(dlg), done = doneCount(dlg), n = s.sentences, at = Math.min(posMap[dlg.id] || 0, n - 1);
  $("infoBody").innerHTML = `
    <div class="ititle">${esc(dlg.title)}</div>
    <div class="stats">
      <div class="stat"><b>${n}</b><span>문장</span></div>
      <div class="stat"><b>${s.words}</b><span>단어</span></div>
      <div class="stat"><b>${s.unique}</b><span>고유 단어</span></div>
      <div class="stat"><b>${s.avg}</b><span>평균 길이</span></div>
    </div>
    <div class="iprog">완벽하게 말한 문장 ${done}/${n}<div class="pb"><i style="width:${n ? done / n * 100 : 0}%"></i></div></div>
    ${s.speakers.length ? `<div class="spks">${s.speakers.map(spkChip).join("")}</div>` : ""}
    <ul class="tl">${dlg.lines.map((l, i) => { const b = bestOf(dlg, l);
      return `<li><span class="no">${i + 1}</span><div class="tx"><div class="te">${spkChip(l.spk)}${esc(l.en)}</div><div class="tk">${esc(l.ko || "")}</div></div><span class="bs ${b === 100 ? "p" : ""}">${b != null ? b + "%" : ""}</span></li>`; }).join("")}</ul>`;
  $("infoBtns").innerHTML = at > 0
    ? `<button class="btn sec" id="startTop">처음부터</button><button class="btn pri" id="startResume">▶ ${at + 1}번째부터 이어서</button>`
    : `<button class="btn pri" id="startTop">▶ 시작</button>`;
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

function openPlayer(at) {
  lines = dlg.lines; attempts = {}; refCache = {}; liveSt = null; hintLv = 0;
  idx = Math.max(0, Math.min(lines.length - 1, at));
  posMap[dlg.id] = idx; ls.set(K.pos, posMap);
  $("ptitle").textContent = dlg.title;
  showView("play"); updateHintBtn(); resEl.className = "result"; errEl.className = "err";
  renderAll(); requestAnimationFrame(() => centerCurrent(false));
}
$("backBtn").onclick = () => { if (listening) stopListening(true); clearTimeout(autoTimer); try { speechSynthesis.cancel(); } catch (e) {} showView("info"); renderInfo(); };

// A word is visible if: not the current line, said correctly (live or scored), hint level 2, or the line was 100%.
function wordView(i, k) {
  const att = attempts[i], cur = i === idx;
  let st = att ? att.st[k] : "";
  if (cur && !att && liveSt && liveSt[k] === "live") st = "live";
  const shown = !cur || st === "ok" || st === "live" || hintLv === 2 || (att && att.score === 100);
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
      <div class="heard" id="heard">${att ? att.heardHTML : `<span class="ph">한글 직역을 보고 영어로 말해 보세요.</span>`}</div>`;
  else if (i < idx) en = `<div class="en">${wordsHTML(i)}</div>`;      // past lines reveal the English; future lines show Korean only
  const bdg = cur ? badge(bestOf(dlg, L)) : (i < idx && att ? badge(att.score) : "");
  return `<div class="ln ${cur ? "cur" : ""}${Math.abs(i - idx) === 1 ? " near" : ""}" data-i="${i}">${spkChip(L.spk)}${bdg}<div class="ko">${esc(L.ko || "(번역 없음)")}</div>${en}</div>`;
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
  if (listening) stopListening(true);
  clearTimeout(autoTimer);
  const old = idx; idx = i; hintLv = 0; liveSt = null; updateHintBtn();
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
function updateHintBtn() { const b = $("hintBtn"); b.textContent = ["💡 힌트", "💡 첫 글자", "👀 정답"][hintLv]; b.classList.toggle("on", hintLv > 0); }

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
function showLive() {
  const heard = $("heard"); if (!heard) return;
  const full = (finalText + " " + interimText).trim();
  if (!full) { heard.innerHTML = `<span class="label">LISTENING…</span><span class="ph">듣고 있어요…</span>`; return; }
  const ref = refOf(idx), a = align(ref.toks.map(t => t.t), heardTokens(ref, full).toks.map(t => t.t), true);
  liveSt = foldToWords(ref, a.refSt, null, true).st; paintCurWords();
  heard.innerHTML = `<span class="label">LISTENING…</span>${esc(finalText)} <span class="interim">${esc(interimText)}</span>`;
  if (a.refSt.every(s => s === "ok")) stopListening();          // everything said → finish right away
}
function evaluate() {
  const said = (finalText + " " + interimText).trim(); liveSt = null;
  if (!said) { paintCurWords(); const h = $("heard"); if (h) h.innerHTML = `<span class="ph">아무 말도 인식되지 않았어요. 다시 해 볼까요?</span>`; return; }
  const r = scoreAttempt(lines[idx].en, said);
  const heardHTML = `<span class="label">YOU SAID</span>` + r.heard.map(h => `<span class="h ${h.st}">${esc(h.w)}</span>`).join(" ");
  attempts[idx] = { st: r.st, said: r.said, score: r.score, heardHTML };
  const key = dlg.id + "|" + lines[idx].en; if (best[key] == null || r.score > best[key]) { best[key] = r.score; ls.set(K.best, best); }
  rerenderLine(idx);
  const [cls, title] = r.score === 100 ? ["good", "Perfect! 🎉"] : r.score >= 80 ? ["good", "Great!"] : r.score >= 50 ? ["mid", "Good try!"] : ["low", "One more time!"];
  const parts = [`${r.ok}/${r.total} 일치`]; if (r.bad) parts.push(`틀림 ${r.bad}`); if (r.miss) parts.push(`빠짐 ${r.miss}`); if (r.extra) parts.push(`추가 ${r.extra}`);
  $("score").textContent = r.score + "%"; $("msgT").textContent = title; $("msgS").textContent = parts.join(" · ");
  resEl.className = "result show " + cls;
  clearTimeout(autoTimer);
  if (autoNext && r.score === 100 && idx < lines.length - 1) { const at = idx; autoTimer = setTimeout(() => { if (view === "play" && idx === at && !listening) select(idx + 1); }, 1400); }
}
function setMicUI(on) { micEl.classList.toggle("rec", on); $("hint").textContent = on ? (pauseMs ? "말하는 중… 탭하면 끝" : "말하는 중… 다 말하면 탭") : "탭해서 말하기"; }
function showErr(m) { errEl.textContent = m; errEl.className = "err show"; }
function finish() {
  if (finished) return; finished = true; listening = false; clearTimeout(silenceTimer); setMicUI(false);
  if (abandon) { abandon = false; liveSt = null; return; }
  evaluate();
}
function nudge(m) { toast(m); micEl.classList.remove("blip"); void micEl.offsetWidth; micEl.classList.add("blip"); try { navigator.vibrate && navigator.vibrate(40); } catch (e) {} }

/* ---- speech engines ----
 * Inside a Claude artifact the page can't open the mic, so it uses the `dictation` capability (window.claude.use).
 * Everywhere else (kappy.app, localhost) it uses the browser Web Speech API with lang en-US.
 * Chrome ends a session by itself after a long silence: onend restarts it and keeps what was heard (baseText). */
let engine = null, dictation = null, rec = null, silenceTimer = null, stopRequested = false, baseText = "";
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function armSilence() { clearTimeout(silenceTimer); if (pauseMs && (finalText + interimText).trim()) silenceTimer = setTimeout(() => stopListening(), pauseMs); }
function nativeStart() {
  rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3;
  const refSet = new Set(refOf(idx).toks.map(t => t.t));
  rec.onresult = e => {
    let fin = "", inter = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {     // pick the alternative that overlaps the answer most
        let ba = r[0].transcript, bh = -1;
        for (let k = 0; k < r.length; k++) { const hit = tokenize(r[k].transcript).toks.filter(t => refSet.has(t.t)).length; if (hit > bh) { bh = hit; ba = r[k].transcript; } }
        fin += ba + " ";
      } else inter += r[0].transcript;
    }
    finalText = (baseText + " " + fin).trim(); interimText = inter.trim(); showLive(); armSilence();
  };
  rec.onerror = e => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    stopRequested = true;
    if (e.error === "not-allowed" || e.error === "service-not-allowed") showErr("마이크 권한이 막혀 있어요. 주소창 왼쪽 아이콘에서 마이크를 허용해 주세요.");
    else if (e.error === "network") showErr("음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
    else showErr("음성 인식 오류: " + e.error);
  };
  rec.onend = () => {
    if (listening && !stopRequested && !finished) {
      baseText = (finalText + " " + interimText).trim(); finalText = baseText; interimText = "";
      try { nativeStart(); nudge("🔄 인식이 잠깐 끊겨서 다시 듣는 중이에요"); return; } catch (e) {}
    }
    finish();
  };
  rec.start();
}
function startListening() {
  clearTimeout(autoTimer); errEl.className = "err"; resEl.className = "result";
  if (attempts[idx]) { delete attempts[idx]; rerenderLine(idx); }
  finalText = ""; interimText = ""; baseText = ""; liveSt = null; finished = false; listening = true; abandon = false; stopRequested = false;
  try { speechSynthesis.cancel(); } catch (e) {}
  setMicUI(true); showLive();
  if (engine === "dictation") {
    dictation.start().catch(err => {    // must be called synchronously from the click
      const r = String(err && (err.code || err.message) || err);
      showErr(/not_granted/.test(r) ? "마이크 사용이 허용되지 않았어요." : "받아쓰기를 시작하지 못했어요: " + r);
      finished = true; listening = false; setMicUI(false);
    });
  } else { try { nativeStart(); } catch (e) { showErr("음성 인식을 시작하지 못했어요."); finished = true; listening = false; setMicUI(false); } }
}
function stopListening(drop) {
  clearTimeout(silenceTimer); stopRequested = true; if (drop) abandon = true;
  if (engine === "dictation") dictation.stop().catch(() => {}).finally(() => finish());
  else if (rec) { try { drop ? rec.abort() : rec.stop(); } catch (e) { finish(); } }
  if (drop) finish();
}
function setEngine(n) {
  engine = n; $("engine").textContent = n === "dictation" ? "Claude 받아쓰기 사용 중" : n === "native" ? "브라우저 음성 인식 (en-US)" : "";
  if (!n) { micEl.disabled = true; showErr("이 브라우저는 음성 인식을 지원하지 않아요. Chrome·Edge·Safari에서 열어 주세요."); }
}
(async function initEngine() {
  if (inArtifact) {
    micEl.disabled = true; $("engine").textContent = "음성 인식 준비 중…";
    window.claude.use("downloads").then(d => { downloads = d; }).catch(() => {});
    let d = null; try { d = await window.claude.use("dictation"); } catch (e) {}
    micEl.disabled = false;
    if (d) {
      dictation = d;
      d.onPartial(({ text }) => { if (!listening) return; interimText = text || ""; showLive(); armSilence(); });
      d.onFinal(({ text }) => { if (!listening) return; finalText = (finalText + " " + (text || "")).trim(); interimText = ""; showLive(); armSilence(); });
      d.onState(({ state }) => { if (state === "idle" && !finished) finish(); });
      setEngine("dictation"); return;
    }
  }
  setEngine(SR ? "native" : null);
})();

/* ---- player controls ---- */
micEl.addEventListener("click", () => { if (!engine) return; listening ? stopListening() : startListening(); });
$("prev").onclick = () => select(idx - 1);
$("next").onclick = () => select(idx + 1);
$("play").onclick = () => speak(0.95);
$("playSlow").onclick = () => speak(0.65);
$("hintBtn").onclick = () => { hintLv = (hintLv + 1) % 3; updateHintBtn(); paintCurWords(); };
function updateAuto() { $("autoBtn").classList.toggle("on", autoNext); }
$("autoBtn").onclick = () => { autoNext = !autoNext; ls.set(K.auto, autoNext); updateAuto(); };
function updatePause() { $("pauseBtn").textContent = pauseMs ? `⏸ 쉼 ${pauseMs / 1000}초` : "⏸ 수동 종료"; $("pauseBtn").classList.toggle("on", !pauseMs); }
$("pauseBtn").onclick = () => { const k = PAUSES.indexOf(pauseMs); pauseMs = PAUSES[(k + 1) % PAUSES.length]; ls.set(K.pause, pauseMs); updatePause(); if (listening) { setMicUI(true); armSilence(); } };
document.addEventListener("keydown", e => {
  if (/TEXTAREA|INPUT/.test(e.target.tagName) || document.querySelector(".overlay.show,.modal.show")) return;
  if (e.key === "Escape") { setPrompt(false); if (view === "play") $("backBtn").click(); else if (view === "info") goLibrary(); return; }
  if (view !== "play") return;
  if (e.code === "Space") { e.preventDefault(); micEl.click(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); select(idx + 1); }
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); select(idx - 1); }
  else if (e.key === "h" || e.key === "H") $("hintBtn").click();
  else if (e.key === "l" || e.key === "L") speak(0.95);
});
window.addEventListener("resize", () => { if (view === "play") centerCurrent(false); });

updateHintBtn(); updateAuto(); updatePause(); renderLib();
