# Messages de notification Prime Service

## Message envoyé au propriétaire sur Discord

Le propriétaire reçoit **un seul message par commande**, même si le panier contient des articles de plusieurs boutiques. Le contenu actuel est :

```text
🛒 NOUVELLE COMMANDE — Prime Service
🆔 Commande : {ID_COMMANDE}
🕒 Heure : {DATE_ET_HEURE}
👤 Client : {NOM_CLIENT}
📞 Téléphone : {TELEPHONE_CLIENT}
📍 Adresse : {ADRESSE_OU_POSITION_GPS}
🗺️ Carte : {LIEN_GOOGLE_MAPS}

📦 Articles :
• {ARTICLE_1} x{QUANTITE} — {PRIX_TOTAL_ARTICLE} FCFA
• {ARTICLE_2} x{QUANTITE} — {PRIX_TOTAL_ARTICLE} FCFA

🏪 {BOUTIQUE_1} — {MONTANT_BOUTIQUE_1} FCFA
🏪 {BOUTIQUE_2} — {MONTANT_BOUTIQUE_2} FCFA

💰 TOTAL : {TOTAL_COMMANDE} FCFA
```

Le propriétaire voit donc la commande globale et la répartition par boutique. Les images valides du Storage sont ajoutées sous forme d’aperçus Discord ; si une image est indisponible, le texte de la commande reste envoyé.

## Message envoyé au boutiquier

Chaque boutique reçoit son propre SMS, individuellement. Le SMS actuel est :

```text
Prime Service — nouvelle commande #{ID_COMMANDE} | Boutique: {NOM_BOUTIQUE} | Articles: {ARTICLES_DE_CETTE_BOUTIQUE} | Montant boutique: {MONTANT_BOUTIQUE} FCFA | Client: {NOM_CLIENT} — {TELEPHONE_CLIENT} | Carte client: {LIEN_GOOGLE_MAPS}
```

Le boutiquier ne reçoit **ni les articles des autres boutiques ni leur montant**. Les SMS sont préparés avec `Promise.all`, ce qui signifie qu’un échec d’envoi pour une boutique n’empêche pas les autres boutiques de recevoir leur propre message. Le journal serveur conserve le statut `accepted`, `TextBee HTTP ...`, `TEXTBEE_API_KEY absent` ou l’erreur technique correspondante pour chaque numéro.

## Message envoyé pour une inscription

Lorsqu’un vendeur inscrit plusieurs articles, le propriétaire reçoit uniquement le webhook `DISCORD_WEBHOOK_INSCRIPTION`. Le vendeur ou les autres boutiques ne reçoivent pas cette notification. Le message contient le nom du vendeur, la boutique, le téléphone, la position et la liste des articles, puis les photos sont attachées séparément.

## Personnalisation

Les textes sont directement modifiables dans `supabase/functions/envoyer-commande/index.ts`, dans `notifyInBackground`, aux sections du contenu Discord et du tableau `sms`. Après modification, il faut republier la fonction `envoyer-commande` avec le workflow manuel GitHub. Les secrets Discord et TextBee restent toujours dans Supabase et ne doivent pas être placés dans ce fichier.
