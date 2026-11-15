-- Repli automatique par e-mail des notifications de commande.
-- Quand aucun appareil de la boutique n'a pu recevoir le push, notifier-boutiquier
-- envoie la commande par e-mail une seule fois : cette colonne l'en empêche d'envoyer
-- le même message à chaque passage du cron.
alter table public.notifications_boutiquiers
  add column if not exists email_envoye_le timestamptz;
