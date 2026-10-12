begin;

-- Password verification happens in a short-lived Edge Function. PostgREST's
-- service-role-only operation receives the verified owner's ID and checks it
-- against the immutable primary-owner membership before deleting anything.
create or replace function public.pastehot_delete_store_after_reauth(
  p_store_id uuid,
  p_owner_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deleted jsonb;
  v_store_count integer;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'NO_AUTORIZADO';
  end if;
  if not exists(
    select 1 from private.pastehot_members
    where user_id=p_owner_id and primary_owner and role='owner' and enabled
  ) then raise exception 'NO_AUTORIZADO'; end if;

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
revoke all on function public.pastehot_delete_store_after_reauth(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pastehot_delete_store_after_reauth(uuid,uuid) to service_role;

-- Remove the old browser-callable path. The Edge Function is now the only
-- route that can perform password-verified permanent deletion.
revoke all on function public.pastehot_delete_store(uuid) from public,anon,authenticated;

-- Existing credentials were copied to Vault by the previous feature. Delete
-- only secrets linked to this app's private credential index, then remove its
-- lookup and write APIs. Auth's own password hashes remain unchanged.
delete from vault.secrets s
using private.pastehot_staff_password_vault l
where s.id=l.secret_id;
delete from private.pastehot_staff_password_vault;

drop trigger if exists pastehot_remove_member_password_secret
  on private.pastehot_staff_password_vault;
drop function if exists private.pastehot_remove_member_password_secret();
drop function if exists public.pastehot_get_member_password(uuid);
drop function if exists public.pastehot_store_staff_password(uuid,text);
drop function if exists private.pastehot_store_staff_password(uuid,text);
drop table if exists private.pastehot_staff_password_vault;

commit;
