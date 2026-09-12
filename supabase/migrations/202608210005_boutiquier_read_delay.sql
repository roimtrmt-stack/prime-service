-- Mémorise le début de lecture de la commande par le boutiquier.
-- L’endpoint d’accusé impose ensuite 60 secondes réelles avant l’accusé.
ALTER TABLE public.notifications_boutiquiers
  ADD COLUMN IF NOT EXISTS read_started_at timestamptz;

COMMENT ON COLUMN public.notifications_boutiquiers.read_started_at IS
  'Début de lecture de la page boutique ; l’accusé est autorisé après 60 secondes.';
