const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('assert/strict');
const owner='a0c0b64b-7809-4428-ad00-a1484d6ded53',staff='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const sid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;create schema extensions;create domain extensions.geometry as jsonb;
 create function extensions.st_asgeojson(extensions.geometry) returns text language sql as $$select $1::text;$$;
 create function extensions.st_setsrid(extensions.geometry,integer) returns extensions.geometry language sql as $$select $1;$$;
 create function extensions.st_geomfromgeojson(text) returns extensions.geometry language sql as $$select $1::jsonb;$$;
 create function extensions.st_geometrytype(extensions.geometry) returns text language sql as $$select 'ST_Polygon';$$;
 create function extensions.st_isvalid(extensions.geometry) returns boolean language sql as $$select true;$$;
 create table auth.users(id uuid primary key,email text);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid;$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
 create table public.products(id uuid primary key,name text,description text,category text,price numeric,image_url text,available boolean default true,stock integer default 10,updated_at timestamptz);
 create table public.orders(id uuid primary key,order_status text,created_at timestamptz default now(),items jsonb default '[]',inventory_applied boolean default false,inventory_restored boolean default false);
 create table public.categories(id uuid primary key);create table public.customers(id uuid primary key);create table public.order_items(id uuid primary key);create table public.settings(id uuid primary key default gen_random_uuid(),key text unique,value text,updated_at timestamptz default now());create table public.delivery_zones(id uuid primary key,name text,fee numeric,enabled boolean,priority integer,geom extensions.geometry,updated_at timestamptz);
 create table storage.objects(id uuid primary key,bucket_id text,name text);
 insert into auth.users values('${owner}','owner@example.invalid'),('${staff}','staff@example.invalid'),('${other}','other@example.invalid');
 insert into auth.sessions values('${sid(1)}','${owner}'),('${sid(2)}','${staff}'),('${sid(3)}','${owner}'),('${sid(4)}','${other}');
 grant usage on schema public,storage to authenticated,anon;grant all on all tables in schema public,storage to authenticated,anon;`);
 const names={products:'Authenticated users can manage products',categories:'Authenticated users can manage categories',customers:'Authenticated users can manage customers',order_items:'Authenticated users can manage order items',settings:'Authenticated users can manage settings',orders:'Authenticated users can manage orders',delivery_zones:'Authenticated admin can manage delivery zones'};
 for(const [table,name] of Object.entries(names))await pg.exec(`alter table public.${table} enable row level security;create policy "${name}" on public.${table} for all to authenticated using(auth.uid()='${owner}') with check(auth.uid()='${owner}');`);
 await pg.exec(`create policy "Public can view products" on public.products for select to anon,authenticated using(true);alter table storage.objects enable row level security;
 create policy "Authenticated users can delete product images" on storage.objects for delete to authenticated using(bucket_id='product-images' and auth.uid()='${owner}');
 create policy "Authenticated users can update product images" on storage.objects for update to authenticated using(bucket_id='product-images' and auth.uid()='${owner}') with check(bucket_id='product-images' and auth.uid()='${owner}');
 create policy "Authenticated users can upload product images" on storage.objects for insert to authenticated with check(bucket_id='product-images' and auth.uid()='${owner}');
 create policy "Public can view product images" on storage.objects for select to anon,authenticated using(bucket_id='product-images');
 create function public.update_order_status_with_inventory(p_order_id uuid,p_new_status text) returns jsonb language plpgsql as $$begin return '{}'::jsonb;end;$$;
 insert into orders(id,order_status,created_at) values('${sid(20)}','pendiente_confirmacion',now()),('${sid(21)}','entregado',now()-interval '3 days');
 insert into products(id,name) values('${sid(30)}','Paste de prueba');
 insert into storage.objects values('${sid(40)}','product-images','products/existing.webp');`);
 await pg.exec(`create function public.admin_list_delivery_zones() returns jsonb language sql as $$select '[]'::jsonb;$$;create function public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb) returns jsonb language sql as $$select '{}'::jsonb;$$;`);
 await pg.exec(`create function public.create_order_with_inventory(text,text,text,text,text,text,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb;$$;`);
 await pg.exec(`alter table public.orders add column if not exists order_code text,add column if not exists customer_name text,add column if not exists customer_phone text,add column if not exists items jsonb,add column if not exists total numeric,add column if not exists subtotal numeric;alter table public.products add column if not exists category text;`);
 const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261009175922_admin_access_sessions.sql','utf8');await pg.exec(migration);
 await pg.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261009212843_admin_session_management.sql','utf8'));
 async function login(uid,session){currentSession=Number(session.slice(-12));await pg.exec('reset role;');await pg.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid,session_id:session,role:'authenticated'})]);await pg.exec('set role authenticated;');}
 let currentSession=1;const token=n=>n.toString(16).padStart(64,'0');
 async function state(device=currentSession){return (await pg.query("select public.pastehot_admin_state('Prueba',true,$1) as s",[token(device)])).rows[0].s;}
 async function denied(sql){await assert.rejects(pg.exec(sql));}
 await login(owner,sid(1));let first=await state();const d1=first.device_id;assert.equal(first.allowed,true);await pg.exec('select public.pastehot_activate_security();');assert.equal((await state()).enforced,true);
 await pg.query('select public.pastehot_add_staff($1,$2)',['staff@example.invalid','Empleado']);
 await login(staff,sid(2));const d2=(await state()).device_id;assert.equal((await state()).allowed,false);assert.equal((await pg.query('select * from orders')).rows.length,0);await denied(`select update_order_status_with_inventory('${sid(20)}','confirmado');`);
 await login(other,sid(4));assert.equal((await state()).allowed,false);
 await login(owner,sid(3));const d3=(await state()).device_id;assert.equal((await state()).allowed,false);await denied(`select pastehot_set_session('${d2}','approved');`);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_session('${d2}','approved');`);await pg.exec(`select pastehot_set_session('${d3}','approved');`);assert.equal((await state()).sessions.filter(s=>s.status==='approved').length,3);await denied(`select pastehot_set_session('${d1}','revoked');`);
 await login(staff,sid(2));assert.equal((await state()).allowed,true);await denied("select create_order_with_inventory('','','','','','','','[]');");await denied('select admin_list_delivery_zones();');await denied(`select admin_save_delivery_zone('${sid(50)}',1,true,null);`);assert.equal((await pg.query('select * from orders')).rows.length,1);
 assert.equal((await pg.query("update products set name='MAL' returning id")).rows.length,0);assert.equal((await pg.query('delete from products returning id')).rows.length,0);
 assert.equal((await pg.query('delete from storage.objects returning id')).rows.length,0);assert.equal((await pg.query('select * from customers')).rows.length,0);
 assert.equal((await pg.query("update orders set order_status='cancelado' returning id")).rows.length,0);
 await denied(`select update_order_status_with_inventory('${sid(20)}','cancelado');`);await denied(`select update_order_status_with_inventory('${sid(21)}','confirmado');`);
 await pg.exec(`select update_order_status_with_inventory('${sid(20)}','confirmado');select update_order_status_with_inventory('${sid(20)}','preparando');select update_order_status_with_inventory('${sid(20)}','listo');select update_order_status_with_inventory('${sid(20)}','entregado');`);
 // Employee closure/reopening is atomic and attributed to the authenticated member.
 await login(owner,sid(1));await pg.query("insert into settings(key,value) values('weekly_schedule',$1)",[JSON.stringify(Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(d=>[d,{enabled:true,open:'00:00',close:'00:00'}])))]);
 await login(staff,sid(2));assert.equal((await pg.query('select pastehot_store_state() as s')).rows[0].s.manual_closed,false);
 await denied("select pastehot_set_store_closed(true,'x',false);");assert.equal((await pg.query('select pastehot_store_state() as s')).rows[0].s.manual_closed,false);
 let closedResult=(await pg.query("select pastehot_set_store_closed(true,'Fuga de agua en la cocina',false) as s")).rows[0].s;assert.equal(closedResult.changed,true);assert.equal(closedResult.manual_closed,true);
 await denied('select pastehot_store_history();');await denied('select * from private.pastehot_store_events;');
 assert.equal((await pg.query("update settings set value='false' where key='store_manual_closed' returning id")).rows.length,0);await denied("insert into settings(key,value) values('weekly_schedule','MAL');");
 await denied("select pastehot_set_store_closed(false,'Problema resuelto',false);"); // Stale state cannot reopen another person's closure.
 assert.equal((await pg.query("select pastehot_set_store_closed(true,'Doble clic de cierre',true) as s")).rows[0].s.changed,false);
 await login(owner,sid(1));let storeLog=(await pg.query('select pastehot_store_history() as s')).rows[0].s;assert.equal(storeLog.events.length,1);assert.equal(storeLog.events[0].actor_name,'Empleado');assert.equal(storeLog.events[0].actor_role,'staff');assert.equal(storeLog.events[0].during_hours,true);
 await denied('delete from private.pastehot_store_events;');assert.equal((await pg.query("update settings set value='false' where key='store_manual_closed' returning id")).rows.length,0);await denied("insert into orders(id,order_status) values('00000000-0000-4000-8000-000000000999','pendiente_confirmacion');");
 await login(staff,sid(2));assert.equal((await pg.query("select pastehot_set_store_closed(false,'Fuga reparada, operación segura',true) as s")).rows[0].s.manual_closed,false);
 await login(owner,sid(1));storeLog=(await pg.query('select pastehot_store_history() as s')).rows[0].s;assert.equal(storeLog.events.length,2);assert.equal(storeLog.events[0].closed,false);assert.equal(storeLog.events[1].closed,true);
 await denied("update private.pastehot_store_events set actor_name='MAL';");
 const localDay=(await pg.query("select (now() at time zone 'America/Merida')::date::text as day")).rows[0].day;assert.equal((await pg.query('select pastehot_store_history($1,0,true) as s',[localDay])).rows[0].s.events.length,2);assert.equal((await pg.query("select pastehot_store_history('2000-01-01') as s")).rows[0].s.events.length,0);
 await pg.query("update settings set value=$1 where key='weekly_schedule'",[JSON.stringify(Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(d=>[d,{enabled:false,open:'00:00',close:'00:00'}]))) ]);
 await login(staff,sid(2));await pg.exec("select pastehot_set_store_closed(true,'Prueba fuera del horario laboral',false);select pastehot_set_store_closed(false,'Restablecimiento fuera del horario',true);");
 assert.equal((await pg.query('select pastehot_store_state() as s')).rows[0].s.open,false); // Reopening does not override schedules.
 await login(owner,sid(1));storeLog=(await pg.query('select pastehot_store_history() as s')).rows[0].s;assert.equal(storeLog.events.length,4);assert.equal(storeLog.events[0].during_hours,false);assert.equal((await pg.query('select pastehot_store_history(null,0,true) as s')).rows[0].s.events.length,2);
 // A failing audit insert rolls back the actual closure in the same transaction.
 await pg.exec('reset role;');await pg.exec("create function private.fixture_fail_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_UNAVAILABLE';end;$$;create trigger fixture_fail_audit before insert on private.pastehot_store_events for each row execute function private.fixture_fail_audit();");
 await login(staff,sid(2));await denied("select pastehot_set_store_closed(true,'Simular falla del registro',false);");assert.equal((await pg.query('select pastehot_store_state() as s')).rows[0].s.manual_closed,false);
 await pg.exec('reset role;');await pg.exec('drop trigger fixture_fail_audit on private.pastehot_store_events;drop function private.fixture_fail_audit();');
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_enabled('${staff}',false);`);
 await login(staff,sid(2));assert.equal((await state()).allowed,false);assert.equal((await pg.query('select * from orders')).rows.length,0);await denied("select pastehot_set_store_closed(true,'Intento de cuenta desactivada',false);");await denied(`select update_order_status_with_inventory('${sid(20)}','cancelado');`);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_enabled('${staff}',true);`);
 await login(staff,sid(2));assert.equal((await state()).status,'revoked');assert.equal((await state()).allowed,false);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_session('${d3}','approved');`);
 await login(owner,sid(3));assert.equal((await state()).allowed,true);
 // A fourth approved browser has manager permissions, while pending/disabled browsers have none.
 await login(owner,sid(1));await pg.query('select pastehot_add_staff($1,$2,$3)',['other@example.invalid','Encargado','manager']);
 await denied(`select pastehot_set_staff_role('${owner}','manager');`);await denied(`select pastehot_set_staff_role('${staff}','owner');`);
 await pg.exec(`insert into orders(id,order_status) values('${sid(22)}','pendiente_confirmacion');update products set image_url='https://example.invalid/storage/v1/object/public/product-images/products/existing.webp';insert into settings(id,key,value) values('${sid(70)}','categories','[]'),('${sid(71)}','cover_image','https://example.invalid/storage/v1/object/public/product-images/products/cover.webp');insert into storage.objects values('${sid(41)}','product-images','design/cover.webp'),('${sid(42)}','product-images','products/cover.webp');`);
 await login(other,sid(4));const d4=(await state()).device_id;assert.equal((await state()).allowed,false);assert.equal((await pg.query("update products set name='DENIED' returning id")).rows.length,0);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_session('${d2}','approved');select pastehot_set_session('${d4}','approved');`);assert.equal((await state()).sessions.filter(s=>s.status==='approved').length,4);
 await login(other,sid(4));assert.equal((await state()).role,'manager');assert.equal((await state()).allowed,true);
 assert.equal((await pg.query("update products set name='Nuevo precio/foto' returning id")).rows.length,1);
 await pg.exec(`insert into products(id,name) values('${sid(31)}','Producto del encargado');`);
 assert.equal((await pg.query('delete from products returning id')).rows.length,0);
 assert.equal((await pg.query('select * from customers')).rows.length,0);assert.equal((await pg.query('select * from orders')).rows.length,2);
 assert.equal((await pg.query("select * from settings where key='categories'")).rows.length,1);assert.equal((await pg.query('select pastehot_store_history() as s')).rows[0].s.events.length,4);await pg.exec("select pastehot_set_store_closed(true,'Cierre del encargado por emergencia',false);select pastehot_set_store_closed(false,'Encargado restablece la operación',true);");
 assert.equal((await pg.query("update settings set value='MAL' returning id")).rows.length,0);
 await denied(`select pastehot_set_session('${d2}','approved');`);await denied(`select pastehot_set_staff_role('${staff}','manager');`);await denied(`select pastehot_add_staff('staff@example.invalid','Otro','staff');`);
 await denied(`select update_order_status_with_inventory('${sid(22)}','cancelado');`);await pg.exec(`select update_order_status_with_inventory('${sid(22)}','confirmado');`);
 await pg.exec(`insert into storage.objects values('${sid(43)}','product-images','products/new.webp');`);
 await denied(`insert into storage.objects values('${sid(44)}','product-images','design/new.webp');`);
 assert.equal((await pg.query("delete from storage.objects where name='products/existing.webp' returning id")).rows.length,0); // Still used by a product.
 assert.equal((await pg.query("delete from storage.objects where name='products/cover.webp' returning id")).rows.length,0); // Still used by design.
 assert.equal((await pg.query("delete from storage.objects where name='design/cover.webp' returning id")).rows.length,0);
 assert.equal((await pg.query("update storage.objects set name='products/overwrite.webp' returning id")).rows.length,0);
 await pg.exec(`update products set image_url='https://example.invalid/storage/v1/object/public/product-images/products/new.webp' where id='${sid(30)}';`);
 assert.equal((await pg.query("delete from storage.objects where name='products/existing.webp' returning id")).rows.length,1); // Replaced photo is now safe to remove.
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_role('${other}','staff');`);
 await login(other,sid(4));assert.equal((await state()).allowed,false);assert.equal((await pg.query("update products set name='DENIED' returning id")).rows.length,0);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_session('${d4}','approved');`);
 await login(other,sid(4));assert.equal((await state()).allowed,true);assert.equal((await state()).role,'staff');assert.equal((await pg.query("update products set name='DENIED' returning id")).rows.length,0);
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_role('${other}','manager');`);
 await login(other,sid(4));assert.equal((await state()).allowed,false); // Promotion never silently authorizes a browser.
 await login(owner,sid(1));await pg.exec(`select pastehot_set_session('${d4}','approved');select pastehot_set_staff_enabled('${other}',false);`);
 await login(other,sid(4));assert.equal((await state()).allowed,false);await denied(`insert into storage.objects values('${sid(45)}','product-images','products/disabled.webp');`);
 await pg.exec('reset role;');await pg.exec(`delete from auth.sessions where id='${sid(3)}';`);
 await login(owner,sid(3));await denied(`select pastehot_admin_state();`);assert.equal((await pg.query("update products set name='MAL' returning id")).rows.length,0);
 await pg.exec('reset role;');await pg.exec(`insert into auth.sessions values('${sid(6)}','${owner}'),('${sid(7)}','${owner}');`);
 await login(owner,sid(6));assert.equal((await state()).allowed,false); // Password alone on a different browser stays pending.
 await login(owner,sid(7));assert.equal((await state(3)).allowed,true); // Same approved browser survives logout/relogin.
 assert.equal((await state(3)).device_id,d3);

 await login(owner,sid(1));
 await pg.exec(`update public.orders set created_at='2025-01-01';update public.products set category='Pastes salados' where id='${sid(30)}';
 insert into public.products(id,name,category) values('${sid(60)}','Paste sin ventas','Pastes dulces'),('${sid(61)}','Agua','Bebidas');
 insert into public.orders(id,order_status,created_at,order_code,customer_name,customer_phone,items,total,subtotal) values
 ('${sid(62)}','entregado','2026-10-09 05:59:00+00','VENTA-001','Prueba','9990000000','[{"product_id":"${sid(30)}","name":"Paste de prueba","quantity":3,"price":25,"subtotal":75},{"product_id":"${sid(61)}","name":"Agua","quantity":1,"price":20,"subtotal":20}]',105,95),
 ('${sid(63)}','cancelado','2026-10-09 06:01:00+00','VENTA-002','Prueba','9990000000','[{"product_id":"${sid(30)}","quantity":99,"price":25}]',2475,2475),
 ('${sid(64)}','pendiente_confirmacion','2026-10-09 06:02:00+00','VENTA-003','Prueba','9990000000','[{"product_id":"${sid(30)}","quantity":99,"price":25}]',2475,2475),
 ('${sid(65)}','entregado','2026-10-09 06:03:00+00','VENTA-004','Prueba','9990000000','[{"product_id":"${sid(30)}","quantity":2,"price":30,"subtotal":60}]',60,60);`);
 const summary=(await pg.query("select pastehot_sales_summary('2026-10-09 00:00:00+00','2026-10-10 00:00:00+00',true,0) as s")).rows[0].s;
 assert.equal(summary.orders,2);assert.equal(summary.total,165);assert.equal(summary.pastes.find(p=>p.key===sid(30)).quantity,5);assert.equal(summary.pastes.find(p=>p.key===sid(30)).amount,135);assert.equal(summary.pastes.find(p=>p.key===sid(60)).quantity,0);assert(!summary.pastes.find(p=>p.key===sid(61)));assert.equal(summary.daily.length,2);assert.equal(summary.daily[0].day,'2026-10-08');assert.equal(summary.customer_count,1);assert.equal(summary.customers[0].count,2);
 await pg.exec(`insert into public.orders(id,order_status,created_at,order_code,items,total,subtotal) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'entregado','2026-10-08 18:00:00+00','PAGINA-'||n,'[]',0,0 from generate_series(100,154)n;`);
 const page=(await pg.query("select pastehot_order_page('2026-10-08','PAGINA',null,null) as p")).rows[0].p;assert.equal(page.rows.length,50);assert.equal(page.has_more,true);const last=page.rows.at(-1);
 const next=(await pg.query("select pastehot_order_page('2026-10-08','PAGINA',$1,$2) as p",[last.created_at,last.id])).rows[0].p;assert.equal(next.rows.length,5);assert.equal(next.has_more,false);assert(!next.rows.some(o=>page.rows.some(p=>o.id===p.id)));
 assert.equal((await pg.query("select pastehot_order_page(null,'VEnTa 001',null,null) as p")).rows[0].p.rows.length,1);
 await login(owner,sid(6));await denied('select pastehot_sales_summary();');await denied('select pastehot_order_page();');
 await login(staff,sid(2));await denied('select pastehot_sales_summary();');
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_enabled('${staff}',true);select pastehot_set_session('${d2}','approved');`);await login(staff,sid(2));await state();await denied('select pastehot_sales_summary();');assert.equal((await pg.query("select pastehot_order_page(null,'VENTA',null,null) as p")).rows[0].p.rows.length,4);
 await pg.exec('reset role;');await pg.exec('set role anon;');await denied('select pastehot_sales_summary();');await denied('select pastehot_order_page();');await denied('select pastehot_admin_state();');await denied('select pastehot_store_state();');await denied('select pastehot_store_history();');await denied("select pastehot_set_store_closed(true,'Intento anónimo',false);");await denied(`select update_order_status_with_inventory('${sid(20)}','cancelado');`);assert.equal((await pg.query('select * from orders')).rows.length,0);
 await pg.exec('reset role;');const exposed=(await pg.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pastehot_%' and p.prosecdef")).rows;assert.equal(exposed.length,0);
 // Device management must preserve authorization and immutable store history.
 await login(owner,sid(1));
 await pg.query('select pastehot_rename_session($1,$2)',[d1,'Mi celular']);
 await pg.query('select pastehot_rename_session($1,$2)',[d3,'Tablet renombrada']);
 await login(owner,sid(7));
 const renamed=(await pg.query("select pastehot_admin_state('Nombre antiguo',true,$1) as s",[token(3)])).rows[0].s;
 assert.equal(renamed.device_label,'Tablet renombrada');
 await login(owner,sid(1));
 await denied(`select pastehot_remove_session('${d1}');`);
 await pg.query('select pastehot_set_session($1,$2)',[d3,'approved']);
 await denied(`select pastehot_remove_session('${d3}');`);
 await denied(`select pastehot_rename_session('${d3}','   ');`);
 await denied(`select pastehot_rename_session('${d3}',repeat('x',61));`);
 const historyCount=(await pg.query('select pastehot_store_history() as h')).rows[0].h.events.length;
 await pg.query('select pastehot_set_session($1,$2)',[d3,'revoked']);
 await pg.query('select pastehot_remove_session($1)',[d3]);
 assert(!(await state()).sessions.some(s=>s.session_id===d3));
 assert.equal((await pg.query('select pastehot_store_history() as h')).rows[0].h.events.length,historyCount);
 await login(owner,sid(7));const returning=await state(3);assert.equal(returning.status,'pending');assert.equal(returning.allowed,false);assert.notEqual(returning.device_id,d3);
 await denied(`select pastehot_rename_session('${d1}','Intento sin aprobación');`);
 await login(staff,sid(2));await denied(`select pastehot_rename_session('${d1}','Intento de empleado');`);await denied(`select pastehot_remove_session('${d1}');`);
 await pg.exec('reset role;set role anon;');await denied(`select pastehot_rename_session('${d1}','Intento anónimo');`);await denied(`select pastehot_remove_session('${d1}');`);
 // The new migration enables account-based admission while keeping server-enforced roles.
 await pg.exec('reset role;');
 await pg.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261009223804_direct_staff_credentials.sql','utf8'));
 await pg.exec(`insert into settings(key,value) values('categories','["Pastes"]'),('business_name','PasteHot'),('bank_clabe','000000000000000000'),('delivery_transfer_only','false'),('rain_surcharge_enabled','false'),('batch_timer_enabled','false'),('weekly_schedule','{}') on conflict(key) do update set value=excluded.value;`);
 await pg.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261010033445_owner_manager_scope_and_credential_reset.sql','utf8'));
 await pg.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261010052000_manager_employee_account_controls.sql','utf8'));
 await pg.exec(`insert into auth.sessions values('${sid(401)}','${owner}'),('${sid(402)}','${staff}');`);
 await login(owner,sid(401));let direct=await state(401);assert.equal(direct.allowed,true);assert.equal(direct.direct_access,true);assert.equal(direct.status,'approved');
 await pg.exec(`select pastehot_set_staff_enabled('${staff}',true);select pastehot_set_staff_role('${staff}','staff');`);
 await login(staff,sid(402));assert.equal((await state(402)).allowed,true);assert.equal((await pg.query('select * from customers')).rows.length,0);await denied(`select pastehot_set_staff_enabled('${staff}',false);`);
 await login(owner,sid(401));await pg.exec(`select pastehot_set_staff_enabled('${staff}',false);`);
 await login(staff,sid(402));assert.equal((await state(402)).allowed,false);assert.equal((await pg.query('select * from orders')).rows.length,0);await denied(`select pastehot_set_store_closed(true,'Intento con cuenta desactivada',false);`);
 await login(other,sid(4));assert.equal((await state(4)).allowed,false);
 await login(owner,sid(401));await pg.exec(`select pastehot_set_staff_enabled('${staff}',true);select pastehot_set_staff_role('${staff}','manager');`);
 await login(staff,sid(402));assert.equal((await state(402)).role,'manager');assert.equal((await state(402)).allowed,true);assert((await pg.query("update products set available=false returning id")).rows.length>0);await denied("update products set name='Cambio prohibido'");assert.equal((await pg.query(`delete from products where id='${sid(30)}' returning id`)).rows.length,0);assert.equal((await pg.query("update settings set value='Nueva clave' where key='bank_clabe' returning id")).rows.length,0);assert.equal((await pg.query("update settings set value='true' where key='delivery_transfer_only' returning id")).rows.length,1);assert.equal((await pg.query("update settings set value='true' where key='rain_surcharge_enabled' returning id")).rows.length,1);assert.equal((await pg.query("update settings set value='true' where key='batch_timer_enabled' returning id")).rows.length,1);assert.equal((await pg.query("update settings set value='{}' where key='weekly_schedule' returning id")).rows.length,0);assert((await pg.query("select pastehot_add_category('Pastes dulces')")).rows[0]);assert.equal((await pg.query("update settings set value='[\\\"otra\\\"]' where key='categories' returning id")).rows.length,0);await denied('select pastehot_sales_summary();');
 const managerWorker=sid(406),managerWorkerSession=sid(407),managerWorkerSession2=sid(408),managerPeer=sid(409);
 await pg.exec('reset role;');await pg.exec(`insert into auth.users values('${managerWorker}','staff+mariana@accounts.pastehot.com'),('${managerPeer}','staff+managerpeer@accounts.pastehot.com');insert into auth.sessions values('${managerWorkerSession}','${managerWorker}');`);
 await login(owner,sid(401));await pg.query("select pastehot_add_staff('staff+managerpeer@accounts.pastehot.com','Encargado de prueba secundaria','staff')");await pg.query(`select pastehot_set_staff_role('${managerPeer}','manager')`);
 await login(staff,sid(402));
 const visibleStaff=(await pg.query('select pastehot_manager_staff_accounts() as members')).rows[0].members;assert(!visibleStaff.some(m=>m.user_id===managerWorker));assert(!visibleStaff.some(m=>m.user_id===managerPeer));assert(!visibleStaff.some(m=>m.user_id===owner||m.user_id===staff));
 const createdStaff=(await pg.query("select pastehot_manager_add_staff('staff+mariana@accounts.pastehot.com','Mariana') as m")).rows[0].m;assert.equal(createdStaff.role,'staff');assert((await pg.query('select pastehot_manager_staff_accounts() as members')).rows[0].members.some(m=>m.user_id===managerWorker));
 await denied(`select pastehot_manager_set_staff_enabled('${owner}',false);`);await denied(`select pastehot_manager_set_staff_enabled('${staff}',false);`);
 await denied(`select pastehot_manager_set_staff_enabled('${managerPeer}',false);`);
 await pg.query('select pastehot_manager_set_staff_enabled($1,false)',[managerWorker]);assert.equal((await pg.query('select pastehot_manager_staff_accounts() as members')).rows[0].members.find(m=>m.user_id===managerWorker).enabled,false);
 await login(staff,sid(402));await pg.query('select pastehot_manager_revoke_staff_sessions($1)',[managerWorker]);await login(managerWorker,managerWorkerSession);await assert.rejects(state(managerWorkerSession));
 await login(staff,sid(402));await denied(`select pastehot_manager_revoke_staff_sessions('${owner}');`);await denied(`select pastehot_manager_revoke_staff_sessions('${staff}');`);await denied(`select pastehot_manager_revoke_staff_sessions('${managerPeer}');`);
 await pg.exec('reset role;');await pg.exec(`insert into auth.sessions values('${managerWorkerSession2}','${managerWorker}');`);await login(managerWorker,managerWorkerSession2);assert.equal((await state(managerWorkerSession2)).allowed,false);await denied('select pastehot_manager_staff_accounts();');
 await login(staff,sid(402));await pg.query('select pastehot_manager_set_staff_enabled($1,true)',[managerWorker]);assert.equal((await pg.query('select pastehot_manager_staff_accounts() as members')).rows[0].members.find(m=>m.user_id===managerWorker).enabled,true);
 await login(owner,sid(401));await denied('select pastehot_manager_staff_accounts();');await denied("select pastehot_manager_add_staff('owner@example.invalid','Externo');");
 await pg.exec('reset role;');await pg.exec(`delete from auth.sessions where id='${sid(402)}';`);
 await login(staff,sid(402));await denied('select pastehot_admin_state();');assert.equal((await pg.query('select * from orders')).rows.length,0);
 // Hard account deletion removes linked identity and audit, preserving business data.
 await pg.exec('reset role;');
 const ordersBefore=(await pg.query('select count(*)::int as n from public.orders')).rows[0].n;
 const othersBefore=(await pg.query('select count(*)::int as n from private.pastehot_store_events where actor_id<>$1',[staff])).rows[0].n;
 assert((await pg.query('select count(*)::int as n from private.pastehot_store_events where actor_id=$1',[staff])).rows[0].n>0);
 await assert.rejects(pg.query('delete from auth.users where id=$1',[owner]));
 assert.equal((await pg.query('select count(*)::int as n from private.pastehot_members where user_id=$1',[owner])).rows[0].n,1);
 await pg.query('delete from auth.users where id=$1',[staff]);
 for(const table of ['auth.users','auth.sessions','private.pastehot_members','private.pastehot_sessions']){
   const key=table==='auth.users'?'id':'user_id';assert.equal((await pg.query(`select count(*)::int as n from ${table} where ${key}=$1`,[staff])).rows[0].n,0);
 }
 assert.equal((await pg.query('select count(*)::int as n from private.pastehot_store_events where actor_id=$1',[staff])).rows[0].n,0);
 assert.equal((await pg.query('select count(*)::int as n from private.pastehot_store_events where actor_id<>$1',[staff])).rows[0].n,othersBefore);
 assert.equal((await pg.query('select count(*)::int as n from public.orders')).rows[0].n,ordersBefore);
 await login(staff,sid(2));await denied('select pastehot_admin_state();');assert.equal((await pg.query('select * from orders')).rows.length,0);
 // Delegation grants full owner operations without transferring root control.
 await login(owner,sid(401));await pg.exec(`select pastehot_set_staff_role('${other}','owner');select pastehot_set_staff_enabled('${other}',true);`);
 await pg.exec('reset role;');await pg.exec(`insert into auth.sessions values('${sid(403)}','${other}');insert into auth.users values('${sid(410)}','third@example.invalid');`);
 await login(other,sid(403));const delegated=await state(403);assert.equal(delegated.allowed,true);assert.equal(delegated.role,'owner');assert.equal(delegated.primary_owner,false);assert(delegated.members.find(m=>m.user_id===owner).primary_owner);assert.equal((await pg.query("update settings set value='Otra cuenta' where key='bank_clabe' returning id")).rows.length,0);assert.equal((await pg.query("update settings set value='Otro nombre' where key='business_name' returning id")).rows.length,0);
 assert((await pg.query('select * from orders')).rows.length>0);await pg.query('select pastehot_sales_summary()');
 assert((await pg.query("update products set name='Cambio por propietario delegado' returning id")).rows.length>0);
 await denied(`select pastehot_set_staff_enabled('${owner}',false);`);await denied(`select pastehot_set_staff_role('${owner}','staff');`);await denied(`select pastehot_set_staff_enabled('${other}',false);`);
 await denied(`select pastehot_rename_session('${d1}','No puede cambiar el dispositivo principal');`);
 await denied("select pastehot_add_staff('third@example.invalid','Tercer propietario','owner');");
 await pg.query("select pastehot_add_staff('third@example.invalid','Nuevo encargado','manager');");
 await pg.exec('reset role;');await assert.rejects(pg.query('update private.pastehot_members set primary_owner=true where user_id=$1',[other]));await assert.rejects(pg.query("update private.pastehot_members set role='staff' where user_id=$1",[owner]));
 await login(owner,sid(401));await pg.query('select pastehot_set_staff_enabled($1,false)',[other]);
 await login(other,sid(403));assert.equal((await state(403)).allowed,false);assert.equal((await pg.query('select * from orders')).rows.length,0);
 await login(owner,sid(401));await pg.query('select pastehot_set_staff_enabled($1,true)',[other]);
 await pg.exec('reset role;');await pg.query('delete from auth.users where id=$1',[other]);
 await login(owner,sid(401));assert.equal((await state(401)).allowed,true);assert.equal((await state(401)).primary_owner,true);
 // Preview status API preserves authorization and inventory under repeated changes.
 await pg.exec('reset role;');await pg.exec(`alter table orders add column delivery_type text default 'delivery';`);
 await pg.exec(fs.readFileSync(__dirname+'/../supabase/migrations/20261010015600_order_pickup_status_preview.sql','utf8'));
 const worker=sid(500),workSession=sid(501),order=sid(502),pickup=sid(503),product=sid(504);
 await pg.exec(`insert into auth.users values('${worker}','worker@example.invalid');insert into auth.sessions values('${workSession}','${worker}');insert into private.pastehot_members(user_id,display_name,role,enabled) values('${worker}','Prueba','staff',true);
 insert into products(id,name,stock) values('${product}','Paste con inventario',10);
 insert into orders(id,order_status,delivery_type,items) values('${order}','pendiente_confirmacion','delivery','[{"product_id":"${product}","quantity":2,"stock_tracked":true}]'),('${pickup}','listo','pickup','[]');`);
 await login(worker,workSession);assert.equal((await state(501)).allowed,true);
 const change=status=>pg.query('select update_order_status_with_inventory_v2($1,$2)',[order,status]);
 await denied(`select update_order_status_with_inventory_v2('${pickup}','en_reparto');`);
 await change('confirmado');await change('confirmado');assert.equal((await pg.query('select stock from products where id=$1',[product])).rows[0].stock,8);
 await change('preparando');await change('listo');await change('en_reparto');await change('cancelado');await change('cancelado');assert.equal((await pg.query('select stock from products where id=$1',[product])).rows[0].stock,10);
 await assert.rejects(change('confirmado'),/ESTADO_NO_PERMITIDO/);
 await login(owner,sid(401));await change('confirmado');assert.equal((await pg.query('select stock from products where id=$1',[product])).rows[0].stock,8);
 await change('entregado');await login(worker,workSession);await assert.rejects(change('cancelado'),/ESTADO_NO_PERMITIDO/);
 await denied(`select update_order_status_with_inventory_v2('${sid(21)}','confirmado');`);
 await login(owner,sid(401));await pg.query('select pastehot_set_staff_enabled($1,false)',[worker]);
 await login(worker,workSession);await assert.rejects(change('entregado'),/NO_AUTORIZADO/);
 await pg.exec('reset role;set role anon;');await assert.rejects(change('cancelado'),/permission denied/);
 await pg.close();console.log('PASS: real PostgreSQL RLS, protected ownership, revoked accounts; preview employee delivery/cancellation transitions, pickup delivery denial, idempotent stock restoration and confirmation, old-order denial and anonymous denial.');
})().catch(e=>{console.error(e);process.exitCode=1;});
