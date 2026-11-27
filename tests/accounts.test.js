import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocal} from '../backend/local-db.js';
import {accountSession} from '../backend/accounts.js';
import {handle} from '../backend/routes.js';
test('a second browser recovers favourite artists while a guest and another account remain isolated',async t=>{
 const db=openLocal(':memory:');t.after(()=>db.close());
 db.prepare('CREATE TABLE accounts(email TEXT PRIMARY KEY,subject TEXT UNIQUE,salt TEXT,hash TEXT)').run();
 const env={DB:db,accountSession,spotifySearch:async()=>({available:false,tracks:[]})};
 async function call(path,cookie,body){
  const req=new Request('https://example.test/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie||''},body:body?JSON.stringify(body):undefined});
  const response=await handle(req,env);assert.ok(response.ok,await response.clone().text());return response;
 }
 const cookie=r=>r.headers.get('set-cookie').split(';')[0], credentials={email:'a@example.test',password:'local-test-password',eligible:true};
 const first=cookie(await call('signup','',credentials));
 await call('memory',first,{action:'artists',artists:['Shreya Ghoshal','Sonu Nigam']});
 const second=cookie(await call('login','',credentials));
 assert.deepEqual((await(await call('state',second)).json()).artists,['Shreya Ghoshal','Sonu Nigam']);
 const guest=cookie(await call('guest','',{}));assert.deepEqual((await(await call('state',guest)).json()).artists,[]);
 const other=cookie(await call('signup','',{...credentials,email:'b@example.test'}));
 await call('memory',other,{action:'artists',artists:['Arijit Singh']});
 const feed=async c=>(await call('feed',c,{type:'track'})).json();
 const baseline=await feed(second),different=await feed(other);assert.notEqual(baseline.items[0].artist,different.items[0].artist);
 const chosen=baseline.items[0];await call('rate',second,{key:chosen.key,batch:baseline.batch,choice:'less'});
 const after=await feed(second);assert.ok(after.items.findIndex(t=>t.key===chosen.key)>4);
 await call('memory',second,{action:'undo',key:chosen.key});assert.equal((await feed(second)).items[0].key,chosen.key);
});
test('one-time recovery changes a four-character password and revokes prior sessions',async t=>{
 const db=openLocal(':memory:');t.after(()=>db.close());
 db.prepare('CREATE TABLE accounts(email TEXT PRIMARY KEY,subject TEXT UNIQUE,salt TEXT,hash TEXT)').run();
 const env={DB:db,accountSession};
 const post=(p,body)=>handle(new Request('https://example.test/v1/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const email='reset@example.test';
 assert.equal((await post('signup',{email,password:'abc'})).status,422);
 const first=await post('signup',{email,password:'abcd'}),cookie=first.headers.get('set-cookie').split(';')[0];
 const code=(await first.json()).recoveryCode;assert.ok(code);
 assert.equal((await post('reset-password',{email,password:'wxyz',code:'invalid'})).status,400);
 const reset=await post('reset-password',{email,password:'wxyz',code});assert.notEqual((await reset.json()).recoveryCode,code);
 assert.equal((await post('reset-password',{email,password:'wxyz',code})).status,400);
 assert.equal((await handle(new Request('https://example.test/v1/state',{headers:{Cookie:cookie}}),env)).status,401);
 assert.equal((await post('login',{email,password:'abcd'})).status,401);
 assert.equal((await post('login',{email,password:'wxyz'})).status,200);
});