// Speak Up — API Worker (everything else is static assets from public/).
// Google sign-in (ID token from Google Identity Services, verified here) → opaque session cookie stored in D1.
// Per-user data = key/value blobs (the same localStorage keys the client uses) + chapter JSON files.
// Shared content = any user's own dialogues / trainings flagged `shared: true` (only the creator can flag them),
// readable by every signed-in user. Kept in the `shared` table, rebuilt whenever the owner pushes lib / sx.
//
// Env: DB (D1), ASSETS, GOOGLE_CLIENT_ID, DEV_LOGIN ("1" only for local `wrangler dev`).

const SYNC_KEYS = new Set([
  "speakup.lib.v3", "speakup.best.v3", "speakup.pos.v3", "speakup.count.v3", "speakup.last.v3",
  "speakup.sx.v1", "speakup.sxbest.v1", "speakup.sxsess.v1", "speakup.sxdone.v1", "speakup.sxact.v1",
]);
const SESSION_DAYS = 180;
const MAX_VALUE = 1_900_000;      // D1 string/blob limit is 2 MB per value
const COOKIE = "su_sid";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT, created INTEGER NOT NULL, last_login INTEGER)`,
  `CREATE INDEX IF NOT EXISTS users_email ON users(email)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (user_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, k))`,
  `CREATE TABLE IF NOT EXISTS files (user_id TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, id))`,
  // kind = "dlg" | "tr"; data = the dialogue / training object as JSON; chapter files stay in `files` under the owner
  `CREATE TABLE IF NOT EXISTS shared (owner_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (owner_id, kind, item_id))`,
  `CREATE TABLE IF NOT EXISTS shared_files (chapter_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL)`,
];
let schemaReady = null;
const ensureSchema = env => schemaReady || (schemaReady = env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { schemaReady = null; throw e; }));

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});
const err = (status, msg) => json({ error: msg }, status);
const lower = s => String(s || "").trim().toLowerCase();

/* ---------------- Google ID token verification (RS256, JWKS cached per isolate) ---------------- */
let jwks = null, jwksAt = 0;
async function googleKeys(force) {
  if (!force && jwks && Date.now() - jwksAt < 3600_000) return jwks;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("jwks " + r.status);
  jwks = (await r.json()).keys; jwksAt = Date.now(); return jwks;
}
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64uJson = s => JSON.parse(new TextDecoder().decode(b64u(s)));
async function verifyGoogle(token, clientId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const head = b64uJson(parts[0]), body = b64uJson(parts[1]);
  if (head.alg !== "RS256") throw new Error("alg");
  let jwk = (await googleKeys()).find(k => k.kid === head.kid);
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === head.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("signature");
  const now = Date.now() / 1000;
  if (body.aud !== clientId) throw new Error("aud");
  if (body.iss !== "accounts.google.com" && body.iss !== "https://accounts.google.com") throw new Error("iss");
  if (!(body.exp > now - 60)) throw new Error("expired");
  if (!body.sub || !body.email || body.email_verified === false || body.email_verified === "false") throw new Error("email");
  return body;
}

/* ---------------- sessions ---------------- */
function cookieOf(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
const newToken = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); };
function sessionCookie(req, token, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function currentUser(req, env) {
  const tok = cookieOf(req, COOKIE); if (!tok) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).bind(tok).first();
  if (!row || row.expires < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}
const publicUser = (env, u) => ({ id: u.id, email: u.email, name: u.name || "", picture: u.picture || "" });

async function startSession(req, env, profile) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created, last_login) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET email = ?2, name = ?3, picture = ?4, last_login = ?5`
  ).bind(profile.sub, profile.email, profile.name || "", profile.picture || "", now).run();
  const token = newToken(), maxAge = SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (token, user_id, created, expires) VALUES (?, ?, ?, ?)`).bind(token, profile.sub, now, now + maxAge * 1000),
    env.DB.prepare(`DELETE FROM sessions WHERE expires < ?`).bind(now),
  ]);
  const u = { id: profile.sub, email: profile.email, name: profile.name, picture: profile.picture };
  return json({ user: publicUser(env, u) }, 200, { "set-cookie": sessionCookie(req, token, maxAge) });
}

/* ---------------- shared content (each owner's flagged items) ---------------- */
// Rebuild this owner's rows from the lib / sx values just pushed (only the keys present in `vals`).
function sharedStmts(env, uid, vals, now) {
  const st = [];
  const lib = vals["speakup.lib.v3"], sx = vals["speakup.sx.v1"];
  if (lib !== undefined) {
    st.push(env.DB.prepare(`DELETE FROM shared WHERE owner_id = ? AND kind = 'dlg'`).bind(uid));
    for (const d of (Array.isArray(lib) ? lib : [])) if (d && d.shared && d.id)
      st.push(env.DB.prepare(`INSERT INTO shared (owner_id, kind, item_id, data, updated) VALUES (?, 'dlg', ?, ?, ?)`).bind(uid, String(d.id), JSON.stringify(d), now));
  }
  if (sx !== undefined) {
    st.push(env.DB.prepare(`DELETE FROM shared WHERE owner_id = ? AND kind = 'tr'`).bind(uid));
    st.push(env.DB.prepare(`DELETE FROM shared_files WHERE owner_id = ?`).bind(uid));
    for (const t of (sx && Array.isArray(sx.trainings) ? sx.trainings : [])) if (t && t.shared && t.id) {
      st.push(env.DB.prepare(`INSERT INTO shared (owner_id, kind, item_id, data, updated) VALUES (?, 'tr', ?, ?, ?)`).bind(uid, String(t.id), JSON.stringify(t), now));
      for (const p of (t.parts || [])) for (const c of (p.chapters || [])) if (c && c.id)
        st.push(env.DB.prepare(`INSERT OR REPLACE INTO shared_files (chapter_id, owner_id) VALUES (?, ?)`).bind(String(c.id), uid));
    }
  }
  return st;
}
async function sharedFor(env, uid) {
  const { results } = await env.DB.prepare(
    `SELECT s.kind, s.data, s.owner_id, u.name, u.email FROM shared s JOIN users u ON u.id = s.owner_id WHERE s.owner_id <> ? ORDER BY s.updated DESC`
  ).bind(uid).all();
  const out = { dialogs: [], trainings: [] };
  for (const r of results) {
    let o; try { o = JSON.parse(r.data); } catch (e) { continue; }
    o.owner = { id: r.owner_id, name: r.name || String(r.email || "").split("@")[0] };
    (r.kind === "dlg" ? out.dialogs : out.trainings).push(o);
  }
  return out;
}

/* ---------------- router ---------------- */
async function api(req, env, url) {
  const path = url.pathname, method = req.method;
  if (!env.DB) return err(500, "D1 binding DB is missing");
  await ensureSchema(env);

  if (path === "/api/config" && method === "GET")
    return json({ clientId: env.GOOGLE_CLIENT_ID || "", devLogin: env.DEV_LOGIN === "1" });

  if (path === "/api/login" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!env.GOOGLE_CLIENT_ID) return err(500, "GOOGLE_CLIENT_ID is not set");
    let p; try { p = await verifyGoogle(body.credential, env.GOOGLE_CLIENT_ID); } catch (e) { return err(401, "invalid token: " + e.message); }
    return startSession(req, env, p);
  }
  if (path === "/api/dev-login" && method === "POST") {      // local testing only (wrangler dev --var DEV_LOGIN:1)
    if (env.DEV_LOGIN !== "1") return err(404, "not found");
    const body = await req.json().catch(() => ({}));
    const email = lower(body.email) || "dev@example.com";
    return startSession(req, env, { sub: "dev-" + email, email, name: body.name || email.split("@")[0], picture: "" });
  }
  if (path === "/api/logout" && method === "POST") {
    const tok = cookieOf(req, COOKIE);
    if (tok) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(tok).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, "", 0) });
  }

  const user = await currentUser(req, env);
  if (!user) return err(401, "login required");

  if (path === "/api/me" && method === "GET") return json({ user: publicUser(env, user) });

  // all synced keys of this user
  if (path === "/api/data" && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT k, v, updated FROM kv WHERE user_id = ?`).bind(user.id).all();
    const files = await env.DB.prepare(`SELECT COUNT(*) AS n FROM files WHERE user_id = ?`).bind(user.id).first();
    const keys = {}; for (const r of results) keys[r.k] = { v: r.v, updated: r.updated };
    return json({ keys, files: files ? files.n : 0 });
  }
  // upsert some keys: {keys: {k: "<json string>"}}
  if (path === "/api/data" && method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.keys !== "object") return err(400, "keys required");
    const now = Date.now(), stmts = [], vals = {};
    for (const [k, v] of Object.entries(body.keys)) {
      if (!SYNC_KEYS.has(k)) return err(400, "unknown key " + k);
      if (typeof v !== "string" || v.length > MAX_VALUE) return err(413, "value too large: " + k);
      try { vals[k] = JSON.parse(v); } catch (e) { return err(400, "not json: " + k); }
      stmts.push(env.DB.prepare(`INSERT INTO kv (user_id, k, v, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, k) DO UPDATE SET v = ?3, updated = ?4`).bind(user.id, k, v, now));
    }
    stmts.push(...sharedStmts(env, user.id, vals, now));
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, updated: now });
  }

  // own chapter files
  const fm = path.match(/^\/api\/file\/([A-Za-z0-9_-]{1,64})$/);
  if (fm) {
    const id = fm[1];
    if (method === "GET") {
      const r = await env.DB.prepare(`SELECT text FROM files WHERE user_id = ? AND id = ?`).bind(user.id, id).first();
      return r ? new Response(r.text, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }) : err(404, "no file");
    }
    if (method === "PUT") {
      const text = await req.text();
      if (text.length > MAX_VALUE) return err(413, "file too large");
      await env.DB.prepare(`INSERT INTO files (user_id, id, text, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(user_id, id) DO UPDATE SET text = ?3, updated = ?4`).bind(user.id, id, text, Date.now()).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare(`DELETE FROM files WHERE user_id = ? AND id = ?`).bind(user.id, id).run();
      return json({ ok: true });
    }
  }

  // shared content of everyone else (read-only)
  if (path === "/api/shared" && method === "GET") return json(await sharedFor(env, user.id));
  const sm = path.match(/^\/api\/shared\/file\/([A-Za-z0-9_-]{1,64})$/);
  if (sm && method === "GET") {
    const own = await env.DB.prepare(`SELECT owner_id FROM shared_files WHERE chapter_id = ?`).bind(sm[1]).first();
    if (!own) return err(404, "not shared");
    const r = await env.DB.prepare(`SELECT text FROM files WHERE user_id = ? AND id = ?`).bind(own.owner_id, sm[1]).first();
    return r ? new Response(r.text, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }) : err(404, "no file");
  }

  return err(404, "not found");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) { return err(500, String(e && e.message || e)); }
    }
    return env.ASSETS.fetch(req);
  },
};
