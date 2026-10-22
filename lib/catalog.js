// Everything the site reads from TMDB, shaped for the front end and cached.
import { tmdb, hasKey, IMG, PROVIDERS } from "./tmdb.js";

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
const HOUR = 3600e3;
const today = () => new Date().toISOString().slice(0, 10);
const daysFrom = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const img = (p, size) => (p ? IMG + size + p : null);

export const PROVIDER_IDS = Object.fromEntries(PROVIDERS.map(p => [p.name, p.id]));

// Compact card shape used everywhere a title appears in a list.
export function card(r, forcedType) {
  const type = forcedType || (r.media_type === "tv" || r.first_air_date !== undefined ? "tv" : "movie");
  const date = r.release_date || r.first_air_date || null;
  return {
    key: `${type}-${r.id}`, id: r.id, type,
    title: r.title || r.name, date, year: date ? date.slice(0, 4) : null,
    poster: img(r.poster_path, "w342"), backdrop: img(r.backdrop_path, "w1280"),
    overview: r.overview || "", language: r.original_language || null,
  };
}

function badge(c) {
  if (!c.date) return "Trending";
  if (c.date > today()) return "Coming soon";
  if (c.date >= daysFrom(-30)) return c.type === "movie" ? "New film" : "New show";
  return "Trending";
}

export async function home(editorial) {
  if (!hasKey()) return { needsKey: true, rails: [] };
  return cached("home", 2 * HOUR, async () => {
    const [trending, nowPlaying, upcoming, ...platforms] = await Promise.all([
      tmdb("/trending/all/week"),
      tmdb("/movie/now_playing", { region: "GB" }),
      tmdb("/movie/upcoming", { region: "GB" }),
      ...["Netflix", "Prime Video", "Disney+", "Apple TV", "BBC iPlayer", "NOW"].map(name =>
        tmdb("/discover/tv", { watch_region: "GB", with_watch_providers: PROVIDER_IDS[name], sort_by: "popularity.desc", "first_air_date.gte": daysFrom(-730) })
          .then(r => ({ name, r }))),
    ]);
    const talk = trending.results.filter(r => r.media_type !== "person").slice(0, 16).map(r => { const c = card(r); return { ...c, badge: badge(c) }; });
    await Promise.all(talk.map(async c => {
      const d = await tmdb(`/${c.type}/${c.id}`, { append_to_response: "videos" }).catch(() => null);
      if (!d) return;
      const recent = (d.videos?.results || []).filter(x => x.site === "YouTube" && ["Trailer", "Teaser"].includes(x.type) && x.published_at && Date.now() - Date.parse(x.published_at) < 14 * 864e5)
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
      const seasonStart = c.type === "tv" ? d.seasons?.filter(x => x.season_number > 1 && x.air_date).map(x => x.air_date).sort().pop() : null;
      if (seasonStart && seasonStart <= today() && seasonStart >= daysFrom(-30)) c.badge = "New season";
      else if (seasonStart && seasonStart > today() && seasonStart <= daysFrom(30)) c.badge = "Season coming";
      if (recent && c.badge === "Trending") c.badge = recent.type === "Teaser" ? "New teaser" : "New trailer";
    }));
    const rails = [
      { id: "talk", title: "Talk of the Town", items: talk },
      { id: "cinemas", title: "In UK cinemas now", link: "/releases?kind=cinema", items: nowPlaying.results.slice(0, 16).map(r => ({ ...card(r, "movie"), badge: "In cinemas" })) },
      { id: "upcoming", title: "Coming to UK cinemas", link: "/releases?kind=cinema", items: upcoming.results.filter(r => r.release_date > today()).slice(0, 16).map(r => ({ ...card(r, "movie"), badge: "Coming soon" })) },
      ...platforms.map(({ name, r }) => ({ id: "p-" + name, title: `Don't miss on ${name}`, link: `/explore?provider=${encodeURIComponent(name)}`, items: r.results.slice(0, 16).map(x => card(x, "tv")) })),
    ];
    return { rails };
  }).then(h => ({ ...h, rails: [...(editorial.length ? [editorial[0]] : []), ...h.rails, ...editorial.slice(1)] }));
}

const missingAsNull = e => { if (e.status === 404) return null; throw e; };

// "Netflix Standard with Ads" and "Netflix" are one service to a viewer.
const baseService = n => n.replace(/\s+(Standard|Basic|Free)?\s*with Ads$/i, "").replace(/\s+(Premium|Basic)$/i, "").trim();
function uniqueServices(list) {
  const seen = new Set();
  return list.filter(p => { const k = baseService(p.provider_name).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(p => ({ name: baseService(p.provider_name), logo: img(p.logo_path, "w92") }));
}

export async function title(key) {
  const [type, id] = key.split("-");
  if (!["movie", "tv"].includes(type) || !/^\d+$/.test(id) || !hasKey()) return null;
  return cached("t-" + key, 12 * HOUR, async () => {
    const d = await tmdb(`/${type}/${id}`, { append_to_response: "credits,aggregate_credits,videos,watch/providers,release_dates,content_ratings,keywords,recommendations,external_ids" });
    const gb = d["watch/providers"]?.results?.GB;
    const c = card(d, type);
    const gbDates = d.release_dates?.results?.find(r => r.iso_3166_1 === "GB")?.release_dates || [];
    const cert = type === "movie" ? gbDates.find(x => x.certification)?.certification : d.content_ratings?.results?.find(r => r.iso_3166_1 === "GB")?.rating;
    const firstOf = types => gbDates.filter(x => types.includes(x.type)).map(x => x.release_date.slice(0, 10)).sort()[0] || null;
    const credits = type === "tv" && d.aggregate_credits?.cast?.length ? d.aggregate_credits : d.credits;
    const crewJobs = type === "movie" ? ["Director", "Screenplay", "Writer", "Original Music Composer", "Director of Photography", "Producer"] : ["Executive Producer", "Original Music Composer"];
    const crew = [];
    for (const p of [...(type === "tv" ? (d.created_by || []).map(x => ({ ...x, job: "Creator" })) : []), ...(d.credits?.crew || [])]) {
      if ((p.job === "Creator" || crewJobs.includes(p.job)) && !crew.some(x => x.id === p.id && x.job === p.job)) crew.push({ id: p.id, name: p.name, job: p.job, photo: img(p.profile_path, "w185") });
    }
    const trailer = (d.videos?.results || []).filter(v => v.site === "YouTube" && ["Trailer", "Teaser"].includes(v.type)).sort((a, b) => (a.type === "Trailer" ? -1 : 1) - (b.type === "Trailer" ? -1 : 1))[0];
    return {
      ...c,
      tagline: d.tagline || null, overview: d.overview,
      runtime: d.runtime || d.episode_run_time?.[0] || null,
      seasons: type === "tv" ? (d.seasons || []).filter(s => s.season_number > 0).map(s => ({ number: s.season_number, name: s.name, episodes: s.episode_count, date: s.air_date, poster: img(s.poster_path, "w185") })) : null,
      status: d.status, networks: (d.networks || []).map(n => n.name),
      genres: (d.genres || []).map(g => ({ id: g.id, name: g.name })),
      tags: ((d.keywords?.keywords || d.keywords?.results || []).slice(0, 8)).map(k => k.name),
      countries: (d.production_countries || d.origin_country?.map(c => ({ iso_3166_1: c, name: c })) || []).map(x => ({ code: x.iso_3166_1, name: x.name })),
      languages: [d.original_language].filter(Boolean),
      certification: cert || null,
      ukCinema: type === "movie" ? firstOf([2, 3]) : null,
      ukDigital: type === "movie" ? firstOf([4]) : null,
      cast: (credits?.cast || []).slice(0, 15).map(p => ({ id: p.id, name: p.name, character: p.character || p.roles?.[0]?.character || "", photo: img(p.profile_path, "w185") })),
      crew: crew.slice(0, 10),
      trailer: trailer ? { youtube: trailer.key, name: trailer.name } : null,
      whereToWatch: gb ? {
        link: gb.link,
        stream: uniqueServices((gb.flatrate || []).concat(gb.free || [], gb.ads || [])),
        rent: (gb.rent || []).map(p => ({ name: p.provider_name, logo: img(p.logo_path, "w92") })),
        buy: (gb.buy || []).map(p => ({ name: p.provider_name, logo: img(p.logo_path, "w92") })),
      } : null,
      imdb: d.external_ids?.imdb_id || d.imdb_id || null,
      tickets: type === "movie" ? tickets(firstOf([2, 3])) : null,
      recommendations: (d.recommendations?.results || []).slice(0, 12).map(r => card(r, r.media_type === "tv" ? "tv" : type)),
    };
  }).catch(missingAsNull);
}

// UK cinema chains' listings pages. Set AFFILIATE_URL_TEMPLATE (e.g. "https://aff.example/?u={url}")
// once you join an affiliate network, and replace these with the deep links it gives you.
const CINEMAS = [
  ["ODEON", "https://www.odeon.co.uk/films/"],
  ["Cineworld", "https://www.cineworld.co.uk/films"],
  ["Vue", "https://www.myvue.com/whats-on"],
  ["Everyman", "https://www.everymancinema.com/films"],
  ["Picturehouse", "https://www.picturehouses.com/whats-on"],
];
function tickets(ukCinema) {
  if (!ukCinema) return null;
  const days = (Date.parse(ukCinema) - Date.now()) / 864e5;
  if (days > 30 || days < -70) return null;           // pre-sales up to a month out; most runs end within ten weeks
  const wrap = url => process.env.AFFILIATE_URL_TEMPLATE ? process.env.AFFILIATE_URL_TEMPLATE.replace("{url}", encodeURIComponent(url)) : url;
  return { from: ukCinema, chains: CINEMAS.map(([name, url]) => ({ name, url: wrap(url) })) };
}

export async function person(id) {
  if (!/^\d+$/.test(id) || !hasKey()) return null;
  return cached("p-" + id, 24 * HOUR, async () => {
    const p = await tmdb(`/person/${id}`, { append_to_response: "combined_credits,external_ids" });
    const seen = new Set();
    const credits = [...(p.combined_credits?.cast || []).map(c => ({ ...c, role: c.character })), ...(p.combined_credits?.crew || []).map(c => ({ ...c, role: c.job }))]
      .filter(c => c.media_type === "movie" || c.media_type === "tv")
      .filter(c => !(c.genre_ids || []).some(g => g === 10767 || g === 10763) && !/^(self|himself|herself|themselves)\b/i.test(c.character || ""))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .filter(c => { const k = c.media_type + c.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 60)
      .map(c => ({ ...card(c, c.media_type), role: c.role || "" }));
    return {
      id: p.id, name: p.name, photo: img(p.profile_path, "h632"), biography: p.biography, knownFor: p.known_for_department,
      born: p.birthday, died: p.deathday, birthplace: p.place_of_birth, imdb: p.external_ids?.imdb_id || null, credits,
    };
  }).catch(missingAsNull);
}

export async function search(q) {
  if (!hasKey() || !q) return { titles: [], people: [] };
  return cached("s-" + q.toLowerCase(), HOUR, async () => {
    const r = await tmdb("/search/multi", { query: q, region: "GB", include_adult: "false" });
    return {
      titles: r.results.filter(x => x.media_type === "movie" || x.media_type === "tv").map(x => card(x)),
      people: r.results.filter(x => x.media_type === "person").map(x => ({ id: x.id, name: x.name, photo: img(x.profile_path, "w185"), knownFor: x.known_for_department })),
    };
  });
}

// Browse by type, genre, language, country, platform.
export async function explore({ type = "movie", genre, language, country, provider, sort = "popularity.desc", page = 1 }) {
  if (!hasKey()) return { titles: [], page: 1, totalPages: 0 };
  const params = { sort_by: sort, page, watch_region: "GB", "vote_count.gte": sort.startsWith("vote_average") ? 200 : 0 };
  if (sort.includes("date.desc")) params[type === "tv" ? "first_air_date.lte" : "primary_release_date.lte"] = today();
  if (genre) params.with_genres = genre;
  if (language) params.with_original_language = language;
  if (country) params.with_origin_country = country;
  if (provider && PROVIDER_IDS[provider]) { params.with_watch_providers = PROVIDER_IDS[provider]; params.with_watch_monetization_types = "flatrate|free|ads"; }
  const k = "e-" + JSON.stringify([type, params]);
  return cached(k, 6 * HOUR, async () => {
    const r = await tmdb(`/discover/${type}`, params);
    return { titles: r.results.map(x => card(x, type)), page: r.page, totalPages: Math.min(r.total_pages, 50) };
  });
}

export async function filters() {
  if (!hasKey()) return { genres: { movie: [], tv: [] }, languages: [], providers: Object.keys(PROVIDER_IDS) };
  return cached("filters", 24 * HOUR, async () => {
    const [gm, gt, langs] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list"), tmdb("/configuration/languages")]);
    const common = ["en", "hi", "ko", "ja", "es", "fr", "de", "it", "ta", "te", "ml", "pa", "ur", "pl", "tr", "da", "sv", "no", "zh", "pt", "cy", "ga"];
    return {
      genres: { movie: gm.genres, tv: gt.genres },
      languages: langs.filter(l => common.includes(l.iso_639_1)).map(l => ({ code: l.iso_639_1, name: l.english_name })).sort((a, b) => a.name.localeCompare(b.name)),
      countries: [["GB", "United Kingdom"], ["US", "United States"], ["IN", "India"], ["KR", "South Korea"], ["JP", "Japan"], ["IE", "Ireland"], ["FR", "France"], ["ES", "Spain"], ["DE", "Germany"], ["DK", "Denmark"], ["SE", "Sweden"], ["AU", "Australia"], ["CA", "Canada"]].map(([code, name]) => ({ code, name })),
      providers: Object.keys(PROVIDER_IDS),
    };
  });
}

// Release calendar entries from TVmaze carry an IMDb id; resolve it to a TMDB page when opened.
export async function findByImdb(imdb) {
  if (!hasKey() || !/^tt\d+$/.test(imdb)) return null;
  return cached("f-" + imdb, 24 * HOUR, async () => {
    const r = await tmdb(`/find/${imdb}`, { external_source: "imdb_id" });
    const hit = r.tv_results?.[0] ? card(r.tv_results[0], "tv") : r.movie_results?.[0] ? card(r.movie_results[0], "movie") : null;
    return hit?.key || null;
  });
}
