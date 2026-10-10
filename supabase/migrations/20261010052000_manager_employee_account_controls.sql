-- Prepared for review/preview only. Apply to production only with explicit approval.
begin;

create or replace function private.pastehot_manager_staff_accounts()
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_accounts jsonb;
begin
  if not private.pastehot_manager_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',m.user_id,'role',m.role,'primary_owner',false,'current',false,
    'display_name',m.display_name,'enabled',m.enabled,'email',u.email
  ) order by m.display_name),'[]'::jsonb)
  into v_accounts
  from private.pastehot_members m join auth.users u on u.id=m.user_id
  where m.role='staff' and m.user_id<>auth.uid();
  return v_accounts;
end;
$$;
revoke all on function private.pastehot_manager_staff_accounts() from public,anon,authenticated;
grant execute on function private.pastehot_manager_staff_accounts() to authenticated;
create or replace function public.pastehot_manager_staff_accounts()
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_manager_staff_accounts(); $$;
revoke all on function public.pastehot_manager_staff_accounts() from public,anon;
grant execute on function public.pastehot_manager_staff_accounts() to authenticated;

create or replace function private.pastehot_manager_add_staff(p_email text,p_name text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_email text:=lower(trim(coalesce(p_email,'')));v_name text:=trim(coalesce(p_name,''));v_user uuid;
begin
  if not private.pastehot_manager_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if v_email !~ '^staff\+[a-z0-9][a-z0-9._-]{2,31}@accounts\.pastehot\.com$' then raise exception 'USUARIO_INVALIDO'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'NOMBRE_INVALIDO'; end if;
  select id into v_user from auth.users where lower(email)=v_email;
  if v_user is null then raise exception 'USUARIO_NO_ENCONTRADO'; end if;
  if exists(select 1 from private.pastehot_members where user_id=v_user) then raise exception 'EL_ACCESO_YA_EXISTE'; end if;
  insert into private.pastehot_members(user_id,role,display_name) values(v_user,'staff',v_name);
  return jsonb_build_object('user_id',v_user,'role','staff','display_name',v_name,'enabled',true);
end;
$$;
revoke all on function private.pastehot_manager_add_staff(text,text) from public,anon,authenticated;
grant execute on function private.pastehot_manager_add_staff(text,text) to authenticated;
create or replace function public.pastehot_manager_add_staff(p_email text,p_name text)
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_manager_add_staff(p_email,p_name); $$;
revoke all on function public.pastehot_manager_add_staff(text,text) from public,anon;
grant execute on function public.pastehot_manager_add_staff(text,text) to authenticated;

create or replace function private.pastehot_manager_set_staff_enabled(p_user_id uuid,p_enabled boolean)
returns void
language plpgsql security definer set search_path=''
as $$
begin
  if not private.pastehot_manager_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if p_user_id is null or p_user_id=auth.uid()
     or not exists(select 1 from private.pastehot_members where user_id=p_user_id and role='staff' and not primary_owner) then
    raise exception 'CUENTA_NO_MODIFICABLE';
  end if;
  update private.pastehot_members set enabled=p_enabled where user_id=p_user_id;
  update private.pastehot_sessions set status='revoked',visible=false where user_id=p_user_id;
end;
$$;
revoke all on function private.pastehot_manager_set_staff_enabled(uuid,boolean) from public,anon,authenticated;
grant execute on function private.pastehot_manager_set_staff_enabled(uuid,boolean) to authenticated;
create or replace function public.pastehot_manager_set_staff_enabled(p_user_id uuid,p_enabled boolean)
returns void language sql security invoker set search_path=''
as $$ select private.pastehot_manager_set_staff_enabled(p_user_id,p_enabled); $$;
revoke all on function public.pastehot_manager_set_staff_enabled(uuid,boolean) from public,anon;
grant execute on function public.pastehot_manager_set_staff_enabled(uuid,boolean) to authenticated;

create or replace function private.pastehot_manager_revoke_staff_sessions(p_user_id uuid)
returns void
language plpgsql security definer set search_path=''
as $$
begin
  if not private.pastehot_manager_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if p_user_id is null or p_user_id=auth.uid()
     or not exists(select 1 from private.pastehot_members where user_id=p_user_id and role='staff' and not primary_owner) then
    raise exception 'CUENTA_NO_MODIFICABLE';
  end if;
  update private.pastehot_sessions set status='revoked',visible=false where user_id=p_user_id;
  delete from auth.sessions where user_id=p_user_id;
end;
$$;
revoke all on function private.pastehot_manager_revoke_staff_sessions(uuid) from public,anon,authenticated;
grant execute on function private.pastehot_manager_revoke_staff_sessions(uuid) to authenticated;
create or replace function public.pastehot_manager_revoke_staff_sessions(p_user_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.pastehot_manager_revoke_staff_sessions(p_user_id); $$;
revoke all on function public.pastehot_manager_revoke_staff_sessions(uuid) from public,anon;
grant execute on function public.pastehot_manager_revoke_staff_sessions(uuid) to authenticated;

commit;
