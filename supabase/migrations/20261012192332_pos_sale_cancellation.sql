begin;

alter table public.orders
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references auth.users(id) on delete set null,
  add column if not exists canceled_by_name text;

create or replace function public.pastehot_pos_cancel_sale(p_store_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_name text;
  v_already_canceled boolean:=false;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select * into v_order
  from public.orders
  where id=p_order_id and store_id=p_store_id and sale_channel='point_of_sale'
  for update;
  if not found then raise exception 'VENTA_POS_NO_ENCONTRADA'; end if;

  if v_order.order_status='cancelado' then
    v_already_canceled:=true;
  else
    if coalesce(v_order.inventory_applied,false) and not coalesce(v_order.inventory_restored,false) then
      for v_item in
        select x.product_id,sum(x.quantity)::integer as quantity
        from jsonb_to_recordset(v_order.items)
          as x(product_id uuid,quantity integer,stock_tracked boolean)
        where coalesce(x.stock_tracked,false)=true
        group by x.product_id
      loop
        update public.products
        set stock=stock+v_item.quantity,updated_at=now()
        where id=v_item.product_id and store_id=p_store_id;
      end loop;
    end if;

    v_name:=coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name',''),
      nullif(auth.jwt()->'user_metadata'->>'name',''),auth.jwt()->>'email','Empleado');
    update public.orders
    set order_status='cancelado',inventory_restored=coalesce(inventory_applied,false),
        canceled_at=now(),canceled_by=auth.uid(),canceled_by_name=v_name
    where id=p_order_id and store_id=p_store_id
    returning * into v_order;
  end if;

  return jsonb_build_object('id',v_order.id,'order_code',v_order.order_code,
    'order_status',v_order.order_status,'inventory_restored',v_order.inventory_restored,
    'canceled_at',v_order.canceled_at,'canceled_by_name',v_order.canceled_by_name,
    'already_canceled',v_already_canceled);
end $$;

create or replace function public.pastehot_pos_report(p_store_id uuid,p_from timestamptz default null,p_to timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  select jsonb_build_object(
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',channel,'orders',orders,'total',total) order by channel)
      from (select case when sale_channel='point_of_sale' then 'Punto de venta' else 'Digital' end channel,count(*) orders,sum(total) total
      from public.orders where store_id=p_store_id and order_status not in ('cancelado','pendiente_confirmacion') and created_at<p_to and (p_from is null or created_at>=p_from) group by 1)s),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object('method',case payment_method when 'cash' then 'Efectivo' when 'transfer' then 'Transferencia' when 'card' then 'Tarjeta' else payment_method end,'orders',orders,'total',total) order by payment_method)
      from (select payment_method,count(*) orders,sum(total) total from public.orders where store_id=p_store_id and sale_channel='point_of_sale' and order_status not in ('cancelado','pendiente_confirmacion') and created_at<p_to and (p_from is null or created_at>=p_from) group by payment_method)p),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by opened_at desc) from (
      select s.id,s.opened_by_name,s.opening_cash,s.opened_at,s.closed_by_name,s.closing_cash,s.expected_cash,s.cash_difference,s.closed_at,
        count(o.id) filter(where o.order_status<>'cancelado') as sales_count,coalesce(sum(o.total) filter(where o.order_status<>'cancelado'),0) as sales_total,
        count(o.id) filter(where o.order_status='cancelado') as canceled_count,coalesce(sum(o.total) filter(where o.order_status='cancelado'),0) as canceled_total,
        coalesce(sum(o.total) filter(where o.payment_method='cash' and o.order_status<>'cancelado'),0) as cash_sales,
        coalesce(sum(o.total) filter(where o.payment_method='transfer' and o.order_status<>'cancelado'),0) as transfer_sales,
        coalesce(sum(o.total) filter(where o.payment_method='card' and o.order_status<>'cancelado'),0) as card_sales
      from public.cash_register_shifts s left join public.orders o on o.register_shift_id=s.id
      where s.store_id=p_store_id and s.opened_at<p_to and (p_from is null or s.opened_at>=p_from)
      group by s.id)s),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.pastehot_pos_cancel_sale(uuid,uuid) from public,anon;
grant execute on function public.pastehot_pos_cancel_sale(uuid,uuid) to authenticated;
revoke all on function public.pastehot_pos_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.pastehot_pos_report(uuid,timestamptz,timestamptz) to authenticated;

commit;
