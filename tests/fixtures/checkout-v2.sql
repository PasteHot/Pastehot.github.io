CREATE OR REPLACE FUNCTION public.create_pending_order_with_location_v2(p_order_code text, p_customer_name text, p_customer_phone text, p_delivery_type text, p_address text, p_payment_method text, p_notes text, p_items jsonb, p_delivery_lat double precision DEFAULT NULL::double precision, p_delivery_lng double precision DEFAULT NULL::double precision, p_delivery_accuracy_m double precision DEFAULT NULL::double precision, p_delivery_address_text text DEFAULT NULL::text, p_delivery_geocoded_address text DEFAULT NULL::text, p_delivery_reference text DEFAULT NULL::text, p_delivery_locality text DEFAULT NULL::text, p_delivery_region text DEFAULT NULL::text, p_delivery_postcode text DEFAULT NULL::text, p_delivery_country_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
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
  v_zone record;
  v_address_edited boolean := false;
  v_delivery_code text := null;
  v_attempt integer;
begin
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

    select z.id,z.name,z.fee,z.priority
    into v_zone
    from public.delivery_zones z
    where z.enabled=true
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
    where key in ('rain_surcharge_enabled','rain_surcharge_amount');

    if not v_rain_enabled then v_rain_amount := 0; end if;
    v_delivery_fee := v_delivery_base_fee + coalesce(v_rain_amount,0);

    for v_attempt in 1..20 loop
      v_delivery_code :=
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ', floor(random()*24)::int + 1, 1)
        || lpad(floor(random()*1000)::int::text,3,'0');

      exit when not exists(
        select 1
        from public.orders
        where delivery_verification_code=v_delivery_code
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
    where id=v_item.product_id;

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
    order_code,customer_name,customer_phone,delivery_type,address,payment_method,notes,
    items,subtotal,delivery_fee,total,order_status,inventory_applied,inventory_restored,
    delivery_lat,delivery_lng,delivery_accuracy_m,delivery_address_text,delivery_geocoded_address,
    delivery_reference,delivery_address_edited,delivery_address_confirmed_at,delivery_locality,
    delivery_region,delivery_postcode,delivery_country_code,delivery_location_verified,
    delivery_location_captured_at,delivery_location_consent_at,delivery_zone_id,delivery_zone_name,
    delivery_base_fee,delivery_rain_surcharge,delivery_verification_code
  )
  values(
    p_order_code,trim(p_customer_name),trim(p_customer_phone),p_delivery_type,
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
$function$;
