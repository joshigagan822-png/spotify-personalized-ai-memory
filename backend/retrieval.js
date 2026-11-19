import { DAY, cosine, entities, intentVector, mentioned, passed, policy, related, singerFor, surfaces, vectorVersion, words } from './catalog.js';
import { accessReason, ensure, exportData, textRisk } from './memory.js';

export function emptyPack(reason) {
  return {schema_version:'1.0.0', mode:'no_memory', policy_outcome:reason, fallback_reason:reason,
    candidates:[], context:[], removals:[], token_estimate:0};
}
const reasons={explicit_preference:'current_explicit_preference', exclusion:'explicit_exclusion',
  inferred_preference:'repeated_evidence', episode:'recent_session_context'};
export function allowedMemory(s,m,surface,at) {
  if (m.subject_id !== s.user.subject_id || Date.parse(m.valid_from)>Date.parse(at)) return 'outside_valid_time';
  if (m.status === 'deletion_pending') return 'deletion_pending';
  if (passed(m.expires_at,at) || m.status === 'expired') return 'expired';
  if (m.status === 'superseded' || passed(m.valid_to,at)) return 'superseded';
  const rule=policy.get(m.memory_type);
  if (!rule?.retrieval_allowed || m.confidence < rule.minimum_confidence) return 'confidence_below_threshold';
  if (!rule.eligible_surfaces.split('|').includes(surface) || (rule.original_surface_match_required && m.surface !== surface)) return 'outside_surface_scope';
  if (!m.source_event_ids.length || !m.normalized_fact || textRisk(m.normalized_fact)) return 'untrusted_content';
  return null;
}
function contextRow(m, reason, score) {
  const {memory_id,entity_id,normalized_fact,memory_type,predicate,confidence,valid_from,
    expires_at,source_class,source_event_ids,policy_id,seconds_played} = m;
  return {memory_id,entity_id,normalized_fact,memory_type,predicate,confidence,valid_from,expires_at,
    source_class,source_event_ids,policy_id,seconds_played,relevance_reason:reason,score:Number(score.toFixed(3))};
}
export function search(s, q, at, options={}) {
  if (options.requestedSubject && options.requestedSubject !== s.user.subject_id) return emptyPack('authorization_denied');
  const denied=accessReason(s);
  if (denied) return emptyPack(denied);
  if (options.exportOnly) return {...emptyPack(null),policy_outcome:'allowed',exported:exportData(s,at)};
  ensure(typeof q.utterance === 'string' && q.utterance.trim() && q.utterance.length <= 600 && surfaces.includes(q.surface),'validation_error',422);
  if ((options.mode || s.user.cohort) === 'memory_disabled') return emptyPack('experiment_disabled');
  if (options.untrusted || textRisk(q.utterance)) return emptyPack('untrusted_content');
  if (options.unavailable) return emptyPack('dependency_timeout');
  const maxItems=q.max_context_items ?? 3, budget=q.context_token_budget ?? 96;
  ensure(Number.isInteger(maxItems) && maxItems >= 1 && maxItems <= 3 &&
    Number.isInteger(budget) && budget >= 1 && budget <= 512,'validation_error',422);
  const ids=mentioned(q.utterance), queryVector=intentVector(q.utterance,ids);
  const singers=new Set(ids.map(singerFor).filter(Boolean));
  const resume=/\b(resume|unfinished|where i left)\b|अधूर|जहाँ छोड़ा/i.test(q.utterance);
  const general=/listen|recommend|next|play|songs?|music|podcast|episode|mix|discover|explore|suggest|sunao|gaane|bajao|गान|सुन|पॉडकास्ट/i.test(q.utterance);
  const candidates=[], removals=[];
  const excluded=new Set(s.memories.filter(m=>m.predicate==='EXCLUDES' && !allowedMemory(s,m,q.surface,at))
    .map(m=>singerFor(m.entity_id) || m.entity_id));
  for (const m of s.memories) {
    let why=allowedMemory(s,m,q.surface,at);
    if (!why && m.predicate!=='EXCLUDES' && excluded.has(singerFor(m.entity_id) || m.entity_id)) why='explicit_exclusion';
    if (!why && resume && m.predicate !== 'IN_PROGRESS') why='not_resumable';
    if (why) {removals.push({memory_id:m.memory_id,reason:why}); continue;}
    const vector=s.vectors[m.memory_id];
    if (!vector || vector.model_version !== vectorVersion || vector.graph_version !== m.graph_version) return emptyPack('dependency_timeout');
    const links=related(m.entity_id);
    const linked=ids.some(id => links.has(id)) || singers.has(singerFor(m.entity_id));
    const similarity=cosine(queryVector,vector.values);
    // When the listener names a singer, similar words like "music of" cannot
    // bring in a different singer. General requests can reuse the active surface.
    if ((singers.size && singerFor(m.entity_id) && !singers.has(singerFor(m.entity_id))) || (ids.length && !linked && similarity < .62) || (!ids.length && !general && !resume && similarity < .32)) {
      removals.push({memory_id:m.memory_id,reason:'different_intent'}); continue;
    }
    const explicit=m.source_class === 'explicit_user' ? 1:0;
    const age=Math.max(0,(Date.parse(at)-Date.parse(m.valid_from))/DAY);
    const negative=s.feedback[m.memory_id] === 'irrelevant';
    const score=.30*Number(linked)+.22*similarity+.22*explicit+.14*m.confidence+
      .07/(1+age/14)+.05*Math.min(m.evidence_sessions/3,1)+(m.predicate === 'EXCLUDES' ? .10:0)-(negative ? .35:0);
    const reason=resume ? 'unfinished_episode_progress':m.predicate === 'COMPLETED' ? 'recent_completed_item':reasons[m.memory_type];
    candidates.push(contextRow(m,reason,score));
  }
  candidates.sort((a,b) => b.score-a.score || b.valid_from.localeCompare(a.valid_from) || a.memory_id.localeCompare(b.memory_id));
  if (!candidates.length) {
    const job=Object.values(s.jobs).at(-1);
    const block=Object.keys(s.flags).find(k => !passed(s.flags[k],at));
    const why=block || removals[0]?.reason || (job ? (job.status === 'pending' ? 'deletion_pending':'deleted'):'insufficient_history');
    return {...emptyPack(why),removals};
  }
  const context=[], groups=new Map();
  let tokens=0;
  for (const m of candidates.slice(0,24)) {
    // Workbook budget is an estimate: fact words, source IDs, and 12 units for metadata.
    const cost=12+m.normalized_fact.trim().split(/\s+/).length+m.source_event_ids.length;
    const cluster=singerFor(m.entity_id) || m.entity_id;
    const reject=s.feedback[m.memory_id] === 'irrelevant' ? 'negative_feedback':
      (context.length >= maxItems || tokens + cost > budget) ? 'context_budget':
      (groups.get(cluster) || 0) >= 2 ? 'diversity_limit':null;
    if (reject) removals.push({memory_id:m.memory_id,reason:reject});
    else {context.push(m); tokens+=cost; groups.set(cluster,(groups.get(cluster)||0)+1);}
  }
  const why=context.length ? null:removals.at(-1)?.reason || 'insufficient_history';
  return {schema_version:'1.0.0',mode:context.length ? 'personalized':'no_memory',policy_outcome:why || 'allowed',
    fallback_reason:why,candidates:candidates.slice(0,24),context,removals,token_estimate:tokens};
}
