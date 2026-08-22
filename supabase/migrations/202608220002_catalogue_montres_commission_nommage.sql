-- Déplace les anciennes montres vers le catalogue mode, sous-catégorie Montres.
UPDATE public.produits
SET categorie_id = 'mode',
    sous_categorie_id = 'montres'
WHERE sous_categorie_id = 'montres-connectees';

-- Les noms des montres ne doivent pas exposer le préfixe technique de l’ancien agent.
UPDATE public.produits
SET nom = 'Montre de style'
WHERE sous_categorie_id = 'montres'
  AND nom ILIKE '%montre%';

-- Nettoie les noms historiques générés depuis des captures d’écran.
UPDATE public.produits
SET nom = CASE
  WHEN nom ILIKE 'Élégance —%' THEN 'Élégance — ' || btrim(regexp_replace(
    nom,
    '^Élégance — Capture[[:space:]]+D[''’]?écran[[:space:]]+[0-9[:space:]]+(Copie[[:space:]]+)?',
    '',
    1,
    1,
    'i'
  ))
  ELSE 'Sélection Signature — ' || btrim(regexp_replace(
    nom,
    '^Sélection Signature — Capture[[:space:]]+D[''’]?écran[[:space:]]+[0-9[:space:]]+(Copie[[:space:]]+)?',
    '',
    1,
    1,
    'i'
  ))
END
WHERE nom ~* 'capture[[:space:]]+d[''’]?écran';
