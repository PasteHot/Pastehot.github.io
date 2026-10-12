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
    const branchRpc = new Set(['admin_list_delivery_zones','admin_save_delivery_zone','pastehot_store_state','pastehot_set_store_closed','pastehot_store_history','pastehot_add_category','validate_delivery_location','create_pending_order_with_location_v3','update_order_status_with_inventory_v2','pastehot_order_page','pastehot_sales_summary','pastehot_image_reference_exists','pastehot_pos_current_shift','pastehot_pos_open_shift','pastehot_pos_close_shift','pastehot_pos_create_sale','pastehot_pos_cancel_sale','pastehot_pos_report']);
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
    style.textContent = `
      #pastehotStoreBar{position:sticky;top:0;z-index:1000;padding:9px 18px;background:linear-gradient(110deg,#fffaf3,#f6e8d3 55%,#fff8ef);border-bottom:1px solid #ead8c1;box-shadow:0 5px 20px rgba(74,42,18,.09);display:flex;align-items:center;justify-content:center}
      #pastehotStoreBar[data-public="false"]{background:#171717;color:#fff;padding:10px 14px;justify-content:space-between}
      #pastehotStoreBar .ph-store-left{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
      #pastehotStoreBar label{font-size:13px;font-weight:700}
      #pastehotStoreBar[data-public="false"] select{max-width:min(62vw,340px);padding:8px;border-radius:7px;border:1px solid #bbb;background:white;color:#171717}
      #pastehotStoreBar .ph-store-trigger{display:flex;align-items:center;gap:11px;min-height:54px;padding:6px 15px 6px 7px;border:1px solid #ead7c0;border-radius:999px;background:rgba(255,255,255,.96);color:#392718;box-shadow:0 5px 16px rgba(88,49,18,.1);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
      #pastehotStoreBar .ph-store-trigger:hover{transform:translateY(-1px);border-color:#d7a85f;box-shadow:0 8px 22px rgba(88,49,18,.16)}
      #pastehotStoreBar .ph-store-trigger:focus-visible,#pastehotPublicStorePicker button:focus-visible{outline:3px solid rgba(215,25,32,.32);outline-offset:3px}
      .ph-store-mark{width:40px;height:40px;display:grid;place-items:center;flex:0 0 40px;border-radius:50%;background:linear-gradient(145deg,#d71920,#a90f15);color:#fff;box-shadow:inset 0 0 0 3px rgba(255,255,255,.22)}
      .ph-store-mark svg{width:21px;height:21px}
      .ph-store-copy{display:grid;gap:1px;text-align:left}
      .ph-store-copy small{font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:#946633;font-weight:900}
      .ph-store-copy strong{font-size:15px;line-height:1.15;color:#351f12}
      .ph-store-chevron{width:17px;height:17px;color:#9b6b36;margin-left:4px;transition:transform .18s ease}
      .ph-store-trigger[aria-expanded="true"] .ph-store-chevron{transform:rotate(180deg)}
      #pastehotStoreBar button:not(.ph-store-trigger),#pastehotStoreModal button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;background:#d71920;color:white;cursor:pointer}
      #pastehotStoreModal,#pastehotPublicStorePicker,#phStoreDeletePasswordModal{position:fixed;inset:0;z-index:2000;background:rgba(35,20,10,.58);backdrop-filter:blur(5px);display:grid;place-items:center;padding:16px}
      #pastehotStoreModal[hidden],#pastehotPublicStorePicker[hidden]{display:none}
      #pastehotStoreModal .ph-modal-card,#phStoreDeletePasswordModal .ph-modal-card{background:white;color:#171717;border-radius:14px;padding:20px;width:min(600px,100%);max-height:88vh;overflow:auto;box-shadow:0 20px 60px #0004}
      #pastehotPublicStorePicker .ph-picker-card{position:relative;width:min(520px,100%);max-height:min(88vh,820px);overflow:auto;padding:0;border:1px solid #f0dfc8;border-radius:26px;background:#fffaf3;color:#2b1a10;box-shadow:0 28px 90px rgba(25,12,4,.38);animation:phPickerEnter .24s ease-out}
      @keyframes phPickerEnter{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
      #pastehotPublicStorePicker .ph-picker-ribbon{height:10px;background:linear-gradient(90deg,#a90f15,#d71920 48%,#efbd57 48%,#efbd57 53%,#d71920 53%,#a90f15)}
      #pastehotPublicStorePicker .ph-picker-head{padding:27px 28px 12px;text-align:center}
      #pastehotPublicStorePicker .ph-picker-logo{width:70px;height:70px;object-fit:contain;padding:7px;margin-bottom:11px;border-radius:50%;background:#fff;box-shadow:0 7px 22px rgba(71,40,18,.13)}
      #pastehotPublicStorePicker .ph-picker-eyebrow{margin:0 0 7px;color:#a46d2d;font-size:10px;font-weight:950;letter-spacing:.17em}
      #pastehotPublicStorePicker h2{margin:0;color:#2b1a10;font-size:clamp(23px,5vw,29px);line-height:1.13;letter-spacing:-.03em}
      #pastehotPublicStorePicker .ph-picker-intro{max-width:390px;margin:9px auto 0;color:#746250;font-size:14px;line-height:1.5}
      #pastehotPublicStorePicker .ph-picker-form{padding:9px 22px 22px}
      #pastehotPublicStorePicker .ph-picker-list{display:grid;gap:10px}
      #pastehotPublicStorePicker .ph-store-choice{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) 23px;gap:12px;align-items:center;padding:12px 14px;border:1px solid #eadcc9;border-radius:17px;background:#fff;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}
      #pastehotPublicStorePicker .ph-store-choice:hover{transform:translateY(-1px);border-color:#d9b879;box-shadow:0 6px 15px rgba(95,59,23,.08)}
      #pastehotPublicStorePicker .ph-store-choice.is-selected{border:1.5px solid #c72523;background:linear-gradient(110deg,#fff8ef,#fff);box-shadow:0 0 0 3px rgba(215,25,32,.08)}
      #pastehotPublicStorePicker .ph-choice-radio{position:absolute;width:1px;height:1px;opacity:0}
      #pastehotPublicStorePicker .ph-choice-radio:focus-visible+.ph-choice-icon{outline:3px solid rgba(215,25,32,.3);outline-offset:3px}
      #pastehotPublicStorePicker .ph-choice-icon{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:#fff0dc;color:#b32320}
      #pastehotPublicStorePicker .ph-choice-icon svg{width:22px;height:22px}
      #pastehotPublicStorePicker .ph-choice-copy{display:grid;gap:3px;min-width:0}
      #pastehotPublicStorePicker .ph-choice-copy small{color:#aa773b;font-size:9px;font-weight:950;letter-spacing:.13em;text-transform:uppercase}
      #pastehotPublicStorePicker .ph-choice-copy strong{color:#322014;font-size:15px;overflow-wrap:anywhere}
      #pastehotPublicStorePicker .ph-choice-copy span{color:#776654;font-size:12px}
      #pastehotPublicStorePicker .ph-choice-check{width:21px;height:21px;border:1.5px solid #d9c9b4;border-radius:50%;display:grid;place-items:center;color:transparent}
      #pastehotPublicStorePicker .is-selected .ph-choice-check{border-color:#c72523;background:#c72523;color:white}
      #pastehotPublicStorePicker .ph-choice-check svg{width:13px;height:13px}
      #pastehotPublicStorePicker .ph-picker-footer{display:grid;gap:10px;margin-top:16px}
      #pastehotPublicStorePicker .ph-picker-note{margin:0;text-align:center;color:#897560;font-size:11px;line-height:1.4}
      #pastehotPublicStorePicker .ph-explore-button{display:flex;justify-content:center;align-items:center;gap:9px;width:100%;min-height:51px;padding:13px 18px;border:0;border-radius:14px;background:linear-gradient(135deg,#d71920,#ac1017);color:#fff;font-size:15px;font-weight:950;box-shadow:0 8px 18px rgba(177,21,27,.23);transition:transform .16s ease,box-shadow .16s ease}
      #pastehotPublicStorePicker .ph-explore-button:hover{transform:translateY(-1px);box-shadow:0 11px 22px rgba(177,21,27,.29)}
      #pastehotPublicStorePicker .ph-explore-button svg{width:18px;height:18px}
      #pastehotPublicStorePicker .ph-picker-close{position:absolute;top:18px;right:18px;z-index:1;width:36px;height:36px;border:1px solid #eadcc9;border-radius:50%;background:#fff;color:#533d2a;padding:0;font-size:22px;line-height:1;display:grid;place-items:center}
      #pastehotStoreModal .ph-modal-card{position:relative}
      #pastehotStoreModal #phStoreModalCloseX{position:absolute;top:9px;right:10px;background:transparent;color:#171717;border:0;border-radius:6px;padding:2px 9px;font-size:30px;line-height:1;cursor:pointer}
      #pastehotStoreModal #phStoreSaveMembers{background:#d71920;color:#fff}
      #pastehotStoreModal input,#pastehotStoreModal select,#phStoreDeletePasswordModal input{width:100%;padding:10px;border:1px solid #ccd0d5;border-radius:7px;margin:5px 0 12px}
      #pastehotStoreModal .ph-modal-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:18px}
      #pastehotStoreModal .ph-secondary,#phStoreDeletePasswordModal .ph-secondary{background:#eceef1;color:#171717}
      #pastehotStoreModal .ph-danger,#phStoreDeletePasswordModal .ph-danger{background:#b42318;color:white}
      #pastehotStoreModal button:disabled{opacity:.5;cursor:not-allowed}
      #pastehotStoreModal .ph-help{font-size:13px;color:#555;line-height:1.45}
      #pastehotStoreModal .ph-member{display:flex;gap:10px;align-items:center;border-top:1px solid #eee;padding:9px 0}
      #pastehotStoreModal .ph-member input{width:auto;margin:0}
      #pastehotStoreModal .ph-notice{padding:10px;border-radius:8px;background:#fff4e5;margin-top:10px;font-size:13px}
      .ph-store-row{display:flex;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #eee;padding:12px 0}
      .ph-store-row-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .ph-store-row .ph-secondary{background:#eceef1;color:#171717}
      .ph-store-row .ph-danger{background:#b42318;color:white}
      @media(max-width:520px){#pastehotStoreBar{padding:8px 10px}.ph-store-copy strong{font-size:14px}#pastehotPublicStorePicker{padding:12px}#pastehotPublicStorePicker .ph-picker-head{padding:25px 20px 10px}#pastehotPublicStorePicker .ph-picker-form{padding:8px 15px 17px}#pastehotPublicStorePicker .ph-picker-close{top:12px;right:12px}.ph-store-row{align-items:flex-start;flex-direction:column}.ph-store-row-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }
  function choosePublicStore(activeStores, selectedId = '', { changeStore = false } = {}) {
    addStyles();
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.id = 'pastehotPublicStorePicker';
      const pin = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.3" stroke="currentColor" stroke-width="1.8"/></svg>';
      const check = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      modal.innerHTML = `<section class="ph-picker-card" role="dialog" aria-modal="true" aria-labelledby="phPublicStoreTitle"><div class="ph-picker-ribbon"></div>${changeStore ? '<button type="button" class="ph-picker-close" aria-label="Cerrar selector">×</button>' : ''}<header class="ph-picker-head"><img class="ph-picker-logo" src="/favicon.png" alt="PasteHot"><p class="ph-picker-eyebrow">PASTEHOT · MÉRIDA</p><h2 id="phPublicStoreTitle">Selecciona la sucursal más cercana a ti</h2><p class="ph-picker-intro">Elige dónde quieres comprar. Cada tienda tiene su propio menú y existencias.</p></header><form id="phPublicStoreForm" class="ph-picker-form"><div class="ph-picker-list" role="radiogroup" aria-label="Sucursales disponibles">${activeStores.map((store,index)=>`<label class="ph-store-choice ${store.id===selectedId?'is-selected':''}"><input class="ph-choice-radio" type="radio" name="phPublicStore" value="${safe(store.id)}" ${store.id===selectedId?'checked':''} required><span class="ph-choice-icon">${pin}</span><span class="ph-choice-copy"><small>Sucursal ${String(index+1).padStart(2,'0')}</small><strong>${safe(store.name)}</strong><span>${store.area?`📍 ${safe(store.area)}`:'Pastes recién horneados, cerca de ti'}</span></span><span class="ph-choice-check">${check}</span></label>`).join('')}</div><div class="ph-picker-footer"><p class="ph-picker-note">Antes de explorar, confirma que elegiste la zona que te queda mejor.</p><button type="submit" class="ph-explore-button">Explorar tienda <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></form></section>`;
      document.body.prepend(modal);
      const form = modal.querySelector('#phPublicStoreForm');
      const trigger = document.getElementById('phPublicStoreTrigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      const close = () => { modal.remove(); if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } };
      modal.querySelectorAll('input[name="phPublicStore"]').forEach(input => input.addEventListener('change', () => {
        modal.querySelectorAll('.ph-store-choice').forEach(choice => choice.classList.toggle('is-selected', choice.contains(input) && input.checked));
      }));
      modal.querySelector('.ph-picker-close')?.addEventListener('click', close);
      (modal.querySelector('input[name="phPublicStore"]:checked') || modal.querySelector('input[name="phPublicStore"]'))?.focus();
      form.addEventListener('submit', event => {
        event.preventDefault();
        const store = activeStores.find(item => item.id === form.querySelector('input[name="phPublicStore"]:checked')?.value);
        if (!store) return;
        persistSelection(store);
        const url = new URL(location.href);
        url.searchParams.set('sucursal', store.slug);
        if (changeStore) location.assign(url.toString());
        else history.replaceState(null, '', url);
        close();
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
    bar.dataset.public = String(isPublic);
    const canManage = !isPublic && selected.can_manage === true;
    const options = isPublic ? stores.filter(store => store.is_active) : stores;
    bar.innerHTML = isPublic
      ? `<div class="ph-store-left"><button type="button" id="phPublicStoreTrigger" class="ph-store-trigger" aria-haspopup="dialog" aria-expanded="false" aria-label="Cambiar sucursal. Sucursal ${safe(selected.name)}"><span class="ph-store-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.3" stroke="currentColor" stroke-width="1.8"/></svg></span><span class="ph-store-copy"><small>Sucursal</small><strong>${safe(selected.name)}</strong></span><svg class="ph-store-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${isDemo ? '<span aria-label="Modo demo">Vista de prueba</span>' : ''}</div>`
      : `<div class="ph-store-left"><label for="pastehotStoreSelect">Administras</label><select id="pastehotStoreSelect" aria-label="Seleccionar sucursal">${storeOptions(selected.id, options)}</select>${isDemo ? '<span aria-label="Modo demo">Vista de prueba</span>' : ''}</div>${canManage ? '<button type="button" id="pastehotManageStores">Sucursales</button>' : ''}`;
    if (isPublic) document.body.prepend(bar);
    else {
      const admin = document.getElementById('adminScreen');
      if (!admin) return;
      admin.prepend(bar);
    }
    document.getElementById('pastehotStoreSelect')?.addEventListener('change', event => {
      const store = stores.find(item => item.id === event.target.value);
      if (!store) return;
      persistSelection(store);
      if (isPublic) {
        const url = new URL(location.href);
        url.searchParams.set('sucursal', store.slug);
        location.assign(url.toString());
      } else location.reload();
    });
    document.getElementById('phPublicStoreTrigger')?.addEventListener('click', () => choosePublicStore(stores.filter(store => store.is_active), selected.id, { changeStore: true }));
    document.getElementById('pastehotManageStores')?.addEventListener('click', openManager);
  }
  function ensureModal() {
    if (document.getElementById('pastehotStoreModal')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="pastehotStoreModal" hidden><div class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phStoreTitle"><button type="button" id="phStoreModalCloseX" aria-label="Cerrar ventana de sucursales" title="Cerrar">×</button><h2 id="phStoreTitle">Sucursales</h2><p class="ph-help">Crea sucursales con el mismo sistema. Al copiar el menú se copian productos, categorías, zonas y ajustes; pedidos, clientes e inventario comienzan separados.</p><section><h3>Estado de las sucursales</h3><p class="ph-help">Debe quedar al menos una sucursal activa. La última no se puede apagar ni eliminar.</p><div id="phStoreListFeedback" role="status" class="ph-help"></div><div id="phStoreList"></div></section><hr><form id="phStoreRenameForm"><label for="phStoreRenameName">Nombre de la sucursal seleccionada</label><input id="phStoreRenameName" maxlength="80" required><label for="phStoreRenameArea">Zona o colonia</label><input id="phStoreRenameArea" maxlength="120" placeholder="Por ejemplo, Américas o zona norte"><div id="phStoreRenameFeedback" role="status" class="ph-help"></div><div class="ph-modal-actions"><button type="submit">Guardar sucursal</button></div></form><hr><form id="phStoreCreateForm"><label for="phStoreName">Nombre de la nueva sucursal</label><input id="phStoreName" maxlength="80" required placeholder="PasteHot Norte"><label for="phStoreArea">Zona o colonia</label><input id="phStoreArea" maxlength="120" placeholder="Norte de Mérida"><label class="ph-member"><input id="phStoreCopy" type="checkbox" checked> Copiar menú y configuración de la sucursal actual</label><div id="phStoreFeedback" role="status" class="ph-help"></div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phStoreClose">Cerrar</button><button type="submit">Crear sucursal</button></div></form><hr><label for="phStoreAccessSelect">Asignar acceso a una sucursal</label><select id="phStoreAccessSelect"></select><div id="phStoreMembers" class="ph-help">Cargando cuentas…</div><div class="ph-modal-actions"><button type="button" id="phStoreSaveMembers">Guardar accesos</button></div><p class="ph-help">Se muestra solo el personal activo asignado a la sucursal seleccionada. Cada persona conserva su propia cuenta.</p></div></div>`);
    const modal = document.getElementById('pastehotStoreModal');
    document.getElementById('phStoreClose').addEventListener('click', () => { modal.hidden = true; });
    document.getElementById('phStoreModalCloseX').addEventListener('click', () => { modal.hidden = true; });
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
    document.getElementById('phStoreRenameArea').value = currentStore()?.area || '';
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
      overlay.innerHTML = `<section class="ph-modal-card" role="dialog" aria-modal="true" aria-labelledby="phDeletePasswordTitle"><h2 id="phDeletePasswordTitle">Confirmación 3 de 3</h2><p>Para eliminar definitivamente <strong>${safe(store.name)}</strong>, escribe la contraseña de la cuenta de la propietaria principal. Se eliminarán sus ventas, clientes, productos y configuración.</p><form><label for="phDeleteOwnerPassword">Contraseña de la propietaria principal</label><div class="ph-delete-password"><input id="phDeleteOwnerPassword" type="password" autocomplete="current-password" required><button type="button" id="phToggleDeletePassword" aria-label="Mostrar contraseña" aria-pressed="false" title="Mostrar contraseña">◉</button></div><div class="ph-modal-actions"><button type="button" class="ph-secondary" id="phDeleteCancel">Cancelar</button><button type="submit" class="ph-danger">Borrar definitivamente</button></div></form></section>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#phDeleteOwnerPassword');
      input.focus();
      overlay.querySelector('#phToggleDeletePassword').addEventListener('click', event => {
        const button = event.currentTarget;
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        button.setAttribute('aria-pressed', String(visible));
        button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
        button.title = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
      });
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
  async function storeImagePaths(storeId) {
    const { data, error } = await db.rpc('pastehot_store_image_urls_for_delete', { p_store_id: storeId });
    if (error) throw error;
    return [...new Set((Array.isArray(data) ? data : [])
      .map(row => storagePathFromPublicUrl(row?.image_url))
      .filter(Boolean))];
  }
  async function removeImagePaths(paths) {
    for (let i = 0; i < paths.length; i += 1000) {
      const { error: storageError } = await db.storage.from('product-images').remove(paths.slice(i, i + 1000));
      if (storageError) throw new Error(`No se pudieron eliminar las imágenes de esta sucursal: ${storageError.message || 'error de Storage'}`);
    }
  }
  async function removeStoreImages(storeId) { return removeImagePaths(await storeImagePaths(storeId)); }
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
    let imageCleanupError = null;
    try {
      const { data: current, error: currentError } = await db.auth.getUser();
      if (currentError || !current?.user?.email || !current?.user?.id) throw new Error('No se pudo verificar la cuenta propietaria activa.');
      const currentUserId = current.user.id;
      const { data: verified, error: passwordError } = await db.auth.signInWithPassword({ email: current.user.email, password });
      password = '';
      if (passwordError || verified?.user?.id !== currentUserId) throw new Error('La contraseña no corresponde a la cuenta propietaria principal.');
      if (verified?.session?.access_token && verified?.session?.refresh_token) {
        const { error: sessionError } = await db.auth.setSession({ access_token: verified.session.access_token, refresh_token: verified.session.refresh_token });
        if (sessionError) throw new Error('La contraseña se verificó, pero no se pudo actualizar la sesión segura. Intenta de nuevo.');
      } else {
        throw new Error('Supabase no devolvió una sesión nueva para confirmar la contraseña.');
      }
      let deleted;
      if (isDemo) {
        stores = stores.filter(item => item.id !== store.id);
        persistDemoStores();
        deleted = true;
      } else {
        let imagePaths = [];
        try { imagePaths = await storeImagePaths(store.id); } catch (storageError) { imageCleanupError = storageError; }
        const { data, error } = await db.rpc('pastehot_delete_store', { p_store_id: store.id });
        if (error) throw error;
        if (!data || (data.id && data.id !== store.id)) throw new Error('La base de datos no confirmó la sucursal eliminada.');
        deleted = true;
        // Database deletion is authoritative. Storage cleanup errors must not
        // leave the store row and its sales behind.
        if (!imageCleanupError) try { await removeImagePaths(imagePaths); } catch (storageError) { imageCleanupError = storageError; }
        stores = stores.filter(item => item.id !== store.id);
        if (imageCleanupError) console.error('PasteHot: quedó una imagen de la sucursal en Storage', imageCleanupError);
      }
      if (!deleted) throw new Error('No se confirmó la eliminación.');
      const successMessage = `La tienda “${store.name}” se borró exitosamente.`;
      const finalMessage = successMessage + (imageCleanupError ? ' Sus registros se eliminaron, pero quedó pendiente limpiar alguna imagen en Supabase.' : '');
      if (idNow() === store.id) {
        persistSelection(stores.find(item => item.is_active) || stores[0]);
        try { sessionStorage.setItem('pastehot_store_delete_success', finalMessage); } catch {}
        location.reload();
        return;
      }
      document.getElementById('phStoreAccessSelect').innerHTML = storeOptions(currentStore()?.id);
      document.getElementById('phStoreRenameName').value = currentStore()?.name || '';
      document.getElementById('phStoreRenameArea').value = currentStore()?.area || '';
      feedback.textContent = finalMessage;
      window.alert(finalMessage);
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
    const area = document.getElementById('phStoreRenameArea').value.trim();
    const feedback = document.getElementById('phStoreRenameFeedback');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (!store) return;
    submit.disabled = true;
    try {
      if (!name || name.length > 80) throw new Error('El nombre debe tener entre 1 y 80 caracteres.');
      if (area.length > 120) throw new Error('La zona debe tener máximo 120 caracteres.');
      if (isDemo) {
        store.name = name;
        store.area = area;
        persistDemoStores();
      } else {
        const { data, error } = await db.rpc('pastehot_update_store_details', { p_store_id: store.id, p_name: name, p_area: area });
        if (error) throw error;
        const renamed = Array.isArray(data) ? data[0] : data;
        if (!renamed?.id) throw new Error('No se recibió la sucursal actualizada.');
        Object.assign(store, renamed);
      }
      window.PasteHotStoreName = store.name;
      document.getElementById('pastehotStoreSelect').innerHTML = storeOptions(store.id);
      document.getElementById('phStoreAccessSelect').innerHTML = storeOptions(store.id);
      feedback.textContent = 'Nombre y zona actualizados. Los datos y accesos de la sucursal se conservaron.';
    } catch (error) {
      feedback.textContent = `No se pudo actualizar la sucursal: ${error.message || 'revisa la conexión'}.`;
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
      const assignedActiveMembers = members.filter(member => member.assigned && member.enabled);
      target.innerHTML = assignedActiveMembers.length ? assignedActiveMembers.map(member => `<label class="ph-member"><input type="checkbox" data-ph-user="${safe(member.user_id)}" checked><span><strong>${safe(member.display_name || 'Cuenta')}</strong><br>${safe(member.email || '')} · ${safe(member.role || '')}</span></label>`).join('') : '<p>No hay personal activo asignado a esta sucursal.</p>';
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
      window.PasteHotStoreName = selected.name;
      installQueryScope();
      renderBar(false);
      try {
        const deletedMessage = sessionStorage.getItem('pastehot_store_delete_success');
        if (deletedMessage) {
          sessionStorage.removeItem('pastehot_store_delete_success');
          setTimeout(() => window.alert(deletedMessage), 0);
        }
      } catch {}
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
      window.PasteHotStoreName = selected.name;
      installQueryScope();
      if (stores.filter(store => store.is_active).length > 1) renderBar(true);
      return true;
    }
  };
})();
