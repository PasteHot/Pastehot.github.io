/* Event-driven view refreshes; drafts and account authorization take priority. */
const adminFormBaselines=new Map(),adminPendingViews=new Set(),adminViewVersions=new Map();
let adminViewEpoch=0;
let adminViewRefreshTimer=null,adminViewRefreshRunning=false,adminWakeRefreshPromise=null;
function adminFormControls(view){const root=document.getElementById(view==='order-detail'?'orderModal':'section-'+view);return [...(root?.querySelectorAll('input,select,textarea')||[])];}
function adminFormSnapshot(view){return new Map(adminFormControls(view).map((el,i)=>[el.id||`${i}:${el.name}:${el.type}`,JSON.stringify([el.type==='checkbox'?el.checked:el.value,el.type==='file'?el.files?.length||0:0])]));}
function adminSameSnapshot(a,b){return a.size===b.size&&[...a].every(([key,value])=>b.get(key)===value);}
function adminFormIsDirty(view){const baseline=adminFormBaselines.get(view);return !!baseline&&!adminSameSnapshot(baseline,adminFormSnapshot(view));}
function adminFormLoaded(view,version){adminFormBaselines.set(view,adminFormSnapshot(view));if(version===(adminViewVersions.get(view)||0))adminPendingViews.delete(view);document.getElementById('live-note-'+view)?.remove();}
function adminDeferredView(view){
 adminPendingViews.add(view);const root=document.getElementById(view==='order-detail'?'orderModal':'section-'+view);if(!root||document.getElementById('live-note-'+view))return;
 const note=document.createElement('div');note.id='live-note-'+view;note.className='access-note';note.setAttribute('role','status');
 note.textContent='Hay datos nuevos. Tus cambios sin guardar se conservan. ';
 const button=document.createElement('button');button.type='button';button.className='btn btn-light btn-small';button.textContent='Cargar datos nuevos';
 button.onclick=()=>{if(adminFormIsDirty(view)&&!confirm('¿Descartar los cambios sin guardar de este apartado y cargar los datos nuevos?'))return;adminFormBaselines.delete(view);note.remove();scheduleAdminViewRefresh(view);};note.appendChild(button);root.prepend(note);
}
function adminFormLoadGuard(view){
 if(adminFormIsDirty(view)||(view==='delivery-zones'&&pendingZoneId)){adminDeferredView(view);return null;}
 const snapshot=adminFormSnapshot(view),user=adminSession?.user?.id,role=adminRole,epoch=adminViewEpoch,version=adminViewVersions.get(view)||0;
 if(!adminFormBaselines.has(view))adminFormBaselines.set(view,snapshot);
 const guard=()=>{if(!adminAccessAllowed||epoch!==adminViewEpoch||user!==adminSession?.user?.id||role!==adminRole)return false;if(version!==(adminViewVersions.get(view)||0))return false;if(!adminSameSnapshot(snapshot,adminFormSnapshot(view))){adminDeferredView(view);return false;}return true;};guard.version=version;return guard;
}
const adminSettingControls={store_manual_closed:'manualStoreClosed',store_manual_close_reason:'manualCloseReason',delivery_badge_enabled:'deliveryBadgeEnabled',delivery_badge_text:'deliveryBadgeText',social_proof_enabled:'socialProofEnabled',social_proof_count:'socialProofCount',social_proof_suffix:'socialProofSuffix',delivery_transfer_only:'deliveryTransferOnly',rain_surcharge_enabled:'rainSurchargeEnabled',rain_surcharge_amount:'rainSurchargeAmount',rain_surcharge_message:'rainSurchargeMessage',batch_timer_enabled:'batchEnabled',batch_duration_minutes:'batchDuration',batch_fresh_minutes:'batchFreshMinutes',batch_label:'batchLabel',batch_finished_message:'batchFinishedMessage'};
function adminSavedDraftForSetting(key){
 const elements=key==='weekly_schedule'?[...document.querySelectorAll('#weeklySchedule input')]:[document.getElementById(adminSettingControls[key]||key)].filter(Boolean);
 return elements.map(el=>{const view=el.closest('.section')?.id.replace('section-','');if(!view)return null;const controls=adminFormControls(view),i=controls.indexOf(el),field=el.id||`${i}:${el.name}:${el.type}`;return {view,field,value:adminFormSnapshot(view).get(field)};}).filter(Boolean);
}
function commitAdminSavedDraft(fields){for(const {view,field,value} of fields){adminFormBaselines.get(view)?.set(field,value);if(!adminFormIsDirty(view))document.getElementById('live-note-'+view)?.remove();}if(fields.length)scheduleAdminViewRefresh();}
function adminSettingView(key){
 if(/^(cover_|profile_|background_|category_title_)/.test(key))return 'design';
 if(key?.startsWith('batch_'))return 'batch';
 if(key==='categories')return 'categories';
 if(key in adminSettingControls||key==='weekly_schedule')return 'operation';
 return 'business';
}
function scheduleAdminSettingsReload(payload){scheduleAdminViewRefresh('store',adminSettingView(payload?.new?.key||payload?.old?.key));}
function scheduleAdminViewRefresh(...views){views.forEach(view=>{adminPendingViews.add(view);adminViewVersions.set(view,(adminViewVersions.get(view)||0)+1);});clearTimeout(adminViewRefreshTimer);adminViewRefreshTimer=setTimeout(flushAdminViews,180);}
function adminViewCanRun(view){
 if(view==='store'||view==='report')return true;
 if(view==='products')return adminCanEditProducts();
 if(view==='categories')return adminCanEditProducts()&&!categoryDragState&&!categoryOrderSaving&&!document.getElementById('productModal').classList.contains('show');
 return document.getElementById('section-'+view)?.classList.contains('active')&&adminCanOpenTab(view)&&!adminFormIsDirty(view)&&!(view==='delivery-zones'&&pendingZoneId);
}
async function flushAdminViews(){
 if(adminViewRefreshRunning||!adminAccessAllowed||!navigator.onLine||document.visibilityState!=='visible')return;
 adminViewRefreshRunning=true;const user=adminSession?.user?.id;
 try{for(const view of [...adminPendingViews]){
   if(!adminAccessAllowed||user!==adminSession?.user?.id)break;
   const active=[...document.querySelectorAll('.section')].find(el=>el.classList.contains('active'))?.id.replace('section-','');
   if(view==='store'){adminPendingViews.delete(view);await loadStoreControl();continue;}
   if(view==='categories'){if(!adminCanEditProducts()){adminPendingViews.delete(view);continue;}if(categoryDragState||categoryOrderSaving||document.getElementById('productModal').classList.contains('show'))continue;adminPendingViews.delete(view);await loadCategories();continue;}
   if(view==='products'){adminPendingViews.delete(view);if(adminCanEditProducts())await loadProducts();continue;}
   if(view==='report'){adminPendingViews.delete(view);if(reportOwner()&&active==='paste-sales'&&document.getElementById('salesReportContent').textContent.trim())await prepareSalesReport();continue;}
   if(view!==active||!adminCanOpenTab(view))continue;
   if(adminFormIsDirty(view)){adminDeferredView(view);continue;}
   const loader={design:loadDesign,business:loadBusinessSettings,batch:loadBatchSettings,operation:loadOperationSettings,'delivery-zones':loadDeliveryZones,'store-history':loadStoreHistory}[view];
   if(loader){adminPendingViews.delete(view);await loader();}
 }}catch{const el=document.getElementById('ordersLoadMessage');if(el)el.textContent='Se perdió una actualización. Se recuperará al reconectar.';}finally{adminViewRefreshRunning=false;if(adminAccessAllowed&&navigator.onLine&&document.visibilityState==='visible'&&[...adminPendingViews].some(adminViewCanRun))scheduleAdminViewRefresh();}
}
function stopAdminViewSync(){adminViewEpoch++;clearTimeout(adminViewRefreshTimer);adminViewRefreshTimer=null;adminPendingViews.clear();adminFormBaselines.clear();adminViewVersions.clear();}
