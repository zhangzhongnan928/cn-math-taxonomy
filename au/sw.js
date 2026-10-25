/* Offline cache for the K-6 Learning Map (scope: au/).
 * Pages and scripts: network first, cache when offline. Data and icons: cache first, refreshed in the background.
 * Bump VERSION whenever SHELL or DATA changes or the data format changes. */
'use strict';

var VERSION = 'v1';
var PREFIX = 'au-pwa-';
var CACHE = PREFIX + VERSION;
var SCOPE = self.registration.scope;

var SHELL = [
  './',
  'index.html',
  'explore/',
  'explore/app.js',
  'diagnose/',
  'diagnose/app.js',
  'diagnose/share.js',
  'kids/',
  'kids/history.html',
  'kids/page.js',
  'kids/history.js',
  'assets/au.css',
  'assets/common.js',
  'assets/engine.js',
  'assets/home.js',
  'assets/kids.js',
  'assets/pwa.js',
  'assets/speech.js',
  'manifest.webmanifest',
  '../assets/site.css',
  '../assets/explore.css',
  '../assets/pwa.css',
  '../diagnose/style.css',
  '../children/children.css',
  '../assets/vendor/cytoscape.min.js',
  '../assets/vendor/cytoscape-dagre.js',
  '../assets/vendor/dagre.min.js',
  '../assets/vendor/qrcode.js',
  '../assets/icons/icon-192.png',
  '../assets/icons/icon-512.png',
  '../assets/icons/apple-touch-icon.png'
];

var DATA = [
  'data/topics.json',
  'data/dependencies.json',
  'data/questions.json',
  'data/standards.json'
];

function abs(path) { return new URL(path, SCOPE).href; }

function fresh(path) { return new Request(abs(path), { cache: 'reload' }); }

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE);
    // The shell must be complete; data is cached when possible (otherwise on first use).
    await cache.addAll(SHELL.map(fresh));
    await Promise.all(DATA.map(function (p) { return cache.add(fresh(p)).catch(function () { /* cached later at run time */ }); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names.filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

function cacheable(res) {
  return res && res.status === 200 && res.type === 'basic' && !res.redirected;
}

function put(req, res) {
  if (!cacheable(res)) return;
  var copy = res.clone();
  caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () { /* storage full */ });
}

function timeout(ms) {
  return new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); });
}

async function networkFirst(req, ignoreSearch, fallbackUrl) {
  try {
    var res = await Promise.race([fetch(req), timeout(5000)]);
    put(req, res);
    return res;
  } catch (e) {
    var hit = await caches.match(req, { ignoreSearch: ignoreSearch, cacheName: CACHE });
    if (hit) return hit;
    if (fallbackUrl) {
      var fb = await caches.match(fallbackUrl, { cacheName: CACHE });
      if (fb) return fb;
    }
    // Timed out with nothing cached: keep waiting for the network.
    return fetch(req);
  }
}

async function staleWhileRevalidate(req) {
  var hit = await caches.match(req, { cacheName: CACHE });
  var update = fetch(req).then(function (res) { put(req, res); return res; });
  if (hit) { update.catch(function () { /* offline */ }); return hit; }
  return update;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === new URL(abs('sw.js')).pathname) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, true, abs('./')));
    return;
  }
  if (/\.(?:json|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  event.respondWith(networkFirst(req, false, null));
});
