import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocal} from '../backend/local-db.js';
import {handle} from '../backend/routes.js';
import {accountSession} from '../backend/accounts.js';
import {createSpotifySearch} from '../backend/spotify.js';

test('personal login persists votes, isolates accounts and revokes a logged-out session',async t=>{
  const db=openLocal(':memory:');
  t.after(()=>db.close());
  db.prepare('CREATE TABLE accounts(email TEXT PRIMARY KEY,subject TEXT UNIQUE,salt TEXT,hash TEXT)').run();
  async function call(path,token,body){
    const headers={'Content-Type':'application/json'};
    if(token)headers.Authorization='Bearer '+token;
    const request=new Request('https://test.invalid'+path,{headers,method:body?'POST':'GET',body:JSON.stringify(body)});
    const response=await handle(request,{DB:db,accountSession},{waitUntil(){}},()=>new Response(''));
    return [response.status,await response.json()];
  }
  const profile={email:'one@example.test',password:'long test passphrase',eligible:true};
  const [status,first]=await call('/v1/account/signup',null,profile);
  assert.equal(status,200);
  const a=first.access_token;
  assert.equal((await call('/v1/track-feedback',a,{track:'track_01',choice:'more'}))[0],200);
  const [,second]=await call('/v1/account/signup',null,{...profile,email:'two@example.test'});
  assert.deepEqual((await call('/v1/dashboard',second.access_token))[1].trackVotes,{});
  assert.equal((await call('/v1/account/logout',a,{}))[0],200);
  assert.equal((await call('/v1/dashboard',a))[0],401);
  assert.equal((await call('/v1/account/login',null,{...profile,password:'wrong'}))[0],401);
  const [,login]=await call('/v1/account/login',null,profile);
  assert.equal((await call('/v1/dashboard',login.access_token))[1].trackVotes.track_01,'more');
  await call('/v1/track-feedback',login.access_token,{track:'track_01',choice:'undo'});
  assert.deepEqual((await call('/v1/dashboard',login.access_token))[1].trackVotes,{});
});
test('Spotify caches the service token, preserves track identity and falls back when unavailable',async()=>{
  let tokens=0,offline=false;
  const search=createSpotifySearch('id','secret',async url=>{
    if(url.includes('accounts.')){tokens++;return Response.json({access_token:'token',expires_in:3600});}
    if(offline)return new Response(null,{status:429,headers:{'Retry-After':'10'}});
    return Response.json({tracks:{items:[{id:'a'.repeat(22),name:'Song',artists:[{name:'Artist'}],album:{name:'Album'}}]}});
  });
  assert.equal((await search('song')).tracks[0].id,'a'.repeat(22));
  await search('artist');assert.equal(tokens,1);
  offline=true;assert.equal((await search('song')).available,false);
  assert.equal((await createSpotifySearch('','')('song')).available,false);
});
