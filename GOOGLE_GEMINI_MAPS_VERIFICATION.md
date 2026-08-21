# Vérification Google Gemini et Google Maps — 21 août 2026

## Sources officielles

- Tarifs Gemini : https://ai.google.dev/gemini-api/docs/pricing
- Facturation Gemini : https://ai.google.dev/gemini-api/docs/billing
- Limites Gemini : https://ai.google.dev/gemini-api/docs/rate-limits
- Analyse d’images Gemini : https://ai.google.dev/gemini-api/docs/image-understanding
- Tarifs Google Maps : https://developers.google.com/maps/billing-and-pricing/overview
- Liste des prix Google Maps : https://developers.google.com/maps/billing-and-pricing/pricing
- Routes API : https://developers.google.com/maps/documentation/routes/usage-and-billing
- Maps Demo Key : https://mapsplatform.google.com/maps-demo-key/

## Résultats

Gemini est distinct de Google Maps. Gemini est l’IA multimodale qui peut analyser une photo, produire une description et générer un nom. La documentation Google confirme que les modèles Gemini sont multimodaux et peuvent faire du captioning, de la classification et de la compréhension visuelle.

L’API Gemini possède un niveau Free pour certains modèles et certaines limites : les tokens d’entrée et de sortie sont gratuits, mais l’accès aux modèles est limité, les quotas sont variables, et le contenu du niveau gratuit peut être utilisé pour améliorer les produits Google. Les modèles, quotas et conditions peuvent changer. L’accès aux fonctions de grounding avec Google Maps n’est pas équivalent à l’analyse d’image : la tarification de la page officielle distingue les appels de grounding Maps et les appels de modèle.

Le niveau Paid Gemini nécessite une facturation liée au projet et un prépaiement minimum indiqué par Google ; il ne respecte donc pas la contrainte « sans paiement » pour une utilisation de production garantie. Une clé gratuite peut éventuellement fonctionner pour des essais limités, mais elle n’est pas une garantie de disponibilité permanente ni de volume suffisant.

Google Maps Platform applique une tarification à l’usage par SKU. La carte Embed et le Maps Demo Key sont annoncés comme gratuits et sans carte bancaire pour le prototypage, avec des limites quotidiennes ; les clés standard, l’usage de production, le géocodage et les itinéraires sont soumis à des règles de facturation, même si des plafonds mensuels gratuits existent pour certains SKU. La Routes API indique explicitement qu’il faut activer la facturation pour l’utiliser.

## Décision pour Prime Service

Pour le nommage par photo, Gemini est techniquement adapté, mais son niveau gratuit est limité et non garanti pour une application de production. Ne pas l’intégrer automatiquement sans clé et vérification du quota du propriétaire.

Pour la carte visible par le client, conserver l’intégration actuelle ou utiliser une carte Embed / Maps Demo Key seulement pour un prototype contrôlé. Ne pas ajouter de géocodage ou d’itinéraire API nécessitant une facturation, afin de préserver la règle « 100 % gratuit ».
