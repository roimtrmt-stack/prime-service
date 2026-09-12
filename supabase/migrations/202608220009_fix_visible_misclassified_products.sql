-- Correction ciblée des produits visibles dans la capture utilisateur.
-- Les photos ont été vérifiées : 208 et 209 sont des téléphones ; 210 est une montre.
UPDATE public.produits
SET
  nom = CASE id
    WHEN 208 THEN 'VILLAON V50S — Smartphone Double Caméra'
    WHEN 209 THEN 'OKING OKS28 New — Téléphone à Touches'
    WHEN 210 THEN 'Montre Chronographe Or Rose — Cadran Noir'
  END,
  categorie_id = CASE
    WHEN id IN (208, 209) THEN 'electronique'
    WHEN id = 210 THEN 'mode'
  END,
  sous_categorie_id = CASE
    WHEN id IN (208, 209) THEN 'telephones'
    WHEN id = 210 THEN 'bijoux'
  END
WHERE id IN (208, 209, 210)
  AND (
    nom ILIKE '%Sélection%'
    OR (id IN (208, 209) AND (categorie_id, sous_categorie_id) <> ('electronique', 'telephones'))
    OR (id = 210 AND (categorie_id, sous_categorie_id) <> ('mode', 'bijoux'))
  );
