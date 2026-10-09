import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
const allowedOrigin=(origin:string)=>origin==='https://www.pastehot.com'||origin==='https://pastehot.com'||/^https:\/\/deploy-preview-\d+--cheerful-daifuku-76579b\.netlify\.app$/.test(origin);
Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowedOrigin(origin)?origin:'https://www.pastehot.com','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowedOrigin(origin))return reply(403,{error:'Origen no autorizado.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
  const token=req.headers.get('authorization')||'';
  if(!token.startsWith('Bearer '))return reply(401,{error:'Vuelve a entrar al administrador.'});
  try{
    const url=Deno.env.get('SUPABASE_URL')!;
    const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await caller.auth.getUser();
    if(authError||!auth.user)return reply(401,{error:'Sesión no válida.'});
    const body=await req.json();
    const {data:state,error:stateError}=await caller.rpc('pastehot_admin_state',{p_visible:true,p_device_token:String(body.deviceToken||'')});
    if(stateError||!state?.allowed||state.role!=='owner')return reply(403,{error:'Solo el propietario puede crear cuentas.'});
    if(!state.direct_access)return reply(409,{error:'Esta mejora aún no está activada para cuentas reales.'});
    if(body.action==='delete'){
      const id=String(body.userId||'');
      const target=state.members?.find((m:{user_id:string,role:string})=>m.user_id===id);
      if(id===auth.user.id||!target||target.primary_owner||!['owner','staff','manager'].includes(target.role))return reply(403,{error:'La cuenta principal y tu propia cuenta están protegidas.'});
      const {error:blockError}=await caller.rpc('pastehot_set_staff_enabled',{p_user_id:id,p_enabled:false});
      if(blockError)return reply(409,{error:'No se pudo bloquear la cuenta; no se ha borrado.'});
      const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
      const {error:deleteError}=await service.auth.admin.deleteUser(id,false);
      if(deleteError)return reply(409,{error:'La cuenta quedó desactivada, pero el borrado no terminó. Puedes volver a pulsar Borrar cuenta.'});
      return reply(200,{ok:true});
    }
    if(body.action&&body.action!=='create')return reply(400,{error:'Acción no válida.'});
    const username=String(body.username||'').trim().toLowerCase(),name=String(body.name||'').trim(),role=String(body.role||'');
    const password=typeof body.password==='string'?body.password:'';
    if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)||!name||name.length>80)return reply(400,{error:'Usa un usuario de 3 a 32 caracteres: letras sin acentos, números, punto, guion o guion bajo.'});
    if(!['owner','manager','staff'].includes(role))return reply(400,{error:'Elige empleado, encargado o segundo propietario.'});
    if(password.length<12||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))return reply(400,{error:'Usa una contraseña de 12 a 128 caracteres con letras y números.'});
    if(role==='owner'&&state.members?.some((m:{role:string,primary_owner:boolean})=>m.role==='owner'&&!m.primary_owner))return reply(409,{error:'Ya existe un segundo propietario. Cambia su función o borra su cuenta antes de agregar otro.'});
    const email=`staff+${username}@accounts.pastehot.com`;
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true});
    if(createError||!created.user)return reply(409,{error:'No se creó la cuenta. El usuario puede estar ocupado o la contraseña no cumplir los requisitos. Prueba otro usuario.'});
    const {error:memberError}=await caller.rpc('pastehot_add_staff',{p_email:email,p_name:name,p_role:role});
    // A failed membership registration grants no permissions. Never overwrite an existing account.
    // Passwords are handled by Auth; never logged, returned or stored in the membership table.
    if(memberError)return reply(409,{error:'No se habilitó la cuenta y no tiene permisos. Contacta al propietario antes de volver a intentarlo.'});
    return reply(200,{ok:true,username,role});
  }catch{return reply(500,{error:'No se pudo crear la cuenta. Revisa la conexión e intenta nuevamente.'});}
});
