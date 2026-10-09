-- Prepared for preview only; apply only with publication authorization.
begin;
alter table private.pastehot_access_config add column direct_access boolean not null default false;
create or replace function private.pastehot_owner_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m cross join private.pastehot_access_config c
 join auth.sessions a on a.id=(auth.jwt()->>'session_id')::uuid
 where m.user_id=auth.uid() and m.role in ('owner') and m.enabled and a.user_id=m.user_id
 and (c.direct_access or exists(select 1 from private.pastehot_sessions s where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved')));
$$;
create or replace function private.pastehot_staff_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m cross join private.pastehot_access_config c
 join auth.sessions a on a.id=(auth.jwt()->>'session_id')::uuid
 where m.user_id=auth.uid() and m.role in ('manager','staff') and m.enabled and a.user_id=m.user_id
 and (c.direct_access or exists(select 1 from private.pastehot_sessions s where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved')));
$$;
create or replace function private.pastehot_manager_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m cross join private.pastehot_access_config c
 join auth.sessions a on a.id=(auth.jwt()->>'session_id')::uuid
 where m.user_id=auth.uid() and m.role in ('manager') and m.enabled and a.user_id=m.user_id
 and (c.direct_access or exists(select 1 from private.pastehot_sessions s where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved')));
$$;
create or replace function private.pastehot_access_dispatch(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid();v_sid uuid:=(auth.jwt()->>'session_id')::uuid;
 v_member private.pastehot_members;v_current private.pastehot_sessions;
 v_enforced boolean;v_allowed boolean;v_target uuid;v_status text;v_email text;v_role text;
 v_token text;v_hash text;
 v_sessions jsonb:='[]';v_members jsonb:='[]';v_label text;
begin
 if v_uid is null or v_sid is null or not exists(select 1 from auth.sessions where id=v_sid and user_id=v_uid) then raise exception 'NO_AUTORIZADO';end if;
 select * into v_member from private.pastehot_members where user_id=v_uid;
 if not found or not v_member.enabled then return jsonb_build_object('allowed',false,'status','disabled');end if;
 -- A single locked row serializes activation, membership changes and browser approvals.
 select enforced into v_enforced from private.pastehot_access_config where singleton for update;
 if p_action='state' then
   v_token:=p_args->>'device_token';
   if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'NAVEGADOR_NO_IDENTIFICADO';end if;
   v_hash:=encode(sha256(convert_to(v_token,'UTF8')),'hex');
   v_label:=left(coalesce((select label from private.pastehot_sessions where user_id=v_uid and token_hash=v_hash),nullif(trim(p_args->>'label'),''),'Mi navegador'),60);
   insert into private.pastehot_sessions(auth_session_id,user_id,token_hash,label,visible) values(v_sid,v_uid,v_hash,v_label,coalesce((p_args->>'visible')::boolean,false))
   on conflict(token_hash) do update set auth_session_id=excluded.auth_session_id,last_seen=now(),visible=excluded.visible,label=excluded.label
   where private.pastehot_sessions.user_id=excluded.user_id;
   if not found then raise exception 'NO_AUTORIZADO';end if;
   if (select direct_access from private.pastehot_access_config where singleton) then
     update private.pastehot_sessions set status='approved' where auth_session_id=v_sid and user_id=v_uid;
   end if;
 elsif p_action='activate' then
   if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
   if not v_enforced then
     if not exists(select 1 from private.pastehot_sessions where auth_session_id=v_sid and user_id=v_uid) then raise exception 'PRIMERO_REGISTRA_EL_NAVEGADOR';end if;
     update private.pastehot_sessions set status='revoked' where auth_session_id is distinct from v_sid;
     update private.pastehot_sessions set status='approved',last_seen=now() where auth_session_id=v_sid and user_id=v_uid;
     update private.pastehot_access_config set enforced=true where singleton;
     v_enforced:=true;
   end if;
 elsif p_action in ('set_session','set_staff','set_role','add_staff','rename_session','remove_session') then
   if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
   if p_action='rename_session' then
     v_target:=(p_args->>'session_id')::uuid;v_label:=trim(p_args->>'label');
     if v_label is null or length(v_label) not between 1 and 60 then raise exception 'NOMBRE_INVALIDO';end if;
     update private.pastehot_sessions set label=v_label where session_id=v_target;
     if not found then raise exception 'SESION_NO_DISPONIBLE';end if;
   elsif p_action='remove_session' then
     v_target:=(p_args->>'session_id')::uuid;
     if exists(select 1 from private.pastehot_sessions where session_id=v_target and auth_session_id=v_sid) then raise exception 'NO_ELIMINES_TU_SESION_ACTUAL';end if;
     delete from private.pastehot_sessions where session_id=v_target and status='revoked';
     if not found then raise exception 'REVOCA_EL_ACCESO_PRIMERO';end if;
   elsif p_action='set_session' then
     v_target:=(p_args->>'session_id')::uuid;v_status:=p_args->>'status';
     if v_status not in ('approved','revoked') or v_status is null then raise exception 'ESTADO_INVALIDO';end if;
     if exists(select 1 from private.pastehot_sessions where session_id=v_target and auth_session_id=v_sid) then raise exception 'NO_REVOQUES_TU_SESION_ACTUAL';end if;
     if not exists(select 1 from private.pastehot_sessions s join private.pastehot_members m on m.user_id=s.user_id where s.session_id=v_target and m.enabled) then raise exception 'SESION_NO_DISPONIBLE';end if;
     update private.pastehot_sessions set status=v_status,visible=false where session_id=v_target;
   elsif p_action='set_staff' then
     v_target:=(p_args->>'user_id')::uuid;
     if not exists(select 1 from private.pastehot_members where user_id=v_target and role in ('manager','staff')) then raise exception 'EMPLEADO_NO_ENCONTRADO';end if;
     update private.pastehot_members set enabled=(p_args->>'enabled')::boolean where user_id=v_target;
     update private.pastehot_sessions set status='revoked',visible=false where user_id=v_target;
   elsif p_action='set_role' then
     v_target:=(p_args->>'user_id')::uuid;v_role:=p_args->>'role';
     if v_role is null or v_role not in ('manager','staff') then raise exception 'ROL_INVALIDO';end if;
     if not exists(select 1 from private.pastehot_members where user_id=v_target and role in ('manager','staff')) then raise exception 'EMPLEADO_NO_ENCONTRADO';end if;
     -- New permissions require an explicit fresh browser approval, including promotions.
     update private.pastehot_members set role=v_role where user_id=v_target and role<>v_role;
     if found then update private.pastehot_sessions set status='revoked',visible=false where user_id=v_target;end if;
   else
     if not v_enforced then raise exception 'ACTIVA_LA_PROTECCION_PRIMERO';end if;
     v_role:=coalesce(p_args->>'role','staff');
     if v_role not in ('manager','staff') then raise exception 'ROL_INVALIDO';end if;
     v_email:=lower(trim(p_args->>'email'));v_label:=trim(p_args->>'name');
     if v_label is null or length(v_label) not between 1 and 80 then raise exception 'NOMBRE_INVALIDO';end if;
     select id into v_target from auth.users where lower(email)=v_email;
     if v_target is null then raise exception 'USUARIO_NO_ENCONTRADO';end if;
     if exists(select 1 from private.pastehot_members where user_id=v_target) then raise exception 'EL_ACCESO_YA_EXISTE';end if;
     insert into private.pastehot_members(user_id,role,display_name) values(v_target,v_role,v_label);
   end if;
 else raise exception 'ACCION_INVALIDA';end if;
 select * into v_current from private.pastehot_sessions where auth_session_id=v_sid;
 v_allowed:=private.pastehot_owner_allowed() or private.pastehot_staff_allowed();
 if v_allowed then
   select coalesce(jsonb_agg(jsonb_build_object('session_id',s.session_id,'user_id',s.user_id,'label',s.label,'status',s.status,
     'role',m.role,'member_enabled',m.enabled,'display_name',m.display_name,'current',s.auth_session_id=v_sid,
     'online',s.auth_session_id is not null and s.visible and s.last_seen>now()-interval '60 seconds' and s.status='approved') order by s.created_at),'[]'::jsonb)
   into v_sessions from private.pastehot_sessions s join private.pastehot_members m on m.user_id=s.user_id
   where v_member.role='owner' or (m.enabled and s.status='approved');
   if v_member.role='owner' then
     select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'display_name',m.display_name,'enabled',m.enabled,'email',u.email) order by m.display_name),'[]'::jsonb)
     into v_members from private.pastehot_members m join auth.users u on u.id=m.user_id;
   end if;
 end if;
 return jsonb_build_object('direct_access',(select direct_access from private.pastehot_access_config where singleton),'allowed',v_allowed,'role',v_member.role,'status',v_current.status,'enforced',v_enforced,'device_id',v_current.session_id,'device_label',v_current.label,'sessions',v_sessions,'members',v_members);
end;$$;
update private.pastehot_access_config set direct_access=true,enforced=true where singleton;
commit;
