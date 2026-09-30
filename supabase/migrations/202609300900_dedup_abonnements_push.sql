-- Reconnaissance des appareils déjà enregistrés dans abonnements_push.
-- Objectif : un appareil (identifié par son endpoint push) ne doit jamais
-- générer une nouvelle ligne à chaque réinscription. Le déclencheur ci-dessous
-- met à jour la ligne existante : abonnement rafraîchi, et numéro de boutique
-- remplacé uniquement si le nouvel enregistrement en fournit un.
-- Applicable au tableau de bord Supabase (SQL Editor) ou via supabase db push.

CREATE OR REPLACE FUNCTION public.dedup_abonnement_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id uuid;
  existing_tel text;
BEGIN
  SELECT id, telephone_boutique
    INTO existing_id, existing_tel
    FROM public.abonnements_push
   WHERE subscription->>'endpoint' = NEW.subscription->>'endpoint'
   LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.abonnements_push
       SET subscription = NEW.subscription,
           telephone_boutique = COALESCE(NULLIF(NEW.telephone_boutique, ''), existing_tel)
     WHERE id = existing_id;
    RETURN NULL; -- insertion initiale annulée : la ligne existante a été mise à jour
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedup_abonnement_push ON public.abonnements_push;
CREATE TRIGGER trg_dedup_abonnement_push
BEFORE INSERT ON public.abonnements_push
FOR EACH ROW EXECUTE FUNCTION public.dedup_abonnement_push();
