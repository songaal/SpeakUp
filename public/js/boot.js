// Speak Up — entry (v3.22). Works out who is using the app before app.js reads any storage:
// signed in → pull the server copy into the per-account cache; not signed in → the login screen
// (Google button + small "로그인 없이 사용하기" with the guest limitations). Then app.js is loaded.
import { boot, config, loginWithGoogle, devLogin, chooseGuest } from "./store.js";
import { getLocalFile } from "./sxstore.js";
import { t, setLang, resolveLang, applyStatic } from "./i18n.js";
const V = "3.25.0";
const $ = id => document.getElementById(id);
const startApp = () => import(`./app.js?v=${V}`);

function loadGis() {
  return new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.id) return res();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("gis"));
    document.head.appendChild(s);
  });
}
function authErr(m) { const e = $("authErr"); e.textContent = m; e.classList.toggle("show", !!m); }

async function showLogin() {
  setLang(resolveLang()); applyStatic($("authView"));
  document.body.classList.add("v-auth"); $("authView").classList.add("on");
  $("authGuest").onclick = () => { $("authGuestBox").classList.toggle("open"); };
  $("authGuestGo").onclick = () => { chooseGuest(); $("authView").classList.remove("on"); document.body.classList.remove("v-auth"); startApp(); };
  const cfg = await config();
  if (cfg.devLogin) {   // local `wrangler dev` only
    $("authDev").style.display = "";
    $("authDevGo").onclick = async () => { try { await devLogin($("authDevEmail").value); location.reload(); } catch (e) { authErr(String(e.message || e)); } };
  }
  if (!cfg.clientId || /REPLACE_WITH/.test(cfg.clientId)) { authErr(t("authNotReady")); return; }
  try { await loadGis(); } catch (e) { authErr(t("authGisFail")); return; }
  google.accounts.id.initialize({
    client_id: cfg.clientId, ux_mode: "popup", auto_select: false, use_fedcm_for_prompt: true,
    callback: async r => {
      authErr(""); $("authBusy").classList.add("show");
      try { await loginWithGoogle(r.credential); location.reload(); }
      catch (e) { $("authBusy").classList.remove("show"); authErr(t("authFail")); }
    },
  });
  const w = Math.min(320, $("authBtn").clientWidth || 300);
  google.accounts.id.renderButton($("authBtn"), { type: "standard", theme: "outline", size: "large", shape: "pill", text: "continue_with", width: w, locale: resolveLang() });
}

(async () => {
  if (window.claude && typeof window.claude.use === "function") { startApp(); return; }   // claude.ai artifact preview: no server, guest only
  let who;
  try { who = await boot(getLocalFile); } catch (e) { who = { needLogin: true }; }
  if (who.needLogin) { showLogin(); return; }
  startApp();
})();
