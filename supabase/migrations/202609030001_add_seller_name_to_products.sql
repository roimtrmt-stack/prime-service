-- Conserver le nom de la personne qui a inscrit la boutique avec chaque article.
-- Colonne nullable pour préserver les articles déjà existants.
alter table public.produits
  add column if not exists nom_boutiquier text;

comment on column public.produits.nom_boutiquier is
  'Nom du boutiquier fourni lors de l inscription ; affichable publiquement avec la boutique.';

create index if not exists produits_nom_boutiquier_idx
  on public.produits (nom_boutiquier);

select pg_notify('pgrst', 'reload schema');

-- Vérification attendue : la colonne reste nullable afin de ne pas bloquer les anciennes lignes.
