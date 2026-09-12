# Peut-on remplacer le téléphone TextBee ?

## Réponse courte

**Non, un émulateur Android avec une fausse SIM ne remplace pas un téléphone réel pour envoyer des SMS à des numéros maliens.** Il peut simuler des SMS de test entre émulateurs ou injecter un SMS dans Android, mais il ne possède ni carte SIM, ni radio mobile, ni accès au réseau de l’opérateur.[3] [4]

**Oui, Orange Mali dispose d’une offre Web SMS accessible depuis Internet**, mais ce n’est pas un service gratuit confirmé : Orange indique qu’il faut souscrire et signer un contrat Web SMS, avec une formule au volume ou prépayée.[1] Orange Mali présente aussi une offre API SMS pour connecter une application, mais la page publique demande de contacter Orange et ne fournit pas le contrat, l’endpoint ni le tarif nécessaires à une intégration immédiate.[2]

Pour Free Mobile France, les pages officielles consultées documentent l’accès à l’Espace Abonné et l’utilisation d’un SMS pour l’authentification, mais pas l’envoi de SMS depuis l’espace web. Free n’est de toute façon pas un opérateur malien pour les destinataires `+223`.[5]

## Comparaison des solutions

| Solution | Téléphone physique requis | Automatisation Prime Service | Gratuité | Verdict |
| --- | --- | --- | --- | --- |
| TextBee + Android + SIM | Oui | Déjà intégrée | Plateforme gratuite selon les limites documentées, mais il faut une SIM, une ligne et le coût des SMS | Solution la plus simple si un téléphone est disponible |
| Orange Mali Web SMS | Non pour l’ordinateur de l’utilisateur | Pas confirmée par la page publique ; interface web | Non confirmée comme gratuite ; contrat et abonnement requis | Possible sans téléphone local, mais solution commerciale à vérifier auprès d’Orange |
| Orange Mali API SMS | Pas nécessairement, selon le contrat | Oui, après adaptation de la fonction Edge | Non ; packages SMS payants indiqués par Orange | Alternative automatisable, mais nécessite accord commercial et développement |
| Free Mobile web | Non démontré | Non documentée | Non applicable pour `+223` | Ne pas retenir pour Prime Service au Mali |
| Émulateur Android + fausse SIM | Non, mais pas de vraie radio opérateur | Non pour des SMS réels | Oui pour des tests locaux seulement | À utiliser uniquement pour tester l’interface, jamais pour la production |
| Fournisseur SMS en ligne avec API | Non | Oui | Généralement payant | Alternative technique, mais incompatible avec l’objectif 100 % gratuit |

## Ce que l’émulateur peut réellement faire

La documentation Android indique que l’émulateur possède des fonctions de téléphonie simulées. Elle documente notamment l’envoi d’un SMS vers une autre instance d’émulateur en utilisant son port de console, ainsi que l’injection d’un SMS entrant dans le framework Android.[3] [4] Ces fonctions servent au développement et aux tests d’applications ; elles ne transmettent pas un SMS vers un vrai numéro mobile par le réseau d’un opérateur.

Une « fausse carte SIM » ne crée pas d’abonnement mobile et ne donne pas au PC une identité radio utilisable par Orange ou un autre opérateur. Même si l’application TextBee s’installe dans l’émulateur, l’envoi réel dépendrait toujours d’un modem GSM/LTE et d’une SIM active. L’émulateur seul ne peut donc pas rendre le SMS boutique opérationnel.

## Conséquence pour Prime Service

La fonction `envoyer-commande` est actuellement préparée pour TextBee : elle appelle `POST https://api.textbee.dev/api/v1/gateway/send-sms`, utilise le header `x-api-key`, envoie les destinataires au format international et peut cibler un `deviceId`. TextBee décrit son propre fonctionnement comme l’utilisation d’un appareil Android enregistré pour envoyer les SMS.[6] Sans téléphone Android réel, l’erreur `TEXTBEE_API_KEY absent` ne peut pas être résolue uniquement par un émulateur.

Le choix dépend donc de la priorité :

1. **Conserver l’objectif 100 % gratuit :** il faut obtenir l’accès temporaire ou permanent à un téléphone Android avec une SIM pouvant envoyer des SMS, même un appareil ancien. La plateforme TextBee peut rester la solution retenue, sous réserve des limites de son offre gratuite et du coût éventuel du forfait mobile.[7]
2. **Éviter totalement le téléphone :** contacter Orange Mali pour son offre Web SMS ou API SMS. Le Web SMS est utilisable depuis un navigateur, mais son contrat et son prix doivent être acceptés ; l’API nécessitera probablement une adaptation de `envoyer-commande` et ne doit pas être présentée comme gratuite avant confirmation écrite d’Orange.[1] [2]
3. **Ne rien payer ni obtenir de téléphone :** conserver Discord pour le propriétaire et prévoir un autre parcours gratuit pour informer les boutiquiers, par exemple un lien d’activation transmis manuellement par le propriétaire. Cette option ne fournit pas l’envoi SMS automatique actuellement prévu et nécessiterait une modification du parcours de liaison push.

La recommandation immédiate est donc de **ne pas investir du temps dans un émulateur pour la production**. Il faut soit trouver un vrai téléphone Android avec SIM pour TextBee, soit demander à Orange Mali les conditions de son Web SMS/API SMS. Aucun secret TextBee ne doit être envoyé dans la conversation.

## Références officielles

[1]: https://www.orangemali.com/business/fr/services-a-valeurs-ajoutes/web-sms.html "Orange Mali — Web SMS"
[2]: https://www.orangemali.com/business/fr/services-a-valeurs-ajoutes/api-sms.html "Orange Mali — API SMS"
[3]: https://developer.android.com/studio/run/emulator-networking-voice "Android Developers — Send a voice call or SMS to another emulator instance"
[4]: https://developer.android.com/studio/run/emulator-console "Android Developers — Send emulator console commands"
[5]: https://assistance.free.fr/articles/871 "Assistance Free — Accéder à mon Espace Abonné Mobile"
[6]: https://textbee.dev/docs/getting-started/registering-a-device "TextBee — Registering a device"
[7]: https://textbee.dev/docs/faq "TextBee — FAQ"
