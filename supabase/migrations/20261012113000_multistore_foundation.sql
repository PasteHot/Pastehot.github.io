-- PasteHot multi-store foundation. This migration is intentionally prepared for
-- review and is not applied to the production project from this workspace.
begin;

grant usage on schema private to anon,authenticated;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  area text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint stores_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint stores_name_nonempty check (length(trim(name)) between 1 and 80)
);

-- Keep the existing PasteHot data as the first store. Nothing is copied to a
-- second store unless the owner explicitly asks for a menu copy.
insert into public.stores (id,slug,name,area)
values ('44444444-4444-4444-8444-444444444444','pastehot-principal','PasteHot','')
on conflict (id) do nothing;

create table if not exists private.pastehot_store_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id,user_id)
);
revoke all on private.pastehot_store_memberships from public,anon,authenticated;

alter table public.products add column if not exists store_id uuid;
alter table public.categories add column if not exists store_id uuid;
alter table public.orders add column if not exists store_id uuid;
alter table public.order_items add column if not exists store_id uuid;
alter table public.customers add column if not exists store_id uuid;
alter table public.delivery_zones add column if not exists store_id uuid;
alter table public.settings add column if not exists store_id uuid;
alter table private.pastehot_store_events add column if not exists store_id uuid;

update public.products set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.categories set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.orders set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.order_items i set store_id=o.store_id from public.orders o where i.order_id=o.id and i.store_id is null;
update public.order_items set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.customers set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.delivery_zones set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update public.settings set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;
update private.pastehot_store_events set store_id='44444444-4444-4444-8444-444444444444' where store_id is null;

alter table public.products alter column store_id set not null;
alter table public.categories alter column store_id set not null;
alter table public.orders alter column store_id set not null;
alter table public.order_items alter column store_id set not null;
alter table public.customers alter column store_id set not null;
alter table public.delivery_zones alter column store_id set not null;
alter table public.settings alter column store_id set not null;
alter table private.pastehot_store_events alter column store_id set not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_store_id_fkey') then alter table public.products add constraint products_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.categories'::regclass and conname='categories_store_id_fkey') then alter table public.categories add constraint categories_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_store_id_fkey') then alter table public.orders add constraint orders_store_id_fkey foreign key(store_id) references public.stores(id) on delete restrict; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.order_items'::regclass and conname='order_items_store_id_fkey') then alter table public.order_items add constraint order_items_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.customers'::regclass and conname='customers_store_id_fkey') then alter table public.customers add constraint customers_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.delivery_zones'::regclass and conname='delivery_zones_store_id_fkey') then alter table public.delivery_zones add constraint delivery_zones_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.settings'::regclass and conname='settings_store_id_fkey') then alter table public.settings add constraint settings_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
  if not exists(select 1 from pg_constraint where conrelid='private.pastehot_store_events'::regclass and conname='pastehot_store_events_store_id_fkey') then alter table private.pastehot_store_events add constraint pastehot_store_events_store_id_fkey foreign key(store_id) references public.stores(id) on delete cascade; end if;
end $$;

alter table public.categories drop constraint if exists categories_name_key;
alter table public.categories add constraint categories_store_name_key unique (store_id,name);
alter table public.delivery_zones drop constraint if exists delivery_zones_name_key;
alter table public.delivery_zones add constraint delivery_zones_store_name_key unique (store_id,name);
alter table public.settings drop constraint if exists settings_key_key;
alter table public.settings add constraint settings_store_key_key unique (store_id,key);

create index if not exists products_store_order_idx on public.products(store_id,sort_order,created_at);
create index if not exists categories_store_order_idx on public.categories(store_id,sort_order);
create index if not exists orders_store_created_idx on public.orders(store_id,created_at desc);
create index if not exists customers_store_phone_idx on public.customers(store_id,phone);
create index if not exists zones_store_enabled_idx on public.delivery_zones(store_id,enabled,priority);
create index if not exists settings_store_key_idx on public.settings(store_id,key);

insert into private.pastehot_store_memberships(store_id,user_id)
select '44444444-4444-4444-8444-444444444444',m.user_id
from private.pastehot_members m
where m.enabled and not m.primary_owner
on conflict do nothing;

create or replace function private.pastehot_request_store_id()
returns uuid language plpgsql stable security invoker set search_path=''
as $$
declare v_headers jsonb; v_value text;
begin
  v_headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  v_value:=v_headers->>'x-pastehot-store-id';
  if v_value is null or v_value='' then
    return '44444444-4444-4444-8444-444444444444'::uuid;
  end if;
  if v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return v_value::uuid;
exception when others then return null;
end;
$$;

create or replace function private.pastehot_store_access_allowed(p_store_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select p_store_id is not null and (
    private.pastehot_primary_owner_allowed()
    or exists(
      select 1 from private.pastehot_store_memberships sm
      join private.pastehot_members m on m.user_id=sm.user_id
      where sm.store_id=p_store_id and sm.user_id=auth.uid() and m.enabled
        and case m.role
          when 'owner' then private.pastehot_owner_allowed()
          when 'manager' then private.pastehot_manager_allowed()
          else private.pastehot_staff_allowed()
        end
    )
  );
$$;

create or replace function private.pastehot_store_owner_allowed(p_store_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select private.pastehot_primary_owner_allowed() or exists(
    select 1 from private.pastehot_store_memberships sm
    join private.pastehot_members m on m.user_id=sm.user_id
    where sm.store_id=p_store_id and sm.user_id=auth.uid() and m.enabled
      and m.role='owner' and private.pastehot_owner_allowed()
  );
$$;

create or replace function private.pastehot_store_manager_allowed(p_store_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select private.pastehot_store_owner_allowed(p_store_id) or exists(
    select 1 from private.pastehot_store_memberships sm
    join private.pastehot_members m on m.user_id=sm.user_id
    where sm.store_id=p_store_id and sm.user_id=auth.uid() and m.enabled
      and m.role='manager' and private.pastehot_manager_allowed()
  );
$$;

revoke all on function private.pastehot_request_store_id() from public;
revoke all on function private.pastehot_store_access_allowed(uuid) from public;
revoke all on function private.pastehot_store_owner_allowed(uuid) from public;
revoke all on function private.pastehot_store_manager_allowed(uuid) from public;
grant execute on function private.pastehot_request_store_id() to anon,authenticated;
grant execute on function private.pastehot_store_access_allowed(uuid) to anon,authenticated;
grant execute on function private.pastehot_store_owner_allowed(uuid) to authenticated;
grant execute on function private.pastehot_store_manager_allowed(uuid) to authenticated;

create or replace function private.pastehot_assign_store_id()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_parent uuid; v_active uuid;
begin
  if tg_op='UPDATE' then
    if new.store_id is distinct from old.store_id then raise exception 'STORE_ID_INMUTABLE'; end if;
    return new;
  end if;
  if tg_table_name='order_items' then
    select o.store_id into v_parent from public.orders o where o.id=new.order_id;
    if v_parent is not null then new.store_id:=v_parent; return new; end if;
  end if;
  if new.store_id is null then
    v_active:=private.pastehot_request_store_id();
    new.store_id:=coalesce(v_active,'44444444-4444-4444-8444-444444444444'::uuid);
  end if;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['products','categories','orders','order_items','customers','delivery_zones','settings'] loop
    execute format('drop trigger if exists pastehot_assign_store_id on public.%I',t);
    execute format('create trigger pastehot_assign_store_id before insert or update of store_id on public.%I for each row execute function private.pastehot_assign_store_id()',t);
  end loop;
  execute 'drop trigger if exists pastehot_assign_store_id on private.pastehot_store_events';
  execute 'create trigger pastehot_assign_store_id before insert or update of store_id on private.pastehot_store_events for each row execute function private.pastehot_assign_store_id()';
end $$;

-- Replace the broad single-store policies with branch-scoped policies.
do $$ declare p record; begin
  for p in select tablename,policyname from pg_policies where schemaname='public'
    and tablename=any(array['stores','products','categories','orders','order_items','customers','delivery_zones','settings']) loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $$;

alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.categories enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.customers enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.settings enable row level security;

create policy stores_public_active on public.stores for select to anon,authenticated using (is_active);
create policy stores_member_select on public.stores for select to authenticated using (private.pastehot_store_access_allowed(id));

create policy products_branch_select on public.products for select to anon,authenticated using (
  exists(select 1 from public.stores s where s.id=store_id and s.is_active)
  or (auth.uid() is not null and private.pastehot_store_access_allowed(store_id))
);
create policy products_branch_owner_manage on public.products for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));
create policy products_branch_manager_update on public.products for update to authenticated using (private.pastehot_store_manager_allowed(store_id)) with check (private.pastehot_store_manager_allowed(store_id));

create policy categories_branch_select on public.categories for select to anon,authenticated using (
  exists(select 1 from public.stores s where s.id=store_id and s.is_active)
  or (auth.uid() is not null and private.pastehot_store_access_allowed(store_id))
);
create policy categories_branch_owner_manage on public.categories for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));

-- Checkout writes through a SECURITY DEFINER RPC that validates the active store.
-- Direct REST inserts remain disabled.
create policy orders_branch_owner_manage on public.orders for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));
create policy orders_branch_staff_recent on public.orders for select to authenticated using (
  created_at>=now()-interval '48 hours'
  and private.pastehot_store_access_allowed(store_id)
);
create policy orders_branch_owner_select on public.orders for select to authenticated using (private.pastehot_store_owner_allowed(store_id));

create policy order_items_branch_owner_manage on public.order_items for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));
create policy order_items_branch_staff_recent on public.order_items for select to authenticated using (
  exists(select 1 from public.orders o where o.id=order_items.order_id and o.store_id=order_items.store_id
    and o.created_at>=now()-interval '48 hours'
    and private.pastehot_store_access_allowed(o.store_id))
);
create policy customers_branch_owner_manage on public.customers for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));

create policy zones_branch_select on public.delivery_zones for select to anon,authenticated using (
  (enabled and exists(select 1 from public.stores s where s.id=store_id and s.is_active))
  or (auth.uid() is not null and private.pastehot_store_access_allowed(store_id))
);
create policy zones_branch_owner_manage on public.delivery_zones for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));

create policy settings_branch_select on public.settings for select to anon,authenticated using (
  exists(select 1 from public.stores s where s.id=store_id and s.is_active)
  or (auth.uid() is not null and private.pastehot_store_access_allowed(store_id))
);
create policy settings_branch_owner_manage on public.settings for all to authenticated using (private.pastehot_store_owner_allowed(store_id)) with check (private.pastehot_store_owner_allowed(store_id));
create policy settings_branch_manager_update on public.settings for update to authenticated using (
  private.pastehot_store_manager_allowed(store_id) and key=any(array['delivery_transfer_only','rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message','batch_timer_enabled','batch_duration_minutes','batch_fresh_minutes','batch_label','batch_finished_message'])
) with check (
  private.pastehot_store_manager_allowed(store_id)
  and key=any(array['delivery_transfer_only','rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message','batch_timer_enabled','batch_duration_minutes','batch_fresh_minutes','batch_label','batch_finished_message'])
);

create or replace function public.pastehot_list_stores()
returns table(id uuid,slug text,name text,area text,is_active boolean,can_manage boolean)
language sql stable security definer set search_path=''
as $$
  select s.id,s.slug,s.name,s.area,s.is_active,(auth.uid() is not null and private.pastehot_primary_owner_allowed())
  from public.stores s
  where (auth.uid() is null and s.is_active)
     or (auth.uid() is not null and (private.pastehot_primary_owner_allowed() or private.pastehot_store_access_allowed(s.id)))
  order by s.created_at,s.name;
$$;
revoke all on function public.pastehot_list_stores() from public;
grant execute on function public.pastehot_list_stores() to anon,authenticated;

create or replace function public.pastehot_create_store(p_name text,p_area text default '',p_copy_from_store_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_name text:=trim(coalesce(p_name,'')); v_slug text; v_base text;
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'NOMBRE_INVALIDO'; end if;
  v_base:=trim(both '-' from regexp_replace(lower(v_name),'[^a-z0-9]+','-','g'));
  if v_base='' then v_base:='sucursal'; end if;
  v_slug:=left(v_base,48)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  insert into public.stores(slug,name,area) values(v_slug,v_name,left(trim(coalesce(p_area,'')),120)) returning id into v_id;
  if p_copy_from_store_id is not null then
    if not exists(select 1 from public.stores where id=p_copy_from_store_id) then raise exception 'SUCURSAL_ORIGEN_NO_ENCONTRADA'; end if;
    insert into public.products(store_id,name,description,price,category,image_url,available,sort_order,track_stock,stock,low_stock_threshold)
      select v_id,name,description,price,category,image_url,available,sort_order,false,0,low_stock_threshold from public.products where store_id=p_copy_from_store_id;
    insert into public.categories(store_id,name,sort_order)
      select v_id,name,sort_order from public.categories where store_id=p_copy_from_store_id;
    insert into public.delivery_zones(store_id,name,fee,priority,enabled,geom)
      select v_id,name,fee,priority,enabled,geom from public.delivery_zones where store_id=p_copy_from_store_id;
    insert into public.settings(store_id,key,value)
      select v_id,key,value from public.settings where store_id=p_copy_from_store_id and key not in ('store_manual_closed','store_manual_close_reason')
      on conflict(store_id,key) do nothing;
  end if;
  insert into public.settings(store_id,key,value) values (v_id,'store_manual_closed','false'),(v_id,'store_manual_close_reason','')
    on conflict(store_id,key) do update set value=excluded.value,updated_at=now();
  return jsonb_build_object('id',v_id,'slug',v_slug,'name',v_name,'area',left(trim(coalesce(p_area,'')),120),'is_active',true);
end;
$$;
revoke all on function public.pastehot_create_store(text,text,uuid) from public,anon;
grant execute on function public.pastehot_create_store(text,text,uuid) to authenticated;

create or replace function public.pastehot_list_store_members(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'email',u.email,'role',m.role,'enabled',m.enabled,'assigned',sm.user_id is not null) order by m.primary_owner desc,m.display_name),'[]'::jsonb)
    into v_result
    from private.pastehot_members m join auth.users u on u.id=m.user_id
    left join private.pastehot_store_memberships sm on sm.store_id=p_store_id and sm.user_id=m.user_id
    where not m.primary_owner;
  return v_result;
end;
$$;
revoke all on function public.pastehot_list_store_members(uuid) from public,anon;
grant execute on function public.pastehot_list_store_members(uuid) to authenticated;

create or replace function public.pastehot_set_store_member(p_store_id uuid,p_user_id uuid,p_assigned boolean)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if not private.pastehot_primary_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if not exists(select 1 from public.stores where id=p_store_id) then raise exception 'SUCURSAL_NO_ENCONTRADA'; end if;
  if not exists(select 1 from private.pastehot_members where user_id=p_user_id and enabled and not primary_owner) then raise exception 'CUENTA_NO_ASIGNABLE'; end if;
  if coalesce(p_assigned,false) then
    insert into private.pastehot_store_memberships(store_id,user_id) values(p_store_id,p_user_id) on conflict do nothing;
  else
    delete from private.pastehot_store_memberships where store_id=p_store_id and user_id=p_user_id;
  end if;
  return true;
end;
$$;
revoke all on function public.pastehot_set_store_member(uuid,uuid,boolean) from public,anon;
grant execute on function public.pastehot_set_store_member(uuid,uuid,boolean) to authenticated;

drop function if exists public.pastehot_image_reference_exists(text);
drop function if exists private.pastehot_image_reference_exists(text);
create function private.pastehot_image_reference_exists(p_url text,p_store_id uuid default '44444444-4444-4444-8444-444444444444'::uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then raise exception 'NO_AUTORIZADO'; end if;
  return exists(select 1 from public.products p where p.image_url=p_url)
    or exists(select 1 from public.settings s where s.value=p_url and s.key=any(array['cover_image','profile_image','background_image']));
end;
$$;
create function public.pastehot_image_reference_exists(p_url text,p_store_id uuid default '44444444-4444-4444-8444-444444444444'::uuid)
returns boolean language sql security invoker set search_path=''
as $$ select private.pastehot_image_reference_exists(p_url,p_store_id); $$;
revoke all on function private.pastehot_image_reference_exists(text,uuid) from public,anon;
revoke all on function public.pastehot_image_reference_exists(text,uuid) from public,anon;
grant execute on function private.pastehot_image_reference_exists(text,uuid) to authenticated;
grant execute on function public.pastehot_image_reference_exists(text,uuid) to authenticated;

grant select on public.stores to anon,authenticated;
commit;
