# Contrat des messages de notification Prime Service

## Propriétaire — Discord

Le propriétaire reçoit un message par commande, même si le panier contient plusieurs boutiques. Le message contient la commande globale, les coordonnées du client, l’adresse ou la position, le lien Google Maps, les articles, le prix affiché client, le montant net à remettre à chaque boutique et la commission à garder. Pour chaque article valide, la photo est envoyée comme fichier joint Discord et référencée dans l’embed avec `attachment://...`; le propriétaire reçoit donc une vraie image intégrée, et non seulement un lien Storage.

```text
🛒 NOUVELLE COMMANDE — Prime Service
Commande : {ID_COMMANDE}
Client : {NOM_CLIENT} — {TELEPHONE_CLIENT}
Adresse : {ADRESSE}
Carte : {LIEN_GOOGLE_MAPS}

Article : {ARTICLE} x{QUANTITE}
Prix affiché client : {PRIX_AFFICHE} FCFA
À remettre à la boutique : {MONTANT_NET_BOUTIQUE} FCFA
Commission Prime Service : {COMMISSION} FCFA

Boutique : {NOM_BOUTIQUE}
À remettre à la boutique : {TOTAL_NET_BOUTIQUE} FCFA
Commission à garder : {COMMISSION_BOUTIQUE} FCFA

TOTAL CLIENT : {TOTAL_COMMANDE} FCFA
COMMISSION TOTALE À GARDER : {COMMISSION_TOTALE} FCFA
```

## Boutiquier — SMS TextBee

Chaque boutique reçoit son propre SMS, préparé indépendamment avec `Promise.all`. Le texte ne contient que les articles de cette boutique, le client, la carte et son montant net. Il ne doit jamais contenir les mots « commission », « marge », « prix de revient » ou le prix affiché au client.

```text
Prime Service — nouvelle commande #{ID_COMMANDE} | Boutique : {NOM_BOUTIQUE} | Articles à préparer : {ARTICLES_DE_CETTE_BOUTIQUE} | Montant NET à recevoir : {MONTANT_NET_BOUTIQUE} FCFA | Client : {NOM_CLIENT} — {TELEPHONE_CLIENT} | Carte client : {LIEN_GOOGLE_MAPS}
```

Un SMS ne transporte pas une photo intégrée. Il reste un canal de secours texte. Si l’exigence est une photo visuelle côté boutique, le canal WhatsApp Cloud API ou un Discord privé par boutique doit être configuré.

## Boutiquier — WhatsApp Cloud API facultatif

L’envoi WhatsApp est désactivé tant que `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` et `WHATSAPP_TEMPLATE_NAME` ne sont pas présents. Le code utilise alors un template approuvé, avec les variables du message boutique et, si `WHATSAPP_TEMPLATE_HEADER_IMAGE=true`, un premier média JPEG/PNG téléversé via l’API Media. Les photos libres supplémentaires ne sont tentées que si `WHATSAPP_ALLOW_FREEFORM_MEDIA=true`, ce qui doit correspondre à une fenêtre de service ouverte et à un consentement préalable du destinataire.

## Inscription — propriétaire uniquement

La fonction `envoyer-inscription` ne lit pas les numéros de boutique, n’utilise pas TextBee et envoie le formulaire, les articles et les fichiers image uniquement à `DISCORD_WEBHOOK_INSCRIPTION`. Le vendeur et les autres boutiques ne reçoivent aucune notification d’inscription.

## Journalisation et personnalisation

Chaque résultat est journalisé côté serveur : Discord propriétaire, SMS boutique et, si configuré, WhatsApp par boutique. Un échec de canal n’annule pas une commande déjà enregistrée. Les textes se personnalisent dans `supabase/functions/envoyer-commande/index.ts`, dans `notifyInBackground`; les secrets restent dans les secrets Supabase Edge Functions.
