// Service credentials stay inside the function environment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
const allowedOrigin=(value:string)=>value==='https://www.pastehot.com'||value==='https://pastehot.com'||/^https:\/\/deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app$/.test(value);
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowedOrigin(origin)?origin:'https://www.pastehot.com','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
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
    const role=String(body.role||'staff');
    if(!['manager','staff'].includes(role))return reply(400,{error:'Selecciona empleado o encargado.'});
    const redirect=String(body.redirectTo||'');
    if(redirect!==origin+'/admin.html')return reply(400,{error:'Destino no permitido.'});
    const existing=state.members?.find((m:{email:string})=>m.email?.toLowerCase()===email);
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    if(existing){
      if(!existing.enabled||!['manager','staff'].includes(existing.role)||existing.role!==role)return reply(409,{error:'Este acceso ya existe. Administra sus permisos desde Accesos.'});
      const {data:account,error:accountError}=await service.auth.admin.getUserById(existing.user_id);
      if(accountError||!account.user||account.user.email_confirmed_at)return reply(409,{error:'La cuenta ya aceptó la invitación. Puede entrar con su correo y contraseña.'});
    }
    const {data:invited,error:inviteError}=await service.auth.admin.inviteUserByEmail(email,{redirectTo:redirect});
    let invitationLink:string|null=null;
    if(inviteError||!invited.user){
      const {data:generated,error:linkError}=await service.auth.admin.generateLink({type:'invite',email,options:{redirectTo:redirect}});
      if(linkError||!generated.user||!generated.properties?.action_link)return reply(400,{error:'No se pudo crear la invitación. El correo puede estar registrado o el servicio no estar disponible.'});
      const link=new URL(generated.properties.action_link);
      if(link.origin!==url||link.pathname!=='/auth/v1/verify'||link.searchParams.get('type')!=='invite')return reply(500,{error:'No se pudo verificar el enlace de invitación.'});
      invitationLink=link.href;
    }
    const {error:memberError}=existing?{error:null}:await caller.rpc('pastehot_add_staff',{p_email:email,p_name:name,p_role:role});
    // Without membership the invited account has zero operational permissions. A failed registration
    // never grants fallback access, and never deletes a potentially existing account.
    if(memberError)return reply(409,{error:'Se creó la invitación, pero no se habilitó el acceso. La cuenta no tiene permisos; revisa Accesos antes de volver a invitar.'});
    return reply(200,{ok:true,delivery:invitationLink?'manual':'email',invitationLink});
  }catch{return reply(500,{error:'No se pudo completar la invitación. Intenta nuevamente más tarde.'});}
});
