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
