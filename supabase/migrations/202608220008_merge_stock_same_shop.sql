-- Fusion de stock contrôlée : le navigateur ne peut déclencher la fusion
-- qu’après sa vérification photo, et la base vérifie à nouveau la boutique.
-- Aucun prix, commission, nom ou photo existants n’est modifié.
create or replace function public.fusionner_stock_si_meme_boutique(
  p_produit_id bigint,
  p_stock bigint,
  p_nom_boutique text
)
returns table(id bigint, stock bigint, fusionne boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boutique text := lower(regexp_replace(trim(coalesce(p_nom_boutique, '')), '\s+', ' ', 'g'));
begin
  if p_produit_id is null
     or p_stock is null
     or p_stock < 1
     or p_stock > 100000
     or length(v_boutique) < 2
     or length(v_boutique) > 160 then
    return;
  end if;

  return query
  update public.produits as p
     set stock = coalesce(p.stock, 0) + p_stock
   where p.id = p_produit_id
     and coalesce(p.masque, false) = false
     and lower(regexp_replace(trim(coalesce(p.nom_boutique, '')), '\s+', ' ', 'g')) = v_boutique
  returning p.id, p.stock, true;
end;
$$;

revoke all on function public.fusionner_stock_si_meme_boutique(bigint, bigint, text) from public;
grant execute on function public.fusionner_stock_si_meme_boutique(bigint, bigint, text) to anon, authenticated;
