// service worker: オフラインで使えるよう、アプリ一式をキャッシュする
// 中身を更新したら CACHE バージョン名を上げること（古いキャッシュを破棄）
const CACHE = "todofuken-drill-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./regions_data.js",
  "./prefectures_data.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// インストール時に一式をキャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(ASSETS);
      await self.skipWaiting();
    })
  );
});

// 旧バージョンのキャッシュを掃除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 取得はキャッシュ優先（オフライン動作)。無ければネットワーク。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
