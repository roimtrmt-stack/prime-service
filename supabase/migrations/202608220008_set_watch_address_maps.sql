-- Adresse commune fournie par le propriétaire pour les 51 montres déjà publiées.
-- Les coordonnées DMS ont été converties en décimal pour Google Maps.
UPDATE public.produits
SET
  adresse = 'Halles de Bamako près de pharmacie : 12°35''41.6"N 7°57''42.5"W',
  lat = 12.5948888888889,
  lng = -7.96180555555556
WHERE id BETWEEN 155 AND 205
  AND categorie_id = 'mode'
  AND sous_categorie_id = 'bijoux';
