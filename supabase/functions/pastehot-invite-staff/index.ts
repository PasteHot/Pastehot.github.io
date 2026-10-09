// Prepared only; not deployed. Service credentials stay inside the function environment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
const allowedOrigin=(value:string)=>value==='https://www.pastehot.com'||value==='https://pastehot.com'||/^https:\/\/deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app$/.test(value);
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowedOrigin(origin)?origin:'https://www.pastehot.com','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Vary':'Origin'};
  const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
  if(!allowedOrigin(origin))return reply(403,{error:'Origen no autorizado.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const token=req.headers.get('authorization')||'';
  if(!token.startsWith('Bearer '))return reply(401,{error:'Vuelve a entrar al administrador.'});
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
    const caller=createClient(url,anon,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await caller.auth.getUser();
    if(authError||!auth.user)return reply(401,{error:'Sesión no válida.'});
    const body=await req.json();
    const {data:state,error:stateError}=await caller.rpc('pastehot_admin_state',{p_visible:true,p_device_token:String(body.deviceToken||'')});
    if(stateError||state?.role!=='owner'||!state.allowed||!state.enforced)return reply(403,{error:'Se requiere una sesión autorizada del propietario.'});
    const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!name||name.length>80)return reply(400,{error:'Revisa el nombre y el correo.'});
    const redirect=String(body.redirectTo||'');
    if(redirect!==origin+'/admin.html')return reply(400,{error:'Destino no permitido.'});
    if(state.members?.some((m:{email:string})=>m.email?.toLowerCase()===email))return reply(409,{error:'Este acceso ya existe. Puedes habilitarlo desde Accesos.'});
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:invited,error:inviteError}=await service.auth.admin.inviteUserByEmail(email,{redirectTo:redirect});
    if(inviteError||!invited.user)return reply(400,{error:'No se pudo enviar la invitación. El correo puede estar registrado o el servicio no estar disponible.'});
    const {error:memberError}=await caller.rpc('pastehot_add_staff',{p_email:email,p_name:name});
    // Without membership the invited account has zero operational permissions. A failed registration
    // never grants fallback access, and never deletes a potentially existing account.
    if(memberError)return reply(409,{error:'Se envió la invitación, pero no se habilitó el acceso. La cuenta no tiene permisos; revisa Accesos antes de volver a invitar.'});
    return reply(200,{ok:true});
  }catch{return reply(500,{error:'No se pudo completar la invitación. Intenta nuevamente más tarde.'});}
});
