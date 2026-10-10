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
    const {data:auth,error:authError}=await caller.auth.getUser(token.slice(7));
    if(authError||!auth.user)return reply(401,{error:'Sesión no válida.'});
    const body=await req.json();
    const {data:state,error:stateError}=await caller.rpc('pastehot_admin_state',{p_visible:true,p_device_token:String(body.deviceToken||'')});
    if(stateError||!state?.allowed||!['owner','manager'].includes(state.role))return reply(403,{error:'Solo el propietario o el encargado puede gestionar cuentas de empleados.'});
    if(!state.direct_access)return reply(409,{error:'Esta mejora aún no está activada para cuentas reales.'});
    const manager=state.role==='manager';
    const getTarget=async(id:string)=>{
      if(!manager)return state.members?.find((m:{user_id:string,role:string,primary_owner?:boolean})=>m.user_id===id);
      const {data,error}=await caller.rpc('pastehot_manager_staff_accounts');
      if(error||!Array.isArray(data))return null;
      return data.find((m:{user_id:string,role:string})=>m.user_id===id);
    };
    if(body.action==='reset_password'){
      const id=String(body.userId||''),password=typeof body.password==='string'?body.password:'';
      const target=await getTarget(id);
      if(!target||id===auth.user.id||target.primary_owner||!['owner','manager','staff'].includes(target.role)||(manager&&target.role!=='staff'))return reply(403,{error:'El encargado solo puede cambiar contraseñas de empleados.'});
      if(password.length<12||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))return reply(400,{error:'Usa una contraseña de 12 a 128 caracteres con letras y números.'});
      const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
      const {error:passwordError}=await service.auth.admin.updateUserById(id,{password});
      if(passwordError)return reply(409,{error:'No se cambió la contraseña. Verifica los requisitos e inténtalo nuevamente.'});
      const {error:revokeError}=await caller.rpc(manager?'pastehot_manager_revoke_staff_sessions':'pastehot_revoke_member_sessions',{p_user_id:id});
      if(revokeError)return reply(409,{error:'La nueva contraseña quedó guardada, pero no se pudieron cerrar las sesiones anteriores. Contacta al propietario antes de entregar el acceso.'});
      return reply(200,{ok:true});
    }
    if(body.action==='delete'){
      const id=String(body.userId||'');
      const target=await getTarget(id);
      if(id===auth.user.id||!target||target.primary_owner||!['owner','staff','manager'].includes(target.role)||(manager&&target.role!=='staff'))return reply(403,{error:'El encargado solo puede borrar cuentas de empleados; las cuentas de propietarios, encargados y la tuya están protegidas.'});
      const {error:blockError}=await caller.rpc(manager?'pastehot_manager_set_staff_enabled':'pastehot_set_staff_enabled',{p_user_id:id,p_enabled:false});
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
    if(manager&&role!=='staff')return reply(403,{error:'El encargado solo puede crear cuentas de empleados.'});
    if(password.length<12||password.length>128||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))return reply(400,{error:'Usa una contraseña de 12 a 128 caracteres con letras y números.'});
    if(role==='owner'&&state.members?.some((m:{role:string,primary_owner:boolean})=>m.role==='owner'&&!m.primary_owner))return reply(409,{error:'Ya existe un segundo propietario. Cambia su función o borra su cuenta antes de agregar otro.'});
    const email=`staff+${username}@accounts.pastehot.com`;
    const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true});
    if(createError||!created.user){
      if(['email_exists','user_already_exists'].includes(createError?.code||''))return reply(409,{error:'Ese usuario ya existe. Elige otro; su cuenta y contraseña no se han modificado.'});
      if(createError?.code==='weak_password')return reply(400,{error:'La contraseña no cumple los requisitos de seguridad. Usa una diferente con letras y números.'});
      return reply(409,{error:'No se creó la cuenta. Revisa que el usuario no esté ocupado y que la contraseña cumpla los requisitos.'});
    }
    const {error:memberError}=manager
      ?await caller.rpc('pastehot_manager_add_staff',{p_email:email,p_name:name})
      :await caller.rpc('pastehot_add_staff',{p_email:email,p_name:name,p_role:role});
    // A failed membership registration grants no permissions. Never overwrite an existing account.
    // Passwords are handled by Auth; never logged, returned or stored in the membership table.
    if(memberError){
      // Only undo the user created by this request; never touch an existing account.
      const {error:cleanupError}=await service.auth.admin.deleteUser(created.user.id,false);
      if(cleanupError)return reply(409,{error:'El alta no terminó. La cuenta no tiene permisos; revisa con el propietario antes de reintentar.'});
      const message=String(memberError.message||'');
      if(message.includes('pastehot_one_delegated_owner'))return reply(409,{error:'Ya existe un segundo propietario. Revisa el listado antes de agregar otro.'});
      return reply(409,{error:'No se activó la cuenta. No se guardó el usuario; puedes corregir los datos e intentarlo de nuevo.'});
    }
    return reply(200,{ok:true,username,role});
  }catch{return reply(500,{error:'No se pudo crear la cuenta. Revisa la conexión e intenta nuevamente.'});}
});
