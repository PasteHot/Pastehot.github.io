-- PREPARED ONLY. Not applied to the live PasteHot database.
-- Install after preview approval. Device enforcement starts only through explicit owner activation.
begin;
create schema if not exists private;
create table private.pastehot_access_config (
  singleton boolean primary key default true check(singleton), enforced boolean not null default false
);
insert into private.pastehot_access_config(singleton) values(true);
create table private.pastehot_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','staff')), enabled boolean not null default true,
  display_name text not null check(length(display_name) between 1 and 80)
);
create unique index pastehot_one_owner on private.pastehot_members(role) where role='owner';
insert into private.pastehot_members values('a0c0b64b-7809-4428-ad00-a1484d6ded53','owner',true,'Propietaria');
create table private.pastehot_sessions (
  session_id uuid primary key default gen_random_uuid(),
  auth_session_id uuid unique references auth.sessions(id) on delete set null,
  token_hash text not null unique,
  user_id uuid not null references private.pastehot_members(user_id) on delete cascade,
  label text not null check(length(label) between 1 and 60),
  status text not null default 'pending' check(status in ('pending','approved','revoked')),
  last_seen timestamptz not null default now(), visible boolean not null default false,
  created_at timestamptz not null default now()
);
create index pastehot_sessions_user on private.pastehot_sessions(user_id);
create index pastehot_sessions_status on private.pastehot_sessions(status);
alter table private.pastehot_members enable row level security;
alter table private.pastehot_sessions enable row level security;
alter table private.pastehot_access_config enable row level security;
revoke all on private.pastehot_members,private.pastehot_sessions,private.pastehot_access_config from public,anon,authenticated;

create function private.pastehot_owner_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m,private.pastehot_access_config c
 where m.user_id=auth.uid() and m.role='owner' and m.enabled
 and (not c.enforced or exists(select 1 from private.pastehot_sessions s join auth.sessions a on a.id=s.auth_session_id
 where s.auth_session_id=(auth.jwt()->>'session_id')::uuid and s.user_id=m.user_id and s.status='approved' and a.user_id=m.user_id)));
$$;
create function private.pastehot_staff_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m,private.pastehot_access_config c
 where c.enforced and m.user_id=auth.uid() and m.role='staff' and m.enabled
 and exists(select 1 from private.pastehot_sessions s join auth.sessions a on a.id=s.auth_session_id
 where s.auth_session_id=(auth.jwt()->>'session_id')::uuid and s.user_id=m.user_id and s.status='approved' and a.user_id=m.user_id));
$$;
-- All privileged implementation is private. Public API wrappers are SECURITY INVOKER.
create function private.pastehot_access_dispatch(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid:=auth.uid();v_sid uuid:=(auth.jwt()->>'session_id')::uuid;
 v_member private.pastehot_members;v_current private.pastehot_sessions;
 v_enforced boolean;v_allowed boolean;v_target uuid;v_count integer;v_status text;v_email text;
 v_token text;v_hash text;
 v_sessions jsonb:='[]';v_members jsonb:='[]';v_label text;
begin
 if v_uid is null or v_sid is null or not exists(select 1 from auth.sessions where id=v_sid and user_id=v_uid) then raise exception 'NO_AUTORIZADO';end if;
 select * into v_member from private.pastehot_members where user_id=v_uid;
 if not found or not v_member.enabled then return jsonb_build_object('allowed',false,'status','disabled');end if;
 -- A single locked row serializes approvals and guarantees the limit even with concurrent requests.
 select enforced into v_enforced from private.pastehot_access_config where singleton for update;
 if p_action='state' then
   v_token:=p_args->>'device_token';
   if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'NAVEGADOR_NO_IDENTIFICADO';end if;
   v_hash:=encode(sha256(convert_to(v_token,'UTF8')),'hex');
   v_label:=left(coalesce(nullif(trim(p_args->>'label'),''),(select label from private.pastehot_sessions where user_id=v_uid and token_hash=v_hash),'Mi navegador'),60);
   insert into private.pastehot_sessions(auth_session_id,user_id,token_hash,label,visible) values(v_sid,v_uid,v_hash,v_label,coalesce((p_args->>'visible')::boolean,false))
   on conflict(token_hash) do update set auth_session_id=excluded.auth_session_id,last_seen=now(),visible=excluded.visible,label=excluded.label
   where private.pastehot_sessions.user_id=excluded.user_id;
   if not found then raise exception 'NO_AUTORIZADO';end if;
 elsif p_action='activate' then
   if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
   if not v_enforced then
     if not exists(select 1 from private.pastehot_sessions where auth_session_id=v_sid and user_id=v_uid) then raise exception 'PRIMERO_REGISTRA_EL_NAVEGADOR';end if;
     update private.pastehot_sessions set status='revoked' where auth_session_id is distinct from v_sid;
     update private.pastehot_sessions set status='approved',last_seen=now() where auth_session_id=v_sid and user_id=v_uid;
     update private.pastehot_access_config set enforced=true where singleton;
     v_enforced:=true;
   end if;
 elsif p_action in ('set_session','set_staff','add_staff') then
   if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
   if p_action='set_session' then
     v_target:=(p_args->>'session_id')::uuid;v_status:=p_args->>'status';
     if v_status not in ('approved','revoked') or v_status is null then raise exception 'ESTADO_INVALIDO';end if;
     if exists(select 1 from private.pastehot_sessions where session_id=v_target and auth_session_id=v_sid) then raise exception 'NO_REVOQUES_TU_SESION_ACTUAL';end if;
     if not exists(select 1 from private.pastehot_sessions s join private.pastehot_members m on m.user_id=s.user_id where s.session_id=v_target and m.enabled) then raise exception 'SESION_NO_DISPONIBLE';end if;
     if v_status='approved' then
       select count(*) into v_count from private.pastehot_sessions where status='approved' and session_id<>v_target;
       if v_count>=2 then raise exception 'LIMITE_DE_2_DISPOSITIVOS: revoca uno antes de autorizar otro.';end if;
     end if;
     update private.pastehot_sessions set status=v_status,visible=false where session_id=v_target;
   elsif p_action='set_staff' then
     v_target:=(p_args->>'user_id')::uuid;
     if not exists(select 1 from private.pastehot_members where user_id=v_target and role='staff') then raise exception 'EMPLEADO_NO_ENCONTRADO';end if;
     update private.pastehot_members set enabled=(p_args->>'enabled')::boolean where user_id=v_target;
     update private.pastehot_sessions set status='revoked',visible=false where user_id=v_target;
   else
     if not v_enforced then raise exception 'ACTIVA_LA_PROTECCION_PRIMERO';end if;
     v_email:=lower(trim(p_args->>'email'));v_label:=trim(p_args->>'name');
     if v_label is null or length(v_label) not between 1 and 80 then raise exception 'NOMBRE_INVALIDO';end if;
     select id into v_target from auth.users where lower(email)=v_email;
     if v_target is null then raise exception 'USUARIO_NO_ENCONTRADO';end if;
     if exists(select 1 from private.pastehot_members where user_id=v_target) then raise exception 'EL_ACCESO_YA_EXISTE';end if;
     insert into private.pastehot_members(user_id,role,display_name) values(v_target,'staff',v_label);
   end if;
 else raise exception 'ACCION_INVALIDA';end if;
 select * into v_current from private.pastehot_sessions where auth_session_id=v_sid;
 v_allowed:=private.pastehot_owner_allowed() or private.pastehot_staff_allowed();
 if v_allowed then
   select coalesce(jsonb_agg(jsonb_build_object('session_id',s.session_id,'user_id',s.user_id,'label',s.label,'status',s.status,
     'role',m.role,'display_name',m.display_name,'current',s.auth_session_id=v_sid,
     'online',s.auth_session_id is not null and s.visible and s.last_seen>now()-interval '60 seconds' and s.status='approved') order by s.created_at),'[]'::jsonb)
   into v_sessions from private.pastehot_sessions s join private.pastehot_members m on m.user_id=s.user_id
   where m.enabled and (v_member.role='owner' or s.status='approved');
   if v_member.role='owner' then
     select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'display_name',m.display_name,'enabled',m.enabled,'email',u.email) order by m.display_name),'[]'::jsonb)
     into v_members from private.pastehot_members m join auth.users u on u.id=m.user_id;
   end if;
 end if;
 return jsonb_build_object('allowed',v_allowed,'role',v_member.role,'status',v_current.status,'enforced',v_enforced,'device_id',v_current.session_id,'sessions',v_sessions,'members',v_members);
end;$$;
revoke all on function private.pastehot_access_dispatch(text,jsonb),private.pastehot_owner_allowed(),private.pastehot_staff_allowed() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.pastehot_access_dispatch(text,jsonb),private.pastehot_owner_allowed(),private.pastehot_staff_allowed() to authenticated;

create function public.pastehot_admin_state(p_label text default null,p_visible boolean default false,p_device_token text default null) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('state',jsonb_build_object('label',p_label,'visible',p_visible,'device_token',p_device_token));$$;
create function public.pastehot_activate_security() returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('activate');$$;
create function public.pastehot_set_session(p_session_id uuid,p_status text) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('set_session',jsonb_build_object('session_id',p_session_id,'status',p_status));$$;
create function public.pastehot_set_staff_enabled(p_user_id uuid,p_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('set_staff',jsonb_build_object('user_id',p_user_id,'enabled',p_enabled));$$;
create function public.pastehot_add_staff(p_email text,p_name text) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('add_staff',jsonb_build_object('email',p_email,'name',p_name));$$;
revoke all on function public.pastehot_admin_state(text,boolean,text),public.pastehot_activate_security(),public.pastehot_set_session(uuid,text),public.pastehot_set_staff_enabled(uuid,boolean),public.pastehot_add_staff(text,text) from public,anon;
grant execute on function public.pastehot_admin_state(text,boolean,text),public.pastehot_activate_security(),public.pastehot_set_session(uuid,text),public.pastehot_set_staff_enabled(uuid,boolean),public.pastehot_add_staff(text,text) to authenticated;

-- Existing public browsing/order creation remains unchanged. Owner mutations gain session validation.
alter policy "Authenticated users can manage products" on public.products using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated users can manage categories" on public.categories using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated users can manage customers" on public.customers using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated users can manage order items" on public.order_items using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated admin can manage delivery zones" on public.delivery_zones using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated users can manage settings" on public.settings using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
alter policy "Authenticated users can manage orders" on public.orders using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
create policy "Approved staff can read recent orders" on public.orders for select to authenticated using (
 (select private.pastehot_staff_allowed()) and created_at >= now()-interval '48 hours'
);
alter policy "Authenticated users can delete product images" on storage.objects using (bucket_id='product-images' and (select private.pastehot_owner_allowed()));
alter policy "Authenticated users can update product images" on storage.objects using (bucket_id='product-images' and (select private.pastehot_owner_allowed())) with check (bucket_id='product-images' and (select private.pastehot_owner_allowed()));
alter policy "Authenticated users can upload product images" on storage.objects with check (bucket_id='product-images' and (select private.pastehot_owner_allowed()));

-- Preserve the stock transaction unchanged. Move privileged code into private and validate the caller
-- at each operation, including tokens whose session/member has been revoked.
alter function public.update_order_status_with_inventory(uuid,text) set schema private;
CREATE OR REPLACE FUNCTION private.update_order_status_with_inventory(p_order_id uuid, p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_item record;
  v_product record;
begin
  if not private.pastehot_owner_allowed() then
    if not private.pastehot_staff_allowed() then raise exception 'NO_AUTORIZADO';end if;
    if not exists(select 1 from public.orders where id=p_order_id and created_at >= now()-interval '48 hours') then raise exception 'NO_AUTORIZADO';end if;
  end if;

  if p_new_status not in (
    'pendiente_confirmacion',
    'nuevo',
    'confirmado',
    'preparando',
    'listo',
    'entregado',
    'cancelado'
  ) then
    raise exception 'Estado no válido.';
  end if;

  select id, order_status, items, inventory_applied, inventory_restored
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado.';
  end if;

  if private.pastehot_staff_allowed() and not (
    p_new_status=v_order.order_status or
    (v_order.order_status in ('nuevo','pendiente_confirmacion') and p_new_status='confirmado') or
    (v_order.order_status='confirmado' and p_new_status='preparando') or
    (v_order.order_status='preparando' and p_new_status='listo') or
    (v_order.order_status='listo' and p_new_status='entregado')
  ) then raise exception 'ESTADO_NO_PERMITIDO_PARA_EMPLEADO';end if;
  -- Un pedido pendiente solo puede confirmarse o cancelarse.
  if v_order.order_status = 'pendiente_confirmacion'
     and p_new_status not in ('pendiente_confirmacion','confirmado','cancelado') then
    raise exception 'PEDIDO_PENDIENTE_REQUIERE_CONFIRMACION';
  end if;

  -- Un pedido activo no puede regresar a pendiente.
  if p_new_status = 'pendiente_confirmacion'
     and v_order.order_status <> 'pendiente_confirmacion' then
    raise exception 'NO_SE_PUEDE_REGRESAR_A_PENDIENTE';
  end if;

  -- Cancelar.
  if p_new_status = 'cancelado' then
    if coalesce(v_order.inventory_applied,false)
       and not coalesce(v_order.inventory_restored,false)
       and v_order.order_status <> 'cancelado' then

      for v_item in
        select x.product_id, sum(x.quantity)::integer as quantity
        from jsonb_to_recordset(v_order.items)
          as x(product_id uuid, quantity integer, stock_tracked boolean)
        where coalesce(x.stock_tracked,false)=true
        group by x.product_id
      loop
        update public.products
        set stock = stock + v_item.quantity,
            updated_at = now()
        where id = v_item.product_id;
      end loop;

      update public.orders
      set order_status='cancelado',
          inventory_restored=true
      where id=p_order_id;
    else
      update public.orders
      set order_status='cancelado'
      where id=p_order_id;
    end if;

  -- Mantener pendiente sin tocar inventario.
  elsif p_new_status='pendiente_confirmacion' then
    update public.orders
    set order_status='pendiente_confirmacion'
    where id=p_order_id;

  -- Confirmación inicial o reactivación: aquí sí se aplica inventario.
  elsif p_new_status='confirmado'
        and (
          not coalesce(v_order.inventory_applied,false)
          or coalesce(v_order.inventory_restored,false)
        ) then

    for v_item in
      select x.product_id, sum(x.quantity)::integer as quantity
      from jsonb_to_recordset(v_order.items)
        as x(product_id uuid, quantity integer, stock_tracked boolean)
      where coalesce(x.stock_tracked,false)=true
      group by x.product_id
    loop
      select id,name,stock
      into v_product
      from public.products
      where id=v_item.product_id
      for update;

      if not found then
        raise exception 'Uno de los productos del pedido ya no existe.';
      end if;

      if v_product.stock < v_item.quantity then
        raise exception
          'STOCK_INSUFICIENTE|%|%|%',
          v_product.name,
          v_product.stock,
          v_item.quantity;
      end if;

      update public.products
      set stock=stock-v_item.quantity,
          updated_at=now()
      where id=v_item.product_id;
    end loop;

    update public.orders
    set order_status='confirmado',
        inventory_applied=true,
        inventory_restored=false
    where id=p_order_id;

  -- Reactivar desde cancelado exige volver por confirmado.
  elsif v_order.order_status='cancelado'
        and p_new_status <> 'confirmado' then
    raise exception 'PEDIDO_CANCELADO_REQUIERE_CONFIRMACION';

  -- Pedidos ya confirmados/activos: solo cambia el estado.
  else
    update public.orders
    set order_status=p_new_status
    where id=p_order_id;
  end if;

  return (
    select jsonb_build_object(
      'id',id,
      'order_status',order_status,
      'inventory_applied',inventory_applied,
      'inventory_restored',inventory_restored
    )
    from public.orders
    where id=p_order_id
  );
end;
$function$;

revoke all on function private.update_order_status_with_inventory(uuid,text) from public,anon;
grant execute on function private.update_order_status_with_inventory(uuid,text) to authenticated;
create function public.update_order_status_with_inventory(p_order_id uuid,p_new_status text) returns jsonb
language sql security invoker set search_path='' as $$select private.update_order_status_with_inventory(p_order_id,p_new_status);$$;
revoke all on function public.update_order_status_with_inventory(uuid,text) from public,anon;
grant execute on function public.update_order_status_with_inventory(uuid,text) to authenticated;
alter function public.admin_list_delivery_zones() set schema private;
CREATE OR REPLACE FUNCTION private.admin_list_delivery_zones()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not private.pastehot_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',z.id,
        'name',z.name,
        'fee',z.fee,
        'priority',z.priority,
        'enabled',z.enabled,
        'geojson',case when z.geom is null then null else extensions.st_asgeojson(z.geom)::jsonb end
      )
      order by z.priority,z.name
    ),
    '[]'::jsonb
  )
  into v_result
  from public.delivery_zones z;

  return v_result;
end;
$function$;
revoke all on function private.admin_list_delivery_zones() from public,anon;
grant execute on function private.admin_list_delivery_zones() to authenticated;
alter function public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) set schema private;
CREATE OR REPLACE FUNCTION private.admin_save_delivery_zone(p_id uuid, p_fee numeric, p_enabled boolean, p_geojson jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_geom extensions.geometry;
  v_zone public.delivery_zones%rowtype;
begin
  if not private.pastehot_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;

  if p_fee is null or p_fee < 0 then
    raise exception 'TARIFA_INVALIDA';
  end if;

  if p_geojson is not null then
    v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text),4326);
    if extensions.st_geometrytype(v_geom) not in ('ST_Polygon','ST_MultiPolygon') then
      raise exception 'AREA_INVALIDA';
    end if;
    if not extensions.st_isvalid(v_geom) then
      raise exception 'AREA_INVALIDA';
    end if;
  end if;

  update public.delivery_zones
  set fee=p_fee,
      enabled=coalesce(p_enabled,true),
      geom=v_geom,
      updated_at=now()
  where id=p_id
  returning * into v_zone;

  if not found then raise exception 'ZONA_NO_ENCONTRADA'; end if;

  return jsonb_build_object(
    'id',v_zone.id,
    'name',v_zone.name,
    'fee',v_zone.fee,
    'priority',v_zone.priority,
    'enabled',v_zone.enabled,
    'geojson',case when v_zone.geom is null then null else extensions.st_asgeojson(v_zone.geom)::jsonb end
  );
end;
$function$;
revoke all on function private.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) from public,anon;
grant execute on function private.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) to authenticated;
create function public.admin_list_delivery_zones() returns jsonb language sql security invoker set search_path='' as $$select private.admin_list_delivery_zones();$$;
create function public.admin_save_delivery_zone(p_id uuid,p_fee numeric,p_enabled boolean,p_geojson jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.admin_save_delivery_zone(p_id,p_fee,p_enabled,p_geojson);$$;
revoke all on function public.admin_list_delivery_zones(),public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) from public,anon;
grant execute on function public.admin_list_delivery_zones(),public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) to authenticated;


commit;

