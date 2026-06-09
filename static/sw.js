const CACHE_NAME = 'wethaq-cache-v1';
const urlsToCache = [
  '/',
  '/verify',
  '/witness',
  '/profile',
  '/static/verify.html',
  '/static/witness.html',
  '/static/profile.html',
  '/static/manifest.json'
];

self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('Service Worker: Cache failed', err))
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // استراتيجية Network First للملفات من CDN (مثل الـ API)
  if (requestUrl.hostname.includes('cdn.jsdelivr.net') || 
      requestUrl.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          return response;
        })
        .catch(() => {
          // يمكن إعادة محاولة أو عرض صفحة خطأ بسيطة
          return new Response('Network request failed', { status: 503 });
        })
    );
    return;
  }

  // استراتيجية Cache First للملفات المحلية
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
