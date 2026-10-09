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
  role text not null check(role in ('owner','manager','staff')), enabled boolean not null default true,
  display_name text not null check(length(display_name) between 1 and 80)
);
create unique index pastehot_one_owner on private.pastehot_members(role) where role='owner';
insert into private.pastehot_members values('a0c0b64b-7809-4428-ad00-a1484d6ded53','owner',true,'Propietario');
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
 where c.enforced and m.user_id=auth.uid() and m.role in ('manager','staff') and m.enabled
 and exists(select 1 from private.pastehot_sessions s join auth.sessions a on a.id=s.auth_session_id
 where s.auth_session_id=(auth.jwt()->>'session_id')::uuid and s.user_id=m.user_id and s.status='approved' and a.user_id=m.user_id));
$$;
create function private.pastehot_manager_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.pastehot_members m,private.pastehot_access_config c
 where c.enforced and m.user_id=auth.uid() and m.role='manager' and m.enabled
 and exists(select 1 from private.pastehot_sessions s join auth.sessions a on a.id=s.auth_session_id
 where s.auth_session_id=(auth.jwt()->>'session_id')::uuid and s.user_id=m.user_id and s.status='approved' and a.user_id=m.user_id));
$$;
-- Managers may clean up replaced product photos, never photos still referenced by the menu.
create function private.pastehot_unused_product_image(p_name text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.pastehot_manager_allowed() or p_name not like 'products/%' then return false;end if;
 return not exists(select 1 from public.products where image_url like '%/product-images/'||p_name)
 and not exists(select 1 from public.settings where key in ('cover_image','profile_image','background_image') and value like '%/product-images/'||p_name);
end;$$;
-- All privileged implementation is private. Public API wrappers are SECURITY INVOKER.
create function private.pastehot_access_dispatch(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb
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
 elsif p_action in ('set_session','set_staff','set_role','add_staff') then
   if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
   if p_action='set_session' then
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
revoke all on function private.pastehot_access_dispatch(text,jsonb),private.pastehot_owner_allowed(),private.pastehot_staff_allowed(),private.pastehot_manager_allowed(),private.pastehot_unused_product_image(text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.pastehot_access_dispatch(text,jsonb),private.pastehot_owner_allowed(),private.pastehot_staff_allowed(),private.pastehot_manager_allowed(),private.pastehot_unused_product_image(text) to authenticated;

create function public.pastehot_admin_state(p_label text default null,p_visible boolean default false,p_device_token text default null) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('state',jsonb_build_object('label',p_label,'visible',p_visible,'device_token',p_device_token));$$;
create function public.pastehot_activate_security() returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('activate');$$;
create function public.pastehot_set_session(p_session_id uuid,p_status text) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('set_session',jsonb_build_object('session_id',p_session_id,'status',p_status));$$;
create function public.pastehot_set_staff_enabled(p_user_id uuid,p_enabled boolean) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('set_staff',jsonb_build_object('user_id',p_user_id,'enabled',p_enabled));$$;
create function public.pastehot_add_staff(p_email text,p_name text,p_role text default 'staff') returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('add_staff',jsonb_build_object('email',p_email,'name',p_name,'role',p_role));$$;
create function public.pastehot_set_staff_role(p_user_id uuid,p_role text) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_access_dispatch('set_role',jsonb_build_object('user_id',p_user_id,'role',p_role));$$;
revoke all on function public.pastehot_admin_state(text,boolean,text),public.pastehot_activate_security(),public.pastehot_set_session(uuid,text),public.pastehot_set_staff_enabled(uuid,boolean),public.pastehot_add_staff(text,text,text),public.pastehot_set_staff_role(uuid,text) from public,anon;
grant execute on function public.pastehot_admin_state(text,boolean,text),public.pastehot_activate_security(),public.pastehot_set_session(uuid,text),public.pastehot_set_staff_enabled(uuid,boolean),public.pastehot_add_staff(text,text,text),public.pastehot_set_staff_role(uuid,text) to authenticated;

-- Existing public browsing/order creation remains unchanged. Owner mutations gain session validation.
alter policy "Authenticated users can manage products" on public.products using ((select private.pastehot_owner_allowed())) with check ((select private.pastehot_owner_allowed()));
create policy "Approved managers can add products" on public.products for insert to authenticated with check ((select private.pastehot_manager_allowed()));
create policy "Approved managers can edit products" on public.products for update to authenticated using ((select private.pastehot_manager_allowed())) with check ((select private.pastehot_manager_allowed()));
create policy "Approved managers can read category order" on public.settings for select to authenticated using (key='categories' and (select private.pastehot_manager_allowed()));
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

create policy "Approved managers can upload product photos" on storage.objects for insert to authenticated with check (bucket_id='product-images' and name like 'products/%' and (select private.pastehot_manager_allowed()));
create policy "Approved managers can clean unused product photos" on storage.objects for delete to authenticated using (bucket_id='product-images' and private.pastehot_unused_product_image(name));

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


-- The public menu uses create_pending_order_with_location_v2. Retire the obsolete endpoint
-- that could apply inventory without owner confirmation (including access by anonymous callers).
revoke all on function public.create_order_with_inventory(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
-- Emergency closure uses the same setting as the customer menu. State and audit are one transaction.
create table private.pastehot_store_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default clock_timestamp(),
  closed boolean not null,
  actor_id uuid not null, actor_name text not null, actor_role text not null,
  session_label text not null, reason text not null check(length(reason) between 5 and 240),
  during_hours boolean not null, schedule_snapshot jsonb not null
);
create index pastehot_store_events_time on private.pastehot_store_events(created_at desc,id desc);
alter table private.pastehot_store_events enable row level security;
revoke all on private.pastehot_store_events from public,anon,authenticated;

create function private.pastehot_store_snapshot() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_settings jsonb;v_week jsonb;v_day text;v_today jsonb;v_time timestamp:=now() at time zone 'America/Merida';
 v_open text;v_close text;v_minutes integer;v_start integer;v_end integer;v_scheduled boolean:=false;v_closed boolean;
begin
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_settings from public.settings
 where key in ('store_manual_closed','weekly_schedule','opening_time','closing_time');
 v_day:=(array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from v_time)::integer+1];
 begin v_week:=(v_settings->>'weekly_schedule')::jsonb;exception when others then v_week:=null;end;
 if jsonb_typeof(v_week)='object' then v_today:=coalesce(v_week->v_day,'{}');
 else v_today:=jsonb_build_object('enabled',v_day<>'sun','open',coalesce(v_settings->>'opening_time','12:00'),'close',coalesce(v_settings->>'closing_time','21:00'));end if;
 v_open:=v_today->>'open';v_close:=v_today->>'close';
 if coalesce(v_today->>'enabled','false')='true' and v_open ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and v_close ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   v_minutes:=extract(hour from v_time)::integer*60+extract(minute from v_time)::integer;
   v_start:=split_part(v_open,':',1)::integer*60+split_part(v_open,':',2)::integer;
   v_end:=split_part(v_close,':',1)::integer*60+split_part(v_close,':',2)::integer;
   v_scheduled:=case when v_start=v_end then true when v_end>v_start then v_minutes>=v_start and v_minutes<v_end else v_minutes>=v_start or v_minutes<v_end end;
 end if;
 v_closed:=coalesce(v_settings->>'store_manual_closed','false')='true';
 return jsonb_build_object('manual_closed',v_closed,'scheduled_open',v_scheduled,'open',not v_closed and v_scheduled,'schedule',jsonb_build_object('timezone','America/Merida','day',v_day,'hours',v_today));
end;$$;
revoke all on function private.pastehot_store_snapshot() from public,anon,authenticated;

create function private.pastehot_store_dispatch(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_closed boolean;v_requested boolean;v_expected boolean;v_reason text;v_public text;
 v_member private.pastehot_members;v_label text;v_day date;v_offset integer;v_only boolean;v_rows jsonb;
begin
 -- Serialize closures, order insertion and revocation. Identity/time are never supplied by the caller.
 if p_action='set' then perform 1 from private.pastehot_access_config where singleton for update;end if;
 if not (private.pastehot_owner_allowed() or private.pastehot_staff_allowed()) then raise exception 'NO_AUTORIZADO';end if;
 v_state:=private.pastehot_store_snapshot();
 if p_action='set' then
   v_requested:=(p_args->>'closed')::boolean;v_expected:=(p_args->>'expected_closed')::boolean;
   if v_requested is null or v_expected is null then raise exception 'ESTADO_INVALIDO';end if;
   v_closed:=(v_state->>'manual_closed')::boolean;
   if v_expected<>v_closed then raise exception 'ESTADO_CAMBIO: otra persona modificó la tienda. Actualiza antes de continuar.';end if;
   if v_closed=v_requested then
     if private.pastehot_owner_allowed() and p_args->>'public_reason' is not null then
       insert into public.settings(key,value) values('store_manual_close_reason',left(trim(p_args->>'public_reason'),160))
       on conflict(key) do update set value=excluded.value,updated_at=now();
     end if;
     return v_state||jsonb_build_object('changed',false);
   end if;
   v_reason:=trim(p_args->>'reason');
   if v_reason is null or length(v_reason) not between 5 and 240 then raise exception 'MOTIVO_REQUERIDO: escribe entre 5 y 240 caracteres.';end if;
   select * into v_member from private.pastehot_members where user_id=auth.uid();
   select label into v_label from private.pastehot_sessions where user_id=auth.uid() and auth_session_id=(auth.jwt()->>'session_id')::uuid;
   v_public:=case when v_requested then 'Cerrado temporalmente. Gracias por tu comprensión.' else '' end;
   if v_member.role='owner' and p_args->>'public_reason' is not null then v_public:=left(trim(p_args->>'public_reason'),160);end if;
   insert into public.settings(key,value) values('store_manual_closed',v_requested::text),('store_manual_close_reason',v_public)
   on conflict(key) do update set value=excluded.value,updated_at=now();
   insert into private.pastehot_store_events(closed,actor_id,actor_name,actor_role,session_label,reason,during_hours,schedule_snapshot)
   values(v_requested,v_member.user_id,v_member.display_name,v_member.role,coalesce(v_label,'Mi navegador'),v_reason,(v_state->>'scheduled_open')::boolean,v_state->'schedule');
   v_state:=private.pastehot_store_snapshot()||jsonb_build_object('changed',true);
 elsif p_action='history' then
   if not (private.pastehot_owner_allowed() or private.pastehot_manager_allowed()) then raise exception 'NO_AUTORIZADO';end if;
   v_day:=(p_args->>'day')::date;v_offset:=greatest(0,least(coalesce((p_args->>'offset')::integer,0),1000000));v_only:=coalesce((p_args->>'only_during_hours')::boolean,false);
   select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into v_rows from (
     select id,created_at,closed,actor_name,actor_role,session_label,reason,during_hours from private.pastehot_store_events
     where (v_day is null or (created_at>=v_day::timestamp at time zone 'America/Merida' and created_at<(v_day+1)::timestamp at time zone 'America/Merida'))
       and (not v_only or during_hours)
     order by created_at desc,id desc offset v_offset limit 51
   ) e;
   return jsonb_build_object('events',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
 elsif p_action<>'state' then raise exception 'ACCION_INVALIDA';end if;
 return v_state||jsonb_build_object('history_allowed',private.pastehot_owner_allowed() or private.pastehot_manager_allowed(),'last_event_id',(select coalesce(max(id),0) from private.pastehot_store_events));
end;$$;
revoke all on function private.pastehot_store_dispatch(text,jsonb) from public,anon;
grant execute on function private.pastehot_store_dispatch(text,jsonb) to authenticated;
create function public.pastehot_store_state() returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_store_dispatch('state');$$;
create function public.pastehot_set_store_closed(p_closed boolean,p_reason text,p_expected_closed boolean,p_public_reason text default null) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_store_dispatch('set',jsonb_build_object('closed',p_closed,'reason',p_reason,'expected_closed',p_expected_closed,'public_reason',p_public_reason));$$;
create function public.pastehot_store_history(p_day date default null,p_offset integer default 0,p_only_during_hours boolean default false) returns jsonb language sql security invoker set search_path='' as $$select private.pastehot_store_dispatch('history',jsonb_build_object('day',p_day,'offset',p_offset,'only_during_hours',p_only_during_hours));$$;
revoke all on function public.pastehot_store_state(),public.pastehot_set_store_closed(boolean,text,boolean,text),public.pastehot_store_history(date,integer,boolean) from public,anon;
grant execute on function public.pastehot_store_state(),public.pastehot_set_store_closed(boolean,text,boolean,text),public.pastehot_store_history(date,integer,boolean) to authenticated;

-- Even the owner's browser must use the audited RPC for these two settings.
alter policy "Authenticated users can manage settings" on public.settings
 using (key not in ('store_manual_closed','store_manual_close_reason') and (select private.pastehot_owner_allowed()))
 with check (key not in ('store_manual_closed','store_manual_close_reason') and (select private.pastehot_owner_allowed()));
create policy "Approved team can read manual state" on public.settings for select to authenticated using (
 key in ('store_manual_closed','store_manual_close_reason') and ((select private.pastehot_owner_allowed()) or (select private.pastehot_staff_allowed()))
);

-- A customer with an old open menu cannot submit a new pending order after closure commits.
create function private.pastehot_reject_closed_store_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from private.pastehot_access_config where singleton for share;
 if new.order_status in ('nuevo','pendiente_confirmacion') and exists(select 1 from public.settings where key='store_manual_closed' and value='true') then
   raise exception 'TIENDA_CERRADA: la tienda está cerrada temporalmente. Intenta cuando vuelva a abrir.';
 end if;
 return new;
end;$$;
revoke all on function private.pastehot_reject_closed_store_order() from public,anon,authenticated;
create trigger pastehot_check_store_before_order before insert on public.orders for each row execute function private.pastehot_reject_closed_store_order();

-- On-demand summaries: no stored reports, no cron, no full-history transfer.
create index if not exists pastehot_orders_created_id_idx on public.orders(created_at desc,id desc);
create or replace function public.pastehot_order_page(p_from timestamptz default null,p_search text default '',p_before_time timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_rows jsonb;v_q text:=regexp_replace(lower(coalesce(p_search,'')),'[[:space:]-]','','g');
begin
 if not (private.pastehot_owner_allowed() or private.pastehot_staff_allowed()) then raise exception 'NO_AUTORIZADO';end if;
 if length(v_q)>80 or (p_before_time is not null and p_before_id is null) then raise exception 'BUSQUEDA_INVALIDA';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into v_rows from (
 select o.* from public.orders o where (p_from is null or o.created_at>=p_from)
 and (v_q='' or position(v_q in regexp_replace(lower(coalesce(o.order_code,'')),'[[:space:]-]','','g'))>0 or position(v_q in replace(o.id::text,'-',''))>0)
 and (p_before_time is null or (o.created_at,o.id)<(p_before_time,p_before_id))
 order by o.created_at desc,o.id desc limit 51)t;
 return jsonb_build_object('rows',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
end $$;
create function public.pastehot_sales_summary(p_from timestamptz default null,p_to timestamptz default now(),p_customers boolean default false,p_customer_offset integer default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO';end if;
 if p_to is null or (p_from is not null and p_from>=p_to) or p_customer_offset<0 then raise exception 'PERIODO_INVALIDO';end if;
 with valid as materialized(select * from public.orders where order_status not in ('cancelado','pendiente_confirmacion') and created_at<p_to),
 selected as materialized(select * from valid where p_from is null or created_at>=p_from),
 entries as(select coalesce(p.id::text,nullif(i->>'product_id',''),nullif(i->>'id',''),i->>'name','Producto histórico') as key,
 coalesce(p.name,i->>'name','Producto histórico') as name,coalesce(p.category,i->>'category','') as category,
 case when i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'quantity')::numeric else 0 end as quantity,
 case when i->>'subtotal' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'subtotal')::numeric
 when i->>'price' ~ '^[0-9]+([.][0-9]+)?$' and i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'price')::numeric*(i->>'quantity')::numeric else 0 end as amount
 from selected o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end)i
 left join lateral(select p.* from public.products p where p.id::text=coalesce(nullif(i->>'product_id',''),i->>'id') or (coalesce(nullif(i->>'product_id',''),nullif(i->>'id','')) is null and p.name=i->>'name') order by p.id limit 1)p on true),
 paste_entries as(select * from entries where category !~* 'bebida|refresco|agua|café|cafe|jugo'),
 seeds as(select id::text as key,name,0::numeric as quantity,0::numeric as amount from public.products where coalesce(category,'') !~* 'bebida|refresco|agua|café|cafe|jugo'),
 ranked as(select key,min(name) as name,sum(quantity) as quantity,sum(amount) as amount from (select * from seeds union all select key,name,quantity,amount from paste_entries)t group by key),
 daily as(select (created_at at time zone 'America/Merida')::date::text as day,sum(total) as amount from selected group by 1),
 customer_history as(select regexp_replace(customer_phone,'[^0-9]','','g') as phone,min(created_at) as first_ever from valid group by 1),
 customer_rows as(select regexp_replace(o.customer_phone,'[^0-9]','','g') as phone,(array_agg(o.customer_name order by o.created_at desc,o.id desc))[1] as name,count(*) as count,sum(o.total) as total,min(o.created_at) as first,max(o.created_at) as last,
 case when p_from is null then count(*)>1 else min(h.first_ever)<p_from end as recurrent
 from selected o join customer_history h on h.phone=regexp_replace(o.customer_phone,'[^0-9]','','g') where coalesce(h.phone,'')<>'' group by 1),
 customer_page as(select * from customer_rows order by last desc,phone offset p_customer_offset limit 51)
 select jsonb_build_object('generated_at',now(),'from',coalesce(p_from,(select min(created_at) from valid)),'to',p_to,
 'orders',(select count(*) from selected),'total',coalesce((select sum(total) from selected),0),'subtotal',coalesce((select sum(subtotal) from selected),0),
 'pastes',coalesce((select jsonb_agg(to_jsonb(r) order by quantity desc,name,key) from ranked r),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb),
 'customers',case when p_customers then coalesce((select jsonb_agg(to_jsonb(c) order by last desc,phone) from customer_page c),'[]'::jsonb) else '[]'::jsonb end,
 'customer_count',case when p_customers then (select count(*) from customer_rows) else 0 end,
 'recurrent_count',case when p_customers then (select count(*) from customer_rows where recurrent) else 0 end,
 'customer_total',case when p_customers then coalesce((select sum(total) from customer_rows),0) else 0 end) into v_result;
 return v_result;
end $$;
revoke all on function public.pastehot_order_page(timestamptz,text,timestamptz,uuid),public.pastehot_sales_summary(timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.pastehot_order_page(timestamptz,text,timestamptz,uuid),public.pastehot_sales_summary(timestamptz,timestamptz,boolean,integer) to authenticated;

commit;

