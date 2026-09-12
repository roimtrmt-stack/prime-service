-- Unifier les variantes de nom de la même boutique sans toucher aux téléphones,
-- photos, stocks, prix ou catégories.
update public.produits
set nom_boutique = 'Fala Service'
where lower(regexp_replace(trim(coalesce(nom_boutique, '')), '\s+', ' ', 'g'))
      in ('service de fala', 'sevice de fala', 'fala service');
