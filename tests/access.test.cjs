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
 create table auth.users(id uuid primary key,email text);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid;$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
 create table public.products(id uuid primary key,name text,image_url text,stock integer default 10,updated_at timestamptz);
 create table public.orders(id uuid primary key,order_status text,created_at timestamptz default now(),items jsonb default '[]',inventory_applied boolean default false,inventory_restored boolean default false);
 create table public.categories(id uuid primary key);create table public.customers(id uuid primary key);create table public.order_items(id uuid primary key);create table public.settings(id uuid primary key,key text,value text);create table public.delivery_zones(id uuid primary key,name text,fee numeric,enabled boolean,priority integer,geom extensions.geometry,updated_at timestamptz);
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
 const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261009175922_admin_access_sessions.sql','utf8');await pg.exec(migration);
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
 await login(owner,sid(1));await pg.exec(`select pastehot_set_staff_enabled('${staff}',false);`);
 await login(staff,sid(2));assert.equal((await state()).allowed,false);assert.equal((await pg.query('select * from orders')).rows.length,0);await denied(`select update_order_status_with_inventory('${sid(20)}','cancelado');`);
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
 assert.equal((await pg.query('select * from settings')).rows.length,1);
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
 await pg.exec('reset role;');await pg.exec('set role anon;');await denied('select pastehot_admin_state();');await denied(`select update_order_status_with_inventory('${sid(20)}','cancelado');`);assert.equal((await pg.query('select * from orders')).rows.length,0);
 await pg.exec('reset role;');const exposed=(await pg.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pastehot_%' and p.prosecdef")).rows;assert.equal(exposed.length,0);
 await pg.close();console.log('PASS: real PostgreSQL RLS, unlimited approved browsers, owner lockout guard, manager and staff permissions, protected photo cleanup, role-change reapproval, recent-only history, revoked tokens, disabled staff, auth session deletion, anonymous denial.');
})().catch(e=>{console.error(e);process.exitCode=1;});
