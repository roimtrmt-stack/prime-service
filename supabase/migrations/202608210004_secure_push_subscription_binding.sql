-- Les notifications push publiques doivent être associées à un numéro
-- uniquement via le lien d’activation signé par une commande.
-- L’ancienne insertion publique reste tolérée pour les abonnements généraux
-- de visiteurs, mais elle ne doit jamais accepter telephone_boutique.

DROP POLICY IF EXISTS "Insertion publique des abonnements" ON public.abonnements_push;
DROP POLICY IF EXISTS "Insertion publique des abonnements généraux" ON public.abonnements_push;
DROP POLICY IF EXISTS "Insertion authentifiée des abonnements boutique" ON public.abonnements_push;

CREATE POLICY "Insertion publique des abonnements généraux"
  ON public.abonnements_push
  FOR INSERT
  TO anon
  WITH CHECK (telephone_boutique IS NULL);

CREATE POLICY "Insertion authentifiée des abonnements boutique"
  ON public.abonnements_push
  FOR INSERT
  TO authenticated
  WITH CHECK (telephone_boutique IS NULL);
