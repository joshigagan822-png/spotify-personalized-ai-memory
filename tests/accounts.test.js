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