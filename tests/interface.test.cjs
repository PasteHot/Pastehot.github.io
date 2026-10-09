const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict');
const path=require('path'),root=path.join(__dirname,'..');
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM(fs.readFileSync(root+'/admin.html','utf8'),{url:'https://deploy-preview-99--cheerful-daifuku-76579b.netlify.app/admin.html?demo=1',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let alerts=[];w.alert=s=>alerts.push(s);w.confirm=()=>true;
 const files=['receipt.js','admin-orders.js','admin-preview-demo.js','admin-access.js'].map(file=>fs.readFileSync(root+'/'+file,'utf8'));
 const inline=[...fs.readFileSync(root+'/admin.html','utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];w.eval(files.join('\n')+'\n'+inline);
 await tick();await tick();
 assert(!w.document.getElementById('adminScreen').classList.contains('hidden'));
 assert.equal(w.document.querySelectorAll('.product-group').length,4);
 assert.equal(w.document.querySelector('.product-group-heading').textContent,'Pastes salados2 productos');
 assert.equal(w.document.querySelectorAll('.presence-dot').length,2);
 assert.equal(w.document.querySelectorAll('.alert-order').length,1);
 const tones=[],gains=[];
 w.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={};}async resume(){}createOscillator(){const tone={type:'',frequency:{value:0},connect(){},disconnect(){},start(time){this.startAt=time;},stop(time){this.stopAt=time;this.stopped=true;}};tones.push(tone);return tone;}createGain(){const events=[];const gain={events,gain:{setValueAtTime(value,time){events.push(['set',value,time]);},linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);},exponentialRampToValueAtTime(value,time){events.push(['decay',value,time]);},cancelScheduledValues(time){events.push(['cancel',time]);}},connect(){},disconnect(){}};gains.push(gain);return gain;}};
 await w.toggleOrderSound();assert.equal(tones.length,6);assert(tones.every(t=>t.type==='triangle'));assert(gains.every(g=>g.events.some(e=>e[0]==='ramp'&&e[1]>.25&&e[1]<1)));
 assert(tones.every((t,i)=>i===0||t.startAt>=tones[i-1].stopAt));
 w.playOrderChime(true);assert.equal(tones.length,6); // Consecutive orders cannot double the amplitude.
 await w.toggleOrderSound();assert(gains.every(g=>g.events.at(-1)[0]==='set'&&g.events.at(-1)[1]===0));assert(tones.every(t=>t.stopAt===undefined));

 w.demoBurstOrders();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,4);
 w.document.querySelector('[data-inbox-order]').click();await tick();assert(w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 w.closeOrderModal();w.demoConnection();await tick();assert(w.document.getElementById('adminLiveStatus').textContent.includes('Reconectando'));
 w.demoConnection();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,4);
 await w.demoRole('staff');await tick();assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,1);assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 assert(!w.document.getElementById('section-orders').classList.contains('hidden'));
 await w.updateOrderStatus(w.PasteHotDemo.tables.orders[0].id,'confirmado');await tick();assert.equal(alerts.filter(s=>s.includes('WhatsApp')).length,0);
 await w.demoRole('owner');await tick();assert.equal(w.document.querySelectorAll('.product-group').length,4);
 const managerSession=w.PasteHotDemo.state.sessions.find(s=>s.role==='manager');
 const authorize=[...w.document.querySelectorAll('#accessSessions button')].find(b=>b.textContent==='Autorizar');assert(authorize&&!authorize.disabled);await w.changeAdminSession(managerSession.session_id,'approved');await tick();await tick();
 assert.equal(managerSession.status,'approved');assert.equal(w.document.querySelectorAll('.presence-dot').length,3);
 await w.demoRole('manager');await tick();assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,2);
 assert(w.document.getElementById('categoryAdminCard').classList.contains('hidden'));assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 w.showTab('products');assert(w.document.getElementById('section-products').classList.contains('active'));assert.equal(w.document.querySelectorAll('[onclick^="deleteProduct"]').length,0);
 w.showTab('access');assert(w.document.getElementById('section-products').classList.contains('active'));
 w.editProduct(w.PasteHotDemo.tables.products[0].id);assert(w.document.getElementById('productModal').classList.contains('show'));w.document.getElementById('productPrice').value='29';await w.saveProduct();assert.equal(w.PasteHotDemo.tables.products[0].price,29);w.closeProductModal();
 await w.toggleProduct(w.PasteHotDemo.tables.products[0].id,false);assert.equal(w.PasteHotDemo.tables.products[0].available,false);
 await w.deleteProduct(w.PasteHotDemo.tables.products[0].id);assert.equal(w.PasteHotDemo.tables.products.length,5);
 await w.demoRole('owner');await tick();
 w.document.getElementById('staffInviteRole').value='manager';w.document.getElementById('staffInviteName').value='Nueva encargada';w.document.getElementById('staffInviteEmail').value='nueva@example.invalid';await w.inviteAdminStaff({preventDefault(){}});assert.equal(w.PasteHotDemo.state.members.at(-1).role,'manager');
 await w.changeAdminMemberRole(w.PasteHotDemo.state.members.find(m=>m.role==='manager').user_id,'staff');assert.equal(managerSession.status,'revoked');

 assert.equal(w.PasteHotDemo.state.role,'owner');
 w.openOrderModal(w.PasteHotDemo.tables.orders[0].id);assert(w.document.getElementById('orderModal').classList.contains('show'));w.denyAdminAccess('Revocado');assert(!w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.getElementById('orderDetail').textContent,'');assert.equal(w.document.getElementById('adminSoundButton').textContent,'Activar sonido');
 w.stopAdminEnhancements();dom.window.close();
 // Query flags can never bypass authorization on the public domain.
 const live=new JSDOM('<html></html>',{url:'https://www.pastehot.com/admin.html?demo=1',runScripts:'outside-only'});
 live.window.eval(fs.readFileSync(root+'/admin-preview-demo.js','utf8'));assert.equal(live.window.PasteHotDemo,undefined);live.window.close();
 console.log('PASS: complete admin DOM boot, grouped products, connection dots, stronger nonoverlapping chime and immediate mute, consecutive alerts, opening order, offline recovery, owner, manager and staff interfaces, manager product editing, role-change reapproval, no demo WhatsApp, production demo disabled.');
})().catch(e=>{console.error(e);process.exitCode=1;process.exit();});
