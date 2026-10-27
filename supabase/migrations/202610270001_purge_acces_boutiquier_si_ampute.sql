-- Purge automatique du mode boutiquier quand tous les articles d'une
-- boutique sont supprimés : sans articles, l'espace privé est effacé
-- (l'exploitant l'a demandé explicitement). Déclenché après chaque
-- suppression d'article dans la table `produits`.

CREATE OR REPLACE FUNCTION purger_acces_boutiquier_si_ampute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cle_boutique text;
  articles_restants integer;
BEGIN
  cle_boutique := lower(btrim(substring(OLD.nom_boutique from 1 for 160)));
  IF cle_boutique IS NULL OR cle_boutique = '' THEN
    RETURN OLD;
  END IF;

  SELECT count(*) INTO articles_restants
  FROM produits
  WHERE lower(btrim(substring(nom_boutique from 1 for 160))) = cle_boutique;

  IF articles_restants = 0 THEN
    DELETE FROM acces_boutiquiers WHERE nom_cle = cle_boutique;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_purger_acces_boutiquier ON produits;
CREATE TRIGGER trigger_purger_acces_boutiquier
AFTER DELETE ON produits
FOR EACH ROW
EXECUTE FUNCTION purger_acces_boutiquier_si_ampute();
