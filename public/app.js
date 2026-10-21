// Telly Verdict front end: a small single-page app with history routing.
const VERDICTS = [
  { k: "Skip", c: "var(--skip)", n: "Not worth it" },
  { k: "Timepass", c: "var(--time)", n: "Fine with a brew" },
  { k: "Go for it", c: "var(--go)", n: "Recommended" },
  { k: "Perfection", c: "var(--perf)", n: "Must watch" },
];
const ASPECTS = ["Story", "Acting", "Direction", "Visuals", "Sound", "Pacing"];
const PLATFORMS = {
  "Netflix": "#e50914", "Prime Video": "#1f9be8", "Apple TV": "#a2aab0", "Disney+": "#1b3de0", "NOW": "#00d2be",
  "BBC iPlayer": "#ff4c98", "ITVX": "#d6ff3a", "Channel 4": "#9b9b9b", "Paramount+": "#0064ff", "discovery+": "#2175ff", "UK cinemas": "#ffb547",
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = new Date().toISOString().slice(0, 10);
const fmtDate = (d, opts = { day: "numeric", month: "short", year: "numeric" }) => d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", opts) : "";
const ago = ts => { const s = (Date.now() - ts) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`; return fmtDate(new Date(ts).toISOString()); };
const hue = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const fallbackBg = key => { const h = hue(key); return `background:radial-gradient(120% 80% at 80% 0%, hsl(${h} 70% 45% / .9), transparent 60%),linear-gradient(160deg, hsl(${(h + 40) % 360} 45% 22%), #111 160%)`; };
const initials = n => esc(String(n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase());

// Readable addresses: /film/paddington-in-peru-2024-516729, /show/..., /person/olivia-colman-39187 (must match lib/seo.js)
const slugify = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
function titleHref(key, title, year) {
  const [type, id] = String(key).split("-");
  const slug = [slugify(title), year].filter(Boolean).join("-");
  return `/${type === "movie" ? "film" : "show"}/${slug ? slug + "-" : ""}${id}`;
}
const hrefOf = t => t.path || titleHref(t.key, t.title, t.year);
const personHref = p => `/person/${slugify(p.name) ? slugify(p.name) + "-" : ""}${p.id}`;

const state = { me: null, marks: null, collections: [] };

// ---------- API ----------
let sb = null;            // Supabase client (auth only); created at boot from /api/config
let CONFIG = {};
async function token() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || null;
}
async function api(path, opts = {}) {
  const headers = opts.body ? { "content-type": "application/json" } : {};
  const t = await token(); if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { method: opts.method || (opts.body ? "POST" : "GET"), headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }
function requireLogin(next) { if (state.me) return true; openAuth("login", next); return false; }

// ---------- routing ----------
const routes = [
  [/^\/$/, pageHome],
  [/^\/(film|show)\/(?:[a-z0-9-]*-)?(\d+)$/, m => pageTitle(`${m[1] === "film" ? "movie" : "tv"}-${m[2]}`)],
  [/^\/title\/((?:movie|tv)-\d+)$/, m => pageTitle(m[1])],
  [/^\/person\/(?:[a-z0-9-]*-)?(\d+)$/, m => pagePerson(m[1])],
  [/^\/explore$/, pageExplore],
  [/^\/releases$/, pageReleases],
  [/^\/top$/, pageTop],
  [/^\/leaderboard$/, pageLeaderboard],
  [/^\/search$/, pageSearch],
  [/^\/feed$/, pageFeed],
  [/^\/u\/([a-z0-9_]+)$/, m => pageProfile(m[1])],
  [/^\/collection\/([\w-]+)$/, m => pageCollection(m[1])],
  [/^\/reset-password$/, pageResetPassword],
  [/^\/notifications$/, pageNotifications],
  [/^\/settings$/, pageSettings],
  [/^\/admin$/, pageAdmin],
  [/^\/privacy$/, () => pageStatic("privacy")],
  [/^\/terms$/, () => pageStatic("terms")],
  [/^\/rules$/, () => pageStatic("rules")],
  [/^\/auth\/callback$/, pageAuthCallback],
];
function go(href, replace = false) { history[replace ? "replaceState" : "pushState"](null, "", href); render(); }
async function render() {
  const app = $("#app");
  $$(".nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === location.pathname));
  for (const [re, fn] of routes) {
    const m = location.pathname.match(re);
    if (m) {
      // On first load the server has already rendered this page; keep it on screen until the app's data arrives.
      const fromServer = app.dataset.ssr === "1"; delete app.dataset.ssr;
      if (!fromServer) app.innerHTML = '<p class="empty">Loading…</p>';
      try { await fn(m); } catch (e) { app.innerHTML = `<div class="emptyState"><h2>${e.status === 404 ? "Not found" : "Something went wrong"}</h2><p>${esc(e.message)}</p><a class="btn" href="/" data-link>Back to home</a></div>`; }
      if (!fromServer) window.scrollTo(0, 0);
      return;
    }
  }
  app.innerHTML = `<div class="emptyState"><h2>Page not found</h2><a class="btn" href="/" data-link>Back to home</a></div>`;
}
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey && a.origin === location.origin) { e.preventDefault(); go(a.getAttribute("href")); }
});
window.addEventListener("popstate", render);
$("#searchForm").onsubmit = e => { e.preventDefault(); const q = $("#q").value.trim(); if (q) go("/search?q=" + encodeURIComponent(q)); };

function setCanonical(path) {
  let l = document.querySelector('link[rel="canonical"]');
  if (!l) { l = document.createElement("link"); l.rel = "canonical"; document.head.appendChild(l); }
  l.href = location.origin + path;
}

// ---------- shared pieces ----------
function poster(t, cls = "") {
  return `<div class="poster ${cls} ${t.poster ? "has-img" : ""}" style="${t.poster ? "" : fallbackBg(t.key || t.id)}">${t.poster ? `<img src="${t.poster}" alt="" loading="lazy">` : ""}<div class="pt">${esc(t.title)}</div></div>`;
}
function card(t, extra = "") {
  const sub = [t.type === "movie" ? "Film" : t.type === "tv" ? "Show" : "", t.year].filter(Boolean).join(" • ");
  return `<a class="card" href="${hrefOf(t)}" data-link>
    <div class="pwrap">${poster(t)}${t.badge ? `<span class="badge">${esc(t.badge)}</span>` : ""}</div>
    <div class="cmeta"><b>${esc(t.title)}</b><small>${esc(t.role || sub)}</small>${extra}</div></a>`;
}
const grid = (items, empty = "Nothing here yet.") => items?.length ? `<div class="grid">${items.map(t => card(t)).join("")}</div>` : `<p class="empty">${empty}</p>`;
function rail(r) {
  if (!r.items?.length) return "";
  return `<section class="rail"><div class="railHead"><h2>${esc(r.title)}</h2>${r.link ? `<a href="${r.link}" data-link class="more">See all</a>` : ""}</div>
    <div class="railRow">${r.items.map(t => card(t)).join("")}</div></section>`;
}
function avatar(u, size = 36) { return `<span class="avatar" style="--s:${size}px;background:hsl(${hue(u?.username)} 45% 35%)">${initials(u?.name || u?.username)}</span>`; }
const levelChip = l => l ? `<span class="lvl lvl${l.level}" title="${l.points} points">${esc(l.name)}</span>` : "";
const userLink = u => u ? `<a href="/u/${u.username}" data-link class="ulink">${avatar(u, 32)}<span><b>${esc(u.name)} ${levelChip(u.level)}</b><small>@${esc(u.username)}</small></span></a>` : "<span>Deleted account</span>";
const verdictPill = v => `<span class="vpill" style="--c:${VERDICTS[v].c}">${VERDICTS[v].k}</span>`;

function reviewCard(r, { showTitle = false } = {}) {
  const spoiler = r.spoiler ? `<button class="spoilerBtn" data-spoiler>Contains spoilers. Show review</button>` : "";
  return `<article class="review" data-review="${r.id}">
    <header>${userLink(r.author)}<span class="when">${ago(r.updatedAt || r.createdAt)}</span></header>
    ${showTitle ? `<a class="rtitle" href="${r.title?.path || titleHref(r.key, r.title?.title, r.title?.year)}" data-link>${esc(r.title?.title || "")}${r.title?.year ? ` (${r.title.year})` : ""}</a>` : ""}
    <div class="rverdict">${verdictPill(r.verdict)}${Object.keys(r.aspects || {}).length ? `<span class="aspects">${Object.entries(r.aspects).map(([a, n]) => `${a} ${n}`).join(" · ")}</span>` : ""}</div>
    ${r.text ? `${spoiler}<p class="rtext ${r.spoiler ? "blur" : ""}">${esc(r.text)}</p>` : ""}
    <footer>
      <button class="ghost like ${r.likedByMe ? "on" : ""}" data-like>♥ <span>${r.likes}</span></button>
      <button class="ghost" data-comments>Comments <span>${r.comments}</span></button>
      ${state.me && (state.me.id === r.author?.id || state.me.role === "admin") ? `<button class="ghost danger" data-delreview>Delete</button>` : ""}
      ${state.me?.id === r.author?.id ? `<button class="ghost" data-share>Share card</button>` : `<button class="ghost subtle" data-report="review" data-id="${r.id}">Report</button>`}
    </footer>
    <div class="comments" hidden></div>
  </article>`;
}
function wireReviews(root, onChange) {
  root.addEventListener("click", async e => {
    const art = e.target.closest("[data-review]"); if (!art) return;
    const id = art.dataset.review;
    if (e.target.closest("[data-spoiler]")) { e.target.closest("[data-spoiler]").remove(); $(".rtext", art).classList.remove("blur"); }
    if (e.target.closest("[data-like]")) {
      if (!requireLogin()) return;
      const r = await api(`/api/review/${id}/like`, { method: "POST", body: {} });
      const b = $("[data-like]", art); b.classList.toggle("on", r.likedByMe); $("span", b).textContent = r.likes;
    }
    if (e.target.closest("[data-delreview]")) {
      const b = e.target.closest("[data-delreview]");
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; return; }
      await api(`/api/review/${id}`, { method: "DELETE" }); art.remove(); toast("Review deleted."); onChange?.();
    }
    const dc = e.target.closest("[data-delcomment]");
    if (dc) { await api(`/api/comment/${dc.dataset.delcomment}`, { method: "DELETE" }).catch(er => toast(er.message)); dc.closest(".comment").remove(); toast("Comment deleted."); return; }
    if (e.target.closest("[data-share]")) {
      return shareCard({ reviewId: id });
    }
    if (e.target.closest("[data-comments]")) {
      const box = $(".comments", art); box.hidden = !box.hidden; if (box.hidden) return;
      const load = async () => {
        const { comments } = await api(`/api/review/${id}/comments`);
        box.innerHTML = comments.map(c => `<div class="comment">${userLink(c.author)}<p>${esc(c.text)}</p><small>${ago(c.createdAt)} · ${state.me && (state.me.id === c.author?.id || state.me.role === "admin") ? `<button class="linkish danger" data-delcomment="${c.id}">Delete</button>` : `<button class="linkish" data-report="comment" data-id="${c.id}">Report</button>`}</small></div>`).join("")
          + (state.me ? `<form class="inline"><input maxlength="1000" placeholder="Add a comment" aria-label="Comment"><button class="btn small">Post</button></form>` : `<p class="note"><a href="#" data-login>Log in</a> to comment.</p>`);
        $("form", box)?.addEventListener("submit", async ev => {
          ev.preventDefault(); const inp = $("input", box); if (!inp.value.trim()) return;
          try { await api(`/api/review/${id}/comments`, { body: { text: inp.value } }); const n = $("[data-comments] span", art); n.textContent = +n.textContent + 1; load(); } catch (er) { toast(er.message); }
        });
      };
      load();
    }
  });
}
document.addEventListener("click", e => { if (e.target.closest("[data-login]")) { e.preventDefault(); openAuth("login"); } });

// ---------- account ----------
async function loadMe() {
  const r = await api("/api/me").catch(() => ({ user: null }));
  state.me = r.user; state.marks = r.marks || null; state.collections = r.collections || []; state.unread = r.unread || 0;
  try { r.user ? localStorage.setItem("tv-me", JSON.stringify(r)) : localStorage.removeItem("tv-me"); } catch {}
  renderAccount();
}
function renderAccount() {
  const el = $("#account");
  if (!state.me) { el.innerHTML = `<button class="ghost" data-auth="login">Log in</button><button class="btn small" data-auth="signup">Sign up</button>`; }
  else el.innerHTML = `<a class="bell" href="/notifications" data-link aria-label="Notifications${state.unread ? `, ${state.unread} unread` : ""}">🔔${state.unread ? `<span class="dotcount">${state.unread > 9 ? "9+" : state.unread}</span>` : ""}</a>
    <details class="menu"><summary aria-label="Account menu">${avatar(state.me, 34)}</summary><div class="menuList">
      <a href="/u/${state.me.username}" data-link>Your profile</a><a href="/feed" data-link>Following feed</a>
      <a href="/settings" data-link>Settings and your data</a>${state.me.role === "admin" ? `<a href="/admin" data-link>Moderation</a>` : ""}
      <a href="/u/${state.me.username}?tab=later" data-link>Watch later</a><button data-logout>Log out</button></div></details>`;
}
$("#account").addEventListener("click", async e => {
  const a = e.target.closest("[data-auth]"); if (a) openAuth(a.dataset.auth);
  if (e.target.closest("[data-logout]")) { await sb?.auth.signOut(); await loadMe(); toast("Logged out."); render(); }
  if (e.target.closest(".menuList a")) e.target.closest("details").open = false;
});
function openModal(html) { $("#modalBody").innerHTML = `<button class="x" aria-label="Close" data-close>✕</button>${html}`; if (!modal.open) modal.showModal(); }
modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-close]")) modal.close(); });

// Cloudflare Turnstile bot check, when a site key is configured (and enabled under Supabase Auth > Bot protection).
let turnstileLoading = null;
function loadTurnstile() {
  if (!CONFIG.turnstileSiteKey) return Promise.resolve(null);
  return (turnstileLoading ||= new Promise(res => { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.onload = () => res(window.turnstile); s.onerror = () => res(null); document.head.appendChild(s); }));
}
async function mountCaptcha(el) {
  const ts = await loadTurnstile(); if (!ts || !el) return () => undefined;
  let tokenValue; const id = ts.render(el, { sitekey: CONFIG.turnstileSiteKey, theme: "dark", callback: t => (tokenValue = t) });
  return () => { const t = tokenValue; ts.reset(id); tokenValue = undefined; return t; };
}
const authError = e => {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Confirm your email first. We sent you a link when you signed up.";
  if (/already registered/i.test(m)) return "There's already an account with that email. Try logging in.";
  if (/captcha/i.test(m)) return "Please complete the check above and try again.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/Password should be/i.test(m)) return "Use a password of at least 8 characters.";
  return m;
};

function openAuth(mode, next) {
  if (!sb) { toast("Accounts aren't set up on this server yet."); return; }
  const google = CONFIG.googleEnabled ? `<button type="button" class="ghost wide" id="google">Continue with Google</button><p class="or">or</p>` : "";
  const forms = {
    login: `<h2>Welcome back</h2><p class="note">Log in to rate, review and keep your lists.</p>${google}
      <label>Email<input id="fEmail" type="email" autocomplete="email" required></label>
      <label>Password<input id="fPass" type="password" autocomplete="current-password" required></label>
      <div id="captcha"></div><p class="err" id="fErr"></p><button class="btn">Log in</button>
      <p class="note"><a href="#" data-switch="forgot">Forgot your password?</a> · New here? <a href="#" data-switch="signup">Create an account</a></p>`,
    signup: `<h2>Join Telly Verdict</h2><p class="note">Track what you watch, give verdicts and talk about new UK releases.</p>${google}
      <label>Display name<input id="fName" maxlength="50" autocomplete="name"></label>
      <label>Username<input id="fUser" maxlength="24" autocomplete="username" required pattern="[a-z0-9_]{3,24}"><small class="note" id="uMsg">3 to 24 lowercase letters, numbers or underscores.</small></label>
      <label>Email<input id="fEmail" type="email" autocomplete="email" required></label>
      <label>Password<input id="fPass" type="password" minlength="8" autocomplete="new-password" required></label>
      <div id="captcha"></div><p class="err" id="fErr"></p><button class="btn">Create account</button>
      <p class="note">Already have an account? <a href="#" data-switch="login">Log in</a></p>`,
    forgot: `<h2>Reset your password</h2><p class="note">We'll email you a link to choose a new one.</p>
      <label>Email<input id="fEmail" type="email" autocomplete="email" required></label>
      <div id="captcha"></div><p class="err" id="fErr"></p><button class="btn">Send reset link</button>
      <p class="note"><a href="#" data-switch="login">Back to log in</a></p>`,
  };
  openModal(`<form class="authForm" id="authForm">${forms[mode]}</form>`);
  $$("[data-switch]", modal).forEach(a => a.onclick = e => { e.preventDefault(); openAuth(a.dataset.switch, next); });
  const captcha = mountCaptcha($("#captcha"));
  $("#google")?.addEventListener("click", () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(location.pathname)}` } }));
  const uInput = $("#fUser");
  if (uInput) uInput.addEventListener("input", () => {
    uInput.value = uInput.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    clearTimeout(uInput.t);
    uInput.t = setTimeout(async () => {
      if (uInput.value.length < 3) return;
      const r = await api("/api/username-available?u=" + encodeURIComponent(uInput.value)).catch(() => null);
      $("#uMsg").textContent = !r ? "" : r.available ? `@${uInput.value} is available.` : (r.reason || `@${uInput.value} is taken.`);
    }, 350);
  });
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const err = $("#fErr"); err.textContent = "";
    const btn = $("#authForm .btn"); btn.disabled = true;
    try {
      const captchaToken = (await captcha)();
      const email = $("#fEmail").value.trim();
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: $("#fPass").value, options: { captchaToken } });
        if (error) throw error;
        modal.close(); await loadMe(); toast("Logged in."); next ? next() : render();
      } else if (mode === "signup") {
        const username = $("#fUser").value;
        const check = await api("/api/username-available?u=" + encodeURIComponent(username));
        if (!check.available) throw new Error(check.reason || "That username is taken.");
        const { data, error } = await sb.auth.signUp({ email, password: $("#fPass").value, options: { captchaToken, data: { username, name: $("#fName").value.trim() || username }, emailRedirectTo: `${location.origin}/auth/callback` } });
        if (error) throw error;
        if (data.session) { modal.close(); await loadMe(); toast("Account created. Welcome!"); next ? next() : render(); }
        else openModal(`<h2>Check your email</h2><p>We've sent a link to <b>${esc(email)}</b>. Open it to confirm your account, then you're in.</p><p class="note">Nothing there? Check your spam folder.</p>`);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { captchaToken, redirectTo: `${location.origin}/reset-password` });
        if (error) throw error;
        openModal(`<h2>Check your email</h2><p>If there's an account for <b>${esc(email)}</b>, we've sent a link to reset the password.</p>`);
      }
    } catch (er) { err.textContent = authError(er); }
    btn.disabled = false;
  };
}

async function pageAuthCallback() {
  // Supabase reads the token from the link automatically; wait for it, then go on.
  $("#app").innerHTML = `<div class="emptyState"><h2>Signing you in…</h2></div>`;
  const { data } = await sb.auth.getSession();
  const err = new URLSearchParams(location.hash.slice(1)).get("error_description") || new URLSearchParams(location.search).get("error_description");
  if (err || !data.session) {
    $("#app").innerHTML = `<div class="emptyState"><h2>That link didn't work</h2><p>${esc(err || "It may have expired or already been used.")}</p><button class="btn" data-login>Log in</button></div>`;
    return;
  }
  await loadMe();
  toast(`Welcome, ${state.me?.name || "back"}!`);
  go(new URLSearchParams(location.search).get("next") || "/", true);
}

async function pageResetPassword() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    $("#app").innerHTML = `<div class="emptyState"><h2>Reset link expired</h2><p>Request a new one and use it within an hour.</p><button class="btn" id="again">Send a new link</button></div>`;
    $("#again").onclick = () => openAuth("forgot");
    return;
  }
  $("#app").innerHTML = `<form class="authForm narrow" id="newPass"><h1>Choose a new password</h1>
    <label>New password<input id="np" type="password" minlength="8" autocomplete="new-password" required></label>
    <p class="err" id="npErr"></p><button class="btn">Save password</button></form>`;
  $("#newPass").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $("#np").value });
    if (error) { $("#npErr").textContent = authError(error); return; }
    await loadMe(); toast("Password updated. You're logged in."); go("/", true);
  };
}

// ---------- pages ----------
async function pageHome() {
  const h = await api("/api/home");
  const app = $("#app");
  app.innerHTML = `
    <section class="intro"><h1>What's new in UK cinemas and on streaming, and is it any good?</h1>
      <p>Films and series on Netflix, Prime Video, Apple TV, Disney+, NOW, BBC iPlayer, ITVX, Channel 4 and in cinemas, with verdicts from people who've watched them.</p>
      <div class="cta"><a class="btn" href="/releases" data-link>This week's releases</a><a class="ghost" href="/explore" data-link>Explore</a></div></section>
    ${h.needsKey ? `<div class="banner">Add a TMDB key to load the catalogue: copy <code>.env.example</code> to <code>.env</code>, paste the key and restart. The release calendar works without it.</div>` : ""}
    ${h.rails.map(rail).join("")}
    ${h.recentReviews?.length ? `<section class="rail"><div class="railHead"><h2>Latest reviews</h2></div><div class="reviewCols" id="homeReviews">${h.recentReviews.map(r => reviewCard(r, { showTitle: true })).join("")}</div></section>` : ""}`;
  const hr = $("#homeReviews"); if (hr) wireReviews(hr);
}

async function pageTitle(key) {
  const t = await api("/api/title/" + key);
  document.title = `${t.title}${t.year ? ` (${t.year})` : ""} – reviews, verdict and where to watch in the UK | Telly Verdict`;
  const canonical = titleHref(t.key, t.title, t.year);
  if (location.pathname !== canonical) history.replaceState(null, "", canonical + location.search);
  setCanonical(canonical);
  const ref = { title: t.title, poster: t.poster, year: t.year, type: t.type };
  const director = t.crew.filter(c => ["Director", "Creator"].includes(c.job));
  const app = $("#app");
  app.innerHTML = `
    <section class="hero" style="${t.backdrop ? `--bd:url('${t.backdrop}')` : fallbackBg(t.key)}">
      <div class="heroIn">
        <div class="heroPoster">${poster(t, "big")}</div>
        <div class="heroText">
          <span class="label">${t.type === "movie" ? "Film" : "Show"}${t.year ? ` • ${t.year}` : ""}${t.runtime ? ` • ${t.runtime >= 60 && t.type === "movie" ? `${Math.floor(t.runtime / 60)}h ${t.runtime % 60}m` : `${t.runtime}m`}` : ""}${t.seasons?.length ? ` • ${t.seasons.length} season${t.seasons.length > 1 ? "s" : ""}` : ""}</span>
          <h1>${esc(t.title)}</h1>
          ${t.tagline ? `<p class="tagline">${esc(t.tagline)}</p>` : ""}
          <dl class="facts">
            ${director.length ? `<div><dt>${t.type === "movie" ? "Director" : "Showrunner"}</dt><dd>${director.map(p => `<a href="${personHref(p)}" data-link>${esc(p.name)}</a>`).join(", ")}</dd></div>` : ""}
            ${t.countries?.length ? `<div><dt>Country</dt><dd>${t.countries.map(c => `<a href="/explore?country=${c.code}&type=${t.type}" data-link>${esc(c.name)}</a>`).join(", ")}</dd></div>` : ""}
            ${t.languages?.length ? `<div><dt>Language</dt><dd>${t.languages.map(l => `<a href="/explore?language=${l}&type=${t.type}" data-link>${esc(new Intl.DisplayNames(["en-GB"], { type: "language" }).of(l) || l)}</a>`).join(", ")}</dd></div>` : ""}
            ${t.certification ? `<div><dt>Age rating</dt><dd><span class="cert">${esc(t.certification)}</span></dd></div>` : ""}
            ${t.ukCinema ? `<div><dt>UK cinemas</dt><dd>${fmtDate(t.ukCinema)}</dd></div>` : ""}
            ${t.ukDigital ? `<div><dt>UK streaming / digital</dt><dd>${fmtDate(t.ukDigital)}</dd></div>` : ""}
            ${t.networks?.length ? `<div><dt>On</dt><dd>${esc(t.networks.join(", "))}</dd></div>` : ""}
          </dl>
          <div class="actions">
            <button class="act ${t.marks?.watched ? "on" : ""}" data-mark="watched">${t.marks?.watched ? "✓ Watched" : "Mark as watched"}</button>
            <button class="act ${t.marks?.later ? "on" : ""}" data-mark="later">${t.marks?.later ? "✓ Watch later" : "+ Watch later"}</button>
            <button class="act" data-addcol>Add to collection</button>
            ${t.trailer ? `<a class="act" href="https://www.youtube.com/watch?v=${t.trailer.youtube}" target="_blank" rel="noopener">▶ Trailer</a>` : ""}
          </div>
        </div>
      </div>
    </section>

    <div class="titleGrid">
      <div class="mainCol">
        <section><h2>Overview</h2><p class="overview">${esc(t.overview || "No synopsis yet.")}</p>
          <div class="tags">${t.genres.map(g => `<a class="tag" href="/explore?type=${t.type}&genre=${g.id}" data-link>${esc(g.name)}</a>`).join("")}${t.tags.map(k => `<span class="tag soft">${esc(k)}</span>`).join("")}</div></section>

        <section><h2>Where to watch in the UK</h2>${whereToWatch(t)}</section>
        ${t.tickets ? `<section class="tickets"><h2>${t.tickets.from > today ? `Book tickets · in UK cinemas from ${fmtDate(t.tickets.from)}` : "Book tickets in UK cinemas"}</h2>
          <div class="wlist">${t.tickets.chains.map(c => `<a class="prov" href="${esc(c.url)}" target="_blank" rel="noopener sponsored">${esc(c.name)} ↗</a>`).join("")}</div>
          <p class="note">Listings and times are on each cinema's site.</p></section>` : ""}

        ${t.cast.length ? `<section><h2>Cast</h2><div class="people">${t.cast.map(p => personChip(p, p.character)).join("")}</div></section>` : ""}
        ${t.crew.length ? `<section><h2>Crew</h2><div class="people">${t.crew.map(p => personChip(p, p.job)).join("")}</div></section>` : ""}
        ${t.seasons?.length ? `<section><h2>Seasons</h2><div class="seasons">${t.seasons.map(s => `<div class="season"><b>${esc(s.name)}</b><small>${s.episodes} episodes${s.date ? ` · ${fmtDate(s.date)}` : ""}</small></div>`).join("")}</div></section>` : ""}

        <section id="reviewsSec"><div class="railHead"><h2>Reviews</h2>
          <div class="seg" id="revSort"><button data-sort="top" aria-pressed="true">Top</button><button data-sort="new" aria-pressed="false">Newest</button></div></div>
          <div class="chips" id="revFilter"><button class="f" data-v="" aria-pressed="true">All</button>${VERDICTS.map((v, i) => `<button class="f" data-v="${i}" aria-pressed="false">${v.k}</button>`).join("")}</div>
          <div id="reviewList"></div></section>

        <section><h2>Discussion</h2><p class="note">Chat about ${esc(t.title)} with everyone who's watching. Mark spoilers.</p>
          <div class="chat" id="chat"></div>
          ${state.me ? `<form class="compose" id="chatForm"><textarea id="chatMsg" maxlength="1000" placeholder="Say something about ${esc(t.title)}"></textarea><div class="composeRow"><label class="check"><input type="checkbox" id="chatSpoiler"> Spoiler</label><button class="btn small">Post</button></div></form>` : `<p class="note"><a href="#" data-login>Log in</a> to join the discussion.</p>`}
        </section>

        ${t.recommendations.length ? `<section class="rail"><div class="railHead"><h2>If you liked this</h2></div><div class="railRow">${t.recommendations.map(r => card(r)).join("")}</div></section>` : ""}
      </div>

      <aside class="sideCol">
        <section class="meterBox" id="meter"></section>
        <section class="yourReview" id="yourReview"></section>
      </aside>
    </div>`;

  const renderMeter = st => {
    $("#meter").innerHTML = st.votes ? `
      <div class="label">Verdict meter</div>
      <div class="meterBig"><strong>${st.meter}%</strong><span>say Go for it or Perfection<br><small>${st.verdicts[2] + st.verdicts[3]}/${st.votes} votes</small></span></div>
      ${[3, 2, 1, 0].map(i => `<div class="vrow"><span>${VERDICTS[i].k}</span><div class="meter"><i style="width:${(st.verdicts[i] / st.votes) * 100}%;background:${VERDICTS[i].c}"></i></div><b>${Math.round((st.verdicts[i] / st.votes) * 100)}%</b></div>`).join("")}
      ${st.score != null ? `<div class="label" style="margin-top:12px">Scores out of 10 · ${st.score.toFixed(1)} overall</div>${ASPECTS.map(a => `<div class="vrow"><span>${a}</span><div class="meter"><i style="width:${(st.avg[a] ?? 0) * 10}%"></i></div><b>${st.avg[a] != null ? st.avg[a].toFixed(1) : "–"}</b></div>`).join("")}` : ""}`
      : `<div class="label">Verdict meter</div><p class="note">No verdicts yet. Be the first to rate ${esc(t.title)}.</p>`;
    $("#meter").insertAdjacentHTML("beforeend", `<p class="note meterHow">The meter is the share of members who said Go for it or Perfection. Scores are the average of members who rated each part.</p>`);
  };
  renderMeter(t.stats);

  // Your review
  let mine = t.myReview;
  const renderYour = () => {
    const box = $("#yourReview");
    if (state.me?.banned) { box.innerHTML = `<h3>Posting is blocked</h3><p class="note">Your account has been blocked from posting for breaking the <a href="/rules" data-link>community rules</a>.</p>`; return; }
    if (!state.me) { box.innerHTML = `<h3>What's your verdict?</h3><p class="note">Log in to rate this, score it and write a review.</p><button class="btn" data-login>Log in to rate</button>`; return; }
    const v = mine?.verdict ?? -1;
    box.innerHTML = `<h3>${mine ? "Your verdict" : "What's your verdict?"}</h3>
      <div class="verdicts" id="vsel">${VERDICTS.map((x, i) => `<button class="vbtn" style="--c:${x.c}" data-v="${i}" aria-pressed="${v === i}">${x.k}<small>${x.n}</small></button>`).join("")}</div>
      <details class="scores" ${mine && Object.keys(mine.aspects || {}).length ? "open" : ""}><summary>Score it, 1 to 10 (optional)</summary>
        ${ASPECTS.map(a => { const val = mine?.aspects?.[a]; return `<label class="aspect"><span>${a}</span><input type="range" min="1" max="10" id="a-${a}" value="${val ?? 5}" data-set="${val != null}"><output>${val ?? "–"}</output></label>`; }).join("")}</details>
      <textarea id="rText" maxlength="5000" placeholder="Write a review (optional)">${esc(mine?.text || "")}</textarea>
      <label class="check"><input type="checkbox" id="rSpoiler" ${mine?.spoiler ? "checked" : ""}> Contains spoilers</label>
      <div class="composeRow"><button class="btn" id="rSave">${mine ? "Update review" : "Post verdict"}</button>${mine ? `<button class="ghost" id="rShare">Share card</button>` : ""}<span class="note" id="rStat"></span></div>`;
    $("#rShare")?.addEventListener("click", () => shareCard({ reviewId: mine.id }));
    let pick = v;
    $("#vsel").onclick = e => { const b = e.target.closest(".vbtn"); if (!b) return; pick = +b.dataset.v; $$(".vbtn", box).forEach(x => x.setAttribute("aria-pressed", x === b)); };
    $$(".aspect input", box).forEach(inp => inp.oninput = () => { inp.dataset.set = "true"; inp.nextElementSibling.textContent = inp.value; });
    $("#rSave").onclick = async () => {
      if (pick < 0) { $("#rStat").textContent = "Pick a verdict first."; return; }
      const aspects = {}; $$(".aspect input", box).forEach(inp => { if (inp.dataset.set === "true") aspects[inp.id.slice(2)] = +inp.value; });
      try {
        const r = await api(`/api/title/${t.key}/review`, { body: { verdict: pick, aspects, text: $("#rText").value, spoiler: $("#rSpoiler").checked, title: ref } });
        mine = r.review; renderMeter(r.stats); renderYour(); loadReviews(); toast("Verdict saved.");
        setMark("watched", true);
      } catch (er) { $("#rStat").textContent = er.message; }
    };
  };
  renderYour();

  // Reviews list
  let sort = "top", vf = "";
  const loadReviews = async () => {
    const { reviews } = await api(`/api/title/${t.key}/reviews?sort=${sort}&verdict=${vf}`);
    $("#reviewList").innerHTML = reviews.length ? reviews.map(r => reviewCard(r)).join("") : `<p class="note">No written reviews${vf !== "" ? " with this verdict" : ""} yet.</p>`;
  };
  wireReviews($("#reviewList"), async () => { const fresh = await api("/api/title/" + key); renderMeter(fresh.stats); mine = fresh.myReview; renderYour(); });
  $("#revSort").onclick = e => { const b = e.target.closest("button"); if (!b) return; sort = b.dataset.sort; $$("#revSort button").forEach(x => x.setAttribute("aria-pressed", x === b)); loadReviews(); };
  $("#revFilter").onclick = e => { const b = e.target.closest(".f"); if (!b) return; vf = b.dataset.v; $$("#revFilter .f").forEach(x => x.setAttribute("aria-pressed", x === b)); loadReviews(); };
  loadReviews();

  // Discussion
  const chat = t.discussion.slice();
  const renderChat = () => {
    $("#chat").innerHTML = chat.length ? chat.map(m => `<div class="msg">${userLink(m.author)}<small>${ago(m.ts)}${state.me && state.me.id !== m.author?.id ? ` · <button class="linkish" data-report="discussion" data-id="${m.id}">Report</button>` : ""}</small>${m.spoiler ? `<button class="spoilerBtn" onclick="this.nextElementSibling.classList.remove('blur');this.remove()">Spoiler. Show</button>` : ""}<p class="${m.spoiler ? "blur" : ""}">${esc(m.text)}</p></div>`).join("") : `<p class="note">No messages yet. Start the conversation.</p>`;
    $("#chat").scrollTop = $("#chat").scrollHeight;
  };
  renderChat();
  $("#chatForm")?.addEventListener("submit", async e => {
    e.preventDefault(); const text = $("#chatMsg").value.trim(); if (!text) return;
    try { const r = await api(`/api/title/${t.key}/discussion`, { body: { text, spoiler: $("#chatSpoiler").checked } }); chat.push(r.message); $("#chatMsg").value = ""; $("#chatSpoiler").checked = false; renderChat(); }
    catch (er) { toast(er.message); }
  });

  // Marks and collections
  const setMark = (list, on) => {
    const b = $(`[data-mark="${list}"]`); b.classList.toggle("on", on);
    b.textContent = list === "watched" ? (on ? "✓ Watched" : "Mark as watched") : (on ? "✓ Watch later" : "+ Watch later");
    if (list === "watched" && on) setMark("later", false);
  };
  $$("[data-mark]").forEach(b => b.onclick = async () => {
    if (!requireLogin(() => go(location.pathname))) return;
    const r = await api(`/api/title/${t.key}/mark`, { body: { list: b.dataset.mark, title: ref } });
    setMark("watched", r.watched); setMark("later", r.later);
    toast(b.dataset.mark === "watched" ? (r.watched ? "Marked as watched." : "Removed from watched.") : (r.later ? "Added to Watch later." : "Removed from Watch later."));
  });
  $("[data-addcol]").onclick = () => { if (requireLogin(() => go(location.pathname))) collectionPicker(t.key, ref); };
}

function whereToWatch(t) {
  const w = t.whereToWatch;
  const row = (label, list) => list?.length ? `<div class="wrow"><span class="label">${label}</span><div class="wlist">${list.map(p => `<span class="prov">${p.logo ? `<img src="${p.logo}" alt="">` : ""}${esc(p.name)}</span>`).join("")}</div></div>` : "";
  const inCinemas = t.ukCinema && t.ukCinema <= today && (!t.ukDigital || t.ukDigital > today);
  const out = [
    inCinemas ? `<div class="wrow"><span class="label">Cinemas</span><div class="wlist"><span class="prov">In UK cinemas since ${fmtDate(t.ukCinema)}</span></div></div>` : "",
    t.ukCinema && t.ukCinema > today ? `<div class="wrow"><span class="label">Cinemas</span><div class="wlist"><span class="prov">Opens in UK cinemas ${fmtDate(t.ukCinema)}</span></div></div>` : "",
    row("Stream", w?.stream), row("Rent", w?.rent), row("Buy", w?.buy),
  ].join("");
  return out ? `${out}${w?.link ? `<a class="more" href="${w.link}" target="_blank" rel="noopener">All UK options on JustWatch →</a>` : ""}` : `<p class="note">Not available to watch in the UK yet.</p>`;
}
const personChip = (p, role) => `<a class="person" href="${personHref(p)}" data-link>${p.photo ? `<img src="${p.photo}" alt="" loading="lazy">` : `<span class="ph">${initials(p.name)}</span>`}<b>${esc(p.name)}</b><small>${esc(role || "")}</small></a>`;

function collectionPicker(key, ref) {
  const draw = () => {
    openModal(`<h2>Add to collection</h2>
      <div class="colPick">${state.collections.length ? state.collections.map(c => `<label class="check"><input type="checkbox" data-col="${c.id}" ${c.items.includes(key) ? "checked" : ""}> ${esc(c.name)} <small>${c.items.length}</small></label>`).join("") : `<p class="note">You don't have any collections yet.</p>`}</div>
      <form id="newCol" class="inline"><input id="newColName" maxlength="80" placeholder="New collection name" aria-label="New collection name"><button class="btn small">Create</button></form>
      ${state.me.role === "admin" ? `<label class="check"><input type="checkbox" id="newColEd"> Show new collection on the home page (editor's pick)</label>` : ""}`);
    $$("[data-col]", modal).forEach(box => box.onchange = async () => {
      const id = box.dataset.col;
      const { collection } = await api(`/api/collection/${id}`, { body: { toggleKey: key, title: ref } });
      state.collections = state.collections.map(c => c.id === id ? { ...c, items: collection.items.map(i => i.key) } : c);
      toast(box.checked ? `Added to ${collection.name}.` : `Removed from ${collection.name}.`);
    });
    $("#newCol").onsubmit = async e => {
      e.preventDefault(); const name = $("#newColName").value.trim(); if (!name) return;
      const { collection } = await api("/api/collections", { body: { name, addKey: key, title: ref, editorial: $("#newColEd")?.checked } });
      state.collections.push({ id: collection.id, name: collection.name, items: [key] }); toast(`Added to ${collection.name}.`); draw();
    };
  };
  draw();
}

async function pagePerson(id) {
  const p = await api("/api/person/" + id);
  document.title = `${p.name} – films and TV shows | Telly Verdict`;
  if (location.pathname !== personHref(p)) history.replaceState(null, "", personHref(p));
  setCanonical(personHref(p));
  const age = p.born ? Math.floor(((p.died ? new Date(p.died) : new Date()) - new Date(p.born)) / 31557600000) : null;
  $("#app").innerHTML = `<section class="personHead">
      ${p.photo ? `<img src="${p.photo}" alt="" class="personPhoto">` : `<span class="personPhoto ph">${initials(p.name)}</span>`}
      <div><span class="label">${esc(p.knownFor || "")}</span><h1>${esc(p.name)}</h1>
        <dl class="facts">${p.born ? `<div><dt>Born</dt><dd>${fmtDate(p.born)}${age && !p.died ? ` (age ${age})` : ""}</dd></div>` : ""}${p.died ? `<div><dt>Died</dt><dd>${fmtDate(p.died)}</dd></div>` : ""}${p.birthplace ? `<div><dt>Birthplace</dt><dd>${esc(p.birthplace)}</dd></div>` : ""}</dl>
        ${p.biography ? `<p class="bio">${esc(p.biography)}</p>` : ""}</div></section>
    <section><h2>Known for</h2>${grid(p.credits)}</section>`;
}

async function pageExplore() {
  const q = new URLSearchParams(location.search);
  const type = q.get("type") || "movie";
  const f = await api("/api/filters");
  const sel = (name, opts, label) => `<label class="sel">${label}<select data-f="${name}"><option value="">Any</option>${opts.map(o => `<option value="${esc(o.v)}" ${q.get(name) === String(o.v) ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select></label>`;
  $("#app").innerHTML = `<section class="intro small"><h1>Explore</h1><p>Browse by genre, language, country and UK streaming service.</p></section>
    <div class="filtersBar">
      <div class="seg" id="typeSeg"><button data-type="movie" aria-pressed="${type === "movie"}">Films</button><button data-type="tv" aria-pressed="${type === "tv"}">Shows</button></div>
      ${sel("genre", f.genres[type].map(g => ({ v: g.id, l: g.name })), "Genre")}
      ${sel("language", f.languages.map(l => ({ v: l.code, l: l.name })), "Language")}
      ${sel("country", (f.countries || []).map(c => ({ v: c.code, l: c.name })), "Country")}
      ${sel("provider", f.providers.map(p => ({ v: p, l: p })), "On")}
      <label class="sel">Sort<select data-f="sort">${[["popularity.desc", "Popular"], ["primary_release_date.desc", "Newest"], ["vote_average.desc", "Highest rated (TMDB)"]].map(([v, l]) => `<option value="${type === "tv" ? v.replace("primary_release_date", "first_air_date") : v}" ${q.get("sort") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <div id="exGrid"></div><div class="center"><button class="ghost" id="more" hidden>Load more</button></div>`;
  const update = (k, v) => { const n = new URLSearchParams(location.search); v ? n.set(k, v) : n.delete(k); if (k === "type") n.delete("genre"); go("/explore?" + n, true); };
  $("#typeSeg").onclick = e => { const b = e.target.closest("button"); if (b) update("type", b.dataset.type); };
  $$("[data-f]").forEach(s => s.onchange = () => update(s.dataset.f, s.value));
  let page = 1;
  const load = async () => {
    const p = new URLSearchParams(q); p.set("type", type); p.set("page", page);
    const r = await api("/api/explore?" + p);
    const html = r.titles.map(t => card(t)).join("");
    if (page === 1) $("#exGrid").innerHTML = r.titles.length ? `<div class="grid">${html}</div>` : `<p class="empty">Nothing matches these filters.</p>`;
    else $("#exGrid .grid").insertAdjacentHTML("beforeend", html);
    $("#more").hidden = page >= r.totalPages;
  };
  $("#more").onclick = () => { page++; load(); };
  load();
}

async function pageReleases() {
  const q = new URLSearchParams(location.search);
  const kind = q.get("kind") || "";
  const where = q.get("where") || "";
  const r = await api("/api/releases?" + new URLSearchParams({ ...(kind && { kind }), ...(where && { where }) }));
  const all = await api("/api/releases" + (kind ? `?kind=${kind}` : ""));
  const outlets = Object.entries(all.releases.reduce((m, x) => (m[x.where] = (m[x.where] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([w]) => w);
  const set = (k, v) => { const n = new URLSearchParams(location.search); v ? n.set(k, v) : n.delete(k); if (k === "kind") n.delete("where"); go("/releases?" + n, true); };
  // Group by week starting Monday.
  const weeks = new Map();
  for (const x of r.releases) {
    const d = new Date(x.date + "T12:00:00"); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const k = mon.toISOString().slice(0, 10); if (!weeks.has(k)) weeks.set(k, []); weeks.get(k).push(x);
  }
  const thisMon = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  $("#app").innerHTML = `<section class="intro small"><h1>UK release calendar</h1><p>Every new film and series coming to UK cinemas, streaming services and TV, week by week.</p></section>
    <div class="chips"><span class="seg" id="kindSeg">${[["", "Everything"], ["cinema", "Cinemas"], ["streaming", "Streaming"], ["tv", "TV"]].map(([v, l]) => `<button data-kind="${v}" aria-pressed="${kind === v}">${l}</button>`).join("")}</span></div>
    <div class="chips" id="whereChips"><button class="f" data-where="" aria-pressed="${!where}">All services</button>${outlets.map(w => `<button class="f" data-where="${esc(w)}" aria-pressed="${where === w}"><span class="dot" style="background:${PLATFORMS[w] || "#777"}"></span>${esc(w)}</button>`).join("")}</div>
    ${r.note ? `<div class="banner">${esc(r.note)}</div>` : ""}
    ${kind === "cinema" && !r.releases.length ? `<div class="banner">Cinema releases come from TMDB. Add your key and run <code>npm run releases</code>.</div>` : ""}
    <div id="weeks">${[...weeks].map(([wk, items]) => {
      const end = new Date(wk + "T12:00:00"); end.setDate(end.getDate() + 6);
      return `<section class="week ${wk === thisMon ? "now" : ""}"><h2>${wk === thisMon ? "This week · " : ""}${fmtDate(wk, { day: "numeric", month: "short" })} – ${fmtDate(end.toISOString(), { day: "numeric", month: "short" })}</h2>
        <div class="relList">${items.map(x => `<button class="rel" data-name="${esc(x.title)}" data-year="${x.date.slice(0, 4)}" data-imdb="${esc(x.ids?.imdb || "")}" data-tmdb="${x.ids?.tmdb ? (x.type === "film" ? "movie-" : "tv-") + x.ids.tmdb : ""}">
          <span class="rdate"><b>${fmtDate(x.date, { day: "numeric" })}</b><small>${fmtDate(x.date, { weekday: "short" })}</small></span>
          ${x.image ? `<img src="${x.image}" alt="" loading="lazy">` : `<span class="rimg" style="${fallbackBg(x.title)}"></span>`}
          <span class="rinfo"><b>${esc(x.title)}</b><small><span class="dot" style="background:${PLATFORMS[x.where] || "#777"}"></span>${esc(x.where)} · ${esc(x.label)}${x.certification ? ` · ${esc(x.certification)}` : ""}</small>
          <small class="rgen">${esc((x.genres || []).slice(0, 3).join(", "))}</small></span></button>`).join("")}</div></section>`;
    }).join("") || `<p class="empty">No releases match.</p>`}</div>
    ${r.generatedAt ? `<p class="note">Calendar updated ${fmtDate(r.generatedAt)}.</p>` : ""}`;
  $("#kindSeg").onclick = e => { const b = e.target.closest("button"); if (b) set("kind", b.dataset.kind); };
  $("#whereChips").onclick = e => { const b = e.target.closest(".f"); if (b) set("where", b.dataset.where); };
  $("#weeks").onclick = async e => {
    const b = e.target.closest(".rel"); if (!b) return;
    if (b.dataset.tmdb) return go(titleHref(b.dataset.tmdb, b.dataset.name, b.dataset.year));
    if (b.dataset.imdb) { try { const { key } = await api("/api/resolve/" + b.dataset.imdb); if (key) return go(titleHref(key, b.dataset.name, b.dataset.year)); } catch {} }
    toast("We don't have a page for this one yet.");
  };
}

async function pageTop() {
  const { titles } = await api("/api/top");
  $("#app").innerHTML = `<section class="intro small"><h1>Top rated by the community</h1><p>Titles with at least two verdicts, ranked by the share who said Go for it or Perfection.</p></section>
    ${titles.length ? `<ol class="chart">${titles.map((t, i) => `<li><span class="rank">${i + 1}</span><a href="${hrefOf(t)}" data-link class="chartRow">${poster(t, "tiny")}<span><b>${esc(t.title)}</b><small>${t.type === "movie" ? "Film" : "Show"}${t.year ? ` • ${t.year}` : ""} · ${t.stats.votes} votes</small></span><strong>${t.stats.meter}%</strong></a></li>`).join("")}</ol>` : `<p class="empty">Not enough verdicts yet. Rate a few titles to start the chart.</p>`}`;
}

async function pageLeaderboard() {
  const period = new URLSearchParams(location.search).get("period") || "week";
  const d = await api("/api/leaderboard?period=" + period);
  const label = { week: "this week", month: "this month", all: "of all time" }[d.period];
  $("#app").innerHTML = `<section class="intro small"><h1>Leaderboard</h1><p>Earn points for verdicts, reviews people like, and joining the conversation. Climb the levels from Extra to Legend.</p></section>
    <div class="seg" id="perSeg">${[["week", "This week"], ["month", "This month"], ["all", "All time"]].map(([k, l]) => `<button data-p="${k}" aria-pressed="${d.period === k}">${l}</button>`).join("")}</div>
    ${d.me ? `<div class="banner meRow">You're <b>${d.me.periodRank ? `#${d.me.periodRank}` : "not ranked yet"}</b> ${label} · ${levelChip(d.me)} · ${d.me.points.toLocaleString("en-GB")} points in total${d.me.next ? ` · ${(d.me.next.at - d.me.points).toLocaleString("en-GB")} to ${esc(d.me.next.name)}` : ""}</div>` : `<div class="banner"><a href="#" data-login>Log in</a> to earn points and appear here.</div>`}
    <div class="lbGrid">
      <section><h2>Top members ${label}</h2>
        ${d.board.length ? `<ol class="board">${d.board.map(r => `<li class="${state.me?.id === r.userId ? "me" : ""}"><span class="rank ${r.rank <= 3 ? "podium p" + r.rank : ""}">${r.rank}</span>${userLink(r.user)}<span class="bcount" title="${esc(r.badges.join(", "))}">${r.badges.length} badge${r.badges.length === 1 ? "" : "s"}</span><strong>${r.points.toLocaleString("en-GB")}</strong></li>`).join("")}</ol>` : `<p class="empty">No points earned ${label} yet. Give a verdict to get on the board.</p>`}
      </section>
      <section><h2>Most liked reviews ${label}</h2><div id="lbReviews">${d.reviews.map(r => reviewCard(r, { showTitle: true })).join("") || `<p class="note">No liked reviews ${label} yet.</p>`}</div></section>
    </div>
    <section id="how" class="how"><h2>How points work</h2>
      <div class="howGrid">
        <div><h3>Earning points</h3><table class="rules">${d.rules.map(r => `<tr><td>${esc(r.label)}</td><td>+${r.pts}</td></tr>`).join("")}</table>
          <p class="note">Liking or commenting on your own review earns nothing. Deleting a review removes the points it earned.</p></div>
        <div><h3>Levels</h3><table class="rules">${d.levels.map((l, i) => `<tr><td>${levelChip({ level: i + 1, name: l.name, points: l.min })}</td><td>${l.min.toLocaleString("en-GB")} pts</td></tr>`).join("")}</table></div>
        <div><h3>Badges</h3><table class="rules">${d.badges.map(b => `<tr><td><b>${esc(b.name)}</b><br><small class="note">${esc(b.desc)}</small></td></tr>`).join("")}</table></div>
      </div></section>`;
  $("#perSeg").onclick = e => { const b = e.target.closest("button"); if (b) go("/leaderboard?period=" + b.dataset.p, true); };
  wireReviews($("#lbReviews"));
  if (location.hash === "#how") $("#how").scrollIntoView();
}

async function pageSearch() {
  const q = new URLSearchParams(location.search).get("q") || "";
  $("#q").value = q;
  const r = await api("/api/search?q=" + encodeURIComponent(q));
  $("#app").innerHTML = `<section class="intro small"><h1>Results for “${esc(q)}”</h1></section>
    ${r.titles.length ? `<section><h2>Films and shows</h2>${grid(r.titles)}</section>` : ""}
    ${r.people.length ? `<section><h2>People</h2><div class="people">${r.people.map(p => personChip(p, p.knownFor)).join("")}</div></section>` : ""}
    ${r.users.length ? `<section><h2>Members</h2><div class="userList">${r.users.map(u => userLink(u)).join("")}</div></section>` : ""}
    ${!r.titles.length && !r.people.length && !r.users.length ? `<p class="empty">No matches. Try a different spelling.</p>` : ""}`;
}

async function pageFeed() {
  if (!state.me) { $("#app").innerHTML = `<div class="emptyState"><h2>Your following feed</h2><p>Log in to see reviews from people you follow.</p><button class="btn" data-login>Log in</button></div>`; return; }
  const { reviews } = await api("/api/feed");
  $("#app").innerHTML = `<section class="intro small"><h1>Following</h1><p>The latest verdicts and reviews from people you follow.</p></section>
    <div id="feed" class="reviewCols">${reviews.map(r => reviewCard(r, { showTitle: true })).join("") || `<p class="empty">Nothing yet. Follow people from their profile or from reviews you like.</p>`}</div>`;
  wireReviews($("#feed"));
}

async function pageProfile(username) {
  const tab = new URLSearchParams(location.search).get("tab") || "reviews";
  const p = await api("/api/u/" + username);
  const u = p.user;
  document.title = `${u.name} (@${u.username}) · Telly Verdict`;
  const tot = p.stats.reviews;
  $("#app").innerHTML = `<section class="profileHead">
      ${avatar(u, 88)}
      <div class="pinfo"><h1>${esc(u.name)}</h1><span class="note">@${esc(u.username)}${u.role === "admin" ? " · Editor" : ""} · joined ${fmtDate(new Date(u.createdAt).toISOString(), { month: "long", year: "numeric" })}</span>
        ${u.bio ? `<p>${esc(u.bio)}</p>` : ""}
        <div class="pstats"><span><b>${p.stats.watched}</b> watched</span><span><b>${tot}</b> verdicts</span><button class="linkish" data-list="followers"><b>${u.followers}</b> followers</button><button class="linkish" data-list="following"><b>${u.following}</b> following</button></div>
        ${tot ? `<div class="vbar big" title="Verdict split">${p.stats.verdicts.map((n, i) => `<span style="width:${(n / tot) * 100}%;background:${VERDICTS[i].c}"></span>`).join("")}</div><small class="note">${p.stats.verdicts.map((n, i) => `${VERDICTS[i].k} ${n}`).join(" · ")}</small>` : ""}
      </div>
      <div>${u.isMe ? `<button class="ghost" id="editProfile">Edit profile</button>` : `<button class="btn ${u.followedByMe ? "ghostish" : ""}" id="follow">${u.followedByMe ? "Following" : "Follow"}</button> <button class="ghost subtle" data-report="profile" data-id="${u.id}">Report</button>${state.me?.role === "admin" ? ` <button class="ghost danger" id="banUser">${u.banned ? "Unblock" : "Block"} member</button>` : ""}`}</div>
    </section>
    ${progressCard(p.progress, u.isMe)}
    <div class="seg tabs" id="ptabs">${[["reviews", "Reviews"], ["watched", "Watched"], ["later", "Watch later"], ["collections", "Collections"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div>
    <div id="ptab"></div>`;
  const show = k => {
    const el = $("#ptab");
    if (k === "reviews") { el.innerHTML = p.reviews.length ? `<div class="reviewCols">${p.reviews.map(r => reviewCard(r, { showTitle: true })).join("")}</div>` : `<p class="empty">No verdicts yet.</p>`; wireReviews(el); }
    if (k === "watched") el.innerHTML = grid(p.watched, "Nothing marked as watched yet.");
    if (k === "later") el.innerHTML = grid(p.later, "Watch later is empty.");
    if (k === "collections") el.innerHTML = (u.isMe ? `<form id="mkCol" class="inline"><input id="mkColName" maxlength="80" placeholder="New collection name" aria-label="New collection name"><button class="btn small">Create collection</button></form>` : "")
      + (p.collections.length ? `<div class="colGrid">${p.collections.map(colCard).join("")}</div>` : `<p class="empty">No collections yet.</p>`);
    $("#mkCol")?.addEventListener("submit", async e => { e.preventDefault(); const name = $("#mkColName").value.trim(); if (!name) return; const { collection } = await api("/api/collections", { body: { name } }); go("/collection/" + collection.id); });
  };
  show(tab);
  $("#ptabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; $$("#ptabs button").forEach(x => x.setAttribute("aria-pressed", x === b)); history.replaceState(null, "", `/u/${u.username}?tab=${b.dataset.tab}`); show(b.dataset.tab); };
  $("#banUser")?.addEventListener("click", async e => {
    const b = e.currentTarget; if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to confirm"; return; }
    await api("/api/admin/ban", { body: { userId: u.id, banned: !u.banned } }); toast(u.banned ? "Member unblocked." : "Member blocked."); render();
  });
  $("#follow")?.addEventListener("click", async () => { if (!requireLogin(() => go(location.pathname))) return; await api(`/api/u/${u.username}/follow`, { body: {} }); render(); });
  $$("[data-list]").forEach(b => b.onclick = async () => {
    const { users } = await api(`/api/u/${u.username}/${b.dataset.list}`);
    openModal(`<h2>${b.dataset.list === "followers" ? "Followers" : "Following"}</h2><div class="userList">${users.map(x => userLink(x)).join("") || `<p class="note">No one yet.</p>`}</div>`);
    $$("#modalBody a").forEach(a => a.addEventListener("click", () => modal.close()));
  });
  $("#editProfile")?.addEventListener("click", () => {
    openModal(`<form class="authForm" id="pf"><h2>Edit profile</h2><label>Display name<input id="pfName" maxlength="50" value="${esc(u.name)}"></label><label>Bio<textarea id="pfBio" maxlength="300">${esc(u.bio)}</textarea></label><button class="btn">Save</button></form>`);
    $("#pf").onsubmit = async e => { e.preventDefault(); await api("/api/me", { body: { name: $("#pfName").value, bio: $("#pfBio").value } }); modal.close(); await loadMe(); render(); };
  });
}
function progressCard(g, isMe) {
  if (!g) return "";
  return `<section class="progress">
    <div class="pgTop">
      <div><span class="label">Level ${g.level}${g.rank ? ` · #${g.rank} all time` : ""}</span><h3>${esc(g.name)} <span class="pts">${g.points.toLocaleString("en-GB")} pts</span></h3></div>
      <a class="more" href="/leaderboard" data-link>Leaderboard →</a>
    </div>
    <div class="xp"><i style="width:${Math.round(g.progress * 100)}%"></i></div>
    <small class="note">${g.next ? `${(g.next.at - g.points).toLocaleString("en-GB")} points to ${esc(g.next.name)}` : "Top level reached"}</small>
    <div class="badges">${g.badges.map(b => `<span class="bdg ${b.earned ? "on" : ""}" title="${esc(b.desc)}"><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></span>`).join("")}</div>
    ${isMe ? `<small class="note">Badges you haven't earned yet are dimmed. <a href="/leaderboard#how" data-link>How points work</a></small>` : ""}
  </section>`;
}
const colCard = c => `<a class="colCard" href="/collection/${c.id}" data-link><div class="colStack">${[0, 1, 2, 3].map(i => c.preview[i] ? poster(c.preview[i], "tiny") : `<div class="poster tiny empty"></div>`).join("")}</div><b>${esc(c.name)}${c.editorial ? ' <span class="badge inline">Editor\'s pick</span>' : ""}</b><small>${c.count} title${c.count === 1 ? "" : "s"} · by @${esc(c.owner?.username)}</small></a>`;

async function pageCollection(id) {
  const { collection: c } = await api("/api/collection/" + id);
  const mine = state.me && c.owner?.id === state.me.id;
  document.title = `${c.name} · Telly Verdict`;
  $("#app").innerHTML = `<section class="intro small"><span class="label">${c.editorial ? "Editor's pick" : "Collection"}</span><h1>${esc(c.name)}</h1>
      ${c.description ? `<p>${esc(c.description)}</p>` : ""}<p class="note">${c.count} title${c.count === 1 ? "" : "s"} · by <a href="/u/${c.owner?.username}" data-link>@${esc(c.owner?.username)}</a></p>
      ${mine ? `<div class="cta"><button class="ghost" id="editCol">Edit</button><button class="ghost danger" id="delCol">Delete collection</button></div>` : state.me ? `<div class="cta"><button class="ghost subtle" data-report="collection" data-id="${c.id}">Report</button>${state.me.role === "admin" ? `<button class="ghost" id="editCol">Edit as editor</button>` : ""}</div>` : ""}</section>
    ${c.items.length ? `<div class="grid">${c.items.map(t => card(t, mine ? `<button class="ghost small rm" data-rm="${t.key}">Remove</button>` : "")).join("")}</div>` : `<p class="empty">Nothing here yet. Use “Add to collection” on any title page.</p>`}`;
  $$("[data-rm]").forEach(b => b.onclick = async e => { e.preventDefault(); await api(`/api/collection/${id}`, { body: { toggleKey: b.dataset.rm } }); await loadMe(); render(); });
  $("#delCol")?.addEventListener("click", async e => {
    const b = e.currentTarget; if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; return; }
    await api(`/api/collection/${id}`, { method: "DELETE" }); await loadMe(); go(`/u/${state.me.username}?tab=collections`);
  });
  $("#editCol")?.addEventListener("click", () => {
    openModal(`<form class="authForm" id="cf"><h2>Edit collection</h2><label>Name<input id="cfName" maxlength="80" value="${esc(c.name)}"></label><label>Description<textarea id="cfDesc" maxlength="500">${esc(c.description)}</textarea></label>
      ${state.me.role === "admin" ? `<label class="check"><input type="checkbox" id="cfEd" ${c.editorial ? "checked" : ""}> Show on the home page as an editor's pick</label><label>Home page position (lower shows first)<input id="cfPos" type="number" min="0" max="999" value="${c.position ?? 100}"></label>` : ""}<p class="err" id="cfErr"></p><button class="btn">Save</button></form>`);
    $("#cf").onsubmit = async e => {
      e.preventDefault();
      try { await api(`/api/collection/${id}`, { body: { name: $("#cfName").value, description: $("#cfDesc").value, ...(state.me.role === "admin" && { editorial: $("#cfEd").checked, position: Number($("#cfPos").value) }) } }); modal.close(); render(); }
      catch (er) { $("#cfErr").textContent = er.message; }
    };
  });
}

// ---------- reporting ----------
document.addEventListener("click", e => {
  const b = e.target.closest("[data-report]"); if (!b) return;
  e.preventDefault();
  if (!requireLogin()) return;
  const what = { review: "review", comment: "comment", discussion: "message", profile: "profile", collection: "collection" }[b.dataset.report];
  openModal(`<form class="authForm" id="rep"><h2>Report this ${what}</h2><p class="note">Moderators review every report. See the <a href="/rules" data-link>community rules</a>.</p>
    ${[["spoilers", "Unmarked spoilers"], ["abuse", "Harassment or abuse"], ["hate", "Hate speech"], ["spam", "Spam or advertising"], ["sexual", "Sexual content"], ["other", "Something else"]].map(([v, l], i) => `<label class="check"><input type="radio" name="reason" value="${v}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}
    <label>Anything else we should know? (optional)<textarea id="repNote" maxlength="500"></textarea></label><p class="err" id="repErr"></p><button class="btn">Send report</button></form>`);
  $("#rep").onsubmit = async ev => {
    ev.preventDefault();
    try { await api("/api/report", { body: { type: b.dataset.report, id: b.dataset.id, reason: $("input[name=reason]:checked", modal).value, note: $("#repNote").value } }); modal.close(); toast("Thanks. A moderator will look at it."); }
    catch (er) { $("#repErr").textContent = er.message; }
  };
});

// ---------- share cards (1080×1920 image for Instagram and Snapchat stories) ----------
async function shareCard({ reviewId }) {
  const data = await api(`/api/review/${reviewId}/card`).catch(() => null);
  if (!data) { toast("Couldn't make the card. Try again."); return; }
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
  const g = c.getContext("2d");
  const colours = ["#ff6b6b", "#ffb547", "#5fd3a0", "#b892ff"];
  g.fillStyle = "#0f1417"; g.fillRect(0, 0, 1080, 1920);
  await document.fonts.load("800 80px 'Bricolage Grotesque'").catch(() => {});
  if (data.poster) {
    const img = await new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = data.poster.replace("/w342/", "/w780/"); });
    if (img) { g.save(); g.globalAlpha = .35; g.drawImage(img, -200, 0, 1480, 2220); g.restore(); g.drawImage(img, 240, 220, 600, 900); }
  }
  const grad = g.createLinearGradient(0, 1000, 0, 1920); grad.addColorStop(0, "rgba(15,20,23,0)"); grad.addColorStop(.35, "#0f1417"); g.fillStyle = grad; g.fillRect(0, 1000, 1080, 920);
  g.fillStyle = "#edf1ee"; g.textAlign = "center";
  g.font = "800 72px 'Bricolage Grotesque', sans-serif";
  wrapText(g, data.title + (data.year ? ` (${data.year})` : ""), 540, 1240, 940, 80);
  g.fillStyle = colours[data.verdict]; g.font = "800 120px 'Bricolage Grotesque', sans-serif";
  g.fillText(VERDICTS[data.verdict].k, 540, 1480);
  g.fillStyle = "#93a4ab"; g.font = "500 40px Figtree, sans-serif";
  g.fillText(`@${data.username}'s verdict${data.score ? ` · ${data.score.toFixed(1)}/10` : ""}`, 540, 1560);
  if (data.meter != null) g.fillText(`${data.meter}% of Telly Verdict members say Go for it or Perfection`, 540, 1640);
  g.fillStyle = "#ffb547"; g.font = "800 46px 'Bricolage Grotesque', sans-serif"; g.fillText("Telly Verdict", 540, 1800);
  const blob = await new Promise(res => c.toBlob(res, "image/png"));
  const file = new File([blob], `${slugify(data.title)}-verdict.png`, { type: "image/png" });
  const url = URL.createObjectURL(blob);
  openModal(`<h2>Your share card</h2><img src="${url}" alt="Share card" class="cardPreview">
    <div class="cta">${navigator.canShare?.({ files: [file] }) ? `<button class="btn" id="doShare">Share</button>` : ""}<a class="ghost" href="${url}" download="${file.name}">Save image</a></div>
    <p class="note">Post it as an Instagram or Snapchat story.</p>`);
  $("#doShare")?.addEventListener("click", () => navigator.share({ files: [file], title: data.title, text: `My verdict on ${data.title}: ${VERDICTS[data.verdict].k}`, url: location.origin + data.path }).catch(() => {}));
}
function wrapText(g, text, x, y, max, lh) {
  const words = text.split(" "); let line = ""; const lines = [];
  for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line); lines.slice(0, 3).forEach((l, i) => g.fillText(l, x, y - (Math.min(lines.length, 3) - 1) * lh + i * lh));
}

// ---------- notifications ----------
async function pageNotifications() {
  if (!state.me) { $("#app").innerHTML = `<div class="emptyState"><h2>Notifications</h2><p>Log in to see likes, replies, new followers and Watch later alerts.</p><button class="btn" data-login>Log in</button></div>`; return; }
  const { items } = await api("/api/notifications");
  const text = n => ({
    like: `${userLink(n.actor)} liked your review of ${n.title ? `<a href="${n.title.path}" data-link>${esc(n.title.title)}</a>` : "a title"}`,
    comment: `${userLink(n.actor)} commented on your review of ${n.title ? `<a href="${n.title.path}" data-link>${esc(n.title.title)}</a>` : "a title"}: “${esc(n.detail)}”`,
    follow: `${userLink(n.actor)} started following you`,
    arrival: `<a href="${n.title?.path}" data-link><b>${esc(n.title?.title || "A title on your Watch later list")}</b></a> · ${esc(n.detail)}`,
    removed: esc(n.detail),
  }[n.type] || "");
  $("#app").innerHTML = `<section class="intro small"><h1>Notifications</h1></section>
    <div class="notes">${items.map(n => `<div class="note-row ${n.read ? "" : "unread"}"><span class="nicon">${{ like: "♥", comment: "💬", follow: "＋", arrival: "📺", removed: "⚠" }[n.type]}</span><div>${text(n)}<small>${ago(n.createdAt)}</small></div></div>`).join("") || `<p class="empty">Nothing yet. You'll hear here when people like or reply to your reviews, follow you, or when something on your Watch later list arrives in the UK.</p>`}</div>`;
  if (items.some(n => !n.read)) { await api("/api/notifications/read", { body: {} }).catch(() => {}); state.unread = 0; renderAccount(); }
}

// ---------- settings and your data ----------
async function pageSettings() {
  if (!state.me) { $("#app").innerHTML = `<div class="emptyState"><h2>Settings</h2><button class="btn" data-login>Log in</button></div>`; return; }
  const u = state.me;
  $("#app").innerHTML = `<section class="intro small"><h1>Settings and your data</h1></section>
    <div class="settings">
      <section><h2>Profile</h2><form class="authForm" id="pf"><label>Display name<input id="pfName" maxlength="50" value="${esc(u.name)}"></label><label>Bio<textarea id="pfBio" maxlength="300">${esc(u.bio)}</textarea></label><p class="err" id="pfErr"></p><button class="btn">Save profile</button></form></section>
      <section><h2>Password</h2><p class="note">We'll email you a link to set a new password.</p><button class="ghost" id="resetPw">Email me a reset link</button></section>
      <section><h2>Download your data</h2><p class="note">A copy of your profile, reviews, comments, likes, follows, lists, collections and discussion posts, as a JSON file.</p><button class="ghost" id="exportData">Download my data</button></section>
      <section class="dangerZone"><h2>Delete your account</h2><p class="note">This permanently deletes your account and everything you've posted. It can't be undone.</p>
        <form class="authForm" id="delAcc"><label>Type your username, <b>${esc(u.username)}</b>, to confirm<input id="delConfirm" autocomplete="off"></label><p class="err" id="delErr"></p><button class="btn dangerBtn">Delete my account</button></form></section>
    </div>`;
  $("#pf").onsubmit = async e => { e.preventDefault(); try { await api("/api/me", { body: { name: $("#pfName").value, bio: $("#pfBio").value } }); await loadMe(); toast("Profile saved."); } catch (er) { $("#pfErr").textContent = er.message; } };
  $("#resetPw").onclick = () => openAuth("forgot");
  $("#exportData").onclick = async () => {
    const res = await fetch("/api/me/export", { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) return toast("Couldn't prepare your data. Try again.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = `telly-verdict-${u.username}.json`; a.click(); URL.revokeObjectURL(url);
  };
  $("#delAcc").onsubmit = async e => {
    e.preventDefault();
    try { await api("/api/me/delete", { body: { confirm: $("#delConfirm").value } }); await sb.auth.signOut(); localStorage.removeItem("tv-me"); state.me = null; renderAccount(); go("/"); toast("Your account has been deleted."); }
    catch (er) { $("#delErr").textContent = er.message; }
  };
}

// ---------- moderation (admins) ----------
async function pageAdmin() {
  if (state.me?.role !== "admin") { $("#app").innerHTML = `<div class="emptyState"><h2>Moderation</h2><p>Only admins can see this page.</p></div>`; return; }
  const tab = new URLSearchParams(location.search).get("tab") || "open";
  $("#app").innerHTML = `<section class="intro small"><h1>Moderation</h1><p>Reports from members, grouped by item. Removing an item tells its author why.</p></section>
    <div class="seg tabs" id="atabs">${[["open", "Open reports"], ["removed", "Removed"], ["dismissed", "Dismissed"], ["terms", "Blocked words"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div><div id="atab"></div>`;
  $("#atabs").onclick = e => { const b = e.target.closest("button"); if (b) go("/admin?tab=" + b.dataset.tab, true); };
  const el = $("#atab");
  if (tab === "terms") {
    const draw = terms => {
      el.innerHTML = `<form class="inline" id="addTerm"><input id="term" maxlength="60" placeholder="Word or phrase to block" aria-label="Word or phrase to block"><button class="btn small">Block</button></form>
        <p class="note">Posts containing these as whole words are rejected with a request to reword. Posts with more than one link are always rejected.</p>
        <div class="chips">${terms.map(t => `<span class="f">${esc(t.term)} <button class="linkish" data-unterm="${esc(t.term)}" aria-label="Unblock ${esc(t.term)}">✕</button></span>`).join("") || `<p class="note">No blocked words yet.</p>`}</div>`;
      $("#addTerm").onsubmit = async e => { e.preventDefault(); try { draw((await api("/api/admin/terms", { body: { term: $("#term").value } })).terms); } catch (er) { toast(er.message); } };
      $$("[data-unterm]", el).forEach(b => b.onclick = async () => draw((await api("/api/admin/terms", { body: { term: b.dataset.unterm, remove: true } })).terms));
    };
    draw((await api("/api/admin/terms")).terms);
    return;
  }
  const { items } = await api("/api/admin/reports?status=" + tab);
  const reasons = { spoilers: "Unmarked spoilers", abuse: "Harassment or abuse", hate: "Hate speech", spam: "Spam", sexual: "Sexual content", other: "Other" };
  el.innerHTML = items.map(i => `<article class="report" data-type="${i.type}" data-id="${i.id}">
      <header><span class="label">${esc(i.type)} · ${i.reports.length} report${i.reports.length === 1 ? "" : "s"}</span>${i.owner ? userLink(i.owner) : ""}${i.owner?.banned ? `<span class="vpill" style="--c:var(--skip)">Blocked</span>` : ""}</header>
      ${i.target ? `<blockquote>${esc(i.target.text)}</blockquote>${i.target.link ? `<a class="more" href="${i.target.link}" data-link>View in context</a>` : ""}` : `<p class="note">Already deleted.</p>`}
      <ul class="reasons">${i.reports.map(r => `<li><b>${reasons[r.reason]}</b>${r.note ? `: ${esc(r.note)}` : ""} <small>by @${esc(r.reporter?.username || "?")} · ${ago(r.createdAt)}</small></li>`).join("")}</ul>
      ${tab === "open" ? `<div class="cta">${i.type !== "profile" && i.target ? `<button class="btn small" data-act="remove">Remove</button>` : ""}${i.owner && !i.owner.banned ? `<button class="ghost danger" data-act="ban">Block member</button>` : ""}<button class="ghost" data-act="dismiss">Dismiss</button></div>` : ""}
    </article>`).join("") || `<p class="empty">${tab === "open" ? "No open reports. Nice." : "Nothing here."}</p>`;
  el.onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const card = b.closest(".report");
    if (b.dataset.act === "ban" && b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to block"; return; }
    try { await api("/api/admin/resolve", { body: { type: card.dataset.type, id: card.dataset.id, action: b.dataset.act } }); card.remove(); toast({ remove: "Removed.", ban: "Member blocked.", dismiss: "Dismissed." }[b.dataset.act]); }
    catch (er) { toast(er.message); }
  };
}

// ---------- privacy, terms and rules ----------
function pageStatic(which) {
  const pages = {
    privacy: `<h1>Privacy</h1><p class="note">Last updated 21 October 2026. Draft: have it checked before launch.</p>
      <h2>Who we are</h2><p>Telly Verdict is a UK guide to new films and TV. [Company name, address and contact email go here.] We are the data controller for the personal data described below.</p>
      <h2>What we collect</h2><ul><li>Account details: email address, username, display name, bio and password (stored hashed by our authentication provider).</li><li>What you post: verdicts, scores, reviews, comments, discussion messages, likes, follows, lists and collections.</li><li>Reports you make, and moderation decisions about your posts.</li><li>Technical data needed to run the site: IP address and browser details in server logs, kept for up to 30 days.</li></ul>
      <h2>Why we use it (lawful basis)</h2><ul><li>To provide your account and the community features you sign up for (contract).</li><li>To keep the community safe, prevent spam and abuse, and secure the site (legitimate interests).</li><li>To meet legal obligations, such as responding to lawful requests.</li></ul>
      <h2>What's public</h2><p>Your username, display name, bio, verdicts, reviews, comments, discussion messages, lists, collections, followers and points are public. Your email address is never shown.</p>
      <h2>Who we share it with</h2><p>Supabase (database and login, hosted in London), our email provider, and our hosting provider, each under a data processing agreement. We don't sell your data. Film data comes from TMDB; we don't send them your personal data.</p>
      <h2>Cookies and storage</h2><p>We only use storage that's needed for the site to work: keeping you logged in and remembering your account. We don't use advertising or analytics cookies. If that changes we'll ask first.</p>
      <h2>How long we keep it</h2><p>Until you delete your account. Deleting your account permanently removes your profile and everything you've posted. Backups are overwritten within 30 days.</p>
      <h2>Your rights</h2><p>You can see, download and delete your data any time from <a href="/settings" data-link>Settings</a>. You can also ask us to correct it, restrict or object to how we use it. If you're unhappy with how we've handled your data you can complain to the Information Commissioner's Office (ico.org.uk).</p>`,
    terms: `<h1>Terms of use</h1><p class="note">Last updated 21 October 2026. Draft: have it checked before launch.</p>
      <h2>Using Telly Verdict</h2><p>You must be 13 or over to create an account. Keep your login details safe; you're responsible for what's posted from your account.</p>
      <h2>Your posts</h2><p>You own what you write. By posting it you give us a non-exclusive licence to show it on Telly Verdict and in share cards you create. Follow the <a href="/rules" data-link>community rules</a>. We may remove posts or block accounts that break them.</p>
      <h2>Film information</h2><p>Titles, images and availability come from TMDB and JustWatch and may be incomplete or out of date. Check with the streaming service or cinema before you pay. Some cinema links may be affiliate links; we may earn a commission at no cost to you.</p>
      <h2>Liability</h2><p>The site is provided as is. Nothing in these terms limits liability that can't be limited under UK law.</p>
      <h2>Law</h2><p>These terms are governed by the law of England and Wales.</p>`,
    rules: `<h1>Community rules</h1><ul class="ruleList"><li><b>Mark spoilers.</b> Tick "Contains spoilers" on reviews and messages that give anything away.</li><li><b>Review the title, not the people.</b> Criticise films and shows as hard as you like; don't attack other members, cast or crew personally.</li><li><b>No hate speech or harassment.</b> Nothing that targets people for who they are.</li><li><b>No spam or advertising.</b> One link per post at most.</li><li><b>No sexual content</b> and nothing illegal.</li><li><b>One account per person.</b> Don't use extra accounts to like your own reviews or dodge a block.</li></ul><p>Report anything that breaks these rules. Moderators may remove posts and block accounts.</p>`,
  };
  document.title = `${{ privacy: "Privacy", terms: "Terms of use", rules: "Community rules" }[which]} | Telly Verdict`;
  $("#app").innerHTML = `<article class="prose">${pages[which]}</article>`;
}

// ---------- boot ----------
(async () => {
  CONFIG = await api("/api/config").catch(() => ({}));
  if (CONFIG.supabaseUrl && window.supabase) {
    sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && location.pathname !== "/reset-password") go("/reset-password", true);
      if (event === "SIGNED_OUT" || event === "USER_UPDATED") loadMe();
    });
  }
  // Show the last known account straight away; confirm it with the server in the background.
  let cached = null; try { cached = JSON.parse(localStorage.getItem("tv-me") || "null"); } catch {}
  const hasSession = sb ? !!(await sb.auth.getSession()).data.session : false;
  if (cached?.user && hasSession) { state.me = cached.user; state.marks = cached.marks; state.collections = cached.collections || []; state.unread = cached.unread || 0; renderAccount(); render(); loadMe(); }
  else { await loadMe(); render(); }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
