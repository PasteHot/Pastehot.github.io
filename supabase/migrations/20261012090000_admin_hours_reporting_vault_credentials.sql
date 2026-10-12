-- Preview feature set: schedule enforcement, owner-only credential retrieval,
-- and additional owner reports. This migration is intentionally not applied
-- to the production database.
begin;
grant usage on schema private to authenticated,service_role;

create or replace function private.pastehot_staff_schedule_allowed()
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare
  v_raw text;
  v_schedule jsonb;
  v_now timestamp := now() at time zone 'America/Merida';
  v_day date;
  v_key text;
  v_entry jsonb;
  v_open time;
  v_close time;
  v_start timestamp;
  v_end timestamp;
begin
  select value into v_raw from public.settings where key='weekly_schedule' limit 1;
  if v_raw is null then return false; end if;
  begin v_schedule:=v_raw::jsonb; exception when others then return false; end;
  if jsonb_typeof(v_schedule)<>'object' then return false; end if;
  for v_day in select (v_now::date - n)::date from generate_series(0,1) n loop
    v_key:=case extract(dow from v_day)::integer
      when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
      when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' end;
    v_entry:=v_schedule->v_key;
    if jsonb_typeof(v_entry)='object' and v_entry->>'enabled'='true'
       and coalesce(v_entry->>'open','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and coalesce(v_entry->>'close','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_open:=(v_entry->>'open')::time;
      v_close:=(v_entry->>'close')::time;
      v_start:=v_day+v_open-interval '30 minutes';
      v_end:=v_day+v_close;
      if v_close<=v_open then v_end:=v_end+interval '1 day'; end if;
      if v_now>=v_start and v_now<v_end then return true; end if;
    end if;
  end loop;
  return false;
end $$;

create or replace function private.pastehot_staff_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select private.pastehot_staff_schedule_allowed() and exists(
  select 1 from private.pastehot_members m cross join private.pastehot_access_config c
  join auth.sessions a on a.user_id=m.user_id
  where c.enforced and m.user_id=auth.uid() and m.role in ('manager','staff') and m.enabled
   and a.id=(auth.jwt()->>'session_id')::uuid
   and exists(select 1 from private.pastehot_sessions s where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved'));
$$;
create or replace function private.pastehot_manager_allowed() returns boolean
language sql stable security definer set search_path='' as $$
 select private.pastehot_staff_schedule_allowed() and exists(
  select 1 from private.pastehot_members m cross join private.pastehot_access_config c
  join auth.sessions a on a.user_id=m.user_id
  where c.enforced and m.user_id=auth.uid() and m.role='manager' and m.enabled
   and a.id=(auth.jwt()->>'session_id')::uuid
   and exists(select 1 from private.pastehot_sessions s where s.auth_session_id=a.id and s.user_id=m.user_id and s.status='approved'));
$$;

create or replace function private.pastehot_current_role()
returns text language sql stable security definer set search_path=''
as $$select m.role from private.pastehot_members m where m.user_id=auth.uid() and m.enabled limit 1$$;
revoke all on function private.pastehot_current_role() from public,anon;
grant execute on function private.pastehot_current_role() to authenticated;

create or replace function public.pastehot_admin_state(p_label text default null,p_visible boolean default false,p_device_token text default null)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_role text;
begin
 v_role:=private.pastehot_current_role();
 if v_role in ('staff','manager') and not private.pastehot_staff_schedule_allowed() then
   return jsonb_build_object('allowed',false,'status','outside_hours','outside_hours',true,'role',v_role);
 end if;
 return private.pastehot_access_dispatch('state',jsonb_build_object('label',p_label,'visible',p_visible,'device_token',p_device_token));
end $$;

-- Store only future credentials in Vault. Decrypted values are exposed by a
-- dedicated RPC that checks the immutable primary-owner membership.
create table private.pastehot_staff_password_vault (
  user_id uuid primary key references private.pastehot_members(user_id) on delete cascade,
  secret_id uuid not null,
  updated_at timestamptz not null default now()
);
alter table private.pastehot_staff_password_vault enable row level security;
revoke all on private.pastehot_staff_password_vault from public,anon,authenticated;

create or replace function private.pastehot_store_staff_password(p_user_id uuid,p_password text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_secret uuid; v_role text;
begin
 if auth.role()<>'service_role' then raise exception 'NO_AUTORIZADO'; end if;
 if p_password is null or length(p_password)<12 or length(p_password)>128 then raise exception 'CONTRASENA_INVALIDA'; end if;
 select role into v_role from private.pastehot_members where user_id=p_user_id and enabled and not primary_owner;
 if v_role not in ('staff','manager') then raise exception 'CUENTA_NO_DISPONIBLE'; end if;
 select secret_id into v_secret from private.pastehot_staff_password_vault where user_id=p_user_id for update;
 if v_secret is null then
   v_secret:=vault.create_secret(p_password,'pastehot-staff-'||p_user_id::text,'Credencial de empleado o encargado de PasteHot');
   insert into private.pastehot_staff_password_vault(user_id,secret_id) values(p_user_id,v_secret)
    on conflict(user_id) do update set secret_id=excluded.secret_id,updated_at=now();
 else
   perform vault.update_secret(v_secret,p_password,'pastehot-staff-'||p_user_id::text,'Credencial de empleado o encargado de PasteHot');
   update private.pastehot_staff_password_vault set updated_at=now() where user_id=p_user_id;
 end if;
end $$;
revoke all on function private.pastehot_store_staff_password(uuid,text) from public,anon,authenticated;
grant execute on function private.pastehot_store_staff_password(uuid,text) to service_role;
create or replace function public.pastehot_store_staff_password(p_user_id uuid,p_password text)
returns void language sql security invoker set search_path=''
as $$select private.pastehot_store_staff_password(p_user_id,p_password)$$;
revoke all on function public.pastehot_store_staff_password(uuid,text) from public,anon,authenticated;
grant execute on function public.pastehot_store_staff_password(uuid,text) to service_role;

create or replace function public.pastehot_get_member_password(p_user_id uuid)
returns text language plpgsql stable security definer set search_path=''
as $$
declare v_password text;
begin
 if not exists(select 1 from private.pastehot_members where user_id=auth.uid() and primary_owner and role='owner' and enabled)
   or not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
 select d.decrypted_secret into v_password
 from private.pastehot_staff_password_vault l
 join private.pastehot_members m on m.user_id=l.user_id and not m.primary_owner and m.role in ('staff','manager')
 join vault.decrypted_secrets d on d.id=l.secret_id
 where l.user_id=p_user_id and m.enabled;
 if v_password is null then raise exception 'CONTRASENA_NO_DISPONIBLE'; end if;
 return v_password;
end $$;
revoke all on function public.pastehot_get_member_password(uuid) from public,anon;
grant execute on function public.pastehot_get_member_password(uuid) to authenticated;

create or replace function private.pastehot_remove_member_password_secret()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 delete from vault.secrets where id in(select secret_id from private.pastehot_staff_password_vault where user_id=old.user_id);
 return old;
end $$;
revoke all on function private.pastehot_remove_member_password_secret() from public,anon,authenticated;
create trigger pastehot_remove_member_password_secret before delete on private.pastehot_staff_password_vault
for each row execute function private.pastehot_remove_member_password_secret();

create or replace function public.pastehot_sales_summary(p_from timestamptz default null,p_to timestamptz default now(),p_customers boolean default false,p_customer_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=''
as $$
declare v_result jsonb;
begin
 if not private.pastehot_owner_allowed() then raise exception 'NO_AUTORIZADO'; end if;
 if p_to is null or (p_from is not null and p_from>=p_to) or p_customer_offset<0 then raise exception 'PERIODO_INVALIDO'; end if;
 with valid as materialized(select * from public.orders where order_status not in ('cancelado','pendiente_confirmacion') and created_at<p_to),
 selected as materialized(select * from valid where p_from is null or created_at>=p_from),
 entries as(select coalesce(p.id::text,nullif(i->>'product_id',''),nullif(i->>'id',''),i->>'name','Producto histórico') as key,
  coalesce(p.name,i->>'name','Producto histórico') as name,coalesce(p.category,i->>'category','') as category,
  case when i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'quantity')::numeric else 0 end as quantity,
  case when i->>'subtotal' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'subtotal')::numeric
   when i->>'price' ~ '^[0-9]+([.][0-9]+)?$' and i->>'quantity' ~ '^[0-9]+([.][0-9]+)?$' then (i->>'price')::numeric*(i->>'quantity')::numeric else 0 end as amount
  from selected o cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items)='array' then o.items else '[]'::jsonb end)i
  left join lateral(select p.* from public.products p where p.id::text=coalesce(nullif(i->>'product_id',''),i->>'id') or (coalesce(nullif(i->>'product_id',''),nullif(i->>'id','')) is null and p.name=i->>'name') order by p.id limit 1)p on true),
 paste_entries as(select * from entries where category !~* 'bebida|refresco|agua|café|cafe|jugo'),
 seeds as(select id::text as key,name,0::numeric as quantity,0::numeric as amount from public.products where coalesce(category,'') !~* 'bebida|refresco|agua|café|cafe|jugo'),
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
    left join public.products p on p.id::text=coalesce(nullif(i->>'product_id',''),nullif(i->>'id',''))
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
revoke all on function public.pastehot_sales_summary(timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.pastehot_sales_summary(timestamptz,timestamptz,boolean,integer) to authenticated;

revoke all on function private.pastehot_staff_schedule_allowed() from public,anon;
grant execute on function private.pastehot_staff_schedule_allowed() to authenticated;
commit;
