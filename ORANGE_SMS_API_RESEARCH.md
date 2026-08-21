# Recherche — API SMS Orange Mali

## Sources officielles consultées

- https://developer.orange.com/apis/sms-ml
- https://developer.orange.com/apis/sms-ml/api-reference
- https://www.orangemali.com/business/fr/services-a-valeurs-ajoutes/api-sms.html

## Constats vérifiés

Le portail officiel Orange Developer présente un produit `SMS Mali - Business 3.0`, destiné à envoyer des SMS au Mali depuis une application. La page indique qu’il faut acheter des bundles SMS avec une SIM Orange et propose les actions `Use this API`, `Contact us`, `Log in / Register` et `My apps`.

La page de référence expose une spécification OpenAPI téléchargeable et des sections `Getting started`, `API reference`, `Code sample`, `Pricing`, `Terms`, `FAQs` et `Contact us`, mais le contenu de la documentation interactive n’est pas entièrement rendu dans le texte de la page. Il faut télécharger la spécification officielle ou ouvrir les pages de démarrage et d’exemple pour déterminer précisément les routes et les champs.

La page Orange Mali API SMS indique également que l’offre permet de connecter un service au réseau Orange et d’envoyer des SMS depuis une application, mais renvoie vers Orange pour les informations complémentaires. L’offre est donc distincte de TextBee : elle n’utilise pas un téléphone Android comme passerelle locale, mais elle nécessite une SIM Orange et des bundles SMS, avec des conditions commerciales à confirmer.

## Implication pour Prime Service

Une intégration serveur est techniquement plausible, mais il ne faut pas remplacer TextBee dans le code avant d’avoir obtenu les identifiants Orange Developer, les bundles SMS et la route d’authentification/envoi confirmée par la documentation ou le support Orange. La clé ne doit jamais être placée dans le frontend ou le dépôt GitHub.

## Détails techniques confirmés par le guide Orange

Source officielle : https://developer.orange.com/apis/sms/getting-started

L’inscription se fait depuis le portail Orange Developer. Il faut déclarer l’application, associer l’API SMS, indiquer les pays ciblés et acheter un bundle de crédits. Les abonnements à l’API SMS Mali sont soumis à l’approbation de l’équipe locale depuis le 26 février 2023.

L’authentification est OAuth 2.0 v3 à deux jambes. Le backend demande un token avec `POST https://api.orange.com/oauth/v3/token`, `Authorization: Basic base64(client_id:client_secret)`, `Content-Type: application/x-www-form-urlencoded`, et `grant_type=client_credentials`. Le token est valable 3600 secondes et doit être renouvelé automatiquement à expiration.

Les bases officielles sont `https://api.orange.com/smsmessaging/v1` pour les SMS et `https://api.orange.com/sms/admin/v1` pour les contrats, achats et statistiques. L’envoi passe par `POST /smsmessaging/v1/outbound/{senderAddress}/requests`, avec le `senderAddress` encodé dans l’URL et également présent dans le JSON. Le corps de message officiel utilise `outboundSMSMessageRequest.address`, `outboundSMSMessageRequest.senderAddress` et `outboundSMSMessageRequest.outboundSMSTextMessage.message`, limité à 160 caractères dans la spécification OpenAPI Mali 3.0.

Orange exige un contrat valide avec un solde positif ; le débit et l’achat de bundles sont donc payants. Le guide mentionne aussi une limite de 5 SMS par seconde. Depuis juin 2026, certains pays n’acceptent plus le sender name généré automatiquement : il faut demander et faire valider un sender name personnalisé auprès de l’équipe locale avant l’achat du bundle si le Mali est soumis à cette règle au moment de la souscription.

## Conséquence pour l’intégration

Le code ne peut pas être adapté avec une simple clé API TextBee : il faut de nouveaux secrets Orange (`ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_SENDER_ADDRESS`), un cache serveur du token OAuth, un envoi Orange côté Edge Function et une gestion des erreurs/renouvellements. Le sender address doit être fourni par Orange après approbation ; il ne faut pas le deviner.
