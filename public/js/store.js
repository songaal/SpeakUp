// Speak Up — storage + account + server sync (v3.22).
// Guest: data stays under the plain localStorage keys (same as before v3.22).
// Signed in: the synced keys live under "speakup.u.<userId>." + key (a local cache), every set() is pushed to the
// server (debounced; pending keys survive reloads/offline), and boot() pulls the server copy before the app starts.
// Device settings (language, mic keep, input mode, tab…) are never synced and are not namespaced.
export const SYNC_KEYS = [
  "speakup.lib.v3", "speakup.best.v3", "speakup.pos.v3", "speakup.count.v3", "speakup.last.v3",
  "speakup.sx.v1", "speakup.sxbest.v1", "speakup.sxsess.v1",
];
const SYNCED = new Set(SYNC_KEYS);
const ACCT = "speakup.acct.v1";            // cached {id, email, name, picture} of the signed-in user (for offline starts)
const GUEST_OK = "speakup.guest.v1";       // "1" once the guest screen was passed in this tab (sessionStorage)

let acct = null;
export const account = () => acct;
const pfx = () => acct ? `speakup.u.${acct.id}.` : "";
const nsKey = k => SYNCED.has(k) ? pfx() + k : k;
const rawGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const rawSet = (k, v) => { localStorage.setItem(k, v); };

/* ---------------- pending pushes ---------------- */
const pendKey = () => pfx() + "pending";
const pendGet = () => { try { return JSON.parse(rawGet(pendKey()) || "[]"); } catch (e) { return []; } };
const pendSet = a => { try { rawSet(pendKey(), JSON.stringify(a)); } catch (e) {} };
let pushT = null, pushing = null, syncListeners = new Set(), syncState = "ok";
export const onSync = fn => { syncListeners.add(fn); fn(syncState); };
const setState = s => { syncState = s; syncListeners.forEach(f => { try { f(s); } catch (e) {} }); };
export const syncStatus = () => syncState;

function queue(k) {
  const p = pendGet(); if (!p.includes(k)) { p.push(k); pendSet(p); }
  clearTimeout(pushT); pushT = setTimeout(flush, 800); setState("pending");
}
export async function flush() {
  if (!acct) return;
  if (pushing) { await pushing; }
  const keys = pendGet(); if (!keys.length) { setState("ok"); return; }
  const body = {}; keys.forEach(k => { const v = rawGet(pfx() + k); if (v != null) body[k] = v; });
  pushing = fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ keys: body }) })
    .then(r => {
      if (r.status === 401) { setState("auth"); return; }
      if (!r.ok) throw new Error(r.status);
      const left = pendGet().filter(k => !keys.includes(k) || rawGet(pfx() + k) !== body[k]);   // changed again meanwhile → keep
      pendSet(left); setState(left.length ? "pending" : "ok");
      if (left.length) { clearTimeout(pushT); pushT = setTimeout(flush, 800); }
    })
    .catch(() => { setState("offline"); clearTimeout(pushT); pushT = setTimeout(flush, 15000); })
    .finally(() => { pushing = null; });
  return pushing;
}
addEventListener("online", () => flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

/* ---------------- key/value API used by app.js and sx.js ---------------- */
export const ls = {
  get(k, d) { try { const v = localStorage.getItem(nsKey(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  // throws on quota errors so callers can warn
  set(k, v) { localStorage.setItem(nsKey(k), JSON.stringify(v)); if (acct && SYNCED.has(k)) queue(k); },
};

/* ---------------- chapter files on the server ---------------- */
const pendFKey = () => pfx() + "pendingFiles";
const pendF = () => { try { return JSON.parse(rawGet(pendFKey()) || "{}"); } catch (e) { return {}; } };   // id → "put" | "del"
const pendFSet = o => { try { rawSet(pendFKey(), JSON.stringify(o)); } catch (e) {} };
export async function remotePutFile(id, text) {
  if (!acct) return;
  try { const r = await fetch("/api/file/" + id, { method: "PUT", credentials: "same-origin", body: text }); if (!r.ok) throw 0; const p = pendF(); delete p[id]; pendFSet(p); }
  catch (e) { const p = pendF(); p[id] = "put"; pendFSet(p); }
}
export async function remoteDelFile(id) {
  if (!acct) return;
  try { const r = await fetch("/api/file/" + id, { method: "DELETE", credentials: "same-origin" }); if (!r.ok) throw 0; const p = pendF(); delete p[id]; pendFSet(p); }
  catch (e) { const p = pendF(); p[id] = "del"; pendFSet(p); }
}
// own file first, then a shared one
export async function remoteGetFile(id) {
  if (!acct) return null;
  for (const u of ["/api/file/" + id, "/api/shared/file/" + id]) {
    try { const r = await fetch(u, { credentials: "same-origin" }); if (r.ok) return await r.text(); } catch (e) { return null; }
  }
  return null;
}
async function flushFiles(getLocal) {
  const p = pendF();
  for (const [id, op] of Object.entries(p)) {
    if (op === "del") await remoteDelFile(id);
    else { const text = await getLocal(id); if (text != null) await remotePutFile(id, text); else { delete p[id]; pendFSet(p); } }
  }
}

/* ---------------- shared content (others' items, read-only) ---------------- */
let shared = { dialogs: [], trainings: [] };
export const sharedContent = () => shared;
const sharedKey = () => pfx() + "sharedCache";
async function loadShared() {
  try { shared = JSON.parse(rawGet(sharedKey()) || "null") || shared; } catch (e) {}
  try {
    const r = await fetch("/api/shared", { credentials: "same-origin" });
    if (r.ok) { shared = await r.json(); try { rawSet(sharedKey(), JSON.stringify(shared)); } catch (e) {} }
  } catch (e) {}
}
export async function refreshShared() { if (acct) await loadShared(); return shared; }

/* ---------------- auth ---------------- */
async function api(path, opts = {}, ms = 8000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(path, { credentials: "same-origin", ...opts, signal: ctl.signal }); } finally { clearTimeout(to); }
}
export async function config() { try { const r = await api("/api/config"); return r.ok ? await r.json() : {}; } catch (e) { return {}; } }
export async function loginWithGoogle(credential) {
  const r = await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential }) }, 15000);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return (await r.json()).user;
}
export async function devLogin(email) {
  const r = await api("/api/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error(r.status); return (await r.json()).user;
}
export async function logout() {
  try { await flush(); } catch (e) {}
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
  try { localStorage.removeItem(ACCT); sessionStorage.removeItem(GUEST_OK); } catch (e) {}
  location.reload();
}
export const guestChosen = () => { try { return sessionStorage.getItem(GUEST_OK) === "1"; } catch (e) { return false; } };
export const chooseGuest = () => { try { sessionStorage.setItem(GUEST_OK, "1"); } catch (e) {} };

// Copy this browser's guest data into a new account (first sign-in, account empty on the server).
async function migrateGuest(getLocal) {
  const keys = {};
  for (const k of SYNC_KEYS) { const v = rawGet(k); if (v != null) { keys[k] = v; rawSet(pfx() + k, v); } }
  if (!Object.keys(keys).length) return;
  pendSet(Object.keys(keys)); await flush();
  try {   // chapter files referenced by the guest tree
    const sx = JSON.parse(keys["speakup.sx.v1"] || "null");
    for (const tr of (sx && sx.trainings) || []) for (const p of tr.parts || []) for (const c of p.chapters || []) {
      const text = await getLocal(c.id); if (text != null) await remotePutFile(c.id, text);
    }
  } catch (e) {}
}

// Decide who is using the app. Returns {user} (signed in), {guest:true}, or {needLogin:true}.
// getLocal(id) reads a chapter file from IndexedDB (passed in to avoid an import cycle with sxstore.js).
export async function boot(getLocal) {
  let cached = null; try { cached = JSON.parse(rawGet(ACCT) || "null"); } catch (e) {}
  let user = null, offline = false;
  try {
    const r = await api("/api/me");
    if (r.ok) user = (await r.json()).user;
    else if (r.status >= 500 || r.status === 404) offline = true;   // API not deployed / broken → behave like offline
  } catch (e) { offline = true; }
  if (!user && offline && cached) user = cached;
  if (!user) { try { localStorage.removeItem(ACCT); } catch (e) {} return guestChosen() ? { guest: true } : { needLogin: true }; }
  acct = { id: user.id, email: user.email, name: user.name, picture: user.picture };
  try { rawSet(ACCT, JSON.stringify(acct)); } catch (e) {}
  if (!offline) {
    await flush();                                     // local edits made offline go up first
    await flushFiles(getLocal);
    try {
      const r = await api("/api/data", {}, 15000);
      if (r.ok) {
        const d = await r.json(), have = Object.keys(d.keys || {});
        if (!have.length && !d.files && !rawGet(pfx() + "migrated")) { await migrateGuest(getLocal); }
        else { const pend = new Set(pendGet()); for (const k of have) if (!pend.has(k)) rawSet(pfx() + k, d.keys[k].v); }
        rawSet(pfx() + "migrated", "1");
      }
    } catch (e) {}
    await loadShared();
  } else {
    try { shared = JSON.parse(rawGet(sharedKey()) || "null") || shared; } catch (e) {}
  }
  return { user: acct, offline };
}
