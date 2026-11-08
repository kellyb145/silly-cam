// Silly Cam offline cache. Bump VERSION whenever any file changes so devices pick up the update.
// Kill switch: to retire the cache on every device, deploy an sw.js whose install handler calls
// self.registration.unregister() and deletes all caches (see README).
const VERSION = 'silly-cam-v4';
const NETWORK_TIMEOUT_MS = 3000;
const SMALL = [
  './', './index.html', './style.css', './app.js', './draw.js', './games.js',
  './filters-animals.js', './filters-age.js', './filters-wigs.js', './filters-photo.js', './mesh.js',
  './facemesh.json', './manifest.webmanifest',
];
const BIG = [
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/vision_bundle.js', './vendor/vision_wasm_internal.js',
  './vendor/vision_wasm_internal.wasm', './vendor/face_landmarker.task', './vendor/hair_segmenter.tflite',
  './animals/fox.webp', './animals/chihuahua.webp', './animals/cat.webp', './animals/tiger.webp',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([...SMALL, ...BIG])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Store a copy of a good response. The clone is taken before the response is handed to the page,
// because a body can only be read once.
function store(e, req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    e.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)));
  }
  return res;
}

// Large files change only with a VERSION bump: cache first.
async function cacheFirst(e, req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  return store(e, req, await fetch(req));
}

// Small page files: try the network briefly so a fresh deploy shows up, fall back to the cache
// when offline or when the network hangs (captive portal, dead wifi).
async function networkFirst(e, req) {
  const cached = caches.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => store(e, req, res));
  const timer = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  const first = await Promise.race([net.catch(() => null), timer]);
  if (first) return first;
  const hit = await cached;
  if (hit) return hit;
  return net;   // nothing cached yet: wait for the network however long it takes
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isBig = /\/(vendor|icons)\//.test(url.pathname);
  e.respondWith(isBig ? cacheFirst(e, req) : networkFirst(e, req));
});
