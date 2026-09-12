begin;

-- Les commandes et notifications sont maintenant créées par l’Edge Function
-- avec la clé service_role ; le navigateur ne doit plus pouvoir les insérer.
drop policy if exists "Insertion publique des commandes" on public.commandes;
drop policy if exists "Insertion publique des notifications" on public.notifications_boutiquiers;
revoke insert on table public.commandes from anon, authenticated;
revoke insert on table public.notifications_boutiquiers from anon, authenticated;

commit;
