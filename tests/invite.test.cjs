const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,invites=0,added=0,role='staff',memberRole,emailFails=false,linkFails=false,members=[],confirmed=false,links=0;const caller={auth:{getUser:async()=>({data:{user:{id:'user'}}})},rpc:async(name,args)=>{if(name==='pastehot_admin_state')return {data:{role,allowed:true,enforced:true,members}};added++;memberRole=args.p_role;return {error:null};}};
 const service={auth:{admin:{inviteUserByEmail:async()=>{invites++;return emailFails?{data:{user:null},error:{message:'SMTP unavailable'}}:{data:{user:{id:'new-user'}},error:null};},generateLink:async()=>{links++;return linkFails?{data:{},error:{message:'Unavailable'}}:{data:{user:{id:'new-user'},properties:{action_link:'https://fixture.supabase.co/auth/v1/verify?type=invite&token=fixture'}},error:null};},getUserById:async()=>({data:{user:{id:'new-user',email_confirmed_at:confirmed?'2026-10-09':null}},error:null})}}};
 const context={Request,Response,URL,console,Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'secret':k==='SUPABASE_URL'?'https://fixture.supabase.co':'public'},serve:fn=>handler=fn},createClient:(_url,key)=>key==='secret'?service:caller};vm.createContext(context);
 const src=fs.readFileSync(__dirname+'/../supabase/functions/pastehot-invite-staff/index.ts','utf8').replace(/^import .*;$/m,'');vm.runInContext(stripTypeScriptTypes(src,{mode:'strip'}),context);
 const make=(origin='https://www.pastehot.com',redirectTo=origin+'/admin.html',requestedRole='staff')=>new Request('https://example.invalid/function',{method:'POST',headers:{origin,authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({email:'employee@example.invalid',name:'Empleado',role:requestedRole,redirectTo,deviceToken:'1'.repeat(64)})});
 assert.equal((await handler(make())).status,403);assert.equal(invites,0);role='manager';assert.equal((await handler(make())).status,403);assert.equal(invites,0);role='owner';
 assert.equal((await handler(make('https://evil.example.invalid'))).status,403);assert.equal(invites,0);
 assert.equal((await handler(make('https://www.pastehot.com','https://evil.example.invalid'))).status,400);assert.equal(invites,0);
 assert.equal((await handler(make())).status,200);assert.equal(invites,1);assert.equal(added,1);assert.equal(memberRole,'staff');
 assert.equal((await handler(make('https://www.pastehot.com',undefined,'owner'))).status,400);assert.equal(invites,1);
 assert.equal((await handler(make('https://www.pastehot.com',undefined,'manager'))).status,200);assert.equal(memberRole,'manager');assert.equal(invites,2);
 emailFails=true;const fallback=await handler(make());assert.equal(fallback.status,200);const result=await fallback.json();assert.equal(result.delivery,'manual');assert.ok(result.invitationLink.includes('/auth/v1/verify?type=invite'));assert.equal(links,1);assert.equal(added,3);
 linkFails=true;assert.equal((await handler(make())).status,400);assert.equal(added,3);linkFails=false;
 members=[{user_id:'new-user',email:'employee@example.invalid',enabled:true,role:'staff'}];assert.equal((await handler(make())).status,200);assert.equal(added,3);confirmed=true;assert.equal((await handler(make())).status,409);members[0].enabled=false;confirmed=false;assert.equal((await handler(make())).status,409);
 console.log('PASS: invitation endpoint blocks staff and managers, invalid roles, foreign origins and redirects before sending; only authorized owner can invite.');
})().catch(e=>{console.error(e);process.exitCode=1;});
