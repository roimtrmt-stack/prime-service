# Plan d’intégration de l’API SMS Orange Mali dans Prime Service

## Réponse fonctionnelle

Oui, le même canal Orange peut servir à deux usages distincts : le SMS automatique envoyé au boutiquier concerné lors d’une commande et un SMS général envoyé depuis l’espace vendeur. Toutefois, la fonction actuelle « Envoyer une notification » n’envoie pas de SMS : elle appelle `clever-processor`, qui diffuse une notification web via OneSignal. Elle peut donc continuer à fonctionner sans Orange ; Orange ajouterait un second canal SMS, avec son propre résultat et son propre coût.

Le bouton général devra clairement choisir sa cible. Pour un message général aux boutiquiers, le serveur peut récupérer les numéros uniques des boutiques depuis la base et envoyer un SMS à chaque numéro. Pour les clients, il faudrait une liste de destinataires et un consentement marketing distincts ; il ne faut pas envoyer automatiquement un SMS à tous les anciens clients sans cette règle.

## Prérequis Orange

L’API `SMS Mali - Business 3.0` est disponible sur Orange Developer, mais l’abonnement doit être approuvé par l’équipe locale. Il faut déclarer l’application, associer l’API SMS, acheter un bundle de crédits et obtenir un sender address ou un sender name validé par Orange.[1] [2]

Valeurs nécessaires côté serveur, sans les mettre dans GitHub ou le frontend :

| Secret | Rôle |
| --- | --- |
| `ORANGE_CLIENT_ID` | Identifiant de l’application Orange Developer |
| `ORANGE_CLIENT_SECRET` | Secret de l’application Orange Developer |
| `ORANGE_SENDER_ADDRESS` | Adresse d’envoi fournie ou validée par Orange, par exemple au format `tel:+223...` si Orange fournit un numéro |
| `ORANGE_SMS_ENABLED` | Interrupteur serveur `true` après validation du test |

Le guide Orange indique que le token OAuth 2.0 v3 est demandé sur `https://api.orange.com/oauth/v3/token` avec `grant_type=client_credentials`, puis utilisé comme `Authorization: Bearer <access_token>`. Le token expire après 3600 secondes ; le backend doit donc le mettre en cache brièvement et le renouveler automatiquement.[2]

## Adaptation backend proposée

Créer une fonction partagée côté Edge Function, ou une fonction dédiée `envoyer-sms-orange`, qui :

1. récupère les secrets avec `Deno.env.get` ;
2. obtient ou renouvelle le token OAuth sans jamais le renvoyer au navigateur ;
3. normalise les numéros maliens en `tel:+223XXXXXXXX` ;
4. appelle `POST https://api.orange.com/smsmessaging/v1/outbound/{senderAddress}/requests` ;
5. limite le texte à 160 caractères pour le premier modèle ;
6. journalise uniquement le statut HTTP, la boutique ciblée et l’identifiant de commande, jamais la clé ni le token ;
7. renvoie un résultat indépendant pour chaque destinataire afin qu’un échec SMS ne fasse pas échouer la commande ou le push.

La structure officielle de l’envoi est de la forme suivante, avec le `senderAddress` encodé dans l’URL et présent dans le corps :

```json
{
  "outboundSMSMessageRequest": {
    "address": "tel:+223XXXXXXXX",
    "senderAddress": "tel:+223YYYYYYYY",
    "outboundSMSTextMessage": {
      "message": "Votre message Prime Service"
    }
  }
}
```

Le code ne doit pas inventer `ORANGE_SENDER_ADDRESS` : cette valeur dépend de l’application et de l’accord Orange. L’API documente également les accusés de réception, mais il faut d’abord obtenir une URL backend publique et décider si cette fonctionnalité est nécessaire.[1]

## Intégration dans les deux parcours

### Commande automatique

Dans `envoyer-commande`, remplacer uniquement le fournisseur de la fonction `sendTextBee` par une fonction `sendOrangeSms`, ou introduire un sélecteur serveur `SMS_PROVIDER=orange`. La commande, le stock, les photos Discord et la file de relances doivent rester indépendants du SMS. Le premier SMS Orange doit contenir le lien opaque `boutique_token=...` afin de permettre l’activation sécurisée du push ; il ne doit contenir ni commission ni prix client.

### Message général de l’espace vendeur

Le bouton actuel « Envoyer une notification » reste un envoi push OneSignal. Pour y ajouter Orange, le backend doit recevoir le message général, vérifier la session administrateur, sélectionner les numéros uniques des boutiques côté serveur, puis effectuer deux traitements séparés : push aux abonnés web et SMS Orange aux boutiques. Le navigateur ne doit pas fournir librement une liste de numéros arbitraires.

Le résultat affiché dans l’espace vendeur devrait distinguer `push envoyés`, `SMS acceptés par Orange`, `SMS refusés` et `aucun numéro boutique disponible`. Une réponse Orange HTTP 201 signifie que la demande d’envoi a été créée ; elle ne suffit pas à prouver que le téléphone final a reçu le SMS. Le backend devra conserver l’identifiant de requête ou l’accusé de réception si Orange le fournit.

## Tests avant mise en production

| Étape | Validation attendue |
| --- | --- |
| Portail Orange | Application déclarée, API SMS Mali associée, approbation locale obtenue |
| Bundle | Crédit SMS actif et non expiré |
| Token | Réponse OAuth 200 avec `access_token` et expiration |
| SMS direct | Réponse Orange 201 puis réception sur un numéro de contrôle `+223...` |
| Commande Prime Service | SMS boutique avec lien opaque, sans commission, Discord toujours reçu |
| Message général | Push existant conservé et SMS séparé envoyé aux boutiques ciblées |
| Erreur | Une panne Orange laisse la commande enregistrée et affiche un statut explicite |
| Limitation | Respect de la limite documentée de 5 SMS par seconde et du solde du bundle |

## Pourquoi l’intégration ne doit pas être codée avec des valeurs inventées

La documentation publique confirme les routes OAuth et d’envoi, mais l’accès au produit SMS Mali dépend de l’application Orange Developer, de l’approbation locale, du bundle et du sender validé. Sans `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET` et `ORANGE_SENDER_ADDRESS` réels, tout code livré ne pourrait être qu’un squelette non testable.[2]

## Références officielles

[1]: https://developer.orange.com/apis/sms-ml/api-reference "Orange Developer — SMS Mali 3.0 API reference"
[2]: https://developer.orange.com/apis/sms/getting-started "Orange Developer — SMS Africa and Middle East getting started"
