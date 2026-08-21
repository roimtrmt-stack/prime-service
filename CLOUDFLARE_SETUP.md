# Cloudflare Workers AI — option réservée

Prime Service utilise actuellement le **moteur local gratuit** pour attribuer automatiquement un nom aux articles. Cloudflare Workers AI est conservé dans le dépôt et dans Supabase comme option future, mais il n’est plus appelé par la page d’inscription.

Le moteur actif n’utilise aucune clé, aucun quota externe et aucun paiement. Il analyse localement la photo dans le navigateur pour relever la couleur dominante, la luminosité et le cadrage, puis produit un nom court et stylé. Si le vendeur saisit un nom, ce nom reste prioritaire.

L’activation de Cloudflare n’est donc pas nécessaire. Vous pouvez arrêter la procédure `agree` et laisser les secrets Cloudflare en place ou les supprimer de Supabase si vous ne souhaitez aucune transmission externe de photo. Le site fonctionnera dans les deux cas avec le moteur local.

## Option future Cloudflare

Si vous souhaitez réactiver plus tard une vraie analyse visuelle externe, la fonction `analyser-article-cloudflare` existe déjà. Elle utilise par défaut `@cf/meta/llama-3.2-11b-vision-instruct` et nécessite `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_API_TOKEN`. Cette fonction demande toutefois l’acceptation préalable de la licence Meta et de la politique d’utilisation. Elle n’est pas utilisée dans le parcours actuel.
