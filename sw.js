/* 바흐브 현장사진 v2 — 화면 파일 캐시(지하에서도 열리게) + 안드로이드 백그라운드 보내기 */
const CACHE = "barbe-photo-v2.3.1";
const FILES = ["./", "index.html", "app.js", "queue.js", "config.js", "boards.js", "reader.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
importScripts("queue.js");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 같은 주소의 화면 파일만: 네트워크 먼저, 안 되면 캐시 (창구 주소는 건드리지 않음)
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
// 안드로이드 크롬: 신호가 돌아오면 앱이 닫혀 있어도 보낸다
self.addEventListener("sync", (e) => {
  if (e.tag !== "barbe-send") return;
  e.waitUntil((async () => {
    const out = await self.BarbeQ.drain({ force: true });
    const cs = await self.clients.matchAll();
    cs.forEach((c) => c.postMessage({ type: "sent", out }));
    const left = (await self.BarbeQ.all()).filter(self.BarbeQ.isPending).length;
    if (left && !out.noSettings) throw new Error("남음 " + left);   // 실패로 끝내면 브라우저가 나중에 다시 부른다
  })());
});
