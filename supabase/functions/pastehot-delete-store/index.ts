import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';

const allowedOrigin=(origin:string)=>origin==='https://www.pastehot.com'||origin==='https://pastehot.com'||/^https:\/\/deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app$/.test(origin);

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin(origin)?origin:'https://www.pastehot.com','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowedOrigin(origin))return reply(403,{error:'Origen no autorizado.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const bearer=req.headers.get('authorization')||'';
  if(!bearer.startsWith('Bearer '))return reply(401,{error:'Vuelve a entrar al administrador.'});

  try{
    const url=Deno.env.get('SUPABASE_URL')!;
    const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
    const token=bearer.slice(7);
    const caller=createClient(url,anonKey,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await caller.auth.getUser(token);
    if(authError||!auth.user?.id||!auth.user.email)return reply(401,{error:'Sesión no válida.'});

    const {data:state,error:stateError}=await caller.rpc('pastehot_admin_state',{p_visible:true,p_device_token:''});
    if(stateError||!state?.allowed||state.role!=='owner')return reply(403,{error:'Solo la propietaria principal puede eliminar sucursales.'});

    const body=await req.json();
    const storeId=String(body.storeId||'');
    const password=typeof body.password==='string'?body.password:'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)||!password||password.length>128)return reply(400,{error:'Faltan datos para confirmar la eliminación.'});

    // Verify the password in a separate, non-persistent Auth client. The
    // credentials are never logged, returned, or stored by this function.
    const verifier=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:verified,error:passwordError}=await verifier.auth.signInWithPassword({email:auth.user.email,password});
    if(passwordError||verified?.user?.id!==auth.user.id)return reply(401,{error:'La contraseña no corresponde a la cuenta principal.'});

    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await service.rpc('pastehot_delete_store_after_reauth',{p_store_id:storeId,p_owner_id:auth.user.id});
    if(error){
      const detail=String(error.message||'');
      const message=detail.includes('NO_AUTORIZADO')?'Solo la propietaria principal puede eliminar sucursales.':
        detail.includes('NO_SE_PUEDE_ELIMINAR_LA_ULTIMA_SUCURSAL')?'Debe quedar al menos una sucursal en el sistema.':
        detail.includes('DEBE_QUEDAR_UNA_SUCURSAL_ACTIVA')?'Debe quedar al menos una sucursal activa.':
        detail.includes('SUCURSAL_NO_ENCONTRADA')?'No se encontró esa sucursal.':
        'No se pudo eliminar la sucursal. Revisa que siga disponible y vuelve a intentarlo.';
      return reply(409,{error:message});
    }
    return reply(200,{ok:true,store:data});
  }catch{
    return reply(500,{error:'No se pudo confirmar la eliminación. Revisa la conexión e intenta de nuevo.'});
  }
});
