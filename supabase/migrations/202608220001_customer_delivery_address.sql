-- Adresse textuelle de livraison saisie par le client.
-- Les colonnes restent nullable pour préserver les commandes historiques.
ALTER TABLE public.commandes
  ADD COLUMN IF NOT EXISTS quartier_client text,
  ADD COLUMN IF NOT EXISTS precision_livraison text;

ALTER TABLE public.commandes
  DROP CONSTRAINT IF EXISTS commandes_quartier_client_length,
  DROP CONSTRAINT IF EXISTS commandes_precision_livraison_length;

ALTER TABLE public.commandes
  ADD CONSTRAINT commandes_quartier_client_length
    CHECK (quartier_client IS NULL OR char_length(btrim(quartier_client)) BETWEEN 1 AND 160),
  ADD CONSTRAINT commandes_precision_livraison_length
    CHECK (precision_livraison IS NULL OR char_length(btrim(precision_livraison)) <= 300);

COMMENT ON COLUMN public.commandes.quartier_client IS 'Quartier de livraison saisi par le client ; requis pour les nouvelles commandes.';
COMMENT ON COLUMN public.commandes.precision_livraison IS 'Indication complémentaire facultative pour trouver le client.';
