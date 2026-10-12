/* Local fixtures only: this adapter is unavailable on the production hostname. */
(function(){
  const preview=/^(deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app|localhost|127\.0\.0\.1)$/.test(location.hostname);
  if(!preview||new URLSearchParams(location.search).get('demo')!=='1')return;
  const primaryStore='44444444-4444-4444-8444-444444444444',northStore='55555555-5555-4555-8555-555555555555';
  const owner='a0c0b64b-7809-4428-ad00-a1484d6ded53',staff='11111111-1111-4111-8111-111111111111',manager='33333333-3333-4333-8333-333333333333';
  const currentUser=()=>state.role==='owner'?(state.delegated?state.members.find(m=>m.role==='owner'&&!m.primary_owner)?.user_id:owner):({staff,manager}[state.role]);
  const now=Date.now(),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const settings={categories:JSON.stringify(['Pastes salados','Pastes dulces','Pastes de temporada','Bebidas']),store_manual_closed:'false',store_manual_close_reason:'En unos instantes volveremos a recibir pedidos.',business_name:'PasteHot',whatsapp:'529902317606',background_color:'#f4f4f4',category_title_font:'Arial',category_title_size:'28',category_title_color:'#171717'};
  const state={role:'owner',delegated:false,offline:false,enforced:true,counter:4,passwords:{},storeEvents:[],storeEventCounter:1,posShifts:[],posCounter:1000,channels:[],members:[{user_id:owner,display_name:'Propietario principal',email:'propietario@example.invalid',role:'owner',primary_owner:true,enabled:true},{user_id:staff,display_name:'Empleado de prueba',email:'staff+empleado@accounts.pastehot.com',role:'staff',enabled:true},{user_id:manager,display_name:'Encargado de prueba',email:'staff+encargado@accounts.pastehot.com',role:'manager',enabled:true}],sessions:[{session_id:uuid(90),user_id:owner,label:'Mi teléfono',display_name:'Propietario',role:'owner',status:'approved',online:true,current:true},{session_id:uuid(91),user_id:staff,label:'Tablet del negocio',display_name:'Empleado de prueba',role:'staff',status:'approved',online:true,current:false},{session_id:uuid(92),user_id:manager,label:'Computadora del encargado',display_name:'Encargado de prueba',role:'manager',status:'pending',online:false,current:false}]};
  const tables={products:[['Paste de papa','Pastes salados',25],['Paste de carne','Pastes salados',30],['Paste de piña','Pastes dulces',25],['Paste de calabaza','Pastes de temporada',30],['Agua de jamaica','Bebidas',20]].map(([name,category,price],i)=>({id:uuid(i+1),store_id:primaryStore,name,category,price,image_url:'favicon.png',description:'Producto ficticio para probar el administrador.',available:true,track_stock:true,stock:20,low_stock_threshold:3,sort_order:i,created_at:new Date(now).toISOString()})),orders:[],delivery_zones:[],settings:Object.entries(settings).map(([key,value],i)=>({id:uuid(100+i),key,value}))};
  function fakeOrder(n){return {id:uuid(200+n),store_id:primaryStore,order_code:'PRUEBA-'+String(n).padStart(3,'0'),customer_name:'Cliente de prueba '+n,customer_phone:'9990000000',delivery_type:'pickup',payment_method:'cash',order_status:'pendiente_confirmacion',created_at:new Date(now+n*1000).toISOString(),items:[{product_id:uuid(1),name:'Paste de papa',quantity:2,price:25,subtotal:50}],subtotal:50,total:50,delivery_fee:0,notes:'Pedido ficticio: no preparar ni cobrar.',inventory_applied:false,inventory_restored:false};}
  tables.orders=[fakeOrder(1),{...fakeOrder(2),order_status:'entregado'},{...fakeOrder(3),order_status:'cancelado'},...[ [4,'Ana de prueba','9991111001','Francisco de Montejo','cash'],[5,'Ana de prueba','9991111001','Francisco de Montejo','transfer'],[6,'Luis de prueba','9991111002','Chuburná','cash'],[7,'Luis de prueba','9991111002','Chuburná','cash'],[8,'Marta de prueba','9991111003','Las Américas','transfer'],[9,'Marta de prueba','9991111003','Las Américas','cash'] ].map(([n,name,phone,zone,payment])=>({...fakeOrder(n),order_code:'PRUEBA-'+String(n).padStart(3,'0'),customer_name:name,customer_phone:phone,delivery_type:'delivery',delivery_zone_id:'zone-'+zone.toLowerCase().replaceAll(' ','-'),delivery_zone_name:zone,payment_method:payment,subtotal:50,delivery_fee:20,total:70,order_status:'entregado',items:[{product_id:uuid(1),name:'Paste de papa',category:'Pastes salados',quantity:2,price:25,subtotal:50}]}))];tables.delivery_zones=['Francisco de Montejo','Chuburná','Las Américas'].map((name,i)=>({id:'zone-'+i,name,enabled:true,fee:20}));
  function emit(table,row,type='INSERT'){if(state.offline)return;for(const c of state.channels)for(const h of c.handlers)if(h.kind==='postgres_changes'&&h.filter.table===table)h.fn({eventType:type,new:row,old:{id:row.id}});}
  function access(){const member=state.members.find(m=>m.user_id===currentUser()),session=state.sessions.find(s=>s.user_id===currentUser());const enabled=!!member?.enabled;if(enabled&&session)session.status='approved';return {primary_owner:!!member?.primary_owner,direct_access:true,allowed:!!enabled,role:state.role,status:enabled?session?.status:'disabled',enforced:state.enforced,members:state.role==='owner'?state.members.map(m=>({...m,current:m.user_id===currentUser()})):state.role==='manager'?state.members.filter(m=>m.role==='staff'&&m.user_id!==currentUser()).map(m=>({...m,current:false})):[],sessions:state.sessions.filter(s=>state.role==='owner'||s.status==='approved').map(s=>({...s,primary_owner:s.user_id===owner,member_enabled:state.members.find(m=>m.user_id===s.user_id)?.enabled!==false,current:s.user_id===currentUser()}))};}

  function storeState(){const closed=tables.settings.find(s=>s.key==='store_manual_closed')?.value==='true';const now=new Date(),parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Merida',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(now),day=parts.find(p=>p.type==='weekday')?.value,hour=Number(parts.find(p=>p.type==='hour')?.value);const scheduled=day!=='Sun'&&hour>=12&&hour<21;return {manual_closed:closed,scheduled_open:scheduled,open:!closed&&scheduled,history_allowed:['owner','manager'].includes(state.role),last_event_id:state.storeEventCounter-1};}
  function demoStoreRpc(name,args){
    if(!access().allowed)return {data:null,error:{message:'NO_AUTORIZADO'}};
    if(name==='pastehot_store_state')return {data:storeState(),error:null};
    if(name==='pastehot_store_history'){
      if(!['owner','manager'].includes(state.role))return {data:null,error:{message:'NO_AUTORIZADO'}};
      const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Merida',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
      const rows=state.storeEvents.filter(e=>(!args.p_day||day(e.created_at)===args.p_day)&&(!args.p_only_during_hours||e.during_hours)).slice().reverse(),offset=args.p_offset||0;
      return {data:{events:rows.slice(offset,offset+50),has_more:rows.length>offset+50},error:null};
    }
    const previous=storeState();
    if(previous.manual_closed!==args.p_expected_closed)return {data:null,error:{message:'ESTADO_CAMBIO: otra persona modificó la tienda. Actualiza antes de continuar.'}};
    if(previous.manual_closed===args.p_closed){
      if(state.role==='owner'&&args.p_public_reason!=null){let row=tables.settings.find(s=>s.key==='store_manual_close_reason');const value=String(args.p_public_reason).trim();if(row)row.value=value;else{row={id:uuid(900+state.storeEventCounter),key:'store_manual_close_reason',value};tables.settings.push(row);}emit('settings',row,'UPDATE');}
      return {data:{...previous,changed:false},error:null};
    }
    if(!args.p_reason||args.p_reason.trim().length<5||args.p_reason.trim().length>240)return {data:null,error:{message:'MOTIVO_REQUERIDO'}};
    const nameOfUser=state.role==='owner'&&!state.delegated?'Propietario':state.members.find(m=>m.user_id===currentUser()).display_name,session=state.sessions.find(s=>s.user_id===currentUser());
    state.storeEvents.push({id:state.storeEventCounter++,created_at:new Date().toISOString(),closed:args.p_closed,actor_id:currentUser(),actor_name:nameOfUser,actor_role:state.role,session_label:session?.label||'Mi navegador',reason:args.p_reason.trim(),during_hours:previous.scheduled_open});
    const savedReason=tables.settings.find(s=>s.key==='store_manual_close_reason')?.value||'';
    const publicReason=state.role==='owner'&&args.p_public_reason!=null?String(args.p_public_reason).trim():(args.p_closed?(savedReason||'En unos instantes volveremos a recibir pedidos.'):savedReason);
    for(const [key,value] of [['store_manual_closed',String(args.p_closed)],['store_manual_close_reason',publicReason]]){
      let row=tables.settings.find(s=>s.key===key);if(row)row.value=value;else{row={id:uuid(900+state.storeEventCounter),key,value};tables.settings.push(row);}emit('settings',row,'UPDATE');
    }
    return {data:{...storeState(),changed:true},error:null};
  }

  function demoReportRpc(name,a){
    if(!access().allowed)return {data:null,error:{message:'NO_AUTORIZADO'}};
    if(name==='pastehot_order_page'){
      const q=String(a.p_search||'').toLowerCase().replace(/[\s-]/g,'');
      const rows=tables.orders.filter(o=>(!a.p_store_id||o.store_id===a.p_store_id)&&(state.role==='owner'||Date.parse(o.created_at)>Date.now()-48*3600000)&&(!a.p_from||o.created_at>=a.p_from)&&(!q||[o.order_code,o.id].some(v=>String(v||'').toLowerCase().replace(/[\s-]/g,'').includes(q)))&&(!a.p_before_time||o.created_at<a.p_before_time||(o.created_at===a.p_before_time&&o.id<a.p_before_id))).sort((x,y)=>y.created_at.localeCompare(x.created_at)||y.id.localeCompare(x.id));return {data:{rows:rows.slice(0,50).map(o=>({...o})),has_more:rows.length>50},error:null};
    }
    if(state.role!=='owner')return {data:null,error:{message:'NO_AUTORIZADO'}};
    const all=tables.orders.filter(o=>(!a.p_store_id||o.store_id===a.p_store_id)&&!['cancelado','pendiente_confirmacion'].includes(o.order_status)&&o.created_at<a.p_to),selected=all.filter(o=>!a.p_from||o.created_at>=a.p_from);
    const totals=new Map(),daily=new Map(),customers=new Map(),history=new Map(),isPaste=c=>!/bebida|refresco|agua|café|cafe|jugo/i.test(c||'');
    tables.products.filter(p=>isPaste(p.category)).forEach(p=>totals.set(p.id,{key:p.id,name:p.name,quantity:0,amount:0}));
    const digits=v=>String(v||'').replace(/\D/g,'');all.forEach(o=>{const phone=digits(o.customer_phone);if(!history.has(phone)||o.created_at<history.get(phone))history.set(phone,o.created_at);});
    selected.forEach(o=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Merida',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(o.created_at));daily.set(day,(daily.get(day)||0)+Number(o.total||0));
      for(const i of Array.isArray(o.items)?o.items:[]){const p=tables.products.find(p=>p.id===(i.product_id||i.id)||(!i.product_id&&!i.id&&p.name===i.name));if(!isPaste(p?.category||i.category))continue;const key=p?.id||i.product_id||i.id||i.name;if(!totals.has(key))totals.set(key,{key,name:p?.name||i.name,quantity:0,amount:0});const t=totals.get(key);t.quantity+=Number(i.quantity)||0;t.amount+=Number(i.subtotal??Number(i.quantity)*Number(i.price))||0;}
      const phone=digits(o.customer_phone);if(!phone)return;if(!customers.has(phone))customers.set(phone,{phone,name:o.customer_name,count:0,total:0,first:o.created_at,last:o.created_at,recurrent:false});const c=customers.get(phone);c.count++;c.total+=Number(o.total||0);if(o.created_at<c.first)c.first=o.created_at;if(o.created_at>c.last){c.last=o.created_at;c.name=o.customer_name;}c.recurrent=c.count>1||!!(a.p_from&&history.get(phone)<a.p_from);
    });
    const customerRows=[...customers.values()].sort((x,y)=>y.last.localeCompare(x.last)||x.phone.localeCompare(y.phone));
    const paymentMap=new Map(),zoneMap=new Map();selected.forEach(o=>{const key=String(o.payment_method||'sin especificar').toLowerCase(),p=paymentMap.get(key)||{key,name:key==='cash'?'Efectivo':key==='transfer'?'Transferencia':key,orders:0,total:0};p.orders++;p.total+=Number(o.total||0);paymentMap.set(key,p);if(o.delivery_type==='delivery'){const name=o.delivery_zone_name||'Sin zona asignada',z=zoneMap.get(name)||{name,orders:0,paste_quantity:0,total:0};z.orders++;z.total+=Number(o.total||0);z.paste_quantity+=(Array.isArray(o.items)?o.items:[]).filter(i=>isPaste(i.category)).reduce((n,i)=>n+Number(i.quantity||0),0);zoneMap.set(name,z);}});const topCustomers=[...customers.values()].filter(c=>c.recurrent).sort((x,y)=>y.count-x.count||y.total-x.total).slice(0,3);return {data:{generated_at:new Date().toISOString(),from:a.p_from||all.map(o=>o.created_at).sort()[0]||null,to:a.p_to,orders:selected.length,total:selected.reduce((n,o)=>n+Number(o.total||0),0),subtotal:selected.reduce((n,o)=>n+Number(o.subtotal||0),0),average_ticket:selected.length?selected.reduce((n,o)=>n+Number(o.total||0),0)/selected.length:0,payment_methods:[...paymentMap.values()],zones:[...zoneMap.values()].sort((x,y)=>y.paste_quantity-x.paste_quantity||y.orders-x.orders),top_customers:topCustomers,pastes:[...totals.values()].sort((x,y)=>y.quantity-x.quantity||x.name.localeCompare(y.name)),daily:[...daily].sort((x,y)=>x[0].localeCompare(y[0])).map(([day,amount])=>({day,amount})),customers:a.p_customers?customerRows.slice(a.p_customer_offset||0,(a.p_customer_offset||0)+51):[],customer_count:a.p_customers?customerRows.length:0,recurrent_count:a.p_customers?customerRows.filter(c=>c.recurrent).length:0,customer_total:a.p_customers?customerRows.reduce((n,c)=>n+c.total,0):0},error:null};
  }
  function demoPosRpc(name,a={}){
    if(!access().allowed)return {data:null,error:{message:'NO_AUTORIZADO'}};
    const store=a.p_store_id||primaryStore,actor=state.members.find(m=>m.user_id===currentUser())?.display_name||'Propietario';
    const active=()=>state.posShifts.find(s=>s.store_id===store&&!s.closed_at)||null;
    if(name==='pastehot_pos_current_shift')return {data:active(),error:null};
    if(name==='pastehot_pos_open_shift'){
      if(active())return {data:null,error:{message:'CAJA_YA_ABIERTA'}};
      const shift={id:uuid(state.posCounter++),store_id:store,opened_by:currentUser(),opened_by_name:actor,opening_cash:Number(a.p_opening_cash)||0,opened_at:new Date().toISOString(),closed_by:null,closed_by_name:null,closing_cash:null,expected_cash:null,cash_difference:null,closed_at:null};
      state.posShifts.unshift(shift);return {data:{...shift},error:null};
    }
    if(name==='pastehot_pos_create_sale'){
      const shift=active();if(!shift||shift.id!==a.p_shift_id)return {data:null,error:{message:'CAJA_CERRADA'}};
      if(!['cash','transfer','card'].includes(a.p_payment_method))return {data:null,error:{message:'METODO_DE_PAGO_INVALIDO'}};
      const requested=new Map();for(const item of a.p_items||[])requested.set(item.product_id,(requested.get(item.product_id)||0)+Number(item.quantity));
      if(!requested.size||[...requested.values()].some(q=>!Number.isInteger(q)||q<1))return {data:null,error:{message:'CANTIDAD_INVALIDA'}};
      const saleItems=[];let total=0;
      for(const [id,qty] of requested){const product=tables.products.find(p=>p.id===id&&p.store_id===store);if(!product)return {data:null,error:{message:'PRODUCTO_NO_ENCONTRADO'}};if(!product.available)return {data:null,error:{message:'PRODUCTO_NO_DISPONIBLE'}};if(product.track_stock&&product.stock<qty)return {data:null,error:{message:`STOCK_INSUFICIENTE|${product.name}|${product.stock}`}};const subtotal=Number(product.price)*qty;total+=subtotal;saleItems.push({product_id:id,name:product.name,category:product.category,price:product.price,quantity:qty,subtotal,stock_tracked:product.track_stock});}
      if(a.p_payment_method==='cash'&&(a.p_cash_received==null||Number(a.p_cash_received)<total))return {data:null,error:{message:'EFECTIVO_INSUFICIENTE'}};
      for(const item of saleItems){const p=tables.products.find(p=>p.id===item.product_id&&p.store_id===store);if(p.track_stock){p.stock-=item.quantity;emit('products',p,'UPDATE');}}
      const n=state.posCounter++,sale={id:uuid(n),store_id:store,order_code:'PV-DEMO-'+String(n).padStart(4,'0'),customer_name:'Venta en punto de venta',customer_phone:'',delivery_type:'point_of_sale',payment_method:a.p_payment_method,payment_status:'paid',order_status:'entregado',created_at:new Date().toISOString(),items:saleItems,subtotal:total,total,delivery_fee:0,inventory_applied:true,inventory_restored:false,sale_channel:'point_of_sale',cashier_id:currentUser(),cashier_name:actor,register_shift_id:shift.id,cash_received:a.p_payment_method==='cash'?Number(a.p_cash_received):null,cash_change:a.p_payment_method==='cash'?Number(a.p_cash_received)-total:0};
      tables.orders.unshift(sale);emit('orders',sale);return {data:{...sale},error:null};
    }
    if(name==='pastehot_pos_close_shift'){
      const shift=active();if(!shift||shift.id!==a.p_shift_id)return {data:null,error:{message:'CAJA_CERRADA'}};
      const sales=tables.orders.filter(o=>o.store_id===store&&o.register_shift_id===shift.id&&o.order_status!=='cancelado');const cash=sales.filter(o=>o.payment_method==='cash').reduce((sum,o)=>sum+Number(o.total||0),0);
      shift.expected_cash=Number(shift.opening_cash)+cash;shift.closing_cash=Number(a.p_closing_cash);shift.cash_difference=shift.closing_cash-shift.expected_cash;shift.closed_by=currentUser();shift.closed_by_name=actor;shift.closed_at=new Date().toISOString();return {data:{...shift},error:null};
    }
    if(name==='pastehot_pos_report'){
      const orders=tables.orders.filter(o=>o.store_id===store&&o.created_at<a.p_to&&(!a.p_from||o.created_at>=a.p_from)&&!['cancelado','pendiente_confirmacion'].includes(o.order_status));
      const group=(list,key,label)=>[...new Set(list.map(o=>o[key]))].map(v=>({[label]:v,orders:list.filter(o=>o[key]===v).length,total:list.filter(o=>o[key]===v).reduce((sum,o)=>sum+Number(o.total||0),0)}));
      const channels=[...new Set(orders.map(o=>o.sale_channel==='point_of_sale'?'Punto de venta':'Digital'))].map(channel=>{const rows=orders.filter(o=>(o.sale_channel==='point_of_sale'?'Punto de venta':'Digital')===channel);return {channel,orders:rows.length,total:rows.reduce((sum,o)=>sum+Number(o.total||0),0)}});
      const pos=orders.filter(o=>o.sale_channel==='point_of_sale'),payments=group(pos,'payment_method','method').map(x=>({...x,method:({cash:'Efectivo',transfer:'Transferencia',card:'Tarjeta'})[x.method]||x.method}));
      const shifts=state.posShifts.filter(s=>s.store_id===store&&s.opened_at<a.p_to&&(!a.p_from||s.opened_at>=a.p_from)).map(s=>{const sales=pos.filter(o=>o.register_shift_id===s.id);return {...s,sales_count:sales.length,sales_total:sales.reduce((sum,o)=>sum+Number(o.total||0),0),cash_sales:sales.filter(o=>o.payment_method==='cash').reduce((sum,o)=>sum+Number(o.total||0),0),transfer_sales:sales.filter(o=>o.payment_method==='transfer').reduce((sum,o)=>sum+Number(o.total||0),0),card_sales:sales.filter(o=>o.payment_method==='card').reduce((sum,o)=>sum+Number(o.total||0),0)}});
      return {data:{channels,payments,shifts},error:null};
    }
    return {data:null,error:null};
  }
  function from(table){
    let op='select',payload,filters=[],sort=[],range=null,single=false;
    const q={select(){return q},limit(n){range=[0,n-1];return q},lt(k,v){filters.push(r=>r[k]<v);return q},or(text){const m=text.match(/^created_at.lt.(.*),and\(created_at.eq.(.*),id.lt.(.*)\)$/);if(m)filters.push(r=>r.created_at<m[1]||(r.created_at===m[2]&&r.id<m[3]));return q},order(k,o){sort.push([k,o?.ascending!==false]);return q},range(a,b){range=[a,b];return q},eq(k,v){filters.push(r=>String(r[k])===String(v));return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},gte(k,v){filters.push(r=>r[k]>=v);return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(p){op='update';payload=p;return q},insert(p){op='insert';payload=p;return q},delete(){op='delete';return q},then(resolve,reject){
      return Promise.resolve().then(()=>{
        if(state.offline)return {data:null,error:{message:'Sin conexión de prueba'}};
        if(state.role!=='owner'&&op!=='select'&&!(state.role==='manager'&&table==='products'&&['insert','update'].includes(op)))return {data:null,error:{message:'NO_AUTORIZADO'}};
        let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));
        if(op==='update'){rows.forEach(r=>Object.assign(r,payload));rows.forEach(r=>emit(table,r,'UPDATE'));}
        if(op==='delete'){tables[table]=(tables[table]||[]).filter(r=>!rows.includes(r));rows.forEach(r=>emit(table,r,'DELETE'));}
        if(op==='insert'){rows=(Array.isArray(payload)?payload:[payload]).map(r=>({...r,id:r.id||uuid(1000+state.counter++)}));tables[table]=(tables[table]||[]).concat(rows);rows.forEach(r=>emit(table,r));}
        if(state.role!=='owner'&&table==='orders')rows=rows.filter(r=>Date.parse(r.created_at)>Date.now()-48*3600000);
        rows=[...rows];for(const [key,asc] of [...sort].reverse())rows.sort((a,b)=>(String(a[key]).localeCompare(String(b[key])))*(asc?1:-1));
        if(range)rows=rows.slice(range[0],range[1]+1);
        return {data:single?(rows[0]||null):rows.map(r=>({...r})),error:null};
      }).then(resolve,reject);
    }};return q;
  }
  const client={from,auth:{async getSession(){return {data:{session:{user:{id:currentUser()}}}}},async getUser(){return {data:{user:{id:currentUser(),email:'prueba@example.invalid'}}}},async signOut(){return {error:null}},async signInWithPassword(){return this.getSession()}},
    channel(){const c={handlers:[],on(kind,filter,fn){c.handlers.push({kind,filter,fn});return c},subscribe(fn){c.status=fn;state.channels.push(c);setTimeout(()=>fn(state.offline?'CHANNEL_ERROR':'SUBSCRIBED'),0);return c}};return c},removeChannel(c){state.channels=state.channels.filter(x=>x!==c);return Promise.resolve();},
    async rpc(name,args={}){
      if(state.offline)return {data:null,error:{message:'Sin conexión de prueba'}};
      if(['pastehot_store_state','pastehot_store_history','pastehot_set_store_closed'].includes(name))return demoStoreRpc(name,args);
      if(['pastehot_order_page','pastehot_sales_summary'].includes(name))return demoReportRpc(name,args);
      if(['pastehot_pos_current_shift','pastehot_pos_open_shift','pastehot_pos_close_shift','pastehot_pos_create_sale','pastehot_pos_report'].includes(name))return demoPosRpc(name,args);
      if(name==='pastehot_admin_state')return {data:access(),error:null};
      if(name==='pastehot_get_member_password'){if(state.role!=='owner'||state.delegated)return {data:null,error:{message:'NO_AUTORIZADO'}};const value=state.passwords[args.p_user_id];return value?{data:value,error:null}:{data:null,error:{message:'CONTRASENA_NO_DISPONIBLE'}};}
      if(name==='pastehot_manager_staff_accounts')return state.role==='manager'?{data:state.members.filter(m=>m.role==='staff'&&m.user_id!==currentUser()).map(m=>({...m,current:false})),error:null}:{data:null,error:{message:'NO_AUTORIZADO'}};
      if(name==='pastehot_manager_add_staff'){if(state.role!=='manager')return {data:null,error:{message:'NO_AUTORIZADO'}};const email=String(args.p_email||'').toLowerCase();if(state.members.some(m=>m.email===email))return {data:null,error:{message:'EL_ACCESO_YA_EXISTE'}};const member={user_id:uuid(700+state.counter++),display_name:args.p_name,email,role:'staff',enabled:true};state.members.push(member);return {data:member,error:null};}
      if(name==='pastehot_manager_set_staff_enabled'){if(state.role!=='manager')return {data:null,error:{message:'NO_AUTORIZADO'}};const m=state.members.find(m=>m.user_id===args.p_user_id&&m.role==='staff'&&m.user_id!==currentUser());if(!m)return {data:null,error:{message:'CUENTA_NO_MODIFICABLE'}};m.enabled=args.p_enabled;state.sessions.filter(s=>s.user_id===m.user_id).forEach(s=>s.status='revoked');return {data:null,error:null};}
      if(name==='pastehot_add_category'){
        if(!['owner','manager'].includes(state.role))return {data:null,error:{message:'NO_AUTORIZADO'}};
        const row=tables.settings.find(s=>s.key==='categories');let list=[];try{list=JSON.parse(row?.value||'[]')}catch{}
        const value=String(args.p_name||'').trim();if(!value||value.length>80||list.some(c=>String(c).toLowerCase()===value.toLowerCase()))return {data:null,error:{message:'Nombre de categoría no válido o repetido.'}};
        list.push(value);if(row)row.value=JSON.stringify(list);emit('settings',row);return {data:list,error:null};
      }
      if(state.role!=='owner'&&name!=='update_order_status_with_inventory_v2')return {data:null,error:{message:'NO_AUTORIZADO'}};
      if(name==='pastehot_rename_session'){const s=state.sessions.find(s=>s.session_id===args.p_session_id);if(!s||!args.p_label?.trim()||args.p_label.trim().length>60)return {data:null,error:{message:'NOMBRE_INVALIDO'}};s.label=args.p_label.trim();return {data:true,error:null};}
      if(name==='pastehot_remove_session'){const i=state.sessions.findIndex(s=>s.session_id===args.p_session_id);if(i<0||state.sessions[i].current||state.sessions[i].status!=='revoked')return {data:null,error:{message:'REVOCA_EL_ACCESO_PRIMERO'}};state.sessions.splice(i,1);return {data:true,error:null};}
      if(name==='pastehot_set_session'){const s=state.sessions.find(s=>s.session_id===args.p_session_id);if(s){s.status=args.p_status;s.online=args.p_status==='approved';}return {data:true,error:null};}
      if(['pastehot_set_staff_enabled','pastehot_set_staff_role'].includes(name)){const target=state.members.find(m=>m.user_id===args.p_user_id);if(!target||target.primary_owner||target.user_id===currentUser())return {data:null,error:{message:'CUENTA_PROTEGIDA'}};if(name==='pastehot_set_staff_role'&&args.p_role==='owner'&&state.members.some(m=>m.role==='owner'&&!m.primary_owner&&m.user_id!==target.user_id))return {data:null,error:{message:'Ya existe un segundo propietario.'}};}
      if(name==='pastehot_set_staff_enabled'){const m=state.members.find(m=>m.user_id===args.p_user_id);if(m)m.enabled=args.p_enabled;state.sessions.filter(s=>s.user_id===args.p_user_id).forEach(s=>s.status='revoked');return {data:true,error:null};}
      if(name==='pastehot_set_staff_role'){const m=state.members.find(m=>m.user_id===args.p_user_id);if(m&&m.role!==args.p_role){m.role=args.p_role;state.sessions.filter(s=>s.user_id===m.user_id).forEach(s=>{s.role=args.p_role;s.status='revoked';s.online=false;});}return {data:true,error:null};}
      if(name==='pastehot_activate_security'){state.enforced=true;return {data:true,error:null};}
      if(name==='update_order_status_with_inventory_v2'){const o=tables.orders.find(o=>o.id===args.p_order_id);if(o){o.order_status=args.p_new_status;emit('orders',o,'UPDATE');}return {data:o,error:null};}
      return {data:null,error:null};
    },functions:{async invoke(_name,{body}){if(!['owner','manager'].includes(state.role))return {data:null,error:{message:'NO_AUTORIZADO'}};if(body.action==='reset_password'){const m=state.members.find(m=>m.user_id===body.userId&&!m.primary_owner&&m.user_id!==currentUser()&&(state.role!=='manager'||m.role==='staff'));if(!m)return {data:null,error:{message:'Cuenta protegida.'}};state.passwords[m.user_id]=body.password;state.sessions.filter(s=>s.user_id===m.user_id).forEach(s=>{s.status='revoked';s.online=false;});return {data:{ok:true,delivery:'demo'},error:null};}if(body.action==='delete'){const m=state.members.find(m=>m.user_id===body.userId&&!m.primary_owner&&m.user_id!==currentUser()&&(state.role!=='manager'||m.role==='staff'));if(!m)return {data:null,error:{message:'Cuenta no disponible.'}};m.enabled=false;state.sessions.filter(s=>s.user_id===m.user_id).forEach(s=>{s.status='revoked';s.online=false;});state.members=state.members.filter(m=>m.user_id!==body.userId);state.sessions=state.sessions.filter(s=>s.user_id!==body.userId);state.storeEvents=state.storeEvents.filter(e=>e.actor_id!==body.userId);return {data:{ok:true,delivery:'demo'},error:null};}if(state.role==='manager'&&body.role!=='staff')return {data:null,error:{message:'El encargado solo puede crear cuentas de empleados.'}};if(body.role==='owner'&&state.members.some(m=>m.role==='owner'&&!m.primary_owner))return {data:null,error:{message:'Ya existe un segundo propietario.'}};const email=`staff+${body.username}@accounts.pastehot.com`;if(state.members.some(m=>m.email===email))return {data:null,error:{message:'El usuario ya existe.'}};const userId=uuid(700+state.counter++);state.members.push({user_id:userId,display_name:body.name,email,role:body.role||'staff',enabled:true});state.passwords[userId]=body.password;return {data:{ok:true,delivery:'demo'},error:null};}},storage:{from(){return {async list(){return {data:[],error:null}},async remove(){return {data:[],error:null}},async upload(){return {error:{message:'La prueba no sube fotos reales.'}}}}}}};
  window.PasteHotDemo={state,tables,client};window.supabase={createClient:()=>client};
  window.demoNewOrder=()=>{const o=fakeOrder(state.counter++);o.created_at=new Date().toISOString();tables.orders.unshift(o);emit('orders',o);};
  window.demoBurstOrders=()=>{for(let i=0;i<3;i++)window.demoNewOrder();};
  window.demoConnection=()=>{
    state.offline=!state.offline;state.channels.forEach(c=>c.status(state.offline?'CHANNEL_ERROR':'SUBSCRIBED'));
    if(state.offline){window.demoNewOrder();alert('Se simuló un pedido durante la desconexión. Toca de nuevo Simular desconexión para recuperar la conexión y comprobar la alerta.');}
  };
  window.demoRole=async(role)=>{state.delegated=role==='delegated';if(state.delegated&&!state.members.some(m=>m.role==='owner'&&!m.primary_owner))state.members.push({user_id:uuid(699),display_name:'Segundo propietario de prueba',email:'staff+propietario2@accounts.pastehot.com',role:'owner',primary_owner:false,enabled:true});if(role==='delegated')role='owner';state.role=role||({owner:'staff',staff:'manager',manager:'owner'}[state.role]);if(!['owner','staff','manager'].includes(state.role))return;orderInbox=null;orders=[];stopAdminEnhancements();await enterAdmin((await client.auth.getSession()).data.session);if(['owner','manager'].includes(state.role))showTab('access');};
})();
