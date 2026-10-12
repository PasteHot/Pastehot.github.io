const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const html = '<!doctype html><html><head></head><body><main id="adminScreen"></main></body></html>';
  const foundationSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012113000_multistore_foundation.sql'), 'utf8');
  const rpcSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120000_multistore_rpc_scoping.sql'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://deploy-preview-12--cheerful-daifuku-76579b.netlify.app/admin.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.Headers = global.Headers;
  const selected = '22222222-2222-4222-8222-222222222222';
  window.localStorage.setItem('pastehot_admin_store_id', selected);
  const stores = [
    { id: selected, slug: 'pastehot-norte', name: 'PasteHot Norte', area: 'Norte', is_active: true, can_manage: true },
    { id: '33333333-3333-4333-8333-333333333333', slug: 'pastehot-sur', name: 'PasteHot Sur', area: 'Sur', is_active: true }
  ];
  const calls = [];
  function builder() {
    const query = {
      select(...args) { calls.push(['select', ...args]); return query; },
      eq(...args) { calls.push(['eq', ...args]); return query; },
      insert(...args) { calls.push(['insert', ...args]); return query; },
      upsert(...args) { calls.push(['upsert', ...args]); return query; },
      update(...args) { calls.push(['update', ...args]); return query; },
      delete(...args) { calls.push(['delete', ...args]); return query; },
      single() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
    };
    return query;
  }
  window.db = {
    rpc: async name => name === 'pastehot_list_stores' ? { data: stores, error: null } : { data: true, error: null },
    from: table => { calls.push(['from', table]); return builder(); }
  };
  window.adminRole = 'owner';
  let rpcArgs;
  const originalRpc = window.db.rpc;
  window.db.rpc = async (name, args) => { if (name !== 'pastehot_list_stores') rpcArgs = args; return originalRpc(name, args); };
  window.fetch = async () => ({ ok: true });
  window.eval(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'));

  assert.equal(await window.PasteHotMultiStore.setupAdmin(), true);
  assert.equal(window.document.querySelector('#pastehotStoreBar select').value, selected);
  await window.db.from('products').select('*');
  const insert = { name: 'Paste de prueba' };
  await window.db.from('products').insert(insert).select('id').single();
  await window.db.from('settings').upsert({ key: 'business_name', value: 'PasteHot Norte' }, { onConflict: 'key' });
  await window.db.rpc('validate_delivery_location', { p_lat: 1, p_lng: 2, p_accuracy_m: 3 });
  await window.db.rpc('update_order_status_with_inventory_v2', { p_order_id: 'order-1', p_new_status: 'confirmado' });
  await window.db.rpc('pastehot_sales_summary', { p_from: null });

  assert(calls.some(call => call[0] === 'eq' && call[1] === 'store_id' && call[2] === selected), 'select must be scoped to the active store');
  const productInsert = calls.find(call => call[0] === 'insert')[1];
  assert.equal(productInsert.store_id, selected, 'new rows must carry the selected store id');
  const settingsUpsert = calls.find(call => call[0] === 'upsert');
  assert.equal(settingsUpsert[1].store_id, selected);
  assert.equal(settingsUpsert[2].onConflict, 'store_id,key');
  assert.equal(rpcArgs.p_store_id, selected);
  assert.equal(window.document.querySelector('#pastehotManageStores') !== null, true);
  assert.match(foundationSql, /alter table public\.orders alter column store_id set not null/i);
  assert.match(foundationSql, /create policy order_items_branch_staff_recent/i);
  assert.doesNotMatch(foundationSql, /create policy orders_branch_insert/i, 'checkout must go through its validating RPC');
  const renameSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012130000_multistore_rename_store.sql'), 'utf8');
  assert.match(renameSql, /if not private\.pastehot_primary_owner_allowed\(\) then raise exception 'NO_AUTORIZADO'/i);
  assert.match(renameSql, /update public\.stores\s+set name=v_name\s+where id=p_store_id/i);
  assert.doesNotMatch(renameSql, /delete from|truncate|update public\.(orders|products|customers|settings)/i, 'renaming a branch must not delete or rewrite its store data');
  assert.match(renameSql, /revoke all on function public\.pastehot_rename_store\(uuid,text\) from public,anon/i);
  assert.match(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'), /pastehot_rename_store/);
  assert.match(rpcSql, /create function public\.create_pending_order_with_location_v3\(p_store_id uuid/i);
  assert.match(rpcSql, /where id=v_item\.product_id and store_id=v_store_id/i);
  assert.match(rpcSql, /insert into private\.pastehot_store_events\(store_id,/i);
  assert.match(rpcSql, /create function private\.update_order_status_with_inventory_v2\(p_store_id uuid/i);
  assert.match(rpcSql, /where id = p_order_id and store_id=p_store_id/i);
  assert.match(rpcSql, /create function public\.pastehot_sales_summary\(p_store_id uuid/i);
  assert.match(rpcSql, /from public\.orders where store_id=p_store_id and order_status/i);
  const legacySql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012131000_multistore_disable_legacy_checkout.sql'), 'utf8');
  assert.match(legacySql, /revoke all on function public\.create_pending_order_with_location\(/i);
  assert.match(legacySql, /revoke all on function public\.create_pending_order_with_location_v2\(/i);

  const lifecycleSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012140000_multistore_branch_lifecycle.sql'), 'utf8');
  assert.match(lifecycleSql, /private\.pastehot_primary_owner_allowed\(\)/i, 'only the primary owner may change branch lifecycle');
  assert.match(lifecycleSql, /DEBE_QUEDAR_UNA_SUCURSAL_ACTIVA/i, 'the database must retain an active branch');
  assert.match(lifecycleSql, /NO_SE_PUEDE_ELIMINAR_LA_ULTIMA_SUCURSAL/i, 'the database must retain at least one branch');
  assert.match(lifecycleSql, /auth\.jwt\(\)->>'auth_time'/i, 'permanent deletion must require a recent owner sign-in');
  assert.match(lifecycleSql, /delete from public\.orders where store_id=p_store_id/i, 'orders must be removed before the RESTRICT store foreign key');
  assert.match(lifecycleSql, /on delete cascade/i, 'remaining branch records use cascading foreign keys');
  assert.doesNotMatch(lifecycleSql, /delete\s+from\s+storage\.objects/i, 'storage files must be deleted with the Storage API');

  const pg = new PGlite();
  await pg.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function private.pastehot_primary_owner_allowed() returns boolean language sql stable as $$ select auth.uid() is not null and auth.jwt()->>'is_primary_owner'='true' $$;
    create table public.stores(id uuid primary key,slug text,name text,area text,is_active boolean);
    create table public.products(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade,image_url text);
    create table public.settings(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade,key text,value text);
    create table public.orders(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete restrict);
    create table public.order_items(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade,order_id int references public.orders(id) on delete cascade);
    create table public.customers(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade);
    create table public.delivery_zones(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade);
    create table private.pastehot_store_events(id int generated always as identity primary key,store_id uuid not null references public.stores(id) on delete cascade);
  `);
  const migrationId = '44444444-4444-4444-8444-444444444444';
  const secondId = '55555555-5555-4555-8555-555555555555';
  const ownerId = '99999999-9999-4999-8999-999999999999';
  const sharedImage = 'https://example.supabase.co/storage/v1/object/public/product-images/products/shared.webp';
  const exclusiveImage = 'https://example.supabase.co/storage/v1/object/public/product-images/products/branch.webp';
  await pg.query(`insert into public.stores values ($1,'centro','Centro','',true),($2,'norte','Norte','',true)`, [migrationId, secondId]);
  await pg.query('insert into public.products(store_id,image_url) values ($1,$3),($2,$3),($2,$4)', [migrationId, secondId, sharedImage, exclusiveImage]);
  await pg.query('insert into public.settings(store_id,key,value) values ($1,$2,$3)', [secondId, 'cover_image', sharedImage]);
  await pg.query('insert into public.orders(store_id) values ($1)', [secondId]);
  await pg.query('insert into public.customers(store_id) values ($1)', [secondId]);
  await pg.query('insert into public.delivery_zones(store_id) values ($1)', [secondId]);
  await pg.query('insert into private.pastehot_store_events(store_id) values ($1)', [secondId]);
  await pg.exec(lifecycleSql);
  const setOwnerClaims = async authTime => pg.query('select set_config(\'request.jwt\',$1,false)', [JSON.stringify({ sub: ownerId, is_primary_owner: true, auth_time: authTime })]);
  await setOwnerClaims(Math.floor(Date.now() / 1000));
  const imageUrls = await pg.query('select image_url from public.pastehot_store_image_urls_for_delete($1) order by image_url', [secondId]);
  assert.equal(imageUrls.rows.length, 1);
  assert.equal(imageUrls.rows[0].image_url, exclusiveImage, 'only this branch’s unshared images are scheduled for Storage deletion');
  await pg.query('select public.pastehot_set_store_active($1,false)', [secondId]);
  await assert.rejects(pg.query('select public.pastehot_set_store_active($1,false)', [migrationId]), /DEBE_QUEDAR_UNA_SUCURSAL_ACTIVA/);
  await setOwnerClaims(Math.floor(Date.now() / 1000) - 600);
  await assert.rejects(pg.query('select public.pastehot_delete_store($1)', [secondId]), /REAUTENTICACION_REQUERIDA/);
  await setOwnerClaims(Math.floor(Date.now() / 1000));
  await pg.query('select public.pastehot_delete_store($1)', [secondId]);
  const deletedBranchData = await pg.query(`select (select count(*) from public.stores) as stores,(select count(*) from public.orders) as orders,(select count(*) from public.customers) as customers,(select count(*) from public.delivery_zones) as zones,(select count(*) from private.pastehot_store_events) as events`);
  assert.deepEqual(deletedBranchData.rows[0], { stores: 1, orders: 0, customers: 0, zones: 0, events: 0 });
  await assert.rejects(pg.query('select public.pastehot_delete_store($1)', [migrationId]), /NO_SE_PUEDE_ELIMINAR_LA_ULTIMA_SUCURSAL/);
  await pg.close();

  const deletionDom = new JSDOM(html, { url: 'https://deploy-preview-13--cheerful-daifuku-76579b.netlify.app/admin.html', runScripts: 'outside-only' });
  const deleteWindow = deletionDom.window;
  deleteWindow.Headers = global.Headers;
  deleteWindow.localStorage.setItem('pastehot_admin_store_id', selected);
  const branchToDelete = stores[1];
  const deleteCalls = [];
  deleteWindow.confirm = message => { deleteCalls.push(['confirm', message]); return true; };
  deleteWindow.db = {
    rpc: async (name, args) => {
      deleteCalls.push(['rpc', name, args]);
      if (name === 'pastehot_list_stores') return { data: stores, error: null };
      if (name === 'pastehot_store_image_urls_for_delete') return { data: [{ image_url: 'https://example.supabase.co/storage/v1/object/public/product-images/products/branch%20photo.jpg' }], error: null };
      if (name === 'pastehot_delete_store') return { data: { id: branchToDelete.id }, error: null };
      return { data: { id: args?.p_store_id, slug: branchToDelete.slug, name: branchToDelete.name, area: branchToDelete.area, is_active: false }, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1', email: 'owner@example.com' } }, error: null }),
      signInWithPassword: async ({ email, password }) => {
        deleteCalls.push(['reauth', email, password]);
        return { data: { user: { id: 'owner-1' } }, error: null };
      }
    },
    storage: { from: bucket => ({ remove: async paths => { deleteCalls.push(['remove', bucket, paths]); return { error: null }; } }) },
    from: () => builder()
  };
  deleteWindow.eval(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'));
  assert.equal(await deleteWindow.PasteHotMultiStore.setupAdmin(), true);
  deleteWindow.document.querySelector('#pastehotManageStores').click();
  deleteWindow.document.querySelector(`[data-ph-delete="${branchToDelete.id}"]`).click();
  assert.equal(deleteCalls.filter(call => call[0] === 'confirm').length, 2, 'deletion requires two explicit browser confirmations before password entry');
  assert.match(deleteCalls.find(call => call[0] === 'confirm')[1], /imágenes de Supabase/);
  const passwordModal = deleteWindow.document.querySelector('#phStoreDeletePasswordModal');
  assert(passwordModal, 'third confirmation must request the primary owner password');
  passwordModal.querySelector('input[type=password]').value = 'test-owner-password';
  passwordModal.querySelector('form').dispatchEvent(new deleteWindow.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert(deleteCalls.some(call => call[0] === 'reauth' && call[1] === 'owner@example.com'), 'password must be checked against the signed-in owner account');
  const imageRemoval = deleteCalls.findIndex(call => call[0] === 'remove');
  const databaseDeletion = deleteCalls.findIndex(call => call[0] === 'rpc' && call[1] === 'pastehot_delete_store');
  assert(imageRemoval >= 0 && databaseDeletion > imageRemoval, 'exclusive images are removed through Storage before database deletion');
  assert.equal(Array.from(deleteCalls[imageRemoval][2]).join(','), 'products/branch photo.jpg', 'Storage object paths are URL-decoded before removal');
  assert.equal(deleteWindow.document.querySelector('[data-ph-delete="' + selected + '"]')?.disabled, true, 'the remaining selected branch is not offered for deletion after the branch count falls to one');
  deletionDom.window.close();

  const publicStores = [
    { id: '44444444-4444-4444-8444-444444444444', slug: 'pastehot-centro', name: 'PasteHot Centro', area: 'Centro', is_active: true },
    { id: '55555555-5555-4555-8555-555555555555', slug: 'pastehot-norte', name: 'PasteHot Norte', area: 'Norte', is_active: true },
    { id: '66666666-6666-4666-8666-666666666666', slug: 'pastehot-inactiva', name: 'Sucursal inactiva', area: 'Sur', is_active: false }
  ];
  const publicDom = new JSDOM('<!doctype html><html><head></head><body><main id="menu"></main></body></html>', {
    url: 'https://deploy-preview-12--cheerful-daifuku-76579b.netlify.app/', runScripts: 'outside-only'
  });
  publicDom.window.db = { rpc: async name => name === 'pastehot_list_stores' ? { data: publicStores, error: null } : { data: true, error: null }, from: () => builder() };
  publicDom.window.eval(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'));
  const publicSetup = publicDom.window.PasteHotMultiStore.setupPublic();
  await new Promise(resolve => setImmediate(resolve));
  const picker = publicDom.window.document.querySelector('#pastehotPublicStorePicker');
  assert(picker, 'public menu must ask which branch to use when multiple branches are active');
  assert.match(picker.textContent, /Selecciona la sucursal más cercana a ti/);
  assert.equal(picker.querySelectorAll('option').length, 3, 'picker must show only active branches plus the placeholder');
  picker.querySelector('select').value = '55555555-5555-4555-8555-555555555555';
  picker.querySelector('form').dispatchEvent(new publicDom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(await publicSetup, true);
  assert.equal(publicDom.window.PasteHotStoreId, '55555555-5555-4555-8555-555555555555');
  assert.equal(new URL(publicDom.window.location.href).searchParams.get('sucursal'), 'pastehot-norte');
  publicDom.window.close();

  const singleStoreDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://www.pastehot.com/', runScripts: 'outside-only' });
  singleStoreDom.window.db = { rpc: async () => ({ data: [publicStores[0]], error: null }), from: () => builder() };
  singleStoreDom.window.eval(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'));
  assert.equal(await singleStoreDom.window.PasteHotMultiStore.setupPublic(), true);
  assert.equal(singleStoreDom.window.document.querySelector('#pastehotPublicStorePicker'), null, 'single-store menu must not show the popup');
  singleStoreDom.window.close();

  const linkedStoreDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.pastehot.com/?sucursal=pastehot-norte', runScripts: 'outside-only'
  });
  linkedStoreDom.window.db = { rpc: async () => ({ data: publicStores, error: null }), from: () => builder() };
  linkedStoreDom.window.eval(fs.readFileSync(path.join(__dirname, '../admin-multistore.js'), 'utf8'));
  assert.equal(await linkedStoreDom.window.PasteHotMultiStore.setupPublic(), true);
  assert.equal(linkedStoreDom.window.document.querySelector('#pastehotPublicStorePicker'), null, 'branch-specific links must open directly to that branch');
  assert.equal(linkedStoreDom.window.PasteHotStoreId, '55555555-5555-4555-8555-555555555555');
  linkedStoreDom.window.close();
  dom.window.close();
  console.log('PASS: active store selection scopes reads and writes, exposes owner controls, and prompts public visitors only when branch choice is needed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
