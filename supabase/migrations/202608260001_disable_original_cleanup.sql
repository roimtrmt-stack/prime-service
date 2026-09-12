-- Prime Service : la suppression automatique des originaux est désactivée.
-- On conserve la colonne d’audit existante, mais aucun job ne doit supprimer de fichier.
do $$
begin
  perform cron.unschedule('nettoyer-originaux-images');
exception
  when others then null;
end $$;

commit;
