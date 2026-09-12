-- Les articles 155 à 203 correspondent aux montres visibles du lot Electronique.
-- Ils étaient mal classés dans mode|vetements malgré leurs photos de montres.
UPDATE public.produits
SET categorie_id = 'mode',
    sous_categorie_id = 'montres'
WHERE id BETWEEN 155 AND 203
  AND categorie_id = 'mode'
  AND sous_categorie_id = 'vetements';
