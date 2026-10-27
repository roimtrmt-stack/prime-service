begin;

-- Accès privé « Mode boutiquier » :
-- un code à 6 chiffres envoyé par SMS sur le numéro de la boutique, puis un
-- jeton de session de 7 jours. Seul le titulaire du numéro peut obtenir le
-- code : l'accès n'est pas partageable ni usurpable depuis le navigateur Le
-- navigateur ne peut jamais lire la table : RLS fermée, service_role only.

create table if not exists public.acces_boutiquiers (
  id bigint generated always as identity primary key,
  nom_cle text not null unique,                 -- nom de boutique canonique (minuscules, espaces réduits)
  nom_affiche text not null,                    -- nom tel qu'il apparaît dans le catalogue
  telephone_boutique text not null,             -- E.164 (+223XXXXXXXX) — verrouillé, non modifiable
  code_hash text,                               -- SHA-256 du code à 6 chiffres
  code_expires_at timestamptz,
  code_tentatives integer not null default 0,   -- essais de code ratés (bloqué à 5)
  dernier_code_demande_le timestamptz,          -- limiteur : 1 demande par minute
  token_hash text,                              -- SHA-256 du jeton de session
  token_expires_at timestamptz,
  maj_le timestamptz not null default now()
);

alter table public.acces_boutiquiers enable row level security;
revoke all on table public.acces_boutiquiers from anon, authenticated;
revoke all on sequence public.acces_boutiquiers_id_seq from anon, authenticated;
grant select, insert, update, delete on table public.acces_boutiquiers to service_role;
grant usage on sequence public.acces_boutiquiers_id_seq to service_role;

commit;
