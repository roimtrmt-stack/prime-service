-- Correction ciblée des publications Prime Service identifiées le 2026-08-30.
-- Aucun prix, stock, photo ou commission n'est modifié.

UPDATE public.produits
SET nom = 'Lot de 3 débardeurs homme blancs — marquage YWLO, taille XXL'
WHERE id = 260
  AND nom = 'Gemini Generated 3cpugw3cpugw3cpu Ivoire Doux Ligne Équilibrée'
  AND categorie_id = 'mode'
  AND sous_categorie_id = 'vetements';

UPDATE public.produits
SET nom = 'Montre carrée squelette argentée — bracelet métallique à vis',
    categorie_id = 'mode',
    sous_categorie_id = 'bijoux'
WHERE id = 261
  AND nom = 'Gemini Generated 94p6cb94p6cb94p6 Ivoire Doux Silhouette Élancée'
  AND categorie_id = 'mode'
  AND sous_categorie_id = 'vetements';
