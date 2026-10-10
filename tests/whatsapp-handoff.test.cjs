const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.join(__dirname,'..'),tick=()=>new Promise(r=>setTimeout(r,20));
async function createMenu(){
 const html=fs.readFileSync(root+'/index.html','utf8'),product={id:'paste-1',name:'Paste de prueba',category:'Pastes salados',price:25,available:true,track_stock:false,stock:0,sort_order:0};
 const days=['sun','mon','tue','wed','thu','fri','sat'],schedule=Object.fromEntries(days.map(day=>[day,{enabled:true,open:'00:00',close:'23:59'}]));
 const settings={whatsapp:'529902317606',business_name:'PasteHot',weekly_schedule:JSON.stringify(schedule),store_manual_closed:'false',rain_surcharge_enabled:'false'};
 const rows=Object.entries(settings).map(([key,value])=>({key,value}));let rpcCalls=[];
 const db={from(table){const q={select(){return q},order(){return q},then(resolve,reject){return Promise.resolve({data:table==='products'?[product]:rows,error:null}).then(resolve,reject)}};return q;},async rpc(name,args){rpcCalls.push({name,args});return {data:{order_code:args.p_order_code,order_status:'pendiente_confirmacion',items:[{product_id:product.id,name:product.name,price:25,quantity:1,subtotal:25}],subtotal:25,total:25,delivery_fee:0},error:null};},channel(){const channel={on(){return channel},subscribe(){return channel}};return channel;},removeChannel(){}};
 const dom=new JSDOM(html,{url:'https://pastehot.test/',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;w.supabase={createClient:()=>db};w.alert=()=>{};w.setInterval=()=>1;w.clearInterval=()=>{};
 const helper=fs.readFileSync(root+'/order-handoff.js','utf8');w.eval(helper);
 const inline=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(m=>!m[1].includes('src=')&&m[2].includes('SUPABASE_URL'))[2];w.eval(inline);
 await tick();await tick();
 w.openWhatsAppOrder=url=>{w.__whatsappUrl=url};
 w.document.querySelector('input[name="deliveryType"][value="pickup"]').checked=true;w.updateDeliveryUI();
 w.document.getElementById('customerName').value='Cliente de prueba';w.document.getElementById('customerPhone').value='9991234567';w.addToCart(product.id);
 return {w,dom,rpcCalls};
}
(async()=>{
 const {w,dom,rpcCalls}=await createMenu();
 await w.sendOrder();
 assert.equal(rpcCalls.length,0,'opening WhatsApp must not create an order or trigger the admin realtime alert');
 assert(w.__whatsappUrl.startsWith('https://wa.me/'));
 assert(w.document.getElementById('whatsappHandoffActions').hidden===false);
 assert(w.document.getElementById('whatsappSentButton').textContent.includes('Ya envié'));
 await w.confirmWhatsAppOrderSent();
 assert.equal(rpcCalls.length,1,'the order is created only after explicit customer confirmation on return');
 assert.equal(rpcCalls[0].name,'create_pending_order_with_location_v3');
 assert(w.document.getElementById('whatsappHandoffActions').hidden);
 assert(w.document.getElementById('orderStatusMessage').textContent.includes('registrado como pendiente'));
 w.stopStoreClock?.();dom.window.close();

 const cancelled=await createMenu();await cancelled.w.sendOrder();cancelled.w.cancelWhatsAppOrder();
 assert.equal(cancelled.rpcCalls.length,0,'canceling without sending must not register or alert the store');
 assert(cancelled.w.document.getElementById('whatsappHandoffActions').hidden);
 cancelled.w.stopStoreClock?.();cancelled.dom.window.close();

 const expiryDom=new JSDOM('',{runScripts:'outside-only'}),expiryWindow=expiryDom.window,backing=new Map();expiryWindow.eval(fs.readFileSync(root+'/order-handoff.js','utf8'));let now=1000,created=0;
 const handoff=expiryWindow.PasteHotOrderHandoff.create({storage:{getItem:key=>backing.get(key)||null,setItem:(key,value)=>backing.set(key,value),removeItem:key=>backing.delete(key)},now:()=>now});
 assert(handoff.begin({orderCode:'PJ-TEST'},()=>{}));now+=expiryWindow.PasteHotOrderHandoff.MAX_AGE_MS+1;
 const expired=await handoff.confirm(async()=>{created++;return {ok:true}});
 assert.equal(expired.expired,true);assert.equal(created,0);assert.equal(handoff.current,null);expiryDom.window.close();
 console.log('PASS: WhatsApp handoff creates no order before return confirmation; cancellation leaves no order; successful confirmation registers once.');
})().catch(error=>{console.error(error);process.exitCode=1;});
