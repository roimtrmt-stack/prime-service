-- Retire le dernier marqueur générique d’un intitulé de montre déjà publié.
UPDATE public.produits
SET nom = 'Montre Carbone Bleu'
WHERE id = 185
  AND categorie_id = 'mode'
  AND sous_categorie_id = 'bijoux'
  AND nom = 'Montre Bleu Nuit Signature';
