// Stand-in for the TMDB API so the whole site can be exercised without a key.
// Titles come from data/releases.json (real UK releases); everything else is generated.
// Run: node mock/tmdb-mock.js   then start the server with
//      TMDB_API_KEY=mock TMDB_BASE=http://localhost:4010/3 node server.js
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.MOCK_PORT || 4010);
let src = [];
try { src = JSON.parse(fs.readFileSync(new URL("../data/releases.json", import.meta.url), "utf8")).releases; } catch {}
if (!src.length) src = [{ title: "Example Show", type: "series", date: "2026-10-20", overview: "An example." }];

const movies = [], shows = [];
src.forEach((r, i) => {
  const base = { id: 1000 + i, overview: r.overview || "No synopsis yet.", poster_path: null, backdrop_path: null, popularity: 100 - (i % 100), vote_average: 6 + (i % 4), original_language: r.language === "English" || !r.language ? "en" : "es", genre_ids: [18] };
  if (r.type === "film") movies.push({ ...base, title: r.title, release_date: r.date });
  else shows.push({ ...base, name: r.title, first_air_date: r.date });
});
if (!movies.length) ["Paddington in Peru", "Wicked: For Good", "28 Years Later", "The Beekeeper 2", "Mission: Impossible", "Bridget Jones"].forEach((t, i) =>
  movies.push({ id: 5000 + i, title: t, release_date: `2026-${String(9 + (i % 3)).padStart(2, "0")}-${String(5 + i * 4).padStart(2, "0")}`, overview: "A film used for testing.", poster_path: null, backdrop_path: null, popularity: 50 - i, original_language: "en", genre_ids: [28] }));

const people = [{ id: 1, name: "Olivia Colman" }, { id: 2, name: "Stephen Graham" }, { id: 3, name: "Florence Pugh" }, { id: 4, name: "Mike Flanagan" }];
const page = list => ({ page: 1, total_pages: 1, total_results: list.length, results: list.slice(0, 20) });
const find = id => movies.find(m => m.id === id) || shows.find(s => s.id === id);
const providers = { GB: { link: "https://www.themoviedb.org", flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: null }], rent: [{ provider_id: 2, provider_name: "Apple TV Store", logo_path: null }] } };

function detail(type, id) {
  const t = find(id); if (!t) return null;
  return {
    ...t, tagline: "A tagline for testing.", runtime: 112, episode_run_time: [52], status: "Released",
    genres: [{ id: 18, name: "Drama" }, { id: 53, name: "Thriller" }],
    production_countries: [{ iso_3166_1: "GB", name: "United Kingdom" }], origin_country: ["GB"],
    created_by: type === "tv" ? [{ id: 4, name: "Mike Flanagan" }] : undefined,
    seasons: type === "tv" ? [{ season_number: 1, name: "Season 1", episode_count: 8, air_date: t.first_air_date }] : undefined,
    networks: type === "tv" ? [{ name: "Netflix" }] : undefined,
    credits: { cast: people.slice(0, 3).map((p, i) => ({ ...p, character: ["Lead", "Detective", "Mother"][i] })), crew: type === "movie" ? [{ ...people[3], job: "Director" }] : [] },
    videos: { results: [{ site: "YouTube", type: "Trailer", key: "dQw4w9WgXcQ", name: "Official Trailer" }] },
    "watch/providers": { results: providers },
    release_dates: { results: [{ iso_3166_1: "GB", release_dates: [{ type: 3, release_date: (t.release_date || "2026-10-10") + "T00:00:00Z", certification: "15" }] }] },
    content_ratings: { results: [{ iso_3166_1: "GB", rating: "15" }] },
    keywords: { keywords: [{ name: "based on novel" }, { name: "small town" }], results: [{ name: "based on novel" }] },
    recommendations: page((type === "movie" ? movies : shows).filter(x => x.id !== id).slice(0, 8)),
    external_ids: { imdb_id: "tt0000001" },
  };
}

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); const p = u.pathname.replace(/^\/3/, "");
  let out = null, m;
  if (p === "/trending/all/week") out = page([...shows.map(s => ({ ...s, media_type: "tv" })), ...movies.map(x => ({ ...x, media_type: "movie" }))].sort((a, b) => b.popularity - a.popularity));
  else if (p === "/movie/now_playing" || p === "/movie/upcoming") out = page(movies);
  else if ((m = p.match(/^\/discover\/(movie|tv)$/))) out = page(m[1] === "movie" ? movies : shows);
  else if ((m = p.match(/^\/(movie|tv)\/(\d+)$/))) out = detail(m[1], +m[2]);
  else if ((m = p.match(/^\/(movie|tv)\/(\d+)\/videos$/))) out = { results: +m[2] % 3 === 0 ? [{ site: "YouTube", type: "Trailer", key: "x", published_at: new Date(Date.now() - 2 * 864e5).toISOString() }] : [] };
  else if ((m = p.match(/^\/movie\/(\d+)\/release_dates$/))) out = detail("movie", +m[1])?.release_dates;
  else if ((m = p.match(/^\/movie\/(\d+)\/watch\/providers$/))) out = { results: providers };
  else if ((m = p.match(/^\/person\/(\d+)$/))) { const pp = people.find(x => x.id === +m[1]); out = pp && { ...pp, biography: `${pp.name} is a performer used for testing.`, known_for_department: "Acting", birthday: "1980-01-01", place_of_birth: "London, England, UK", combined_credits: { cast: [...shows.slice(0, 6).map(s => ({ ...s, media_type: "tv", character: "Lead" })), ...movies.slice(0, 4).map(x => ({ ...x, media_type: "movie", character: "Support" }))], crew: [] }, external_ids: {} }; }
  else if (p === "/search/multi") { const q = (u.searchParams.get("query") || "").toLowerCase(); out = page([...shows.filter(s => s.name.toLowerCase().includes(q)).map(s => ({ ...s, media_type: "tv" })), ...movies.filter(x => x.title.toLowerCase().includes(q)).map(x => ({ ...x, media_type: "movie" })), ...people.filter(x => x.name.toLowerCase().includes(q)).map(x => ({ ...x, media_type: "person", known_for_department: "Acting" }))]); }
  else if ((m = p.match(/^\/genre\/(movie|tv)\/list$/))) out = { genres: [{ id: 18, name: "Drama" }, { id: 35, name: "Comedy" }, { id: 53, name: "Thriller" }, { id: 28, name: "Action" }] };
  else if (p === "/configuration/languages") out = [{ iso_639_1: "en", english_name: "English" }, { iso_639_1: "es", english_name: "Spanish" }, { iso_639_1: "hi", english_name: "Hindi" }];
  else if ((m = p.match(/^\/find\//))) out = { tv_results: shows.slice(0, 1), movie_results: [] };
  res.writeHead(out ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify(out || { status_message: "Not found in mock" }));
}).listen(PORT, () => console.log(`Mock TMDB on http://localhost:${PORT}/3 (${shows.length} shows, ${movies.length} films)`));
