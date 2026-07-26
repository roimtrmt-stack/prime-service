// Service worker : rend le site "installable" ET consultable hors-ligne.
//
// Stratégie "réseau d'abord, cache en secours" :
// - En ligne : on va toujours chercher la dernière version sur le serveur
//   (jamais de contenu périmé), et on garde une copie fraîche de côté.
// - Hors-ligne : si le réseau échoue, on sert la dernière copie connue
//   au lieu d'un écran d'erreur.

const CACHE_NAME = "prime-service-cache-v1";
const RESSOURCES_ESSENTIELLES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(RESSOURCES_ESSENTIELLES))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cles) =>
        Promise.all(cles.filter((cle) => cle !== CACHE_NAME).map((cle) => caches.delete(cle)))
      ),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
          return reponse;
        })
        .catch(() =>
          caches.match(event.request).then((correspondance) => correspondance || caches.match("./index.html"))
        )
    );
  }
});
