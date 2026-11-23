// Кэш на устройстве: повторные заходы быстрее и дешевле по трафику.
// - панорамы и файлы с хэшем в имени (/assets/) берутся из кэша сразу;
// - модели, текстуры и небо отдаются из кэша и тихо обновляются в фоне (чтобы новые версии доходили при следующем заходе);
// - видео не кэшируется (запросы по частям).
const PANORAMAS = 'stadium-panoramas-v1';
const STATIC = 'stadium-static-v1';
const REVALIDATE = /\.(webp|glb|hdr|jpg|png)$/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.headers.has('range')) return;
  const isPanorama = url.pathname.includes('/panoramas/') && url.pathname.endsWith('.webp');
  const isHashed = url.pathname.includes('/assets/');
  const isStatic = REVALIDATE.test(url.pathname);
  if (!isPanorama && !isHashed && !isStatic) return;
  event.respondWith(caches.open(isPanorama ? PANORAMAS : STATIC).then(async (cache) => {
    const cached = await cache.match(event.request);
    const refresh = () => fetch(event.request).then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    });
    if (cached) {
      // Хэшированные файлы и панорамы не меняются; остальное обновляется в фоне.
      if (!isPanorama && !isHashed) event.waitUntil(refresh().catch(() => {}));
      return cached;
    }
    return refresh();
  }));
});
