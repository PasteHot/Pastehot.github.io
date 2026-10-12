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
