// Offline support: keep the app shell so the site opens without a connection.
// Pages and data always come from the network first, so nothing goes stale.
const SHELL = "tv-shell-v1";
const FILES = ["/style.css", "/app.js", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width"><title>Offline</title><body style="background:#0f1417;color:#edf1ee;font:16px system-ui;padding:40px;text-align:center"><h1>You\'re offline</h1><p>Telly Verdict will be back when your connection is.</p>',
      { headers: { "content-type": "text/html; charset=utf-8" } })));
    return;
  }
  if (FILES.includes(url.pathname) && !url.search) e.respondWith(fetch(e.request).then(r => { caches.open(SHELL).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
