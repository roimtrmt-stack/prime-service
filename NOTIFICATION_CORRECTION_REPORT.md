# Rapport de correction des notifications Prime Service

## Résumé exécutif

Le système conserve le parcours client rapide : le navigateur effectue un seul appel à `envoyer-commande`, la fonction recalcule les prix, réserve le stock et enregistre la commande, puis répond sans attendre Discord, SMS ou WhatsApp. Les notifications continuent avec `EdgeRuntime.waitUntil`.

La commission reste confidentielle. Le propriétaire voit le prix affiché, le montant net à remettre à chaque boutique et la commission par article et au total. Le boutiquier reçoit seulement ses articles, sa photo si le canal visuel est activé, le client, la carte et le montant **NET à recevoir**.

## Versions actives

| Fonction | Version | JWT | Statut |
|---|---:|---|---|
| `envoyer-commande` | 40 | désactivé comme avant pour le checkout public | ACTIVE |
| `envoyer-inscription` | 21 | activé | ACTIVE |

La liste Supabase confirme ces deux versions actives. Les smoke tests publics invalides retournent HTTP 400 pour les deux endpoints. Les tests locaux et le parseur TypeScript passent.

## Message propriétaire Discord

Le propriétaire reçoit un message global par commande, même si les articles proviennent de plusieurs boutiques. Chaque image Storage valide est téléchargée côté serveur, vérifiée par type MIME et taille, puis envoyée comme fichier joint Discord avec une référence `attachment://...`. Le message contient notamment :

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

## Message boutique

Chaque boutique reçoit un SMS indépendant, routé avec `Promise.all`. Le texte est volontairement limité aux données nécessaires et ne contient ni le mot « commission », ni le prix client, ni la marge :

```text
Prime Service — nouvelle commande #{ID_COMMANDE} | Boutique : {NOM_BOUTIQUE} | Articles à préparer : {ARTICLES_DE_CETTE_BOUTIQUE} | Montant NET à recevoir : {MONTANT_NET_BOUTIQUE} FCFA | Client : {NOM_CLIENT} — {TELEPHONE_CLIENT} | Carte client : {LIEN_GOOGLE_MAPS}
```

Un SMS ne peut pas intégrer une vraie photo. WhatsApp Cloud API a donc été préparé comme canal visuel facultatif : un template approuvé peut recevoir un premier média JPEG/PNG, et les médias libres supplémentaires ne sont envoyés que si une fenêtre de service ouverte est explicitement configurée.

## WhatsApp Cloud API autonome

L’intégration est présente dans `envoyer-commande/index.ts` mais reste désactivée tant que `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` et `WHATSAPP_TEMPLATE_NAME` ne sont pas configurés. Elle ne dépend pas d’un téléphone ou d’un ordinateur du propriétaire. Il faut néanmoins un compte Meta Business/WABA, un numéro professionnel, un consentement destinataire et un template approuvé pour les messages initiés par le serveur. La gratuité totale n’est pas garantie par Meta ; l’activation est donc volontairement laissée à l’administrateur après vérification des conditions et tarifs.

## Page de remerciement

La page affiche le code direct officiel Orange Mali sous la forme `#144*1*NUMERO* montant *1*CODE_SECRET#`, avec le numéro Prime Service `94 13 44 08` sans espaces, le montant réel et la consigne de ne jamais divulguer le code secret. Elle propose aussi le menu de secours `#144# → Transfert d’argent`. Un aperçu cartographique léger et un lien Google Maps sont ajoutés si les coordonnées GPS existent ; le lien détaillé nécessite Internet.

## Rôles documentés

`AGENTS_ROLES.md` décrit Agent 1 (`envoyer-commande`), Agent 2 (`envoyer-inscription`), Agent 3 (qualité et déploiement GitHub Actions), ainsi que les droits du propriétaire, du boutiquier, du livreur et du client. `NOTIFICATION_MESSAGES.md` contient les contrats de messages personnalisables.

## Sécurité et limites résiduelles

Les secrets restent dans les secrets Supabase Edge Functions. Les écritures publiques directes de commandes et de notifications restent interdites par RLS. L’intégration WhatsApp ne vérifie pas elle-même l’opt-in métier : l’administrateur doit n’enregistrer que des destinataires consentants et n’activer les paramètres qu’après approbation Meta. Une requête de lecture détaillée des logs Supabase a rencontré une erreur backend après un premier défaut de schéma ; la version active et les réponses HTTP invalides ont toutefois été vérifiées par les contrôles alternatifs disponibles.

L’advisor de sécurité Supabase signale trois points résiduels : `notifications_boutiquiers` a RLS activé sans politique, ce qui est cohérent avec la suppression des écritures anonymes mais doit rester documenté ; `pg_net` est installé dans le schéma public et peut être déplacé lors d’une maintenance dédiée ; la protection des mots de passe compromis Supabase Auth est désactivée et devrait être activée depuis le tableau de bord si le propriétaire souhaite ce durcissement. Aucun de ces trois points n’a été modifié automatiquement pour éviter une régression hors du périmètre des notifications.

## Fichiers principaux

`supabase/functions/envoyer-commande/index.ts` contient le calcul des montants, le routage, les pièces jointes Discord, le SMS et WhatsApp optionnel. `index.html` contient le parcours rapide, le paiement Orange Money et la carte. `supabase/functions/.env.example` liste les paramètres sans valeur secrète. `README_NOTIFICATIONS.md` explique la configuration et le déploiement. `AGENTS_ROLES.md` et `NOTIFICATION_MESSAGES.md` expliquent les rôles et les formulations.
