/* UI convenience checks complement database authorization; they never grant permissions. */
let adminRole=null,adminAccessAllowed=false,adminSession=null,adminAccessState=null;
let adminSecurityInstalled=false,adminRealtimeOnline=false,adminAccessTimer=null,adminRecoveryTimer=null;
let orderInbox=null,orderAudio=null,orderSoundEnabled=false,orderSoundTimer=null,orderSoundDebounce=null,adminWakeLock=null;
let adminAccessRefreshPromise=null,adminAccessBusy=false;
let orderChimeUntil=0;const orderChimeVoices=new Set();
const PASTEHOT_OWNER_ID='a0c0b64b-7809-4428-ad00-a1484d6ded53';
function isPasteHotPreview(){return /^(deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app|localhost|127\.0\.0\.1)$/.test(location.hostname);}
function showPreviewDemoEntry(){document.getElementById('previewDemoLink')?.classList.toggle('hidden',!isPasteHotPreview());document.getElementById('previewDemoBar')?.classList.toggle('hidden',!window.PasteHotDemo);}
function adminDeviceToken(){
  const key='pastehot_device_token_'+adminSession.user.id;
  let token=localStorage.getItem(key);
  if(!/^[0-9a-f]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,token);}
  return token;
}
function savedSessionLabel(){try{return localStorage.getItem('pastehot_session_label')||(/Android|iPad/i.test(navigator.userAgent)?'Tablet del negocio':'Mi navegador')}catch{return 'Mi navegador'}}
function missingAccessBackend(error){return error?.code==='PGRST202'&&String(error.message||'').includes('pastehot_admin_state');}
async function setupAdminAccess(session){
  adminSession=session;
  const {data:userData,error:userError}=await db.auth.getUser();
  if(userError||!userData?.user){denyAdminAccess('No se pudo comprobar tu acceso. Vuelve a entrar.');return false;}
  adminSession={...session,user:userData.user};
  const {data,error}=await db.rpc('pastehot_admin_state',{p_label:savedSessionLabel(),p_visible:document.visibilityState==='visible',p_device_token:adminDeviceToken()});
  if(error){
    if(missingAccessBackend(error)&&userData.user.id===PASTEHOT_OWNER_ID){
      adminSecurityInstalled=false;adminRole='owner';adminAccessAllowed=true;
      adminAccessState={role:'owner',allowed:true,enforced:false,members:[],sessions:[]};renderAdminAccess();return true;
    }
    denyAdminAccess(missingAccessBackend(error)?'Este acceso de empleado todavía no está activado.':'No se pudo comprobar la autorización. Revisa tu conexión.');return false;
  }
  adminSecurityInstalled=true;adminAccessState=data;adminRole=data?.role;
  adminAccessAllowed=!!data?.allowed;
  if(!adminAccessAllowed){showWaitingAccess(data);return false;}
  renderAdminAccess();return true;
}
function denyAdminAccess(message){
  clearStaffInvitation();
  adminAccessAllowed=false;stopAdminEnhancements();
  document.querySelectorAll('.modal.show').forEach(el=>el.classList.remove('show'));
  document.getElementById('orderDetail').textContent='';
  document.getElementById('adminScreen').classList.add('hidden');document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginMessage').innerHTML=`<div class="message error" role="alert">${escapeHtml(message)}</div><button class="btn btn-light" onclick="checkSession()">Volver a comprobar</button><button class="btn btn-light" onclick="logout()">Cerrar sesión</button>`;
}
function showWaitingAccess(state){
  denyAdminAccess(state?.status==='disabled'?'Tu acceso ha sido desactivado. Consulta con el propietario.':state?.status==='revoked'?'Este navegador fue revocado. El propietario debe autorizarlo de nuevo.':'Este navegador necesita autorización del propietario. Abre Accesos desde un navegador ya autorizado.');
  if(state?.status==='pending'){
    document.getElementById('loginMessage').insertAdjacentHTML('beforeend','<p class="media-note">La solicitud ya aparece en Accesos. Esta pantalla comprobará la autorización automáticamente.</p>');
    clearInterval(adminAccessTimer);adminAccessTimer=setInterval(()=>checkSession(),15000);
  }
}
function adminCanEditProducts(){return adminAccessAllowed&&['owner','manager'].includes(adminRole);}
function adminCanOpenTab(name){return adminAccessAllowed&&(adminRole==='owner'||name==='orders'||(adminRole==='manager'&&['products','store-history'].includes(name)));}
function adminRoleName(role){return {owner:'Propietario',manager:'Encargado',staff:'Empleado'}[role]||'Sin permisos';}
function applyAdminPermissions(){
  const owner=adminRole==='owner';
  document.querySelectorAll('[data-owner-only]').forEach(el=>el.classList.toggle('hidden',!owner));
  if(window.PasteHotDemo)document.getElementById('demoRoleSelect').value=adminRole;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('hidden',!adminCanOpenTab(b.getAttribute('onclick')?.match(/showTab\('([^']+)'/)?.[1])));
  document.getElementById('ordersMetrics').classList.toggle('hidden',!owner);
  document.querySelector('#section-orders .analytics-grid').classList.toggle('hidden',!owner);
  document.getElementById('ordersPeriod').classList.toggle('hidden',!owner);
  document.querySelector('#section-orders .media-note').textContent=owner?'La búsqueda por folio revisa todo el historial, sin limitarse al periodo seleccionado.':'Busca entre los pedidos de las últimas 48 horas disponibles para atención.';
  document.querySelector('#section-orders .section-title h2').textContent=owner?'Pedidos y ventas':'Pedidos';
  document.querySelector('#section-orders .section-title p').textContent=owner?'Resumen calculado a partir de los pedidos registrados.':'Revisa, imprime y prepara los pedidos. Los datos son solo para atender al cliente.';
  document.getElementById('categoryAdminCard').classList.toggle('hidden',!owner);
  if(!owner)showTab('orders');
}
function openAdminAccess(){if(adminRole==='owner')showTab('access');else alert(`Acceso de ${adminRole==='manager'?'encargado':'empleado'}. El propietario administra los dispositivos autorizados.`);}
function renderAdminAccess(){
  const state=adminAccessState||{},enforced=!!state.enforced,installed=adminSecurityInstalled;
  const sessions=state.sessions||[],members=state.members||[];
  const online=sessions.filter(s=>s.status==='approved'&&s.online);
  document.getElementById('adminPresenceDots').innerHTML=online.map(()=>'<span class="presence-dot" aria-hidden="true"></span>').join('');
  document.getElementById('adminPresenceText').textContent=installed?`${online.length} conectado${online.length===1?'':'s'}`:'Accesos por preparar';
  document.getElementById('adminPresence').setAttribute('aria-label',installed?`Accesos: ${online.length} navegadores conectados`:'Ver preparación de accesos');
  const note=!installed?'Preview: el control de empleados y dispositivos está preparado para prueba. Aún no se ha activado en la base de datos del negocio.':!enforced?'El control de empleados está instalado. La autorización de navegadores aún no está activa. Actívalo primero en tu teléfono y después autoriza la tablet.':'Protección activa: cada navegador requiere tu aprobación. No hay un límite fijo de dispositivos.';
  document.getElementById('accessSetupNote').textContent=note;
  document.getElementById('accessProtectionText').textContent=note;
  document.getElementById('enableAdminSecurity').disabled=!installed||enforced||adminAccessBusy;
  document.getElementById('enableAdminSecurity').classList.toggle('hidden',enforced);
  document.getElementById('staffInviteButton').disabled=!installed||!enforced||adminAccessBusy;
  document.getElementById('staffInviteForm').classList.toggle('hidden',adminRole!=='owner');
  document.getElementById('accessSessions').innerHTML=sessions.length?sessions.map(s=>{
    const pending=s.status==='pending',approved=s.status==='approved',current=s.current;
    return `<div class="access-row"><div><strong>${escapeHtml(s.label||'Navegador sin nombre')}${current?' · este navegador':''}</strong><small>${escapeHtml(s.display_name||'')} · ${adminRoleName(s.role)}</small><span class="state-tag ${escapeAttr(s.status)}">${approved?'Autorizado':pending?'Esperando autorización':'Revocado'}</span> <span class="${s.online?'access-online':'access-offline'}">${s.online?'Conectado':'Sin actividad reciente'}</span></div><div class="access-row-actions">${!current&&adminRole==='owner'?(approved?`<button class="btn btn-danger" onclick="changeAdminSession('${s.session_id}','revoked')">Revocar acceso</button>`:`<button class="btn btn-dark" onclick="changeAdminSession('${s.session_id}','approved')">Autorizar</button>`):''}</div></div>`;
  }).join(''):'<p class="media-note">Las sesiones aparecerán aquí cuando se active el control de accesos.</p>';
  document.getElementById('accessMembers').innerHTML=members.filter(m=>['staff','manager'].includes(m.role)).map(m=>`<div class="access-row"><div><strong>${escapeHtml(m.display_name)}</strong><small>${escapeHtml(m.email||'')} · ${adminRoleName(m.role)}</small><span class="state-tag">${m.enabled?'Acceso habilitado':'Acceso desactivado'}</span></div><div class="access-row-actions"><label>Permisos<select aria-label="Permisos de ${escapeAttr(m.display_name)}" ${adminAccessBusy?'disabled':''} onchange="changeAdminMemberRole('${m.user_id}',this.value)"><option value="staff" ${m.role==='staff'?'selected':''}>Empleado</option><option value="manager" ${m.role==='manager'?'selected':''}>Encargado</option></select></label><button class="btn ${m.enabled?'btn-danger':'btn-dark'}" onclick="changeAdminMember('${m.user_id}',${!m.enabled})">${m.enabled?'Desactivar acceso':'Habilitar acceso'}</button></div></div>`).join('')||'<p class="media-note">No hay empleados o encargados registrados.</p>';
  const banner=document.getElementById('adminAccessBanner');
  banner.classList.toggle('hidden',installed||adminRole!=='owner');
  banner.textContent=!installed?'Preview de mejoras: las alertas y categorías pueden probarse aquí. Los nuevos permisos de empleados aún no están activados en el negocio.':'';
}
async function refreshAdminAccess(){
  if(!adminSecurityInstalled)return adminAccessAllowed;
  if(adminAccessRefreshPromise)return adminAccessRefreshPromise;
  adminAccessRefreshPromise=(async()=>{
    const {data,error}=await db.rpc('pastehot_admin_state',{p_label:savedSessionLabel(),p_visible:document.visibilityState==='visible',p_device_token:adminDeviceToken()});
    if(error){denyAdminAccess('No se pudo verificar tu autorización. Se pausó el administrador hasta recuperar la conexión.');return false;}
    const previousRole=adminRole;
    adminAccessState=data;adminAccessAllowed=!!data?.allowed;adminRole=data?.role;
    if(previousRole!==adminRole&&adminAccessAllowed){denyAdminAccess('Tus permisos cambiaron. Vuelve a comprobar el acceso para cargar tu nueva interfaz.');return false;}
    if(!adminAccessAllowed){showWaitingAccess(data);return false;}
    renderAdminAccess();await loadStoreControl();return true;
  })();
  try{return await adminAccessRefreshPromise}catch{denyAdminAccess('No se pudo verificar el acceso. Revisa la conexión y el almacenamiento del navegador.');return false;}finally{adminAccessRefreshPromise=null;}
}
function startAdminAccessHeartbeat(){clearInterval(adminAccessTimer);if(adminSecurityInstalled)adminAccessTimer=setInterval(refreshAdminAccess,20000);}
async function adminAccessAction(action){
  if(adminAccessBusy||adminRole!=='owner'||!adminAccessAllowed)return;
  adminAccessBusy=true;renderAdminAccess();
  try{await action();await refreshAdminAccess();showMessage('accessMessage','Cambio guardado.');}catch(error){showMessage('accessMessage',String(error.message||'No se pudo guardar el cambio.'),false);}finally{adminAccessBusy=false;renderAdminAccess();}
}
async function changeAdminSession(id,status){
  if(!confirm(status==='revoked'?'¿Revocar este navegador? Dejará de tener acceso a los pedidos.':'¿Autorizar este navegador para usar el administrador?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_set_session',{p_session_id:id,p_status:status});if(error)throw error;});
}
async function changeAdminMember(id,enabled){
  if(!confirm(enabled?'¿Habilitar el acceso de esta cuenta? Sus navegadores deben autorizarse nuevamente.':'¿Desactivar esta cuenta y revocar todos sus navegadores?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_set_staff_enabled',{p_user_id:id,p_enabled:enabled});if(error)throw error;});
}
async function changeAdminMemberRole(id,role){
  if(!['manager','staff'].includes(role)||adminRole!=='owner'||!adminAccessAllowed)return;
  const member=adminAccessState?.members?.find(m=>m.user_id===id);
  if(!member||member.role===role)return;
  if(!confirm(`¿Cambiar los permisos de ${member.display_name} a ${adminRoleName(role)}? Sus navegadores perderán la autorización y deberás aprobarlos nuevamente.`)){renderAdminAccess();return;}
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_set_staff_role',{p_user_id:id,p_role:role});if(error)throw error;});
}
async function activateAdminProtection(){
  if(!confirm('Se autorizará este navegador. Los demás necesitarán tu aprobación, sin un límite fijo de dispositivos. Conserva acceso a este navegador hasta autorizar tu teléfono o la tablet. ¿Activar?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_activate_security');if(error)throw error;});
}
async function renameAdminSession(){
  if(!adminSecurityInstalled)return;const label=prompt('Nombre para identificar este navegador:',savedSessionLabel())?.trim();if(!label)return;
  if(label.length>60){alert('Usa un nombre de máximo 60 caracteres.');return;}
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_admin_state',{p_label:label,p_visible:true,p_device_token:adminDeviceToken()});if(error)throw error;try{localStorage.setItem('pastehot_session_label',label);}catch{}});
}
async function inviteAdminStaff(event){
  event.preventDefault();if(!adminSecurityInstalled||!adminAccessState?.enforced)return;
  clearStaffInvitation();
  const email=document.getElementById('staffInviteEmail').value.trim(),name=document.getElementById('staffInviteName').value.trim();
  await adminAccessAction(async()=>{
    const {data,error}=await db.functions.invoke('pastehot-invite-staff',{body:{email,name,redirectTo:location.origin+'/admin.html',deviceToken:adminDeviceToken(),role:document.getElementById('staffInviteRole').value}});
    if(error||data?.error)throw new Error(data?.error||'No se pudo enviar la invitación. Revisa el correo o intenta más tarde.');
    if(data?.delivery==='manual'&&data.invitationLink){
      const link=new URL(data.invitationLink);
      if(link.origin!==SUPABASE_URL||link.pathname!=='/auth/v1/verify'||link.searchParams.get('type')!=='invite')throw new Error('No se pudo verificar la invitación.');
      document.getElementById('staffInvitationLink').value=link.href;
      document.getElementById('staffInvitationResult').classList.remove('hidden');
    }
    document.getElementById('staffInviteForm').reset();
  });
}
function clearStaffInvitation(){const input=document.getElementById('staffInvitationLink');if(input)input.value='';document.getElementById('staffInvitationResult')?.classList.add('hidden');}
async function copyStaffInvitation(){if(adminRole!=='owner'||!adminAccessAllowed)return;const input=document.getElementById('staffInvitationLink');if(!input?.value)return;try{await navigator.clipboard.writeText(input.value);showMessage('accessMessage','Enlace copiado. Compártelo únicamente con la persona invitada.');}catch{input.focus();input.select();showMessage('accessMessage','Selecciona y copia el enlace para entregarlo a la persona invitada.');}}
function setupOrderInbox(){
  if(orderInbox)return;
  let reviewed=[];try{reviewed=JSON.parse(localStorage.getItem('pastehot_reviewed_'+adminSession.user.id)||'[]');if(!Array.isArray(reviewed))reviewed=[];}catch{}
  orderInbox=new PasteHotOrders.OrderInbox({reviewed,onChange:renderOrderInbox,onNew:()=>{clearTimeout(orderSoundDebounce);orderSoundDebounce=setTimeout(()=>playOrderChime(),300);}});
}
function receiveRealtimeOrder(payload){
  if(!adminAccessAllowed||!orderInbox)return;
  if(payload.eventType==='DELETE'){orderInbox.remove(payload.old?.id);return;}
  if(payload.new?.id)orderInbox.receive(payload.new);
}
function reconcileOrderInbox(rows){if(adminAccessAllowed)orderInbox?.reconcile(rows);}
function renderOrderInbox(list){
  const box=document.getElementById('newOrdersInbox');if(!box)return;
  box.classList.toggle('hidden',!list.length||!adminAccessAllowed);
  document.getElementById('newOrdersCount').textContent=`${list.length} sin revisar`;
  document.getElementById('newOrdersList').innerHTML=list.map(o=>`<div class="alert-order"><div><strong>Pedido ${escapeHtml(o.order_code||String(o.id).slice(0,8))}</strong><p>${o.delivery_type==='delivery'?'Envío a domicilio':'Recoger en tienda'} · ${escapeHtml(formatDate(o.created_at))}</p><p>${o.order_status==='pendiente_confirmacion'?'Pendiente de confirmar':'Nuevo pedido'}</p></div><button class="btn btn-primary" data-inbox-order="${escapeAttr(o.id)}">Ver pedido</button></div>`).join('');
  document.getElementById('newOrdersList').querySelectorAll('[data-inbox-order]').forEach(b=>b.addEventListener('click',()=>openInboxOrder(b.dataset.inboxOrder)));
  document.getElementById('orderSoundNote').textContent=orderSoundEnabled?'Sonido activo. La alerta se repite cada 3 segundos hasta pulsar Ver pedido en los pedidos pendientes.':'Activa el sonido para escuchar los pedidos nuevos.';
  if(!list.length){stopOrderChime();clearTimeout(orderSoundDebounce);clearInterval(orderSoundTimer);orderSoundTimer=null;}
  else if(orderSoundEnabled&&!orderSoundTimer)orderSoundTimer=setInterval(playOrderChime,3000);
}
async function openInboxOrder(id){
  if(!orders.some(o=>String(o.id)===String(id)))await loadOrders();
  if(!orders.some(o=>String(o.id)===String(id))){alert('No se pudo cargar ese pedido. Revisa tu conexión.');return;}
  showTab('orders');openOrderModal(id);
}
function reviewInboxOrder(id){
  if(!orderInbox)return;const reviewed=orderInbox.review(id);
  try{localStorage.setItem('pastehot_reviewed_'+adminSession.user.id,JSON.stringify(reviewed));}catch{}
}
async function toggleOrderSound(){
  if(orderSoundEnabled){orderSoundEnabled=false;stopOrderChime();if(adminWakeLock){adminWakeLock.release().catch(()=>{});adminWakeLock=null;}clearInterval(orderSoundTimer);orderSoundTimer=null;document.getElementById('adminSoundButton').textContent='Activar sonido';renderOrderInbox(orderInbox?.list()||[]);return;}
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Este navegador no permite el sonido de alertas.');
    orderAudio=orderAudio||new Audio();await orderAudio.resume();if(orderAudio.state!=='running')throw new Error('No se pudo activar el sonido. Toca de nuevo Activar sonido.');
    orderSoundEnabled=true;document.getElementById('adminSoundButton').textContent='Sonido activo · silenciar';renderOrderInbox(orderInbox?.list()||[]);playOrderChime(true);await requestAdminWakeLock();
  }catch(error){alert(error.message||'No se pudo activar el sonido.');}
}
function stopOrderChime(){
  orderChimeUntil=0;
  for(const {tone,gain} of orderChimeVoices){
    try{gain.gain.cancelScheduledValues(orderAudio.currentTime);gain.gain.setValueAtTime(0,orderAudio.currentTime);tone.stop();}catch{}
    tone.disconnect();gain.disconnect();
  }
  orderChimeVoices.clear();
}
function playOrderChime(test=false){
  if(!orderSoundEnabled||!adminAccessAllowed||(!test&&!orderInbox?.list().length))return;
  if(!orderAudio||orderAudio.state!=='running'){document.getElementById('adminSoundButton').textContent='Reactivar sonido';return;}
  const base=orderAudio.currentTime;
  // A bright incoming-call pattern; consecutive orders never stack voices.
  if(base<orderChimeUntil)return;
  orderChimeUntil=base+2.26;
  [[0,960],[.24,1280],[.48,960],[.72,1280],[1.32,960],[1.56,1280],[1.80,960],[2.04,1280]].forEach(([delay,freq])=>{
    const tone=orderAudio.createOscillator(),gain=orderAudio.createGain();tone.type='square';tone.frequency.value=freq;
    gain.gain.setValueAtTime(0,base+delay);gain.gain.linearRampToValueAtTime(.85,base+delay+.012);
    gain.gain.setValueAtTime(.85,base+delay+.14);gain.gain.exponentialRampToValueAtTime(.001,base+delay+.20);
    tone.connect(gain);gain.connect(orderAudio.destination);const voice={tone,gain};orderChimeVoices.add(voice);
    tone.start(base+delay);tone.stop(base+delay+.22);
    tone.onended=()=>{tone.disconnect();gain.disconnect();orderChimeVoices.delete(voice);};
  });
}

async function resumeOrderAudio(){if(orderSoundEnabled){try{await orderAudio?.resume();if(orderInbox?.list().length)playOrderChime();await requestAdminWakeLock();}catch{document.getElementById('adminSoundButton').textContent='Reactivar sonido';}}}
async function requestAdminWakeLock(){
  if(document.visibilityState!=='visible'||!orderSoundEnabled||!navigator.wakeLock||adminWakeLock)return;
  try{adminWakeLock=await navigator.wakeLock.request('screen');adminWakeLock.addEventListener('release',()=>{adminWakeLock=null;});}catch{}
}
function startOrderRecovery(){clearInterval(adminRecoveryTimer);adminRecoveryTimer=setInterval(()=>{if(adminAccessAllowed&&navigator.onLine&&document.visibilityState==='visible'&&!adminRealtimeOnline)loadOrders();},30000);}
function stopAdminEnhancements(){
  clearStaffInvitation();
  stopStoreControl();resetAdminReports();stopOrderChime();
  clearInterval(adminAccessTimer);clearInterval(adminRecoveryTimer);clearInterval(orderSoundTimer);clearTimeout(orderSoundDebounce);
  clearTimeout(adminOrdersTimer);clearTimeout(adminProductsTimer);clearTimeout(adminSettingsTimer);clearTimeout(adminZonesTimer);
  orderSoundEnabled=false;orderSoundTimer=null;
  const soundButton=document.getElementById('adminSoundButton');if(soundButton)soundButton.textContent='Activar sonido';
  if(adminRealtimeChannel){db.removeChannel(adminRealtimeChannel);adminRealtimeChannel=null;}
  if(adminWakeLock){adminWakeLock.release().catch(()=>{});adminWakeLock=null;}
  document.getElementById('newOrdersInbox')?.classList.add('hidden');
}
const isStaffInviteLink=/(?:^|[&#])type=(invite|recovery)(?:&|$)/.test(location.hash);
function showStaffPasswordSetup(){stopAdminEnhancements();document.getElementById('loginScreen').classList.add('hidden');document.getElementById('adminScreen').classList.add('hidden');document.getElementById('staffPasswordScreen').classList.remove('hidden');}
async function setStaffPassword(event){
  event.preventDefault();const password=document.getElementById('staffNewPassword').value;
  if(password.length<12||password!==document.getElementById('staffRepeatPassword').value){showMessage('staffPasswordMessage','Usa al menos 12 caracteres y repite la misma contraseña.',false);return;}
  const button=event.target.querySelector('button');button.disabled=true;
  try{const {error}=await db.auth.updateUser({password});if(error)throw error;document.getElementById('staffNewPassword').value='';document.getElementById('staffRepeatPassword').value='';document.getElementById('staffPasswordScreen').classList.add('hidden');await checkSession();}catch{showMessage('staffPasswordMessage','No se pudo guardar. Comprueba la conexión o solicita una nueva invitación si el enlace venció.',false);}finally{button.disabled=false;}
}
