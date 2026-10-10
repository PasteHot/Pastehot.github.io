begin;

-- Separate the main owner from delegated owners for business and payment details.
create or replace function private.pastehot_primary_owner_allowed()
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1
    from private.pastehot_members m
    cross join private.pastehot_access_config c
    join auth.sessions a on a.id=(auth.jwt()->>'session_id')::uuid
    where m.user_id=auth.uid() and m.primary_owner and m.role='owner' and m.enabled
      and a.user_id=m.user_id
      and (c.direct_access or exists(
        select 1 from private.pastehot_sessions s
        where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved'
      ))
  );
$$;

revoke all on function private.pastehot_primary_owner_allowed() from public,anon;
grant execute on function private.pastehot_primary_owner_allowed() to authenticated;

-- Delegated owners keep broad access except the Business section, whose settings
-- include bank account details and shop identity/contact data.
drop policy if exists "Authenticated users can manage settings" on public.settings;
create policy "Owners manage permitted settings" on public.settings
for all to authenticated
using (
  (select private.pastehot_owner_allowed())
  and (
    (select private.pastehot_primary_owner_allowed())
    or key <> all(array[
      'business_name','slogan','whatsapp','business_address','opening_time','closing_time','pickup_maps_url',
      'bank_name','bank_holder','bank_clabe','bank_card'
    ]::text[])
  )
)
with check (
  (select private.pastehot_owner_allowed())
  and (
    (select private.pastehot_primary_owner_allowed())
    or key <> all(array[
      'business_name','slogan','whatsapp','business_address','opening_time','closing_time','pickup_maps_url',
      'bank_name','bank_holder','bank_clabe','bank_card'
    ]::text[])
  )
);

-- Managers can update only payment restriction, rain surcharge and batch settings.
create policy "Managers read operation and batch settings" on public.settings
for select to authenticated
using (
  key = any(array[
    'delivery_transfer_only','rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message',
    'batch_timer_enabled','batch_duration_minutes','batch_fresh_minutes','batch_label','batch_finished_message','batch_end_time'
  ]::text[])
  and (select private.pastehot_manager_allowed())
);

create policy "Managers update operation and batch settings" on public.settings
for update to authenticated
using (
  key = any(array[
    'delivery_transfer_only','rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message',
    'batch_timer_enabled','batch_duration_minutes','batch_fresh_minutes','batch_label','batch_finished_message','batch_end_time'
  ]::text[])
  and (select private.pastehot_manager_allowed())
)
with check (
  key = any(array[
    'delivery_transfer_only','rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message',
    'batch_timer_enabled','batch_duration_minutes','batch_fresh_minutes','batch_label','batch_finished_message','batch_end_time'
  ]::text[])
  and (select private.pastehot_manager_allowed())
);

-- A manager's product permission is limited to turning products on or off.
drop policy if exists "Approved managers can add products" on public.products;
create or replace function private.pastehot_limit_manager_product_update()
returns trigger
language plpgsql security invoker set search_path=''
as $$
begin
  if (select private.pastehot_manager_allowed())
     and (to_jsonb(new) - array['available','updated_at']::text[])
       is distinct from (to_jsonb(old) - array['available','updated_at']::text[]) then
    raise exception 'El encargado solo puede cambiar la disponibilidad del producto.';
  end if;
  return new;
end;
$$;
revoke all on function private.pastehot_limit_manager_product_update() from public,anon,authenticated;
drop trigger if exists pastehot_limit_manager_product_update on public.products;
create trigger pastehot_limit_manager_product_update
before update on public.products
for each row execute function private.pastehot_limit_manager_product_update();

-- Append-only category creation for owners and managers; the manager cannot
-- reorder or remove existing categories, even through direct API calls.
create or replace function private.pastehot_add_category(p_name text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_name text:=trim(coalesce(p_name,''));
  v_value text;
  v_categories jsonb;
begin
  if not (private.pastehot_owner_allowed() or private.pastehot_manager_allowed()) then
    raise exception 'NO_AUTORIZADO';
  end if;
  if length(v_name) not between 1 and 80 then raise exception 'Usa un nombre de categoría de 1 a 80 caracteres.'; end if;
  select value into v_value from public.settings where key='categories' limit 1 for update;
  if v_value is null then raise exception 'No se encontró la lista actual de categorías.'; end if;
  v_categories:=v_value::jsonb;
  if jsonb_typeof(v_categories)<>'array' then raise exception 'La lista actual de categorías no es válida.'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_categories) e(value) where lower(e.value)=lower(v_name)) then
    raise exception 'Esa categoría ya existe.';
  end if;
  v_categories:=v_categories||jsonb_build_array(v_name);
  update public.settings set value=v_categories::text,updated_at=now() where key='categories';
  return v_categories;
end;
$$;
revoke all on function private.pastehot_add_category(text) from public,anon,authenticated;
grant execute on function private.pastehot_add_category(text) to authenticated;
create or replace function public.pastehot_add_category(p_name text)
returns jsonb language sql security invoker set search_path=''
as $$ select private.pastehot_add_category(p_name); $$;
revoke all on function public.pastehot_add_category(text) from public,anon;
grant execute on function public.pastehot_add_category(text) to authenticated;

-- Revoke the target account's database sessions after password reset so existing
-- access tokens also fail the application's auth.sessions-backed RLS checks.
create or replace function private.pastehot_revoke_member_sessions(p_user_id uuid)
returns void
language plpgsql security definer set search_path=''
as $$
begin
  if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
  if p_user_id is null or p_user_id=auth.uid()
     or not exists(select 1 from private.pastehot_members where user_id=p_user_id and not primary_owner and role in ('owner','manager','staff')) then
    raise exception 'CUENTA_NO_MODIFICABLE';
  end if;
  update private.pastehot_sessions set status='revoked',visible=false where user_id=p_user_id;
  delete from auth.sessions where user_id=p_user_id;
end;
$$;
revoke all on function private.pastehot_revoke_member_sessions(uuid) from public,anon,authenticated;
grant execute on function private.pastehot_revoke_member_sessions(uuid) to authenticated;
create or replace function public.pastehot_revoke_member_sessions(p_user_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.pastehot_revoke_member_sessions(p_user_id); $$;
revoke all on function public.pastehot_revoke_member_sessions(uuid) from public,anon;
grant execute on function public.pastehot_revoke_member_sessions(uuid) to authenticated;

commit;
