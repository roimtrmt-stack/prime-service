# Analyse initiale — Prime Service

## Cahier des charges

Le site doit rester rapide et fluide. Le besoin couvre trois flux : enregistrer une commande sans attendre les notifications, envoyer Discord et SMS en arrière-plan, et recevoir/classer/stocker les articles proposés dans Supabase. Le dépôt doit rester open source et déployable depuis GitHub.

## État constaté du dépôt

Le dépôt `roimtrmt-stack/prime-service` contient un site statique sans dossier `.github/workflows` ni backend versionné. Les principaux fichiers sont `index.html`, `inscription.html`, `sw.js`, `manifest.json`, les icônes et les en-têtes de sécurité.

Le frontend charge Supabase JS et appelle déjà des Edge Functions Supabase externes, notamment `envoyer-commande`, `envoyer-notification-boutique`, `envoyer-inscription` et `ia-remplir-formulaire`. Les secrets Discord/SMS ne doivent pas être placés dans le HTML public.

## Problème de fluidité identifié

Dans `index.html`, la validation attend successivement plusieurs opérations avant d’afficher la confirmation : une lecture Supabase par article pour vérifier le stock, une requête inverse Nominatim, l’insertion de la commande, l’insertion des notifications boutiques, l’appel Discord, puis l’envoi de notifications boutiques. Le frontend attend également `envoyerNotificationAuxBoutiquiers` avant d’afficher la page de remerciement. Cela contredit la cible de confirmation en moins d’une seconde.

La correction minimale consiste à faire un seul enregistrement serveur rapide de la commande, afficher immédiatement la confirmation après succès de cet enregistrement, puis laisser un traitement serveur asynchrone s’occuper de Discord, du SMS et de la décrémentation/notification. Les messages client doivent rester génériques et les données sensibles rester côté serveur.

## Schéma Supabase observé

Le projet actif est `kfxalpvbtbvkncztjwzc`, nommé `Prime Service`, en région `eu-west-2`. Les tables publiques observées comprennent `produits`, `parametres`, `abonnements_push`, `commandes`, `notifications_boutiquiers` et `suivis_notifications_boutiquiers`. Les tables sont protégées par RLS. `commandes` est vide au moment de l’inspection ; `produits` contient 39 lignes.

Les Edge Functions actives comprennent `envoyer-commande`, `envoyer-notification-boutique`, `envoyer-inscription`, `notifier-boutiquier`, `clever-processor`, `ia-remplir-formulaire`, `keep-alive`, `envoyer-notification` et `generer-image-pro`.

## Architecture à ne pas confondre

GitHub Actions convient au déploiement, aux tests et à la maintenance planifiée, mais un workflow GitHub n’est pas le bon chemin pour répondre instantanément à une soumission publique sans exposer un jeton GitHub. Supabase documente des tâches en arrière-plan d’Edge Function qui peuvent répondre immédiatement puis poursuivre l’envoi. Le plan gratuit Supabase documente 500 000 invocations Edge Function incluses, 500 Mo de base de données et la possibilité de mettre en œuvre ce traitement sans paiement tant que les quotas restent respectés. GitHub documente 2 000 minutes mensuelles pour GitHub Free et la gratuité des runners standard pour les dépôts publics.

## Sources vérifiées

- https://supabase.com/pricing
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/functions/background-tasks
- https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations
- https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions
- https://docs.discord.com/developers/platform/webhooks
- https://docs.discord.com/developers/resources/webhook

## Décision à appliquer après clarification

La priorité est la suivante : pour une commande, notifier le propriétaire et uniquement le ou les boutiquiers qui possèdent les articles commandés ; pour une inscription, notifier uniquement le propriétaire. Le délai de traitement d’une inscription peut varier de 10 à 30 secondes selon le nombre d’articles et de photos.

L’architecture retenue est donc hybride : le frontend statique reste rapide ; la fonction Supabase de commande valide et enregistre le stock/commande puis retourne immédiatement, tandis que l’envoi des notifications est traité côté serveur en arrière-plan. GitHub Actions sera utilisé pour les tests, la vérification du dépôt et le déploiement statique, mais pas comme serveur de notification temps réel. La fonction d’inscription peut traiter les articles en série et attendre l’envoi Discord, sans affecter le parcours d’achat.

Le fournisseur SMS retenu est TextBee, car son API officielle utilise un appel REST simple, exige une clé côté serveur et un appareil Android enregistré. Son offre gratuite annoncée est sans carte bancaire, avec 1 appareil, 50 SMS par jour et 300 SMS par mois ; le coût opérateur de la SIM et du téléphone reste à la charge du propriétaire. Sinch Sandbox est adapté aux simulations mais ne livre pas de SMS réels aux boutiques ; SMS8.io est une alternative Android valide mais son API est plus spécifique. Sources : https://textbee.dev/docs/sending-sms/sending-sms et https://textbee.dev/pricing.

Le propriétaire sera le seul destinataire du webhook `DISCORD_WEBHOOK_URL`. Les SMS TextBee seront adressés uniquement aux numéros de boutiques présents dans les articles de la commande, dédupliqués et limités côté serveur. Le webhook d’inscription séparé `DISCORD_WEBHOOK_INSCRIPTION` sera utilisé uniquement pour le propriétaire.

## Vérification locale du rendu

Une copie locale du dépôt modifié a été chargée sur `http://localhost:4173/index.html`. L’accueil a affiché le catalogue et le parcours catégorie a fonctionné. La console ne montrait qu’un message de préchargement d’images, sans erreur JavaScript. Le changement de catégorie a été effectué sans appel de commande ni écriture métier.

La validation locale `node tests/validate-system.mjs`, la compilation TypeScript avec esbuild et `git diff --check` sont passées. Le compte à rebours de 90 secondes de l’écran de confirmation a été supprimé : la page confirme immédiatement et reste navigable, tandis que les notifications continuent côté serveur.

La vérification interactive locale a ensuite ouvert la catégorie `Chaussures` contenant 20 articles, puis a ajouté un article au panier. Le compteur est passé à 1 et le bouton a affiché `✓ Ajouté !` immédiatement. Aucun checkout réel n’a été déclenché.

Le parcours local a également ouvert le panier puis le formulaire de commande avec un article, sans erreur visible. Le bouton de confirmation et les champs client/position sont accessibles normalement ; aucune requête d’écriture n’a été envoyée pendant ce contrôle.

## Test du checkout sans effet métier

Une réponse serveur de succès a été simulée dans le navigateur local, sans appeler Supabase. En 150 ms, `vue-merci` était visible, le bouton Retour avait `disabled: false` et le message affiché était `Commande enregistrée. Les notifications sont envoyées en arrière-plan.` La console ne montrait aucune erreur JavaScript.

## Smoke test distant

Après publication, `envoyer-commande` et `envoyer-inscription` ont été testées avec un corps JSON vide. Les deux endpoints ont refusé la requête avec HTTP 400. Le premier test de l’inscription avait produit une erreur 500 pour un mauvais format ; une validation `multipart/form-data` a été ajoutée, la fonction a été republiée en version 19, puis le test a réussi.

## Publication publique

Le commit `0828ca2` a été poussé sur `main`. Le workflow `Qualité Prime Service` a terminé avec succès, et le workflow `pages-build-deployment` a également terminé avec succès pour le même commit. La page publique `https://roimtrmt-stack.github.io/prime-service/` se charge correctement ; la console publique ne produit aucune sortie d’erreur.
