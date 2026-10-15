/*
 * Service worker Wanyiyi.
 * Rôle volontairement limité : afficher un écran hors ligne élégant quand une page
 * ne peut pas être chargée. Aucune donnée de membre n'est mise en cache.
 */
const CACHE = "wanyiyi-offline-v1";
const OFFLINE_PAGES = { fr: "/hors-ligne", en: "/en/hors-ligne", yo: "/yo/hors-ligne" };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(Object.values(OFFLINE_PAGES)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function offlinePageFor(url) {
  const segment = new URL(url).pathname.split("/")[1];
  return OFFLINE_PAGES[segment] ?? OFFLINE_PAGES.fr;
}

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(offlinePageFor(event.request.url))) ?? (await cache.match(OFFLINE_PAGES.fr));
    }),
  );
});
