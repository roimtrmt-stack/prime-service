begin;

alter table public.traitements_images_produits
  add column if not exists source_deleted_at timestamptz;

create index if not exists traitements_images_produits_cleanup_idx
  on public.traitements_images_produits (status, finished_at)
  where source_deleted_at is null and optimized_image_url is not null;

-- Le nettoyage vérifie à nouveau l’URL du produit avant chaque suppression.
-- Il n’est donc pas exécuté par le navigateur et reste récupérable en cas d’échec.
do $$
begin
  perform cron.unschedule('nettoyer-originaux-images');
exception
  when others then null;
end $$;

select cron.schedule(
  'nettoyer-originaux-images',
  '5 * * * *',
  $$
    select net.http_post(
      url := 'https://kfxalpvbtbvkncztjwzc.supabase.co/functions/v1/nettoyer-originaux-images',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6ImtmeWFscHZidGJ2a25jenRqd3pjIiwiaWF0IjoxNzg0MTUxNjA4LCJleHAiOjIwOTk3Mjc2MDh9.bO1aExLXi1XTCNPMe98h0BFZrOHSM_bII_4WFX5ZPpg',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmeWFscHZidGJ2a25jenRqd3pjIiwiaWF0IjoxNzg0MTUxNjA4LCJleHAiOjIwOTk3Mjc2MDh9.bO1aExLXi1XTCNPMe98h0BFZrOHSM_bII_4WFX5ZPpg'
      ),
      body := '{}'::jsonb
    );
  $$
);

commit;
