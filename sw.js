// Service worker : rend le site "installable" ET consultable hors-ligne.
//
// Stratégie "réseau d'abord, cache en secours" :
// - En ligne : on va toujours chercher la dernière version sur le serveur
//   (jamais de contenu périmé), et on garde une copie fraîche de côté.
// - Hors-ligne : si le réseau échoue, on sert la dernière copie connue
//   au lieu d'un écran d'erreur.

const CACHE_NAME = "prime-service-cache-v2";
const RESSOURCES_ESSENTIELLES = [
  "./",
  "./index.html",
  "./inscription.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
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
  // 0. NE PAS METTRE EN CACHE LES APPELS API (Supabase)
  const url = new URL(event.request.url);
  if (url.pathname.includes("/functions/v1/") || url.pathname.includes("/rest/v1/")) {
    // Pour les API, on va toujours sur le réseau, pas de cache.
    event.respondWith(fetch(event.request));
    return;
  }

  // [!] AJOUT CRUCIAL : Ici on dit "Si ce n'est pas une page normale (GET), ne touche à rien".
  // Ce petit bloc empêche le site de planter quand quelqu'un valide un formulaire (commande ou ajout d'article).
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  // 1. Pour les pages HTML (navigation) : réseau d'abord, cache en secours
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
    return;
  }

  // 2. Pour les images, les scripts CDN et autres fichiers : cache d'abord, réseau en secours
  event.respondWith(
    caches.match(event.request).then((reponseEnCache) => {
      if (reponseEnCache) {
        return reponseEnCache;
      }
      return fetch(event.request).then((reponseReseau) => {
        if (reponseReseau && reponseReseau.status === 200) {
          const copie = reponseReseau.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
        }
        return reponseReseau;
      });
    })
  );
});
