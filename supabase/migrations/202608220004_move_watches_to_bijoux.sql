-- Les montres sont des accessoires de mode et doivent apparaître dans Bijoux & accessoires.
UPDATE public.produits
SET categorie_id = 'mode',
    sous_categorie_id = 'bijoux'
WHERE sous_categorie_id = 'montres';
