import "./env.js";

const BASE = process.env.TMDB_BASE || "https://api.themoviedb.org/3"; // TMDB_BASE lets tests point at mock/tmdb-mock.js
export const IMG = "https://image.tmdb.org/t/p/";

// UK (GB) watch-provider IDs on TMDB. Run `node sync.js --providers` to check the live list.
export const PROVIDERS = [
  { id: 8, name: "Netflix" },
  { id: 9, name: "Prime Video" },
  { id: 350, name: "Apple TV" },
  { id: 337, name: "Disney+" },
  { id: 39, name: "NOW" },
  { id: 38, name: "BBC iPlayer" },
  { id: 41, name: "ITVX" },
  { id: 103, name: "Channel 4" },
  { id: 531, name: "Paramount+" },
  { id: 584, name: "discovery+" },
];

export function hasKey() {
  return Boolean(process.env.TMDB_API_KEY);
}

export async function tmdb(path, params = {}) {
  if (!hasKey()) throw new Error("TMDB_API_KEY is missing. Copy .env.example to .env and add your key.");
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  url.searchParams.set("language", "en-GB");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (!res.ok) { const e = new Error(`TMDB ${res.status} on ${path}`); e.status = res.status; throw e; }
    return res.json();
  }
  throw new Error(`TMDB rate limit on ${path}`);
}
