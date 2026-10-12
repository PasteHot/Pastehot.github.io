const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

(async () => {
  const html = '<!doctype html><html><head></head><body><main id="adminScreen"></main></body></html>';
  const foundationSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012113000_multistore_foundation.sql'), 'utf8');
  const rpcSql = [
    fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120000_multistore_rpc_scoping.sql'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120100_multistore_rpc_checkout.sql'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120200_multistore_rpc_delivery_and_store_management.sql'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120300_multistore_rpc_order_transitions.sql'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012120400_multistore_reports_scoping.sql'), 'utf8')
  ].join('\n');
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
  assert.match(rpcSql, /create function public\.create_pending_order_with_location_v3\(p_store_id uuid/i);
  assert.match(rpcSql, /where id=v_item\.product_id and store_id=v_store_id/i);
  assert.match(rpcSql, /insert into private\.pastehot_store_events\(store_id,/i);
  assert.match(rpcSql, /create function private\.update_order_status_with_inventory_v2\(p_store_id uuid/i);
  assert.match(rpcSql, /where id = p_order_id and store_id=p_store_id/i);
  assert.match(rpcSql, /create function public\.pastehot_sales_summary\(p_store_id uuid/i);
  assert.match(rpcSql, /from public\.orders where store_id=p_store_id and order_status/i);
  assert.doesNotMatch(rpcSql, /^\\$function\\$$/m, 'function definitions must end with statement delimiters');
  const renameSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012130000_multistore_rename_store.sql'), 'utf8');
  assert.match(renameSql, /if not private\.pastehot_primary_owner_allowed\(\) then raise exception 'NO_AUTORIZADO'/i);
  assert.match(renameSql, /update public\.stores\s+set name=v_name\s+where id=p_store_id/i);
  assert.doesNotMatch(renameSql, /delete from|truncate|update public\.(orders|products|customers|settings)/i, 'renaming a branch must preserve its store data');
  assert.match(renameSql, /revoke all on function public\.pastehot_rename_store\(uuid,text\) from public,anon/i);
  dom.window.close();
  console.log('PASS: active store selection scopes reads and writes, injects branch RPC arguments, and exposes owner controls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
