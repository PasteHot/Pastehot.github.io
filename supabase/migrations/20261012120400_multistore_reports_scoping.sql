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
