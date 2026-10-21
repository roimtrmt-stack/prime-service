-- Commission par paliers pour tous les articles existants.
-- Règle : 8 % du prix de base boutique, arrondis au multiple de 100 supérieur,
-- minimum 300 FCFA — jamais de montants du type 314, 456, 324.
-- Exemples : base 2000 → 300 │ base 5000 → 400 │ base 10000 → 800.
-- ---------------------------------------------------------------
-- Sert d'accompagnement au changement de règle côté code (formulaire de
-- publication et Edge Function envoyer-commande, qui détectent et corrigent
-- aussi les articles hérités au fil de l'eau).
-- La migration est idempotente : relancée une seconde fois, elle ne change rien
-- (commission recalculée depuis prix_base = prix − commission, qui est un point
-- fixe de la règle).
-- Les valeurs prix et commission lues dans une ligne UPDATE SQL sont celles
-- d'avant la mise à jour de la ligne, ce qui permet de recalculer les deux en
-- une seule passe sans table temporaire.

-- 1. Tous les articles : prix = prix de base + commission recalculée.
--    (prix - commission) est le prix de base boutique ; la commission ne peut
--    pas descendre sous 300 et ne dépasse jamais le prix de base.
--    base < 300 → commission 300 (le minimum du service prime).
UPDATE public.produits
SET
  commission = nouvelle_commission,
  prix = prix - commission + nouvelle_commission
FROM (
  SELECT
    id,
    CAST(
      LEAST(
        GREATEST(
          300,
          CEIL((GREATEST(0, prix - COALESCE(commission, 0)) * 8)::numeric / 10000) * 100
        ),
        GREATEST(0, prix - COALESCE(commission, 0))
      ) AS integer
    ) AS nouvelle_commission
  FROM public.produits
) c
WHERE public.produits.id = c.id
  AND COALESCE(public.produits.commission, -1) <> c.nouvelle_commission;

-- 2. Sécurité : aucune commission ne doit rester négative ou vide.
UPDATE public.produits
SET commission = 300
WHERE commission IS NULL OR commission < 0;
