/**
 * Datum ADAS Offline Service Worker
 * Cache-First Strategy: Guarantees 100% offline functionality in cellular dead zones.
 */

const CACHE_NAME = 'datum-adas-offline-v14';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './src/main.js',
  './src/state.js',
  './src/engines/visionEngine.js',
  './src/engines/laneEngine.js',
  './src/engines/safetyBrain.js',
  './src/engines/lvdaEngine.js',
  './src/engines/ecoEngine.js',
  './src/engines/navigationEngine.js',
  './src/workers/visionWorker.js',
  './src/sensors/camera.js',
  './src/sensors/gps.js',
  './src/sensors/imu.js',
  './src/sensors/wakeLock.js',
  './src/ui/hud.js',
  './src/ui/audioAlerts.js',
  './src/ui/simControls.js',
  './src/ui/navHud.js'
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Fallback to cached index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
