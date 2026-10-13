/* Audited store controls. Employee permissions never include editing schedules/settings. */
let storeControlState=null,storeControlReady=false,storeControlBusy=false,storeControlLoad=null;
let storeChangeTarget=null,storeChangeExpected=null,storeHistoryRows=[],storeHistoryMore=false,storeHistoryBusy=false,storeHistoryRequest=0,storeHistoryDeleteSelection=new Map(),storeHistoryDeleteBusy=false;
const DEFAULT_STORE_CLOSE_MESSAGE='En unos instantes volveremos a recibir pedidos.';
let storeMessageEditing=false,storeMessageBusy=false,storeMessageOriginal=DEFAULT_STORE_CLOSE_MESSAGE;
function storeHistoryAllowed(){return adminAccessAllowed&&['owner','manager'].includes(adminRole);}
function renderStoreMessageEditor(){
  const field=document.getElementById('manualCloseReason');if(!field)return;
  const owner=adminAccessAllowed&&adminRole==='owner';field.readOnly=!owner||!storeMessageEditing;field.setAttribute('aria-readonly',String(field.readOnly));
  document.getElementById('editStorePublicMessage').classList.toggle('hidden',!owner||storeMessageEditing);
  document.getElementById('saveStorePublicMessage').classList.toggle('hidden',!owner||!storeMessageEditing);
  document.getElementById('cancelStorePublicMessageEdit').classList.toggle('hidden',!owner||!storeMessageEditing);
  document.getElementById('saveStorePublicMessage').disabled=storeMessageBusy;document.getElementById('cancelStorePublicMessageEdit').disabled=storeMessageBusy;
}
function editStorePublicMessage(){
  if(!adminAccessAllowed||adminRole!=='owner')return;
  storeMessageOriginal=operationSettings.manualReason||DEFAULT_STORE_CLOSE_MESSAGE;storeMessageEditing=true;manualCloseReason.value=storeMessageOriginal;
  document.getElementById('storePublicMessageStatus').innerHTML='';renderStoreMessageEditor();manualCloseReason.focus();
}
function cancelStorePublicMessageEdit(){
  if(storeMessageBusy)return;storeMessageEditing=false;manualCloseReason.value=storeMessageOriginal;renderStoreMessageEditor();
}
async function saveStorePublicMessage(){
  if(!adminAccessAllowed||adminRole!=='owner'||!storeMessageEditing||storeMessageBusy)return;
  const message=manualCloseReason.value.trim();if(!message||message.length>160){showMessage('storePublicMessageStatus','Escribe un mensaje de 1 a 160 caracteres.',false);return;}
  storeMessageBusy=true;renderStoreMessageEditor();
  try{
    if(!storeControlReady)await loadStoreControl();
    if(!storeControlReady||!storeControlState)throw new Error('No se pudo confirmar el estado actual de la tienda. Intenta de nuevo.');
    await auditedStoreChange(storeControlState.manual_closed,'Actualización del mensaje público',storeControlState.manual_closed,message);
    operationSettings.manualReason=message;storeMessageOriginal=message;storeMessageEditing=false;manualCloseReason.value=message;
    showMessage('storePublicMessageStatus','Mensaje guardado. Se aplicará a los cierres manuales de todos los roles.');
  }catch(error){showMessage('storePublicMessageStatus',error.message||'No se pudo guardar el mensaje.',false);}
  finally{storeMessageBusy=false;renderStoreMessageEditor();}
}
function storeLocalDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Merida',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function storeEventTime(value){return new Intl.DateTimeFormat('es-MX',{timeZone:'America/Merida',dateStyle:'medium',timeStyle:'medium'}).format(new Date(value));}
async function loadStoreControl(){
  if(!adminAccessAllowed)return;
  if(storeControlLoad)return storeControlLoad;
  const uid=adminSession?.user.id,role=adminRole;
  storeControlLoad=(async()=>{
    const {data,error}=await db.rpc('pastehot_store_state');
    if(!adminAccessAllowed||adminSession?.user.id!==uid||adminRole!==role)return;
    const previous=storeControlState?.last_event_id;
    storeControlReady=!error&&typeof data?.manual_closed==='boolean';storeControlState=storeControlReady?data:null;
    renderStoreControl();
    if(storeControlReady&&previous!==data.last_event_id&&document.getElementById('section-store-history').classList.contains('active')&&storeHistoryAllowed())await loadStoreHistory();
  })();
  try{await storeControlLoad;}catch{storeControlReady=false;storeControlState=null;renderStoreControl();}finally{storeControlLoad=null;}
}
function renderStoreControl(){
  const closed=!!storeControlState?.manual_closed;
  renderStoreMessageEditor();
  document.getElementById('storeEmergencyCard').classList.toggle('hidden',!adminAccessAllowed);
  document.getElementById('storeEmergencyStatus').textContent=!storeControlReady?'Control de emergencia pendiente de activación':closed?'Tienda cerrada manualmente':storeControlState.open?'Tienda abierta':'Tienda cerrada por horario';
  document.getElementById('storeEmergencyStatus').className='store-emergency-status'+(closed?' closed':'');
  const button=document.getElementById('storeEmergencyButton');button.textContent=closed?'Restablecer tienda':'Cerrar tienda por emergencia';button.className='btn '+(closed?'btn-success':'btn-danger');button.disabled=!storeControlReady||storeControlBusy||!adminAccessAllowed;
  document.getElementById('storeHistoryQuick').classList.toggle('hidden',!storeHistoryAllowed());
  document.getElementById('storeEmergencyNotice').textContent='Cada cierre y restablecimiento registra fecha, hora, tu cuenta y motivo. El propietario y el encargado pueden consultar el historial. Los horarios no cambian.';
  if(!storeHistoryAllowed()){storeHistoryRows=[];document.getElementById('storeHistoryRows').innerHTML='';}
  document.querySelectorAll('[onclick="closeStoreNow()"],[onclick="openStoreNow()"],[onclick="saveOperationSettings()"]').forEach(b=>b.disabled=!storeControlReady||storeControlBusy);
}
function openEmergencyStoreModal(){
  if(!storeControlReady||!adminAccessAllowed||storeControlBusy)return;
  storeChangeTarget=!storeControlState.manual_closed;storeChangeExpected=storeControlState.manual_closed;
  document.getElementById('storeChangeTitle').textContent=storeChangeTarget?'Cerrar tienda por emergencia':'Restablecer la tienda';
  document.getElementById('storeChangeDescription').textContent=storeChangeTarget?'Se suspenderán los pedidos nuevos. Los pedidos ya recibidos seguirán disponibles para atenderlos.':'Se quitará el cierre manual. La tienda volverá a operar según el horario configurado; fuera de horario seguirá cerrada.';
  document.getElementById('storeChangeSubmit').textContent=storeChangeTarget?'Confirmar cierre':'Confirmar restablecimiento';
  document.getElementById('storeChangeReason').value='';document.getElementById('storeChangeMessage').textContent='';
  document.getElementById('storeChangeModal').classList.add('show');document.getElementById('storeChangeReason').focus();
}
function closeEmergencyStoreModal(){if(!storeControlBusy)document.getElementById('storeChangeModal').classList.remove('show');}
async function auditedStoreChange(closed,reason,expected,publicReason=null){
  if(!storeControlReady||!adminAccessAllowed)throw new Error('Este control aún no está activado. No se cambió la tienda.');
  const {data,error}=await db.rpc('pastehot_set_store_closed',{p_closed:closed,p_reason:reason,p_expected_closed:expected,p_public_reason:publicReason});
  if(error)throw new Error(error.message||'No se pudo cambiar el estado.');
  storeControlState=data;renderStoreControl();
  return data;
}
async function submitEmergencyStoreChange(event){
  event.preventDefault();if(storeControlBusy||!adminAccessAllowed)return;
  const reason=document.getElementById('storeChangeReason').value.trim();
  if(reason.length<5||reason.length>240){showMessage('storeChangeMessage','Escribe un motivo de entre 5 y 240 caracteres.',false);return;}
  storeControlBusy=true;document.getElementById('storeChangeSubmit').disabled=true;renderStoreControl();
  try{
    const result=await auditedStoreChange(storeChangeTarget,reason,storeChangeExpected);
    document.getElementById('storeChangeModal').classList.remove('show');
    showMessage('storeEmergencyMessage',result.changed?'Estado guardado y registrado en el historial.':'La tienda ya tenía ese estado; no se agregó un registro duplicado.');
    if(storeHistoryAllowed())await loadStoreHistory();
    if(adminRole==='owner')await loadOperationSettings();
  }catch(error){showMessage('storeChangeMessage',error.message||'No se pudo guardar. Comprueba la conexión.',false);await loadStoreControl();}
  finally{storeControlBusy=false;document.getElementById('storeChangeSubmit').disabled=false;renderStoreControl();}
}
async function loadStoreHistory(append=false){
  if(!storeHistoryAllowed()||!storeControlReady)return;
  const request=++storeHistoryRequest,uid=adminSession.user.id,role=adminRole;
  storeHistoryBusy=true;document.getElementById('storeHistoryMore').disabled=true;
  const day=document.getElementById('storeHistoryDay').value||null,only=document.getElementById('storeHistoryHoursOnly').checked;
  const offset=append?storeHistoryRows.length:0;
  if(!append){storeHistoryDeleteSelection.clear();storeHistoryRows=[];storeHistoryMore=false;document.getElementById('storeHistoryRows').innerHTML='<tr><td colspan="6">Cargando movimientos…</td></tr>';document.getElementById('storeHistoryMore').classList.add('hidden');}
  try{
    const {data,error}=await db.rpc('pastehot_store_history',{p_day:day,p_offset:offset,p_only_during_hours:only});
    if(request!==storeHistoryRequest||!storeHistoryAllowed()||adminSession.user.id!==uid||adminRole!==role)return;
    if(error)throw new Error(error.message||'No se pudo cargar el historial.');
    storeHistoryRows=append?Array.from(new Map([...storeHistoryRows,...data.events].map(e=>[e.id,e])).values()):data.events;
    storeHistoryMore=!!data.has_more;renderStoreHistory();document.getElementById('storeHistoryMessage').textContent='';
  }catch(error){if(request===storeHistoryRequest)showMessage('storeHistoryMessage',error.message||'No se pudo cargar el historial.',false);}
  finally{if(request===storeHistoryRequest){storeHistoryBusy=false;document.getElementById('storeHistoryMore').disabled=false;}}
}
function showAllStoreHistory(){document.getElementById('storeHistoryDay').value='';loadStoreHistory();}
function canDeleteStoreHistory(){return adminAccessAllowed&&typeof isPrimaryOwner==='function'&&isPrimaryOwner();}
function ensureStoreHistoryDeleteUi(){
  const section=document.getElementById('section-store-history'),table=document.getElementById('storeHistoryRows')?.closest('table');if(!section||!table)return null;
  let toolbar=document.getElementById('storeHistoryDeleteToolbar');
  if(!toolbar){toolbar=document.createElement('div');toolbar.id='storeHistoryDeleteToolbar';toolbar.className='history-delete-toolbar hidden';toolbar.dataset.primaryOwnerOnly='';toolbar.innerHTML='<div><strong id="storeHistoryDeleteCount">0 movimientos seleccionados</strong><p>Se borrarán definitivamente los registros marcados.</p></div><div class="history-delete-actions"><button id="clearStoreHistoryDeleteSelection" type="button" class="btn btn-light">Quitar selección</button><button id="deleteStoreHistorySelection" type="button" class="btn btn-danger" disabled>Borrar movimientos</button></div><div id="storeHistoryDeleteMessage" class="history-delete-message" role="status" aria-live="polite"></div>';
    table.closest('.table-wrap')?.parentNode?.insertBefore(toolbar,table.closest('.table-wrap'));}
  const head=table.querySelector('thead tr');let selectCell=head?.querySelector('[data-store-event-select-cell]');if(head&&!selectCell){selectCell=document.createElement('th');selectCell.className='order-select-header';selectCell.dataset.storeEventSelectCell='';selectCell.dataset.primaryOwnerOnly='';selectCell.innerHTML='<input type="checkbox" data-select-all-store-events aria-label="Seleccionar movimientos visibles">';head.insertBefore(selectCell,head.firstChild);}selectCell?.classList.toggle('hidden',!canDeleteStoreHistory());
  toolbar.classList.toggle('hidden',!canDeleteStoreHistory());return toolbar;
}
function updateStoreHistoryDeleteUi(){const toolbar=ensureStoreHistoryDeleteUi();if(!toolbar)return;const owner=canDeleteStoreHistory(),count=toolbar.querySelector('#storeHistoryDeleteCount'),button=toolbar.querySelector('#deleteStoreHistorySelection'),all=toolbar.querySelector('[data-select-all-store-events]'),ids=new Set(storeHistoryRows.map(e=>String(e.id)));toolbar.classList.toggle('hidden',!owner);if(count)count.textContent=`${storeHistoryDeleteSelection.size} movimiento${storeHistoryDeleteSelection.size===1?'':'s'} seleccionado${storeHistoryDeleteSelection.size===1?'':'s'}`;if(button){button.disabled=!owner||!storeHistoryDeleteSelection.size||storeHistoryDeleteBusy;button.textContent=storeHistoryDeleteBusy?'Borrando…':'Borrar movimientos';}if(all){all.checked=ids.size>0&&[...ids].every(id=>storeHistoryDeleteSelection.has(id));all.indeterminate=!all.checked&&[...ids].some(id=>storeHistoryDeleteSelection.has(id));all.disabled=!owner||!ids.size;}}
async function deleteSelectedStoreHistory(){if(!canDeleteStoreHistory()||storeHistoryDeleteBusy||!storeHistoryDeleteSelection.size)return;const selected=[...storeHistoryDeleteSelection.values()],examples=selected.slice(0,5).map(e=>`${e.closed?'Cierre':'Restablecimiento'} · ${storeEventTime(e.created_at)}`).join('; ');if(!confirm(`Borrar definitivamente ${selected.length} movimiento${selected.length===1?'':'s'} del historial: ${examples}${selected.length>5?'…':''}. No se cambiará el estado actual de la tienda. Esta acción no se puede deshacer.`))return;storeHistoryDeleteBusy=true;updateStoreHistoryDeleteUi();try{const {data,error}=await db.rpc('pastehot_delete_store_events',{p_event_ids:selected.map(e=>Number(e.id))});if(error)throw new Error(error.message||'No se pudieron borrar los movimientos.');const deleted=Number(data?.deleted_count);if(!Number.isFinite(deleted))throw new Error('La base de datos no confirmó el borrado.');storeHistoryDeleteSelection.clear();await loadStoreHistory();const message=document.getElementById('storeHistoryDeleteMessage');if(message)message.textContent=`Se borraron ${deleted} movimiento${deleted===1?'':'s'} del historial.`;}catch(error){const message=document.getElementById('storeHistoryDeleteMessage');if(message)message.textContent=error.message==='NO_AUTORIZADO'?'Solo la propietaria principal puede borrar el historial.':`No se pudo borrar el historial: ${error.message||'error de conexión'}`;}finally{storeHistoryDeleteBusy=false;updateStoreHistoryDeleteUi();}}
function renderStoreHistory(){
  if(!storeHistoryAllowed())return;
  const owner=canDeleteStoreHistory(),toolbar=ensureStoreHistoryDeleteUi();document.querySelector('#storeHistoryRows').innerHTML=storeHistoryRows.length?storeHistoryRows.map(e=>`<tr>${owner?`<td class="order-select-cell"><input type="checkbox" data-primary-owner-only data-delete-store-event="${escapeHtml(e.id)}" aria-label="Seleccionar movimiento ${escapeHtml(e.id)}" ${storeHistoryDeleteSelection.has(String(e.id))?'checked':''}></td>`:''}<td>${escapeHtml(storeEventTime(e.created_at))}</td><td><strong>${e.closed?'Cierre manual':'Restablecimiento'}</strong></td><td>${escapeHtml(e.actor_name)}<small>${adminRoleName(e.actor_role)} · ${escapeHtml(e.session_label)}</small></td><td>${escapeHtml(e.reason)}</td><td>${e.during_hours?'Dentro del horario':'Fuera del horario'}</td></tr>`).join(''):`<tr><td colspan="${owner?6:5}">No hay movimientos para este filtro.</td></tr>`;
  if(owner&&toolbar){const root=document.getElementById('section-store-history');root.querySelectorAll('[data-delete-store-event]').forEach(input=>input.addEventListener('change',()=>{const id=String(input.dataset.deleteStoreEvent);if(input.checked){const event=storeHistoryRows.find(e=>String(e.id)===id);if(event)storeHistoryDeleteSelection.set(id,{id:event.id,closed:event.closed,created_at:event.created_at});}else storeHistoryDeleteSelection.delete(id);updateStoreHistoryDeleteUi();}));if(!toolbar.dataset.listeners){toolbar.dataset.listeners='1';toolbar.querySelector('[data-select-all-store-events]')?.addEventListener('change',()=>{storeHistoryRows.forEach(event=>{const id=String(event.id);if(toolbar.querySelector('[data-select-all-store-events]').checked)storeHistoryDeleteSelection.set(id,{id:event.id,closed:event.closed,created_at:event.created_at});else storeHistoryDeleteSelection.delete(id);});renderStoreHistory();});toolbar.querySelector('#clearStoreHistoryDeleteSelection')?.addEventListener('click',()=>{storeHistoryDeleteSelection.clear();renderStoreHistory();});toolbar.querySelector('#deleteStoreHistorySelection')?.addEventListener('click',deleteSelectedStoreHistory);}updateStoreHistoryDeleteUi();}
  document.getElementById('storeHistoryMore').classList.toggle('hidden',!storeHistoryMore);
}
function stopStoreControl(){
  storeControlState=null;storeControlReady=false;storeHistoryRequest++;storeHistoryRows=[];storeControlLoad=null;storeMessageEditing=false;storeMessageBusy=false;renderStoreMessageEditor();
  document.getElementById('storeHistoryRows').innerHTML='';document.getElementById('storeEmergencyCard').classList.add('hidden');
}
