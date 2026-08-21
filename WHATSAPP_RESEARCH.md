
## Vérification officielle Meta

La documentation officielle Meta indique que WhatsApp Business Platform Cloud API permet d’envoyer programmatiquement des messages texte, des médias riches et des messages interactifs depuis un serveur. Elle indique également qu’un portfolio Business, un compte WhatsApp Business et un numéro professionnel sont nécessaires, avec des jetons d’accès et des permissions API. Les webhooks servent aux statuts et erreurs asynchrones.

La documentation officielle sur les service messages indique qu’un message libre est possible pendant la fenêtre de service client de 24 heures après un message ou un appel du destinataire. Hors de cette fenêtre, un template approuvé est requis. L’utilisateur doit aussi avoir donné son consentement à recevoir les messages. L’envoi autonome sans téléphone ni ordinateur est donc techniquement possible avec Cloud API, mais il faut configurer le compte Meta/WABA, le numéro d’envoi, les permissions, les templates et les identifiants secrets.

La page officielle Meta sur les messages image utilise `POST /<PHONE_NUMBER_ID>/messages` avec `type: image` et un objet `image`. L’image peut référencer un `id` de média téléversé ou une URL publique ; Meta recommande l’identifiant de média téléversé pour de meilleures performances. La documentation donne une limite de 5 Mo pour JPEG et PNG, ce qui est plus strict que la limite Storage du site.

La page Meta consacrée aux messages template a été déplacée vers la documentation « Template fundamentals ». La fonction doit donc rester inactive tant qu’aucun nom de template approuvé et aucun consentement de destinataire ne sont configurés, au lieu d’envoyer un texte libre de manière non conforme.

Sources : https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform ; https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages ; https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages ; https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media ; https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
