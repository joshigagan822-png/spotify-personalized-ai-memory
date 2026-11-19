import test from 'node:test';
import assert from 'node:assert/strict';
import {openLocal} from '../backend/local-db.js';
import {handle} from '../backend/routes.js';
import {change,readState,clock} from '../backend/store.js';
import {advance,enqueue,query} from '../backend/service.js';
import {active,byId,finishDelete,newState,processEvent,purge,requestDelete} from '../backend/memory.js';
import {search} from '../backend/retrieval.js';
import {reply} from '../backend/reply.js';
import {prepareEvent} from '../backend/extraction.js';
import {toolDefinitions} from '../backend/contracts.js';
import demo from '../data/demo.json' with {type:'json'};
import events from '../data/events.json' with {type:'json'};
import users from '../data/users.json' with {type:'json'};
import quality from '../docs/quality.json' with {type:'json'};
import fixtures from './fixtures.json' with {type:'json'};
import {replay} from '../backend/replay.js';

const q={utterance:'What should I listen to next?',locale:'en-IN',surface:'listening_ai',max_context_items:3,context_token_budget:96};
const user=users[0], seed=demo.events.find(e=>e.subject_id===user.subject_id && e.event_type==='explicit_preference');
const after='2026-10-21T15:00:00Z';
const memory=()=>replay(user,demo.events,after).state;
function pilot() {
  const db=openLocal(':memory:');
  const tasks=[];
  const ctx={waitUntil:p=>tasks.push(p)};
  async function call(path,method='GET',data,token,extra={}) {
    const headers={'Content-Type':'application/json',...extra};
    if(token) headers.Authorization='Bearer '+token;
    const req=new Request('http://localhost'+path,{method,headers,body:data?JSON.stringify(data):undefined});
    const response=await handle(req,{DB:db},ctx,()=>new Response(''));
    const text=await response.text();
    return {status:response.status,data:text?JSON.parse(text):null};
  }
  async function session(subject_id='U0001'){return (await call('/demo/session','POST',{subject_id,client:'cli'})).data.access_token;}
  return {db,call,session,settle:()=>Promise.all(tasks)};
}
function eventAt(s,kind,fields={}) {
  const at=clock(s);
  return {...seed,event_id:crypto.randomUUID(),source_event_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),
    event_at:at,received_at:at,raw_expires_at:new Date(Date.parse(at)+30*86400000).toISOString(),event_type:kind,...fields};
}

test('81 workbook queries pass ranked context, policy and state checks',()=>{
  assert.equal(quality.passed,81);assert.equal(quality.prohibited_returned,0);
  assert.equal(quality.provenance_matches,quality.context_records);assert.equal(quality.validation_passed,27);
});
test('all 300 histories replay from events with aligned graph and vector records',()=>{
  const receipts=events.filter(x=>x.event_type==='relevance_feedback').map(e=>({subject_id:e.subject_id,
    trace_id:e.payload.trace_id,response_id:e.payload.response_id,used:[e.target_memory_id]}));
  for(const u of users){
    const {state}=replay(u,events,'2026-11-09T00:00:00Z',{deletions:fixtures.deletions,feedbackReceipts:receipts});
    for(const [id,v] of Object.entries(state.vectors)){
      const m=byId(state,id);assert.equal(m.subject_id,u.subject_id);assert.equal(v.graph_version,m.graph_version);
      assert.equal(m.status,'active');assert.ok(Object.keys(v.values).length);
    }
  }
});
test('Hindi and Hinglish inputs resolve a named artist and respect different intents',()=>{
  const s=memory();
  for(const text of ['अरिजीत सिंह के गाने सुनाओ','Arijit ke gaane sunao']){
    const pack=search(s,{...q,utterance:text},after);assert.equal(pack.context[0].entity_id,'artist_01');
  }
  assert.equal(search(s,{...q,utterance:'श्रेया घोषाल के गाने सुनाओ'},after).context.length,0);
});
test('three independent sessions promote a preference, repeated deliveries do not',()=>{
  const s=newState(user);
  const ev={...seed,event_type:'follow',source_class:'product_signal',utterance:null};
  processEvent(s,ev);processEvent(s,ev);
  processEvent(s,{...ev,event_id:'E2',idempotency_key:'K2'});
  assert.equal(Object.keys(s.vectors).length,0);
  for(const k of ['3','4']) processEvent(s,{...ev,event_id:'E'+k,source_event_id:'SRC'+k,idempotency_key:'K'+k,session_id:'S'+k});
  assert.equal(s.memories.at(-1).memory_type,'inferred_preference');assert.equal(s.memories.at(-1).source_event_ids.length,3);
});
test('an episode dies at its exclusive expiry and its vector is removed',()=>{
  const s=memory();const m=s.memories.find(x=>x.memory_type==='episode');
  assert.ok(search(s,q,after).context.some(x=>x.memory_id===m.memory_id));
  purge(s,m.expires_at);assert.equal(m.status,'expired');assert.equal(m.normalized_fact,null);
  assert.equal(s.vectors[m.memory_id],undefined);
});
test('a stale index returns an empty dependency fallback',()=>{
  const s=memory();delete s.vectors[s.memories[0].memory_id];
  assert.equal(search(s,q,after).fallback_reason,'dependency_timeout');
  assert.deepEqual(search(s,q,after).context,[]);
});
test('explicit artist exclusions suppress related tracks',()=>{
  const s=memory();
  processEvent(s,{...seed,event_at:after,received_at:after,event_id:'E-ex',source_event_id:'SRC-ex',idempotency_key:'K-ex',event_type:'exclusion'});
  assert.deepEqual(search(s,q,after).context.map(m=>m.predicate),['EXCLUDES']);
});
test('blocked text stays out of the durable queue and structured model proposals are grounded',async()=>{
  const s=memory();s.clock={at:after,started:Date.now()};
  const e=eventAt(s,'ai_interaction',{entity_reference:null,utterance:'Please remember that I prefer Arijit Singh.'});
  const config={OLLAMA_URL:'http://model.invalid',OLLAMA_MODEL:'test'};
  const result=await prepareEvent(e,s,config,async()=>Response.json({message:{content:JSON.stringify({entity_id:'unknown',classification:'explicit_preference'})}}));
  assert.equal(result.event_type,'ai_interaction');assert.equal(result.utterance,null);
  const risk=eventAt(s,'ai_interaction',{utterance:'Only for today, make it comforting.'});
  assert.equal(enqueue(s,risk).status,'rejected');assert.equal(s.inbox.length,0);
  const marker=eventAt(s,'ai_interaction',{payload:{fixture_class:'untrusted_instruction_marker'}});
  assert.equal(enqueue(s,marker).reason,'untrusted_content');
});
test('model accepts an allowed structured response and recovers from invalid output',async()=>{
  const pack=search(memory(),q,after),config={OLLAMA_URL:'http://model.invalid',OLLAMA_MODEL:'test'};
  const valid=await reply(pack,q,config,async(url,options)=>{
    const request=JSON.parse(options.body);assert.ok(request.messages[1].content.includes('M0001-01'));
    const text=request.format.properties.reply.enum[0];return Response.json({message:{content:JSON.stringify({reply:text})}});
  });
  assert.equal(valid.generator,'ollama');
  const invalid=await reply(pack,q,config,async()=>Response.json({message:{content:'{}'}}));
  assert.equal(invalid.generator,'catalog_fallback');
});
test('subject binding applies to tools, traces, exports and same-profile reviewers',async()=>{
  const p=pilot(), a=await p.session(),b=await p.session('U0002'),another=await p.session();
  assert.equal((await p.call('/v1/memories')).status,401);
  assert.equal((await p.call('/v1/memories/search','POST',{...q,requested_subject_id:'U0002'},a)).status,403);
  const out=(await p.call('/v1/respond','POST',q,a)).data;
  for(const token of [b,another])assert.equal((await p.call('/v1/traces/'+out.trace_id,'GET',null,token)).status,404);
  const data=(await p.call('/v1/export','GET',null,b)).data;
  assert.equal(data.subject_id,'U0002');assert.ok(data.memories.every(m=>m.memory_id.startsWith('M0002')));
});
test('MCP initializes, exposes exactly five tool schemas and rejects unknown input fields',async()=>{
  const p=pilot(),t=await p.session();
  const rpc=(method,params={})=>p.call('/mcp','POST',{jsonrpc:'2.0',id:3,method,params},t);
  assert.equal((await rpc('initialize')).data.result.protocolVersion,'2025-06-18');
  assert.equal((await rpc('tools/list')).data.result.tools.length,5);
  const bad=await rpc('tools/call',{name:'search_memory',arguments:{...q,subject_id:'U0002'}});
  assert.equal(bad.data.result.isError,true);
  const good=await rpc('tools/call',{name:'search_memory',arguments:q});assert.equal(good.data.result.structuredContent.context.length,2);
});
test('correction is idempotent and rejects stale graph versions',async()=>{
  const p=pilot(),t=await p.session();
  const body={replacement_entity_id:'artist_02',idempotency_key:'change-a',expected_graph_version:1};
  const a=await p.call('/v1/memories/M0001-01','PATCH',body,t);
  assert.equal(a.status,200);const repeat=await p.call('/v1/memories/M0001-01','PATCH',body,t);
  assert.deepEqual(repeat.data,a.data);
  const stale=await p.call('/v1/memories/'+a.data.memory_id,'PATCH',{...body,idempotency_key:'change-b',expected_graph_version:3},t);
  assert.equal(stale.status,409);
  const row=(await p.call('/v1/respond','POST',q,t)).data;
  assert.equal(row.context[0].entity_id,'artist_02');
});
test('deletion revokes access first, then removes content, cache and trace references',async()=>{
  const p=pilot(),t=await p.session();
  const before=(await p.call('/v1/respond','POST',q,t)).data;
  const target=before.context[0].memory_id;
  const receipt=(await p.call('/v1/memories/'+target,'DELETE',{idempotency_key:'erase-one'},t)).data;
  await p.settle();
  const job=(await p.call('/v1/deletions/'+receipt.job_id,'GET',null,t)).data;
  assert.equal(job.status,'completed');assert.equal(job.vector,'removed');assert.equal(job.operational_metadata,'redacted');
  assert.ok(!(await p.call('/v1/traces/'+before.trace_id,'GET',null,t)).data.used.includes(target));
  assert.ok(!(await p.call('/v1/export','GET',null,t)).data.memories.some(m=>m.memory_id===target));
});
test('pause, resume and opt-out govern capture and invalidate cached results',async()=>{
  const p=pilot(),t=await p.session(),control=action=>p.call('/v1/control','POST',{action},t);
  await p.call('/v1/respond','POST',q,t);await control('pause_memory');
  assert.equal((await p.call('/v1/respond','POST',q,t)).data.fallback_reason,'memory_paused');
  await control('resume_memory');assert.ok((await p.call('/v1/respond','POST',q,t)).data.context.length);
  await control('opt_out');assert.equal((await p.call('/v1/respond','POST',q,t)).data.fallback_reason,'consent_revoked');
  assert.equal((await control('resume_memory')).status,409);
});
test('feedback must identify a memory actually used by the named response',async()=>{
  const p=pilot(),t=await p.session();
  const out=(await p.call('/v1/respond','POST',q,t)).data;
  const body={memory_id:out.context[0].memory_id,trace_id:out.trace_id,response_id:'other',verdict:'irrelevant'};
  assert.equal((await p.call('/v1/feedback','POST',body,t)).status,404);body.response_id=out.response_id;
  assert.equal((await p.call('/v1/feedback','POST',body,t)).status,200);
  assert.ok(!(await p.call('/v1/respond','POST',q,t)).data.context.some(x=>x.memory_id===body.memory_id));
});
test('ingestion survives a new worker instance and replay is idempotent',async()=>{
  const s=memory();s.clock={at:after,started:Date.now()};
  const ev=eventAt(s,'playback',{source_class:'product_signal',entity_reference:'track_02',utterance:null});
  assert.equal(enqueue(s,ev).status,'queued');const recovered=JSON.parse(JSON.stringify(s));
  advance(recovered);assert.ok(recovered.seen[ev.idempotency_key].memory_ids.length);
  assert.equal(enqueue(recovered,ev).status,'duplicate');
});
test('rate limits use independent tool quotas',async()=>{
  const p=pilot(),t=await p.session();
  let last;
  for(let n=0;n<=toolDefinitions.delete_memory.limit;n++) last=await p.call('/v1/memories/M-missing','DELETE',{idempotency_key:'del-'+n},t);
  assert.equal(last.status,429);assert.equal((await p.call('/v1/respond','POST',q,t)).status,200);
});
test('expired sessions, untrusted origins and conflicting idempotency keys are rejected',async()=>{
  const p=pilot(),t=await p.session();
  assert.equal((await p.call('/v1/memories','GET',null,t,{Origin:'http://unrelated.invalid'})).status,403);
  const body={idempotency_key:'one',entity_id:'artist_03',polarity:'positive',surface:'listening_ai'};
  assert.equal((await p.call('/v1/memories','POST',body,t)).status,200);
  assert.equal((await p.call('/v1/memories','POST',{...body,entity_id:'artist_02'},t)).status,409);
  p.db.prepare('UPDATE sessions SET expires=0').run();assert.equal((await p.call('/v1/memories','GET',null,t)).status,401);
});

test('embedded browser can open and switch profiles without cookies', async () => {
  const p = pilot();
  const first = await p.call('/demo/session', 'POST', {subject_id: 'U0001', client: 'browser'});
  assert.equal(first.status, 201);
  const headers = {'X-Listening-Session': first.data.access_token};
  const profile = await p.call('/v1/export', 'GET', null, null, headers);
  assert.equal(profile.data.subject_id, 'U0001');

  const switched = await p.call('/demo/session', 'POST', {subject_id: 'U0003', client: 'browser'}, null, headers);
  assert.equal(switched.status, 201);
  const secondHeaders = {'X-Listening-Session': switched.data.access_token};
  const nextProfile = await p.call('/v1/export', 'GET', null, null, secondHeaders);
  assert.equal(nextProfile.data.subject_id, 'U0003');
  const rejected = await p.call('/v1/export', 'GET', null, null, {'X-Listening-Session': 'unknown'});
  assert.equal(rejected.status, 401);
});
