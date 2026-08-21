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

## 3. Remettre TextBee en service

TextBee utilise un téléphone Android comme passerelle SMS. Le compte, l’application Android, la SIM et la connexion Internet du téléphone doivent rester actifs. La procédure officielle demande un compte TextBee, un appareil Android enregistré, le **Device ID** et une clé API ; l’API actuelle utilise `POST https://api.textbee.dev/api/v1/gateway/send-sms`, l’en-tête `x-api-key`, un tableau `recipients` au format international et `message` [3].

Sur l’ordinateur, ouvrez le tableau de bord TextBee et vérifiez que le téléphone apparaît **Connected/Online**. Si le téléphone est déconnecté, ouvrez l’application Android TextBee, vérifiez Internet, les permissions SMS et téléphone, désactivez l’économie de batterie pour TextBee, puis redémarrez ou réenregistrez l’appareil. Vérifiez ensuite le **Device ID** exact dans le tableau de bord et recréez une clé API si elle a été révoquée.

Dans Supabase, ouvrez **Edge Functions → Secrets** et confirmez que `TEXTBEE_API_KEY` contient la clé active et que `TEXTBEE_DEVICE_ID` contient exactement le Device ID, sans espaces. La fonction Prime Service envoie le numéro boutique sous la forme `+223XXXXXXXX`, conformément au format E.164 attendu par TextBee. N’envoyez jamais la clé dans le chat, le frontend ou un dépôt GitHub.

Pour tester sans déclencher une commande, utilisez le test SMS du tableau de bord TextBee vers votre propre numéro. Pour un test API contrôlé, envoyez un seul message court vers un numéro autorisé :

```bash
curl -X POST https://api.textbee.dev/api/v1/gateway/send-sms \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: VOTRE_CLE_TEXTBEE' \\
  -d '{"recipients":["+223XXXXXXXX"],"message":"Test Prime Service"}'
```

Interprétez les réponses ainsi : `401` indique une clé invalide, `404` un appareil introuvable ou un Device ID incorrect, `429` une limite atteinte, et `200` une requête acceptée. Le forfait gratuit annoncé par TextBee comprend un appareil, 50 messages par jour et 300 messages par mois ; les SMS utilisent toutefois la SIM et le forfait mobile du téléphone Android [3] [4].

## 4. Ajouter les secrets dans Supabase

Ouvrez le [projet Supabase Prime Service](https://supabase.com/dashboard/project/kfxalpvbtbvkncztjwzc), puis allez dans **Edge Functions → Secrets**. Cliquez sur **Add new secret** et ajoutez les entrées suivantes. La clé `SUPABASE_SERVICE_ROLE_KEY` est normalement fournie automatiquement par Supabase ; si elle n’apparaît pas, utilisez la clé secrète du projet uniquement dans les secrets Edge Functions, jamais dans le frontend.

| Nom du secret | Valeur à coller | Utilisé par |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | URL du webhook Discord pour les commandes | Propriétaire |
| `DISCORD_WEBHOOK_INSCRIPTION` | URL du webhook Discord pour les inscriptions | Propriétaire uniquement |
| `TEXTBEE_API_KEY` | Clé API TextBee | SMS des boutiques concernées |
| `TEXTBEE_DEVICE_ID` | Device ID du téléphone Android TextBee | SMS des boutiques concernées |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé secrète Supabase, si absente des secrets par défaut | Enregistrement serveur et stock |
| `VAPID_PUBLIC_KEY` | Clé publique correspondant au frontend | Push boutique |
| `VAPID_PRIVATE_KEY` | Clé privée correspondante | Push boutique côté serveur |
| `DISCORD_WEBHOOK_ADMIN` | Webhook du propriétaire pour l’escalade finale | Alerte après quatre échecs |

Cliquez sur **Save**. Supabase documente l’ajout des secrets depuis la page de gestion des secrets des Edge Functions et précise qu’il n’est pas nécessaire de redéployer la fonction après une simple modification des secrets [1].

## 5. Publier les fonctions serveur

Le dépôt contient les fonctions versionnées dans `supabase/functions/`. La méthode recommandée est d’utiliser le workflow manuel GitHub prévu pour cela après avoir ajouté les secrets de déploiement.

Dans GitHub, ouvrez le dépôt `roimtrmt-stack/prime-service`, puis **Settings → Secrets and variables → Actions → New repository secret**. Ajoutez `SUPABASE_ACCESS_TOKEN` avec un jeton personnel Supabase autorisé à déployer les fonctions, et `SUPABASE_PROJECT_REF` avec la valeur `kfxalpvbtbvkncztjwzc`. Ne mettez jamais ces valeurs dans un fichier commité.

Ensuite, ouvrez **Actions → Déploiement des fonctions Supabase → Run workflow → Run workflow**. Le workflow publie `envoyer-commande`, `envoyer-inscription`, `notifier-boutiquier`, `accuser-notification` et `lier-notification-push`. Il ne publie aucun secret dans les logs.

La migration `supabase/migrations/202608210001_secure_order_writes.sql` doit être appliquée une seule fois. Elle supprime les insertions anonymes directes dans `commandes` et `notifications_boutiquiers`, car ces deux écritures sont maintenant faites par `envoyer-commande` côté serveur. Avant de l’appliquer, vérifiez que la nouvelle fonction est bien déployée.

## 6. Mettre le site à jour

Le site GitHub Pages est déjà configuré sur la branche `main`. Après validation locale, poussez les fichiers sur `main` ou acceptez la mise à jour proposée. GitHub Pages reconstruira automatiquement le site. Le workflow `Qualité Prime Service` s’exécute sur chaque modification, sur les demandes de fusion, manuellement et une fois par semaine.

GitHub documente une allocation GitHub Free de 2 000 minutes mensuelles et la gratuité des runners standard pour les dépôts publics [4]. Le workflow de ce dépôt reste volontairement léger : il ne lance aucun navigateur lourd, n’envoie aucune vraie notification et ne modifie aucune donnée métier.

## 7. Tests à effectuer

Le test local est lancé depuis la racine du dépôt avec `node tests/validate-system.mjs`. Il vérifie la syntaxe des pages, l’absence d’insertion publique de commande et de numéro boutique dans le navigateur, la présence de TextBee côté serveur, la séparation du webhook d’inscription, la liaison push par jeton et la migration RLS.

Pour le test réel, créez d’abord une commande avec un seul article de test et un numéro de boutique de test. Vérifiez que la confirmation apparaît sans attendre la réception du SMS. Vérifiez ensuite que le propriétaire reçoit le message Discord et que seul le boutiquier lié à l’article reçoit le SMS. Avec une commande composée d’articles de deux boutiques, chaque boutique doit recevoir uniquement son propre montant et ses propres articles.

Pour l’inscription, envoyez deux articles avec deux photos. Le formulaire peut rester en attente pendant l’envoi séquentiel, puis le propriétaire doit recevoir les informations et les photos dans le webhook d’inscription. Aucun SMS TextBee ne doit être généré par cette action.

Le workflow distant envoie uniquement des corps JSON invalides (`{}`) aux deux endpoints. Une réponse `400`, `401`, `403` ou `429` est considérée comme un refus correct ; aucune commande, aucun stock et aucune notification réelle ne sont créés par ce contrôle.

Après un test TextBee, vérifier dans les logs le statut `sms` par boutique et la réponse HTTP TextBee. Un échec SMS doit rester un échec de notification, jamais un échec d’enregistrement de commande.

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
[7]: https://textbee.dev/docs/sending-sms/sending-sms "TextBee — Sending SMS"
[8]: https://textbee.dev/docs/faq "TextBee — FAQ et dépannage"
[9]: https://api.textbee.dev/ "TextBee — API reference"
[10]: https://www.orangemali.com/fr/transfert/transfert-national.html "Orange Mali — Transfert national"

## 10. Relances automatiques des boutiquiers

Pour chaque boutique concernée par une commande, `envoyer-commande` crée une ligne indépendante dans `notifications_boutiquiers` avec un jeton d’accusé aléatoire. Le premier push part immédiatement depuis `notifier-boutiquier`. Si le boutiquier ne clique pas sur l’accusé, le cron Supabase réveille le worker chaque minute et le worker réessaie à trois minutes, six minutes et neuf minutes après le premier envoi.

| Tentative | Délai | Intensité | Bouton |
|---:|---:|---|---|
| 1 | immédiate | Nouvelle commande | aucun bouton dans la notification push ; l’ouverture affiche toutefois la page d’accusé |
| 2 | +3 min | rappel 1/3 | bouton rouge `J’AI VU LA COMMANDE` |
| 3 | +6 min | rappel urgent 2/3, vibration et interaction requise | bouton rouge `J’AI VU LA COMMANDE` |
| 4 | +9 min | dernier rappel 3/3 | bouton rouge `J’AI VU LA COMMANDE` |

Le bouton appelle `accuser-notification` avec un jeton à usage pratique limité à la ligne concernée. Lorsque l’accusé est enregistré, le statut devient `accusee`, `acknowledged_at` est rempli et `prochaine_tentative` est annulée. Après la quatrième tentative sans accusé, le statut devient `echec_definitif` et le propriétaire reçoit Discord avec la boutique, la commande et le numéro à appeler manuellement.

Un boutiquier doit d’abord associer son navigateur à son numéro. Le SMS initial contient un lien Prime Service avec un paramètre opaque `boutique_token=<jeton>` ; après avoir appuyé sur **Autoriser**, le navigateur envoie son abonnement à `lier-notification-push`. Le serveur vérifie le jeton dans `notifications_boutiquiers`, récupère le numéro lié et écrit lui-même la ligne `abonnements_push`. Le navigateur public ne peut donc pas choisir arbitrairement le numéro d’une boutique. Le site ne peut pas envoyer un push à une boutique qui n’a jamais autorisé les notifications ou dont le navigateur n’est plus disponible ; dans ce cas, l’escalade Discord finale vous prévient.
