// Community data in Supabase Postgres: profiles, reviews, likes, comments, follows,
// watched / watch later, collections, discussion, points.
import { db, rpc, inList, canWriteTitles, DbError } from "./supa.js";
import { titlePath } from "./seo.js";
import { levelFor, BADGES } from "./points.js";
import * as catalog from "./catalog.js";

export const ASPECTS = ["Story", "Acting", "Direction", "Visuals", "Sound", "Pacing"];
const REVIEW_SELECT = "id,title_key,user_id,verdict,aspects,text,spoiler,created_at,updated_at,review_likes(user_id),review_comments(count)";
const ts = d => (d ? Date.parse(d) : null);

// ---------- people ----------
function shapeUser(p, viewerId, followedSet) {
  if (!p) return null;
  const l = levelFor(p.points || 0);
  return {
    id: p.id, username: p.username, name: p.name, bio: p.bio, role: p.role, banned: !!p.banned, createdAt: ts(p.created_at),
    followers: p.followers, following: p.following, isMe: viewerId === p.id,
    followedByMe: followedSet ? followedSet.has(p.id) : false,
    level: { level: l.level, name: l.name, points: l.points },
  };
}
export async function usersByIds(ids, viewerId) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return {};
  const [rows, follows] = await Promise.all([
    db(`profile_summaries?id=in.${inList(ids)}`),
    viewerId ? db(`follows?select=following&follower=eq.${viewerId}&following=in.${inList(ids)}`) : [],
  ]);
  const fset = new Set(follows.map(f => f.following));
  return Object.fromEntries(rows.map(p => [p.id, shapeUser(p, viewerId, fset)]));
}
export async function userByUsername(username, viewerId) {
  const p = await db(`profile_summaries?username=eq.${encodeURIComponent(username)}`, { single: true });
  if (!p) return null;
  return (await usersByIds([p.id], viewerId))[p.id];
}
export const usernameTaken = async u => Boolean(await db(`profiles?select=id&username=eq.${encodeURIComponent(u)}`, { single: true }));

// ---------- titles ----------
export async function titleRefs(keys) {
  keys = [...new Set(keys.filter(Boolean))];
  if (!keys.length) return {};
  const rows = await db(`titles?key=in.${inList(keys)}`);
  return Object.fromEntries(rows.map(t => [t.key, { key: t.key, title: t.title, poster: t.poster, year: t.year, type: t.type, date: t.date, path: titlePath(t.key, t.title, t.year) }]));
}
// Keep the title snapshot current. Called with TMDB data, never with data from the browser.
export async function saveTitle(t) {
  if (!t || !canWriteTitles()) return;
  const date = t.ukCinema || t.ukDigital || t.date;
  await db("titles", {
    method: "POST", secret: true, prefer: "resolution=merge-duplicates,return=minimal",
    body: { key: t.key, title: t.title, poster: t.poster || null, year: t.year || null, date: /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : null, type: t.type, updated_at: new Date().toISOString() },
  }).catch(e => console.error("saveTitle", e.message));
}
// Before a member reviews or lists a title, make sure we have it (from TMDB).
export async function ensureTitle(key) {
  const have = await db(`titles?select=key&key=eq.${key}`, { single: true });
  if (have) return;
  if (!canWriteTitles()) throw new DbError(503, "The site isn't fully set up yet (missing SUPABASE_SECRET_KEY).");
  const t = await catalog.title(key);
  if (!t) throw new DbError(404, "We couldn't find that title.");
  await saveTitle(t);
}

// ---------- stats ----------
export async function titleStats(key) {
  const s = await rpc("title_stats", { k: key });
  const avg = Object.fromEntries(ASPECTS.map(a => [a, s.avg?.[a] == null ? null : Number(s.avg[a])]));
  const vals = Object.values(avg).filter(v => v != null);
  return {
    votes: s.votes, verdicts: s.verdicts,
    meter: s.votes ? Math.round(((s.verdicts[2] + s.verdicts[3]) / s.votes) * 100) : null,
    avg, score: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
  };
}

// ---------- reviews ----------
async function shapeReviews(rows, viewerId) {
  const [users, titles] = await Promise.all([usersByIds(rows.map(r => r.user_id), viewerId), titleRefs(rows.map(r => r.title_key))]);
  return rows.map(r => ({
    id: r.id, key: r.title_key, title: titles[r.title_key] || { key: r.title_key, title: r.title_key },
    verdict: r.verdict, aspects: r.aspects, text: r.text, spoiler: r.spoiler,
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
    likes: r.review_likes.length, likedByMe: viewerId ? r.review_likes.some(l => l.user_id === viewerId) : false,
    comments: r.review_comments[0]?.count || 0,
    author: users[r.user_id] || null,
  }));
}
export async function reviewsFor(key, { sort = "top", verdict = "", all = false } = {}, viewerId) {
  let q = `reviews?select=${REVIEW_SELECT}&title_key=eq.${key}&limit=200`;
  if (!all) q += "&text=neq.";
  if (verdict !== "" && verdict != null) q += `&verdict=eq.${Number(verdict)}`;
  q += "&order=created_at.desc";
  const out = await shapeReviews(await db(q), viewerId);
  if (sort !== "new") out.sort((a, b) => b.likes - a.likes || b.createdAt - a.createdAt);
  return out.slice(0, 100);
}
export async function myReview(key, viewerId) {
  if (!viewerId) return null;
  const rows = await db(`reviews?select=${REVIEW_SELECT}&title_key=eq.${key}&user_id=eq.${viewerId}`);
  return rows.length ? (await shapeReviews(rows, viewerId))[0] : null;
}
export async function reviewsByIds(ids, viewerId) {
  if (!ids.length) return [];
  const rows = await db(`reviews?select=${REVIEW_SELECT}&id=in.${inList(ids)}`);
  const order = new Map(ids.map((id, i) => [id, i]));
  return (await shapeReviews(rows, viewerId)).sort((a, b) => order.get(a.id) - order.get(b.id));
}
export async function recentReviews(viewerId, { userIds, limit = 8, withText = true } = {}) {
  let q = `reviews?select=${REVIEW_SELECT}&order=updated_at.desc&limit=${limit}`;
  if (withText) q += "&text=neq.";
  if (userIds) { if (!userIds.length) return []; q += `&user_id=in.${inList(userIds)}`; }
  return shapeReviews(await db(q), viewerId);
}
export async function saveReview(token, viewerId, key, { verdict, aspects, text, spoiler }) {
  await ensureTitle(key);
  const row = await db("reviews?on_conflict=title_key,user_id", {
    method: "POST", token, prefer: "resolution=merge-duplicates,return=representation",
    body: { title_key: key, user_id: viewerId, verdict, aspects, text, spoiler },
  });
  // Giving a verdict means you've watched it.
  await db("marks", { method: "POST", token, prefer: "resolution=ignore-duplicates,return=minimal", body: { user_id: viewerId, title_key: key, list: "watched" } }).catch(() => {});
  await db(`marks?user_id=eq.${viewerId}&title_key=eq.${key}&list=eq.later`, { method: "DELETE", token }).catch(() => {});
  return (await reviewsByIds([row[0].id], viewerId))[0];
}
export async function deleteReview(token, id) {
  const r = await db(`reviews?select=title_key&id=eq.${id}`, { single: true });
  if (!r) throw new DbError(404, "Review not found.");
  const gone = await db(`reviews?id=eq.${id}`, { method: "DELETE", token, prefer: "return=representation" });
  if (!gone.length) throw new DbError(403, "You can only delete your own review.");
  return r.title_key;
}
export async function toggleLike(token, viewerId, reviewId) {
  const mine = await db(`review_likes?review_id=eq.${reviewId}&user_id=eq.${viewerId}`);
  if (mine.length) await db(`review_likes?review_id=eq.${reviewId}&user_id=eq.${viewerId}`, { method: "DELETE", token });
  else await db("review_likes", { method: "POST", token, prefer: "return=minimal", body: { review_id: reviewId, user_id: viewerId } });
  const all = await db(`review_likes?select=user_id&review_id=eq.${reviewId}`);
  return { likes: all.length, likedByMe: !mine.length };
}
export async function commentsFor(reviewId, viewerId) {
  const rows = await db(`review_comments?review_id=eq.${reviewId}&order=created_at.asc&limit=500`);
  const users = await usersByIds(rows.map(c => c.user_id), viewerId);
  return rows.map(c => ({ id: c.id, reviewId: c.review_id, text: c.text, createdAt: ts(c.created_at), author: users[c.user_id] }));
}
export async function addComment(token, viewerId, reviewId, text) {
  const [c] = await db("review_comments", { method: "POST", token, prefer: "return=representation", body: { review_id: reviewId, user_id: viewerId, text } });
  const users = await usersByIds([viewerId], viewerId);
  return { id: c.id, reviewId, text: c.text, createdAt: ts(c.created_at), author: users[viewerId] };
}
export async function deleteComment(token, id) {
  const gone = await db(`review_comments?id=eq.${id}`, { method: "DELETE", token, prefer: "return=representation" });
  if (!gone.length) throw new DbError(403, "You can only delete your own comment.");
}

// ---------- discussion ----------
export async function discussion(key, viewerId) {
  const rows = (await db(`discussion?title_key=eq.${key}&order=created_at.desc&limit=200`)).reverse();
  const users = await usersByIds(rows.map(m => m.user_id), viewerId);
  return rows.map(m => ({ id: m.id, text: m.text, spoiler: m.spoiler, ts: ts(m.created_at), author: users[m.user_id] }));
}
export async function postDiscussion(token, viewerId, key, text, spoiler) {
  await ensureTitle(key);
  const [m] = await db("discussion", { method: "POST", token, prefer: "return=representation", body: { title_key: key, user_id: viewerId, text, spoiler } });
  const users = await usersByIds([viewerId], viewerId);
  return { id: m.id, text: m.text, spoiler: m.spoiler, ts: ts(m.created_at), author: users[viewerId] };
}

// ---------- watched / watch later ----------
export async function marksOf(viewerId, key) {
  const rows = await db(`marks?select=list,title_key&user_id=eq.${viewerId}${key ? `&title_key=eq.${key}` : ""}`);
  return rows;
}
export async function toggleMark(token, viewerId, key, list) {
  await ensureTitle(key);
  const have = await db(`marks?user_id=eq.${viewerId}&title_key=eq.${key}&list=eq.${list}`);
  if (have.length) await db(`marks?user_id=eq.${viewerId}&title_key=eq.${key}&list=eq.${list}`, { method: "DELETE", token });
  else {
    await db("marks", { method: "POST", token, prefer: "return=minimal", body: { user_id: viewerId, title_key: key, list } });
    if (list === "watched") await db(`marks?user_id=eq.${viewerId}&title_key=eq.${key}&list=eq.later`, { method: "DELETE", token });
  }
  const now = await marksOf(viewerId, key);
  return { watched: now.some(m => m.list === "watched"), later: now.some(m => m.list === "later") };
}

// ---------- collections ----------
async function shapeCollections(rows, viewerId, full = false) {
  const items = rows.length ? await db(`collection_items?select=collection_id,title_key,added_at&collection_id=in.${inList(rows.map(c => c.id))}&order=added_at.asc`) : [];
  const [users, titles] = await Promise.all([usersByIds(rows.map(c => c.user_id), viewerId), titleRefs(items.map(i => i.title_key))]);
  return rows.map(c => {
    const keys = items.filter(i => i.collection_id === c.id).map(i => i.title_key);
    const refs = keys.map(k => titles[k] || { key: k, title: k });
    return { id: c.id, name: c.name, description: c.description, editorial: c.editorial, position: c.position, count: keys.length, owner: users[c.user_id], updatedAt: ts(c.updated_at), keys, preview: refs.slice(0, 4), ...(full ? { items: refs } : {}) };
  });
}
export async function collection(id, viewerId) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await db(`collections?id=eq.${id}`);
  return rows.length ? (await shapeCollections(rows, viewerId, true))[0] : null;
}
export const collectionsOf = async (userId, viewerId) => shapeCollections(await db(`collections?user_id=eq.${userId}&order=updated_at.desc`), viewerId);
export const editorialCollections = async () => shapeCollections(await db("collections?editorial=is.true&order=position.asc,updated_at.desc&limit=8"), null, true);
export async function createCollection(token, viewerId, { name, description, editorial, addKey }) {
  const [c] = await db("collections", { method: "POST", token, prefer: "return=representation", body: { user_id: viewerId, name, description, editorial: !!editorial } });
  if (addKey) { await ensureTitle(addKey); await db("collection_items", { method: "POST", token, prefer: "return=minimal", body: { collection_id: c.id, title_key: addKey } }); }
  return collection(c.id, viewerId);
}
export async function updateCollection(token, viewerId, id, { name, description, editorial, position, toggleKey }) {
  const patch = {};
  if (position !== undefined) patch.position = position;
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (editorial !== undefined) patch.editorial = editorial;
  const updated = await db(`collections?id=eq.${id}`, { method: "PATCH", token, prefer: "return=representation", body: { ...patch, updated_at: new Date().toISOString() } });
  if (!updated.length) throw new DbError(403, "This isn't your collection.");
  if (toggleKey) {
    await ensureTitle(toggleKey);
    const have = await db(`collection_items?collection_id=eq.${id}&title_key=eq.${toggleKey}`);
    if (have.length) await db(`collection_items?collection_id=eq.${id}&title_key=eq.${toggleKey}`, { method: "DELETE", token });
    else await db("collection_items", { method: "POST", token, prefer: "return=minimal", body: { collection_id: id, title_key: toggleKey } });
  }
  return collection(id, viewerId);
}
export async function deleteCollection(token, id) {
  const gone = await db(`collections?id=eq.${id}`, { method: "DELETE", token, prefer: "return=representation" });
  if (!gone.length) throw new DbError(403, "This isn't your collection.");
}

// ---------- follows ----------
export async function toggleFollow(token, viewerId, targetId) {
  if (targetId === viewerId) throw new DbError(400, "You can't follow yourself.");
  const have = await db(`follows?follower=eq.${viewerId}&following=eq.${targetId}`);
  if (have.length) await db(`follows?follower=eq.${viewerId}&following=eq.${targetId}`, { method: "DELETE", token });
  else await db("follows", { method: "POST", token, prefer: "return=minimal", body: { follower: viewerId, following: targetId } });
}
export async function followList(userId, which, viewerId) {
  const rows = which === "followers" ? await db(`follows?select=follower&following=eq.${userId}`) : await db(`follows?select=following&follower=eq.${userId}`);
  const ids = rows.map(r => r.follower || r.following);
  const users = await usersByIds(ids, viewerId);
  return ids.map(id => users[id]).filter(Boolean);
}
export const followingIds = async viewerId => (await db(`follows?select=following&follower=eq.${viewerId}`)).map(r => r.following);

// ---------- points ----------
export async function progress(userId, points) {
  const [stats, rank] = await Promise.all([rpc("badge_stats", { uid: userId }), rpc("points_rank", { uid: userId })]);
  return { ...levelFor(points), rank: rank || null, badges: BADGES.map(b => ({ id: b.id, name: b.name, desc: b.desc, earned: b.test(stats) })) };
}
export async function leaderboard(period) {
  const since = period === "week" ? new Date(Date.now() - 7 * 864e5).toISOString() : period === "month" ? new Date(Date.now() - 30 * 864e5).toISOString() : "-infinity";
  const [board, top] = await Promise.all([rpc("leaderboard", { since }), rpc("top_reviews", { since })]);
  return { board: board.map((r, i) => ({ rank: i + 1, userId: r.user_id, points: r.points })), topReviewIds: top.map(t => t.review_id) };
}
export async function topTitles() {
  const rows = await rpc("top_titles");
  const titles = await titleRefs(rows.map(r => r.title_key));
  return rows.map(r => ({ ...(titles[r.title_key] || { key: r.title_key, title: r.title_key }), stats: { votes: r.votes, verdicts: r.verdicts, meter: r.meter } }));
}
export async function profileLists(userId) {
  const marks = await db(`marks?select=title_key,list,created_at&user_id=eq.${userId}&order=created_at.desc&limit=200`);
  const titles = await titleRefs(marks.map(m => m.title_key));
  const pick = list => marks.filter(m => m.list === list).slice(0, 60).map(m => titles[m.title_key]).filter(Boolean);
  return { watched: pick("watched"), later: pick("later"), watchedCount: marks.filter(m => m.list === "watched").length };
}
export async function userReviews(userId, viewerId) {
  return shapeReviews(await db(`reviews?select=${REVIEW_SELECT}&user_id=eq.${userId}&order=updated_at.desc&limit=50`), viewerId);
}
export async function searchUsers(q) {
  const s = encodeURIComponent(`*${q.replace(/[*,()]/g, "")}*`);
  const rows = await db(`profile_summaries?or=(username.ilike.${s},name.ilike.${s})&limit=8`);
  return rows.map(p => shapeUser(p));
}
export async function updateProfile(token, viewerId, { name, bio }) {
  const rows = await db(`profiles?id=eq.${viewerId}`, { method: "PATCH", token, prefer: "return=representation", body: { ...(name && { name }), bio } });
  if (!rows.length) throw new DbError(403, "You can't change that.");
}
// For the sitemap.
export async function sitemapData() {
  const [titles, reviewers, cols] = await Promise.all([
    db("titles?select=key,title,year&limit=50000"),
    db("reviews?select=profiles(username)&text=neq.&limit=50000"),
    db("collection_items?select=collection_id,collections(updated_at)&limit=50000"),
  ]);
  const counts = {};
  for (const c of cols) counts[c.collection_id] = { n: (counts[c.collection_id]?.n || 0) + 1, updated: c.collections?.updated_at };
  return {
    titles,
    usernames: [...new Set(reviewers.map(r => r.profiles?.username).filter(Boolean))],
    collections: Object.entries(counts).filter(([, v]) => v.n >= 3).map(([id, v]) => ({ id, updated: v.updated })),
  };
}

// ---------- moderation ----------
const TARGETS = { review: "reviews", comment: "review_comments", discussion: "discussion", collection: "collections" };
// Blocked words and link limits are enforced in the database (check_content trigger).
// This quick check just answers the common case without a round trip.
export async function checkText(text) {
  if (text && (text.match(/https?:\/\/|www\./gi) || []).length > 1) throw new DbError(400, "Posts can include at most one link.");
}

export async function report(token, viewerId, { type, id, reason, note }) {
  await db("reports", { method: "POST", token, prefer: "resolution=ignore-duplicates,return=minimal", body: { reporter: viewerId, target_type: type, target_id: id, reason, note } });
}
// What a report points at, for the admin queue.
async function reportTarget(type, id) {
  if (type === "profile") { const p = await db(`profiles?select=id,username,name,bio,banned&id=eq.${id}`, { single: true }); return p && { owner: p.id, text: `${p.name} (@${p.username}) ${p.bio}`, link: `/u/${p.username}`, banned: p.banned }; }
  const table = TARGETS[type];
  const cols = type === "collection" ? "id,user_id,name,description" : type === "comment" ? "id,user_id,text,review_id,reviews(title_key)" : "id,user_id,text,title_key";
  const r = await db(`${table}?select=${cols}&id=eq.${id}`, { single: true });
  if (!r) return null;
  const key = r.title_key || r.reviews?.title_key;
  const t = key ? (await titleRefs([key]))[key] : null;
  return { owner: r.user_id, text: type === "collection" ? `${r.name}: ${r.description}` : r.text, link: type === "collection" ? `/collection/${r.id}` : t?.path || null, titleKey: key || null };
}
export async function reportQueue(token, status = "open") {
  const rows = await db(`reports?status=eq.${status}&order=created_at.asc&limit=200`, { token });
  // Group reports about the same item.
  const groups = new Map();
  for (const r of rows) {
    const k = r.target_type + ":" + r.target_id;
    if (!groups.has(k)) groups.set(k, { type: r.target_type, id: r.target_id, reports: [] });
    groups.get(k).reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: r.reporter, createdAt: ts(r.created_at) });
  }
  const items = await Promise.all([...groups.values()].map(async g => ({ ...g, target: await reportTarget(g.type, g.id) })));
  const users = await usersByIds(items.flatMap(i => [i.target?.owner, ...i.reports.map(r => r.reporter)]));
  return items.map(i => ({ ...i, owner: users[i.target?.owner] || null, reports: i.reports.map(r => ({ ...r, reporter: users[r.reporter] || null })) }));
}
export async function resolveReports(token, adminId, { type, id, action }) {
  const target = await reportTarget(type, id);
  if (action === "remove" && target) {
    if (type === "profile") throw new DbError(400, "Profiles can't be removed. Block the member instead.");
    await db(`${TARGETS[type]}?id=eq.${id}`, { method: "DELETE", token });   // the database tells the author why
  }
  if (action === "ban" && target?.owner) await db(`profiles?id=eq.${target.owner}`, { method: "PATCH", token, prefer: "return=minimal", body: { banned: true } });
  const status = action === "dismiss" ? "dismissed" : "removed";
  await db(`reports?target_type=eq.${type}&target_id=eq.${id}&status=eq.open`, { method: "PATCH", token, prefer: "return=minimal", body: { status, resolved_by: adminId, resolved_at: new Date().toISOString() } });
}
export async function setBanned(token, userId, banned) {
  await db(`profiles?id=eq.${userId}`, { method: "PATCH", token, prefer: "return=minimal", body: { banned } });
}
export const listTerms = token => db("blocked_terms?order=term.asc", { token });
export const addTerm = (token, term) => db("blocked_terms", { method: "POST", token, prefer: "resolution=ignore-duplicates,return=minimal", body: { term } });
export const removeTerm = (token, term) => db(`blocked_terms?term=eq.${encodeURIComponent(term)}`, { method: "DELETE", token });

// ---------- notifications ----------
export async function notifications(token, viewerId) {
  const rows = await db(`notifications?user_id=eq.${viewerId}&order=created_at.desc&limit=60`, { token });
  const [users, titles] = await Promise.all([usersByIds(rows.map(n => n.actor), viewerId), titleRefs(rows.map(n => n.title_key))]);
  return rows.map(n => ({ id: n.id, type: n.type, detail: n.detail, read: !!n.read_at, createdAt: ts(n.created_at), actor: users[n.actor] || null, title: titles[n.title_key] || null, reviewId: n.review_id }));
}
export async function unreadCount(token, viewerId) {
  const rows = await db(`notifications?select=id&user_id=eq.${viewerId}&read_at=is.null&limit=100`, { token });
  return rows.length;
}
export const markAllRead = (token, viewerId) => db(`notifications?user_id=eq.${viewerId}&read_at=is.null`, { method: "PATCH", token, prefer: "return=minimal", body: { read_at: new Date().toISOString() } });

// ---------- your data (UK GDPR) ----------
export async function exportMyData(token, viewerId) {
  const q = (path) => db(path, { token });
  const [profile, reviews, comments, likes, follows, marks, collections, items, discussion, reports, notes] = await Promise.all([
    q(`profiles?id=eq.${viewerId}`), q(`reviews?user_id=eq.${viewerId}`), q(`review_comments?user_id=eq.${viewerId}`),
    q(`review_likes?user_id=eq.${viewerId}`), q(`follows?or=(follower.eq.${viewerId},following.eq.${viewerId})`), q(`marks?user_id=eq.${viewerId}`),
    q(`collections?user_id=eq.${viewerId}`), q(`collection_items?select=*,collections!inner(user_id)&collections.user_id=eq.${viewerId}`),
    q(`discussion?user_id=eq.${viewerId}`), q(`reports?reporter=eq.${viewerId}`), q(`notifications?user_id=eq.${viewerId}`),
  ]);
  return { exportedAt: new Date().toISOString(), profile: profile[0], reviews, comments, likes, follows, watched_and_watch_later: marks, collections, collection_items: items.map(({ collections, ...i }) => i), discussion, reports, notifications: notes };
}
export const deleteMyAccount = token => rpc("delete_my_account", {}, { token });

// ---------- arrivals (run daily by notify-arrivals.js with the secret key) ----------
export async function watchLaterKeys() {
  const rows = await db("marks?select=user_id,title_key&list=eq.later&limit=100000", { secret: true });
  const byKey = new Map();
  for (const r of rows) { if (!byKey.has(r.title_key)) byKey.set(r.title_key, []); byKey.get(r.title_key).push(r.user_id); }
  return byKey;
}
export async function notifyArrival(userIds, key, detail) {
  const existing = await db(`notifications?select=user_id&type=eq.arrival&title_key=eq.${key}&detail=eq.${encodeURIComponent(detail)}&user_id=in.${inList(userIds)}`, { secret: true });
  const done = new Set(existing.map(e => e.user_id));
  const rows = userIds.filter(u => !done.has(u)).map(u => ({ user_id: u, type: "arrival", title_key: key, detail }));
  if (rows.length) await db("notifications", { method: "POST", secret: true, prefer: "return=minimal", body: rows });
  return rows.length;
}
