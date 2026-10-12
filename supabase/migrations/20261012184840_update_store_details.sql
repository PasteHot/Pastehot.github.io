-- Let only the primary owner edit both the display name and area of a branch.
-- This changes branch metadata only; branch data, slug, and access stay intact.
create or replace function public.pastehot_update_store_details(
  p_store_id uuid,
  p_name text,
  p_area text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_area text := trim(coalesce(p_area, ''));
  v_store jsonb;
begin
  if not private.pastehot_primary_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'NOMBRE_INVALIDO';
  end if;
  if length(v_area) > 120 then
    raise exception 'ZONA_INVALIDA';
  end if;

  update public.stores
  set name = v_name,
      area = v_area
  where id = p_store_id
  returning jsonb_build_object(
    'id', id,
    'slug', slug,
    'name', name,
    'area', area,
    'is_active', is_active
  ) into v_store;

  if v_store is null then
    raise exception 'SUCURSAL_NO_ENCONTRADA';
  end if;
  return v_store;
end;
$$;

revoke all on function public.pastehot_update_store_details(uuid, text, text) from public, anon;
grant execute on function public.pastehot_update_store_details(uuid, text, text) to authenticated;
