// Server-rendered pages for search engines and link previews.
// Each public route returns real HTML (title, description, canonical, Open Graph,
// JSON-LD and readable content with internal links). The single-page app then takes over.
import * as catalog from "./catalog.js";
import * as C from "./community.js";
import { configured } from "./supa.js";

export const SITE = () => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
const NAME = "Sofa Verdict";
const VERDICTS = ["Skip", "Timepass", "Go for it", "Perfection"];

// ---------- URLs ----------
export function slugify(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}
// /film/paddington-in-peru-2024-516729, /show/carrie-2026-246001 (the trailing number is the TMDB id)
export function titlePath(key, title, year) {
  const [type, id] = key.split("-");
  const slug = [slugify(title), year].filter(Boolean).join("-");
  return `/${type === "movie" ? "film" : "show"}/${slug ? slug + "-" : ""}${id}`;
}
export const personPath = (id, name) => `/person/${slugify(name) ? slugify(name) + "-" : ""}${id}`;
export function parseTitlePath(pathname) {
  const m = pathname.match(/^\/(film|show)\/(?:[a-z0-9-]*-)?(\d+)$/);
  return m ? `${m[1] === "film" ? "movie" : "tv"}-${m[2]}` : null;
}
export function parsePersonPath(pathname) {
  const m = pathname.match(/^\/person\/(?:[a-z0-9-]*-)?(\d+)$/);
  return m ? m[1] : null;
}

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const fmtDate = d => d ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function head({ title, description, path, image, type = "website", noindex = false, ld = [] }) {
  const url = SITE() + path;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(clip(description, 160))}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    noindex ? `<meta name="robots" content="noindex, follow">` : `<meta name="robots" content="index, follow, max-image-preview:large">`,
    `<meta property="og:site_name" content="${NAME}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(clip(description, 200))}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(clip(description, 200))}">`,
    image ? `<meta name="twitter:image" content="${esc(image)}">` : "",
    ...ld.map(jsonLd),
  ].filter(Boolean).join("\n");
}
const crumbs = items => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE() + path })),
});
const cardLink = t => `<li><a href="${titlePath(t.key, t.title, t.year)}">${esc(t.title)}${t.year ? ` (${t.year})` : ""}</a></li>`;

// ---------- pages ----------
const NO_STATS = { votes: 0, verdicts: [0, 0, 0, 0], meter: null };
async function titlePage(key, pathname) {
  const t = await catalog.title(key);
  if (!t) return null;
  const canonical = titlePath(t.key, t.title, t.year);
  if (pathname !== canonical) return { redirect: canonical };
  const [st, allReviews] = configured()
    ? await Promise.all([C.titleStats(t.key), C.reviewsFor(t.key, { sort: "top" })]).catch(() => [NO_STATS, []])
    : [NO_STATS, []];
  const isFilm = t.type === "movie";
  const kind = isFilm ? "Film" : "TV series";
  const reviews = allReviews.filter(r => r.text && !r.spoiler).slice(0, 10);
  const directors = t.crew.filter(c => ["Director", "Creator"].includes(c.job));
  const streams = t.whereToWatch?.stream?.map(p => p.name) || [];
  const verdictLine = st.votes ? `${st.meter}% of ${st.votes} Sofa Verdict members say Go for it or Perfection.` : "";
  const whereLine = streams.length ? `Watch in the UK on ${streams.slice(0, 3).join(", ")}.` : t.ukCinema && t.ukCinema >= new Date().toISOString().slice(0, 10) ? `In UK cinemas from ${fmtDate(t.ukCinema)}.` : "";
  const description = [verdictLine, whereLine, t.overview].filter(Boolean).join(" ");
  const ld = {
    "@context": "https://schema.org", "@type": isFilm ? "Movie" : "TVSeries",
    name: t.title, url: SITE() + canonical, description: t.overview || undefined,
    image: t.poster || undefined,
    datePublished: (isFilm ? t.ukCinema || t.date : t.date) || undefined,
    genre: t.genres.map(g => g.name),
    inLanguage: t.languages[0] || undefined,
    countryOfOrigin: t.countries.map(c => ({ "@type": "Country", name: c.name })),
    contentRating: t.certification ? `BBFC ${t.certification}` : undefined,
    duration: isFilm && t.runtime ? `PT${t.runtime}M` : undefined,
    numberOfSeasons: !isFilm && t.seasons?.length ? t.seasons.length : undefined,
    [isFilm ? "director" : "creator"]: directors.map(p => ({ "@type": "Person", name: p.name, url: SITE() + personPath(p.id, p.name) })),
    actor: t.cast.slice(0, 10).map(p => ({ "@type": "Person", name: p.name, url: SITE() + personPath(p.id, p.name) })),
    sameAs: t.imdb ? [`https://www.imdb.com/title/${t.imdb}/`] : undefined,
    trailer: t.trailer ? { "@type": "VideoObject", name: `${t.title} trailer`, embedUrl: `https://www.youtube.com/embed/${t.trailer.youtube}`, thumbnailUrl: `https://img.youtube.com/vi/${t.trailer.youtube}/hqdefault.jpg`, uploadDate: t.date || undefined } : undefined,
    aggregateRating: st.votes ? { "@type": "AggregateRating", ratingValue: st.meter, bestRating: 100, worstRating: 0, ratingCount: st.votes } : undefined,
    review: reviews.slice(0, 5).map(r => ({ "@type": "Review", author: { "@type": "Person", name: r.author?.name || "Member" }, datePublished: new Date(r.createdAt).toISOString().slice(0, 10), reviewBody: clip(r.text, 500), name: VERDICTS[r.verdict] })),
  };
  const body = `<article class="ssr">
    <nav class="note"><a href="/">Home</a> › <a href="/explore?type=${t.type}">${isFilm ? "Films" : "Shows"}</a> › ${esc(t.title)}</nav>
    <h1>${esc(t.title)}${t.year ? ` (${t.year})` : ""}</h1>
    <p class="label">${kind}${t.runtime ? ` · ${t.runtime} min${isFilm ? "" : " per episode"}` : ""}${t.certification ? ` · BBFC ${esc(t.certification)}` : ""}${t.genres.length ? ` · ${esc(t.genres.map(g => g.name).join(", "))}` : ""}</p>
    ${t.poster ? `<img src="${esc(t.poster)}" alt="${esc(t.title)} poster" width="342" height="513">` : ""}
    ${t.tagline ? `<p><i>${esc(t.tagline)}</i></p>` : ""}
    <h2>Overview</h2><p>${esc(t.overview || "No synopsis yet.")}</p>
    <dl>
      ${directors.length ? `<dt>${isFilm ? "Director" : "Created by"}</dt><dd>${directors.map(p => `<a href="${personPath(p.id, p.name)}">${esc(p.name)}</a>`).join(", ")}</dd>` : ""}
      ${t.countries.length ? `<dt>Country</dt><dd>${esc(t.countries.map(c => c.name).join(", "))}</dd>` : ""}
      ${t.ukCinema ? `<dt>UK cinema release</dt><dd>${fmtDate(t.ukCinema)}</dd>` : ""}
      ${t.ukDigital ? `<dt>UK streaming and digital</dt><dd>${fmtDate(t.ukDigital)}</dd>` : ""}
      ${t.networks?.length ? `<dt>Network</dt><dd>${esc(t.networks.join(", "))}</dd>` : ""}
    </dl>
    <h2>Where to watch ${esc(t.title)} in the UK</h2>
    <p>${streams.length ? `Stream on ${esc(streams.join(", "))}.` : "Not streaming in the UK yet."}${t.whereToWatch?.rent?.length ? ` Rent on ${esc(t.whereToWatch.rent.map(p => p.name).join(", "))}.` : ""}</p>
    <h2>Sofa Verdict</h2>
    <p>${st.votes ? `${st.meter}% say Go for it or Perfection (${st.votes} vote${st.votes === 1 ? "" : "s"}): ${VERDICTS.map((v, i) => `${v} ${st.verdicts[i]}`).join(", ")}.` : "No verdicts yet. Be the first to rate it."}</p>
    ${t.cast.length ? `<h2>Cast</h2><ul>${t.cast.map(p => `<li><a href="${personPath(p.id, p.name)}">${esc(p.name)}</a>${p.character ? ` as ${esc(p.character)}` : ""}</li>`).join("")}</ul>` : ""}
    ${reviews.length ? `<h2>Reviews</h2>${reviews.map(r => `<blockquote><p>${esc(clip(r.text, 600))}</p><footer>${esc(r.author?.name || "Member")} · ${VERDICTS[r.verdict]}</footer></blockquote>`).join("")}` : ""}
    ${t.recommendations.length ? `<h2>If you liked ${esc(t.title)}</h2><ul>${t.recommendations.map(cardLink).join("")}</ul>` : ""}
  </article>`;
  return {
    head: head({
      title: `${t.title}${t.year ? ` (${t.year})` : ""} – reviews, verdict and where to watch in the UK | ${NAME}`,
      description, path: canonical, image: t.backdrop || t.poster, type: isFilm ? "video.movie" : "video.tv_show",
      ld: [ld, crumbs([["Home", "/"], [isFilm ? "Films" : "Shows", `/explore?type=${t.type}`], [t.title, canonical]])],
    }),
    body, title: t,
  };
}

async function personPage(id, pathname) {
  const p = await catalog.person(id);
  if (!p) return null;
  const canonical = personPath(p.id, p.name);
  if (pathname !== canonical) return { redirect: canonical };
  const known = p.credits.slice(0, 6).map(c => c.title).join(", ");
  return {
    head: head({
      title: `${p.name} – films and TV shows | ${NAME}`,
      description: `${p.name}${p.knownFor ? `, ${p.knownFor.toLowerCase()}` : ""}. Known for ${known}. ${p.biography || ""}`,
      path: canonical, image: p.photo, type: "profile",
      ld: [{ "@context": "https://schema.org", "@type": "Person", name: p.name, url: SITE() + canonical, image: p.photo || undefined, birthDate: p.born || undefined, deathDate: p.died || undefined, birthPlace: p.birthplace || undefined, description: clip(p.biography, 500) || undefined, sameAs: p.imdb ? [`https://www.imdb.com/name/${p.imdb}/`] : undefined }],
    }),
    body: `<article class="ssr"><h1>${esc(p.name)}</h1>${p.birthplace ? `<p>Born ${fmtDate(p.born)} in ${esc(p.birthplace)}</p>` : ""}<p>${esc(p.biography)}</p>
      <h2>Films and TV shows</h2><ul>${p.credits.map(c => `<li><a href="${titlePath(c.key, c.title, c.year)}">${esc(c.title)}${c.year ? ` (${c.year})` : ""}</a>${c.role ? ` · ${esc(c.role)}` : ""}</li>`).join("")}</ul></article>`,
  };
}

async function homePage() {
  const h = await catalog.home([]).catch(() => ({ rails: [] }));
  return {
    head: head({
      title: `${NAME} – what's new in UK cinemas and on streaming, rated`,
      description: "New films and series in UK cinemas and on Netflix, Prime Video, Apple TV, Disney+, NOW, BBC iPlayer, ITVX and Channel 4, with verdicts and reviews from people who've watched them.",
      path: "/",
      ld: [{ "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE() + "/", inLanguage: "en-GB", potentialAction: { "@type": "SearchAction", target: `${SITE()}/search?q={query}`, "query-input": "required name=query" } }],
    }),
    body: `<article class="ssr"><h1>What's new in UK cinemas and on streaming, and is it any good?</h1>
      <p><a href="/releases">UK release calendar</a> · <a href="/explore">Explore</a> · <a href="/top">Top rated</a> · <a href="/leaderboard">Leaderboard</a></p>
      ${h.rails.map(r => `<h2>${esc(r.title)}</h2><ul>${r.items.map(cardLink).join("")}</ul>`).join("")}</article>`,
  };
}

function releasesPage(releases, query) {
  const kind = query.get("kind"); const where = query.get("where");
  const label = { cinema: "UK cinema releases", streaming: "New on UK streaming", tv: "New UK TV series" }[kind] || "UK release calendar";
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (releases || []).filter(r => r.date >= today && (!kind || r.kind === kind) && (!where || r.where === where)).slice(0, 150);
  const name = where ? `New on ${where} UK` : label;
  const path = "/releases" + (kind || where ? "?" + new URLSearchParams({ ...(kind && { kind }), ...(where && { where }) }) : "");
  const link = r => r.ids?.tmdb ? `<a href="${titlePath((r.type === "film" ? "movie-" : "tv-") + r.ids.tmdb, r.title, r.date?.slice(0, 4))}">${esc(r.title)}</a>` : esc(r.title);
  return {
    head: head({
      title: `${name}: what's out this week and coming soon | ${NAME}`,
      description: `${name}: every new film and series coming to ${where || "UK cinemas, streaming services and TV"}, week by week, with release dates.`,
      path,
      ld: [{ "@context": "https://schema.org", "@type": "ItemList", name, itemListElement: upcoming.slice(0, 50).map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${r.title} (${r.where}, ${r.date})` })) }],
    }),
    body: `<article class="ssr"><h1>${esc(name)}</h1><ul>${upcoming.map(r => `<li><time datetime="${r.date}">${fmtDate(r.date)}</time>: ${link(r)} · ${esc(r.where)} · ${esc(r.label)}</li>`).join("")}</ul></article>`,
  };
}

const simple = (title, description, path, noindex = false) => ({ head: head({ title: `${title} | ${NAME}`, description, path, noindex }), body: `<article class="ssr"><h1>${esc(title)}</h1><p>${esc(description)}</p></article>` });

// Returns { head, body, status?, redirect? } or null when the path isn't a page route.
export async function renderRoute(pathname, query, { releases }) {
  let m, key;
  if (pathname === "/") return homePage();
  if ((key = parseTitlePath(pathname))) return (await titlePage(key, pathname)) || notFound();
  if ((m = pathname.match(/^\/title\/((?:movie|tv)-\d+)$/))) {           // old addresses
    const t = await catalog.title(m[1]).catch(() => null);
    return t ? { redirect: titlePath(t.key, t.title, t.year) } : notFound();
  }
  if ((m = parsePersonPath(pathname))) return (await personPage(m, pathname)) || notFound();
  if (pathname === "/releases") return releasesPage(releases, query);
  if (pathname === "/explore") return simple("Explore films and shows", "Browse films and TV by genre, language, country and UK streaming service.", "/explore");
  if (pathname === "/top") return simple("Top rated by the community", "The films and shows Sofa Verdict members rate highest.", "/top");
  if (pathname === "/leaderboard") return simple("Leaderboard", "The most active reviewers on Sofa Verdict this week, this month and of all time.", "/leaderboard");
  if (pathname === "/privacy") return simple("Privacy", "How Sofa Verdict collects, uses and protects your personal data, and your rights under UK GDPR.", pathname);
  if (pathname === "/terms") return simple("Terms of use", "The terms for using Sofa Verdict.", pathname);
  if (pathname === "/rules") return simple("Community rules", "Mark spoilers, review the title not the people, no hate, harassment or spam.", pathname);
  if (["/notifications", "/settings", "/admin"].includes(pathname)) return simple({ "/notifications": "Notifications", "/settings": "Settings", "/admin": "Moderation" }[pathname], "Sofa Verdict account", pathname, true);
  if (pathname === "/reset-password" || pathname === "/auth/callback") return simple(pathname === "/reset-password" ? "Reset your password" : "Signing you in", "Sofa Verdict account", pathname, true);
  if (pathname === "/search" || pathname === "/feed") return simple(pathname === "/search" ? "Search" : "Following", "Search films, shows, people and members.", pathname, true);
  if ((m = pathname.match(/^\/u\/([a-z0-9_]+)$/))) {
    const u = configured() ? await C.userByUsername(m[1]) : null;
    if (!u) return notFound();
    const n = (await C.userReviews(u.id)).filter(r => r.text).length;
    return simple(`${u.name} (@${u.username})`, `${u.name}'s film and TV verdicts and reviews on Sofa Verdict. ${n} review${n === 1 ? "" : "s"}.${u.bio ? " " + u.bio : ""}`, pathname, n === 0);
  }
  if ((m = pathname.match(/^\/collection\/([\w-]+)$/))) {
    const c = configured() ? await C.collection(m[1]) : null;
    if (!c) return notFound();
    const page = simple(c.name, `${c.name}: a collection of ${c.count} films and shows by @${c.owner?.username}. ${c.description}`, pathname, c.count < 3);
    page.body = page.body.replace("</article>", `<ul>${c.items.map(cardLink).join("")}</ul></article>`);
    return page;
  }
  return notFound();
}
function notFound() { return { status: 404, ...simple("Page not found", "We couldn't find that page.", "/404", true) }; }

// ---------- sitemap and robots ----------
export function sitemap(data, releases, homeKeys = []) {
  const now = new Date().toISOString().slice(0, 10);
  const urls = new Map();
  const add = (path, lastmod = now, priority = "0.6") => urls.set(path, { lastmod, priority });
  add("/", now, "1.0"); add("/releases", now, "0.9");
  for (const k of ["cinema", "streaming", "tv"]) add(`/releases?kind=${k}`, now, "0.8");
  add("/explore"); add("/top"); add("/leaderboard");
  for (const t of data?.titles || []) add(titlePath(t.key, t.title, t.year), now, "0.8");
  for (const t of homeKeys) add(titlePath(t.key, t.title, t.year), now, "0.8");
  for (const r of releases || []) if (r.ids?.tmdb) add(titlePath((r.type === "film" ? "movie-" : "tv-") + r.ids.tmdb, r.title, r.date?.slice(0, 4)), now, "0.7");
  for (const u of data?.usernames || []) add(`/u/${u}`, now, "0.4");
  for (const c of data?.collections || []) add(`/collection/${c.id}`, (c.updated || now).slice(0, 10), "0.5");
  const xmlEsc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...urls].map(([p, v]) => `<url><loc>${xmlEsc(SITE() + p)}</loc><lastmod>${v.lastmod}</lastmod><priority>${v.priority}</priority></url>`).join("\n")}\n</urlset>\n`;
}
export const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /search\nDisallow: /feed\n\nSitemap: ${SITE()}/sitemap.xml\n`;
