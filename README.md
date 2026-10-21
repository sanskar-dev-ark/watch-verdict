# Telly Verdict

A UK guide to new films and series in cinemas, on streaming and on TV, rated and reviewed by the people who watched them. Modelled on Moctale, focused on the UK.

## Features

- **Home**: Talk of the Town (trending, with New film / New show / Coming soon badges), In UK cinemas now, Coming to UK cinemas, Don't miss on Netflix / Prime Video / Disney+ / Apple TV / BBC iPlayer / NOW, editor's picks, latest reviews.
- **Title pages**: backdrop, poster, type, year, runtime, seasons, director or showrunner, country, language, BBFC age rating, UK cinema and streaming dates, genres and tags, overview, where to watch in the UK (stream, rent, buy), cast and crew, trailer, recommendations.
- **Verdicts**: Skip, Timepass, Go for it, Perfection, plus optional 1–10 scores for Story, Acting, Direction, Visuals, Sound and Pacing. The verdict meter shows the share saying Go for it or Perfection.
- **Reviews**: one per person per title, spoiler flag, likes, comments, sort by top or newest, filter by verdict.
- **Discussion**: a chat thread on every title, with spoiler marking.
- **Tracking**: Mark as watched, Watch later, and personal collections.
- **People**: actor and crew pages with biography and filmography.
- **Explore**: by films or shows, genre, language, country, UK streaming service, sorted by popularity, newest or rating.
- **UK release calendar**: cinema, streaming and TV releases grouped by week, filterable by service.
- **Community**: accounts, profiles (watched, reviews, watch later, collections, verdict split), follow people, following feed, community top-rated chart, member search.
- **Points, levels and badges**: points for verdicts, reviews, likes received, comments, discussion, watching and followers, with daily caps on easy actions. Seven levels (Extra, Walk-on, Supporting, Lead, Star, Auteur, Legend) and 11 badges. Progress shows on every profile, and every name carries its level.
- **Leaderboard**: top members this week, this month and all time, most-liked reviews for the same periods, and a "How points work" guide.
- **Moderation**: report buttons on reviews, comments, discussion messages, profiles and collections; an admin queue at `/admin` (remove, dismiss, block member); blocked words; at most one link per post. Removed authors are told why. Blocked members can read but not post. All of this is enforced in the database.
- **Notifications**: likes, comments and new followers (created by the database), plus a daily alert when a title on your Watch later list arrives on a UK service or in cinemas (`npm run notify`).
- **Share cards**: a 1080×1920 image of your verdict for Instagram and Snapchat stories.
- **Cinema tickets**: links to ODEON, Cineworld, Vue, Everyman and Picturehouse on films in or coming to UK cinemas. Set `AFFILIATE_URL_TEMPLATE` once you join an affiliate network.
- **Your data (UK GDPR)**: settings page to edit your profile, download everything as JSON and delete your account. Privacy, terms and community rules pages (drafts to check before launch).
- **Installable**: web app manifest, icon and offline page.
- **Editors**: the first account created is the admin. Admins can turn any collection into a home-page editor's pick and remove any review or comment.

## Search engines (SEO)

- **Readable addresses**: `/film/paddington-in-peru-2024-516729`, `/show/carrie-2026-246001`, `/person/olivia-colman-39187`. The trailing number is the TMDB id. Old `/title/tv-123` links, bare ids and misspelt slugs redirect (301) to the correct address.
- **Server-rendered pages**: home, title, person, release calendar (including `?kind=` and `?where=` versions), profiles and collections are sent as real HTML with a page title, description, canonical link, Open Graph and Twitter tags, and JSON-LD (Movie or TVSeries with cast, director, BBFC rating, trailer, community rating and reviews; Person; WebSite search; BreadcrumbList; ItemList). The app takes over in the browser.
- **Status codes**: unknown pages return 404; if TMDB is down, pages return 503 so search engines retry instead of indexing an empty page.
- **Kept out of the index**: search, following feed, profiles with no written reviews, collections with fewer than 3 titles.
- **`/sitemap.xml`** lists the home page, release calendars, explore, every title seen on the site, profiles with reviews and collections. **`/robots.txt`** points to it and blocks `/api/`.
- Set `SITE_URL` in `.env` to the live domain (for example `https://tellyverdict.co.uk`) so canonical links and the sitemap use it. Submit the sitemap in Google Search Console after launch.

## Hosting

`render.yaml` deploys to Render as one always-on web service in Frankfurt (closest to the London database). With `RUN_JOBS=true` the server also runs the daily jobs: rebuilding the release calendar and sending Watch later alerts. Fill in the secret values in the Render dashboard, point your domain at it, set `SITE_URL`, then submit `/sitemap.xml` in Google Search Console.

Points are cached in the `user_points` table, refreshed every 5 minutes by a scheduled database job (`pg_cron`).

## Setup

1. Get a free TMDB API key: https://www.themoviedb.org/settings/api
2. `cp .env.example .env` and paste the key into `TMDB_API_KEY`.
3. `npm run releases` builds the UK release calendar.
4. `npm start` and open http://localhost:3000. Sign up: the first account becomes the admin.

No `npm install` needed. Requires Node 18+.

### Trying it without a TMDB key

`npm run mock` starts a stand-in TMDB built from the release calendar. In a second terminal, `npm run dev:mock` starts the site against it. Community data still goes to Supabase.

## Data sources

| Data | Source | Key |
|---|---|---|
| Titles, posters, cast, crew, UK certificates, UK cinema and digital dates, UK streaming availability, people, search, trending | TMDB (availability from JustWatch) | Free, non-commercial |
| UK TV and streaming series premieres for the calendar | TVmaze | None (credit TVmaze, CC BY-SA) |

TMDB's free key is for non-commercial use. A site with ads or subscriptions needs a commercial agreement with TMDB. Keep the TMDB and JustWatch credit in the footer.

## UK release calendar

`npm run releases` writes `data/releases.json`: every UK release from 14 days ago to 60 days ahead (or `node releases.js --from 2026-10-01 --to 2026-12-31`). Run it daily.

| Kind | What | Source | Key needed |
|---|---|---|---|
| `tv` | New series and season premieres on UK channels | TVmaze | No |
| `streaming` | Series premieres on Netflix, Prime Video, Apple TV, Disney+, Paramount+, BBC iPlayer, ITVX, discovery+, etc. | TVmaze | No |
| `streaming` | Films released to UK streaming or digital rental | TMDB | Yes |
| `cinema` | Films opening in UK cinemas, with BBFC certificate | TMDB | Yes |

Example crontab line (03:00 every day):

```
0 3 * * * cd /path/to/telly-verdict && /usr/local/bin/node releases.js >> releases.log 2>&1
```

## Where things live

| File | Purpose |
|---|---|
| `server.js` | Routes: accounts, catalogue, reviews, lists, follows, calendar |
| `lib/catalog.js` | TMDB queries shaped for the site, with caching |
| `lib/seo.js` | Server-rendered pages, addresses, structured data, sitemap, robots.txt |
| `lib/points.js` | Points rules (display), levels and badges. Points are calculated by `point_events()` in the database |
| `lib/community.js` | Community data in Supabase: profiles, reviews, likes, comments, follows, lists, collections, discussion, points |
| `lib/supa.js` | Small Supabase client: reads, member writes with their own token, login verification |
| `lib/tmdb.js` | TMDB client and UK service IDs |
| `releases.js` | UK release calendar builder |
| `mock/tmdb-mock.js` | Stand-in TMDB for local testing |
| `public/` | Front end (single-page app) |

## Accounts and data (Supabase)

Project **telly-verdict** (`surjlsrmbrsouurhmwhv`, London). Sign-up, login, email verification, password reset and Google sign-in run in the browser through Supabase Auth. The server checks each request's access token with Supabase and writes with the member's own token, so the database's row-level security applies to everything a member changes.

**Tables**: `profiles` (created automatically at sign-up; the first account becomes admin), `titles` (snapshot from TMDB, written by the server only), `reviews`, `review_likes`, `review_comments`, `follows`, `marks` (watched / watch later), `collections`, `collection_items`, `discussion`.

**Rules enforced in the database**: everyone can read; members change only their own rows; admins can delete any review, comment, collection or discussion post; nobody can like their own review, make themselves admin or create editor's picks unless admin; one discussion post per 3 seconds.

**Points** come from `point_events()`; `leaderboard()`, `title_stats()`, `top_titles()`, `top_reviews()`, `badge_stats()` and `points_rank()` build on it.

### Supabase dashboard settings to finish

1. **Secret key**: Project Settings → API Keys → create a secret key and paste it into `.env` as `SUPABASE_SECRET_KEY`. Without it, members can't rate or list titles the site hasn't stored yet.
2. **URLs**: Authentication → URL Configuration. Site URL = your live domain. Redirect URLs: add `http://localhost:3000/**` (and your live domain with `/**`).
3. **Emails**: Authentication → Emails. Set up custom SMTP (Resend, Postmark or SES) before launch; the built-in sender only allows a few emails an hour. Edit the confirmation and reset templates to say Telly Verdict.
4. **Bot protection**: create a Cloudflare Turnstile widget, turn on Authentication → Attack Protection → CAPTCHA with its secret, and put the site key in `.env` as `TURNSTILE_SITE_KEY`.
5. **Google sign-in**: Authentication → Providers → Google with a Google Cloud OAuth client, then set `GOOGLE_SIGN_IN=true`.
6. **Passwords**: Attack Protection → minimum length 8 and leaked-password protection.

## Before going public

- Finish the dashboard settings above.
- Add moderation: report buttons, a profanity filter and an admin queue.
- Have the privacy policy and terms checked, and add your company details.
- Replace the cinema listing links with affiliate deep links.
