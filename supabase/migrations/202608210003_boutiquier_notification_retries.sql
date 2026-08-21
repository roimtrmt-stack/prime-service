-- Relances boutique : quatre tentatives espacées de trois minutes.
-- Le cron tourne chaque minute pour respecter au mieux l'échéance de chaque ligne.

alter table public.notifications_boutiquiers
  add column if not exists ack_token text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists last_error text;

create unique index if not exists notifications_boutiquiers_ack_token_idx
  on public.notifications_boutiquiers (ack_token)
  where ack_token is not null;

-- Le worker reste protégé par le contrôle JWT de Supabase.
-- La clé anon est une clé publishable prévue pour être utilisée côté client;
-- elle n'accorde pas les droits service_role utilisés dans la fonction.
do $$
begin
  perform cron.unschedule('verifier-notifications-boutiquiers');
exception
  when others then null;
end $$;

select cron.schedule(
  'verifier-notifications-boutiquiers',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://kfxalpvbtbvkncztjwzc.supabase.co/functions/v1/notifier-boutiquier',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmeGFscHZidGJ2a25jenRqd3pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNTE2MDgsImV4cCI6MjA5OTcyNzYwOH0.bO1aExLXi1XTCNPMe98h0BFZrOHSM_bII_4WFX5ZPpg',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmeGFscHZidGJ2a25jenRqd3pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNTE2MDgsImV4cCI6MjA5OTcyNzYwOH0.bO1aExLXi1XTCNPMe98h0BFZrOHSM_bII_4WFX5ZPpg'
      ),
      body := '{}'::jsonb
    );
  $$
);
