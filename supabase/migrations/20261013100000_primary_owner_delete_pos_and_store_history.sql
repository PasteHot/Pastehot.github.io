-- Primary-owner-only deletion for closed, unreferenced POS shifts and store events.
-- Order deletion also refreshes closed cash snapshots so reports stay consistent.
begin;

create or replace function private.pastehot_delete_orders(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ids uuid[];
  v_shift_ids uuid[];
  v_deleted integer:=0;
begin
  if auth.uid() is null or not private.pastehot_primary_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;
  if p_order_ids is null then raise exception 'PEDIDOS_REQUERIDOS'; end if;

  select coalesce(array_agg(distinct requested.id), '{}'::uuid[])
    into v_ids
  from unnest(p_order_ids) as requested(id)
  where requested.id is not null;
  if cardinality(v_ids)=0 then raise exception 'PEDIDOS_REQUERIDOS'; end if;

  -- Match the POS close path's lock order: lock shifts first, then their orders.
  select coalesce(array_agg(distinct o.register_shift_id), '{}'::uuid[])
    into v_shift_ids
  from public.orders o
  where o.id=any(v_ids) and o.sale_channel='point_of_sale' and o.register_shift_id is not null;
  perform s.id from public.cash_register_shifts s where s.id=any(v_shift_ids) order by s.id for update;
  perform o.id from public.orders o where o.id=any(v_ids) order by o.id for update;

  delete from public.order_items i where i.order_id=any(v_ids);
  delete from public.orders o where o.id=any(v_ids);
  get diagnostics v_deleted=row_count;

  -- A closed shift stores its original count as a snapshot. Recompute expected
  -- cash and difference from the remaining, non-canceled cash sales atomically.
  update public.cash_register_shifts s
  set expected_cash=totals.expected_cash,
      cash_difference=round(s.closing_cash-totals.expected_cash,2)
  from (
    select sh.id,round(sh.opening_cash+coalesce(sum(o.total) filter (
      where o.payment_method='cash' and o.order_status<>'cancelado'),0),2) as expected_cash
    from public.cash_register_shifts sh
    left join public.orders o on o.register_shift_id=sh.id and o.sale_channel='point_of_sale'
    where sh.id=any(v_shift_ids) and sh.closed_at is not null
    group by sh.id
  ) totals
  where s.id=totals.id;

  return jsonb_build_object('deleted_count',v_deleted,'inventory_changed',false,
    'updated_closed_shifts',cardinality(v_shift_ids));
end;
$$;
revoke all on function private.pastehot_delete_orders(uuid[]) from public,anon,authenticated;
grant execute on function private.pastehot_delete_orders(uuid[]) to authenticated;
create or replace function public.pastehot_delete_orders(p_order_ids uuid[])
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_delete_orders(p_order_ids); $$;
revoke all on function public.pastehot_delete_orders(uuid[]) from public,anon;
grant execute on function public.pastehot_delete_orders(uuid[]) to authenticated;

create or replace function private.pastehot_delete_cash_shifts(p_shift_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ids uuid[];
  v_existing integer;
  v_deleted integer:=0;
begin
  if auth.uid() is null or not private.pastehot_primary_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;
  if p_shift_ids is null then raise exception 'TURNOS_REQUERIDOS'; end if;
  select coalesce(array_agg(distinct requested.id), '{}'::uuid[])
    into v_ids
  from unnest(p_shift_ids) as requested(id)
  where requested.id is not null;
  if cardinality(v_ids)=0 then raise exception 'TURNOS_REQUERIDOS'; end if;

  perform s.id from public.cash_register_shifts s where s.id=any(v_ids) order by s.id for update;
  select count(*) into v_existing from public.cash_register_shifts s where s.id=any(v_ids);
  if v_existing<>cardinality(v_ids) then raise exception 'TURNO_NO_ENCONTRADO'; end if;
  if exists(select 1 from public.cash_register_shifts s where s.id=any(v_ids) and s.closed_at is null) then
    raise exception 'TURNO_ABIERTO';
  end if;
  if exists(select 1 from public.orders o where o.register_shift_id=any(v_ids)) then
    raise exception 'TURNO_CON_VENTAS';
  end if;

  delete from public.cash_register_shifts s where s.id=any(v_ids);
  get diagnostics v_deleted=row_count;
  return jsonb_build_object('deleted_count',v_deleted);
end;
$$;
revoke all on function private.pastehot_delete_cash_shifts(uuid[]) from public,anon,authenticated;
grant execute on function private.pastehot_delete_cash_shifts(uuid[]) to authenticated;

create or replace function public.pastehot_delete_cash_shifts(p_shift_ids uuid[])
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_delete_cash_shifts(p_shift_ids); $$;
revoke all on function public.pastehot_delete_cash_shifts(uuid[]) from public,anon;
grant execute on function public.pastehot_delete_cash_shifts(uuid[]) to authenticated;

create or replace function private.pastehot_delete_store_events(p_event_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ids bigint[];
  v_existing integer;
  v_deleted integer:=0;
begin
  if auth.uid() is null or not private.pastehot_primary_owner_allowed() then
    raise exception 'NO_AUTORIZADO';
  end if;
  if p_event_ids is null then raise exception 'MOVIMIENTOS_REQUERIDOS'; end if;
  select coalesce(array_agg(distinct requested.id), '{}'::bigint[])
    into v_ids
  from unnest(p_event_ids) as requested(id)
  where requested.id is not null;
  if cardinality(v_ids)=0 then raise exception 'MOVIMIENTOS_REQUERIDOS'; end if;

  perform e.id from private.pastehot_store_events e where e.id=any(v_ids) order by e.id for update;
  select count(*) into v_existing from private.pastehot_store_events e where e.id=any(v_ids);
  if v_existing<>cardinality(v_ids) then raise exception 'MOVIMIENTO_NO_ENCONTRADO'; end if;

  delete from private.pastehot_store_events e where e.id=any(v_ids);
  get diagnostics v_deleted=row_count;
  return jsonb_build_object('deleted_count',v_deleted);
end;
$$;
revoke all on function private.pastehot_delete_store_events(bigint[]) from public,anon,authenticated;
grant execute on function private.pastehot_delete_store_events(bigint[]) to authenticated;

create or replace function public.pastehot_delete_store_events(p_event_ids bigint[])
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_delete_store_events(p_event_ids); $$;
revoke all on function public.pastehot_delete_store_events(bigint[]) from public,anon;
grant execute on function public.pastehot_delete_store_events(bigint[]) to authenticated;

commit;
