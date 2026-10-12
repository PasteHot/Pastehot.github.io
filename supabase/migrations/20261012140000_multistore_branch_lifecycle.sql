begin;

-- Return only product/design image URLs owned exclusively by the branch being
-- removed. Files shared by another branch remain in Storage.
create or replace function public.pastehot_store_image_urls_for_delete(p_store_id uuid)
returns table(image_url text)
language plpgsql
security definer
set search_path=''
as $$
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;

  return query
  with target_urls as (
    select p.image_url as url
    from public.products p
    where p.store_id=p_store_id and p.image_url like '%/storage/v1/object/public/product-images/%'
    union
    select s.value as url
    from public.settings s
    where s.store_id=p_store_id
      and s.key=any(array['cover_image','profile_image','background_image'])
      and s.value like '%/storage/v1/object/public/product-images/%'
  )
  select distinct t.url
  from target_urls t
  where not exists (
    select 1 from public.products p
    where p.store_id<>p_store_id and p.image_url=t.url
  )
  and not exists (
    select 1 from public.settings s
    where s.store_id<>p_store_id
      and s.key=any(array['cover_image','profile_image','background_image'])
      and s.value=t.url
  );
end;
$$;
revoke all on function public.pastehot_store_image_urls_for_delete(uuid) from public,anon;
grant execute on function public.pastehot_store_image_urls_for_delete(uuid) to authenticated;

create or replace function public.pastehot_set_store_active(p_store_id uuid,p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_store jsonb;
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  lock table public.stores in share row exclusive mode;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;
  if not coalesce(p_is_active,false)
     and (select count(*) from public.stores where is_active)<=1 then
    raise exception 'DEBE_QUEDAR_UNA_SUCURSAL_ACTIVA';
  end if;

  update public.stores
  set is_active=coalesce(p_is_active,false)
  where id=p_store_id
  returning jsonb_build_object('id',id,'slug',slug,'name',name,'area',area,'is_active',is_active)
  into v_store;
  return v_store;
end;
$$;
revoke all on function public.pastehot_set_store_active(uuid,boolean) from public,anon;
grant execute on function public.pastehot_set_store_active(uuid,boolean) to authenticated;

create or replace function public.pastehot_delete_store(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_auth_time double precision;
  v_deleted jsonb;
  v_store_count integer;
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;

  -- The browser reauthenticates with the primary owner's password immediately
  -- before this RPC. Require a JWT issued by that recent password sign-in.
  begin
    v_auth_time:=nullif(auth.jwt()->>'auth_time','')::double precision;
  exception when others then
    v_auth_time:=null;
  end;
  if v_auth_time is null
     or to_timestamp(v_auth_time)<now()-interval '5 minutes'
     or to_timestamp(v_auth_time)>now()+interval '30 seconds' then
    raise exception 'REAUTENTICACION_REQUERIDA';
  end if;

  lock table public.stores in share row exclusive mode;
  select count(*) into v_store_count from public.stores;
  if v_store_count<=1 then raise exception 'NO_SE_PUEDE_ELIMINAR_LA_ULTIMA_SUCURSAL'; end if;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;
  if (select is_active from public.stores where id=p_store_id)
     and (select count(*) from public.stores where is_active)<=1 then
    raise exception 'DEBE_QUEDAR_UNA_SUCURSAL_ACTIVA';
  end if;

  select jsonb_build_object('id',id,'name',name) into v_deleted
  from public.stores where id=p_store_id;

  -- Orders have RESTRICT on store_id; dependent rows and other branch records
  -- are removed by their store foreign keys with ON DELETE CASCADE.
  delete from public.orders where store_id=p_store_id;
  delete from public.stores where id=p_store_id;
  return v_deleted;
end;
$$;
revoke all on function public.pastehot_delete_store(uuid) from public,anon;
grant execute on function public.pastehot_delete_store(uuid) to authenticated;

commit;
