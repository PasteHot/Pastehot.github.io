BEGIN;
-- Branch-scope privileged functions and checkout operations.
DROP FUNCTION IF EXISTS public.admin_list_delivery_zones();
DROP FUNCTION IF EXISTS private.admin_list_delivery_zones();
CREATE FUNCTION private.admin_list_delivery_zones(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then
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
  from public.delivery_zones z where z.store_id=p_store_id;

  return v_result;
end;
$function$


DROP FUNCTION IF EXISTS public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
DROP FUNCTION IF EXISTS private.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
CREATE FUNCTION private.admin_save_delivery_zone(p_store_id uuid,p_id uuid, p_fee numeric, p_enabled boolean, p_geojson jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_geom extensions.geometry;
  v_zone public.delivery_zones%rowtype;
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then
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
  where id=p_id and store_id=p_store_id
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
$function$


DROP FUNCTION IF EXISTS public.pastehot_add_category(text);
DROP FUNCTION IF EXISTS private.pastehot_add_category(text);
CREATE FUNCTION private.pastehot_add_category(p_store_id uuid,p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text:=trim(coalesce(p_name,''));
  v_value text;
  v_categories jsonb;
begin
  if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id)) then
    raise exception 'NO_AUTORIZADO';
  end if;
  if length(v_name) not between 1 and 80 then raise exception 'Usa un nombre de categoría de 1 a 80 caracteres.'; end if;
  select value into v_value from public.settings where store_id=p_store_id and key='categories' limit 1 for update;
  if v_value is null then raise exception 'No se encontró la lista actual de categorías.'; end if;
  v_categories:=v_value::jsonb;
  if jsonb_typeof(v_categories)<>'array' then raise exception 'La lista actual de categorías no es válida.'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_categories) e(value) where lower(e.value)=lower(v_name)) then
    raise exception 'Esa categoría ya existe.';
  end if;
  v_categories:=v_categories||jsonb_build_array(v_name);
  update public.settings set value=v_categories::text,updated_at=now() where store_id=p_store_id and key='categories';
  return v_categories;
end;
$function$


CREATE OR REPLACE FUNCTION private.pastehot_reject_closed_store_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from private.pastehot_access_config where singleton for share;
 if new.order_status in ('nuevo','pendiente_confirmacion') and exists(select 1 from public.settings where store_id=new.store_id and key='store_manual_closed' and value='true') then
   raise exception 'TIENDA_CERRADA: la tienda está cerrada temporalmente. Intenta cuando vuelva a abrir.';
 end if;
 return new;
end;$function$


CREATE OR REPLACE FUNCTION private.pastehot_staff_schedule_allowed()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raw text;
  v_schedule jsonb;
  v_now timestamp := now() at time zone 'America/Merida';
  v_day date;
  v_key text;
  v_entry jsonb;
  v_open time;
  v_close time;
  v_start timestamp;
  v_end timestamp;
begin
  select value into v_raw from public.settings where store_id=private.pastehot_request_store_id() and key='weekly_schedule' limit 1;
  if v_raw is null then return false; end if;
  begin v_schedule:=v_raw::jsonb; exception when others then return false; end;
  if jsonb_typeof(v_schedule)<>'object' then return false; end if;
  for v_day in select (v_now::date - n)::date from generate_series(0,1) n loop
    v_key:=case extract(dow from v_day)::integer
      when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
      when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' end;
    v_entry:=v_schedule->v_key;
    if jsonb_typeof(v_entry)='object' and v_entry->>'enabled'='true'
       and coalesce(v_entry->>'open','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and coalesce(v_entry->>'close','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_open:=(v_entry->>'open')::time;
      v_close:=(v_entry->>'close')::time;
      v_start:=v_day+v_open-interval '30 minutes';
      v_end:=v_day+v_close;
      if v_close<=v_open then v_end:=v_end+interval '1 day'; end if;
      if v_now>=v_start and v_now<v_end then return true; end if;
    end if;
  end loop;
  return false;
end $function$


DROP FUNCTION IF EXISTS public.pastehot_store_state();
DROP FUNCTION IF EXISTS public.pastehot_set_store_closed(boolean,text,boolean,text);
DROP FUNCTION IF EXISTS public.pastehot_store_history(date,integer,boolean);
DROP FUNCTION IF EXISTS private.pastehot_store_dispatch(text,jsonb);
CREATE FUNCTION private.pastehot_store_dispatch(p_store_id uuid,p_action text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_state jsonb;v_closed boolean;v_requested boolean;v_expected boolean;v_reason text;v_public text;
 v_member private.pastehot_members;v_label text;v_day date;v_offset integer;v_only boolean;v_rows jsonb;
begin
 -- Serialize closures, order insertion and revocation. Identity/time are never supplied by the caller.
 if p_action='set' then perform 1 from private.pastehot_access_config where singleton for update;end if;
 if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_access_allowed(p_store_id)) then raise exception 'NO_AUTORIZADO';end if;
 v_state:=private.pastehot_store_snapshot(p_store_id);
 if p_action='set' then
   v_requested:=(p_args->>'closed')::boolean;v_expected:=(p_args->>'expected_closed')::boolean;
   if v_requested is null or v_expected is null then raise exception 'ESTADO_INVALIDO';end if;
   v_closed:=(v_state->>'manual_closed')::boolean;
   if v_expected<>v_closed then raise exception 'ESTADO_CAMBIO: otra persona modificó la tienda. Actualiza antes de continuar.';end if;
   if v_closed=v_requested then
     if private.pastehot_store_owner_allowed(p_store_id) and p_args->>'public_reason' is not null then
       insert into public.settings(store_id,key,value) values(p_store_id,'store_manual_close_reason',left(trim(p_args->>'public_reason'),160))
       on conflict(store_id,key) do update set value=excluded.value,updated_at=now();
     end if;
     return v_state||jsonb_build_object('changed',false);
   end if;
   v_reason:=trim(p_args->>'reason');
   if v_reason is null or length(v_reason) not between 5 and 240 then raise exception 'MOTIVO_REQUERIDO: escribe entre 5 y 240 caracteres.';end if;
   select * into v_member from private.pastehot_members where user_id=auth.uid();
   select label into v_label from private.pastehot_sessions where user_id=auth.uid() and auth_session_id=(auth.jwt()->>'session_id')::uuid;
   -- Keep the proprietor's saved public message for closures from every role.
   -- Only an owner can edit the saved message; reopening does not erase it.
   select nullif(trim(value),'') into v_public from public.settings where store_id=p_store_id and key='store_manual_close_reason';
   if v_member.role='owner' and p_args->>'public_reason' is not null then v_public:=left(trim(p_args->>'public_reason'),160);end if;
   if v_requested then v_public:=coalesce(nullif(trim(v_public),''),'En unos instantes volveremos a recibir pedidos.');else v_public:=coalesce(v_public,'');end if;
   insert into public.settings(store_id,key,value) values(p_store_id,'store_manual_closed',v_requested::text),(p_store_id,'store_manual_close_reason',v_public)
   on conflict(store_id,key) do update set value=excluded.value,updated_at=now();
   insert into private.pastehot_store_events(store_id,closed,actor_id,actor_name,actor_role,session_label,reason,during_hours,schedule_snapshot)
   values(p_store_id,v_requested,v_member.user_id,v_member.display_name,v_member.role,coalesce(v_label,'Mi navegador'),v_reason,(v_state->>'scheduled_open')::boolean,v_state->'schedule');
   v_state:=private.pastehot_store_snapshot(p_store_id)||jsonb_build_object('changed',true);
 elsif p_action='history' then
   if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id)) then raise exception 'NO_AUTORIZADO';end if;
   v_day:=(p_args->>'day')::date;v_offset:=greatest(0,least(coalesce((p_args->>'offset')::integer,0),1000000));v_only:=coalesce((p_args->>'only_during_hours')::boolean,false);
   select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into v_rows from (
     select id,created_at,closed,actor_name,actor_role,session_label,reason,during_hours from private.pastehot_store_events
     where store_id=p_store_id and (v_day is null or (created_at>=v_day::timestamp at time zone 'America/Merida' and created_at<(v_day+1)::timestamp at time zone 'America/Merida'))
       and (not v_only or during_hours)
     order by created_at desc,id desc offset v_offset limit 51
   ) e;
   return jsonb_build_object('events',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
 elsif p_action<>'state' then raise exception 'ACCION_INVALIDA';end if;
 return v_state||jsonb_build_object('history_allowed',private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id),'last_event_id',(select coalesce(max(id),0) from private.pastehot_store_events where store_id=p_store_id));
end;$function$


DROP FUNCTION IF EXISTS private.pastehot_store_snapshot();
CREATE FUNCTION private.pastehot_store_snapshot(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_settings jsonb;v_week jsonb;v_day text;v_today jsonb;v_time timestamp:=now() at time zone 'America/Merida';
 v_open text;v_close text;v_minutes integer;v_start integer;v_end integer;v_scheduled boolean:=false;v_closed boolean;
begin
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_settings from public.settings
 where store_id=p_store_id and key in ('store_manual_closed','weekly_schedule','opening_time','closing_time');
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
end;$function$


DROP FUNCTION IF EXISTS public.create_pending_order_with_location_v3(text,text,text,text,text,text,text,jsonb,double precision,double precision,double precision,text,text,text,text,text,text,text);
CREATE FUNCTION public.create_pending_order_with_location_v3(p_store_id uuid,p_order_code text, p_customer_name text, p_customer_phone text, p_delivery_type text, p_address text, p_payment_method text, p_notes text, p_items jsonb, p_delivery_lat double precision DEFAULT NULL::double precision, p_delivery_lng double precision DEFAULT NULL::double precision, p_delivery_accuracy_m double precision DEFAULT NULL::double precision, p_delivery_address_text text DEFAULT NULL::text, p_delivery_geocoded_address text DEFAULT NULL::text, p_delivery_reference text DEFAULT NULL::text, p_delivery_locality text DEFAULT NULL::text, p_delivery_region text DEFAULT NULL::text, p_delivery_postcode text DEFAULT NULL::text, p_delivery_country_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store_id uuid := p_store_id;
  v_item record;
  v_product record;
  v_items_final jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_delivery_base_fee numeric := 0;
  v_rain_enabled boolean := false;
  v_rain_amount numeric := 0;
  v_total numeric := 0;
  v_order_id uuid;
  v_inside boolean := false;
  v_zone public.delivery_zones%rowtype;
  v_address_edited boolean := false;
  v_delivery_code text := null;
  v_attempt integer;
begin
  if v_store_id is null or not exists(select 1 from public.stores s where s.id=v_store_id and s.is_active) then raise exception 'SUCURSAL_NO_DISPONIBLE'; end if;
  if coalesce(trim(p_customer_name),'')='' then raise exception 'Escribe el nombre del cliente.'; end if;
  if coalesce(trim(p_customer_phone),'')='' then raise exception 'Escribe el teléfono del cliente.'; end if;
  if p_delivery_type not in ('delivery','pickup') then raise exception 'Modalidad de entrega no válida.'; end if;
  if p_payment_method not in ('cash','transfer') then raise exception 'Método de pago no válido.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'El pedido no contiene productos.';
  end if;

  if p_delivery_type='delivery' then
    if p_delivery_lat is null or p_delivery_lng is null or p_delivery_accuracy_m is null then
      raise exception 'UBICACION_REQUERIDA';
    end if;
    if p_delivery_accuracy_m <= 0 or p_delivery_accuracy_m > 150 then
      raise exception 'UBICACION_IMPRECISA|%', round(coalesce(p_delivery_accuracy_m,0)::numeric,0);
    end if;

    select exists(
      select 1
      from private.delivery_service_areas a
      where a.area_key='yucatan_state'
        and extensions.st_covers(
          a.geom,
          extensions.st_setsrid(extensions.st_makepoint(p_delivery_lng,p_delivery_lat),4326)
        )
    ) into v_inside;
    if not v_inside then raise exception 'UBICACION_FUERA_DE_YUCATAN'; end if;

    select z.*
    into v_zone
    from public.delivery_zones z
    where z.store_id=v_store_id and z.enabled=true
      and z.geom is not null
      and extensions.st_covers(
        z.geom,
        extensions.st_setsrid(extensions.st_makepoint(p_delivery_lng,p_delivery_lat),4326)
      )
    order by z.priority,z.name
    limit 1;
    if not found then raise exception 'FUERA_DE_ZONA_DE_REPARTO'; end if;

    if coalesce(trim(p_delivery_address_text),'')='' then raise exception 'DIRECCION_CONFIRMADA_REQUERIDA'; end if;
    if coalesce(trim(p_delivery_reference),'')='' then raise exception 'REFERENCIA_ENTREGA_REQUERIDA'; end if;

    v_address_edited :=
      coalesce(trim(p_delivery_geocoded_address),'') <> ''
      and lower(trim(p_delivery_geocoded_address)) <> lower(trim(p_delivery_address_text));

    v_delivery_base_fee := coalesce(v_zone.fee,0);

    select
      coalesce(bool_or(case when key='rain_surcharge_enabled'
        then lower(trim(value)) in ('true','1','yes','on') else false end),false),
      coalesce(max(case when key='rain_surcharge_amount'
        then case when trim(value) ~ '^[0-9]+([.][0-9]+)?$' then trim(value)::numeric else 10 end end),10)
    into v_rain_enabled,v_rain_amount
    from public.settings
    where store_id=v_store_id and key in ('rain_surcharge_enabled','rain_surcharge_amount');

    if not v_rain_enabled then v_rain_amount := 0; end if;
    v_delivery_fee := v_delivery_base_fee + coalesce(v_rain_amount,0);

    for v_attempt in 1..20 loop
      v_delivery_code :=
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1)
        || lpad(floor(random()*1000)::int::text,3,'0');

      exit when not exists(
        select 1
        from public.orders
        where store_id=v_store_id and delivery_verification_code=v_delivery_code
          and order_status not in ('entregado','cancelado')
      );
    end loop;

    if exists(
      select 1
      from public.orders
      where delivery_verification_code=v_delivery_code
        and order_status not in ('entregado','cancelado')
    ) then
      raise exception 'CODIGO_ENTREGA_NO_DISPONIBLE';
    end if;
  end if;

  for v_item in
    select x.product_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity integer)
    group by x.product_id
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity<=0 then
      raise exception 'Cantidad de producto no válida.';
    end if;

    select id,name,price,available,track_stock,stock
    into v_product
    from public.products
    where id=v_item.product_id and store_id=v_store_id;

    if not found then raise exception 'Uno de los productos ya no existe.'; end if;
    if not coalesce(v_product.available,false) then raise exception 'El producto "%" no está disponible.', v_product.name; end if;
    if coalesce(v_product.track_stock,false) and v_product.stock < v_item.quantity then
      raise exception 'STOCK_INSUFICIENTE|%|%|%', v_product.name, v_product.stock, v_item.quantity;
    end if;

    v_subtotal := v_subtotal + (coalesce(v_product.price,0)*v_item.quantity);
    v_items_final := v_items_final || jsonb_build_array(
      jsonb_build_object(
        'product_id',v_product.id,'name',v_product.name,'price',v_product.price,
        'quantity',v_item.quantity,'subtotal',coalesce(v_product.price,0)*v_item.quantity,
        'stock_tracked',coalesce(v_product.track_stock,false)
      )
    );
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  insert into public.orders(
    store_id,order_code,customer_name,customer_phone,delivery_type,address,payment_method,notes,
    items,subtotal,delivery_fee,total,order_status,inventory_applied,inventory_restored,
    delivery_lat,delivery_lng,delivery_accuracy_m,delivery_address_text,delivery_geocoded_address,
    delivery_reference,delivery_address_edited,delivery_address_confirmed_at,delivery_locality,
    delivery_region,delivery_postcode,delivery_country_code,delivery_location_verified,
    delivery_location_captured_at,delivery_location_consent_at,delivery_zone_id,delivery_zone_name,
    delivery_base_fee,delivery_rain_surcharge,delivery_verification_code
  )
  values(
    v_store_id,p_order_code,trim(p_customer_name),trim(p_customer_phone),p_delivery_type,
    case when p_delivery_type='delivery' then trim(p_delivery_address_text) else '' end,
    p_payment_method,p_notes,v_items_final,v_subtotal,v_delivery_fee,v_total,
    'pendiente_confirmacion',false,false,
    case when p_delivery_type='delivery' then p_delivery_lat else null end,
    case when p_delivery_type='delivery' then p_delivery_lng else null end,
    case when p_delivery_type='delivery' then p_delivery_accuracy_m else null end,
    case when p_delivery_type='delivery' then trim(p_delivery_address_text) else null end,
    case when p_delivery_type='delivery' then nullif(trim(p_delivery_geocoded_address),'') else null end,
    case when p_delivery_type='delivery' then trim(p_delivery_reference) else null end,
    case when p_delivery_type='delivery' then v_address_edited else false end,
    case when p_delivery_type='delivery' then now() else null end,
    case when p_delivery_type='delivery' then nullif(trim(p_delivery_locality),'') else null end,
    case when p_delivery_type='delivery' then 'Yucatán' else null end,
    case when p_delivery_type='delivery' then nullif(trim(p_delivery_postcode),'') else null end,
    case when p_delivery_type='delivery' then 'MX' else null end,
    case when p_delivery_type='delivery' then true else false end,
    case when p_delivery_type='delivery' then now() else null end,
    case when p_delivery_type='delivery' then now() else null end,
    case when p_delivery_type='delivery' then v_zone.id else null end,
    case when p_delivery_type='delivery' then v_zone.name else null end,
    case when p_delivery_type='delivery' then v_delivery_base_fee else null end,
    case when p_delivery_type='delivery' then v_rain_amount else 0 end,
    case when p_delivery_type='delivery' then v_delivery_code else null end
  )
  returning id into v_order_id;

  return jsonb_build_object(
    'id',v_order_id,'order_code',p_order_code,'order_status','pendiente_confirmacion',
    'items',v_items_final,'subtotal',v_subtotal,
    'delivery_fee',v_delivery_fee,'delivery_base_fee',v_delivery_base_fee,
    'delivery_rain_surcharge',v_rain_amount,'total',v_total,
    'inventory_applied',false,
    'delivery_location_verified',case when p_delivery_type='delivery' then true else false end,
    'delivery_zone_id',case when p_delivery_type='delivery' then v_zone.id else null end,
    'delivery_zone_name',case when p_delivery_type='delivery' then v_zone.name else null end,
    'delivery_address_edited',case when p_delivery_type='delivery' then v_address_edited else false end,
    'delivery_verification_code',case when p_delivery_type='delivery' then v_delivery_code else null end
  );
end;
$function$


DROP FUNCTION IF EXISTS public.validate_delivery_location(double precision,double precision,double precision);
CREATE FUNCTION public.validate_delivery_location(p_store_id uuid,p_lat double precision, p_lng double precision, p_accuracy_m double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inside_yucatan boolean := false;
  v_zone record;
  v_configured_count integer := 0;
  v_rain_enabled boolean := false;
  v_rain_amount numeric := 0;
  v_rain_message text := '';
  v_effective_fee numeric := 0;
  v_store_id uuid := p_store_id;
begin
  if v_store_id is null or not exists(select 1 from public.stores s where s.id=v_store_id and s.is_active) then
    return jsonb_build_object('ok',false,'code','SUCURSAL_NO_DISPONIBLE','inside_yucatan',false);
  end if;

  if p_lat is null or p_lng is null or p_accuracy_m is null then
    return jsonb_build_object('ok',false,'code','UBICACION_REQUERIDA','inside_yucatan',false);
  end if;

  if p_accuracy_m <= 0 or p_accuracy_m > 150 then
    return jsonb_build_object(
      'ok',false,'code','UBICACION_IMPRECISA','inside_yucatan',false,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select exists(
    select 1
    from private.delivery_service_areas a
    where a.area_key='yucatan_state'
      and extensions.st_covers(a.geom,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326))
  ) into v_inside_yucatan;

  if not v_inside_yucatan then
    return jsonb_build_object(
      'ok',false,'code','UBICACION_FUERA_DE_YUCATAN','inside_yucatan',false,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select count(*) into v_configured_count
  from public.delivery_zones
  where store_id=v_store_id and enabled=true and geom is not null;

  if v_configured_count=0 then
    return jsonb_build_object(
      'ok',false,'code','ZONAS_NO_CONFIGURADAS','inside_yucatan',true,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select z.id,z.name,z.fee,z.priority
  into v_zone
  from public.delivery_zones z
  where z.store_id=v_store_id and z.enabled=true
    and z.geom is not null
    and extensions.st_covers(z.geom,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326))
  order by z.priority,z.name
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok',false,'code','FUERA_DE_ZONA_DE_REPARTO','inside_yucatan',true,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select
    coalesce(bool_or(case when key='rain_surcharge_enabled'
      then lower(trim(value)) in ('true','1','yes','on') else false end),false),
    coalesce(max(case when key='rain_surcharge_amount'
      then case when trim(value) ~ '^[0-9]+([.][0-9]+)?$' then trim(value)::numeric else 10 end end),10),
    coalesce(max(case when key='rain_surcharge_message' then value end),'')
  into v_rain_enabled,v_rain_amount,v_rain_message
  from public.settings
  where store_id=v_store_id and key in ('rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message');

  if not v_rain_enabled then v_rain_amount := 0; end if;
  v_effective_fee := coalesce(v_zone.fee,0) + coalesce(v_rain_amount,0);

  return jsonb_build_object(
    'ok',true,'code','OK','inside_yucatan',true,
    'accuracy_m',round(p_accuracy_m::numeric,0),
    'zone_id',v_zone.id,'zone_name',v_zone.name,
    'base_fee',v_zone.fee,
    'rain_surcharge_enabled',v_rain_enabled,
    'rain_surcharge',v_rain_amount,
    'rain_message',v_rain_message,
    'fee',v_effective_fee
  );
end;
$function$




DROP FUNCTION IF EXISTS public.admin_list_delivery_zones();
CREATE FUNCTION public.admin_list_delivery_zones(p_store_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_list_delivery_zones(p_store_id); $$;
DROP FUNCTION IF EXISTS public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
CREATE FUNCTION public.admin_save_delivery_zone(p_store_id uuid,p_id uuid,p_fee numeric,p_enabled boolean,p_geojson jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_save_delivery_zone(p_store_id,p_id,p_fee,p_enabled,p_geojson); $$;
DROP FUNCTION IF EXISTS public.pastehot_add_category(text);
CREATE FUNCTION public.pastehot_add_category(p_store_id uuid,p_name text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_add_category(p_store_id,p_name); $$;
CREATE OR REPLACE FUNCTION public.pastehot_store_state(p_store_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'state'); $$;
CREATE OR REPLACE FUNCTION public.pastehot_set_store_closed(p_store_id uuid,p_closed boolean,p_reason text,p_expected_closed boolean,p_public_reason text DEFAULT null) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'set',jsonb_build_object('closed',p_closed,'reason',p_reason,'expected_closed',p_expected_closed,'public_reason',p_public_reason)); $$;
CREATE OR REPLACE FUNCTION public.pastehot_store_history(p_store_id uuid,p_day date DEFAULT null,p_offset integer DEFAULT 0,p_only_during_hours boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'history',jsonb_build_object('day',p_day,'offset',p_offset,'only_during_hours',p_only_during_hours)); $$;

REVOKE ALL ON FUNCTION private.admin_list_delivery_zones(uuid),private.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),private.pastehot_add_category(uuid,text),private.pastehot_store_dispatch(uuid,text,jsonb),private.pastehot_store_snapshot(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION private.admin_list_delivery_zones(uuid),private.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),private.pastehot_add_category(uuid,text),private.pastehot_store_dispatch(uuid,text,jsonb),private.pastehot_store_snapshot(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_delivery_zones(uuid),public.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),public.pastehot_add_category(uuid,text),public.pastehot_store_state(uuid),public.pastehot_set_store_closed(uuid,boolean,text,boolean,text),public.pastehot_store_history(uuid,date,integer,boolean),public.validate_delivery_location(uuid,double precision,double precision,double precision) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_zones(uuid),public.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),public.pastehot_add_category(uuid,text),public.pastehot_store_state(uuid),public.pastehot_set_store_closed(uuid,boolean,text,boolean,text),public.pastehot_store_history(uuid,date,integer,boolean),public.validate_delivery_location(uuid,double precision,double precision,double precision) TO anon,authenticated;
DROP FUNCTION IF EXISTS public.update_order_status_with_inventory(uuid,text);
DROP FUNCTION IF EXISTS private.update_order_status_with_inventory(uuid,text);
DROP FUNCTION IF EXISTS public.update_order_status_with_inventory_v2(uuid,text);
DROP FUNCTION IF EXISTS private.update_order_status_with_inventory_v2(uuid,text);
CREATE FUNCTION private.update_order_status_with_inventory_v2(p_store_id uuid,p_order_id uuid,p_new_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_item record;
  v_product record;
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then
    if not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO';end if;
    if not exists(select 1 from public.orders where id=p_order_id and store_id=p_store_id and created_at >= now()-interval '48 hours') then raise exception 'NO_AUTORIZADO';end if;
  end if;

  if p_new_status not in (
    'pendiente_confirmacion',
    'nuevo',
    'confirmado',
    'preparando',
    'listo',
    'en_reparto',
    'entregado',
    'cancelado'
  ) then
    raise exception 'Estado no válido.';
  end if;

  select id, order_status, delivery_type, items, inventory_applied, inventory_restored
  into v_order
  from public.orders
  where id = p_order_id and store_id=p_store_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado.';
  end if;

  if (not private.pastehot_store_owner_allowed(p_store_id)) and not (
    p_new_status=v_order.order_status or
    (v_order.order_status in ('nuevo','pendiente_confirmacion') and p_new_status='confirmado') or
    (v_order.order_status='confirmado' and p_new_status='preparando') or
    (v_order.order_status='preparando' and p_new_status='listo') or
    (v_order.order_status='listo' and p_new_status='entregado') or
    (v_order.order_status='listo' and v_order.delivery_type='delivery' and p_new_status='en_reparto') or
    (v_order.order_status='en_reparto' and p_new_status='entregado') or
    (v_order.order_status not in ('cancelado','entregado') and p_new_status='cancelado')
  ) then raise exception 'ESTADO_NO_PERMITIDO_PARA_EMPLEADO';end if;
  if p_new_status='en_reparto' and v_order.delivery_type is distinct from 'delivery' then raise exception 'REPARTO_SOLO_DOMICILIO';end if;
  if p_new_status=v_order.order_status then
    return jsonb_build_object('id',v_order.id,'order_status',v_order.order_status,'inventory_applied',v_order.inventory_applied,'inventory_restored',v_order.inventory_restored);
  end if;
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
      where id=p_order_id and store_id=p_store_id;
    else
      update public.orders
      set order_status='cancelado'
      where id=p_order_id and store_id=p_store_id;
    end if;

  -- Mantener pendiente sin tocar inventario.
  elsif p_new_status='pendiente_confirmacion' then
    update public.orders
    set order_status='pendiente_confirmacion'
    where id=p_order_id and store_id=p_store_id;

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
      where id=v_item.product_id and store_id=p_store_id
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
      where id=v_item.product_id and store_id=p_store_id;
    end loop;

    update public.orders
    set order_status='confirmado',
        inventory_applied=true,
        inventory_restored=false
    where id=p_order_id and store_id=p_store_id;

  -- Reactivar desde cancelado exige volver por confirmado.
  elsif v_order.order_status='cancelado'
        and p_new_status <> 'confirmado' then
    raise exception 'PEDIDO_CANCELADO_REQUIERE_CONFIRMACION';

  -- Pedidos ya confirmados/activos: solo cambia el estado.
  else
    update public.orders
    set order_status=p_new_status
    where id=p_order_id and store_id=p_store_id;
  end if;

  return (
    select jsonb_build_object(
      'id',id,
      'order_status',order_status,
      'inventory_applied',inventory_applied,
      'inventory_restored',inventory_restored
    )
    from public.orders
    where id=p_order_id and store_id=p_store_id
  );
end;
$function$;

revoke all on function private.update_order_status_with_inventory_v2(uuid,uuid,text) from public,anon;
grant execute on function private.update_order_status_with_inventory_v2(uuid,uuid,text) to authenticated;
create function public.update_order_status_with_inventory_v2(p_store_id uuid,p_order_id uuid,p_new_status text) returns jsonb
language sql security invoker set search_path='' as $$select private.update_order_status_with_inventory_v2(p_store_id,p_order_id,p_new_status);$$;
revoke all on function public.update_order_status_with_inventory_v2(uuid,uuid,text) from public,anon;
grant execute on function public.update_order_status_with_inventory_v2(uuid,uuid,text) to authenticated;

REVOKE ALL ON FUNCTION public.create_pending_order_with_location_v3(uuid,text,text,text,text,text,text,text,jsonb,double precision,double precision,double precision,text,text,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_pending_order_with_location_v3(uuid,text,text,text,text,text,text,text,jsonb,double precision,double precision,double precision,text,text,text,text,text,text,text) TO anon,authenticated;

DROP FUNCTION IF EXISTS public.pastehot_order_page(timestamptz,text,timestamptz,uuid);
CREATE FUNCTION public.pastehot_order_page(p_store_id uuid,p_from timestamptz DEFAULT NULL,p_search text DEFAULT '',p_before_time timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_rows jsonb; v_q text:=regexp_replace(lower(coalesce(p_search,'')),'[[:space:]-]','','g');
BEGIN
 IF NOT (private.pastehot_store_owner_allowed(p_store_id) OR private.pastehot_store_access_allowed(p_store_id)) THEN RAISE EXCEPTION 'NO_AUTORIZADO'; END IF;
 IF length(v_q)>80 OR (p_before_time IS NOT NULL AND p_before_id IS NULL) THEN RAISE EXCEPTION 'BUSQUEDA_INVALIDA'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC,t.id DESC),'[]'::jsonb) INTO v_rows FROM (
  SELECT o.* FROM public.orders o WHERE o.store_id=p_store_id AND (private.pastehot_store_owner_allowed(p_store_id) OR o.created_at>=now()-interval '48 hours')
   AND (p_from IS NULL OR o.created_at>=p_from)
   AND (v_q='' OR position(v_q in regexp_replace(lower(coalesce(o.order_code,'')),'[[:space:]-]','','g'))>0 OR position(v_q in replace(o.id::text,'-',''))>0)
   AND (p_before_time IS NULL OR (o.created_at,o.id)<(p_before_time,p_before_id))
  ORDER BY o.created_at DESC,o.id DESC LIMIT 51
 ) t;
 RETURN jsonb_build_object('rows',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
END $$;
REVOKE ALL ON FUNCTION public.pastehot_order_page(uuid,timestamptz,text,timestamptz,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.pastehot_order_page(uuid,timestamptz,text,timestamptz,uuid) TO authenticated;

drop function if exists public.pastehot_sales_summary(timestamptz,timestamptz,boolean,integer);
create function public.pastehot_sales_summary(p_store_id uuid,p_from timestamptz default null,p_to timestamptz default now(),p_customers boolean default false,p_customer_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare v_result jsonb;
begin
 if not private.pastehot_store_owner_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
 if p_to is null or (p_from is not null and p_from>=p_to) or p_customer_offset<0 then raise exception 'PERIODO_INVALIDO'; end if;
 with valid as materialized(select * from public.orders where store_id=p_store_id and order_status not in ('cancelado','pendiente_confirmacion') and created_at<p_to),
 selected as materialized(select * from valid where p_from is null or created_at>=p_from),
 entries as(select coalesce(p.id::text,nullif(i->>'product_id',''),nullif(i->>'id',''),i->>'name','Producto histórico') as key,
  coalesce(p.name,i->>'name','Producto histórico') as name,coalesce(p.category,i->>'category','') as category,
  case when i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'quantity')::numeric else 0 end as quantity,
  case when i->>'subtotal' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'subtotal')::numeric
   when i->>'price' ~ '^[0-9]+([.][0-9]+)?$' and i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'price')::numeric*(i->>'quantity')::numeric else 0 end as amount
  from selected o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end)i
  left join lateral(select p.* from public.products p where p.store_id=p_store_id and (p.id::text=coalesce(nullif(i->>'product_id',''),i->>'id') or (coalesce(nullif(i->>'product_id',''),nullif(i->>'id','')) is null and p.name=i->>'name')) order by p.id limit 1)p on true),
 paste_entries as(select * from entries where category !~* 'bebida|refresco|agua|café|cafe|jugo'),
 seeds as(select id::text as key,name,0::numeric as quantity,0::numeric as amount from public.products where store_id=p_store_id and coalesce(category,'') !~* 'bebida|refresco|agua|café|cafe|jugo'),
 ranked as(select key,min(name) as name,sum(quantity) as quantity,sum(amount) as amount from (select * from seeds union all select key,name,quantity,amount from paste_entries)t group by key),
 daily as(select (created_at at time zone 'America/Merida')::date::text as day,sum(total) as amount from selected group by 1),
 payments as(select coalesce(nullif(lower(trim(payment_method)),''),'sin especificar') as key,count(*) as orders,sum(total) as total from selected group by 1),
 customer_history as(select regexp_replace(customer_phone,'[^0-9]','','g') as phone,min(created_at) as first_ever from valid group by 1),
 customer_rows as(select regexp_replace(o.customer_phone,'[^0-9]','','g') as phone,(array_agg(o.customer_name order by o.created_at desc,o.id desc))[1] as name,count(*) as count,sum(o.total) as total,min(o.created_at) as first,max(o.created_at) as last,
  (count(*)>1 or (p_from is not null and min(h.first_ever)<p_from)) as recurrent
  from selected o join customer_history h on h.phone=regexp_replace(o.customer_phone,'[^0-9]','','g') where coalesce(h.phone,'')<>'' group by 1),
 customer_page as(select * from customer_rows order by last desc,phone offset p_customer_offset limit 51),
 top_customers as(select * from customer_rows where recurrent order by count desc,total desc,name limit 3),
 zone_rows as(select coalesce(nullif(trim(o.delivery_zone_name),''),'Sin zona asignada') as name,count(*) as orders,
  sum(coalesce((select sum(case when i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'quantity')::numeric else 0 end)
    from jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end)i
    left join public.products p on p.store_id=p_store_id and p.id::text=coalesce(nullif(i->>'product_id',''),nullif(i->>'id',''))
    where coalesce(p.category,i->>'category','') !~* 'bebida|refresco|agua|café|cafe|jugo'),0)) as paste_quantity,
  sum(o.total) as total from selected o where o.delivery_type='delivery' group by 1),
 zones as(select name,orders,paste_quantity,total from zone_rows),
 payment_json as(select jsonb_agg(jsonb_build_object('key',key,'name',case key when 'cash' then 'Efectivo' when 'transfer' then 'Transferencia' else initcap(key) end,'orders',orders,'total',total) order by orders desc,key) as value from payments),
 zone_json as(select jsonb_agg(jsonb_build_object('name',name,'orders',orders,'paste_quantity',paste_quantity,'total',total) order by paste_quantity desc,orders desc,total desc,name) as value from zones)
 select jsonb_build_object('generated_at',now(),'from',coalesce(p_from,(select min(created_at) from valid)),'to',p_to,
  'orders',(select count(*) from selected),'total',coalesce((select sum(total) from selected),0),'subtotal',coalesce((select sum(subtotal) from selected),0),
  'average_ticket',coalesce((select sum(total)/nullif(count(*),0) from selected),0),
  'payment_methods',coalesce((select value from payment_json),'[]'::jsonb),'zones',coalesce((select value from zone_json),'[]'::jsonb),
  'top_customers',coalesce((select jsonb_agg(jsonb_build_object('name',name,'phone',phone,'count',count,'total',total,'recurrent',recurrent) order by count desc,total desc,name) from top_customers),'[]'::jsonb),
  'pastes',coalesce((select jsonb_agg(to_jsonb(r) order by quantity desc,name,key) from ranked r),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb),
  'customers',case when p_customers then coalesce((select jsonb_agg(to_jsonb(c) order by last desc,phone) from customer_page c),'[]'::jsonb) else '[]'::jsonb end,
  'customer_count',case when p_customers then (select count(*) from customer_rows) else 0 end,
  'recurrent_count',case when p_customers then (select count(*) from customer_rows where recurrent) else 0 end,
  'customer_total',case when p_customers then coalesce((select sum(total) from customer_rows),0) else 0 end) into v_result;
 return v_result;
end $$;
revoke all on function public.pastehot_sales_summary(uuid,timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.pastehot_sales_summary(uuid,timestamptz,timestamptz,boolean,integer) to authenticated;

COMMIT;
