import fs from 'node:fs';
import { replay } from '../backend/replay.js';
import { search } from '../backend/retrieval.js';
import { split } from '../backend/catalog.js';
import { validateEvent, processEvent } from '../backend/memory.js';
import users from '../data/users.json' with {type:'json'};
import events from '../data/events.json' with {type:'json'};
import fixtures from '../tests/fixtures.json' with {type:'json'};

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const receipts=events.filter(e=>e.event_type==='relevance_feedback').map(e=>({
  subject_id:e.subject_id,trace_id:e.payload.trace_id,response_id:e.payload.response_id,used:[e.target_memory_id]}));
const cases=[], probes=[];
let truePositives=0, returned=0, relevant=0, prohibited=0, metadataMatch=0, fieldsCompared=0, exactConfidence=0;
let resolutionHits=0, resolutionCount=0, extractionHits=0, extractionCount=0, graphMatches=0, graphCount=0;
for (const row of fixtures.cases) {
  const at=row.query_query_at;
  const user=users.find(u=>u.subject_id===row.subject_id);
  const {state,decisions}=replay(user,events,at,{deletions:fixtures.deletions,feedbackReceipts:receipts});
  // An export is the query itself. Prior history must already have arrived.
  const incoming=events.find(e=>e.subject_id===user.subject_id && e.event_type==='export_memory' && e.event_at===at);
  if(incoming && !decisions[incoming.event_id]) decisions[incoming.event_id]=processEvent(state,incoming);
  const q={utterance:row.query_utterance,surface:row.query_surface,locale:row.query_locale,
    max_context_items:row.query_max_context_items,context_token_budget:row.query_context_token_budget};
  const pack=search(state,q,at,{mode:row.query_evaluation_mode,requestedSubject:row.query_requested_subject_id,
    unavailable:row.query_simulate_dependency,untrusted:row.untrusted_retrieval_fixture_trusted === false,
    exportOnly:/^export\b/i.test(q.utterance)});
  const actual=pack.context.map(m=>m.memory_id), wanted=split(row.expected_context_ids);
  const ranked=pack.candidates.map(m=>m.memory_id);
  const results={rank:equal(ranked,split(row.expected_ranked_candidate_ids)),context:equal(actual,wanted),
    policy:pack.policy_outcome===row.expected_policy_outcome,fallback:pack.fallback_reason===row.expected_fallback_reason,
    control:state.control===row.expected_control_state && state.consent===row.expected_consent,
    mode:pack.mode===row.expected_context_mode,tokens:row.expected_context_fixture_token_count===null ||
      pack.token_estimate===row.expected_context_fixture_token_count};
  if (row.expected_deletion_status) results.deletion=Object.values(state.jobs).some(j=>j.status===row.expected_deletion_status);
  if (row.expected_export_memory_ids) results.export=equal(pack.exported?.map(m=>m.memory_id),split(row.expected_export_memory_ids));
  if (row.scenario==='resume_unfinished_episode') results.position=pack.context[0]?.seconds_played===420;
  const relevantIds=new Set(split(row.expected_ranked_candidate_ids));
  const top=ranked.slice(0,row.grading_precision_k);
  truePositives+=top.filter(id=>relevantIds.has(id)).length; returned+=top.length; relevant+=relevantIds.size;
  const detail=name=>fixtures.checks[name].filter(c=>c.case_id===row.case_id);
  prohibited+=detail('Golden Prohibited').filter(p=>actual.includes(p.memory_id)).length;
  for (const expected of detail('Golden Details')) {
    const got=pack.context.find(m=>m.memory_id===expected.memory_id);
    const fields=['normalized_fact','memory_type','valid_from','source_class','relevance_reason'];
    fieldsCompared++;
    if(got && fields.every(f=>got[f]===expected[f]) && equal(got.source_event_ids,split(expected.source_event_ids))) metadataMatch++;
    if(got?.confidence===expected.confidence) exactConfidence++;
  }
  for (const check of detail('Golden Extractions')) {
    const d=decisions[check.event_id];
    extractionCount++; if(d?.classification===check.classification && d.decision===check.decision) extractionHits++;
    if(check.resolved_entity_ids) {resolutionCount++; if(equal(d?.resolved_entity_ids,split(check.resolved_entity_ids))) resolutionHits++;}
  }
  for (const check of detail('Golden Graph')) {
    graphCount++;
    const m=state.memories.find(m=>m.memory_id===check.memory_id);
    if (check.status==='deleted' && !m && Object.values(state.jobs).some(j=>j.memory_id===check.memory_id && j.status==='completed')) graphMatches++;
    else if (m && m.status===check.status && m.predicate===check.predicate && m.memory_type===check.memory_type &&
      m.valid_from===check.valid_from && Date.parse(m.expires_at)===Date.parse(check.expires_at) &&
      (m.status==='expired' || (m.entity_id===check.entity_id && equal(m.source_event_ids,split(check.source_event_ids))))) graphMatches++;
  }
  for(const probe of detail('Golden Validation Probes')) {
    const e={...events.find(e=>e.event_id===probe.base_event_id)};
    if(probe.override_contract_version) e.contract_version=probe.override_contract_version;
    if(probe.override_event_at) e.event_at=probe.override_event_at;
    if(probe.override_authenticated_subject_id) e.authenticated_subject_id=null;
    let code='accepted';try{validateEvent(e,user.subject_id);}catch(error){code=error.message;}
    probes.push(code===probe.expected_error);
  }
  cases.push({case_id:row.case_id,scenario:row.scenario,subject:row.subject_id,passed:Object.values(results).every(Boolean),
    checks:results,expected_context:wanted,actual_context:actual,mode:pack.mode,
    expected_policy:row.expected_policy_outcome,actual_policy:pack.policy_outcome});
}
const report={total:cases.length,passed:cases.filter(c=>c.passed).length,rank_hits:truePositives,total_returned:returned,
  total_relevant:relevant,precision_at_3:returned ? truePositives/returned:0,recall_at_3:relevant ? truePositives/relevant:0,
  prohibited_returned:prohibited,provenance_matches:metadataMatch,context_records:fieldsCompared,exact_confidence:exactConfidence,
  graph_matches:graphMatches,graph_checks:graphCount,extraction_matches:extractionHits,extraction_checks:extractionCount,
  entity_matches:resolutionHits,entity_checks:resolutionCount,validation_passed:probes.filter(Boolean).length,
  validation_total:probes.length,cases};
fs.writeFileSync(new URL('../docs/quality.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const {cases:rows,...summary}=report;
console.log(summary);
for(const r of rows.filter(r=>!r.passed)) console.log(r.case_id,r.scenario,r.actual_policy,r.actual_context,Object.keys(r.checks).filter(k=>!r.checks[k]));
