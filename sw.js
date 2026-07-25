// Service worker : nécessaire pour que le site soit "installable".
//
// 1) Pour la page elle-même (navigation), on force toujours une nouvelle
//    demande au serveur au lieu d'une version en cache du téléphone/PC,
//    pour éviter le problème "l'appli installée n'est pas à jour".
// 2) On ne saute plus l'attente automatiquement à l'installation : ça
//    permet à la page d'afficher un bandeau "Mettre à jour" au lieu de
//    changer la version sans prévenir le vendeur ou le client en pleine
//    utilisation.

self.addEventListener("install", () => {
  // Volontairement vide : on attend l'accord de la page (voir script.js)
  // avant d'activer la nouvelle version.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() =>
        caches.match(event.request)
      )
    );
  }
});
