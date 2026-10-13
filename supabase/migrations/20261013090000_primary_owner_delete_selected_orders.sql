-- PREVIEW ONLY: permanently delete selected orders, across all stores, for the
-- primary owner. The operation intentionally leaves inventory and cash shifts
-- untouched. Do not apply to production until the owner approves publication.
begin;

-- Defense in depth: even direct table DELETE requests from delegated owners
-- must fail. The privileged RPC below performs the deletion after checking the
-- immutable primary-owner membership.
drop policy if exists orders_primary_owner_delete_only on public.orders;
create policy orders_primary_owner_delete_only
  on public.orders as restrictive for delete to authenticated
  using ((select private.pastehot_primary_owner_allowed()));

drop policy if exists order_items_primary_owner_delete_only on public.order_items;
create policy order_items_primary_owner_delete_only
  on public.order_items as restrictive for delete to authenticated
  using ((select private.pastehot_primary_owner_allowed()));

create or replace function private.pastehot_delete_orders(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ids uuid[];
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

  -- Lock surviving rows before removing their item details. No inventory
  -- update, cancellation, refund, or cash-register mutation is performed.
  perform o.id from public.orders o where o.id=any(v_ids) for update;
  delete from public.order_items i where i.order_id=any(v_ids);
  delete from public.orders o where o.id=any(v_ids);
  get diagnostics v_deleted=row_count;

  return jsonb_build_object('deleted_count',v_deleted,'inventory_changed',false);
end;
$$;
revoke all on function private.pastehot_delete_orders(uuid[]) from public,anon,authenticated;
grant execute on function private.pastehot_delete_orders(uuid[]) to authenticated;

create or replace function public.pastehot_delete_orders(p_order_ids uuid[])
returns jsonb
language sql
security invoker
set search_path=''
as $$ select private.pastehot_delete_orders(p_order_ids); $$;
revoke all on function public.pastehot_delete_orders(uuid[]) from public,anon;
grant execute on function public.pastehot_delete_orders(uuid[]) to authenticated;

commit;
