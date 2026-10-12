/* Multi-store selector and owner controls. Backend support ships in the paired SQL migration. */
(function () {
  'use strict';
  const ADMIN_KEY = 'pastehot_admin_store_id';
  const PUBLIC_KEY = 'pastehot_public_store_id';
  const DEFAULT_DEMO_STORES = [
    { id: '44444444-4444-4444-8444-444444444444', slug: 'pastehot-principal', name: 'PasteHot · Principal', area: 'Centro', is_active: true, can_manage: true },
    { id: '55555555-5555-4555-8555-555555555555', slug: 'pastehot-norte-demo', name: 'PasteHot · Norte (demo)', area: 'Norte', is_active: true, can_manage: true }
  ];
  const demoMode = () => Boolean(window.PasteHotDemo && new URLSearchParams(location.search).get('demo') === '1');
  const adminPage = () => /\/admin\.html$/.test(location.pathname);
  const keyForPage = () => adminPage() ? ADMIN_KEY : PUBLIC_KEY;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const idNow = () => { try { return localStorage.getItem(keyForPage()) || ''; } catch { return ''; } };

  let stores = [];
  let isDemo = false;
  let storeListAvailable = false;
  let queryScopeInstalled = false;

  function installQueryScope() {
    if (queryScopeInstalled || typeof db === 'undefined') return;
    const scopedTables = new Set(['products', 'categories', 'orders', 'order_items', 'customers', 'delivery_zones', 'settings']);
    const originalFrom = db.from.bind(db);
    db.from = table => {
      const root = originalFrom(table);
      if (!scopedTables.has(table)) return root;
      const wrap = builder => new Proxy(builder, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          if (property === 'then') return value.bind(target);
          return (...args) => {
            if (property === 'insert' || property === 'upsert') {
              const storeId = idNow();
              const addId = row => row && typeof row === 'object' && !row.store_id ? { ...row, store_id: storeId } : row;
              args[0] = Array.isArray(args[0]) ? args[0].map(addId) : addId(args[0]);
              if (property === 'upsert' && table === 'settings' && args[1]?.onConflict === 'key') args[1] = { ...args[1], onConflict: 'store_id,key' };
            }
            let result = value.apply(target, args);
            const storeId = idNow();
            if (storeId && property === 'select') result = result.eq('store_id', storeId);
            if (storeId && (property === 'update' || property === 'delete')) result = result.eq('store_id', storeId);
            return result && typeof result === 'object' && typeof result.then === 'function' ? wrap(result) : (result && typeof result === 'object' ? wrap(result) : result);
          };
        }
      });
      return wrap(root);
    };
    const originalRpc = db.rpc.bind(db);
    const branchRpc = new Set(['admin_list_delivery_zones','admin_save_delivery_zone','pastehot_store_state','pastehot_set_store_closed','pastehot_store_history','pastehot_add_category','validate_delivery_location','create_pending_order_with_location_v3','update_order_status_with_inventory_v2','pastehot_order_page','pastehot_sales_summary','pastehot_image_reference_exists']);
    db.rpc = (name, args = {}, options) => branchRpc.has(name) && idNow()
      ? originalRpc(name, { ...args, p_store_id: idNow() }, options)
      : originalRpc(name, args, options);
    queryScopeInstalled = true;
  }

  function demoStores() {
    try {
      const saved = JSON.parse(localStorage.getItem('pastehot_demo_stores') || 'null');
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_DEMO_STORES.slice(0, 1);
    } catch { return DEFAULT_DEMO_STORES.slice(0, 1); }
  }
  function persistDemoStores() {
    localStorage.setItem('pastehot_demo_stores', JSON.stringify(stores));
  }
  async function fetchStores() {
    if (demoMode()) { isDemo = true; stores = demoStores(); return stores; }
    if (typeof db === 'undefined') return [];
    const { data, error } = await db.rpc('pastehot_list_stores');
    if (error || !Array.isArray(data)) { storeListAvailable = false; return []; }
    storeListAvailable = true;
    stores = data.filter(store => store?.id && store?.name);
    if (stores.length) installQueryScope();
    return stores;
  }
  function persistSelection(store) {
    if (!store) return;
    try { localStorage.setItem(keyForPage(), store.id); } catch {}
  }
  function currentStore() { return stores.find(store => store.id === idNow()) || stores[0] || null; }
  function storeOptions(selectedId) {
    return stores.map(store => `<option value="${safe(store.id)}" ${store.id === selectedId ? 'selected' : ''}>${safe(store.name)}${store.area ? ` · ${safe(store.area)}` : ''}</option>`).join('');
  }
  function addStyles() {
    if (document.getElementById('pastehotMultiStoreStyles')) return;
    const style = document.createElement('style');
    style.id = 'pastehotMultiStoreStyles';
    style.textContent = `#pastehotStoreBar{position:sticky;top:0;z-index:1000;background:#171717;color:#fff;padding:10px 14px;display:flex;gap:10px;align-items:center;justify-content:space-between;box-shadow:0 3px 12px #0002}#pastehotStoreBar .ph-store-left{display:flex;gap:9px;align-items:center;flex-wrap:wrap}#pastehotStoreBar label{font-size:13px;font-weight:700}#pastehotStoreBar select{max-width:min(62vw,340px);padding:8px;border-radius:7px;border:1px solid #bbb;background:white;color:#171717}#pastehotStoreBar button,.ph-store-modal button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;background:#d71920;color:white}#pastehotStoreModal{position:fixed;inset:0;z-index:2000;background:#0008;display:grid;place-items:center;padding:16px}#pastehotStoreModal[hidden]{display:none}#pastehotStoreModal .ph-modal-card{background:white;color:#171717;border-radius:14px;padding:20px;width:min(600px,100%);max-height:88vh;overflow:auto;box-shadow:0 20px 60px #0004}#pastehotStoreModal input,#pastehotStoreModal select{width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:7px;margin:5px 0 12px}#pastehotStoreModal .ph-modal-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:18px}#pastehotStoreModal .ph-secondary{background:#eceef1;color:#171717}#pastehotStoreModal .ph-help{font-size:13px;color:#555;line-height:1.45}#pastehotStoreModal .ph-member{display:flex;gap:10px;align-items:center;border-top:1px solid #eee;padding:9px 0}#pastehotStoreModal .ph-member input{width:auto;margin:0}#pastehotStoreModal .ph-notice{padding:10px;border-radius:8px;background:#fff4e5;margin-top:10px;font-size:13px}@media(max-width:520px){#pastehotStoreBar{align-items:flex-start;flex-direction:column}#pastehotStoreBar select{max-width:100%;width:100%}}`;
    document.head.appendChild(style);
  }
  function renderBar(isPublic) {
    const selected = currentStore();
    if (!selected || (stores.length < 2 && isPublic)) return;
    addStyles();
    const bar = document.createElement('div');
    bar.id = 'pastehotStoreBar';
    const canManage = !isPublic && selected.can_manage === true;
    bar.innerHTML = `<div class="ph-store-left"><label for="pastehotStoreSelect">${isPublic ? 'Sucursal' : 'Administras'}</label><select id="pastehotStoreSelect" aria-label="Seleccionar sucursal">${storeOptions(selected.id)}</select>${isDemo ? '<span aria-label="Modo demo">Vista de prueba</span>' : ''}</div>${canManage ? '<button type="button" id="pastehotManageStores">Sucursales</button>' : ''}`;
    if (isPublic) document.body.prepend(bar);
    else {
      const admin = document.getElementById('adminScreen');
      if (!admin) return;
      admin.prepend(bar);
    }
    document.getElementById('pastehotStoreSelect').addEventListener('change', event => {
      const store = stores.find(item => item.id === event.target.value);
      if (!store) return;
      persistSelection(store);
      if (isPublic) {
        const url = new URL(location.href);
        url.searchParams.set('sucursal', store.slug);
        location.assign(url.toString());
      } else location.reload();
    });
    document.getElementById('pastehotManageStores')?.addEventListener('click', openManager);
  }
  function ensureModal() {
    if (document.getElementById('pastehotStoreModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="pastehotStoreModal" hidden><div class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phStoreTitle"><h2 id="phStoreTitle">Sucursales</h2><p class="ph-help">Crea sucursales con el mismo sistema. Al copiar el menú se copian productos, categorías, zonas y ajustes; pedidos, clientes e inventario comienzan separados.</p><form id="phStoreCreateForm"><label for="phStoreName">Nombre de la sucursal</label><input id="phStoreName" maxlength="80" required placeholder="PasteHot Norte"><label for="phStoreArea">Zona o colonia</label><input id="phStoreArea" maxlength="120" placeholder="Norte de Mérida"><label class="ph-member"><input id="phStoreCopy" type="checkbox" checked> Copiar menú y configuración de la sucursal actual</label><div id="phStoreFeedback" role="status" class="ph-help"></div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phStoreClose">Cerrar</button><button type="submit">Crear sucursal</button></div></form><hr><label for="phStoreAccessSelect">Asignar acceso a una sucursal</label><select id="phStoreAccessSelect"></select><div id="phStoreMembers" class="ph-help">Cargando cuentas…</div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phStoreSaveMembers">Guardar accesos</button></div><p class="ph-help">Cada persona conserva su propia cuenta. Solo podrá entrar a las sucursales que le asignes.</p></div></div>`);
    const modal = document.getElementById('pastehotStoreModal');
    document.getElementById('phStoreClose').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('phStoreCreateForm').addEventListener('submit', createStore);
    document.getElementById('phStoreAccessSelect').addEventListener('change', loadMembers);
    document.getElementById('phStoreSaveMembers').addEventListener('click', saveMembers);
  }
  function openManager() {
    ensureModal();
    const modal = document.getElementById('pastehotStoreModal');
    const accessSelect = document.getElementById('phStoreAccessSelect');
    accessSelect.innerHTML = storeOptions(currentStore()?.id);
    document.getElementById('phStoreFeedback').textContent = isDemo ? 'Los cambios de esta vista de prueba se guardan solo en este navegador.' : '';
    modal.hidden = false;
    loadMembers();
  }
  async function createStore(event) {
    event.preventDefault();
    const name = document.getElementById('phStoreName').value.trim();
    const area = document.getElementById('phStoreArea').value.trim();
    const copy = document.getElementById('phStoreCopy').checked;
    const feedback = document.getElementById('phStoreFeedback');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      let store;
      if (isDemo) {
        store = { id: crypto.randomUUID(), slug: `demo-${Date.now()}`, name, area, is_active: true };
        stores.push(store); persistDemoStores();
      } else {
        const { data, error } = await db.rpc('pastehot_create_store', { p_name: name, p_area: area, p_copy_from_store_id: copy ? currentStore()?.id : null });
        if (error) throw error;
        store = Array.isArray(data) ? data[0] : data;
        if (!store?.id) throw new Error('No se recibió la nueva sucursal.');
        stores.push(store);
      }
      persistSelection(store);
      location.reload();
    } catch (error) {
      feedback.textContent = `No se pudo crear la sucursal: ${error.message || 'revisa la conexión'}.`;
    } finally { submit.disabled = false; }
  }
  async function loadMembers() {
    const select = document.getElementById('phStoreAccessSelect');
    const target = document.getElementById('phStoreMembers');
    if (!select || !target) return;
    if (isDemo) { target.innerHTML = '<div class="ph-notice">La asignación de cuentas se activa cuando la migración de base de datos esté instalada.</div>'; return; }
    target.textContent = 'Cargando cuentas…';
    try {
      const { data, error } = await db.rpc('pastehot_list_store_members', { p_store_id: select.value });
      if (error) throw error;
      const members = Array.isArray(data) ? data : [];
      target.innerHTML = members.length ? members.map(member => `<label class="ph-member"><input type="checkbox" data-ph-user="${safe(member.user_id)}" ${member.assigned ? 'checked' : ''} ${member.enabled ? '' : 'disabled'}><span><strong>${safe(member.display_name || 'Cuenta')}</strong><br>${safe(member.email || '')} · ${safe(member.role || '')}${member.enabled ? '' : ' · desactivada'}</span></label>`).join('') : '<p>No hay cuentas de equipo para asignar todavía.</p>';
    } catch (error) { target.textContent = `No se pudieron cargar las cuentas: ${error.message || 'revisa la conexión'}.`; }
  }
  async function saveMembers() {
    const storeId = document.getElementById('phStoreAccessSelect')?.value;
    const target = document.getElementById('phStoreMembers');
    if (isDemo) { target.insertAdjacentHTML('beforeend', '<div class="ph-notice">Demo: los accesos no se guardan en Supabase.</div>'); return; }
    const inputs = Array.from(target.querySelectorAll('[data-ph-user]'));
    const button = document.getElementById('phStoreSaveMembers');
    button.disabled = true;
    try {
      for (const input of inputs) {
        const { error } = await db.rpc('pastehot_set_store_member', { p_store_id: storeId, p_user_id: input.dataset.phUser, p_assigned: input.checked });
        if (error) throw error;
      }
      target.insertAdjacentHTML('beforeend', '<div class="ph-notice">Accesos guardados.</div>');
    } catch (error) { target.insertAdjacentHTML('beforeend', `<div class="ph-notice">No se pudieron guardar todos los accesos: ${safe(error.message || 'revisa la conexión')}.</div>`); }
    finally { button.disabled = false; }
  }

  window.PasteHotMultiStore = {
    async setupAdmin() {
      await fetchStores();
      if (!stores.length) return !storeListAvailable; // Keep compatibility before the migration; deny users with no branch after it.
      let selected = stores.find(store => store.id === idNow());
      if (!selected) { selected = stores[0]; persistSelection(selected); }
      window.PasteHotStoreId = selected.id;
      installQueryScope();
      renderBar(false);
      return true;
    },
    async setupPublic() {
      await fetchStores();
      if (!stores.length) return false;
      const slug = new URLSearchParams(location.search).get('sucursal');
      let selected = stores.find(store => store.slug === slug && store.is_active) || stores.find(store => store.id === idNow() && store.is_active) || stores.find(store => store.is_active);
      if (!selected) return false;
      persistSelection(selected);
      window.PasteHotStoreId = selected.id;
      installQueryScope();
      if (stores.filter(store => store.is_active).length > 1) renderBar(true);
      return true;
    }
  };
})();
