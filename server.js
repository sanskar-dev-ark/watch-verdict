// Watch Verdict server. No dependencies. Run: node server.js
// Serves the site (server-rendered for search engines), TMDB-backed catalogue APIs,
// the UK release calendar, and community APIs backed by Supabase (auth + Postgres).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { hasKey } from "./lib/tmdb.js";
import * as catalog from "./lib/catalog.js";
import * as C from "./lib/community.js";
import { configured, verifyToken, publicConfig, DbError, canWriteTitles } from "./lib/supa.js";
import { renderRoute, sitemap, robots } from "./lib/seo.js";
import { RULES, LEVELS, BADGES } from "./lib/points.js";

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };
const json = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => {
  if (!String(req.headers["content-type"] || "").includes("application/json")) return bad(new HttpError(415, "Send JSON."));
  let s = ""; req.on("data", c => { s += c; if (s.length > 50000) { bad(new HttpError(413, "Too large.")); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { bad(new HttpError(400, "Invalid JSON.")); } });
});
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
const validKey = k => typeof k === "string" && /^(movie|tv)-\d+$/.test(k);
const validId = id => /^[0-9a-f-]{36}$/.test(id || "") ? id : fail(404, "Not found.");
const keyOrFail = k => validKey(k) ? k : fail(400, "Unknown title.");

// The signed-in member, from the Supabase access token the browser sends.
async function viewer(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const user = await verifyToken(m[1]);
  if (!user?.id) return null;
  const me = (await C.usersByIds([user.id], user.id))[user.id];
  return me ? { ...me, token: m[1], email: user.email } : null;
}
const need = me => me || fail(401, "Log in to do that.");
// Writing anything public: must be signed in and not blocked.
const poster = me => { need(me); if (me.banned) fail(403, "Your account has been blocked from posting. Contact us if you think this is a mistake."); return me; };
const admin = me => { need(me); if (me.role !== "admin") fail(403, "Only admins can do that."); return me; };

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), fn });

// Accounts (sign-up, login and password reset happen in the browser with Supabase Auth)
route("GET", "/api/config", async () => publicConfig());
route("GET", "/api/username-available", async ({ query }) => {
  const u = clean(query.get("u"), 24).toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(u)) return { available: false, reason: "Usernames are 3 to 24 letters, numbers or underscores." };
  return { available: !(await C.usernameTaken(u)) };
});
route("GET", "/api/me", async ({ me }) => {
  if (!me) return { user: null };
  const [marks, collections, unread] = await Promise.all([C.marksOf(me.id), C.collectionsOf(me.id, me.id), C.unreadCount(me.token, me.id)]);
  const { token, ...user } = me;
  return {
    user, marks: { watched: marks.filter(m => m.list === "watched").map(m => m.title_key), later: marks.filter(m => m.list === "later").map(m => m.title_key) },
    collections: collections.map(c => ({ id: c.id, name: c.name, items: c.keys })), unread,
  };
});
route("POST", "/api/me", async ({ me, body }) => {
  need(me);
  await C.checkText(clean(body.name, 50) + " " + clean(body.bio, 300));
  await C.updateProfile(me.token, me.id, { name: clean(body.name, 50), bio: clean(body.bio, 300) });
  return { user: (await C.usersByIds([me.id], me.id))[me.id] };
});

// Catalogue
route("GET", "/api/status", async () => ({ tmdb: hasKey(), supabase: configured(), titlesWritable: canWriteTitles() }));
// Editor's picks and latest reviews change slowly; cache them for a minute so the home page is quick.
let homeCommunity = { at: 0, value: null };
async function homeCommunityData() {
  if (homeCommunity.value && Date.now() - homeCommunity.at < 60e3) return homeCommunity.value;
  const [cols, recent] = await Promise.all([C.editorialCollections(), C.recentReviews(null)]);
  const editorial = cols.filter(c => c.items.length).map(c => ({ id: "c-" + c.id, title: c.name, link: "/collection/" + c.id, items: c.items.slice(0, 16) }));
  homeCommunity = { at: Date.now(), value: { editorial, recent } };
  return homeCommunity.value;
}
route("GET", "/api/home", async () => {
  const { editorial, recent } = await homeCommunityData();
  return { ...(await catalog.home(editorial)), recentReviews: recent };
});
route("GET", "/api/title/:key", async ({ params, me }) => {
  const key = keyOrFail(params.key);
  const t = await catalog.title(key);
  if (!t) fail(hasKey() ? 404 : 503, hasKey() ? "We couldn't find that title." : "Add a TMDB key to load title pages.");
  C.saveTitle(t);
  const [stats, myReview, discussion, marks, cols] = await Promise.all([
    C.titleStats(key), C.myReview(key, me?.id), C.discussion(key, me?.id),
    me ? C.marksOf(me.id, key) : null, me ? C.collectionsOf(me.id, me.id) : null,
  ]);
  return {
    ...t, stats, myReview, discussion,
    marks: me ? { watched: marks.some(m => m.list === "watched"), later: marks.some(m => m.list === "later"), collections: cols.filter(c => c.keys.includes(key)).map(c => c.id) } : null,
  };
});
route("GET", "/api/title/:key/reviews", async ({ params, me, query }) =>
  ({ reviews: await C.reviewsFor(keyOrFail(params.key), { sort: query.get("sort"), verdict: query.get("verdict"), all: !!query.get("all") }, me?.id) }));
route("GET", "/api/person/:id", async ({ params }) => (await catalog.person(params.id)) || fail(404, "We couldn't find that person."));
route("GET", "/api/search", async ({ query }) => {
  const q = clean(query.get("q"), 100);
  const [found, users] = await Promise.all([catalog.search(q), q && configured() ? C.searchUsers(q) : []]);
  return { ...found, users };
});
route("GET", "/api/explore", async ({ query }) => catalog.explore(Object.fromEntries(["type", "genre", "language", "country", "provider", "sort", "page"].map(k => [k, query.get(k) || undefined]))));
route("GET", "/api/filters", async () => catalog.filters());
route("GET", "/api/resolve/:imdb", async ({ params }) => ({ key: await catalog.findByImdb(params.imdb) }));
route("GET", "/api/releases", async ({ query }) => {
  let data; try { data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/releases.json"), "utf8")); } catch { return { releases: [], note: "Run npm run releases to build the UK release calendar." }; }
  let list = data.releases;
  for (const k of ["kind", "where"]) if (query.get(k)) list = list.filter(r => r[k] === query.get(k));
  if (query.get("from")) list = list.filter(r => r.date >= query.get("from"));
  if (query.get("to")) list = list.filter(r => r.date <= query.get("to"));
  return { generatedAt: data.generatedAt, from: data.from, to: data.to, count: list.length, releases: list };
});

// Reviews: one per member per title. Verdict required; scores and text optional.
route("POST", "/api/title/:key/review", async ({ params, me, body }) => {
  poster(me); const key = keyOrFail(params.key);
  const verdict = Number(body.verdict);
  if (![0, 1, 2, 3].includes(verdict)) fail(400, "Pick a verdict first.");
  const aspects = {}; for (const a of C.ASPECTS) { const n = Math.round(Number(body.aspects?.[a])); if (n >= 1 && n <= 10) aspects[a] = n; }
  const text = clean(body.text, 5000); await C.checkText(text);
  const review = await C.saveReview(me.token, me.id, key, { verdict, aspects, text, spoiler: !!body.spoiler });
  return { review, stats: await C.titleStats(key) };
});
route("DELETE", "/api/review/:id", async ({ params, me }) => { need(me); const key = await C.deleteReview(me.token, validId(params.id)); return { ok: true, stats: await C.titleStats(key) }; });
route("GET", "/api/review/:id/card", async ({ params }) => {
  const [r] = await C.reviewsByIds([validId(params.id)]);
  if (!r) fail(404, "Review not found.");
  const vals = Object.values(r.aspects || {});
  const stats = await C.titleStats(r.key);
  return { title: r.title.title, year: r.title.year, poster: r.title.poster, path: r.title.path, verdict: r.verdict, username: r.author?.username, score: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, meter: stats.meter };
});
route("POST", "/api/review/:id/like", async ({ params, me }) => { need(me); return C.toggleLike(me.token, me.id, validId(params.id)); });
route("GET", "/api/review/:id/comments", async ({ params, me }) => ({ comments: await C.commentsFor(validId(params.id), me?.id) }));
route("POST", "/api/review/:id/comments", async ({ params, me, body }) => {
  poster(me); const text = clean(body.text, 1000); if (!text) fail(400, "Write a comment first."); await C.checkText(text);
  return { comment: await C.addComment(me.token, me.id, validId(params.id), text) };
});
route("DELETE", "/api/comment/:id", async ({ params, me }) => { need(me); await C.deleteComment(me.token, validId(params.id)); return { ok: true }; });

route("POST", "/api/title/:key/discussion", async ({ params, me, body }) => {
  poster(me); const text = clean(body.text, 1000); if (!text) fail(400, "Write a message first."); await C.checkText(text);
  return { message: await C.postDiscussion(me.token, me.id, keyOrFail(params.key), text, !!body.spoiler) };
});
route("POST", "/api/title/:key/mark", async ({ params, me, body }) => {
  need(me); return C.toggleMark(me.token, me.id, keyOrFail(params.key), body.list === "later" ? "later" : "watched");
});

// Collections
route("POST", "/api/collections", async ({ me, body }) => {
  poster(me); const name = clean(body.name, 80); if (!name) fail(400, "Give the collection a name."); await C.checkText(name + " " + clean(body.description, 500));
  return { collection: await C.createCollection(me.token, me.id, { name, description: clean(body.description, 500), editorial: me.role === "admin" && !!body.editorial, addKey: validKey(body.addKey) ? body.addKey : null }) };
});
route("GET", "/api/collection/:id", async ({ params, me }) => ({ collection: (await C.collection(params.id, me?.id)) || fail(404, "Collection not found.") }));
route("POST", "/api/collection/:id", async ({ params, me, body }) => {
  need(me);
  return { collection: await C.updateCollection(me.token, me.id, validId(params.id), {
    name: body.name !== undefined ? clean(body.name, 80) || undefined : undefined,
    description: body.description !== undefined ? clean(body.description, 500) : undefined,
    editorial: me.role === "admin" && body.editorial !== undefined ? !!body.editorial : undefined,
    position: me.role === "admin" && Number.isInteger(body.position) ? Math.max(0, Math.min(999, body.position)) : undefined,
    toggleKey: validKey(body.toggleKey) ? body.toggleKey : null,
  }) };
});
route("DELETE", "/api/collection/:id", async ({ params, me }) => { need(me); await C.deleteCollection(me.token, validId(params.id)); return { ok: true }; });

// Profiles, follows, feed, points
const userOr404 = async (username, viewerId) => (await C.userByUsername(String(username).toLowerCase(), viewerId)) || fail(404, "We couldn't find that person.");
route("GET", "/api/u/:username", async ({ params, me }) => {
  const u = await userOr404(params.username, me?.id);
  const [lists, reviews, collections, progress] = await Promise.all([C.profileLists(u.id), C.userReviews(u.id, me?.id), C.collectionsOf(u.id, me?.id), C.progress(u.id, u.level.points)]);
  const verdicts = [0, 0, 0, 0]; reviews.forEach(r => verdicts[r.verdict]++);
  return { user: u, progress, stats: { watched: lists.watchedCount, reviews: reviews.length, verdicts }, watched: lists.watched, later: lists.later, reviews, collections };
});
route("GET", "/api/u/:username/:list", async ({ params, me }) => {
  if (!["followers", "following"].includes(params.list)) fail(404, "Not found.");
  const u = await userOr404(params.username, me?.id);
  return { users: await C.followList(u.id, params.list, me?.id) };
});
route("POST", "/api/u/:username/follow", async ({ params, me }) => {
  need(me); const u = await userOr404(params.username, me.id);
  await C.toggleFollow(me.token, me.id, u.id);
  return { user: await C.userByUsername(u.username, me.id) };
});
route("GET", "/api/feed", async ({ me }) => { need(me); return { reviews: await C.recentReviews(me.id, { userIds: await C.followingIds(me.id), limit: 50, withText: false }) }; });
route("GET", "/api/top", async () => ({ titles: await C.topTitles() }));
route("GET", "/api/leaderboard", async ({ query, me }) => {
  const period = ["week", "month", "all"].includes(query.get("period")) ? query.get("period") : "week";
  const { board, topReviewIds } = await C.leaderboard(period);
  const [users, reviews, myProgress] = await Promise.all([
    C.usersByIds(board.map(b => b.userId), me?.id), C.reviewsByIds(topReviewIds, me?.id), me ? C.progress(me.id, me.level.points) : null,
  ]);
  const badges = await Promise.all(board.map(b => C.progress(b.userId, b.points).then(p => p.badges.filter(x => x.earned).map(x => x.name))));
  return {
    period, board: board.map((b, i) => ({ ...b, user: users[b.userId], badges: badges[i] })).filter(b => b.user),
    me: myProgress ? { ...myProgress, periodRank: board.find(b => b.userId === me.id)?.rank || null } : null,
    reviews, rules: RULES.map(({ label, pts }) => ({ label, pts })), levels: LEVELS, badges: BADGES.map(({ id, name, desc }) => ({ id, name, desc })),
  };
});

// Reports and moderation
const REASONS = ["spoilers", "abuse", "hate", "spam", "sexual", "other"];
route("POST", "/api/report", async ({ me, body }) => {
  need(me);
  if (!["review", "comment", "discussion", "profile", "collection"].includes(body.type)) fail(400, "Unknown item.");
  if (!REASONS.includes(body.reason)) fail(400, "Pick a reason.");
  await C.report(me.token, me.id, { type: body.type, id: validId(body.id), reason: body.reason, note: clean(body.note, 500) });
  return { ok: true };
});
route("GET", "/api/admin/reports", async ({ me, query }) => { admin(me); return { items: await C.reportQueue(me.token, ["open", "removed", "dismissed"].includes(query.get("status")) ? query.get("status") : "open") }; });
route("POST", "/api/admin/resolve", async ({ me, body }) => {
  admin(me);
  if (!["remove", "dismiss", "ban"].includes(body.action)) fail(400, "Unknown action.");
  await C.resolveReports(me.token, me.id, { type: body.type, id: validId(body.id), action: body.action });
  return { ok: true };
});
route("POST", "/api/admin/ban", async ({ me, body }) => { admin(me); await C.setBanned(me.token, validId(body.userId), !!body.banned); return { ok: true }; });
route("GET", "/api/admin/terms", async ({ me }) => { admin(me); return { terms: await C.listTerms(me.token) }; });
route("POST", "/api/admin/terms", async ({ me, body }) => {
  admin(me); const term = clean(body.term, 60).toLowerCase();
  if (term.length < 2) fail(400, "Enter at least two characters.");
  body.remove ? await C.removeTerm(me.token, term) : await C.addTerm(me.token, term);
  return { terms: await C.listTerms(me.token) };
});

// Notifications
route("GET", "/api/notifications", async ({ me }) => { need(me); return { items: await C.notifications(me.token, me.id) }; });
route("POST", "/api/notifications/read", async ({ me }) => { need(me); await C.markAllRead(me.token, me.id); return { ok: true }; });

// Your data (UK GDPR)
route("GET", "/api/me/export", async ({ me, res }) => {
  need(me);
  const data = await C.exportMyData(me.token, me.id);
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="watch-verdict-${me.username}.json"`, "cache-control": "no-store" });
  res.end(JSON.stringify(data, null, 2));
});
route("POST", "/api/me/delete", async ({ me, body }) => {
  need(me);
  if (String(body.confirm || "").toLowerCase() !== me.username.toLowerCase()) fail(400, "Type your username to confirm.");
  await C.deleteMyAccount(me.token);
  return { ok: true };
});

// ---------- server ----------
const MIME = { ".webmanifest": "application/manifest+json", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
const PUBLIC = path.join(ROOT, "public");
let templateCache = null;
// Stamp CSS and JS links with a content hash so browsers pick up new versions straight after a deploy.
const assetVersion = f => crypto.createHash("sha1").update(fs.readFileSync(path.join(PUBLIC, f))).digest("hex").slice(0, 10);
const template = () => (process.env.NODE_ENV === "production" && templateCache) || (templateCache = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8")
  .replace('href="/style.css"', `href="/style.css?v=${assetVersion("style.css")}"`)
  .replace('src="/app.js"', `src="/app.js?v=${assetVersion("app.js")}"`));
const readReleases = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data/releases.json"), "utf8")).releases; } catch { return []; } };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) return json(res, 404, { error: "Not found." });
    try {
      if (!configured() && !["/api/status", "/api/config", "/api/explore", "/api/filters", "/api/releases", "/api/search", "/api/resolve"].some(p => url.pathname.startsWith(p)) && !url.pathname.startsWith("/api/person/"))
        fail(503, "Community features need Supabase. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env.");
      const params = Object.fromEntries(Object.entries(url.pathname.match(r.re).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const body = req.method === "POST" ? await readBody(req) : {};
      const me = await viewer(req);
      const out = await r.fn({ req, res, params, query: url.searchParams, body, me });
      if (!res.headersSent && out !== undefined) json(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.code, { error: e.message });
      if (e instanceof DbError) return json(res, e.status, { error: e.message });
      console.error(e);
      json(res, 502, { error: "Something went wrong loading this. Try again in a moment." });
    }
    return;
  }
  // Real static files (CSS, JS, images).
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const file = path.join(PUBLIC, rel);
  if (file.startsWith(PUBLIC) && path.extname(file) && rel !== "index.html" && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300" });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
  // Health check for Render and uptime monitors. /healthz answers instantly; /healthz?deep=1 also checks TMDB and Supabase.
  if (url.pathname === "/healthz") {
    const out = { status: "ok", uptime: Math.round(process.uptime()), tmdbKey: hasKey(), supabase: configured(), titlesWritable: canWriteTitles(), releases: readReleases().length };
    if (url.searchParams.get("deep") === "1") {
      const probe = async (fn) => { const t = Date.now(); try { await fn(); return { ok: true, ms: Date.now() - t }; } catch (e) { return { ok: false, error: e.message }; } };
      [out.tmdb, out.database] = await Promise.all([probe(() => catalog.filters()), probe(() => C.titleRefs(["movie-0"]))]);
      if (!out.tmdb.ok || !out.database.ok) out.status = "degraded";
    }
    res.writeHead(out.status === "ok" ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(out));
  }
  if (url.pathname === "/robots.txt") { res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); return res.end(robots()); }
  if (url.pathname === "/sitemap.xml") {
    const [home, data] = await Promise.all([catalog.home([]).catch(() => ({ rails: [] })), configured() ? C.sitemapData().catch(() => null) : null]);
    res.writeHead(200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
    return res.end(sitemap(data, readReleases(), home.rails.flatMap(r => r.items)));
  }
  // Everything else is an app page: render it on the server, then the app takes over in the browser.
  let page;
  try { page = await renderRoute(url.pathname, url.searchParams, { releases: readReleases() }); }
  // A failed upstream call gets 503 so search engines retry later instead of indexing an empty page.
  catch (e) { console.error(e); page = { status: 503, head: '<title>Watch Verdict</title><meta name="robots" content="noindex">', body: "" }; }
  if (page.redirect) { res.writeHead(301, { location: page.redirect + (url.search || "") }); return res.end(); }
  if (page.title) C.saveTitle(page.title);
  const html = template()
    .replace(/<!--head-->[\s\S]*?<!--\/head-->/, page.head)
    .replace("<!--app-->", page.body);
  res.writeHead(page.status || 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : html);
}).listen(PORT, () => {
  if (process.env.RUN_JOBS === "true") startJobs();
  // Warm the home page cache so the first visitor doesn't wait for TMDB.
  if (hasKey()) catalog.home([]).catch(e => console.error("home warm-up:", e.message));
  console.log(`Watch Verdict running at http://localhost:${PORT}`);
  if (!hasKey()) console.log("No TMDB_API_KEY set: copy .env.example to .env and add your key.");
  if (!configured()) console.log("No Supabase settings: community features are off until SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set.");
  else if (!canWriteTitles()) console.log("SUPABASE_SECRET_KEY is missing: members can't rate titles until it's set.");
});

// Daily jobs, run by the web server itself so they can update files it serves:
// rebuild the UK release calendar, then send Watch later arrival alerts.
function startJobs() {
  const run = script => new Promise(done => execFile(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, timeout: 15 * 60e3 }, (err, out, errOut) => {
    console.log(`[job ${script}] ${err ? "failed: " + (errOut || err.message).trim() : out.trim().split("\n").pop()}`);
    done();
  }));
  const daily = async () => { await run("releases.js"); if (hasKey() && canWriteTitles()) await run("notify-arrivals.js"); };
  daily();
  setInterval(daily, 24 * 3600e3);
}
