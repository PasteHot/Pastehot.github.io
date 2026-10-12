begin;

create or replace function public.pastehot_list_store_team(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if not private.pastehot_store_manager_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'display_name',m.display_name,'email',u.email,'role',m.role,
    'enabled',m.enabled,'primary_owner',m.primary_owner,'current',m.user_id=auth.uid()
  ) order by m.primary_owner desc,m.display_name),'[]'::jsonb)
    into v_result
    from private.pastehot_members m
    join auth.users u on u.id=m.user_id
    where (
      (m.primary_owner and private.pastehot_primary_owner_allowed())
      or exists(select 1 from private.pastehot_store_memberships sm where sm.store_id=p_store_id and sm.user_id=m.user_id)
    ) and (private.pastehot_store_owner_allowed(p_store_id) or m.role='staff' or m.user_id=auth.uid());
  return v_result;
end;
$$;
revoke all on function public.pastehot_list_store_team(uuid) from public,anon;
grant execute on function public.pastehot_list_store_team(uuid) to authenticated;

drop function if exists public.pastehot_manager_add_staff(text,text);
drop function if exists private.pastehot_manager_add_staff(text,text);
create or replace function private.pastehot_manager_add_staff(p_email text,p_name text,p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_email text:=lower(trim(coalesce(p_email,'')));v_name text:=trim(coalesce(p_name,''));v_user uuid;
begin
  if not private.pastehot_manager_allowed() or not exists(
    select 1 from private.pastehot_store_memberships sm join private.pastehot_members m on m.user_id=sm.user_id
    where sm.store_id=p_store_id and sm.user_id=auth.uid() and m.enabled and m.role='manager'
  ) then raise exception 'NO_AUTORIZADO'; end if;
  if v_email !~ '^staff\+[a-z0-9][a-z0-9._-]{2,31}@accounts\.pastehot\.com$' then raise exception 'USUARIO_INVALIDO'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'NOMBRE_INVALIDO'; end if;
  select id into v_user from auth.users where lower(email)=v_email;
  if v_user is null then raise exception 'USUARIO_NO_ENCONTRADO'; end if;
  if exists(select 1 from private.pastehot_members where user_id=v_user) then raise exception 'EL_ACCESO_YA_EXISTE'; end if;
  insert into private.pastehot_members(user_id,role,display_name) values(v_user,'staff',v_name);
  insert into private.pastehot_store_memberships(store_id,user_id) values(p_store_id,v_user);
  return jsonb_build_object('user_id',v_user,'role','staff','display_name',v_name,'enabled',true,'store_id',p_store_id);
end;
$$;
revoke all on function private.pastehot_manager_add_staff(text,text,uuid) from public,anon,authenticated;
grant execute on function private.pastehot_manager_add_staff(text,text,uuid) to authenticated;
create or replace function public.pastehot_manager_add_staff(p_email text,p_name text,p_store_id uuid)
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_manager_add_staff(p_email,p_name,p_store_id); $$;
revoke all on function public.pastehot_manager_add_staff(text,text,uuid) from public,anon;
grant execute on function public.pastehot_manager_add_staff(text,text,uuid) to authenticated;

commit;
