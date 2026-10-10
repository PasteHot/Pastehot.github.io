/* UI convenience checks complement database authorization; they never grant permissions. */
let adminRole=null,adminAccessAllowed=false,adminSession=null,adminAccessState=null;
let adminSecurityInstalled=false,adminRealtimeOnline=false,adminAccessTimer=null,adminRecoveryTimer=null;
let orderInbox=null,orderAudio=null,orderSoundEnabled=false,orderSoundTimer=null,orderSoundDebounce=null,orderInboxSyncTimer=null,orderInboxSyncBusy=false,adminWakeLock=null;
let adminAccessRefreshPromise=null,adminAccessBusy=false;
let orderChimeUntil=0;const orderChimeVoices=new Set();
const PASTEHOT_OWNER_ID='a0c0b64b-7809-4428-ad00-a1484d6ded53';
function isPasteHotPreview(){return /^(deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app|localhost|127\.0\.0\.1)$/.test(location.hostname);}
function isAccountPreviewReadOnly(){return isPasteHotPreview()&&!window.PasteHotDemo;}
function togglePassword(id,button){
 const input=document.getElementById(id);if(!input)return;
 const visible=input.type==='password';input.type=visible?'text':'password';
 button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Ocultar contraseña':'Mostrar contraseña');
 button.classList.toggle('password-visible',visible);
}
function resetPasswordVisibility(){document.querySelectorAll('.password-toggle').forEach(button=>{const input=document.getElementById(button.getAttribute('aria-controls'));if(input)input.type='password';button.classList.remove('password-visible');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','Mostrar contraseña');});}
let accountToastTimer=null;
let accountPasswordTarget=null;
function showAccountActivated(username,role){
 const toast=document.getElementById('accountCreatedToast');
 document.getElementById('accountCreatedDetails').textContent=`${username} · ${adminRoleName(role)}${window.PasteHotDemo?' · cuenta ficticia de prueba':''}`;
 toast.classList.remove('hidden');clearTimeout(accountToastTimer);accountToastTimer=setTimeout(hideAccountToast,10000);
}
function hideAccountToast(){clearTimeout(accountToastTimer);document.getElementById('accountCreatedToast')?.classList.add('hidden');}
async function copyTextValue(value,message='Copiado.'){
 const text=String(value??'');if(!text){showMessage('accessMessage','No hay texto para copiar.',false);return false;}
 try{await navigator.clipboard.writeText(text);}catch{
  const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const copied=document.execCommand('copy');area.remove();if(!copied){showMessage('accessMessage','No se pudo copiar. Selecciona el texto manualmente.',false);return false;}
 }
 showMessage('accessMessage',message);return true;
}
function copyInputValue(id,message){const input=document.getElementById(id);return copyTextValue(input?.value,message);}
function openResetAccountPassword(id){
 if(!['owner','manager'].includes(adminRole)||!adminAccessAllowed)return;
 const member=adminAccessState?.members?.find(m=>m.user_id===id);
 if(!member||member.primary_owner||(member.current&&adminRole!=='owner')||!['owner','manager','staff'].includes(member.role)||(adminRole==='manager'&&member.role!=='staff'))return;
 accountPasswordTarget=member;document.getElementById('accountPasswordPerson').textContent=`${member.display_name} · ${adminRoleName(member.role)}`;
 document.getElementById('accountNewPassword').value='';document.getElementById('accountPasswordResetMessage').textContent='';
 document.getElementById('accountPasswordModal').classList.add('show');
}
function closeAccountPasswordModal(){document.getElementById('accountPasswordModal').classList.remove('show');document.getElementById('accountNewPassword').value='';resetPasswordVisibility();accountPasswordTarget=null;}
async function submitAccountPasswordReset(event){
 event.preventDefault();if(adminAccessBusy||!['owner','manager'].includes(adminRole)||!adminAccessAllowed||!accountPasswordTarget||(adminRole==='manager'&&accountPasswordTarget.role!=='staff'))return;
 if(isAccountPreviewReadOnly()){showMessage('accountPasswordResetMessage','Este Preview es de solo lectura para las cuentas reales. Prueba la gestión ficticia desde la barra “Prueba con datos ficticios”.',false);return;}
 const password=document.getElementById('accountNewPassword').value,member=accountPasswordTarget;
 if(password.length<12||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password)){showMessage('accountPasswordResetMessage','Usa 12 a 128 caracteres, con letras y números.',false);return;}
 if(!confirm(member.current?'Se cambiará tu contraseña y se cerrarán las otras sesiones de esta cuenta. ¿Continuar?':`Se cambiará la contraseña de ${member.display_name} y se cerrarán sus sesiones abiertas. ¿Continuar?`))return;
 const button=document.getElementById('accountPasswordResetButton');button.disabled=true;
 try{
  if(member.current){const {error}=await db.auth.updateUser({password});if(error)throw error;const {error:signoutError}=await db.auth.signOut({scope:'others'});showMessage('accountPasswordResetMessage',signoutError?'Contraseña actualizada. Cópiala aquí; algunas sesiones previas podrían seguir activas.':'Contraseña actualizada y otras sesiones cerradas. Puedes copiarla.');return;}
  await adminAccessAction(async()=>{
   const {data,error}=await db.functions.invoke(isPasteHotPreview()?'pastehot-create-staff-preview':'pastehot-create-staff',{body:{action:'reset_password',userId:member.user_id,password,deviceToken:adminDeviceToken()}});
   if(error||data?.error||data?.ok!==true){let message=data?.error;try{if(!message&&error?.context?.json)message=(await error.context.json())?.error;}catch{}throw new Error(message||'No se confirmó el cambio.');}
   return `Contraseña de ${member.display_name} cambiada. Cópiala ahora y compártela en privado.`;
  });
  showMessage('accountPasswordResetMessage','Contraseña actualizada. Puedes copiarla aquí y enviarla de forma privada.');
 }catch(error){showMessage('accountPasswordResetMessage',String(error.message||'No se pudo cambiar la contraseña.'),false);}
 finally{button.disabled=false;}
}
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
  const {data,error}=await db.rpc('pastehot_admin_state',{p_label:null,p_visible:document.visibilityState==='visible',p_device_token:adminDeviceToken()});
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
  if(adminRole==='manager'&&!await loadManagerStaffAccounts())return false;
  renderAdminAccess();return true;
}
function denyAdminAccess(message){
  hideAccountToast();resetPasswordVisibility();
  const accountPassword=document.getElementById('staffAccountPassword');if(accountPassword)accountPassword.value='';
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
function isPrimaryOwner(){return !!adminAccessState?.primary_owner||(!adminSecurityInstalled&&adminRole==='owner');}
function adminCanEditProducts(){return adminAccessAllowed&&adminRole==='owner';}
function adminCanToggleProduct(){return adminAccessAllowed&&['owner','manager'].includes(adminRole);}
function adminCanOpenTab(name){
 if(!adminAccessAllowed)return false;
 if(adminRole==='owner')return isPrimaryOwner()||name!=='business';
 if(name==='access')return adminRole==='manager';
 if(name==='orders')return true;
 return adminRole==='manager'&&['products','store-history','operation','batch'].includes(name);
}
function adminRoleName(role){return {owner:'Propietario',manager:'Encargado',staff:'Empleado'}[role]||'Sin permisos';}
function applyAdminPermissions(){
  const owner=adminRole==='owner';
  const primary=isPrimaryOwner(),manager=adminRole==='manager';
  document.querySelectorAll('[data-owner-only]').forEach(el=>el.classList.toggle('hidden',!owner));
  document.querySelectorAll('[data-access-manage]').forEach(el=>el.classList.toggle('hidden',!owner&&!manager));
  document.querySelectorAll('[data-primary-owner-only]').forEach(el=>el.classList.toggle('hidden',!primary));
  if(window.PasteHotDemo)document.getElementById('demoRoleSelect').value=window.PasteHotDemo.state.delegated?'delegated':adminRole;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('hidden',!adminCanOpenTab(b.getAttribute('onclick')?.match(/showTab\('([^']+)'/)?.[1])));
  document.getElementById('ordersMetrics').classList.toggle('hidden',!owner);
  document.querySelector('#section-orders .analytics-grid').classList.toggle('hidden',!owner);
  document.getElementById('ordersPeriod').classList.toggle('hidden',!owner);
  document.querySelector('#section-orders .media-note').textContent=owner?'La búsqueda por folio revisa todo el historial, sin limitarse al periodo seleccionado.':'Busca entre los pedidos de las últimas 48 horas disponibles para atención.';
  document.querySelector('#section-orders .section-title h2').textContent=owner?'Pedidos y ventas':'Pedidos';
  document.querySelector('#section-orders .section-title p').textContent=owner?'Resumen calculado a partir de los pedidos registrados.':'Revisa, imprime y prepara los pedidos. Los datos son solo para atender al cliente.';
  document.getElementById('categoryAdminCard').classList.toggle('hidden',!owner&&!manager);
  document.getElementById('newProductButton')?.classList.toggle('hidden',!owner);
  document.querySelectorAll('[data-owner-product-edit]').forEach(el=>el.classList.toggle('hidden',!owner));
  document.querySelectorAll('[data-manager-operation]').forEach(el=>el.classList.toggle('hidden',!owner&&!manager));
  document.querySelectorAll('[data-owner-operation]').forEach(el=>el.classList.toggle('hidden',manager));
  document.getElementById('weeklyScheduleCard')?.classList.toggle('hidden',manager);
  if(manager)document.querySelector('#section-operation .section-title p').textContent='El encargado solo puede ajustar métodos de pago y recargo por lluvia. La hornada se administra en su apartado.';
  else document.querySelector('#section-operation .section-title p').textContent='Horarios, cierre temporal y mensajes comerciales del encabezado.';
  if(!primary&&!manager)showTab('orders');
}
function openAdminAccess(){if(['owner','manager'].includes(adminRole))showTab('access');else alert('El propietario y el encargado pueden administrar accesos de empleados.');}
function renderAdminSessionIdentity(state=adminAccessState||{}){
  const label=document.getElementById('adminSessionIdentity');if(!label)return;
  const userId=adminSession?.user?.id;
  const session=(state.sessions||[]).find(s=>s.current&&(!userId||s.user_id===userId));
  const member=(state.members||[]).find(m=>m.user_id===userId);
  const name=session?.display_name||member?.display_name||adminSession?.user?.user_metadata?.display_name||'Usuario en turno';
  label.textContent=`${adminRoleName(adminRole)} · ${name}`;
}
function renderAdminAccess(){
  const state=adminAccessState||{},enforced=!!state.enforced,installed=adminSecurityInstalled;
  renderAdminSessionIdentity(state);
  const sessions=state.sessions||[],members=state.members||[];
  const online=sessions.filter(s=>s.status==='approved'&&s.online&&s.member_enabled!==false);
  document.getElementById('adminPresenceDots').innerHTML=online.length?'<span class="presence-dot" aria-hidden="true"></span>':'';
  document.getElementById('adminPresenceText').textContent=installed?`${online.length} conectado${online.length===1?'':'s'}`:'Accesos por preparar';
  document.getElementById('adminPresence').setAttribute('aria-label',installed?`Accesos: ${online.length} navegadores conectados`:'Ver preparación de accesos');
  const direct=!!state.direct_access;
  const canManage=adminRole==='owner'||adminRole==='manager',manager=adminRole==='manager';
  const note=direct?'El propietario también puede entrar desde cualquier dispositivo, sin autorización adicional. Acceso directo: cada persona entra con su usuario y contraseña. Desactivar su cuenta bloquea todos sus dispositivos.':!installed?'Preview: el control de empleados y dispositivos está preparado para prueba. Aún no se ha activado en la base de datos del negocio.':!enforced?'El control de empleados está instalado. La autorización de navegadores aún no está activa. Actívalo primero en tu teléfono y después autoriza la tablet.':'Protección activa: cada navegador requiere tu aprobación. No hay un límite fijo de dispositivos.';
  document.getElementById('accessSetupNote').textContent=note;
  document.getElementById('accessProtectionText').textContent=note;
  document.getElementById('enableAdminSecurity').disabled=!installed||enforced||adminAccessBusy;
  document.getElementById('enableAdminSecurity').classList.toggle('hidden',enforced);
  const formEnabled=canManage&&installed&&direct&&!adminAccessBusy;
  document.getElementById('staffInviteButton').disabled=!formEnabled;
  document.querySelectorAll('#staffInviteForm input,#staffInviteForm select,#staffInviteForm button').forEach(el=>{el.disabled=!formEnabled;if(manager&&el.id==='staffInviteRole')el.disabled=true;});
  document.getElementById('deviceProtectionCard')?.classList.toggle('hidden',direct);
  document.getElementById('staffInviteForm').classList.toggle('hidden',!canManage);
  document.getElementById('staffInviteRole').classList.toggle('hidden',manager);
  document.getElementById('staffInviteRole').disabled=manager||adminAccessBusy;
  if(manager)document.getElementById('staffInviteRole').value='staff';
  document.getElementById('staffInviteForm').querySelector('h3').textContent=manager?'Crear cuenta de empleado':'Crear cuenta';
  document.querySelector('#section-access .section-title p').textContent=manager?'Puedes crear, desactivar, reactivar, borrar y compartir credenciales únicamente de empleados. Tu cuenta y las cuentas de propietarios y encargados están protegidas.':'El propietario administra los accesos. Asigna a cada persona los permisos que necesita.';
  document.getElementById('staffInviteButton').textContent=window.PasteHotDemo?'Simular cuenta · no crea acceso real':'Crear cuenta activa';
  document.getElementById('accessSessions').innerHTML=online.length?online.map(s=>{
    const pending=s.status==='pending',approved=s.status==='approved',current=s.current;
    const owner=adminRole==='owner'&&(!s.primary_owner||state.primary_owner),canAuthorize=s.member_enabled!==false,revoked=s.status==='revoked';
    return `<div class="access-row"><div><strong>${escapeHtml(s.label||'Navegador sin nombre')}${current?' · este navegador':''}</strong><small>${escapeHtml(s.display_name||'')} · ${adminRoleName(s.role)}</small><span class="state-tag ${escapeAttr(s.status)}">${direct?(s.member_enabled===false?'Cuenta desactivada':'Acceso por cuenta'):approved?'Autorizado':pending?'Esperando autorización':'Revocado'}</span> <span class="${s.online?'access-online':'access-offline'}">${s.online?'Conectado':'Sin actividad reciente'}</span>${s.member_enabled===false?'<small>Cuenta desactivada</small>':''}</div><div class="access-row-actions">${owner?`<button class="btn btn-light" onclick="renameAdminSession('${s.session_id}')">Renombrar</button>${['owner','staff','manager'].includes(s.role)&&!s.primary_owner?`<button class="btn btn-light" onclick="openAccountPermissions('${s.user_id}')">Cambiar permisos</button>`:'<small>Cuenta del propietario</small>'}${!direct&&!current?(approved?`<button class="btn btn-danger" onclick="changeAdminSession('${s.session_id}','revoked')">Revocar acceso</button>`:canAuthorize?`<button class="btn btn-dark" onclick="changeAdminSession('${s.session_id}','approved')">Autorizar</button>`:''):''}${!current&&revoked?`<button class="btn btn-danger" onclick="removeAdminSession('${s.session_id}')">Eliminar de la lista</button>`:''}`:''}</div></div>`;
  }).join(''):'<p class="media-note">No hay dispositivos conectados en este momento.</p>';
  document.getElementById('accessSessions').parentElement.classList.toggle('hidden',manager);
  document.getElementById('deviceProtectionCard').classList.toggle('hidden',direct||manager);
  document.getElementById('accessMembers').innerHTML=members.filter(m=>['owner','staff','manager'].includes(m.role)&&(adminRole!=='manager'||m.role==='staff')).map(m=>{
    const username=m.email?.startsWith('staff+')&&m.email.endsWith('@accounts.pastehot.com')?m.email.split('@')[0].slice(6):m.email||'';
    const protectedAccount=m.primary_owner||m.current;
    const credentialActions=!m.primary_owner&&(!m.current||adminRole==='owner')&&(!manager||m.role==='staff');
    return `<div class="access-row"><div><strong>${escapeHtml(m.display_name)}</strong><div class="credential-line"><span>Usuario: <code>${escapeHtml(username)}</code> · ${adminRoleName(m.role)}</span><button class="btn btn-light btn-small" onclick="copyTextValue('${escapeAttr(username)}','Usuario copiado.')">Copiar usuario</button></div>${m.primary_owner?'<small>Cuenta principal protegida</small>':m.role==='owner'?'<small>Segundo propietario · acceso a todos los apartados excepto Negocio</small>':''}<div class="credential-line"><span>La contraseña no se puede recuperar; puedes asignar una nueva.</span>${credentialActions?`<button class="btn btn-light btn-small" onclick="openResetAccountPassword('${m.user_id}')">Asignar y copiar contraseña</button>`:''}</div><span class="state-tag">${m.enabled?'Acceso habilitado':'Acceso desactivado'}</span></div><div class="access-row-actions">${protectedAccount?'<small>Cuenta protegida</small>':`${!manager?`<label>Permisos<select id="account-role-${m.user_id}" aria-label="Permisos de ${escapeAttr(m.display_name)}" ${adminAccessBusy?'disabled':''} onchange="changeAdminMemberRole('${m.user_id}',this.value)"><option value="owner" ${m.role==='owner'?'selected':''}>Segundo propietario</option><option value="staff" ${m.role==='staff'?'selected':''}>Empleado</option><option value="manager" ${m.role==='manager'?'selected':''}>Encargado</option></select></label>`:''}<button class="btn ${m.enabled?'btn-danger':'btn-dark'}" ${adminAccessBusy?'disabled':''} onclick="changeAdminMember('${m.user_id}',${!m.enabled})">${m.enabled?'Desactivar acceso':'Habilitar acceso'}</button>${direct?`<button class="btn btn-danger" ${adminAccessBusy?'disabled':''} onclick="deleteAdminMember('${m.user_id}')">Borrar cuenta</button>`:''}`}</div></div>`
  }).join('')||'<p class="media-note">No hay cuentas de empleados registradas.</p>';
  const banner=document.getElementById('adminAccessBanner');
  banner.classList.toggle('hidden',installed||adminRole!=='owner');
  banner.textContent=!installed?'Preview de mejoras: las alertas y categorías pueden probarse aquí. Los nuevos permisos de empleados aún no están activados en el negocio.':'';
}
async function refreshAdminAccess(){
  if(!adminSecurityInstalled)return adminAccessAllowed;
  if(adminAccessRefreshPromise)return adminAccessRefreshPromise;
  adminAccessRefreshPromise=(async()=>{
    const {data,error}=await db.rpc('pastehot_admin_state',{p_label:null,p_visible:document.visibilityState==='visible',p_device_token:adminDeviceToken()});
    if(error){denyAdminAccess('No se pudo verificar tu autorización. Se pausó el administrador hasta recuperar la conexión.');return false;}
    const previousRole=adminRole;
    adminAccessState=data;adminAccessAllowed=!!data?.allowed;adminRole=data?.role;
    if(previousRole!==adminRole&&adminAccessAllowed){denyAdminAccess('Tus permisos cambiaron. Vuelve a comprobar el acceso para cargar tu nueva interfaz.');return false;}
    if(!adminAccessAllowed){showWaitingAccess(data);return false;}
    if(adminRole==='manager'&&!await loadManagerStaffAccounts())return false;
    renderAdminAccess();await loadStoreControl();return true;
  })();
  try{return await adminAccessRefreshPromise}catch{denyAdminAccess('No se pudo verificar el acceso. Revisa la conexión y el almacenamiento del navegador.');return false;}finally{adminAccessRefreshPromise=null;}
}
async function loadManagerStaffAccounts(){
  if(window.PasteHotDemo){const {data,error}=await db.rpc('pastehot_manager_staff_accounts');if(error){denyAdminAccess('No se pudieron verificar las cuentas de empleados. El acceso quedó pausado.');return false;}adminAccessState.members=data||[];return true;}
  const {data,error}=await db.rpc('pastehot_manager_staff_accounts');
  if(error){denyAdminAccess('No se pudieron verificar las cuentas de empleados. El acceso quedó pausado.');return false;}
  adminAccessState.members=Array.isArray(data)?data:[];return true;
}
function startAdminAccessHeartbeat(){clearInterval(adminAccessTimer);if(adminSecurityInstalled)adminAccessTimer=setInterval(refreshAdminAccess,20000);}
async function adminAccessAction(action){
  if(adminAccessBusy||!['owner','manager'].includes(adminRole)||!adminAccessAllowed)return;
  if(isAccountPreviewReadOnly()){showMessage('accessMessage','El Preview no modifica cuentas reales. Usa “Prueba con datos ficticios” para probar estas acciones.');return;}
  adminAccessBusy=true;renderAdminAccess();
  try{const result=await action();await refreshAdminAccess();showMessage('accessMessage',typeof result==='string'?result:'Cambio guardado.');}catch(error){showMessage('accessMessage',String(error.message||'No se pudo guardar el cambio.'),false);}finally{adminAccessBusy=false;renderAdminAccess();}
}
async function changeAdminSession(id,status){
  if(!confirm(status==='revoked'?'¿Revocar este navegador? Dejará de tener acceso a los pedidos.':'¿Autorizar este navegador para usar el administrador?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_set_session',{p_session_id:id,p_status:status});if(error)throw error;});
}
async function changeAdminMember(id,enabled){
  const member=adminAccessState?.members?.find(m=>m.user_id===id);if(!member||member.primary_owner||member.current)return;
  if(adminRole==='manager'&&member.role!=='staff')return;
  if(!confirm(enabled?'¿Habilitar esta cuenta? Podrá entrar directamente con sus credenciales.':'¿Desactivar esta cuenta y revocar todos sus navegadores?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc(adminRole==='manager'?'pastehot_manager_set_staff_enabled':'pastehot_set_staff_enabled',{p_user_id:id,p_enabled:enabled});if(error)throw error;});
}
async function deleteAdminMember(id){
  if(!['owner','manager'].includes(adminRole)||!adminAccessAllowed||!adminAccessState?.direct_access)return;
  const member=adminAccessState.members?.find(m=>m.user_id===id);
  if(!member||member.primary_owner||member.current||!['owner','staff','manager'].includes(member.role)||(adminRole==='manager'&&member.role!=='staff'))return;
  if(!confirm(`¿Borrar definitivamente la cuenta de ${member.display_name}? Primero se desactivará y se cerrarán sus sesiones. Si el borrado no termina, permanecerá desactivada. Se eliminarán sus credenciales, dispositivos y registros asociados; los pedidos y ventas se conservan. Esta acción no se puede deshacer.`))return;
  await adminAccessAction(async()=>{
    const {data,error}=await db.functions.invoke('pastehot-create-staff',{body:{action:'delete',userId:id,deviceToken:adminDeviceToken()}});
    if(error||data?.error){let message=data?.error;try{if(!message&&error?.context?.json)message=(await error.context.json())?.error;}catch{}throw new Error(message||'No se completó el borrado. Actualiza accesos y vuelve a intentarlo.');}
    if(typeof loadStoreHistory==='function')await loadStoreHistory();
    return data?.delivery==='demo'?'Cuenta ficticia borrada de la prueba.':'Cuenta, dispositivos e historial asociado borrados.';
  });
}
async function changeAdminMemberRole(id,role){
  if(!['owner','manager','staff'].includes(role)||adminRole!=='owner'||!adminAccessAllowed)return;
  const member=adminAccessState?.members?.find(m=>m.user_id===id);
  if(!member||member.primary_owner||member.current||member.role===role)return;
  if(!confirm(`¿Cambiar los permisos de ${member.display_name} a ${adminRoleName(role)}? Los nuevos permisos se aplicarán a su cuenta y a todos sus dispositivos.`)){renderAdminAccess();return;}
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_set_staff_role',{p_user_id:id,p_role:role});if(error)throw error;});
}
async function activateAdminProtection(){
  if(!confirm('Se autorizará este navegador. Los demás necesitarán tu aprobación, sin un límite fijo de dispositivos. Conserva acceso a este navegador hasta autorizar tu teléfono o la tablet. ¿Activar?'))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_activate_security');if(error)throw error;});
}
async function renameAdminSession(id){
  if(!adminSecurityInstalled||adminRole!=='owner'||!adminAccessAllowed)return;
  const session=id?adminAccessState?.sessions?.find(s=>s.session_id===id):adminAccessState?.sessions?.find(s=>s.current);
  if(!session)return;const label=prompt('Nombre para identificar este dispositivo:',session.label||savedSessionLabel())?.trim();if(!label)return;
  if(label.length>60){alert('Usa un nombre de máximo 60 caracteres.');return;}
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_rename_session',{p_session_id:session.session_id,p_label:label});if(error)throw new Error(error.code==='PGRST202'?'Esta mejora está en preview y requiere activación antes de usarse con datos reales.':error.message);if(session.current)try{localStorage.setItem('pastehot_session_label',label);}catch{}});
}
async function removeAdminSession(id){
  if(adminRole!=='owner'||!adminAccessAllowed)return;const session=adminAccessState?.sessions?.find(s=>s.session_id===id);
  if(!session||session.current||session.status!=='revoked')return;
  if(!confirm(`¿Eliminar «${session.label}» de la lista? Su cuenta y el historial de tienda se conservan. Si vuelve a iniciar sesión, deberá solicitar autorización otra vez.`))return;
  await adminAccessAction(async()=>{const {error}=await db.rpc('pastehot_remove_session',{p_session_id:id});if(error)throw new Error(error.code==='PGRST202'?'Esta mejora está en preview y requiere activación antes de usarse con datos reales.':error.message);});
}
function openAccountPermissions(id){
  if(adminRole!=='owner'||!adminAccessAllowed)return;const member=adminAccessState?.members?.find(m=>m.user_id===id);
  if(!member||member.primary_owner||member.current||!['owner','manager','staff'].includes(member.role))return;
  const select=document.getElementById('account-role-'+id);select?.scrollIntoView({behavior:'smooth',block:'center'});select?.focus();
  showMessage('accessMessage',`Los permisos de ${member.display_name} se aplican a todos los dispositivos de su cuenta. Selecciona Empleado, Encargado o Segundo propietario.`);
}
async function createAdminStaff(event){
  event.preventDefault();if(adminAccessBusy||!['owner','manager'].includes(adminRole)||!adminAccessAllowed||!adminAccessState?.direct_access)return;
  const form=document.getElementById('staffInviteForm'),input=document.getElementById('staffAccountPassword');
  const username=document.getElementById('staffAccountUsername').value.trim().toLowerCase(),name=document.getElementById('staffInviteName').value.trim(),role=adminRole==='manager'?'staff':document.getElementById('staffInviteRole').value,password=input.value;
  const fail=message=>showMessage('staffAccountMessage',message,false);
  if(isAccountPreviewReadOnly()){fail('El Preview no crea cuentas reales. Usa “Prueba con datos ficticios” para revisar el flujo.');return;}
  if(!name||name.length>80){fail('Escribe el nombre de la persona (máximo 80 caracteres).');return;}
  if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)){fail('Revisa el usuario: de 3 a 32 caracteres, sin espacios ni acentos.');return;}
  if(password.length<12||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password)){fail('Usa una contraseña de 12 a 128 caracteres con letras y números.');return;}
  if(!['owner','manager','staff'].includes(role)){fail('Selecciona la función de la cuenta.');return;}
  if(role==='owner'&&!confirm('El segundo propietario tendrá control completo del administrador, excepto sobre tu cuenta principal protegida. ¿Crear esta cuenta con esos permisos?'))return;
  let activated=false;
  await adminAccessAction(async()=>{
    document.getElementById('staffAccountMessage').textContent='Creando cuenta…';
    let response;
    try{response=await db.functions.invoke(isPasteHotPreview()?'pastehot-create-staff-preview':'pastehot-create-staff',{body:{username,name,password,deviceToken:adminDeviceToken(),role}});}catch{
      const message='No se pudo conectar. Tus datos se conservan; revisa la conexión y el listado antes de reintentar.';fail(message);throw new Error(message);
    }
    const {data,error}=response;
    if(error||data?.error||data?.ok!==true){
      let message=data?.error;try{if(!message&&error?.context?.json){const response=await error.context.json();message=response?.error||response?.message;}}catch{}
      message=message||'No se pudo confirmar el alta. Revisa la conexión y el listado antes de volver a intentarlo.';fail(message);throw new Error(message);
    }
    activated=true;form.reset();resetPasswordVisibility();showAccountActivated(username,role);
    document.getElementById('createdAccountUsername').textContent=username;document.getElementById('createdAccountPassword').textContent=password;document.getElementById('createdAccountCredential').classList.remove('hidden');
    showMessage('staffAccountMessage',window.PasteHotDemo?'Cuenta ficticia activada para esta prueba. No se creó una cuenta real.':'Cuenta activada con éxito. Entrega el usuario y la contraseña que asignaste.');
    return data?.delivery==='demo'?'Prueba completada: cuenta ficticia agregada. No se creó una cuenta real ni se enviaron credenciales.':`Cuenta ${username} creada y activa. Puede entrar directamente.`;
  });
}
function clearStaffInvitation(){const input=document.getElementById('staffInvitationLink');if(input)input.value='';document.getElementById('staffInvitationResult')?.classList.add('hidden');}
async function copyStaffInvitation(){if(adminRole!=='owner'||!adminAccessAllowed)return;const input=document.getElementById('staffInvitationLink');if(!input?.value)return;try{await navigator.clipboard.writeText(input.value);showMessage('accessMessage','Enlace copiado. Compártelo únicamente con la persona invitada.');}catch{input.focus();input.select();showMessage('accessMessage','Selecciona y copia el enlace para entregarlo a la persona invitada.');}}
function setupOrderInbox(){
  if(orderInbox)return;
  let reviewed=[];try{reviewed=JSON.parse(localStorage.getItem('pastehot_reviewed_'+adminSession.user.id)||'[]');if(!Array.isArray(reviewed))reviewed=[];}catch{}
  orderInbox=new PasteHotOrders.OrderInbox({reviewed,onChange:renderOrderInbox,onNew:()=>{clearTimeout(orderSoundDebounce);orderSoundDebounce=setTimeout(()=>playOrderChime(),300);}});
}
// Realtime is the immediate path. While an alert is ringing, verify its
// authoritative status occasionally so a missed UPDATE event on another
// device cannot leave this session sounding indefinitely.
async function syncPendingOrderAlerts(){
  if(orderInboxSyncBusy||!adminAccessAllowed||!navigator.onLine||document.visibilityState!=='visible'||!orderInbox)return;
  const pending=orderInbox.list();if(!pending.length)return;
  orderInboxSyncBusy=true;
  try{
    const ids=pending.map(o=>String(o.id));
    const {data,error}=await db.from('orders').select('*').in('id',ids);
    if(error||!Array.isArray(data)||!adminAccessAllowed)return;
    const current=new Map(data.map(o=>[String(o.id),o]));
    for(const old of pending){
      const latest=current.get(String(old.id));
      if(!latest)handleOrderRealtimeChange({eventType:'DELETE',old:{id:old.id}});
      else if(latest.order_status!==old.order_status)handleOrderRealtimeChange({eventType:'UPDATE',new:latest});
    }
  }catch{}finally{orderInboxSyncBusy=false;}
}
function orderSoundPreferenceKey(){return 'pastehot_order_sound_'+adminSession.user.id;}
function rememberOrderSound(){try{localStorage.setItem(orderSoundPreferenceKey(),orderSoundEnabled?'on':'off');}catch{}}
function updateOrderSoundButton(){
  const button=document.getElementById('adminSoundButton');if(!button)return;
  button.textContent=!orderSoundEnabled?'Sonido silenciado · activar':orderAudio?.state==='running'?'Sonido activo · silenciar':'Sonido listo · toca la pantalla';
  button.setAttribute('aria-pressed',String(orderSoundEnabled));
}
function initializeOrderSound(){
  try{orderSoundEnabled=localStorage.getItem(orderSoundPreferenceKey())!=='off';}catch{orderSoundEnabled=true;}
  updateOrderSoundButton();resumeOrderAudio();
}
// Browsers may require a gesture after restoring a session. Any tap/key unlocks
// enabled alerts; it never overrides a saved mute preference.
document.addEventListener('pointerdown',()=>{if(adminAccessAllowed&&orderSoundEnabled&&orderAudio?.state!=='running')resumeOrderAudio();},{capture:true});
document.addEventListener('keydown',()=>{if(adminAccessAllowed&&orderSoundEnabled&&orderAudio?.state!=='running')resumeOrderAudio();},{capture:true});
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
  document.getElementById('orderSoundNote').textContent=orderSoundEnabled?(orderAudio?.state==='running'?'Sonido activo. Se repite cada 3 segundos hasta abrir el pedido aquí o actualizarlo desde otra sesión.':'Los avisos están activados. Toca cualquier parte de la pantalla para permitir el audio del navegador.'):'Avisos silenciados. Activa el sonido si deseas escuchar los pedidos nuevos.';
  if(!list.length){stopOrderChime();clearTimeout(orderSoundDebounce);clearInterval(orderSoundTimer);orderSoundTimer=null;clearInterval(orderInboxSyncTimer);orderInboxSyncTimer=null;}
  else{
    if(orderSoundEnabled&&!orderSoundTimer)orderSoundTimer=setInterval(playOrderChime,3000);
    if(!orderInboxSyncTimer)orderInboxSyncTimer=setInterval(syncPendingOrderAlerts,4000);
  }
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
  if(!adminAccessAllowed)return;
  orderSoundEnabled=!orderSoundEnabled;rememberOrderSound();
  if(!orderSoundEnabled){stopOrderChime();if(adminWakeLock){adminWakeLock.release().catch(()=>{});adminWakeLock=null;}clearInterval(orderSoundTimer);orderSoundTimer=null;}
  updateOrderSoundButton();renderOrderInbox(orderInbox?.list()||[]);
  if(orderSoundEnabled)await resumeOrderAudio();
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
  if(!orderAudio||orderAudio.state!=='running'){updateOrderSoundButton();return;}
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

async function resumeOrderAudio(){
  if(!orderSoundEnabled||!adminAccessAllowed)return;
  try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw new Error('Audio no disponible');orderAudio=orderAudio||new Audio();await orderAudio.resume();
    if(!orderSoundEnabled||!adminAccessAllowed)return;
    updateOrderSoundButton();renderOrderInbox(orderInbox?.list()||[]);if(orderAudio.state==='running'&&orderInbox?.list().length)playOrderChime();await requestAdminWakeLock();
  }catch{updateOrderSoundButton();const note=document.getElementById('orderSoundNote');if(note)note.textContent='No se pudo iniciar el audio. Toca la pantalla o revisa los permisos de sonido del navegador.';}
}
async function requestAdminWakeLock(){
  if(document.visibilityState!=='visible'||!orderSoundEnabled||!navigator.wakeLock||adminWakeLock)return;
  try{adminWakeLock=await navigator.wakeLock.request('screen');adminWakeLock.addEventListener('release',()=>{adminWakeLock=null;});}catch{}
}
function startOrderRecovery(){clearInterval(adminRecoveryTimer);adminRecoveryTimer=setInterval(()=>{if(adminAccessAllowed&&navigator.onLine&&document.visibilityState==='visible'&&!adminRealtimeOnline)refreshAdminAfterWake();},30000);}
function stopAdminEnhancements(){
  hideAccountToast();resetPasswordVisibility();document.getElementById('staffInviteForm')?.reset();
  document.getElementById('staffAccountMessage').textContent='';
  document.getElementById('createdAccountCredential')?.classList.add('hidden');document.getElementById('createdAccountUsername').textContent='';document.getElementById('createdAccountPassword').textContent='';
  closeAccountPasswordModal();
  clearStaffInvitation();
  stopAdminViewSync();stopStoreControl();resetAdminReports();stopOrderChime();
  clearInterval(adminAccessTimer);clearInterval(adminRecoveryTimer);clearInterval(orderSoundTimer);clearInterval(orderInboxSyncTimer);clearTimeout(orderSoundDebounce);
  clearTimeout(adminOrdersTimer);clearTimeout(adminProductsTimer);clearTimeout(adminSettingsTimer);clearTimeout(adminZonesTimer);
  orderSoundEnabled=false;orderSoundTimer=null;orderInboxSyncTimer=null;orderInboxSyncBusy=false;
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
