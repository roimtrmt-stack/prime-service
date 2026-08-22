// Service worker : rend le site installable, consultable hors-ligne et capable
// de gérer les notifications de commandes boutique et les annonces générales.
const CACHE_NAME = "prime-service-cache-v5";
const RESSOURCES_ESSENTIELLES = [
  "./",
  "./index.html",
  "./inscription.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./logo-prime-service.png",
  "./boutique-notification.html",
];
const NOTIFICATION_TTL_MS = 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(RESSOURCES_ESSENTIELLES)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.includes("/functions/v1/") || url.pathname.includes("/rest/v1/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((match) => match || caches.match("./index.html"))),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});

function parseExpiry(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function closeExpiredNotifications(tag, expiresAt) {
  const notifications = await self.registration.getNotifications({ tag });
  notifications.forEach((notification) => {
    if (notification.data && notification.data.expiresAt === expiresAt) notification.close();
  });
}

function scheduleClose(tag, expiresAt) {
  const expiry = parseExpiry(expiresAt);
  const delay = expiry - Date.now();
  if (delay <= 0) return;
  // Le navigateur peut suspendre un service worker ; la vérification à l’ouverture
  // de la page reste donc la garantie serveur, et ce timer assure la fermeture
  // immédiate lorsque le worker demeure actif.
  setTimeout(() => closeExpiredNotifications(tag, expiresAt).catch(() => {}), delay + 250);
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Prime Service", body: "Nouvelle notification" };
  }

  const receivedAt = Date.now();
  const expiresAt = payload.data?.expiresAt || new Date(receivedAt + NOTIFICATION_TTL_MS).toISOString();
  const tag = payload.tag || "prime-service-notification";
  const logo = "./logo-prime-service.png";
  const options = {
    body: payload.body || "Nouvelle commande à préparer.",
    icon: payload.icon || logo,
    badge: payload.badge || logo,
    image: payload.image || payload.data?.image || undefined,
    tag,
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : [200, 100, 200],
    data: { ...(payload.data || {}), expiresAt },
    actions: Array.isArray(payload.actions) ? payload.actions : [],
  };

  event.waitUntil((async () => {
    await closeExpiredNotifications(tag, expiresAt).catch(() => {});
    await self.registration.showNotification(payload.title || "Prime Service", options);
    scheduleClose(tag, expiresAt);
  })());
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  notification.close();

  const targetUrl = data.url || data.ackUrl || `${self.location.origin}/prime-service/boutique-notification.html`;

  if (parseExpiry(data.expiresAt) && Date.now() >= parseExpiry(data.expiresAt)) {
    event.waitUntil(self.clients.openWindow(data.ackUrl || targetUrl));
    return;
  }

  // Le bouton rouge conserve son action existante, mais ouvre d’abord les détails.
  // La page impose ensuite 1 min 30 s de lecture et l’endpoint serveur revérifie le délai.
  if (event.action === "ack") {
    event.waitUntil(self.clients.openWindow(data.ackUrl || targetUrl));
    return;
  }
  event.waitUntil(self.clients.openWindow(targetUrl));
});
