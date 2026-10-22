# Prime Service — Veille Turso (préparation, site actif intact)

Ce dossier prépare la **future bascule de Supabase vers Turso**, sans toucher
au site actif : le site, les Edge Functions et la base Supabase continuent de
fonctionner normalement. C'est une copie de veille : elle ne reçoit pas les
commandes nouvelles tant que vous ne demandez pas la bascule.

## Contenu

| Fichier | Rôle |
|---|---|
| `exporter-supabase.py` | Exporte schéma + données Supabase → `prime-service-veille.db` (SQLite) et `prime-service-veille.sql`. Jeton Supabase lu depuis un fichier local, jamais affiché. |
| `charger-turso.mjs` | Charge `prime-service-veille.sql` dans une base Turso et vérifie les décomptes. Jeton Turso lu depuis un fichier local, jamais affiché. |
| `prime-service-veille.db` / `.sql` | Copie de veille (générés ; le `.db` n'est pas commité, voir `.gitignore`). |

## État de la préparation

- Schéma complet des 9 tables `public` copié en SQLite/libSQL
  (`parametres`, `produits`, `commandes`, `notifications_generales`,
  `notifications_boutiquiers`, `suivis_notifications_boutiquiers`,
  `abonnements_push`, `traitements_images_produits`, `site_visites`),
  avec les index utiles (unique `ack_token`, index visites, file d'images…).
- Données actuelles copiées telles quelles (id, timestamps ISO…).

## Relancer une copie de veille fraîche

1. Créer un jeton Supabase : <https://supabase.com/dashboard/account/tokens>
   → Create new token → l'enregistrer dans un fichier local (ex. `Cle.txt`).
2. `python3 turso-migration/exporter-supabase.py <chemin-hors-chat> kfxalpvbtbvkncztjwzc`
3. Vérifier les décomptes affichés.

## Charger la base Turso

1. Dans le tableau de bord Turso, créer une base (ex. `prime-service`,
   région proche du Mali : `fra`/`cdg` conviennent) et un jeton
   Settings → API Tokens, enregistré dans un fichier local.
2. `npm i @libsql/client` (dans `prime-service/turso-migration/`)
3. `node charger-turso.mjs "libsql://…turso.io" <fichier-jeton>`
4. Les décomptes doivent égaler l'export.

## Ce qu'une vraie bascule demandera ensuite (à NE PAS faire maintenant)

- Remplacer dans `index.html` / `inscription.html` le client `createClient`
  Supabase par des appels à une petite API serveur (libSQL) — les tables ne
  sont plus exposées en HTTP granulaire comme PostgREST ; il faut une couche
  d'API (le site reste sur GitHub Pages, donc cette couche vit sur un Worker).
- Réécrire les Edge Functions (`envoyer-commande`, `notifier-boutiquier`,
  `accuser-notification`, `lier-notification-push`, `clever-processor`,
  `embellir-photo-produit`, `envoyer-sms-orange`, `envoyer-inscription`,
  `enregistrer-visite`) vers des Workers Cloudflare qui parlent à Turso via
  `@libsql/client`. Les crons (relances, file d'images) deviennent des
  déclencheurs planifiés du Worker.
- Les **photos produit restent sur le stockage Supabase** (les URLs
  `…supabase.co/storage/v1/object/public/` continuent de fonctionner même
  après bascule de la base, tant que le projet Supabase existe) — sur
  mtemplate, migrer les images hors Supabase AVANT de fermer le projet.
- Les policies RLS du SQL Supabase n'existent pas côté Turso : la couche API
  devra porter elle-même les règles (montants recalculés côté serveur,
  abonnements push liés par numéro vérifié, etc.).

## Ne cassez rien

Ce dossier est **sans effet** sur le site tant que vous ne demandez pas la
bascule. Ne modifiez pas `CONFIG.SUPABASE_URL` ni les Edge Functions.
