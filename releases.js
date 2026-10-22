// UK release calendar: cinema, streaming and TV in one list.
//
//   node releases.js                 next 60 days and last 14 days
//   node releases.js --from 2026-10-01 --to 2026-12-31
//
// Sources:
//   TVmaze (no key)   series and season premieres on UK channels and streaming services
//   TMDB  (key)       films opening in UK cinemas, digital/streaming film releases, UK streaming catalogue
// Output: data/releases.json
import fs from "node:fs";
import { tmdb, hasKey, IMG, PROVIDERS } from "./lib/tmdb.js";

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const FROM = arg("--from") || day(-14);
const TO = arg("--to") || day(60);
const OUT = new URL("./data/releases.json", import.meta.url);

// Streaming services UK viewers can get. TVmaze lists global services (Netflix, Prime) with no country.
const UK_STREAMERS = new Set(["Netflix", "Prime Video", "Amazon Prime Video", "Apple TV", "Apple TV+", "Disney+", "NOW", "Paramount+",
  "BBC iPlayer", "ITVX", "Channel 4", "My5", "U", "discovery+", "BritBox", "MUBI", "Sky Go", "STV Player", "S4C Clic"]);
const UK_CHANNELS_SKIP = /^(BBC News|BBC Parliament|Sky News|GB News)/;

const releases = new Map();
function add(r) {
  const key = `${r.kind}|${r.title.toLowerCase()}|${r.season ?? ""}|${r.where}`;
  if (!releases.has(key) || r.date < releases.get(key).date) releases.set(key, r);
}

// ---------- TVmaze: series premieres ----------
async function tvmaze(path) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch("https://api.tvmaze.com" + path);
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1500 * (i + 1))); continue; }
    if (!res.ok) throw new Error(`TVmaze ${res.status} on ${path}`);
    return res.json();
  }
  throw new Error("TVmaze rate limit");
}

function isPremiere(ep, show) {
  return ep.number === 1 || (ep.number == null && ep.type === "regular") || show.premiered === ep.airdate;
}

function fromTvmaze(ep, kind) {
  const show = ep._embedded?.show || ep.show;
  const channel = show.webChannel || show.network;
  const firstSeason = show.premiered === ep.airdate || ep.season === 1;
  return {
    kind,                                  // "streaming" | "tv"
    type: "series",
    title: show.name,
    season: ep.season,
    label: firstSeason ? "New series" : ep.season > 1900 ? `${ep.season} edition` : `Season ${ep.season}`,
    date: ep.airdate,
    where: channel?.name || "Unknown",
    genres: show.genres || [],
    language: show.language,
    overview: (show.summary || "").replace(/<[^>]+>/g, "").trim(),
    image: show.image?.medium || null,
    ids: { tvmaze: show.id, imdb: show.externals?.imdb || null, tvdb: show.externals?.thetvdb || null },
    source: "TVmaze",
  };
}

async function loadTvmaze() {
  for (let d = FROM; d <= TO; d = nextDay(d)) {
    const [web, tv] = await Promise.all([
      tvmaze(`/schedule/web?date=${d}`),            // all streaming services (global + UK)
      tvmaze(`/schedule?country=GB&date=${d}`),      // UK broadcast channels
    ]);
    for (const ep of web) {
      const show = ep._embedded?.show; const ch = show?.webChannel;
      if (!show || !ch || !isPremiere(ep, show)) continue;
      const country = ch.country?.code;
      if (country && country !== "GB") continue;     // regional services elsewhere
      if (!country && !UK_STREAMERS.has(ch.name)) continue;
      add(fromTvmaze(ep, "streaming"));
    }
    for (const ep of tv) {
      const show = ep.show;
      // Shows with no broadcast network are streaming-only and already come from the web schedule.
      if (!show || !show.network || !isPremiere(ep, show) || UK_CHANNELS_SKIP.test(show.network.name)) continue;
      if (["News", "Talk Show", "Sports"].includes(show.type)) continue;
      add(fromTvmaze(ep, "tv"));
    }
  }
  console.log(`TVmaze: series premieres loaded for ${FROM} to ${TO}`);
}
function nextDay(d) { return new Date(new Date(d + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10); }

// ---------- TMDB: cinema and streaming films ----------
// TMDB release types: 1 premiere, 2 limited cinema, 3 cinema, 4 digital, 5 physical, 6 TV
async function loadTmdbFilms() {
  const genres = Object.fromEntries((await tmdb("/genre/movie/list")).genres.map(g => [g.id, g.name]));
  const providerName = Object.fromEntries(PROVIDERS.map(p => [p.id, p.name]));
  const seen = new Set();
  let cinema = 0, digital = 0;
  for (let page = 1; page <= 20; page++) {
    const res = await tmdb("/discover/movie", {
      region: "GB", with_release_type: "2|3|4",
      "release_date.gte": FROM, "release_date.lte": TO,
      sort_by: "popularity.desc", page,
    });
    for (const m of res.results) {
      if (seen.has(m.id)) continue; seen.add(m.id);
      // TMDB is user-edited: skip placeholder and near-empty entries (no poster, almost no interest).
      if (!m.poster_path || !m.overview) continue;
      const rd = await tmdb(`/movie/${m.id}/release_dates`);
      const gb = rd.results.find(r => r.iso_3166_1 === "GB")?.release_dates || [];
      const cert = gb.find(x => x.certification)?.certification || null;
      if (!cert && m.popularity < 1.5) continue;     // a BBFC certificate means a real UK release, so keep those
      const base = {
        type: "film", title: m.title, season: null,
        genres: (m.genre_ids || []).map(id => genres[id]).filter(Boolean),
        language: m.original_language, overview: m.overview,
        image: m.poster_path ? IMG + "w342" + m.poster_path : null,
        certification: cert, ids: { tmdb: m.id }, source: "TMDB",
      };
      const cin = gb.filter(x => x.type === 2 || x.type === 3).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
      if (cin) { add({ ...base, kind: "cinema", label: cin.type === 2 ? "Limited release" : "In cinemas", date: cin.release_date.slice(0, 10), where: "UK cinemas", note: cin.note || null }); cinema++; }
      const dig = gb.filter(x => x.type === 4).sort((a, b) => a.release_date.localeCompare(b.release_date))[0];
      if (dig) {
        // Where can it be watched? Subscription services first, else rental.
        const wp = (await tmdb(`/movie/${m.id}/watch/providers`)).results?.GB;
        const sub = (wp?.flatrate || []).map(p => providerName[p.provider_id] || p.provider_name);
        // Rent-or-buy-only releases are many and mostly small; keep the ones people are likely to look for.
        if (!sub.length && !cert && m.popularity < 4) continue;
        add({ ...base, kind: "streaming", label: sub.length ? "New film" : "To rent or buy", date: dig.release_date.slice(0, 10),
          where: sub[0] || "Rent or buy", alsoOn: sub.slice(1), note: dig.note || null });
        digital++;
      }
    }
    if (page >= res.total_pages) break;
  }
  console.log(`TMDB: ${cinema} UK cinema releases, ${digital} digital/streaming film releases`);
}

// ---------- run ----------
await loadTvmaze();
if (hasKey()) await loadTmdbFilms();
else console.log("TMDB: skipped (no TMDB_API_KEY in .env). Cinema and streaming films need it.");

const list = [...releases.values()].filter(r => r.date >= FROM && r.date <= TO).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
fs.mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), region: "GB", from: FROM, to: TO, count: list.length, releases: list }, null, 1));

const by = k => list.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
console.log(`\nSaved ${list.length} releases to data/releases.json`);
console.log("By kind:", by("kind"));
console.log("Top outlets:", Object.entries(by("where")).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(", "));
