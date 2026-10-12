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
  function storeOptions(selectedId, candidates = stores) {
    return candidates.map(store => `<option value="${safe(store.id)}" ${store.id === selectedId ? 'selected' : ''}>${safe(store.name)}${store.area ? ` · ${safe(store.area)}` : ''}</option>`).join('');
  }
  function addStyles() {
    if (document.getElementById('pastehotMultiStoreStyles')) return;
    const style = document.createElement('style');
    style.id = 'pastehotMultiStoreStyles';
    style.textContent = `#pastehotStoreBar{position:sticky;top:0;z-index:1000;background:#171717;color:#fff;padding:10px 14px;display:flex;gap:10px;align-items:center;justify-content:space-between;box-shadow:0 3px 12px #0002}#pastehotStoreBar .ph-store-left{display:flex;gap:9px;align-items:center;flex-wrap:wrap}#pastehotStoreBar label{font-size:13px;font-weight:700}#pastehotStoreBar select{max-width:min(62vw,340px);padding:8px;border-radius:7px;border:1px solid #bbb;background:white;color:#171717}#pastehotStoreBar button,#pastehotStoreModal button,#pastehotPublicStorePicker button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;background:#d71920;color:white;cursor:pointer}#pastehotStoreModal,#pastehotPublicStorePicker,#phStoreDeletePasswordModal{position:fixed;inset:0;z-index:2000;background:#0008;display:grid;place-items:center;padding:16px}#pastehotStoreModal[hidden],#pastehotPublicStorePicker[hidden]{display:none}#pastehotStoreModal .ph-modal-card,#pastehotPublicStorePicker .ph-modal-card,#phStoreDeletePasswordModal .ph-modal-card{background:white;color:#171717;border-radius:14px;padding:20px;width:min(600px,100%);max-height:88vh;overflow:auto;box-shadow:0 20px 60px #0004}#pastehotStoreModal input,#pastehotStoreModal select,#pastehotPublicStorePicker select,#phStoreDeletePasswordModal input{width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:7px;margin:5px 0 12px}#pastehotStoreModal .ph-modal-actions,#pastehotPublicStorePicker .ph-modal-actions,#phStoreDeletePasswordModal .ph-modal-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:18px}#pastehotStoreModal .ph-secondary,#phStoreDeletePasswordModal .ph-secondary{background:#eceef1;color:#171717}#pastehotStoreModal .ph-danger,#phStoreDeletePasswordModal .ph-danger{background:#b42318;color:white}#pastehotStoreModal button:disabled{opacity:.5;cursor:not-allowed}#pastehotStoreModal .ph-help,#pastehotPublicStorePicker .ph-help{font-size:13px;color:#555;line-height:1.45}#pastehotStoreModal .ph-member{display:flex;gap:10px;align-items:center;border-top:1px solid #eee;padding:9px 0}#pastehotStoreModal .ph-member input{width:auto;margin:0}#pastehotStoreModal .ph-notice{padding:10px;border-radius:8px;background:#fff4e5;margin-top:10px;font-size:13px}.ph-store-row{display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #eee;padding:12px 0}.ph-store-row-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.ph-store-row .ph-secondary{background:#eceef1!important;color:#171717!important}.ph-store-row .ph-danger{background:#b42318!important;color:white!important}@media(max-width:520px){#pastehotStoreBar{align-items:flex-start;flex-direction:column}#pastehotStoreBar select{max-width:100%;width:100%}.ph-store-row{align-items:flex-start;flex-direction:column}.ph-store-row-actions{justify-content:flex-start}}`;
    document.head.appendChild(style);
  }
  function choosePublicStore(activeStores) {
    addStyles();
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.id = 'pastehotPublicStorePicker';
      modal.innerHTML = `<section class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phPublicStoreTitle"><h2 id="phPublicStoreTitle">Selecciona la sucursal más cercana a ti</h2><p class="ph-help">Elige dónde quieres comprar para ver los productos y existencias de esa sucursal.</p><form id="phPublicStoreForm"><label for="phPublicStoreSelect">Sucursal</label><select id="phPublicStoreSelect" required><option value="">Elige una sucursal</option>${storeOptions('', activeStores)}</select><div class="ph-modal-actions"><button type="submit">Explorar tienda</button></div></form></section>`;
      document.body.prepend(modal);
      const select = modal.querySelector('#phPublicStoreSelect');
      select.focus();
      modal.querySelector('#phPublicStoreForm').addEventListener('submit', event => {
        event.preventDefault();
        const store = activeStores.find(item => item.id === select.value);
        if (!store) return;
        persistSelection(store);
        const url = new URL(location.href);
        url.searchParams.set('sucursal', store.slug);
        history.replaceState(null, '', url);
        modal.remove();
        resolve(store);
      });
    });
  }
  function renderBar(isPublic) {
    const selected = currentStore();
    if (!selected || (stores.length < 2 && isPublic)) return;
    addStyles();
    const bar = document.createElement('div');
    bar.id = 'pastehotStoreBar';
    const canManage = !isPublic && selected.can_manage === true;
    const options = isPublic ? stores.filter(store => store.is_active) : stores;
    bar.innerHTML = `<div class="ph-store-left"><label for="pastehotStoreSelect">${isPublic ? 'Sucursal' : 'Administras'}</label><select id="pastehotStoreSelect" aria-label="Seleccionar sucursal">${storeOptions(selected.id, options)}</select>${isDemo ? '<span aria-label="Modo demo">Vista de prueba</span>' : ''}</div>${canManage ? '<button type="button" id="pastehotManageStores">Sucursales</button>' : ''}`;
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
    document.body.insertAdjacentHTML('beforeend', `<div id="pastehotStoreModal" hidden><div class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phStoreTitle"><h2 id="phStoreTitle">Sucursales</h2><p class="ph-help">Crea sucursales con el mismo sistema. Al copiar el menú se copian productos, categorías, zonas y ajustes; pedidos, clientes e inventario comienzan separados.</p><section><h3>Estado de las sucursales</h3><p class="ph-help">Debe quedar al menos una sucursal activa. La última no se puede apagar ni eliminar.</p><div id="phStoreListFeedback" role="status" class="ph-help"></div><div id="phStoreList"></div></section><hr><form id="phStoreRenameForm"><label for="phStoreRenameName">Nombre de la sucursal seleccionada</label><input id="phStoreRenameName" maxlength="80" required><div id="phStoreRenameFeedback" role="status" class="ph-help"></div><div class="ph-modal-actions"><button type="submit">Guardar nombre</button></div></form><hr><form id="phStoreCreateForm"><label for="phStoreName">Nombre de la nueva sucursal</label><input id="phStoreName" maxlength="80" required placeholder="PasteHot Norte"><label for="phStoreArea">Zona o colonia</label><input id="phStoreArea" maxlength="120" placeholder="Norte de Mérida"><label class="ph-member"><input id="phStoreCopy" type="checkbox" checked> Copiar menú y configuración de la sucursal actual</label><div id="phStoreFeedback" role="status" class="ph-help"></div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phStoreClose">Cerrar</button><button type="submit">Crear sucursal</button></div></form><hr><label for="phStoreAccessSelect">Asignar acceso a una sucursal</label><select id="phStoreAccessSelect"></select><div id="phStoreMembers" class="ph-help">Cargando cuentas…</div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phStoreSaveMembers">Guardar accesos</button></div><p class="ph-help">Cada persona conserva su propia cuenta. Solo podrá entrar a las sucursales que le asignes.</p></div></div>`);
    const modal = document.getElementById('pastehotStoreModal');
    document.getElementById('phStoreClose').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('phStoreCreateForm').addEventListener('submit', createStore);
    document.getElementById('phStoreRenameForm').addEventListener('submit', renameStore);
    document.getElementById('phStoreAccessSelect').addEventListener('change', loadMembers);
    document.getElementById('phStoreSaveMembers').addEventListener('click', saveMembers);
  }
  function openManager() {
    ensureModal();
    const modal = document.getElementById('pastehotStoreModal');
    const accessSelect = document.getElementById('phStoreAccessSelect');
    accessSelect.innerHTML = storeOptions(currentStore()?.id);
    document.getElementById('phStoreRenameName').value = currentStore()?.name || '';
    document.getElementById('phStoreRenameFeedback').textContent = '';
    document.getElementById('phStoreFeedback').textContent = isDemo ? 'Los cambios de esta vista de prueba se guardan solo en este navegador.' : '';
    modal.hidden = false;
    renderStoreList();
    loadMembers();
  }
  function renderStoreList() {
    const target = document.getElementById('phStoreList');
    if (!target) return;
    const canManage = currentStore()?.can_manage === true;
    if (!canManage) { target.textContent = 'Solo la propietaria principal puede cambiar el estado o eliminar sucursales.'; return; }
    const activeCount = stores.filter(store => store.is_active).length;
    target.innerHTML = stores.map(store => {
      const cannotDeactivate = store.is_active && activeCount <= 1;
      const cannotDelete = stores.length <= 1 || (store.is_active && activeCount <= 1);
      return `<div class="ph-store-row"><div><strong>${safe(store.name)}</strong><br><span class="ph-help">${safe(store.area || 'Sin zona')} · ${store.is_active ? 'Activa' : 'Apagada'}</span></div><div class="ph-store-row-actions"><button type="button" class="ph-secondary" data-ph-toggle="${safe(store.id)}" ${cannotDeactivate ? 'disabled title="Debe quedar una sucursal activa"' : ''}>${store.is_active ? 'Apagar tienda' : 'Encender tienda'}</button><button type="button" class="ph-danger" data-ph-delete="${safe(store.id)}" ${cannotDelete ? 'disabled title="Debe quedar al menos una sucursal activa"' : ''}>Eliminar</button></div></div>`;
    }).join('');
    target.querySelectorAll('[data-ph-toggle]').forEach(button => button.addEventListener('click', () => toggleStore(button.dataset.phToggle)));
    target.querySelectorAll('[data-ph-delete]').forEach(button => button.addEventListener('click', () => deleteStore(button.dataset.phDelete)));
  }
  async function toggleStore(storeId) {
    const store = stores.find(item => item.id === storeId);
    const feedback = document.getElementById('phStoreListFeedback');
    if (!store || currentStore()?.can_manage !== true) return;
    const isActive = !store.is_active;
    if (store.is_active && stores.filter(item => item.is_active).length <= 1) return;
    const button = document.querySelector(`[data-ph-toggle="${CSS.escape(storeId)}"]`);
    if (button) button.disabled = true;
    try {
      if (isDemo) {
        store.is_active = isActive;
        persistDemoStores();
      } else {
        const { data, error } = await db.rpc('pastehot_set_store_active', { p_store_id: store.id, p_is_active: isActive });
        if (error) throw error;
        const updated = Array.isArray(data) ? data[0] : data;
        if (!updated?.id) throw new Error('No se recibió el estado actualizado.');
        Object.assign(store, updated);
      }
      feedback.textContent = isActive ? `${store.name} está activa y ya puede aparecer en el menú.` : `${store.name} está apagada y ya no aparece como opción para comprar.`;
      renderStoreList();
    } catch (error) {
      feedback.textContent = `No se pudo cambiar el estado: ${error.message || 'revisa la conexión'}.`;
      renderStoreList();
    }
  }
  function requestOwnerPassword(store) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.id = 'phStoreDeletePasswordModal';
      overlay.innerHTML = `<section class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phDeletePasswordTitle"><h2 id="phDeletePasswordTitle">Confirmación 3 de 3</h2><p>Para eliminar definitivamente <strong>${safe(store.name)}</strong>, escribe la contraseña de la cuenta de la propietaria principal. Se eliminarán sus ventas, clientes, productos y configuración.</p><form><label for="phDeleteOwnerPassword">Contraseña de la propietaria principal</label><input id="phDeleteOwnerPassword" type="password" autocomplete="current-password" required><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phDeleteCancel">Cancelar</button><button type="submit" class="ph-danger">Borrar definitivamente</button></div></form></section>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#phDeleteOwnerPassword');
      input.focus();
      const finish = value => { input.value = ''; overlay.remove(); resolve(value); };
      overlay.querySelector('#phDeleteCancel').addEventListener('click', () => finish(null));
      overlay.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const password = input.value;
        if (password) finish(password);
      });
    });
  }
  function storagePathFromPublicUrl(url) {
    try {
      const marker = '/storage/v1/object/public/product-images/';
      const value = String(url || '');
      const index = value.indexOf(marker);
      if (index < 0) return null;
      return decodeURIComponent(value.slice(index + marker.length).split('?')[0]);
    } catch { return null; }
  }
  async function removeStoreImages(storeId) {
    const { data, error } = await db.rpc('pastehot_store_image_urls_for_delete', { p_store_id: storeId });
    if (error) throw error;
    const paths = [...new Set((Array.isArray(data) ? data : [])
      .map(row => storagePathFromPublicUrl(row?.image_url))
      .filter(Boolean))];
    for (let i = 0; i < paths.length; i += 1000) {
      const { error: storageError } = await db.storage.from('product-images').remove(paths.slice(i, i + 1000));
      if (storageError) throw new Error(`No se pudieron eliminar las imágenes de esta sucursal: ${storageError.message || 'error de Storage'}`);
    }
  }
  async function deleteStore(storeId) {
    const store = stores.find(item => item.id === storeId);
    const feedback = document.getElementById('phStoreListFeedback');
    if (!store || currentStore()?.can_manage !== true || stores.length <= 1) return;
    if (store.is_active && stores.filter(item => item.is_active).length <= 1) return;
    const dataWarning = `ADVERTENCIA 1 de 3\n\nVas a eliminar permanentemente “${store.name}”. Se borrarán sus productos, categorías, clientes, ventas y pedidos, zonas, ajustes, registros asociados e imágenes de Supabase que no estén compartidas con otra sucursal. Esta acción no se puede deshacer.\n\n¿Deseas continuar?`;
    if (!window.confirm(dataWarning)) return;
    const finalWarning = `CONFIRMACIÓN 2 de 3\n\n¿Confirmas que quieres borrar “${store.name}”? La tercera confirmación pedirá la contraseña de la propietaria principal.`;
    if (!window.confirm(finalWarning)) return;
    let password = await requestOwnerPassword(store);
    if (!password) return;
    try {
      const { data: current, error: currentError } = await db.auth.getUser();
      if (currentError || !current?.user?.email || !current?.user?.id) throw new Error('No se pudo verificar la cuenta propietaria activa.');
      const currentUserId = current.user.id;
      const { data: verified, error: passwordError } = await db.auth.signInWithPassword({ email: current.user.email, password });
      password = '';
      if (passwordError || verified?.user?.id !== currentUserId) throw new Error('La contraseña no corresponde a la cuenta propietaria principal.');
      if (isDemo) {
        stores = stores.filter(item => item.id !== store.id);
        persistDemoStores();
      } else {
        await removeStoreImages(store.id);
        const { error } = await db.rpc('pastehot_delete_store', { p_store_id: store.id });
        if (error) throw error;
        stores = stores.filter(item => item.id !== store.id);
      }
      if (idNow() === store.id) {
        persistSelection(stores.find(item => item.is_active) || stores[0]);
        location.reload();
        return;
      }
      document.getElementById('phStoreAccessSelect').innerHTML = storeOptions(currentStore()?.id);
      document.getElementById('phStoreRenameName').value = currentStore()?.name || '';
      feedback.textContent = `La sucursal “${store.name}” y sus datos se eliminaron. Las imágenes compartidas con otra sucursal se conservaron.`;
      renderStoreList();
      await loadMembers();
    } catch (error) {
      password = '';
      feedback.textContent = `No se pudo eliminar la sucursal: ${error.message || 'revisa la conexión'}.`;
    }
  }
  async function renameStore(event) {
    event.preventDefault();
    const store = currentStore();
    const name = document.getElementById('phStoreRenameName').value.trim();
    const feedback = document.getElementById('phStoreRenameFeedback');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (!store) return;
    submit.disabled = true;
    try {
      if (!name || name.length > 80) throw new Error('El nombre debe tener entre 1 y 80 caracteres.');
      if (isDemo) {
        store.name = name;
        persistDemoStores();
      } else {
        const { data, error } = await db.rpc('pastehot_rename_store', { p_store_id: store.id, p_name: name });
        if (error) throw error;
        const renamed = Array.isArray(data) ? data[0] : data;
        if (!renamed?.id) throw new Error('No se recibió la sucursal actualizada.');
        Object.assign(store, renamed);
      }
      document.getElementById('pastehotStoreSelect').innerHTML = storeOptions(store.id);
      document.getElementById('phStoreAccessSelect').innerHTML = storeOptions(store.id);
      feedback.textContent = 'Nombre actualizado. Los datos y accesos de la sucursal se conservaron.';
    } catch (error) {
      feedback.textContent = `No se pudo cambiar el nombre: ${error.message || 'revisa la conexión'}.`;
    } finally { submit.disabled = false; }
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
        store = { id: crypto.randomUUID(), slug: `demo-${Date.now()}`, name, area, is_active: true, can_manage: true };
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
      const activeStores = stores.filter(store => store.is_active);
      if (!activeStores.length) return false;
      const slug = new URLSearchParams(location.search).get('sucursal');
      let selected = activeStores.find(store => store.slug === slug);
      if (!selected && activeStores.length > 1) selected = await choosePublicStore(activeStores);
      if (!selected) selected = activeStores.find(store => store.id === idNow()) || activeStores[0];
      if (!selected) return false;
      persistSelection(selected);
      window.PasteHotStoreId = selected.id;
      installQueryScope();
      if (stores.filter(store => store.is_active).length > 1) renderBar(true);
      return true;
    }
  };
})();
