const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.join(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const html=fs.readFileSync(root+'/admin.html','utf8');
 for(const file of ['admin-reports.js','admin-image-maintenance.js','admin-live-sync.js'])assert.equal((html.match(new RegExp('src="'+file.replaceAll('.','\\.')+'\\?','g'))||[]).length,1);
 const dom=new JSDOM(html,{url:'https://deploy-preview-6--cheerful-daifuku-76579b.netlify.app/admin.html?demo=1',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.alert=()=>{};w.confirm=()=>true;
 const files=['receipt.js','admin-orders.js','admin-preview-demo.js','admin-access.js','admin-store-control.js','admin-reports.js','admin-image-maintenance.js','admin-live-sync.js'];
 const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];
 w.eval(files.map(f=>fs.readFileSync(root+'/'+f,'utf8')).join('\n')+'\n'+inline);await sleep(300);
 const client=w.PasteHotDemo.client,tables=w.PasteHotDemo.tables,setting=key=>tables.settings.find(s=>s.key===key);
 w.showTab('business');await sleep(260);assert.equal(w.document.getElementById('business_name').value,'PasteHot');
 const initialFrom=client.from;let loads=0;client.from=table=>{const q=initialFrom.call(client,table),select=q.select.bind(q),inside=q.in.bind(q);q.select=(...args)=>{select(...args);return q;};q.in=(key,values)=>{if(table==='settings'&&key==='key'&&values.includes('business_name'))loads++;return inside(key,values);};return q;};
 for(let i=0;i<15;i++)await client.from('settings').update({value:'Cambio '+i}).eq('key','business_name');
 await sleep(350);assert.equal(loads,1);assert.equal(w.document.getElementById('business_name').value,'Cambio 14');
 const input=w.document.getElementById('business_name');input.value='Mi borrador';
 await client.from('settings').update({value:'Cambio remoto'}).eq('key','business_name');await sleep(300);
 assert.equal(input.value,'Mi borrador');assert(w.document.getElementById('live-note-business'));assert(w.adminFormIsDirty('business'));
 w.confirm=()=>false;w.document.querySelector('#live-note-business button').click();await sleep(250);assert.equal(input.value,'Mi borrador');
 w.confirm=()=>true;w.document.querySelector('#live-note-business button').click();await sleep(300);assert.equal(input.value,'Cambio remoto');assert(!w.document.getElementById('live-note-business'));
 // A partial save never erases an unsaved field in the other business card.
 w.document.getElementById('bank_name').value='Banco sin guardar';input.value='Nombre guardado';await w.saveBusinessSettings();await sleep(350);
 assert.equal(input.value,'Nombre guardado');assert.equal(w.document.getElementById('bank_name').value,'Banco sin guardar');assert(w.adminFormIsDirty('business'));
 await w.savePaymentSettings();await sleep(300);assert(!w.adminFormIsDirty('business'));assert(!w.document.getElementById('live-note-business'));
 // If typing starts while a database read is pending, its result cannot overwrite it.
 const from=client.from;let release,blocked=false;client.from=table=>{const q=from.call(client,table);if(table==='settings'&&!blocked){blocked=true;const then=q.then.bind(q);q.then=(resolve,reject)=>new Promise(r=>release=r).then(()=>then(resolve,reject));}return q;};
 const request=w.loadBusinessSettings();await sleep(20);input.value='Escribiendo durante la lectura';release();await request;assert.equal(input.value,'Escribiendo durante la lectura');client.from=from;
 w.document.querySelector('#live-note-business button').click();await sleep(300);
 // Hidden form data loads on opening its section; reconnect restores missed changes.
 w.showTab('products');await sleep(250);await client.from('settings').update({value:'Pendiente en segundo plano'}).eq('key','business_name');await sleep(250);
 w.showTab('business');await sleep(250);assert.equal(input.value,'Pendiente en segundo plano');
 w.demoConnection();setting('business_name').value='Cambio sin conexión';w.demoConnection();await sleep(400);assert.equal(input.value,'Cambio sin conexión');
 await w.demoRole('manager');w.showTab('products');await sleep(250);await client.from('products').update({available:false}).eq('id',tables.products[0].id);await sleep(300);assert(w.document.getElementById('productsList').textContent.includes('Agotado'));
 await w.demoRole('staff');await sleep(250);const before=loads;await client.from('settings').update({value:'No debe cargarlo el empleado'}).eq('key','business_name');await sleep(300);assert.equal(loads,before);assert(!w.document.getElementById('section-business').classList.contains('active'));
 w.demoNewOrder();await sleep(450);assert(w.document.getElementById('ordersTable').textContent.includes('PRUEBA-'+String(w.PasteHotDemo.state.counter-1).padStart(3,'0')));
 w.stopAdminEnhancements();dom.window.close();console.log('PASS: event coalescing; live settings and products; protected drafts, partial saves and in-flight edits; hidden-view refresh; reconnect recovery; role-scoped updates; no duplicate script execution.');
})().catch(e=>{console.error(e);process.exit(1);});
