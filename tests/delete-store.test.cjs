const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

(async()=>{
 let handler,ownerId='owner-primary',state={role:'owner',allowed:true},passwordValid=true,deleted=null;
 const storeId='44444444-4444-4444-8444-444444444444';
 const caller={auth:{getUser:async token=>({data:{user:token==='fixture'?{id:ownerId,email:'owner@example.com'}:null},error:token==='fixture'?null:{message:'invalid'}})},rpc:async name=>name==='pastehot_admin_state'?{data:state,error:null}:{data:null,error:{message:'unexpected rpc'}}};
 const verifier={auth:{signInWithPassword:async ({email,password})=>({data:passwordValid&&email==='owner@example.com'&&password==='OwnerClave123!'?{user:{id:ownerId}}:{user:null},error:passwordValid&&password==='OwnerClave123!'?null:{message:'invalid'}})}};
 const service={rpc:async(name,args)=>{assert.equal(name,'pastehot_delete_store_after_reauth');deleted=args;return {data:{id:args.p_store_id,name:'Norte'},error:null}}};
 const context={Request,Response,console,Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service-key':'fixture'},serve:fn=>handler=fn},createClient:(_url,key,options)=>key==='service-key'?service:options?.global?caller:verifier};
 vm.createContext(context);
 const source=fs.readFileSync(__dirname+'/../supabase/functions/pastehot-delete-store/index.ts','utf8').replace(/^import .*;$/m,'');
 vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
 const make=(body={},origin='https://www.pastehot.com',token='fixture')=>new Request('https://example.invalid',{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({storeId,password:'OwnerClave123!',...body})});
 assert.equal((await handler(make({},'https://evil.example'))).status,403);
 state={role:'owner',allowed:false};assert.equal((await handler(make())).status,403);state={role:'owner',allowed:true};
 passwordValid=false;assert.equal((await handler(make())).status,401);assert.equal(deleted,null);passwordValid=true;
 const response=await handler(make());assert.equal(response.status,200);const body=await response.json();assert.equal(body.store.id,storeId);assert(!JSON.stringify(body).includes('OwnerClave123!'));assert.equal(deleted.p_store_id,storeId);assert.equal(deleted.p_owner_id,ownerId);
 const sourceText=source.toLowerCase();assert(!sourceText.includes('console.log('));
 console.log('PASS: store deletion requires signed-in owner, recent password verification, and a server-only database RPC; password is not returned or logged.');
})().catch(error=>{console.error(error);process.exitCode=1;});
