/* Local fixtures only: this adapter is unavailable on the production hostname. */
(function(){
  const preview=/^(deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app|localhost|127\.0\.0\.1)$/.test(location.hostname);
  if(!preview||new URLSearchParams(location.search).get('demo')!=='1')return;
  const owner='a0c0b64b-7809-4428-ad00-a1484d6ded53',staff='11111111-1111-4111-8111-111111111111',manager='33333333-3333-4333-8333-333333333333';
  const currentUser=()=>({owner,staff,manager}[state.role]);
  const now=Date.now(),uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const settings={categories:JSON.stringify(['Pastes salados','Pastes dulces','Pastes de temporada','Bebidas']),business_name:'PasteHot',whatsapp:'529902317606',background_color:'#f4f4f4',category_title_font:'Arial',category_title_size:'28',category_title_color:'#171717'};
  const state={role:'owner',offline:false,enforced:true,counter:4,channels:[],members:[{user_id:staff,display_name:'Empleado de prueba',email:'empleado@example.invalid',role:'staff',enabled:true},{user_id:manager,display_name:'Encargado de prueba',email:'encargado@example.invalid',role:'manager',enabled:true}],sessions:[{session_id:uuid(90),user_id:owner,label:'Mi teléfono',display_name:'Propietario',role:'owner',status:'approved',online:true,current:true},{session_id:uuid(91),user_id:staff,label:'Tablet del negocio',display_name:'Empleado de prueba',role:'staff',status:'approved',online:true,current:false},{session_id:uuid(92),user_id:manager,label:'Computadora del encargado',display_name:'Encargado de prueba',role:'manager',status:'pending',online:false,current:false}]};
  const tables={products:[['Paste de papa','Pastes salados',25],['Paste de carne','Pastes salados',30],['Paste de piña','Pastes dulces',25],['Paste de calabaza','Pastes de temporada',30],['Agua de jamaica','Bebidas',20]].map(([name,category,price],i)=>({id:uuid(i+1),name,category,price,image_url:'favicon.png',description:'Producto ficticio para probar el administrador.',available:true,track_stock:false,stock:0,low_stock_threshold:3,sort_order:i,created_at:new Date(now).toISOString()})),orders:[],delivery_zones:[],settings:Object.entries(settings).map(([key,value],i)=>({id:uuid(100+i),key,value}))};
  function fakeOrder(n){return {id:uuid(200+n),order_code:'PRUEBA-'+String(n).padStart(3,'0'),customer_name:'Cliente de prueba '+n,customer_phone:'9990000000',delivery_type:'pickup',payment_method:'cash',order_status:'pendiente_confirmacion',created_at:new Date(now+n*1000).toISOString(),items:[{product_id:uuid(1),name:'Paste de papa',quantity:2,price:25,subtotal:50}],subtotal:50,total:50,delivery_fee:0,notes:'Pedido ficticio: no preparar ni cobrar.',inventory_applied:false,inventory_restored:false};}
  tables.orders=[fakeOrder(1),{...fakeOrder(2),order_status:'entregado'},{...fakeOrder(3),order_status:'cancelado'}];
  function emit(table,row,type='INSERT'){if(state.offline)return;for(const c of state.channels)for(const h of c.handlers)if(h.kind==='postgres_changes'&&h.filter.table===table)h.fn({eventType:type,new:row,old:{id:row.id}});}
  function access(){const member=state.members.find(m=>m.user_id===currentUser()),session=state.sessions.find(s=>s.user_id===currentUser());const enabled=state.role==='owner'||member?.enabled;return {allowed:enabled&&session?.status==='approved',role:state.role,status:enabled?session?.status:'disabled',enforced:state.enforced,members:state.role==='owner'?state.members:[],sessions:state.sessions.filter(s=>state.role==='owner'||s.status==='approved').map(s=>({...s,current:s.user_id===currentUser()}))};}

  function from(table){
    let op='select',payload,filters=[],sort=[],range=null,single=false;
    const q={select(){return q},order(k,o){sort.push([k,o?.ascending!==false]);return q},range(a,b){range=[a,b];return q},eq(k,v){filters.push(r=>String(r[k])===String(v));return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},gte(k,v){filters.push(r=>r[k]>=v);return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(p){op='update';payload=p;return q},insert(p){op='insert';payload=p;return q},delete(){op='delete';return q},then(resolve,reject){
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
      if(name==='pastehot_admin_state')return {data:access(),error:null};
      if(state.role!=='owner'&&name!=='update_order_status_with_inventory')return {data:null,error:{message:'NO_AUTORIZADO'}};
      if(name==='pastehot_set_session'){const s=state.sessions.find(s=>s.session_id===args.p_session_id);if(s){s.status=args.p_status;s.online=args.p_status==='approved';}return {data:true,error:null};}
      if(name==='pastehot_set_staff_enabled'){const m=state.members.find(m=>m.user_id===args.p_user_id);if(m)m.enabled=args.p_enabled;state.sessions.filter(s=>s.user_id===args.p_user_id).forEach(s=>s.status='revoked');return {data:true,error:null};}
      if(name==='pastehot_set_staff_role'){const m=state.members.find(m=>m.user_id===args.p_user_id);if(m&&m.role!==args.p_role){m.role=args.p_role;state.sessions.filter(s=>s.user_id===m.user_id).forEach(s=>{s.role=args.p_role;s.status='revoked';s.online=false;});}return {data:true,error:null};}
      if(name==='pastehot_activate_security'){state.enforced=true;return {data:true,error:null};}
      if(name==='update_order_status_with_inventory'){const o=tables.orders.find(o=>o.id===args.p_order_id);if(o){o.order_status=args.p_new_status;emit('orders',o,'UPDATE');}return {data:o,error:null};}
      return {data:null,error:null};
    },functions:{async invoke(_name,{body}){state.members.push({user_id:uuid(700+state.counter++),display_name:body.name,email:body.email,role:body.role||'staff',enabled:true});return {data:{ok:true},error:null};}},storage:{from(){return {async list(){return {data:[],error:null}},async remove(){return {data:[],error:null}},async upload(){return {error:{message:'La prueba no sube fotos reales.'}}}}}}};
  window.PasteHotDemo={state,tables,client};window.supabase={createClient:()=>client};
  window.demoNewOrder=()=>{const o=fakeOrder(state.counter++);o.created_at=new Date().toISOString();tables.orders.unshift(o);emit('orders',o);};
  window.demoBurstOrders=()=>{for(let i=0;i<3;i++)window.demoNewOrder();};
  window.demoConnection=()=>{
    state.offline=!state.offline;state.channels.forEach(c=>c.status(state.offline?'CHANNEL_ERROR':'SUBSCRIBED'));
    if(state.offline){window.demoNewOrder();alert('Se simuló un pedido durante la desconexión. Toca de nuevo Simular desconexión para recuperar la conexión y comprobar la alerta.');}
  };
  window.demoRole=async(role)=>{state.role=role||({owner:'staff',staff:'manager',manager:'owner'}[state.role]);if(!['owner','staff','manager'].includes(state.role))return;orderInbox=null;orders=[];stopAdminEnhancements();await enterAdmin((await client.auth.getSession()).data.session);if(state.role==='owner')showTab('access');};
})();
