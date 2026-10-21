// Daily job: tell members when a title on their Watch later list arrives in the UK,
// either on a streaming service or in cinemas. Needs TMDB_API_KEY and SUPABASE_SECRET_KEY.
// Run: node notify-arrivals.js
import * as catalog from "./lib/catalog.js";
import * as C from "./lib/community.js";
import { canWriteTitles, configured } from "./lib/supa.js";
import { hasKey } from "./lib/tmdb.js";

if (!configured() || !canWriteTitles() || !hasKey()) {
  console.error("Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and TMDB_API_KEY in .env.");
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const byKey = await C.watchLaterKeys();
let sent = 0;
for (const [key, users] of byKey) {
  const t = await catalog.title(key).catch(() => null);
  if (!t) continue;
  const stream = t.whereToWatch?.stream?.[0]?.name;
  // One notification per arrival kind, so a later move to streaming still gets its own alert.
  if (stream) sent += await C.notifyArrival(users, key, `Now streaming in the UK on ${stream}`);
  else if (t.type === "movie" && t.ukCinema && t.ukCinema <= today) sent += await C.notifyArrival(users, key, "Now showing in UK cinemas");
}
console.log(`Checked ${byKey.size} titles on Watch later lists; sent ${sent} notifications.`);
