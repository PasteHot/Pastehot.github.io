const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict');
const path=require('path'),root=path.join(__dirname,'..');
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM(fs.readFileSync(root+'/admin.html','utf8'),{url:'https://deploy-preview-99--cheerful-daifuku-76579b.netlify.app/admin.html?demo=1',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let alerts=[];w.alert=s=>alerts.push(s);w.confirm=()=>true;w.prompt=()=> 'Nueva categoría';
 const soundLoops=[];const nativeInterval=w.setInterval.bind(w);w.setInterval=(fn,ms,...args)=>{if(ms===3000)soundLoops.push(fn);return nativeInterval(fn,ms,...args);};
 const files=['receipt.js','admin-orders.js','admin-preview-demo.js','admin-access.js','admin-store-control.js','admin-reports.js','admin-image-maintenance.js','admin-live-sync.js'].map(file=>fs.readFileSync(root+'/'+file,'utf8'));
 const inline=[...fs.readFileSync(root+'/admin.html','utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];w.eval(files.join('\n')+'\n'+inline);
 await tick();await tick();
 assert(!w.document.getElementById('adminScreen').classList.contains('hidden'));
 assert.equal(w.document.getElementById('adminSessionIdentity').textContent,'Propietario · Propietario');
 assert.equal(w.document.querySelectorAll('.product-group').length,4);
 assert.equal(w.document.querySelector('.product-group-heading').textContent,'Pastes salados2 productos');
 assert.equal(w.document.querySelectorAll('.presence-dot').length,1);assert(w.document.getElementById('staffInviteButton').textContent.includes('no crea acceso real'));
 assert.equal(w.document.querySelectorAll('.alert-order').length,1);
 w.prompt=()=> 'Tablet de atención';
 const tablet=w.PasteHotDemo.state.sessions.find(s=>s.role==='staff');
 await w.renameAdminSession(tablet.session_id);assert.equal(tablet.label,'Tablet de atención');await w.refreshAdminAccess();assert.equal(tablet.label,'Tablet de atención');
 assert(w.document.getElementById('accessSessions').textContent.includes('Renombrar'));assert(w.document.getElementById('accessSessions').textContent.includes('Cambiar permisos'));
 tablet.online=false;await w.refreshAdminAccess();assert(!w.document.getElementById('accessSessions').textContent.includes('Tablet de atención'));assert(w.PasteHotDemo.state.sessions.includes(tablet));assert(w.PasteHotDemo.state.members.some(m=>m.user_id===tablet.user_id&&m.enabled));
 tablet.online=true;await w.refreshAdminAccess();assert(w.document.getElementById('accessSessions').textContent.includes('Tablet de atención'));
 await w.changeAdminSession(tablet.session_id,'revoked');assert(!w.document.getElementById('accessSessions').textContent.includes('Tablet de atención'));
 await w.removeAdminSession(tablet.session_id);assert(!w.PasteHotDemo.state.sessions.some(s=>s.session_id===tablet.session_id));
 tablet.status='approved';tablet.online=true;w.PasteHotDemo.state.sessions.push(tablet);await w.refreshAdminAccess();
 let fakeAudio;const tones=[],gains=[];
 w.AudioContext=class{constructor(){fakeAudio=this;this.state='running';this.currentTime=0;this.destination={};}async resume(){}createOscillator(){const tone={type:'',frequency:{value:0},connect(){},disconnect(){},start(time){this.startAt=time;},stop(time){this.stopAt=time;this.stopped=true;}};tones.push(tone);return tone;}createGain(){const events=[];const gain={events,gain:{setValueAtTime(value,time){events.push(['set',value,time]);},linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);},exponentialRampToValueAtTime(value,time){events.push(['decay',value,time]);},cancelScheduledValues(time){events.push(['cancel',time]);}},connect(){},disconnect(){}};gains.push(gain);return gain;}};
 await w.resumeOrderAudio();assert.equal(tones.length,8);assert(tones.every(t=>t.type==='square'));assert(gains.every(g=>g.events.some(e=>e[0]==='ramp'&&e[1]>.65&&e[1]<1)));
 assert(tones.every((t,i)=>i===0||t.startAt>=tones[i-1].stopAt));
 w.playOrderChime(true);assert.equal(tones.length,8); // Consecutive orders cannot double the amplitude.
 assert.equal(soundLoops.length,1);fakeAudio.currentTime=3.1;soundLoops[0]();assert.equal(tones.length,16);
 const initialOrder=w.PasteHotDemo.tables.orders[0];w.reviewInboxOrder(initialOrder.id);assert(gains.every(g=>g.events.at(-1)[0]==='set'&&g.events.at(-1)[1]===0));
 fakeAudio.currentTime=6.2;soundLoops[0]();assert.equal(tones.length,16); // Reviewing the last alert prevents any further ringing.
 await w.toggleOrderSound();assert(gains.every(g=>g.events.at(-1)[0]==='set'&&g.events.at(-1)[1]===0));assert(tones.every(t=>t.stopAt===undefined));
 assert.equal(w.localStorage.getItem('pastehot_order_sound_'+(await w.PasteHotDemo.client.auth.getSession()).data.session.user.id),'off');
 w.initializeOrderSound();await tick();assert(w.document.getElementById('adminSoundButton').textContent.includes('silenciado'));
 w.document.dispatchEvent(new w.Event('pointerdown'));await tick();assert(w.document.getElementById('adminSoundButton').textContent.includes('silenciado'));
 await w.toggleOrderSound();fakeAudio.state='suspended';let blocked=true;fakeAudio.resume=async()=>{if(!blocked)fakeAudio.state='running';};
 await w.resumeOrderAudio();assert(w.document.getElementById('adminSoundButton').textContent.includes('toca la pantalla'));
 blocked=false;w.document.dispatchEvent(new w.Event('pointerdown'));await tick();assert(w.document.getElementById('adminSoundButton').textContent.includes('Sonido activo'));
 await w.toggleOrderSound();

 await w.toggleOrderSound();w.demoBurstOrders();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 w.document.querySelector('[data-inbox-order]').click();await tick();assert(w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.querySelectorAll('.alert-order').length,2);
 w.closeOrderModal();w.demoConnection();await tick();assert.equal(w.document.getElementById('adminLiveStatus'),null);assert(w.document.querySelector('.order-sound-controls #adminSoundButton'));assert.equal(w.document.querySelector('.topbar #adminSoundButton'),null);
 w.demoConnection();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 // Another device confirms orders, but this browser misses their Realtime
 // UPDATE. The small fallback query must reconcile the shared database state.
 const remotePending=[...w.document.querySelectorAll('[data-inbox-order]')].map(el=>String(el.dataset.inboxOrder));assert.equal(remotePending.length,3);
 fakeAudio.currentTime=30;w.playOrderChime();const toneCountBeforeRemoteConfirm=tones.length;
 for(const id of remotePending){const row=w.PasteHotDemo.tables.orders.find(o=>String(o.id)===id);row.order_status='confirmado';}
 await w.syncPendingOrderAlerts();assert.equal(w.document.querySelectorAll('[data-inbox-order]').length,0);assert.equal(w.document.querySelectorAll('.alert-order').length,0);
 w.playOrderChime();assert.equal(tones.length,toneCountBeforeRemoteConfirm,'all ringing stops after another session confirms the pending orders');
 const savedNotice='Volveremos en unos minutos.';
 await w.demoRole('staff');await tick();assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,1);assert(w.document.querySelector('[data-access-manage]').classList.contains('hidden'));assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 assert(w.allowedOrderStatuses({order_status:'pendiente_confirmacion',delivery_type:'pickup'}).includes('cancelado'));
 assert(w.allowedOrderStatuses({order_status:'listo',delivery_type:'delivery'}).includes('en_reparto'));
 assert(!w.allowedOrderStatuses({order_status:'listo',delivery_type:'pickup'}).includes('en_reparto'));
 const sample={order_code:'PH-123',customer_phone:'9991234567',delivery_type:'pickup'};
 for(const status of ['confirmado','preparando','listo','en_reparto','entregado','cancelado'])assert(decodeURIComponent(w.orderStatusWhatsAppUrl(sample,status)).includes('PH-123'));
 assert(decodeURIComponent(w.orderStatusWhatsAppUrl(sample,'listo')).includes('recoger'));
 assert(!w.document.getElementById('section-orders').classList.contains('hidden'));
 assert(!w.document.getElementById('storeEmergencyButton').disabled);w.openEmergencyStoreModal();assert(w.document.getElementById('storeChangeModal').classList.contains('show'));assert(w.document.querySelector('.store-audit-warning').textContent.includes('registrada'));
 w.document.getElementById('storeChangeReason').value='Fuga de agua en cocina';await w.submitEmergencyStoreChange({preventDefault(){}});assert(w.PasteHotDemo.state.storeEvents[0].closed);assert.equal(w.PasteHotDemo.state.storeEvents[0].actor_role,'staff');assert(w.document.getElementById('storeEmergencyStatus').textContent.includes('cerrada manualmente'));assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,'En unos instantes volveremos a recibir pedidos.');
 w.showTab('store-history');assert(w.document.getElementById('section-orders').classList.contains('active'));
 assert.equal((await w.PasteHotDemo.client.rpc('pastehot_store_history')).error.message,'NO_AUTORIZADO');
 w.openEmergencyStoreModal();w.document.getElementById('storeChangeReason').value='Reparación terminada';await w.submitEmergencyStoreChange({preventDefault(){}});assert.equal(w.PasteHotDemo.state.storeEvents.length,2);assert(!w.PasteHotDemo.state.storeEvents[1].closed);assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,'En unos instantes volveremos a recibir pedidos.');

 await w.updateOrderStatus(w.PasteHotDemo.tables.orders[0].id,'confirmado');await tick();assert.equal(alerts.filter(s=>s.includes('WhatsApp')).length,0);
 await w.demoRole('owner');await tick();assert.equal(w.document.querySelectorAll('.product-group').length,4);
 const publicCloseInput=w.document.getElementById('manualCloseReason');assert.equal(publicCloseInput.value,'En unos instantes volveremos a recibir pedidos.');assert.equal(publicCloseInput.readOnly,true);assert(!w.document.getElementById('editStorePublicMessage').classList.contains('hidden'));
 w.editStorePublicMessage();assert.equal(publicCloseInput.readOnly,false);publicCloseInput.value=savedNotice;await w.saveStorePublicMessage();assert.equal(publicCloseInput.readOnly,true);assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,savedNotice);
 await w.openStoreNow();assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,savedNotice);
 const managerSession=w.PasteHotDemo.state.sessions.find(s=>s.role==='manager');
 assert(![...w.document.querySelectorAll('#accessSessions button')].some(b=>b.textContent==='Autorizar'));assert.equal(w.document.querySelectorAll('.presence-dot').length,1);
 await w.demoRole('manager');await tick();assert.equal(managerSession.status,'approved');assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,6);assert.equal(w.document.getElementById('adminSessionIdentity').textContent,'Encargado · Encargado de prueba');w.openEmergencyStoreModal();w.document.getElementById('storeChangeReason').value='Prueba de cierre del encargado';await w.submitEmergencyStoreChange({preventDefault(){}});assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,savedNotice);w.openEmergencyStoreModal();w.document.getElementById('storeChangeReason').value='Prueba de reapertura del encargado';await w.submitEmergencyStoreChange({preventDefault(){}});assert.equal(w.PasteHotDemo.tables.settings.find(s=>s.key==='store_manual_close_reason').value,savedNotice);
 assert(!w.document.getElementById('categoryAdminCard').classList.contains('hidden'));assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 w.showTab('store-history');await tick();assert(w.document.getElementById('storeHistoryRows').textContent.includes('Fuga de agua'));assert(w.document.getElementById('storeHistoryRows').textContent.includes('Empleado de prueba'));
 w.showTab('products');assert(w.document.getElementById('section-products').classList.contains('active'));assert.equal(w.document.querySelectorAll('[onclick^="deleteProduct"]').length,0);assert.equal(w.document.querySelectorAll('#categoriesList .category-drag').length,0);assert.equal(w.document.querySelectorAll('#categoriesList button').length,0);
 w.prompt=()=> 'Nueva categoría';await w.newCategory();assert(w.PasteHotDemo.tables.settings.find(s=>s.key==='categories').value.includes('Nueva categoría'));
 assert(w.document.getElementById('newProductButton').classList.contains('hidden'));
 w.showTab('operation');assert(!w.document.querySelector('[data-manager-operation]').classList.contains('hidden'));assert(w.document.querySelector('[data-owner-operation]').classList.contains('hidden'));assert(w.document.getElementById('weeklyScheduleCard').classList.contains('hidden'));
 w.showTab('batch');assert(w.document.getElementById('section-batch').classList.contains('active'));
 w.showTab('access');assert(w.document.getElementById('section-access').classList.contains('active'));assert(!w.document.getElementById('staffInviteForm').classList.contains('hidden'));assert(w.document.getElementById('staffInviteRole').classList.contains('hidden'));assert(w.document.getElementById('deviceProtectionCard').classList.contains('hidden'));assert(!w.document.getElementById('accessMembers').textContent.includes('Propietario principal'));assert(!w.document.getElementById('accessMembers').textContent.includes('Encargado de prueba'));assert(!w.document.getElementById('accessMembers').textContent.includes('Encargada suplente'));assert(w.document.querySelector('#section-access .section-title p').textContent.includes('únicamente de empleados'));
 w.document.getElementById('staffInviteName').value='Nueva trabajadora';w.document.getElementById('staffAccountUsername').value='nueva.trabajadora';w.document.getElementById('staffAccountPassword').value='ClaveTrabajadora123!';await w.createAdminStaff({preventDefault(){}});const createdStaff=w.PasteHotDemo.state.members.find(m=>m.email==='staff+nueva.trabajadora@accounts.pastehot.com');assert(createdStaff);assert.equal(createdStaff.role,'staff');assert(w.document.getElementById('createdAccountCredential').textContent.includes('ClaveTrabajadora123!'));await w.changeAdminMember(createdStaff.user_id,false);assert.equal(createdStaff.enabled,false);await w.changeAdminMember(createdStaff.user_id,true);assert.equal(createdStaff.enabled,true);
 w.openResetAccountPassword(createdStaff.user_id);assert(w.document.getElementById('accountPasswordModal').classList.contains('show'));w.document.getElementById('accountNewPassword').value='NuevaClaveTrabajadora456!';await w.submitAccountPasswordReset({preventDefault(){}});assert(w.document.getElementById('accountPasswordResetMessage').textContent.includes('actualizada'));await w.closeAccountPasswordModal();await w.deleteAdminMember(createdStaff.user_id);assert(!w.PasteHotDemo.state.members.includes(createdStaff));assert(w.document.getElementById('accessMessage').textContent.includes('borrada'));const managerAccount=w.PasteHotDemo.state.members.find(m=>m.user_id==='33333333-3333-4333-8333-333333333333');await w.changeAdminMember(managerAccount.user_id,false);await w.deleteAdminMember(managerAccount.user_id);assert(w.PasteHotDemo.state.members.includes(managerAccount));assert(managerAccount.enabled);const protectedOwner=w.PasteHotDemo.state.members.find(m=>m.primary_owner);await w.changeAdminMember(protectedOwner.user_id,false);await w.deleteAdminMember(protectedOwner.user_id);assert(protectedOwner.enabled);
 const originalPrice=w.PasteHotDemo.tables.products[0].price;w.editProduct(w.PasteHotDemo.tables.products[0].id);assert(!w.document.getElementById('productModal').classList.contains('show'));w.document.getElementById('productPrice').value='29';await w.saveProduct();assert.equal(w.PasteHotDemo.tables.products[0].price,originalPrice);
 await w.toggleProduct(w.PasteHotDemo.tables.products[0].id,false);assert.equal(w.PasteHotDemo.tables.products[0].available,false);
 await w.deleteProduct(w.PasteHotDemo.tables.products[0].id);assert.equal(w.PasteHotDemo.tables.products.length,5);
 await w.demoRole('owner');await tick();
 w.document.getElementById('staffInviteRole').value='manager';w.document.getElementById('staffInviteName').value='Nueva encargada';w.document.getElementById('staffAccountUsername').value='nueva.turno';w.document.getElementById('staffAccountPassword').value='FixtureClave123!';await w.createAdminStaff({preventDefault(){}});assert.equal(w.PasteHotDemo.state.members.at(-1).role,'manager');assert.equal(w.document.getElementById('staffAccountPassword').value,'');assert(w.document.getElementById('deviceProtectionCard').classList.contains('hidden'));assert(!w.document.getElementById('accessSessions').textContent.includes('Autorizar'));assert.equal(w.document.querySelectorAll('#section-access').length,1);assert(w.document.getElementById('accessMessage').textContent.includes('No se creó una cuenta real'));assert.equal(w.document.getElementById('adminPresenceText').textContent,'2 conectados');
 await w.changeAdminMemberRole(w.PasteHotDemo.state.members.find(m=>m.role==='manager').user_id,'staff');assert.equal(managerSession.status,'revoked');

 const toDelete=w.PasteHotDemo.state.members.find(m=>m.display_name==='Empleado de prueba');
 assert(w.document.querySelector('[onclick="deleteAdminMember(\''+toDelete.user_id+'\')"]'));
 const savedConfirm=w.confirm;w.confirm=()=>false;await w.deleteAdminMember(toDelete.user_id);assert(w.PasteHotDemo.state.members.includes(toDelete));w.confirm=()=>true;
 const orderCount=w.PasteHotDemo.tables.orders.length;await w.deleteAdminMember(toDelete.user_id);
 assert(!w.PasteHotDemo.state.members.includes(toDelete));assert(!w.PasteHotDemo.state.sessions.some(s=>s.user_id===toDelete.user_id));assert(!w.PasteHotDemo.state.storeEvents.some(e=>e.actor_id===toDelete.user_id));assert(!w.document.getElementById('storeHistoryRows').textContent.includes('Empleado de prueba'));assert.equal(w.PasteHotDemo.tables.orders.length,orderCount);w.confirm=savedConfirm;
 w.document.getElementById('staffInviteRole').value='owner';w.document.getElementById('staffInviteName').value='Propietario delegado';w.document.getElementById('staffAccountUsername').value='propietario2';w.document.getElementById('staffAccountPassword').value='FixtureClave123!';await w.createAdminStaff({preventDefault(){}});
 const delegatedMember=w.PasteHotDemo.state.members.find(m=>m.role==='owner'&&!m.primary_owner);assert(delegatedMember);
 await w.demoRole('delegated');await tick();const delegatedState=(await w.PasteHotDemo.client.rpc('pastehot_admin_state')).data;assert.equal(delegatedState.role,'owner');assert.equal(delegatedState.primary_owner,false);assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,10);assert.equal(w.document.getElementById('adminSessionIdentity').textContent,'Propietario · Propietario delegado');assert(!w.adminCanOpenTab('business'));assert(w.adminCanOpenTab('operation'));assert(w.document.getElementById('accessMembers').textContent.includes('Copiar usuario'));
 const principal=w.PasteHotDemo.state.members.find(m=>m.primary_owner);await w.changeAdminMember(principal.user_id,false);await w.changeAdminMemberRole(principal.user_id,'staff');await w.deleteAdminMember(principal.user_id);assert.equal(principal.enabled,true);assert.equal(principal.role,'owner');assert(w.PasteHotDemo.state.members.includes(principal));assert(!w.document.querySelector('[onclick="deleteAdminMember(\''+principal.user_id+'\')"]'));assert(w.document.getElementById('accessMembers').textContent.includes('Cuenta principal protegida'));
 await w.demoRole('owner');await tick();await w.changeAdminMember(delegatedMember.user_id,false);assert.equal(delegatedMember.enabled,false);await w.deleteAdminMember(delegatedMember.user_id);assert(!w.PasteHotDemo.state.members.includes(delegatedMember));
 assert.equal(w.PasteHotDemo.state.role,'owner');
 // WhatsApp is prepared only after a successful state save; failure closes the
 // preopened window, and a blocked popup leaves a usable user-clicked fallback.
 const adapter=w.PasteHotDemo,client=adapter.client,nativeRpc=client.rpc;
 delete w.PasteHotDemo;let realAccountMutation=false;await w.adminAccessAction(async()=>{realAccountMutation=true;});assert.equal(realAccountMutation,false);assert(w.document.getElementById('accessMessage').textContent.includes('no modifica cuentas reales'));w.PasteHotDemo=adapter;
 const testOrder=adapter.tables.orders[0];testOrder.order_status='confirmado';
 let popup;w.open=()=>popup={closed:false,document:{write(){},close(){}},location:{href:''},close(){this.closed=true;}};
 delete w.PasteHotDemo;
 await w.updateOrderStatus(testOrder.id,'preparando');assert(decodeURIComponent(popup.location.href).includes('EN PREPARACIÓN'));
 client.rpc=async(name,args)=>name==='update_order_status_with_inventory_v2'?{error:{message:'STOCK_INSUFICIENTE|Prueba|0|2'}}:nativeRpc.call(client,name,args);
 await w.updateOrderStatus(testOrder.id,'listo');assert(popup.closed);assert.equal(testOrder.order_status,'preparando');assert.equal(popup.location.href,'');
 client.rpc=nativeRpc;w.open=()=>null;await w.updateOrderStatus(testOrder.id,'listo');assert(w.document.querySelector('#ordersMessage a[href^="https://wa.me/"]'));assert.equal(testOrder.order_status,'listo');
 w.PasteHotDemo=adapter;
 w.openOrderModal(w.PasteHotDemo.tables.orders[0].id);assert(w.document.getElementById('orderModal').classList.contains('show'));w.denyAdminAccess('Revocado');assert(!w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.getElementById('orderDetail').textContent,'');assert.equal(w.document.getElementById('adminSoundButton').textContent,'Activar sonido');
 w.stopAdminEnhancements();dom.window.close();
 // Query flags can never bypass authorization on the public domain.
 const live=new JSDOM('<html></html>',{url:'https://www.pastehot.com/admin.html?demo=1',runScripts:'outside-only'});
 live.window.eval(fs.readFileSync(root+'/admin-preview-demo.js','utf8'));assert.equal(live.window.PasteHotDemo,undefined);live.window.close();
 console.log('PASS: complete admin DOM boot, grouped products, connection dots, distinct loud ringtone repeated every 3 seconds, nonoverlapping voices, stop on last review and immediate mute, consecutive alerts, opening order, offline recovery, owner, manager and staff interfaces, manager availability toggle, category addition and restricted operations, role-change reapproval, employee emergency controls, manager history and employee history denial, no demo WhatsApp, production demo disabled.');
})().catch(e=>{console.error(e);process.exitCode=1;process.exit();});
