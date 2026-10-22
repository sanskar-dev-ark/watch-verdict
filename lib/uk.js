// What's relevant in the UK right now, and what's rising.
//
// The pool of UK-relevant titles is: films in or coming to UK cinemas, films released in the last
// four months on UK services, and series with episodes airing now on UK services (which catches
// new seasons of older shows). "Rising" compares each title's TMDB popularity today with a week
// ago (snapshots kept in Supabase), boosted by verdicts and Watch later saves on our own site.
import { tmdb, hasKey, PROVIDERS } from "./tmdb.js";
import { card, findByImdb } from "./catalog.js";
import { db, rpc, inList, canWriteTitles, configured } from "./supa.js";

const HOUR = 3600e3;
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ALL_SERVICES = PROVIDERS.map(p => p.id).join("|");
export const HOME_SERVICES = ["Netflix", "Prime Video", "BBC iPlayer", "Disney+", "Apple TV", "ITVX", "NOW", "Channel 4"];

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const pages = async (path, params, n) => (await Promise.all(Array.from({ length: n }, (_, i) => tmdb(path, { ...params, page: i + 1 }).catch(() => ({ results: [] }))))).flatMap(r => r.results);

// Titles that matter in the UK right now, with why (cinema, service, new season).
export async function ukPool() {
  if (!hasKey()) return new Map();
  return cached("pool", 3 * HOUR, async () => {
    const recentFilm = { "primary_release_date.gte": day(-120), "primary_release_date.lte": day(0) };
    const airingNow = { "air_date.gte": day(-21), "air_date.lte": day(7) };
    const [nowPlaying, upcoming, films, shows, ...perService] = await Promise.all([
      pages("/movie/now_playing", { region: "GB" }, 2),
      pages("/movie/upcoming", { region: "GB" }, 2),
      pages("/discover/movie", { watch_region: "GB", with_watch_providers: ALL_SERVICES, with_watch_monetization_types: "flatrate|free|ads", sort_by: "popularity.desc", ...recentFilm }, 3),
      pages("/discover/tv", { watch_region: "GB", with_watch_providers: ALL_SERVICES, with_watch_monetization_types: "flatrate|free|ads", sort_by: "popularity.desc", ...airingNow }, 3),
      ...HOME_SERVICES.flatMap(name => {
        const id = PROVIDERS.find(p => p.name === name).id;
        const base = { watch_region: "GB", with_watch_providers: id, with_watch_monetization_types: "flatrate|free|ads", sort_by: "popularity.desc" };
        return [
          pages("/discover/tv", { ...base, ...airingNow }, 1).then(r => ({ name, type: "tv", r })),
          pages("/discover/movie", { ...base, ...recentFilm }, 1).then(r => ({ name, type: "movie", r })),
        ];
      }),
    ]);
    const pool = new Map();
    const add = (r, type, why) => {
      const c = card(r, type);
      const t = pool.get(c.key) || { ...c, popularity: r.popularity || 0, why: new Set(), services: new Set() };
      t.popularity = Math.max(t.popularity, r.popularity || 0);
      if (why.startsWith("service:")) t.services.add(why.slice(8)); else t.why.add(why);
      pool.set(c.key, t);
    };
    const today = day(0);
    nowPlaying.forEach(r => add(r, "movie", r.release_date > today ? "upcoming" : "cinema"));
    upcoming.forEach(r => add(r, "movie", r.release_date > today ? "upcoming" : "cinema"));
    films.forEach(r => add(r, "movie", "streaming"));
    shows.forEach(r => add(r, "tv", "airing"));
    for (const { name, type, r } of perService) r.forEach(x => add(x, type, "service:" + name));

    // Series: keep only brand-new shows and new seasons. Long-running shows air every week
    // (soaps, chat shows, The Simpsons) and would otherwise crowd out what's actually new.
    const series = [...pool.values()].filter(t => t.type === "tv");
    const info = await mapLimit(series, 8, t => tvInfo(t.id));
    series.forEach((t, i) => {
      const d = info[i];
      const newSeries = t.date && t.date >= day(-60) && t.date <= day(21);
      // Season 8+ of a long-running show is ongoing TV rather than a new release.
      const newSeason = d?.seasonStart && d.season > 1 && d.season < 8 && d.seasonStart >= day(-30) && d.seasonStart <= day(14);
      if (!d || d.excluded || !(newSeries || newSeason)) { pool.delete(t.key); return; }
      t.season = newSeason ? d.season : null;
      t.seasonStart = newSeason ? d.seasonStart : null;
    });
    return pool;
  });
}

// Chat shows, news, soaps and children's TV aren't "new releases" for this site.
const SKIP_GENRES = new Set([10767, 10763, 10766, 10762]);
const tvCache = new Map();
async function tvInfo(id) {
  const hit = tvCache.get(id);
  if (hit && Date.now() - hit.at < 12 * HOUR) return hit.value;
  const d = await tmdb(`/tv/${id}`).catch(() => null);
  const latest = (d?.seasons || []).filter(x => x.season_number > 0 && x.air_date && x.air_date <= day(14)).sort((a, b) => b.season_number - a.season_number)[0];
  const value = d && { excluded: (d.genres || []).some(g => SKIP_GENRES.has(g.id)), season: latest?.season_number || null, seasonStart: latest?.air_date || null };
  tvCache.set(id, { at: Date.now(), value });
  return value;
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Daily job: store today's popularity for every title in the pool.
export async function recordInterest() {
  if (!configured() || !canWriteTitles()) return 0;
  const pool = await ukPool();
  const today = day(0);
  const rows = [...pool.values()].map(t => ({ title_key: t.key, day: today, popularity: Math.round(t.popularity * 100) / 100 }));
  for (let i = 0; i < rows.length; i += 500) {
    await db("title_interest?on_conflict=title_key,day", { method: "POST", secret: true, prefer: "resolution=merge-duplicates,return=minimal", body: rows.slice(i, i + 500) });
  }
  return rows.length;
}

// Rank the pool by growing interest. Falls back to current popularity, favouring new releases,
// until a week of snapshots exists.
export async function rising(limit = 16) {
  const pool = await ukPool();
  if (!pool.size) return [];
  return cached("rising", HOUR, async () => {
    const keys = [...pool.keys()];
    let baseline = new Map(), activity = new Map();
    if (configured()) {
      const first = await db(`title_interest?select=day&day=gte.${day(-8)}&day=lte.${day(-5)}&order=day.asc&limit=1`).catch(() => []);
      if (first.length) {
        const rows = await db(`title_interest?select=title_key,popularity&day=eq.${first[0].day}&limit=2000`).catch(() => []);
        baseline = new Map(rows.map(r => [r.title_key, r.popularity]));
      }
      const act = await rpc("recent_activity", { days: 7 }).catch(() => []);
      activity = new Map(act.filter(a => pool.has(a.title_key)).map(a => [a.title_key, a.verdicts * 3 + a.saves * 2]));
    }
    const today = day(0);
    const scored = keys.map(k => {
      const t = pool.get(k);
      const fresh = t.date && t.date >= day(-14) && t.date <= day(21) ? 1.5 : t.why.has("airing") ? 1.2 : 1;
      const was = baseline.get(k);
      // Growth ratio when we have last week's figure; otherwise popularity weighted for freshness.
      const growth = was != null ? (t.popularity + 5) / (was + 5) : null;
      const score = growth != null ? growth * Math.log10(t.popularity + 10) : (t.popularity * fresh) / 100;
      return { t, score: score + (activity.get(k) || 0) * 0.5, growth };
    }).filter(x => x.t.popularity >= 5 || activity.has(x.t.key));
    scored.sort((a, b) => b.score - a.score);
    const items = scored.slice(0, limit).map(({ t, growth }) => ({
      ...plain(t),
      badge: growth != null && growth >= 1.3 ? `↑ ${Math.round((growth - 1) * 100)}% this week`
        : t.date && t.date > today ? "Coming soon"
        : t.date && t.date >= day(-14) ? (t.type === "movie" ? (t.why.has("cinema") ? "In cinemas" : "New film") : "New show")
        : t.seasonStart ? (t.seasonStart > today ? `Season ${t.season} soon` : `Season ${t.season}`) : baseline.size ? "Rising" : "Popular",
    }));
    return { items, byGrowth: baseline.size > 0 };
  });
}

const plain = t => { const { why, services, popularity, season, seasonStart, ...c } = t; return c; };
const serviceBadge = t => t.type === "movie" ? "New film" : t.seasonStart ? (t.seasonStart > day(0) ? `Season ${t.season} soon` : `Season ${t.season}`) : t.date > day(0) ? "Coming soon" : "New series";

// Home page sections, all UK-focused.
export async function ukHome({ releases = [], editorial = [] } = {}) {
  if (!hasKey()) return { needsKey: true, rails: [] };
  const [pool, risingNow] = await Promise.all([ukPool(), rising(16)]);
  const risingRail = risingNow.byGrowth
    ? { id: "rising", title: "Rising in the UK", note: "Titles whose interest grew fastest this week", items: risingNow.items }
    : { id: "rising", title: "Popular new releases in the UK", note: "The most-watched new films and series in the UK right now", items: risingNow.items };
  const today = day(0);
  const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const sunday = new Date(Date.parse(monday) + 6 * 864e5).toISOString().slice(0, 10);
  const byPop = (a, b) => b.popularity - a.popularity;
  const list = filter => [...pool.values()].filter(filter).sort(byPop);

  // Out this week: notable calendar entries that link to a title page, most interest first.
  const thisWeek = releases.filter(r => r.notable && r.date >= monday && r.date <= sunday)
    .sort((a, b) => (b.interest || 0) - (a.interest || 0)).slice(0, 16)
    .map(r => ({
      key: r.ids?.tmdb ? (r.type === "film" ? "movie-" : "tv-") + r.ids.tmdb : null, imdb: r.ids?.imdb || null,
      type: r.type === "film" ? "movie" : "tv", title: r.title, year: r.date.slice(0, 4), date: r.date,
      poster: r.image || null,
      badge: `${new Date(r.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })} · ${r.where}`,
    }));

  await Promise.all(thisWeek.filter(r => !r.key && r.imdb).map(async r => { r.key = await findByImdb(r.imdb).catch(() => null); }));
  const weekItems = thisWeek.filter(r => r.key).map(({ imdb, ...r }) => r);

  const rails = [
    ...editorial.filter(e => e.items.length >= 3).slice(0, 1),
    risingRail,
    { id: "week", title: "Out this week in the UK", link: "/releases", items: weekItems },
    { id: "cinemas", title: "In UK cinemas now", link: "/releases?kind=cinema", items: list(t => t.why.has("cinema")).slice(0, 16).map(t => ({ ...plain(t), badge: "In cinemas" })) },
    { id: "soon", title: "Coming soon to UK cinemas", link: "/releases?kind=cinema", items: list(t => t.why.has("upcoming") && t.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 16).map(t => ({ ...plain(t), badge: new Date(t.date + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) })) },
    ...HOME_SERVICES.map(name => ({
      id: "s-" + name, title: `New on ${name}`, link: `/explore?provider=${encodeURIComponent(name)}`,
      items: list(t => t.services.has(name)).slice(0, 16).map(t => ({ ...plain(t), badge: serviceBadge(t) })),
    })),
    ...editorial.filter(e => e.items.length >= 3).slice(1),
  ].filter(r => r.items.length >= 4 || r.id.startsWith("c-"));
  return { rails };
}
