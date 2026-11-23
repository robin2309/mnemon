// Mnémon service worker.
//
// Goal: the installed app opens instantly and still shows its interface without a network,
// while always running the latest deployed version when the network is there.
//
// - Page (navigation): network first, cached copy of "/" as fallback when offline.
// - Built assets (/assets/*, content-hashed, immutable): cache first.
// - Other files of the site (icons, manifest): cached copy at once, refreshed in the background.
// - Anything else is left alone. In particular, requests to Supabase (data and sign-in) are
//   never cached: they always go to the network.

const CACHE = 'mnemon-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png'];
const MAX_ASSETS = 40; // old hashed bundles pile up after each deploy: keep the newest ones

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase and any other host: network only

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
  } else if (url.pathname !== '/sw.js') {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // The app is a single page: whatever the URL, the shell is "/".
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/');
    if (cached) return cached;
    return new Response('Mnémon est hors ligne.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimAssets(cache);
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

async function trimAssets(cache) {
  const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  // Keys come back in insertion order: drop the oldest.
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}
