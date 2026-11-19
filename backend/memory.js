import { entities, memoryVector, vectorVersion, dimensions, resolve, mentioned, policy, plusDays, passed, surfaces, split } from './catalog.js';

export class Problem extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
export const ensure = (ok, code, status) => { if (!ok) throw new Problem(code, status); };
export const controls = new Set(['opt_out','pause_memory','resume_memory','delete_memory','export_memory']);
const product = ['save','follow','skip','playback'];
const eventTypes = [...controls, ...product, 'explicit_preference','exclusion','correction','relevance_feedback','ai_interaction'];
const current = (m, at) => !passed(m.expires_at, at) && ['active','candidate'].includes(m.status);
export const active = (s, at) => s.memories.filter(m => m.status === 'active' && current(m, at));
export const byId = (s, id) => s.memories.find(m => m.memory_id === id);

export function newState(user) {
  return { user, control:'active', consent:user.initial_consent, sequence:0, memories:[], vectors:{},
    evidence:{}, seen:{}, inbox:[], jobs:{}, traces:[], feedback:{}, flags:{}, counters:{}, cache:{}, clock:null };
}
export function count(s, key) { s.counters[key] = (s.counters[key] || 0) + 1; }
export function accessReason(s) {
  if (s.consent !== 'granted') return 'consent_revoked';
  if (s.control === 'paused') return 'memory_paused';
  if (!split(policy.get('explicit_preference').eligible_age_bands).includes(s.user.age_band)) return 'protected_age_band';
  if (!split(policy.get('explicit_preference').eligible_markets).includes(s.user.market)) return 'outside_pilot_market';
  return null;
}
export const textRisk = (text, payload = {}) => {
  if (payload.fixture_class || /untrusted_fixture|treat.{0,20}as.{0,12}instruction|ignore.{0,20}instruction/i.test(text || '')) return 'untrusted_content';
  if (/only for today.{0,35}comfort|\b(depressed|depression|diagnos\w*|my religion|my ethnicity)\b/i.test(text || '')) return 'sensitive_inference_blocked';
  return null;
};
export function validateEvent(e, subject) {
  ensure(e && typeof e === 'object' && !Array.isArray(e), 'validation_error', 422);
  const fields=['contract_version','event_id','source_event_id','idempotency_key','session_id','locale','market','event_at','received_at','raw_expires_at','subject_id','authenticated_subject_id','surface','event_type','source_class','consent_state','utterance','entity_reference','target_memory_id','payload'];
  ensure(Object.keys(e).every(key=>fields.includes(key)),'validation_error',422);
  ensure(e.authenticated_subject_id, 'authentication_required', 401);
  ensure(e.authenticated_subject_id === subject && e.subject_id === subject, 'authorization_denied', 403);
  ensure(e.contract_version === '1.0.0', 'unsupported_contract_version', 422);
  for (const field of ['event_id','source_event_id','idempotency_key','session_id','locale','market']) {
    ensure(typeof e[field] === 'string' && /^[\w.:-]{1,100}$/.test(e[field]) && !['__proto__','prototype','constructor'].includes(e[field]), 'validation_error', 422);
  }
  for (const field of ['event_at','received_at','raw_expires_at']) {
    ensure(typeof e[field] === 'string' && /^\d{4}-\d\d-\d\dT.+Z$/.test(e[field]) && Number.isFinite(Date.parse(e[field])), 'validation_error', 422);
  }
  ensure((surfaces.includes(e.surface) || (e.surface === 'memory_controls' && controls.has(e.event_type))) && eventTypes.includes(e.event_type), 'validation_error', 422);
  ensure(['granted','revoked'].includes(e.consent_state), 'validation_error', 422);
  ensure((e.event_type === 'ai_interaction' && e.source_class === 'product_signal') || e.source_class === (product.includes(e.event_type) ? 'product_signal' : 'explicit_user'), 'source_not_eligible', 422);
  ensure(e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload), 'validation_error', 422);
  for (const key of ['utterance','entity_reference','target_memory_id']) {
    ensure(e[key] === null || (typeof e[key] === 'string' && e[key].length <= 600), 'validation_error', 422);
  }
  const p = e.payload;
  ensure(Object.keys(p).every(key=>['completion_fraction','scope','seconds_played','fixture_class','new_state','signal','interaction_count','verdict','response_id','trace_id'].includes(key)), 'validation_error',422);
  for(const [key,value] of Object.entries(p)) {
    if(!['completion_fraction','seconds_played','interaction_count'].includes(key)) ensure(typeof value==='string' && value.length<=110,'validation_error',422);
  }
  if(p.interaction_count!=null) ensure(Number.isInteger(p.interaction_count) && p.interaction_count>0,'validation_error',422);
  if (p.completion_fraction != null) ensure(Number.isFinite(p.completion_fraction) && p.completion_fraction >= 0 && p.completion_fraction <= 1, 'validation_error', 422);
  if (p.seconds_played != null) ensure(Number.isInteger(p.seconds_played) && p.seconds_played >= 0, 'validation_error', 422);
}
function factText(type, predicate, name, seconds) {
  if (type === 'candidate_preference') return 'Repeated activity suggests an interest in ' + name + '.';
  if (predicate === 'EXCLUDES') return 'Exclude ' + name + ' from recommendations.';
  if (predicate === 'PLAYED') return 'Played ' + name + ' in a recent session.';
  if (predicate === 'COMPLETED') return 'Finished ' + name + '.';
  if (predicate === 'IN_PROGRESS') return 'Listened to ' + seconds + ' seconds of ' + name + '.';
  return 'Prefers ' + name + '.';
}
function addFact(s,e,id,type,predicate,confidence,sources=[e.event_id],sessions=[e.session_id]) {
  const rule = policy.get(type);
  ensure(rule && split(rule.eligible_sources).includes(e.source_class), 'source_not_eligible');
  const memory_id = 'M' + s.user.subject_id.slice(1) + '-' + String(++s.sequence).padStart(2,'0');
  const m = { memory_id, subject_id:s.user.subject_id, graph_version:1, schema_version:'1.0.0',
    entity_id:id, predicate, memory_type:type, polarity:predicate === 'EXCLUDES' ? 'negative':'positive',
    normalized_fact:factText(type,predicate,entities.get(id).canonical_name,e.payload.seconds_played),
    surface:e.surface, activity_id:null, valid_from:e.event_at, valid_to:null, recorded_at:e.received_at,
    expires_at:plusDays(e.event_at,rule.fact_retention_days), status:type === 'candidate_preference' ? 'candidate':'active',
    source_event_ids:[...sources], source_class:e.source_class, confidence, policy_id:rule.policy_id,
    evidence_sessions:[...new Set(sessions)].length, supersedes_memory_id:null, superseded_by_memory_id:null,
    seconds_played:predicate === 'IN_PROGRESS' ? e.payload.seconds_played:null };
  s.memories.push(m);
  if (rule.embedding_allowed && confidence >= rule.minimum_confidence) {
    s.vectors[memory_id] = { memory_id, subject_id:s.user.subject_id, graph_version:1, model_version:vectorVersion,
      text_field_version:'1.0.0', dimensions, indexed_at:e.received_at, expires_at:m.expires_at, values:memoryVector(m) };
  }
  count(s, 'graph_writes');
  return m;
}
function supersede(s, previous, next, at) {
  previous.status = 'superseded'; previous.valid_to = at; previous.graph_version++;
  previous.superseded_by_memory_id = next.memory_id; next.supersedes_memory_id = previous.memory_id;
  delete s.vectors[previous.memory_id];
}
function addSupport(s,m,e) {
  if (!m.source_event_ids.includes(e.event_id)) m.source_event_ids.push(e.event_id);
  m.graph_version++;
  if (s.vectors[m.memory_id]) s.vectors[m.memory_id].graph_version = m.graph_version;
}
function decision(classification, decision, reason, id, m) {
  return {classification, decision, reason, resolved_entity_ids:id ? [id]:[], memory_ids:m ? [m.memory_id]:[]};
}
function remember(s,e,id) {
  const kind=e.event_type;
  if (kind === 'playback') {
    const episode = entities.get(id).entity_type === 'episode';
    const done = (e.payload.completion_fraction || 0) >= .90;
    const predicate = episode && done ? 'COMPLETED' : episode && e.payload.seconds_played > 0 ? 'IN_PROGRESS':'PLAYED';
    const old = active(s,e.event_at).find(m => m.entity_id === id && m.predicate === 'IN_PROGRESS' && m.surface === e.surface);
    const m = addFact(s,e,id,'episode',predicate,.86);
    if (old) supersede(s,old,m,e.event_at);
    return decision('episode','write','episodic_only',id,m);
  }
  if (kind === 'save' || kind === 'follow') {
    const key = e.surface + '/' + id;
    let signal = s.evidence[key];
    if (!signal || passed(signal.expires_at,e.event_at)) signal = s.evidence[key] = {sessions:{}, events:[], expires_at:plusDays(e.event_at,14)};
    const previous = s.memories.find(m => m.entity_id === id && m.surface === e.surface && current(m,e.event_at) &&
      ['candidate_preference','inferred_preference'].includes(m.memory_type));
    if (signal.sessions[e.session_id]) return decision(previous?.memory_type || 'candidate_preference','no_write','same_session',id,previous);
    signal.sessions[e.session_id] = true; signal.events.push(e.event_id);
    if (previous?.memory_type === 'inferred_preference') {
      previous.evidence_sessions++;
      return decision('inferred_preference','no_write','existing_fact_support',id,previous);
    }
    if (!previous) {
      const m = addFact(s,e,id,'candidate_preference','MAY_PREFER',.49);
      return decision('candidate_preference','graph_only','insufficient_independent_sessions',id,m);
    }
    if (signal.events.length < 3) return decision('candidate_preference','no_write','support_accumulated',id);
    const m = addFact(s,e,id,'inferred_preference','PREFERS',.83,signal.events,Object.keys(signal.sessions));
    supersede(s,previous,m,e.event_at);
    return decision('inferred_preference','write','three_independent_sessions',id,m);
  }
  let old = null;
  if (kind === 'correction') {
    old = byId(s,e.target_memory_id);
    ensure(old && old.status === 'active' && current(old,e.event_at), 'memory_not_found',404);
    ensure(['explicit_preference','exclusion','inferred_preference'].includes(old.memory_type),'unsupported_correction',422);
  }
  const negative = kind === 'exclusion' || (old?.polarity === 'negative' && kind === 'correction');
  const type = negative ? 'exclusion':'explicit_preference';
  const matches = active(s,e.event_at).filter(m => m.surface === e.surface && m.entity_id === id && m.memory_type !== 'episode');
  const match = matches.find(m => m.memory_type === type);
  if (!old && match) {
    addSupport(s,match,e);
    return decision(type,'deduplicate','canonical_alias_equivalence',id,match);
  }
  const m = addFact(s,e,id,type,negative ? 'EXCLUDES':'PREFERS',kind === 'correction' ? .99:.95);
  // Explicit contradictions invalidate the older edge in the same surface.
  for (const other of new Set([old, ...matches].filter(Boolean))) supersede(s,other,m,e.event_at);
  return decision(kind === 'correction' ? kind:type,old ? 'supersede':'write',old ? 'explicit_correction':'explicit_user_choice',id,m);
}

export function requestDelete(s,id,at) {
  const m=byId(s,id);
  ensure(m,'memory_not_found',404);
  const earlier=Object.values(s.jobs).find(j => j.memory_id === id);
  if (earlier) return earlier;
  m.status='deletion_pending'; m.valid_to=at; delete s.vectors[id]; s.cache={};
  const job={job_id:crypto.randomUUID(), memory_id:id, status:'pending', requested_at:at,
    graph:'queued', vector:'removed', cache:'invalidated', operational_metadata:'queued',
    backup_policy:'restricted_until_rotation', backup_expiry_at:plusDays(at,30), completed_at:null};
  s.jobs[job.job_id]=job;
  return job;
}
export function finishDelete(s,job,at) {
  if (job.status === 'completed') return job;
  const m=byId(s,job.memory_id);
  if (m) {
    delete s.evidence[m.surface + '/' + m.entity_id];
    s.memories = s.memories.filter(row => row.memory_id !== m.memory_id);
    for (const row of s.memories) {
      if (row.supersedes_memory_id === m.memory_id) row.supersedes_memory_id=null;
      if (row.superseded_by_memory_id === m.memory_id) row.superseded_by_memory_id=null;
    }
  }
  delete s.vectors[job.memory_id]; delete s.feedback[job.memory_id]; s.cache={};
  for (const trace of s.traces) {
    trace.used = trace.used.filter(id => id !== job.memory_id);
    trace.candidates = (trace.candidates || []).filter(x => x.memory_id !== job.memory_id);
    trace.removals = (trace.removals || []).filter(x => x.memory_id !== job.memory_id);
  }
  for (const r of Object.values(s.seen)) {
    if (r.memory_ids?.includes(job.memory_id)) { r.memory_ids=[]; r.resolved_entity_ids=[]; }
  }
  Object.assign(job,{status:'completed',graph:'removed',vector:'removed',operational_metadata:'redacted',completed_at:at});
  return job;
}
export function recordFeedback(s,memoryId,traceId,responseId,verdict) {
  const trace=s.traces.find(t => t.trace_id === traceId && t.response_id === responseId && t.used.includes(memoryId));
  ensure(trace && byId(s,memoryId),'feedback_reference_not_found',404);
  ensure(['irrelevant','relevant'].includes(verdict),'validation_error',422);
  s.feedback[memoryId]=verdict; s.cache={};
}
export function processEvent(s,e) {
  validateEvent(e,s.user.subject_id);
  const id = resolve(e.entity_reference) || (!e.entity_reference && mentioned(e.utterance)[0]);
  const key = e.idempotency_key;
  if (Object.hasOwn(s.seen,key)) return decision('non_memory','no_write','idempotent_duplicate',id);
  const kind=e.event_type;
  let result;
  const risk=textRisk(e.utterance,e.payload);
  const denied=accessReason(s) || (e.consent_state !== 'granted' ? 'consent_revoked':null);
  if (controls.has(kind)) {
    if (kind === 'pause_memory' && s.consent === 'granted') s.control='paused';
    if (kind === 'resume_memory' && s.consent === 'granted') s.control='active';
    if (kind === 'opt_out') {s.control='opted_out'; s.consent='revoked'; s.inbox=[];}
    if (kind === 'delete_memory') requestDelete(s,e.target_memory_id,e.event_at);
    result=decision('non_memory',kind === 'export_memory' ? 'no_write':'control_update',
      ({opt_out:'revoked_consent',resume_memory:'memory_resumed',delete_memory:'delete_pending',export_memory:'subject_export'})[kind] || kind,null);
    if (kind === 'delete_memory') result.memory_ids=[e.target_memory_id];
  } else if (risk || denied) {
    const reason=denied || risk;
    if (risk) s.flags[risk]=plusDays(e.event_at,30);
    count(s,'blocked.'+reason);
    result=decision(risk === 'sensitive_inference_blocked' ? 'inferred_emotional_state':kind === 'ai_interaction' ? 'non_memory':kind,'blocked',reason,id);
  } else if (kind === 'relevance_feedback') {
    recordFeedback(s,e.target_memory_id,e.payload.trace_id,e.payload.response_id,e.payload.verdict);
    result=decision('non_memory','no_write','negative_feedback_rerank',null,byId(s,e.target_memory_id));
  } else if (kind === 'ai_interaction' || kind === 'skip') {
    result=decision('non_memory','no_write',kind === 'skip' ? 'one_skip_does_not_override_explicit':'no_durable_evidence',id && kind === 'skip' ? id:null);
  } else if (!id) {
    result=decision('non_memory','blocked','unknown_entity',null);
  } else {
    result=remember(s,e,id);
  }
  s.cache={};
  s.seen[key]={...result,source_event_id:e.source_event_id,event_id:e.event_id,at:e.event_at};
  return result;
}
export function purge(s,at) {
  for (const m of s.memories) if (passed(m.expires_at,at) && ['candidate','active','superseded'].includes(m.status)) {
    m.status='expired'; m.valid_to ||= m.expires_at; m.normalized_fact=null;
    delete s.vectors[m.memory_id]; delete s.evidence[m.surface+'/'+m.entity_id];
    m.entity_id=null; m.seconds_played=null; m.source_event_ids=[]; s.cache={};
  }
  for (const [key, v] of Object.entries(s.flags)) if (passed(v,at)) delete s.flags[key];
  for (const [key, v] of Object.entries(s.seen)) if (passed(plusDays(v.at,120),at)) delete s.seen[key];
  for (const [key,v] of Object.entries(s.calls||{})) if(passed(plusDays(v.at,30),at)) delete s.calls[key];
  s.inbox=s.inbox.filter(job => !passed(job.event.raw_expires_at,at));
  s.traces=s.traces.filter(t => !passed(plusDays(t.at,30),at)).slice(-150);
}
export function exportData(s,at) {
  return active(s,at).map(({memory_id,normalized_fact,valid_from,expires_at,source_class,source_event_ids}) =>
    ({memory_id,normalized_fact,valid_from,expires_at,source_class,source_event_ids}));
}
