// 문장만들기 storage.
// The tree (trainings → parts → chapters) is small and lives in localStorage ("speakup.sx.v1").
// Each chapter's JSON file is stored as-is in IndexedDB (db "speakup", store "files", key = chapter id),
// so big books don't fill localStorage's ~5 MB. Falls back to localStorage when IndexedDB isn't available.
const DB = "speakup", STORE = "files", LS = id => "speakup.sxfile." + id;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
  const t = d.transaction(STORE, mode), s = t.objectStore(STORE), q = fn(s);
  t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
}));

export async function putFile(id, text) {
  try { await tx("readwrite", s => s.put(text, id)); }
  catch (e) { localStorage.setItem(LS(id), text); }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}   // ask the browser not to evict
}
export async function getFile(id) {
  try { const v = await tx("readonly", s => s.get(id)); if (v != null) return v; } catch (e) {}
  return localStorage.getItem(LS(id));
}
export async function delFile(id) {
  try { await tx("readwrite", s => s.delete(id)); } catch (e) {}
  try { localStorage.removeItem(LS(id)); } catch (e) {}
}
