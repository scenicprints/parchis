// Keeps the app opening instantly, and opening at all when the phone has
// no signal. Only our own files are cached; Firebase always goes to the
// network, and Firestore does its own offline work underneath us.

const CACHE = 'parchis-v8';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'hub.js',
  'ui.js',
  'games/index.js',
  'games/parchis/view.js',
  'games/parchis/rules.js',
  'games/parchis/board.js',
  'games/jass/view.js',
  'games/jass/rules.js',
  'games/jass/cards.js',
  'games/jass/bot.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;      // Firebase, CDN: leave alone

  // Network first, so a deploy lands as soon as there is a signal, with the
  // cached copy standing in whenever there is not.
  //
  // The page itself is fetched past the HTTP cache. GitHub Pages serves with
  // a ten-minute max-age, and "network first" through a browser cache is
  // just the stale copy wearing a network hat: the page comes back old, it
  // points at old ?v= files, and a deploy sits invisible for ten minutes.
  // Everything else keeps normal caching; the ?v= stamp does its busting.
  const isPage = e.request.mode === 'navigate' ||
                 e.request.destination === 'document';

  e.respondWith(
    fetch(isPage ? new Request(e.request.url, { cache: 'no-store' }) : e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});
