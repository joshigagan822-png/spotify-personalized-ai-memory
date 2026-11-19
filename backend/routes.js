import { entities, policy, dimensions, vectorVersion } from './catalog.js';
import { Problem, byId, ensure, exportData, processEvent, recordFeedback, validateEvent } from './memory.js';
import { prepareEvent } from './extraction.js';
import { clock, change, limit, profiles, readState, sessionFor, startSession } from './store.js';
import { advance, callTool, enqueue, query, schedule, setControl, uid } from './service.js';
import { toolDefinitions } from './contracts.js';
import quality from '../docs/quality.json' with {type:'json'};

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,
  headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const ok=(action,detail={})=>({action,...detail});
const protocol='2025-06-18';
const readable=(traces)=>traces.slice(-30).reverse().map(({query_key,...trace})=>trace);
function metrics(s) {
  const lookups=s.traces.filter(t=>t.action==='search');
  const times=lookups.map(t=>t.latency_ms).sort((a,b)=>a-b);
  const percentile=p=>times.length ? times[Math.ceil(times.length*p)-1]:null;
  const intake=s.traces.filter(t=>t.action==='process_event');
  const fallbacks=lookups.filter(t=>t.outcome!=='allowed').length;
  const experiments=['memory_enabled','memory_disabled'].map(mode=>{
    const rows=lookups.filter(t=>t.experiment===mode);
    return {mode,queries:rows.length,with_context:rows.filter(r=>r.used.length).length,
      repeated:rows.length-new Set(rows.map(r=>r.query_key)).size};
  });
  return {p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),queries:lookups.length,fallbacks,
    fallback_rate:lookups.length ? fallbacks/lookups.length:null,
    queued:s.inbox.filter(j=>j.status==='queued').length,dead:s.inbox.filter(j=>j.status==='dead_letter').map(j=>j.id),
    last_ingestion_lag_ms:intake.at(-1)?.lag_ms ?? null,
    pending_deletions:Object.values(s.jobs).filter(j=>j.status==='pending').length,experiments,
    positive_feedback:Object.values(s.feedback).filter(v=>v==='relevant').length,
    negative_feedback:Object.values(s.feedback).filter(v=>v==='irrelevant').length,
    counters:s.counters};
}
async function body(request) {
  ensure(request.headers.get('content-type')?.includes('application/json'),'expected_json',415);
  ensure(Number(request.headers.get('content-length') || 0)<=16384,'payload_too_large',413);
  const raw=await request.text();ensure(raw.length<=16384,'payload_too_large',413);
  let value;try {value=JSON.parse(raw);} catch {throw new Problem('invalid_json',422);}
  ensure(value && typeof value==='object' && !Array.isArray(value),'validation_error',422);
  return value;
}
async function rpc(msg, db, id, env, ctx) {
  const result=value=>json({jsonrpc:'2.0',id:msg.id,result:value});
  const error=(code,message)=>json({jsonrpc:'2.0',id:msg.id ?? null,error:{code,message}});
  if(msg.jsonrpc!=='2.0' || typeof msg.method!=='string') return error(-32600,'Invalid request');
  if(msg.id===undefined) return new Response(null,{status:202});
  if(msg.method==='initialize') return result({protocolVersion:protocol,capabilities:{tools:{listChanged:false}},serverInfo:{name:'listening-memory',version:'1.0.0'}});
  if(msg.method==='ping') return result({});
  if(msg.method==='tools/list') return result({tools:Object.entries(toolDefinitions).map(([name,t])=>({
    name,description:t.description,inputSchema:t.input,outputSchema:t.output}))});
  if(msg.method!=='tools/call') return error(-32601,'Method not found');
  const name=msg.params?.name,def=Object.hasOwn(toolDefinitions,name) && toolDefinitions[name];
  if(!def) return error(-32602,'Unknown tool');
  try {
    await limit(db,id+'/'+name,def.limit);
    const value=await callTool(name,msg.params.arguments,db,id,env,ctx);
    return result({structuredContent:value,content:[{type:'text',text:JSON.stringify(value)}],isError:false});
  } catch(e) {
    if(!(e instanceof Problem)) throw e;
    return result({isError:true,content:[{type:'text',text:e.message}]});
  }
}
export async function handle(request,env,ctx,asset) {
  const url=new URL(request.url), path=url.pathname.replace(/\/$/,'') || '/', method=request.method, db=env.DB;
  try {
    const origin=request.headers.get('Origin');
    ensure(!origin || origin===url.origin,'origin_not_allowed',403);
    if(path==='/health/live') return json({status:'up',schema_version:'1.0.0'});
    if(path==='/health/ready') {await db.prepare('SELECT id FROM workspaces LIMIT 1').first();return json({status:'ready'});}
    if(!path.startsWith('/v1/') && !path.startsWith('/demo/') && path!=='/mcp') return asset(path,method);
    const session=await sessionFor(request,db);
    if(path==='/demo/session' && method==='POST') {
      const b=await body(request);
      const token=await startSession(db,b.subject_id || 'U0001',session);
      return json({subject_id:b.subject_id || 'U0001',...(['cli','browser'].includes(b.client) ? {access_token:token}:{})},201,{
        'Set-Cookie':'lm_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'+(url.protocol==='https:'?'; Secure':'')});
    }
    ensure(session,'authentication_required',401);
    const id=session.workspace_id, subject=id.split('/').at(-1);
    await limit(db,id+'/api',240);
    if(path==='/mcp') {
      if(method==='GET' || method==='DELETE') return new Response(null,{status:405,headers:{Allow:'POST'}});
      ensure(method==='POST','method_not_allowed',405);
      const ver=request.headers.get('MCP-Protocol-Version');
      ensure(!ver || ver===protocol,'unsupported_protocol_version',400);
      return rpc(await body(request),db,id,env,ctx);
    }
    const b=['POST','PATCH','DELETE'].includes(method) ? await body(request):{};
    for(const k of ['subject_id','authenticated_subject_id','requested_subject_id']) {
      ensure((!Object.hasOwn(b,k) || b[k]===subject) && (!url.searchParams.has(k) || url.searchParams.get(k)===subject),'authorization_denied',403);
    }
    if(method==='GET') {
      if(path==='/v1/quality') return json(quality);
      if(path==='/v1/policy') return json({schema_version:'1.0.0',vector_model:vectorVersion,dimensions,
        policies:[...policy.values()],tools:Object.keys(toolDefinitions)});
      let s=(await readState(db,id)).state;
      if(s.inbox.some(j=>j.status==='queued') || Object.values(s.jobs).some(j=>j.status==='pending')) {
        await change(db,id,advance);s=(await readState(db,id)).state;
      }
      if(path==='/v1/dashboard') return json({user:s.user,profiles,at:clock(s),consent:s.consent,control:s.control,
        catalog:[...entities.values()].map(({entity_id,entity_type,canonical_name})=>({entity_id,entity_type,canonical_name})),
        metrics:metrics(s),traces:readable(s.traces),jobs:Object.values(s.jobs).slice(-12).reverse()});
      if(path==='/v1/memories') return json({memories:s.memories.filter(m=>!['expired','deletion_pending'].includes(m.status)).slice().reverse()});
      if(path==='/v1/export') return json({subject_id:subject,at:clock(s),memories:exportData(s,clock(s))});
      if(path.startsWith('/v1/deletions/')) {const job=Object.values(s.jobs).find(j=>j.job_id===path.split('/').at(-1));ensure(job,'job_not_found',404);return json(job);}
      if(path.startsWith('/v1/traces/')) {const t=s.traces.find(t=>t.trace_id===path.split('/').at(-1));ensure(t,'trace_not_found',404);return json(readable([t])[0]);}
      if(path.startsWith('/v1/events/')) {
        const key=path.split('/').at(-1), j=s.inbox.find(j=>j.id===key),receipt=Object.values(s.seen).find(r=>r.event_id===key);
        ensure(j || receipt,'event_not_found',404);return json({event_id:key,status:j?.status || 'processed',decision:receipt?.decision,reason:receipt?.reason,memory_ids:receipt?.memory_ids || []});
      }
    }
    if(path==='/v1/events' && method==='POST') {
      validateEvent(b,subject);
      const current=(await readState(db,id)).state;
      const prepared=await prepareEvent(b,current,env);
      const result=await change(db,id,s=>enqueue(s,prepared));
      if(result.status==='queued') schedule(ctx,change(db,id,advance));
      return json(result,result.status==='rejected' ? 403:202);
    }
    if(path==='/v1/memories/extract' && method==='POST') {
      const s=(await readState(db,id)).state;
      validateEvent(b,subject);return json(processEvent(s,await prepareEvent(b,s,env))); // A preview works on a private copy.
    }
    if(path==='/v1/context/compose' || path==='/v1/memories/search' || path==='/v1/respond') {
      ensure(method==='POST','method_not_allowed',405);
      const {experiment,simulate_dependency,...q}=b;
      ensure(experiment===undefined || ['memory_enabled','memory_disabled'].includes(experiment),'validation_error',422);
      ensure(!simulate_dependency || ['graph_timeout','vector_timeout','mcp_timeout'].includes(simulate_dependency),'validation_error',422);
      return json(await query(db,id,q,env,{mode:experiment,unavailable:simulate_dependency,generate:path==='/v1/respond'}));
    }
    let tool, args=b;
    if(path==='/v1/memories' && method==='POST') tool='add_explicit_preference';
    if(path==='/v1/explain' && method==='POST') tool='explain_memory_use';
    if(/^\/v1\/memories\/[^/]+$/.test(path) && ['DELETE','PATCH'].includes(method)) {
      tool=method==='PATCH'?'correct_memory':'delete_memory';args={...b,memory_id:path.split('/').at(-1)};
    }
    if(tool) {await limit(db,id+'/'+tool,toolDefinitions[tool].limit);return json(await callTool(tool,args,db,id,env,ctx));}
    if(path==='/v1/control' && method==='POST') return json(await change(db,id,s=>setControl(s,b.action)));
    if(path==='/v1/feedback' && method==='POST') return json(await change(db,id,s=>{
      recordFeedback(s,b.memory_id,b.trace_id,b.response_id,b.verdict);
      s.traces.push({trace_id:uid(),at:clock(s),action:'feedback',outcome:b.verdict,used:[],candidates:[],removals:[]});return ok('recorded');}));
    if(path==='/v1/replay' && method==='POST') {
      const result=await change(db,id,s=>{const j=s.inbox.find(j=>j.id===b.event_id && j.status==='dead_letter');
        ensure(j,'job_not_found',404);j.status='queued';j.attempts=0;return ok('queued');});
      schedule(ctx,change(db,id,advance));return json(result,202);
    }
    throw new Problem('route_not_found',404);
  } catch(e) {
    const status=e instanceof Problem ? e.status:503;
    if(status===503 && method==='POST' && (path==='/v1/respond' || path==='/v1/context/compose' || path==='/v1/memories/search')) {
      return json({schema_version:'1.0.0',mode:'no_memory',policy_outcome:'dependency_timeout',fallback_reason:'dependency_timeout',
        context:[],candidates:[],removals:[],token_estimate:0,trace_id:uid(),response_id:uid(),
        reply:{generator:'catalog_fallback',text:'Which artist would you like to explore?',used_ids:[]}});
    }
    return json({error:e instanceof Problem ? e.message:'dependency_unavailable'},status);
  }
}
