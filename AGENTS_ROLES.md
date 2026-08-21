# Rôles des agents Prime Service

## Vue d’ensemble

Le système distingue l’enregistrement métier, les notifications, les relances et le contrôle qualité. L’enregistrement de commande répond rapidement au client ; les notifications et relances sont exécutées en arrière-plan et journalisées séparément.

| Agent | Déclencheur | Destinataire | Responsabilité | Données visibles |
|---|---|---|---|---|
| Agent 1 — `envoyer-commande` | Validation d’un panier par le client | Propriétaire, puis chaque boutique concernée | Recalculer les prix côté serveur, vérifier le stock, décrémenter atomiquement, créer la commande et lancer les notifications | Propriétaire : tout le détail financier. Boutique : ses articles et son montant net uniquement |
| Agent 1A — `notifier-boutiquier` | Chaque minute par cron Supabase | Boutiquier concerné, puis propriétaire en escalade | Envoyer quatre push progressifs à 0, 3, 6 et 9 minutes ; arrêter si accusé ; alerter le propriétaire après échec final | Boutique : ses articles et montant net ; propriétaire : numéro à appeler |
| Agent 1B — `accuser-notification` / `lier-notification-push` | Clic du boutiquier ou lien d’activation SMS | Base de suivi uniquement | Enregistrer l’accusé et associer un abonnement push au numéro vérifié par jeton | Aucun détail financier supplémentaire |
| Agent 2 — `envoyer-inscription` | Envoi du formulaire vendeur | Propriétaire uniquement | Valider le formulaire multipart, transmettre les informations et les photos au webhook d’inscription | Propriétaire : vendeur, boutique, position, articles et photos |
| Agent 3 — GitHub Actions `Qualité Prime Service` | Push, pull request et contrôle planifié | Dépôt GitHub et mainteneur | Vérifier la syntaxe frontend, les appels publics attendus, l’absence d’écritures sensibles côté navigateur et les smoke tests HTTP invalides | Aucun client, vendeur ou montant réel |

## Agent 1 — commande

L’agent reçoit une requête publique minimale. Il ne fait pas confiance aux prix envoyés par le navigateur : il recharge les produits depuis Supabase, vérifie la disponibilité, recalcule le total et détermine la commission à partir des données serveur. Il appelle `decrement_stock_batch`, insère la commande et restaure le stock si l’insertion échoue.

Après l’enregistrement, l’agent répond au navigateur sans attendre Discord, SMS, push ou WhatsApp. `EdgeRuntime.waitUntil` poursuit la notification. Le propriétaire reçoit un Discord global avec les photos en pièces jointes et les montants internes. Chaque boutique reçoit un SMS indépendant sans commission, et un push si son navigateur est associé à son numéro par le lien opaque reçu dans le SMS. Le worker réessaie le push à +3, +6 et +9 minutes avec une intensité croissante et un bouton rouge `J’AI VU LA COMMANDE` à partir de la deuxième tentative. Après quatre échecs sans accusé, le propriétaire reçoit Discord avec le numéro à appeler manuellement. WhatsApp reste un canal visuel facultatif, activé uniquement avec les secrets Meta, un template approuvé et le consentement requis.

## Agent 1A — relances

`notifier-boutiquier` lit uniquement les lignes `notifications_boutiquiers` prêtes à être traitées. Il réserve chaque ligne avant envoi pour éviter les doublons lors d’un chevauchement de cron. L’accusé met fin aux tentatives grâce à une mise à jour conditionnelle sur `acknowledged_at IS NULL`. L’alerte finale Discord ne contient pas la commission.

## Agent 1B — accusé et liaison

`accuser-notification` accepte un `ack_token` opaque et arrête la file de relances. `lier-notification-push` reçoit un `boutique_token` provenant du SMS, recherche le numéro correspondant côté serveur et écrit l’abonnement push. Le navigateur public ne peut pas choisir arbitrairement le numéro de boutique. La policy RLS autorise les abonnements généraux anonymes uniquement avec `telephone_boutique IS NULL`.

## Agent 2 — inscription

L’agent accepte uniquement le formulaire multipart prévu, limite la taille et le nombre des photos, puis envoie le texte et les photos au webhook Discord propriétaire. Il ne récupère pas les numéros des boutiques et ne déclenche ni SMS ni WhatsApp. Cette séparation garantit qu’une inscription ne devient pas une notification de commande.

## Agent 3 — qualité et déploiement

Le workflow GitHub Actions exécute les contrôles reproductibles et déploie manuellement les Edge Functions lorsque l’opérateur le demande. Il vérifie notamment que le frontend appelle les fonctions plutôt que d’écrire directement dans les tables sensibles, que la fonction de commande conserve la réservation atomique du stock, que les notifications restent en arrière-plan et que la fonction d’inscription reste propriétaire uniquement.

## Acteurs métier

Le **propriétaire** administre les articles, reçoit les inscriptions et voit le prix affiché, le montant net boutique et la commission. Le **boutiquier** prépare uniquement les articles qui lui appartiennent et ne voit jamais la commission ni le prix affiché au client. Le **livreur**, s’il existe dans le parcours, reçoit seulement les informations nécessaires à la collecte et à la livraison ; il ne reçoit pas la commission. Le **client** voit le prix final, reçoit la confirmation rapide et suit les instructions de paiement et la carte.

## Règle de confidentialité

Toute modification de message doit être vérifiée par une recherche négative : le SMS et le template WhatsApp boutique ne doivent pas contenir `commission`, `marge`, `prix affiché`, `prix client` ou un montant total provenant d’une autre boutique. Le Discord propriétaire peut contenir ces champs, car il est le canal privé du propriétaire.
