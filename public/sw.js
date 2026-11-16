/* Service worker sobre de Singletrack (#1343) — écrit à la main, sans lib : zéro dépendance à la
   version de Next.js. Objectif : la page d'une sortie / d'une trace (routes publiques /s/ et /t/),
   ses données (/api/s/, /api/t/) et les tuiles déjà vues restent consultables sans réseau (forêt).
   Les pages privées (connecté) ne sont JAMAIS mises en cache (appareil partagé). */
const VERSION = 'v3'; // v3 : nouvelles icônes (#1387), purge l'ancien cache cache-first
const STATIC = `st-static-${VERSION}`;
const PAGES = `st-pages-${VERSION}`;
const TILES = `st-tiles-${VERSION}`;
const MAX_TILES = 600;
// /t/<slug>/edit est l'éditeur (privé, connecté) : jamais en cache, même si /t est une base publique.
const PUBLIC_PATH = /^\/(s|t)\/[^/]+(?!\/edit)(\/|$)/;
const PUBLIC_API = /^\/api\/(s|t)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add('/offline')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('st-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, name, timeoutMs = 4000) {
  const cache = await caches.open(name);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    if (request.mode === 'navigate') return (await caches.match('/offline')) || Response.error();
    throw err;
  }
}

async function tile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(request, res.clone());
        const keys = await cache.keys();
        if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
      }
      return res;
    })
    .catch(() => undefined);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname.endsWith('tile.opentopomap.org')) return void event.respondWith(tile(request));
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    return void event.respondWith(cacheFirst(request, STATIC));
  }
  if (PUBLIC_PATH.test(url.pathname) || PUBLIC_API.test(url.pathname)) {
    return void event.respondWith(networkFirst(request, PAGES));
  }
  if (request.mode === 'navigate' && url.pathname !== '/offline') {
    // Page privée : réseau seul ; hors-ligne, on affiche la page de repli.
    event.respondWith(fetch(request).catch(async () => (await caches.match('/offline')) || Response.error()));
  }
});
