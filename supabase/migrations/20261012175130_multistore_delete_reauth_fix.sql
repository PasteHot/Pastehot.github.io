begin;

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

  -- Supabase tokens can expose recent password authentication through `amr`
  -- without an `auth_time` claim. Prefer auth_time when present and fall back
  -- only to the timestamp of an actual password authentication method.
  begin
    v_auth_time:=nullif(auth.jwt()->>'auth_time','')::double precision;
  exception when others then
    v_auth_time:=null;
  end;
  if v_auth_time is null then
    begin
      select max(nullif(a.value->>'timestamp','')::double precision)
        into v_auth_time
        from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) as a(value)
        where a.value->>'method'='password';
    exception when others then
      v_auth_time:=null;
    end;
  end if;
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
  delete from public.orders where store_id=p_store_id;
  delete from public.stores where id=p_store_id;
  return v_deleted;
end;
$$;
revoke all on function public.pastehot_delete_store(uuid) from public,anon;
grant execute on function public.pastehot_delete_store(uuid) to authenticated;

commit;
