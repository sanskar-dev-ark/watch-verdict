// Minimal Supabase client for the server (no dependencies).
// - Reads use the publishable key.
// - Member writes use the member's own access token, so the database's row-level security applies.
// - Only the title snapshot table is written with the secret key (members can't write titles).
import "./env.js";

const URL_ = () => (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const PUB = () => process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SECRET = () => process.env.SUPABASE_SECRET_KEY || "";

export const configured = () => Boolean(URL_() && PUB());
export const canWriteTitles = () => Boolean(SECRET());

export class DbError extends Error {
  constructor(status, msg, code) { super(msg); this.status = status; this.code = code; }
}

// Turn database errors into messages people can act on.
function friendly(status, body) {
  const m = body?.message || body?.msg || body?.error_description || `Database error (${status})`;
  if (/Slow down/i.test(m)) return new DbError(429, "Slow down a little.");
  if (/^TV_(LINKS|BLOCKED): /.test(m)) return new DbError(400, m.replace(/^TV_\w+: /, ""));
  if (/own review/i.test(m)) return new DbError(400, "You can't like your own review.");
  if (/editor/i.test(m)) return new DbError(403, "Only editors can make editor's picks.");
  if (body?.code === "23505") return new DbError(409, "That already exists.");
  if (body?.code === "42501" || status === 401 || status === 403) return new DbError(403, "You can't change that.");
  if (body?.code === "23514") return new DbError(400, "That's too long or not allowed.");
  return new DbError(status >= 500 ? 502 : status, m, body?.code);
}

// db(path, { method, body, token, secret, prefer, count })
export async function db(path, { method = "GET", body, token, secret = false, prefer, single = false } = {}) {
  const key = secret ? SECRET() : PUB();
  const headers = { apikey: key, Authorization: `Bearer ${token || key}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  if (single) headers.Accept = "application/vnd.pgrst.object+json";
  const res = await fetch(`${URL_()}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (single && res.status === 406) return null; // no row
    throw friendly(res.status, data);
  }
  return data;
}
export const rpc = (fn, args = {}, opts = {}) => db(`rpc/${fn}`, { method: "POST", body: args, ...opts });

// Verify a member's access token with Supabase Auth. Cached briefly to avoid a round trip per request.
const userCache = new Map();
export async function verifyToken(token) {
  if (!token || !configured()) return null;
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(`${URL_()}/auth/v1/user`, { headers: { apikey: PUB(), Authorization: `Bearer ${token}` } });
  const user = res.ok ? await res.json() : null;
  userCache.set(token, { user, until: Date.now() + 60e3 });
  if (userCache.size > 5000) userCache.delete(userCache.keys().next().value);
  return user;
}

// Values the browser needs to talk to Supabase Auth directly.
export const publicConfig = () => ({
  supabaseUrl: URL_(), supabaseKey: PUB(),
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  googleEnabled: process.env.GOOGLE_SIGN_IN === "true",
});
export const inList = ids => `(${[...new Set(ids)].map(id => `"${String(id).replace(/"/g, "")}"`).join(",")})`;
