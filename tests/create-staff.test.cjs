const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,role='staff',allowed=true,direct=true,created=0,registered=0,duplicate=false,registrationError=false,authValid=true,received;
 const caller={auth:{getUser:async()=>({data:{user:authValid?{id:'owner'}:null},error:null})},rpc:async(name,args)=>{if(name==='pastehot_admin_state')return {data:{role,allowed,direct_access:direct}};registered++;return {error:registrationError?{message:'NO_AUTORIZADO'}:null};}};
 const service={auth:{admin:{createUser:async(args)=>{created++;received=args;return duplicate?{data:{user:null},error:{message:'Already registered'}}:{data:{user:{id:'new'}},error:null};}}}};
 const context={Request,Response,console,Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'secret':'fixture'},serve:fn=>handler=fn},createClient:(_url,key)=>key==='secret'?service:caller};vm.createContext(context);
 const src=fs.readFileSync(__dirname+'/../supabase/functions/pastehot-create-staff/index.ts','utf8').replace(/^import .*;$/m,'');vm.runInContext(stripTypeScriptTypes(src,{mode:'strip'}),context);
 const make=(body={},origin='https://www.pastehot.com')=>new Request('https://example.invalid',{method:'POST',headers:{origin,authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({username:'ana.turno',name:'Ana',password:'FixtureClave123!',role:'staff',deviceToken:'1'.repeat(64),...body})});
 assert.equal((await handler(make())).status,403);role='manager';assert.equal((await handler(make())).status,403);assert.equal(created,0);role='owner';
 allowed=false;assert.equal((await handler(make())).status,403);allowed=true;direct=false;assert.equal((await handler(make())).status,409);direct=true;
 assert.equal((await handler(make({},'https://evil.example.invalid'))).status,403);authValid=false;assert.equal((await handler(make())).status,401);authValid=true;
 for(const body of [{role:'owner'},{username:'Ana con espacio'},{password:'123456789012'},{password:'short'}])assert.equal((await handler(make(body))).status,400);
 assert.equal(created,0);
 const ok=await handler(make());assert.equal(ok.status,200);const text=await ok.text();assert(!text.includes('FixtureClave123!'));assert.equal(received.email,'staff+ana.turno@accounts.pastehot.com');assert.equal(received.email_confirm,true);assert.equal(registered,1);
 duplicate=true;assert.equal((await handler(make())).status,409);assert.equal(registered,1);duplicate=false;registrationError=true;assert.equal((await handler(make())).status,409);
 console.log('PASS: only active owner creates accounts; role escalation, duplicate overwrite, weak password, untrusted origin and inactive mode blocked; no email delivery or plaintext password response.');
})().catch(e=>{console.error(e);process.exitCode=1;});
