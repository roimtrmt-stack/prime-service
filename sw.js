// Service worker minimal : nécessaire pour que le site soit "installable".
// Ne met rien en cache pour l'instant afin que les clients voient toujours
// les derniers articles et prix (pas de version périmée affichée).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Laisse passer toutes les requêtes normalement (pas de cache forcé).
});
