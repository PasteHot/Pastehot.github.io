const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict');
const path=require('path'),root=path.join(__dirname,'..');
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM(fs.readFileSync(root+'/admin.html','utf8'),{url:'https://deploy-preview-99--cheerful-daifuku-76579b.netlify.app/admin.html?demo=1',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let alerts=[];w.alert=s=>alerts.push(s);w.confirm=()=>true;
 const files=['receipt.js','admin-orders.js','admin-preview-demo.js','admin-access.js','admin-store-control.js','admin-reports.js','admin-image-maintenance.js'].map(file=>fs.readFileSync(root+'/'+file,'utf8'));
 const inline=[...fs.readFileSync(root+'/admin.html','utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];w.eval(files.join('\n')+'\n'+inline);
 await tick();await tick();
 assert(!w.document.getElementById('adminScreen').classList.contains('hidden'));
 assert.equal(w.document.querySelectorAll('.product-group').length,4);
 assert.equal(w.document.querySelector('.product-group-heading').textContent,'Pastes salados2 productos');
 assert.equal(w.document.querySelectorAll('.presence-dot').length,1);assert(w.document.getElementById('staffInviteButton').textContent.includes('no crea acceso real'));
 assert.equal(w.document.querySelectorAll('.alert-order').length,1);
 w.prompt=()=> 'Tablet de atención';
 const tablet=w.PasteHotDemo.state.sessions.find(s=>s.role==='staff');
 await w.renameAdminSession(tablet.session_id);assert.equal(tablet.label,'Tablet de atención');await w.refreshAdminAccess();assert.equal(tablet.label,'Tablet de atención');
 assert(w.document.getElementById('accessSessions').textContent.includes('Renombrar'));assert(w.document.getElementById('accessSessions').textContent.includes('Cambiar permisos'));
 await w.changeAdminSession(tablet.session_id,'revoked');assert(w.document.getElementById('accessSessions').textContent.includes('Eliminar de la lista'));
 await w.removeAdminSession(tablet.session_id);assert(!w.PasteHotDemo.state.sessions.some(s=>s.session_id===tablet.session_id));
 tablet.status='approved';tablet.online=true;w.PasteHotDemo.state.sessions.push(tablet);await w.refreshAdminAccess();
 let fakeAudio;const tones=[],gains=[],soundLoops=[];const nativeInterval=w.setInterval.bind(w);w.setInterval=(fn,ms,...args)=>{if(ms===3000)soundLoops.push(fn);return nativeInterval(fn,ms,...args);};
 w.AudioContext=class{constructor(){fakeAudio=this;this.state='running';this.currentTime=0;this.destination={};}async resume(){}createOscillator(){const tone={type:'',frequency:{value:0},connect(){},disconnect(){},start(time){this.startAt=time;},stop(time){this.stopAt=time;this.stopped=true;}};tones.push(tone);return tone;}createGain(){const events=[];const gain={events,gain:{setValueAtTime(value,time){events.push(['set',value,time]);},linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);},exponentialRampToValueAtTime(value,time){events.push(['decay',value,time]);},cancelScheduledValues(time){events.push(['cancel',time]);}},connect(){},disconnect(){}};gains.push(gain);return gain;}};
 await w.toggleOrderSound();assert.equal(tones.length,8);assert(tones.every(t=>t.type==='square'));assert(gains.every(g=>g.events.some(e=>e[0]==='ramp'&&e[1]>.65&&e[1]<1)));
 assert(tones.every((t,i)=>i===0||t.startAt>=tones[i-1].stopAt));
 w.playOrderChime(true);assert.equal(tones.length,8); // Consecutive orders cannot double the amplitude.
 assert.equal(soundLoops.length,1);fakeAudio.currentTime=3.1;soundLoops[0]();assert.equal(tones.length,16);
 const initialOrder=w.PasteHotDemo.tables.orders[0];w.reviewInboxOrder(initialOrder.id);assert(gains.every(g=>g.events.at(-1)[0]==='set'&&g.events.at(-1)[1]===0));
 fakeAudio.currentTime=6.2;soundLoops[0]();assert.equal(tones.length,16); // Reviewing the last alert prevents any further ringing.
 await w.toggleOrderSound();assert(gains.every(g=>g.events.at(-1)[0]==='set'&&g.events.at(-1)[1]===0));assert(tones.every(t=>t.stopAt===undefined));

 w.demoBurstOrders();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 w.document.querySelector('[data-inbox-order]').click();await tick();assert(w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.querySelectorAll('.alert-order').length,2);
 w.closeOrderModal();w.demoConnection();await tick();assert.equal(w.document.getElementById('adminLiveStatus'),null);assert(w.document.querySelector('.order-sound-controls #adminSoundButton'));assert.equal(w.document.querySelector('.topbar #adminSoundButton'),null);
 w.demoConnection();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 await w.demoRole('staff');await tick();assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,1);assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 assert(!w.document.getElementById('section-orders').classList.contains('hidden'));
 assert(!w.document.getElementById('storeEmergencyButton').disabled);w.openEmergencyStoreModal();assert(w.document.getElementById('storeChangeModal').classList.contains('show'));assert(w.document.querySelector('.store-audit-warning').textContent.includes('registrada'));
 w.document.getElementById('storeChangeReason').value='Fuga de agua en cocina';await w.submitEmergencyStoreChange({preventDefault(){}});assert(w.PasteHotDemo.state.storeEvents[0].closed);assert.equal(w.PasteHotDemo.state.storeEvents[0].actor_role,'staff');assert(w.document.getElementById('storeEmergencyStatus').textContent.includes('cerrada manualmente'));
 w.showTab('store-history');assert(w.document.getElementById('section-orders').classList.contains('active'));
 assert.equal((await w.PasteHotDemo.client.rpc('pastehot_store_history')).error.message,'NO_AUTORIZADO');
 w.openEmergencyStoreModal();w.document.getElementById('storeChangeReason').value='Reparación terminada';await w.submitEmergencyStoreChange({preventDefault(){}});assert.equal(w.PasteHotDemo.state.storeEvents.length,2);assert(!w.PasteHotDemo.state.storeEvents[1].closed);

 await w.updateOrderStatus(w.PasteHotDemo.tables.orders[0].id,'confirmado');await tick();assert.equal(alerts.filter(s=>s.includes('WhatsApp')).length,0);
 await w.demoRole('owner');await tick();assert.equal(w.document.querySelectorAll('.product-group').length,4);
 const managerSession=w.PasteHotDemo.state.sessions.find(s=>s.role==='manager');
 assert(![...w.document.querySelectorAll('#accessSessions button')].some(b=>b.textContent==='Autorizar'));assert.equal(w.document.querySelectorAll('.presence-dot').length,1);
 await w.demoRole('manager');await tick();assert.equal(managerSession.status,'approved');assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,3);
 assert(w.document.getElementById('categoryAdminCard').classList.contains('hidden'));assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 w.showTab('store-history');await tick();assert(w.document.getElementById('storeHistoryRows').textContent.includes('Fuga de agua'));assert(w.document.getElementById('storeHistoryRows').textContent.includes('Empleado de prueba'));
 w.showTab('products');assert(w.document.getElementById('section-products').classList.contains('active'));assert.equal(w.document.querySelectorAll('[onclick^="deleteProduct"]').length,0);
 w.showTab('access');assert(w.document.getElementById('section-products').classList.contains('active'));
 w.editProduct(w.PasteHotDemo.tables.products[0].id);assert(w.document.getElementById('productModal').classList.contains('show'));w.document.getElementById('productPrice').value='29';await w.saveProduct();assert.equal(w.PasteHotDemo.tables.products[0].price,29);w.closeProductModal();
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
 assert.equal(w.PasteHotDemo.state.role,'owner');
 w.openOrderModal(w.PasteHotDemo.tables.orders[0].id);assert(w.document.getElementById('orderModal').classList.contains('show'));w.denyAdminAccess('Revocado');assert(!w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.getElementById('orderDetail').textContent,'');assert.equal(w.document.getElementById('adminSoundButton').textContent,'Activar sonido');
 w.stopAdminEnhancements();dom.window.close();
 // Query flags can never bypass authorization on the public domain.
 const live=new JSDOM('<html></html>',{url:'https://www.pastehot.com/admin.html?demo=1',runScripts:'outside-only'});
 live.window.eval(fs.readFileSync(root+'/admin-preview-demo.js','utf8'));assert.equal(live.window.PasteHotDemo,undefined);live.window.close();
 console.log('PASS: complete admin DOM boot, grouped products, connection dots, distinct loud ringtone repeated every 3 seconds, nonoverlapping voices, stop on last review and immediate mute, consecutive alerts, opening order, offline recovery, owner, manager and staff interfaces, manager product editing, role-change reapproval, employee emergency controls, manager history and employee history denial, no demo WhatsApp, production demo disabled.');
})().catch(e=>{console.error(e);process.exitCode=1;process.exit();});
