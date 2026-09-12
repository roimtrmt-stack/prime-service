# Configuration TextBee pour Prime Service

Ce guide configure l’envoi du SMS initial au boutiquier sans ralentir la confirmation de commande. Le site appelle TextBee depuis la fonction Edge `envoyer-commande`, jamais depuis le navigateur. La case obligatoire « J’autorise Prime Service à m’envoyer une notification quand ma boutique reçoit une commande » reste conservée dans `inscription.html` : elle recueille le consentement du boutiquier et ne doit pas être supprimée.

## 1. Préparer le téléphone Android

TextBee transforme un téléphone Android en passerelle SMS en utilisant sa carte SIM et son forfait mobile. La documentation officielle indique qu’un appareil Android 7.0 ou ultérieur est pris en charge et que l’application doit disposer des permissions SMS ; le téléphone doit également avoir une connexion Internet active.[1] Vérifier que la SIM peut réellement envoyer des SMS, que le téléphone est allumé et que l’application TextBee peut fonctionner en arrière-plan.

Installer l’application officielle depuis la page de téléchargement TextBee, puis ouvrir une session avec le même compte que celui utilisé sur le tableau de bord. Accorder les autorisations demandées par Android, en particulier l’envoi de SMS. Garder le téléphone connecté au Wi-Fi ou aux données mobiles pendant les essais et pendant l’utilisation normale du site.

## 2. Créer la clé API et enregistrer l’appareil

Ouvrir [app.textbee.dev/dashboard](https://app.textbee.dev/dashboard). Dans le tableau de bord, choisir **Get started** ou **Generate an API key**. La méthode recommandée par TextBee est l’association par QR code : afficher le QR code dans le tableau de bord, ouvrir l’application Android, toucher **Scan QR code**, puis scanner le code. Une fois l’association terminée, le tableau de bord doit afficher l’appareil comme **Active** et fournir son **Device ID**.[1]

Si le QR code n’est pas disponible, créer la clé dans le tableau de bord, la copier dans un endroit sûr, puis ouvrir l’application Android. Dans l’écran initial de l’application, laisser le champ **Device ID** vide, coller la clé API dans le champ prévu et toucher **Register**. Vérifier ensuite que l’appareil apparaît comme **Active** dans le tableau de bord.[1]

La clé API et le Device ID sont deux valeurs différentes. Ne jamais envoyer la clé API dans une conversation, dans une capture d’écran ou dans le dépôt GitHub. Le Device ID peut être utilisé comme identifiant technique, mais il ne remplace pas la clé secrète.

## 3. Vérifier le compte et l’appareil par l’API

Avant de modifier Supabase, effectuer un contrôle local. Dans un terminal de confiance, saisir la clé dans une variable d’environnement ; ne pas la mettre directement dans l’historique de commandes si le terminal est partagé.

```bash
export TEXTBEE_API_KEY='COLLER_LA_CLE_UNIQUEMENT_DANS_VOTRE_TERMINAL'
curl -sS 'https://api.textbee.dev/api/v1/gateway/devices' \\
  -H "x-api-key: $TEXTBEE_API_KEY"
```

Une réponse HTTP 200 doit retourner une liste `data` contenant au moins un appareil. Relever la valeur `_id` de l’appareil actif : c’est le **Device ID** à utiliser dans Supabase. Vérifier idéalement `enabled: true`, `isDefault: true` si cet appareil est le principal, ainsi qu’un `lastHeartbeat` récent. L’API officielle utilise le header `x-api-key` et l’endpoint de base `https://api.textbee.dev`.[2]

Une réponse **401** indique une clé absente, invalide ou révoquée. Une liste vide signifie généralement que l’appareil Android n’est pas encore enregistré sur ce compte. Si l’appareil est désactivé, il faut le réactiver dans le tableau de bord ou corriger l’association dans l’application.

## 4. Ajouter les deux secrets dans Supabase

Ouvrir le projet Supabase Prime Service, identifié par `kfxalpvbtbvkncztjwzc`, puis aller dans **Edge Functions → Secrets**. Selon la version de l’interface, cette rubrique peut apparaître sous les paramètres du projet dans la section **Edge Functions**. Ajouter ou remplacer exactement les deux secrets suivants :

| Nom exact du secret | Valeur à saisir | Règle |
| --- | --- | --- |
| `TEXTBEE_API_KEY` | La clé API créée dans le tableau de bord TextBee | Valeur secrète ; ne pas ajouter de guillemets ni d’espace avant ou après |
| `TEXTBEE_DEVICE_ID` | Le `_id` de l’appareil Android actif renvoyé par TextBee | Ce n’est pas le numéro de téléphone et ce n’est pas la clé API |

Enregistrer les secrets. Ne pas créer ces valeurs dans le frontend, dans `.env.example`, dans une migration SQL ou dans GitHub Pages. La fonction `envoyer-commande` les lit côté serveur avec `Deno.env.get`. Le code envoie à TextBee le corps suivant :

```json
{
  "recipients": ["+223XXXXXXXX"],
  "message": "...",
  "deviceId": "DEVICE_ID_TEXTBEE"
}
```

Le site normalise un numéro malien de huit chiffres vers le format international `+223XXXXXXXX`. TextBee demande ce format international E.164 pour les destinataires.[2] Le `deviceId` est facultatif dans l’API TextBee, mais il est recommandé de renseigner `TEXTBEE_DEVICE_ID` afin d’éviter qu’un autre appareil par défaut soit choisi.[2]

Aucune modification du code n’est nécessaire après l’ajout des secrets. Si l’interface Supabase affiche un bouton de redéploiement, l’utiliser uniquement si les nouveaux secrets ne sont pas visibles par une nouvelle invocation ; ne jamais coller la clé dans une commande de déploiement.

## 5. Envoyer un SMS de contrôle direct

Après l’enregistrement de l’appareil, envoyer un SMS de contrôle depuis un terminal local vers un numéro autorisé, au format international. Remplacer `DEVICE_ID_TEXTBEE` et `+223XXXXXXXX` uniquement dans le terminal.

```bash
curl -sS -X POST 'https://api.textbee.dev/api/v1/gateway/send-sms' \\
  -H "x-api-key: $TEXTBEE_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "deviceId": "DEVICE_ID_TEXTBEE",
    "recipients": ["+223XXXXXXXX"],
    "message": "Test Prime Service : TextBee est correctement configure."
  }'
```

La documentation TextBee précise qu’une réponse d’acceptation n’est pas encore une preuve de livraison : le SMS doit ensuite être transmis au téléphone Android et au réseau mobile.[2] Confirmer donc à la fois la réponse API, la réception sur le téléphone destinataire et la présence du message dans l’historique TextBee. Le plan gratuit documenté comprend un appareil actif, 50 messages par jour et 300 messages par mois ; ces limites doivent être respectées pour rester sans abonnement.[3]

## 6. Tester le parcours Prime Service

Une fois le contrôle direct réussi, effectuer un test contrôlé dans le site avec un article temporaire dont le nom commence par `TEST_TEXTBEE_`, un numéro de boutique autorisé et une commande de test. Le client doit voir la confirmation immédiatement : l’envoi Discord et TextBee est traité en arrière-plan et ne doit pas bloquer le checkout.

Le résultat attendu est le suivant :

| Contrôle | Résultat attendu |
| --- | --- |
| Discord propriétaire | Commande reçue avec photos visuelles et détails financiers |
| TextBee boutique | SMS reçu avec le lien opaque `boutique_token=...`, sans commission ni prix client |
| Liaison push | Le boutiquier ouvre le lien SMS puis autorise les notifications |
| Relances | Push à environ 0, 3, 6 et 9 minutes si aucun accusé |
| Accusé | Le bouton rouge arrête les prochaines relances |
| Escalade | Discord propriétaire après la quatrième tentative sans accusé |
| Nettoyage | Suppression de l’article, de la commande, des notifications et de tout abonnement fictif |

Le texte de la boutique ne doit jamais contenir la commission de 300 FCFA, le prix client ou le montant d’une autre boutique. Le propriétaire peut voir ces informations dans Discord ; le SMS boutique reste limité aux données nettes de la boutique concernée.

## 7. Lire les erreurs du site

Dans **Supabase → Edge Functions → Logs**, ouvrir les journaux de `envoyer-commande` autour de l’heure du test. Les causes principales sont les suivantes :

| Message ou symptôme | Cause probable | Correction |
| --- | --- | --- |
| `TEXTBEE_API_KEY absent` | Le secret n’existe pas dans le projet ou son nom est incorrect | Ajouter exactement `TEXTBEE_API_KEY` dans les secrets Edge Functions |
| `TextBee HTTP 401` | Clé invalide, révoquée ou copiée avec une erreur | Générer une nouvelle clé, la tester avec `GET /api/v1/gateway/devices`, puis remplacer le secret |
| `TextBee HTTP 400` | Appareil désactivé, e-mail TextBee non vérifié, corps invalide ou aucun appareil actif | Vérifier le compte, l’appareil et le format `+223...` |
| `TextBee HTTP 429` | Limite quotidienne, mensuelle ou par lot atteinte | Attendre le renouvellement de la limite ou réduire les essais ; le plan gratuit reste limité |
| Réponse acceptée mais aucun SMS | Téléphone hors ligne, application arrêtée, permission SMS refusée, réseau mobile indisponible ou SIM incapable d’envoyer | Ouvrir TextBee, rétablir Internet, vérifier les permissions, la SIM et le dernier heartbeat |
| Mauvais téléphone utilisé | `TEXTBEE_DEVICE_ID` absent ou incorrect | Copier le `_id` de l’appareil actif et le renseigner exactement |

Après un échec TextBee, la commande doit tout de même rester enregistrée : cette panne de notification ne doit pas annuler le checkout. Le propriétaire peut alors corriger les secrets et refaire un test contrôlé.

## Résumé de finalisation

La configuration est finalisée lorsque l’API TextBee répond 200 à la lecture des appareils, que l’appareil est **Active**, que les deux secrets sont présents dans le projet Supabase `kfxalpvbtbvkncztjwzc`, qu’un SMS direct arrive et qu’une commande Prime Service produit le SMS boutique avec son lien opaque. La clé API ne doit jamais être communiquée à l’assistant ni commitée dans GitHub.

## Références

[1]: https://textbee.dev/docs/getting-started/registering-a-device "TextBee — Registering a device"
[2]: https://textbee.dev/docs/sending-sms/sending-sms "TextBee — Sending SMS"
[3]: https://textbee.dev/docs/faq "TextBee — FAQ"
