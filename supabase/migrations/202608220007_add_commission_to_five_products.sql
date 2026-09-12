-- Ajoute la commission de 300 FCFA aux cinq articles confirmés par le propriétaire.
-- Les prix de base attendus sont inclus pour éviter tout double ajout accidentel.
UPDATE public.produits AS p
SET prix = p.prix + 300
WHERE (p.id, p.prix) IN (
  (94, 60000),
  (97, 45000),
  (98, 45000),
  (108, 12000),
  (109, 7000)
)
  AND p.commission = 300;
