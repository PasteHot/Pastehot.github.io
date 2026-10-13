const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),root=path.join(__dirname,'..');
const tick=()=>new Promise(resolve=>setTimeout(resolve,70));
(async()=>{
 const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://deploy-preview-99--cheerful-daifuku-76579b.netlify.app/admin.html?demo=1',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.alert=()=>{};w.confirm=()=>true;w.TextEncoder=TextEncoder;
 const scripts=['receipt.js','admin-orders.js','admin-preview-demo.js','admin-access.js','admin-store-control.js','admin-reports.js','admin-image-maintenance.js','admin-live-sync.js','admin-multistore.js','admin-pos.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8'));
 const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(match=>!match[1].includes('src=')&&match[2].includes('SUPABASE_URL'))[2];
 w.eval(scripts.join('\n')+'\n'+inline);await tick();

 await w.PasteHotDemo.client.rpc('pastehot_set_store_closed',{p_closed:true,p_reason:'Limpieza de prueba',p_expected_closed:false,p_public_reason:null});
 await w.loadStoreHistory();
 assert.equal(w.document.querySelectorAll('#storeHistoryRows [data-delete-store-event]').length,1,'primary owner sees checkboxes for store history');
 const eventBox=w.document.querySelector('#storeHistoryRows [data-delete-store-event]');eventBox.checked=true;eventBox.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(w.document.getElementById('deleteStoreHistorySelection').disabled,false);
 w.document.getElementById('deleteStoreHistorySelection').click();await tick();
 assert.equal(w.PasteHotDemo.state.storeEvents.length,0,'selected store history record is removed in preview data');
 assert.match(w.document.getElementById('storeHistoryDeleteMessage').textContent,/Se borraron 1 movimiento/);

 w.document.getElementById('posReportPeriod').value='all';await w.loadPosSalesSummary();
 const withSale='00000000-0000-4000-8000-000000000410',empty='00000000-0000-4000-8000-000000000412';
 assert.equal(w.document.querySelectorAll('#posSalesSummary [data-shift-delete]').length,2,'owner sees deletable closed-shift rows');
 const emptyBox=w.document.querySelector(`#posSalesSummary [data-shift-delete="${empty}"]`);emptyBox.checked=true;emptyBox.dispatchEvent(new w.Event('change',{bubbles:true}));
 w.document.getElementById('deleteSelectedShifts').click();await tick();
 assert(!w.PasteHotDemo.state.posShifts.some(shift=>shift.id===empty),'closed shift without sales can be deleted');
 assert.match(w.document.getElementById('shiftDeleteMessage').textContent,/Se borraron 1 turno/);

 const linkedBox=w.document.querySelector(`#posSalesSummary [data-shift-delete="${withSale}"]`);linkedBox.checked=true;linkedBox.dispatchEvent(new w.Event('change',{bubbles:true}));
 w.document.getElementById('deleteSelectedShifts').click();await tick();
 assert(w.PasteHotDemo.state.posShifts.some(shift=>shift.id===withSale),'a shift with linked sales remains');
 assert.match(w.document.getElementById('shiftDeleteMessage').textContent,/primero elimina sus ventas vinculadas/);

 await w.demoRole('delegated');await tick();
 assert(w.document.getElementById('storeHistoryDeleteToolbar').classList.contains('hidden'),'delegated owner cannot see store-history deletion controls');
 await w.loadPosSalesSummary();
 assert.equal(w.document.querySelectorAll('#posSalesSummary [data-shift-delete]').length,0,'delegated owner cannot see shift deletion checkboxes');
 const denied=await w.PasteHotDemo.client.rpc('pastehot_delete_cash_shifts',{p_shift_ids:[withSale]});
 assert.equal(denied.error.message,'NO_AUTORIZADO','preview backend rejects delegated-owner shift deletion');
 dom.window.close();
 console.log('PASS: primary-owner-only history deletion, closed empty-shift deletion, linked-sale protection, and delegated-owner denial.');
})().catch(error=>{console.error(error);process.exit(1);});
