# Rapport de test — notifications automatiques de commande

## Scénario

Un article `TEST_AUTO_NOTIFICATION` a été créé avec le faux numéro boutique `00000000`, puis une commande publique de contrôle a été envoyée avec le total déclaré de 1 300 FCFA. Le numéro fictif et l’absence d’abonnement push ont été choisis pour ne notifier aucune personne réelle et pour simuler un boutiquier qui ne clique jamais.

## Résultats observés

| Étape | Résultat |
|---|---|
| Checkout public | HTTP 201 |
| Création de la notification | Automatique, sans clic humain |
| Première tentative | `tentative=1`, statut `en_attente`, prochaine tentative environ +3 min |
| Deuxième tentative | `tentative=2`, statut `en_attente`, erreur attendue `aucun abonnement push actif` |
| Troisième tentative | `tentative=3`, statut `en_attente` |
| Quatrième tentative | `tentative=4` |
| Escalade | `statut=echec_definitif`, `prochaine_tentative=null`, `acknowledged_at=null`, `escalated_at` rempli |
| Nettoyage | 1 produit, 1 commande et 1 notification supprimés |
| Contrôle final | 0 produit TEST, 0 commande TEST, 0 notification TEST |

## Conclusion

Le déclenchement automatique, le cron serveur, les intervalles progressifs et l’arrêt définitif après quatre tentatives fonctionnent sans dépendre de l’ordinateur du propriétaire. L’escalade Discord est déclenchée par le worker après la quatrième tentative. Ce test n’évalue pas l’affichage visuel sur un téléphone réel, car le numéro utilisé était fictif et aucun abonnement push ne lui était associé ; le test précédent avec les clés VAPID avait déjà vérifié le traitement push et l’escalade sur abonnement invalide.
