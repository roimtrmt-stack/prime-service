-- Sécurité : les articles étaient modifiables et supprimables par n'importe quel
-- visiteur (politiques « Public full access produits », « Autoriser modification
-- produits » et « Public delete produits », toutes avec USING true). La clé anon
-- étant publique dans le site, cela permettait d'effacer le catalogue.
-- Les gestes d'administration se font dans le navigateur avec une session
-- authentifiée (email du propriétaire), déjà autorisée par les politiques
-- « Modification admin uniquement » / « Lecture complète admin uniquement ».
-- La suppression, elle, n'existait qu'en version publique : on la recrée pour
-- l'admin authentifié avant de retirer la version publique.
-- La publication d'articles depuis la page d'inscription (insertion anon) reste
-- inchangée : c'est le parcours normal d'un boutiquier.

drop policy if exists "Public delete produits" on public.produits;
drop policy if exists "Public full access produits" on public.produits;
drop policy if exists "Autoriser modification produits" on public.produits;

drop policy if exists "Suppression admin uniquement" on public.produits;
create policy "Suppression admin uniquement"
  on public.produits
  for delete
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'roimtrmt@gmail.com');
