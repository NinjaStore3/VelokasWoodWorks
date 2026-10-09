// Offline support. The app's files are cached when it is first opened; after
// that every request still goes to the network first (so a new deploy shows
// up straight away) and the cached copy is used only when the network fails
// or is too slow. The API is never cached here: the app keeps its own copy of
// the prices, and admin data stays online-only.
const CACHE = 'velokas-v3';
const NETWORK_TIMEOUT_MS = 4000;

// Needed to open the app offline. Must all exist, or installing fails.
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/css/app.css',
  '/icons.svg',
  '/img/logo-mark.webp',
  '/img/logo-wordmark.webp',
  '/img/logo.webp',
  '/img/favicon.png',
  '/img/grain.svg',
  '/fonts/manrope-greek-wght-normal.woff2',
  '/fonts/manrope-latin-wght-normal.woff2',
  '/fonts/manrope-latin-ext-wght-normal.woff2',
  '/fonts/fraunces-latin-wght-normal.woff2',
  '/js/api.js',
  '/js/app.js',
  '/js/calc.js',
  '/js/calculator.js',
  '/js/cutlist.js',
  '/js/cutplan.js',
  '/js/cuts.js',
  '/js/dom.js',
  '/js/icons.js',
  '/js/pdf-share.js',
  '/js/pwa.js',
  '/js/quotes.js',
  '/js/session.js',
  '/js/settings.js',
];

// Making PDFs offline. Fetched in the background; a failure here doesn't stop
// the app from installing, and they're cached on first use anyway.
const PDF_FILES = [
  '/js/pdf-common.js',
  '/js/pdf-quote.js',
  '/js/pdf-cuts.js',
  '/vendor/pdf.js',
  '/img/pdf-mark.jpg',
  '/img/pdf-wordmark.jpg',
  '/fonts/pdf/Manrope-Regular.ttf',
  '/fonts/pdf/Manrope-Bold.ttf',
  '/fonts/pdf/Fraunces-SemiBold.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all([cache.addAll(SHELL), cache.addAll(PDF_FILES).catch(() => {})]).then(() => self.skipWaiting()),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // The app is one page: every visit to it is stored and served as "/".
  const isAppPage = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  event.respondWith(networkFirst(request, isAppPage ? '/' : request));
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.status === 200 && response.type === 'basic') cache.put(key, response.clone());
    return response;
  });
  network.catch(() => {}); // handled below; keeps a late failure out of the console
  try {
    return await Promise.race([network, timeout(NETWORK_TIMEOUT_MS)]);
  } catch {
    const cached = await cache.match(key, { ignoreSearch: true });
    return cached ?? network;
  }
}
