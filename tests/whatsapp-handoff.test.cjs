const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.join(__dirname,'..'),tick=()=>new Promise(r=>setTimeout(r,20));
async function createMenu(url='https://pastehot.test/'){
 const html=fs.readFileSync(root+'/index.html','utf8'),product={id:'paste-1',name:'Paste de prueba',category:'Pastes salados',price:25,available:true,track_stock:false,stock:0,sort_order:0};
 const days=['sun','mon','tue','wed','thu','fri','sat'],schedule=Object.fromEntries(days.map(day=>[day,{enabled:true,open:'00:00',close:'00:00'}]));
 const settings={whatsapp:'529902317606',business_name:'PasteHot',weekly_schedule:JSON.stringify(schedule),store_manual_closed:'false',rain_surcharge_enabled:'false'};
 const rows=Object.entries(settings).map(([key,value])=>({key,value}));let rpcCalls=[];
 const db={from(table){const q={select(){return q},order(){return q},then(resolve,reject){return Promise.resolve({data:table==='products'?[product]:rows,error:null}).then(resolve,reject)}};return q;},async rpc(name,args){rpcCalls.push({name,args});return {data:{order_code:args.p_order_code,order_status:'pendiente_confirmacion',items:[{product_id:product.id,name:product.name,price:25,quantity:1,subtotal:25}],subtotal:25,total:25,delivery_fee:0},error:null};},channel(){const channel={on(){return channel},subscribe(){return channel}};return channel;},removeChannel(){}};
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;w.supabase={createClient:()=>db};w.alert=()=>{};w.setInterval=()=>1;w.clearInterval=()=>{};
 const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];w.eval(inline);
 await tick();await tick();
 if(!w.location.hostname.startsWith('deploy-preview-'))w.openWhatsAppOrder=url=>{w.__whatsappUrl=url};
 w.document.querySelector('input[name="deliveryType"][value="pickup"]').checked=true;w.updateDeliveryUI();
 w.document.getElementById('customerName').value='Cliente de prueba';w.document.getElementById('customerPhone').value='9991234567';w.addToCart(product.id);
 return {w,dom,rpcCalls};
}
(async()=>{
 const {w,dom,rpcCalls}=await createMenu();
 assert.equal(w.document.getElementById('whatsappHandoffActions'),null,'the customer must not see a return-to-menu confirmation step');
 assert.equal(w.document.getElementById('whatsappSentButton'),null,'the “Ya envié el mensaje” button is removed');
 await w.sendOrder();
 assert.equal(rpcCalls.length,1,'clicking the WhatsApp order button creates one pending order for the owner to review');
 assert.equal(rpcCalls[0].name,'create_pending_order_with_location_v3');
 assert.equal(rpcCalls[0].args.p_customer_name,'Cliente de prueba');
 assert(w.__whatsappUrl.startsWith('https://wa.me/'),'the customer is sent directly to WhatsApp after the order is registered');
 const message=new URL(w.__whatsappUrl).searchParams.get('text');
 assert(message.includes('Solicitud pendiente'));
 assert(message.includes('PasteHot verificará que haya recibido este mensaje'));
 assert(w.document.getElementById('orderStatusMessage').textContent.includes('pendiente de revisión'));
 w.stopStoreClock?.();dom.window.close();

 const preview=await createMenu('https://deploy-preview-8--cheerful-daifuku-76579b.netlify.app/');
 assert.equal(preview.w.document.getElementById('whatsappSentButton'),null);
 await preview.w.sendOrder();
 assert.equal(preview.rpcCalls.length,0,'preview must not create real orders');
 assert.equal(preview.w.__whatsappUrl,undefined,'preview must not open WhatsApp');
 assert(preview.w.document.getElementById('orderStatusMessage').textContent.includes('No se guardan pedidos reales'));
 preview.dom.window.close();
 console.log('PASS: the client has no post-WhatsApp confirmation; the button creates one pending order and opens WhatsApp; preview creates no real order.');
})().catch(error=>{console.error(error);process.exitCode=1;});
