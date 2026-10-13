/* Blattwerk – Service Worker (nur fuer die Browser-Fassung als PWA).
   In der App liegen alle Dateien ohnehin auf dem Geraet; dort wird er nicht
   registriert. Strategie wie in FairMix:
   - Navigation (index.html): erst Netz, dann Cache  -> Updates greifen sofort
   - Uebrige Dateien: erst Cache, Aktualisierung im Hintergrund
   cmaps und standard_fonts von pdf.js werden erst bei Bedarf gecacht. */

/* Der Name traegt die App-Version. validate.js vergleicht ihn mit APP_VERSION
   in der index.html. */
const CACHE = 'blattwerk-1.2.0';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './datenschutz.html',
  './impressum.html',
  './lizenzen.html',
  './icon.png',
  './icon-192.png',
  './icon-maskable-512.png',
  './lib/pdfjs/pdf.min.js',
  './lib/pdfjs/pdf.worker.min.js',
  './lib/pdf-lib.min.js',
  './lib/fontkit.umd.min.js',
  './lib/qrcode.js',
  './fonts/NotoSans-Bold.ttf',
  './fonts/NotoSans-BoldItalic.ttf',
  './fonts/NotoSans-Italic.ttf',
  './fonts/NotoSans-Regular.ttf',
  './fonts/NotoSansMath-Regular.ttf',
  './fonts/NotoSansMono-Bold.ttf',
  './fonts/NotoSansMono-Regular.ttf',
  './fonts/NotoSerif-Bold.ttf',
  './fonts/NotoSerif-BoldItalic.ttf',
  './fonts/NotoSerif-Italic.ttf',
  './fonts/NotoSerif-Regular.ttf'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(err => {
      console.warn('Vorab-Caching unvollständig:', err);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('blattwerk-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
