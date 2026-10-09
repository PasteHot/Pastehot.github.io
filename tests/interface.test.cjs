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
 w.demoBurstOrders();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,4);
 w.document.querySelector('[data-inbox-order]').click();await tick();assert(w.document.getElementById('orderModal').classList.contains('show'));assert.equal(w.document.querySelectorAll('.alert-order').length,3);
 w.closeOrderModal();w.demoConnection();await tick();assert(w.document.getElementById('adminLiveStatus').textContent.includes('Reconectando'));
 w.demoConnection();await tick();await tick();assert.equal(w.document.querySelectorAll('.alert-order').length,4);
 await w.demoRole();await tick();assert.equal(w.document.querySelectorAll('.tabs .tab:not(.hidden)').length,1);assert(w.document.getElementById('ordersMetrics').classList.contains('hidden'));
 assert(!w.document.getElementById('section-orders').classList.contains('hidden'));
 await w.updateOrderStatus(w.PasteHotDemo.tables.orders[0].id,'confirmado');await tick();assert.equal(alerts.filter(s=>s.includes('WhatsApp')).length,0);
 await w.demoRole();await tick();assert.equal(w.document.querySelectorAll('.product-group').length,4);
 assert.equal(w.PasteHotDemo.state.role,'owner');
 w.stopAdminEnhancements();dom.window.close();
 // Query flags can never bypass authorization on the public domain.
 const live=new JSDOM('<html></html>',{url:'https://www.pastehot.com/admin.html?demo=1',runScripts:'outside-only'});
 live.window.eval(fs.readFileSync(root+'/admin-preview-demo.js','utf8'));assert.equal(live.window.PasteHotDemo,undefined);live.window.close();
 console.log('PASS: complete admin DOM boot, grouped products, connection dots, consecutive alerts, opening order, offline recovery, staff-only interface, no demo WhatsApp, production demo disabled.');
})().catch(e=>{console.error(e);process.exitCode=1;process.exit();});
