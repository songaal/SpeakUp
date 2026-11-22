// Speak Up — tiny router (v3.25): every screen has its own address and the browser's back button works.
// Paths (hash routes inside a claude.ai artifact, where the page path can't change):
//   /dlg  /sx                     library tab
//   /dlg/<id>  /dlg/<id>/play      dialogue info / player
//   /sx/<training>[/<chapter>[/<item>[/test]]]
//   /settings
// history.state.d = depth inside the app, so back() can tell "previous screen of ours" from "left the site".
const hashMode = !!(window.claude && typeof window.claude.use === "function") || location.protocol === "file:";
let handler = null, depth = (history.state && history.state.d) || 0;
const clean = p => "/" + String(p || "").replace(/^[#/]+/, "").replace(/\/+$/, "");
export const current = () => clean(hashMode ? location.hash.slice(1) : location.pathname);
const url = p => hashMode ? "#" + p : p;
export function onRoute(fn) { handler = fn; }
export function dispatch() { if (handler) handler(current().split("/").filter(Boolean).map(decodeURIComponent)); }
// go(path): push a new screen. replace: swap the current entry (tabs, redirects). silent: only change the address.
export function go(path, { replace = false, silent = false } = {}) {
  path = clean(path);
  if (path === current() && !replace) { if (!silent) dispatch(); return; }
  if (replace) history.replaceState({ d: depth }, "", url(path));
  else { depth++; history.pushState({ d: depth }, "", url(path)); }
  if (!silent) dispatch();
}
// back(fallback): the previous screen of ours if there is one, otherwise replace with the fallback (deep link).
export function back(fallback = "/") {
  if (depth > 0) history.back();
  else go(fallback, { replace: true });
}
window.addEventListener("popstate", e => { depth = (e.state && e.state.d) || 0; dispatch(); });
if (!history.state) history.replaceState({ d: 0 }, "", location.href);
