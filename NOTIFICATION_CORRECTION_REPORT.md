# Rapport d’audit et de correction Prime Service

## Résumé exécutif

Le site public est accessible et le parcours client principal est opérationnel : le catalogue charge, le checkout utilise un seul appel serveur, le stock est recalculé et réservé côté Supabase, puis la confirmation client ne dépend pas de Discord, SMS, push ou WhatsApp.

L’audit a identifié un manque important dans le parcours des relances : le navigateur public pouvait auparavant écrire directement un numéro boutique dans `abonnements_push`. Cette possibilité a été supprimée. Le SMS initial contient maintenant un jeton opaque ; le serveur vérifie ce jeton avant d’associer le navigateur au numéro concerné.

## État actuel des fonctions

| Fonction | Version active | JWT | Rôle |
|---|---:|---|---|
| `envoyer-commande` | 42 | désactivé pour le checkout public | Enregistre la commande, crée une file indépendante par boutique et envoie Discord/SMS en arrière-plan |
| `envoyer-inscription` | 21 | activé | Notifie le propriétaire uniquement |
| `notifier-boutiquier` | 22 | activé | Exécute les quatre tentatives push et l’escalade Discord |
| `accuser-notification` | 1 | désactivé, jeton opaque requis | Arrête les relances après confirmation |
| `lier-notification-push` | 1 | désactivé, jeton boutique requis | Lie l’abonnement push au bon numéro côté serveur |

Le cron Supabase `verifier-notifications-boutiquiers` est actif chaque minute. La migration `secure_push_subscription_binding` est appliquée en production.

## Relances boutique

Chaque boutique concernée dispose d’une ligne indépendante. Le worker tente un push immédiatement, puis environ trois, six et neuf minutes après le premier passage. Les notifications 2 à 4 utilisent une interaction obligatoire, une vibration plus visible et le bouton rouge **J’AI VU LA COMMANDE**. Un accusé valide remplit `acknowledged_at`, passe le statut à `accusee` et annule `prochaine_tentative`.

Après la quatrième tentative sans réponse, la ligne passe à `echec_definitif` et le propriétaire reçoit Discord avec le nom de la boutique, la commande et le numéro à appeler manuellement. Le cron étant déclenché chaque minute, l’échéance réelle peut varier d’environ une minute.

## Confidentialité financière

Le propriétaire reçoit le détail du prix client, du montant net boutique et de la commission par article et au total. Le boutiquier reçoit uniquement ses articles, ses quantités, son montant **NET**, le client, la carte et le lien d’activation. Les messages boutique ne contiennent pas la commission, la marge, le prix client ou les données d’une autre boutique.

Les images destinées au propriétaire sont vérifiées côté serveur puis envoyées comme pièces jointes Discord. Un SMS ne peut pas contenir de vraie photo intégrée ; le push et WhatsApp sont les canaux visuels prévus pour cela.

## Correction de sécurité appliquée

La policy publique sur `abonnements_push` accepte désormais uniquement `telephone_boutique IS NULL`. Un navigateur ne peut plus attribuer directement son abonnement au numéro d’une boutique. `lier-notification-push` reçoit `boutique_token`, recherche le jeton dans `notifications_boutiquiers`, récupère le numéro côté serveur et réalise l’insertion privilégiée.

Le test public d’une écriture directe avec `telephone_boutique` a été refusé par Supabase avec HTTP 401 et erreur RLS `42501`. Les endpoints d’accusé et de liaison refusent également un jeton invalide avec HTTP 400.

## Ce qui manque encore pour une utilisation complète

| Élément | État | Peut être réglé sans vous ? |
|---|---|---|
| Publication GitHub Pages | Active et accessible | Oui, déjà vérifié |
| Fonctions Supabase principales | Actives | Oui, déjà déployées |
| Migration RLS push | Appliquée | Oui, déjà appliquée |
| Autorisation navigateur de chaque boutiquier | Obligatoire, manuelle | Non : le navigateur exige l’action du boutiquier sur **Autoriser** |
| `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` | Présence à confirmer dans les secrets Supabase | Non sans accès à la valeur secrète ; ne pas les envoyer dans le chat |
| `DISCORD_WEBHOOK_ADMIN` | Nécessaire pour l’alerte finale d’escalade | Non sans l’URL du webhook ou sa présence confirmée dans les secrets |
| TextBee | Canal SMS dépendant d’un appareil Android configuré | Non si le téléphone, la SIM ou les identifiants TextBee ne sont pas disponibles |
| WhatsApp Cloud API | Facultatif et désactivé | Non sans compte Meta, WABA, Phone Number ID, jeton et template approuvé |
| Vérification par commande réelle | Non exécutée afin de ne pas envoyer de messages réels | Oui seulement avec votre autorisation explicite et des numéros de test |

Le site est donc utilisable pour le catalogue, les inscriptions et les commandes. Pour que les relances push fonctionnent pour une boutique, celle-ci doit ouvrir le lien reçu dans le premier SMS et autoriser les notifications sur son navigateur. La présence des secrets VAPID et du webhook Discord d’escalade doit être vérifiée dans **Supabase → Edge Functions → Secrets**.

## Tests réalisés

Les tests Node locaux, `git diff --check`, la compilation des quatre Edge Functions, les smoke tests `envoyer-commande` et `envoyer-inscription` avec corps invalides, le refus RLS d’une liaison directe et les refus de jetons invalides sont passants. Le workflow GitHub de qualité et le déploiement GitHub Pages du commit précédent étaient passants ; le dernier commit doit être poussé après validation des changements de liaison et de documentation.

## Fichiers corrigés

Les principaux fichiers sont `supabase/functions/envoyer-commande/index.ts`, `supabase/functions/lier-notification-push/index.ts`, `index.html`, `supabase/migrations/202608210004_secure_push_subscription_binding.sql`, `.github/workflows/deploy-functions.yml`, `AGENTS_ROLES.md`, `README_NOTIFICATIONS.md` et la compétence `/home/ubuntu/skills/prime-service-notifications/SKILL.md`.

## Test réel contrôlé du 21 août 2026

Deux articles fictifs `TEST_NOTIFICATION_PRIME_20260821_A` et `TEST_NOTIFICATION_PRIME_20260821_B` ont été publiés puis commandés avec le client `TEST Audit Notifications`. La commande `ff044b69-6440-484c-a868-247889177d40` a été enregistrée avec un total de 4 100 FCFA, puis supprimée avec ses articles et sa file de notification.

Le journal backend a confirmé `owner-discord: delivered=true` avec photos jointes. Le SMS boutique a échoué avec la cause exacte `TEXTBEE_API_KEY absent`, donc TextBee n’est pas actuellement configuré dans les secrets Edge Functions ou la clé n’est pas visible par la fonction. Aucun push réel n’a été envoyé car aucun abonnement push actif n’était associé au numéro de test.

Un probe push fictif a ensuite été traité par quatre tentatives. L’erreur obtenue était `The subscription p256dh value should be 65 bytes long`, et non `Clés VAPID absentes` : les variables VAPID ont donc été lues par le worker. Le statut final est devenu `echec_definitif` avec `tentative=4`, `prochaine_tentative=null` et `escalated_at` renseigné, ce qui confirme le fonctionnement du calendrier et de l’escalade. La réception Discord a été déclenchée via le webhook administrateur ou, à défaut, le webhook propriétaire de secours ; le test ne permet pas de distinguer lequel sans lire les secrets.

Les compteurs de nettoyage sont tous à zéro : articles TEST, commande TEST, notification TEST et abonnement push fictif supprimés.
