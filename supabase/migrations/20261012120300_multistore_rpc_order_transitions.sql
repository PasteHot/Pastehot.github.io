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
