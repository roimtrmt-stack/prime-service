# Notifications Prime Service — configuration simple

## Résultat attendu

Le site reste statique et léger. Lorsqu’un client valide une commande, le navigateur réalise un seul appel serveur : le serveur recalcule le panier, vérifie et réserve le stock, enregistre la commande, puis répond. La page de confirmation n’attend ni Discord ni SMS.

La notification Discord de commande est envoyée au propriétaire via `DISCORD_WEBHOOK_URL`. Les SMS sont envoyés uniquement aux numéros des boutiques réellement présentes dans la commande. Une inscription de vendeur utilise un webhook Discord séparé, `DISCORD_WEBHOOK_INSCRIPTION`, destiné uniquement au propriétaire. Les photos sont envoyées l’une après l’autre ; le délai de 10 à 30 secondes selon le nombre de photos est donc normal pour ce formulaire et ne bloque pas les commandes.

> **Important :** une URL Discord, une clé TextBee et surtout la clé `service_role` ne doivent jamais être placées dans `index.html`, `inscription.html`, le dépôt GitHub ou un message. Supabase indique que la clé `service_role` contourne les politiques RLS et doit rester dans les fonctions serveur [1].

## 1. Préparer Discord

Dans Discord, ouvrez le serveur utilisé pour Prime Service, puis le salon qui doit recevoir les alertes. Ouvrez **Modifier le salon → Intégrations → Webhooks → Nouveau webhook**, donnez-lui un nom comme `Prime Service commandes`, puis cliquez sur **Copier l’URL du webhook**. Recommencez dans un salon privé ou dans le même salon avec un webhook nommé `Prime Service inscriptions`.

La première URL va dans `DISCORD_WEBHOOK_URL` et la seconde dans `DISCORD_WEBHOOK_INSCRIPTION`. Un webhook entrant est adapté ici parce qu’il permet de publier un message dans un salon par HTTP sans bot permanent [2]. Ne partagez jamais ces URLs : toute personne qui les possède peut publier dans le salon.

## 2. Préparer TextBee pour les SMS réels

TextBee envoie les SMS en utilisant un téléphone Android enregistré comme passerelle. Ouvrez [textbee.dev](https://textbee.dev/), cliquez sur **Start sending free**, créez le compte sans carte bancaire, puis installez l’application Android TextBee. Dans le tableau de bord, choisissez **Register device**, associez le téléphone Android qui contient la SIM malienne utilisée pour les SMS et notez le **Device ID**.

Dans TextBee, ouvrez ensuite la section de clé API, créez une clé et copiez-la immédiatement dans un gestionnaire de mots de passe. Le plan gratuit annoncé comprend un appareil, 50 messages par jour et 300 messages par mois ; le forfait mobile et la SIM restent nécessaires pour l’envoi réel [3]. Les numéros des boutiques doivent être enregistrés sous forme malienne à huit chiffres ou au format international `+223XXXXXXXX`.

## 3. Préparer WhatsApp Cloud API sans téléphone

WhatsApp Cloud API peut fonctionner depuis le serveur Meta, sans dépendre d’un téléphone ou d’un ordinateur allumé. Il faut cependant un portfolio Meta Business, un compte WhatsApp Business, un numéro professionnel, un jeton d’accès, les permissions API, le consentement des boutiquiers et un template approuvé pour une notification initiée par le serveur. Meta permet l’envoi de texte et de médias ; pour les images, le code utilise un média téléversé lorsque le template possède un en-tête image.

Cette option reste **désactivée par défaut** pour respecter la contrainte 100 % gratuite et ne pas envoyer un message non conforme. Le code ne l’active que lorsque `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` et `WHATSAPP_TEMPLATE_NAME` sont renseignés dans les secrets. Les tarifs et règles Meta peuvent évoluer ; il faut vérifier la page [Meta WhatsApp Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) avant d’activer l’envoi réel. Tant que cette vérification n’est pas faite, TextBee reste le canal SMS de secours et Discord reste le canal propriétaire.

## 4. Ajouter les secrets dans Supabase

Ouvrez le [projet Supabase Prime Service](https://supabase.com/dashboard/project/kfxalpvbtbvkncztjwzc), puis allez dans **Edge Functions → Secrets**. Cliquez sur **Add new secret** et ajoutez les entrées suivantes. La clé `SUPABASE_SERVICE_ROLE_KEY` est normalement fournie automatiquement par Supabase ; si elle n’apparaît pas, utilisez la clé secrète du projet uniquement dans les secrets Edge Functions, jamais dans le frontend.

| Nom du secret | Valeur à coller | Utilisé par |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | URL du webhook Discord pour les commandes | Propriétaire |
| `DISCORD_WEBHOOK_INSCRIPTION` | URL du webhook Discord pour les inscriptions | Propriétaire uniquement |
| `TEXTBEE_API_KEY` | Clé API TextBee | SMS des boutiques concernées |
| `TEXTBEE_DEVICE_ID` | Device ID du téléphone Android TextBee | SMS des boutiques concernées |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète Supabase, si absente des secrets par défaut | Enregistrement serveur et stock |
| `WHATSAPP_TOKEN` | Jeton Meta Business | WhatsApp facultatif |
| `WHATSAPP_PHONE_ID` | Identifiant du numéro WhatsApp Business | WhatsApp facultatif |
| `WHATSAPP_GRAPH_VERSION` | Version Graph, par exemple `v26.0` | WhatsApp facultatif |
| `WHATSAPP_TEMPLATE_NAME` | Nom exact d’un template approuvé | WhatsApp facultatif |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Code de langue du template, par exemple `fr` | WhatsApp facultatif |
| `WHATSAPP_TEMPLATE_HEADER_IMAGE` | `true` seulement si le template possède un en-tête image | WhatsApp facultatif |
| `WHATSAPP_ALLOW_FREEFORM_MEDIA` | `true` uniquement après confirmation d’une fenêtre de service ouverte | Médias WhatsApp facultatifs |

Cliquez sur **Save**. Supabase documente l’ajout des secrets depuis la page de gestion des secrets des Edge Functions et précise qu’il n’est pas nécessaire de redéployer la fonction après une simple modification des secrets [1].

## 5. Publier les fonctions serveur

Le dépôt contient les fonctions versionnées dans `supabase/functions/`. La méthode recommandée est d’utiliser le workflow manuel GitHub prévu pour cela après avoir ajouté les secrets de déploiement.

Dans GitHub, ouvrez le dépôt `roimtrmt-stack/prime-service`, puis **Settings → Secrets and variables → Actions → New repository secret**. Ajoutez `SUPABASE_ACCESS_TOKEN` avec un jeton personnel Supabase autorisé à déployer les fonctions, et `SUPABASE_PROJECT_REF` avec la valeur `kfxalpvbtbvkncztjwzc`. Ne mettez jamais ces valeurs dans un fichier commité.

Ensuite, ouvrez **Actions → Déploiement des fonctions Supabase → Run workflow → Run workflow**. Le workflow publie `envoyer-commande` et `envoyer-inscription`. Il ne publie aucun secret dans les logs.

La migration `supabase/migrations/202608210001_secure_order_writes.sql` doit être appliquée une seule fois. Elle supprime les insertions anonymes directes dans `commandes` et `notifications_boutiquiers`, car ces deux écritures sont maintenant faites par `envoyer-commande` côté serveur. Avant de l’appliquer, vérifiez que la nouvelle fonction est bien déployée.

## 6. Mettre le site à jour

Le site GitHub Pages est déjà configuré sur la branche `main`. Après validation locale, poussez les fichiers sur `main` ou acceptez la mise à jour proposée. GitHub Pages reconstruira automatiquement le site. Le workflow `Qualité Prime Service` s’exécute sur chaque modification, sur les demandes de fusion, manuellement et une fois par semaine.

GitHub documente une allocation GitHub Free de 2 000 minutes mensuelles et la gratuité des runners standard pour les dépôts publics [4]. Le workflow de ce dépôt reste volontairement léger : il ne lance aucun navigateur lourd, n’envoie aucune vraie notification et ne modifie aucune donnée métier.

## 7. Tests à effectuer

Le test local est lancé depuis la racine du dépôt avec `node tests/validate-system.mjs`. Il vérifie la syntaxe des deux pages, l’absence d’insertion publique de commande dans le navigateur, la présence de TextBee côté serveur, la séparation du webhook d’inscription et la migration RLS.

Pour le test réel, créez d’abord une commande avec un seul article de test et un numéro de boutique de test. Vérifiez que la confirmation apparaît sans attendre la réception du SMS. Vérifiez ensuite que le propriétaire reçoit le message Discord et que seul le boutiquier lié à l’article reçoit le SMS. Avec une commande composée d’articles de deux boutiques, chaque boutique doit recevoir uniquement son propre montant et ses propres articles.

Pour l’inscription, envoyez deux articles avec deux photos. Le formulaire peut rester en attente pendant l’envoi séquentiel, puis le propriétaire doit recevoir les informations et les photos dans le webhook d’inscription. Aucun SMS TextBee ne doit être généré par cette action.

Le workflow distant envoie uniquement des corps JSON invalides (`{}`) aux deux endpoints. Une réponse `400`, `401`, `403` ou `429` est considérée comme un refus correct ; aucune commande, aucun stock et aucune notification réelle ne sont créés par ce contrôle.

Après une activation WhatsApp, vérifier dans les logs trois statuts distincts : `owner-discord`, `sms` et `whatsapp`. Un échec WhatsApp doit rester un échec de notification, jamais un échec d’enregistrement de commande.

## 8. Architecture retenue

GitHub Actions ne sert pas de serveur temps réel : un workflow ne peut pas garantir une confirmation inférieure à une seconde après chaque validation publique. Il sert à vérifier le code et à publier les fonctions. Supabase reçoit la commande et utilise une tâche d’arrière-plan Edge Function pour poursuivre Discord et TextBee après la réponse HTTP. Supabase documente précisément ce mécanisme avec `EdgeRuntime.waitUntil` [5].

Cette séparation préserve la fluidité du parcours client et garde les clés privées hors du navigateur. Le plan gratuit Supabase documente 500 000 invocations Edge Functions incluses et 500 Mo de base de données ; ces quotas doivent néanmoins être surveillés [6].

## 9. Paiement et carte côté client

La page de remerciement affiche le numéro de paiement `94 13 44 08`, le montant de la commande et le code direct officiel Orange Mali sous la forme `#144*1*94 13 44 08 sans espaces*montant*1*CODE_SECRET#`. Le client remplace `CODE_SECRET` uniquement sur son téléphone, vérifie le numéro, le montant et les frais, puis appuie sur OK/Envoyer. Il peut aussi composer `#144#`, choisir « Transfert d’argent » et suivre le menu. Un aperçu de la position est affiché si les coordonnées GPS sont disponibles ; le bouton Google Maps nécessite Internet. Le site ne promet pas une navigation satellite hors connexion à partir d’un simple lien.

## Références officielles

[1]: https://supabase.com/docs/guides/functions/secrets "Supabase — Environment Variables"
[2]: https://docs.discord.com/developers/platform/webhooks "Discord — Webhooks"
[3]: https://textbee.dev/pricing "TextBee — Pricing"
[4]: https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions "GitHub — Actions billing"
[5]: https://supabase.com/docs/guides/functions/background-tasks "Supabase — Background Tasks"
[6]: https://supabase.com/pricing "Supabase — Pricing"
[7]: https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform "Meta — About the WhatsApp Business Platform"
[8]: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages "Meta — Service messages and customer service window"
[9]: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages "Meta — Image messages"
[10]: https://www.orangemali.com/fr/transfert/transfert-national.html "Orange Mali — Transfert national"
