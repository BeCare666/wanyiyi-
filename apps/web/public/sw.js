/*
 * Service worker Wanyiyi.
 * Rôle volontairement limité : afficher un écran hors ligne élégant quand une page
 * ne peut pas être chargée, et les notifications sur le téléphone (04/11/2026).
 * Aucune donnée de membre n'est mise en cache.
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

/*
 * Notifications sur le téléphone : le texte, discret, est écrit par l'API (aucun prénom ni
 * détail). Seule une adresse de ce site peut être ouverte au toucher.
 */
function sameSitePath(url) {
  try {
    const target = new URL(url, self.location.origin);
    return target.origin === self.location.origin ? target.pathname + target.search : "/espace/notifications";
  } catch {
    return "/espace/notifications";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ifedele", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || "ifedele",
      renotify: true,
      data: { url: sameSitePath(data.url || "/espace/notifications") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = sameSitePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => (w || open).navigate(path));
      return self.clients.openWindow(path);
    }),
  );
});
