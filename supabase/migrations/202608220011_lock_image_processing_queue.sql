begin;

-- La file ne contient aucune donnée destinée au navigateur.
-- Le worker utilise service_role, tandis que les rôles publics sont explicitement refusés.
drop policy if exists "Aucun acces public file images" on public.traitements_images_produits;
create policy "Aucun acces public file images"
on public.traitements_images_produits
for all
to anon, authenticated
using (false)
with check (false);

commit;
