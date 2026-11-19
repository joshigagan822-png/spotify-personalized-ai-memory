import { entities, plusDays, resolve } from './catalog.js';
import { accessReason, active, byId, count, controls, ensure, finishDelete, Problem, processEvent, recordFeedback, requestDelete, textRisk, validateEvent } from './memory.js';
import { search, emptyPack } from './retrieval.js';
import { reply } from './reply.js';
import { change, clock, readState } from './store.js';
import { toolDefinitions, validate } from './contracts.js';

export const uid=()=>crypto.randomUUID();
function audit(s,action,outcome,extra={}) {
  const t={trace_id:uid(),at:clock(s),action,outcome,used:[],candidates:[],removals:[],...extra};
  s.traces.push(t);
  return t;
}
function liveEvent(s,kind,surface,key,fields={}) {
  const at=clock(s), id=uid();
  return {contract_version:'1.0.0',event_id:id,source_event_id:'ui-'+id,idempotency_key:key,
    session_id:'live-'+s.user.subject_id,subject_id:s.user.subject_id,authenticated_subject_id:s.user.subject_id,
    surface,locale:s.user.locale,market:s.user.market,event_at:at,received_at:at,raw_expires_at:plusDays(at,30),
    event_type:kind,consent_state:s.consent,source_class:'explicit_user',entity_reference:null,utterance:null,target_memory_id:null,payload:{},...fields};
}
export function schedule(ctx,task) {
  // The receipt remains in the database even if the request worker stops.
  ctx.waitUntil(task.catch(()=>{}));
}
export function advance(s) {
  const at=clock(s);
  const due=s.inbox.filter(j=>j.status==='queued').slice(0,20);
  for(const j of due) {
    try {
      const result=processEvent(s,j.event);
      audit(s,'process_event',result.reason,{stages:['extract','policy','graph','vector'],lag_ms:Math.max(0,Date.now()-j.queued_ms)});
      s.inbox=s.inbox.filter(row=>row.id!==j.id);
    } catch(error) {
      j.attempts++;
      if(j.attempts>=3 || error instanceof Problem) j.status='dead_letter';
      count(s,'write_failures');audit(s,'process_event',j.status);
    }
  }
  for(const job of Object.values(s.jobs).filter(j=>j.status==='pending')) {
    finishDelete(s,job,at);audit(s,'deletion','completed');
  }
}
export function enqueue(s,e) {
  validateEvent(e,s.user.subject_id);
  ensure(e.market===s.user.market && e.consent_state===s.consent,'policy_metadata_mismatch',403);
  ensure(Date.parse(e.raw_expires_at)>Date.parse(clock(s)) && Date.parse(e.event_at)<=Date.parse(clock(s))+60000,'invalid_event_time',422);
  // The live API has a single current timeline. Historical imports use replay().
  ensure(Math.abs(Date.parse(clock(s))-Date.parse(e.event_at))<=300000,'stale_event',422);
  const seen=s.seen[e.idempotency_key];
  const old=s.inbox.find(j=>j.event.idempotency_key===e.idempotency_key);
  if(seen || old) return {event_id:seen?.event_id || old.id,status:'duplicate'};
  const denied=accessReason(s);
  const risk=textRisk(e.utterance,e.payload);
  if(!controls.has(e.event_type) && (denied || risk)) {
    count(s,'blocked.'+(denied||risk));audit(s,'intake',denied||risk);
    return {event_id:e.event_id,status:'rejected',reason:denied||risk};
  }
  if(controls.has(e.event_type)) {
    advance(s);processEvent(s,e);audit(s,'intake',e.event_type);
    return {event_id:e.event_id,status:'processed'};
  }
  ensure(s.inbox.length<100,'queue_full',503);
  // Persist only the normalized catalog reference and the supported signal fields.
  const payload=Object.fromEntries(Object.entries(e.payload).filter(([k])=>
    ['seconds_played','completion_fraction','scope','signal','interaction_count','verdict','response_id','trace_id'].includes(k)));
  s.inbox.push({id:e.event_id,status:'queued',attempts:0,queued_ms:Date.now(),event:{...e,utterance:null,
    entity_reference:resolve(e.entity_reference) || null,payload,raw_expires_at:plusDays(e.received_at,30)}});
  audit(s,'intake','queued');return {event_id:e.event_id,status:'queued'};
}
async function hashKey(data) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function query(db,workspace,q,env,options={}) {
  validate(toolDefinitions.search_memory.input,q);
  const start=performance.now();
  const key=await hashKey([q,options.mode || '',options.unavailable || '']);
  let out;
  try {
    out=await change(db,workspace,s=>{
      advance(s);
      const at=clock(s);
      const cached=s.cache[key];
      const hit=Boolean(cached && Date.parse(cached.until)>Date.parse(at));
      let pack=hit ? cached.pack:search(s,q,at,options);
      let elapsed=performance.now()-start;
      if(elapsed>250) pack=emptyPack('dependency_timeout');
      if(hit) count(s,'cache_hits'); else count(s,'cache_misses');
      if(pack.context.length && !hit) {
        if(Object.keys(s.cache).length>=20) s.cache={};
        const expires=Math.min(Date.parse(at)+15000,...pack.context.map(m=>Date.parse(m.expires_at)));
        s.cache[key]={until:new Date(expires).toISOString(),pack};
      }
      const trace=audit(s,'search',pack.policy_outcome,{response_id:uid(),used:pack.context.map(m=>m.memory_id),
        candidates:pack.candidates.map(({memory_id,score,relevance_reason})=>({memory_id,score,relevance_reason})),
        removals:pack.removals,latency_ms:Number(elapsed.toFixed(2)),cache_hit:hit,token_estimate:pack.token_estimate,
        experiment:options.mode || s.user.cohort,query_key:key,stages:['scope','graph','vector','rank','policy','compose']});
      return {...pack,trace_id:trace.trace_id,response_id:trace.response_id};
    });
  } catch(error) {
    if(error instanceof Problem && error.status<500) throw error;
    out={...emptyPack('dependency_timeout'),trace_id:uid(),response_id:uid()};
  }
  if(options.generate) {
    const answer=await reply(out,q,env);
    // Re-check the trace after a network model call. A correction or deletion may
    // have arrived while the provider was running.
    if(answer.generator==='ollama' || answer.generator==='catalog_fallback') {
      const fresh=(await readState(db,workspace)).state;
      const check=search(fresh,q,clock(fresh),options);
      if(out.context.map(m=>m.memory_id).join()!==check.context.map(m=>m.memory_id).join()) {
        const safe=emptyPack('memory_changed');
        return {...safe,trace_id:out.trace_id,response_id:out.response_id,reply:await reply(safe,q,{})};
      }
    }
    out.reply=answer;
  }
  return out;
}

export async function callTool(name,args,db,workspace,env,ctx) {
  const def=Object.hasOwn(toolDefinitions,name) ? toolDefinitions[name]:null;
  ensure(def,'unknown_tool',404);validate(def.input,args);
  if(name==='search_memory') {
    const {trace_id,context,fallback_reason}=await query(db,workspace,args,env);
    return {trace_id,context,fallback_reason};
  }
  const fingerprint=await hashKey([name,Object.fromEntries(Object.entries(args).sort())]);
  const out=await change(db,workspace,s=>{
    if(name==='explain_memory_use') {
      const trace=s.traces.find(t=>t.trace_id===args.trace_id && t.used.includes(args.memory_id));
      const m=active(s,clock(s)).find(m=>m.memory_id===args.memory_id);
      ensure(trace && m && !accessReason(s),'memory_not_found',404);
      const candidate=trace.candidates.find(c=>c.memory_id===m.memory_id);
      audit(s,name,'allowed');return {memory_id:m.memory_id,relevance_reason:candidate.relevance_reason,
        source_event_ids:m.source_event_ids,policy_id:m.policy_id,confidence:m.confidence};
    }
    const key=args.idempotency_key;
    ensure(!['__proto__','constructor','prototype'].includes(key),'validation_error',422);
    s.calls ||= {};
    const prior=Object.hasOwn(s.calls,key) ? s.calls[key]:null;
    if(prior) {ensure(prior.fingerprint===fingerprint,'idempotency_conflict',409);return prior.out;}
    advance(s);
    const m=args.memory_id ? byId(s,args.memory_id):null;
    if(args.memory_id) ensure(m,'memory_not_found',404);
    const t=audit(s,name,'allowed');
    let result;
    if(name==='delete_memory') {
      const job=requestDelete(s,m.memory_id,clock(s));
      result={job_id:job.job_id,status:job.status,policy_id:m.policy_id,trace_id:t.trace_id};
    } else {
      ensure(!accessReason(s),accessReason(s),403);
      const id=args.replacement_entity_id || args.entity_id;
      ensure(entities.has(id),'unknown_entity',422);
      if(m) ensure(m.graph_version===args.expected_graph_version,'version_conflict',409);
      const e=liveEvent(s,m ? 'correction':args.polarity==='negative' ? 'exclusion':'explicit_preference',m?.surface || args.surface,key,
        {entity_reference:id,target_memory_id:m?.memory_id || null});
      ensure(!Object.hasOwn(s.seen,key),'idempotency_conflict',409);
      const d=processEvent(s,e), fact=byId(s,d.memory_ids[0]);
      result={memory_id:fact.memory_id,policy_id:fact.policy_id,source_event_id:e.source_event_id,trace_id:t.trace_id,
        ...(m ? {supersedes_memory_id:m.memory_id}:{graph_version:fact.graph_version})};
    }
    s.calls[key]={fingerprint,out:result,at:clock(s)};
    return result;
  });
  validate(def.output,out);
  if(name==='delete_memory') schedule(ctx,change(db,workspace,advance));
  return out;
}
export function setControl(s,action) {
  advance(s);
  if(action==='opt_in') {s.consent='granted';s.control='active';s.cache={};}
  else {
    ensure(['pause_memory','resume_memory','opt_out'].includes(action),'unsupported_control',422);
    ensure(action!=='resume_memory' || s.consent==='granted','consent_revoked',409);
    processEvent(s,liveEvent(s,action,'memory_controls',uid()));
  }
  audit(s,'consent',action);return {control:s.control,consent:s.consent};
}
