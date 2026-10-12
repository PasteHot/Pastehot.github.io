begin;

create table public.cash_register_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  opened_by uuid not null references auth.users(id) on delete restrict,
  opened_by_name text not null,
  opening_cash numeric(12,2) not null check (opening_cash >= 0),
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_by_name text,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_difference numeric(12,2),
  closed_at timestamptz,
  check ((closed_at is null and closed_by is null and closing_cash is null) or
         (closed_at is not null and closed_by is not null and closing_cash is not null))
);
create unique index cash_register_one_open_per_store on public.cash_register_shifts(store_id) where closed_at is null;
create index cash_register_shifts_store_opened on public.cash_register_shifts(store_id,opened_at desc);
alter table public.cash_register_shifts enable row level security;
revoke all on public.cash_register_shifts from anon,authenticated;

alter table public.orders
  add column if not exists sale_channel text not null default 'digital',
  add column if not exists cashier_id uuid references auth.users(id) on delete set null,
  add column if not exists cashier_name text,
  add column if not exists register_shift_id uuid references public.cash_register_shifts(id) on delete set null,
  add column if not exists cash_received numeric(12,2),
  add column if not exists cash_change numeric(12,2);
alter table public.orders add constraint orders_sale_channel_check check(sale_channel in ('digital','point_of_sale'));
create index orders_pos_shift_idx on public.orders(register_shift_id,created_at desc) where sale_channel='point_of_sale';

create or replace function public.pastehot_pos_current_shift(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  select to_jsonb(s) into v_result from public.cash_register_shifts s
    where s.store_id=p_store_id and s.closed_at is null order by s.opened_at desc limit 1;
  return v_result;
end $$;

create or replace function public.pastehot_pos_open_shift(p_store_id uuid,p_opening_cash numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_name text; v_result jsonb;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  if not exists(select 1 from public.stores where id=p_store_id and is_active) then raise exception 'SUCURSAL_INACTIVA'; end if;
  if p_opening_cash is null or p_opening_cash<0 then raise exception 'MONTO_APERTURA_INVALIDO'; end if;
  v_name:=coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name',''),nullif(auth.jwt()->'user_metadata'->>'name',''),auth.jwt()->>'email','Empleado');
  insert into public.cash_register_shifts(store_id,opened_by,opened_by_name,opening_cash)
  values(p_store_id,auth.uid(),v_name,round(p_opening_cash,2)) returning to_jsonb(cash_register_shifts.*) into v_result;
  return v_result;
exception when unique_violation then raise exception 'CAJA_YA_ABIERTA';
end $$;

create or replace function public.pastehot_pos_close_shift(p_store_id uuid,p_shift_id uuid,p_closing_cash numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_shift public.cash_register_shifts%rowtype; v_name text; v_expected numeric(12,2); v_result jsonb;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  if p_closing_cash is null or p_closing_cash<0 then raise exception 'MONTO_CIERRE_INVALIDO'; end if;
  select * into v_shift from public.cash_register_shifts where id=p_shift_id and store_id=p_store_id and closed_at is null for update;
  if not found then raise exception 'CORTE_NO_ABIERTO'; end if;
  select round(v_shift.opening_cash+coalesce(sum(o.total) filter(where o.payment_method='cash'),0),2)
    into v_expected from public.orders o
    where o.register_shift_id=p_shift_id and o.sale_channel='point_of_sale' and o.order_status<>'cancelado';
  v_name:=coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name',''),nullif(auth.jwt()->'user_metadata'->>'name',''),auth.jwt()->>'email','Empleado');
  update public.cash_register_shifts set closed_by=auth.uid(),closed_by_name=v_name,closing_cash=round(p_closing_cash,2),
    expected_cash=v_expected,cash_difference=round(p_closing_cash-v_expected,2),closed_at=now()
    where id=p_shift_id returning to_jsonb(cash_register_shifts.*) into v_result;
  return v_result;
end $$;

create or replace function public.pastehot_pos_create_sale(
  p_store_id uuid,p_shift_id uuid,p_payment_method text,p_items jsonb,p_cash_received numeric default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_shift public.cash_register_shifts%rowtype; v_item record; v_product public.products%rowtype;
  v_items jsonb:='[]'::jsonb; v_subtotal numeric(12,2):=0; v_order_id uuid; v_code text;
  v_actor text; v_total numeric(12,2); v_qty int;
begin
  if auth.uid() is null or not private.pastehot_store_access_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  if p_payment_method not in ('cash','transfer','card') then raise exception 'METODO_DE_PAGO_INVALIDO'; end if;
  select * into v_shift from public.cash_register_shifts where id=p_shift_id and store_id=p_store_id and closed_at is null for update;
  if not found then raise exception 'CAJA_CERRADA'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'VENTA_SIN_PRODUCTOS'; end if;
  for v_item in select product_id,sum(quantity)::int as quantity from jsonb_to_recordset(p_items) as x(product_id uuid,quantity int) group by product_id order by product_id loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity<=0 then raise exception 'CANTIDAD_INVALIDA'; end if;
    select * into v_product from public.products where id=v_item.product_id and store_id=p_store_id for update;
    if not found then raise exception 'PRODUCTO_NO_ENCONTRADO'; end if;
    if not v_product.available then raise exception 'PRODUCTO_NO_DISPONIBLE|% ',v_product.name; end if;
    if v_product.track_stock and v_product.stock<v_item.quantity then raise exception 'STOCK_INSUFICIENTE|%|%',v_product.name,v_product.stock; end if;
    v_subtotal:=v_subtotal+v_product.price*v_item.quantity;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'name',v_product.name,'category',v_product.category,
      'price',v_product.price,'quantity',v_item.quantity,'subtotal',v_product.price*v_item.quantity,'stock_tracked',v_product.track_stock));
    if v_product.track_stock then update public.products set stock=stock-v_item.quantity,updated_at=now() where id=v_product.id and store_id=p_store_id; end if;
  end loop;
  v_total:=round(v_subtotal,2);
  if p_payment_method='cash' and (p_cash_received is null or p_cash_received<v_total) then raise exception 'EFECTIVO_INSUFICIENTE'; end if;
  if p_payment_method<>'cash' and p_cash_received is not null then raise exception 'EFECTIVO_NO_APLICA'; end if;
  v_actor:=coalesce(nullif(auth.jwt()->'user_metadata'->>'full_name',''),nullif(auth.jwt()->'user_metadata'->>'name',''),auth.jwt()->>'email','Empleado');
  v_code:='PV-'||to_char(now() at time zone 'America/Merida','YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.orders(store_id,order_code,customer_name,customer_phone,delivery_type,address,notes,payment_method,payment_status,order_status,
    subtotal,delivery_cost,delivery_fee,total,items,inventory_applied,inventory_restored,sale_channel,cashier_id,cashier_name,register_shift_id,cash_received,cash_change)
  values(p_store_id,v_code,'Venta en punto de venta','', 'point_of_sale','',null,p_payment_method,'paid','entregado',v_total,0,0,v_total,v_items,true,false,
    'point_of_sale',auth.uid(),v_actor,p_shift_id,case when p_payment_method='cash' then round(p_cash_received,2) end,
    case when p_payment_method='cash' then round(p_cash_received-v_total,2) else 0 end)
  returning id into v_order_id;
  return jsonb_build_object('id',v_order_id,'order_code',v_code,'customer_name','Venta en punto de venta','customer_phone','',
    'delivery_type','point_of_sale','payment_method',p_payment_method,'payment_status','paid','order_status','entregado',
    'subtotal',v_total,'delivery_fee',0,'total',v_total,'items',v_items,'created_at',now(),'cash_received',case when p_payment_method='cash' then round(p_cash_received,2) end,
    'cash_change',case when p_payment_method='cash' then round(p_cash_received-v_total,2) else 0 end,'cashier_name',v_actor);
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
        coalesce(sum(o.total) filter(where o.payment_method='cash' and o.order_status<>'cancelado'),0) as cash_sales,
        coalesce(sum(o.total) filter(where o.payment_method='transfer' and o.order_status<>'cancelado'),0) as transfer_sales,
        coalesce(sum(o.total) filter(where o.payment_method='card' and o.order_status<>'cancelado'),0) as card_sales
      from public.cash_register_shifts s left join public.orders o on o.register_shift_id=s.id
      where s.store_id=p_store_id and s.opened_at<p_to and (p_from is null or s.opened_at>=p_from)
      group by s.id)s),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.pastehot_pos_current_shift(uuid) from public,anon;
revoke all on function public.pastehot_pos_open_shift(uuid,numeric) from public,anon;
revoke all on function public.pastehot_pos_close_shift(uuid,uuid,numeric) from public,anon;
revoke all on function public.pastehot_pos_create_sale(uuid,uuid,text,jsonb,numeric) from public,anon;
revoke all on function public.pastehot_pos_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.pastehot_pos_current_shift(uuid) to authenticated;
grant execute on function public.pastehot_pos_open_shift(uuid,numeric) to authenticated;
grant execute on function public.pastehot_pos_close_shift(uuid,uuid,numeric) to authenticated;
grant execute on function public.pastehot_pos_create_sale(uuid,uuid,text,jsonb,numeric) to authenticated;
grant execute on function public.pastehot_pos_report(uuid,timestamptz,timestamptz) to authenticated;

commit;
