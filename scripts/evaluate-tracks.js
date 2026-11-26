import events from '../data/events.json' with {type:'json'};
import users from '../data/users.json' with {type:'json'};
import catalog from '../data/catalog.json' with {type:'json'};
// Temporal offline evaluation on the supplied synthetic catalog only.
export function evaluate(events, users, entities) {
  const eligible=new Set(users.filter(u=>u.age_band==='adult' && u.market==='IN' && u.initial_consent==='granted').map(u=>u.subject_id));
  const tracks=entities.filter(e=>e.entity_type==='track');
  const byName=new Map(entities.map(e=>[e.canonical_name.toLowerCase(),e.entity_id]));
  const histories=new Map(), positives=[];
  for(const event of [...events].sort((a,b)=>Date.parse(a.received_at)-Date.parse(b.received_at))){
    if(!eligible.has(event.subject_id) || event.consent_state!=='granted')continue;
    const item=byName.get(String(event.entity_reference).toLowerCase());
    const history=histories.get(event.subject_id) || [];
    const positive=item?.startsWith('track_') && (event.event_type==='save' || (event.event_type==='playback' && event.payload.completion_fraction>=0.8));
    if(positive) positives.push({user:event.subject_id,item,time:event.received_at,history:[...history]});
    history.push({item,type:event.event_type,time:event.received_at});
    histories.set(event.subject_id,history);
  }
  const targets=new Map(positives.map(p=>[p.user,p]));
  const results=[];
  for(const [user,target] of targets){
    const history=target.history.filter(e=>e.time<target.time);
    // Restrict the proxy to straightforward histories with known consent state.
    if(history.some(e=>['opt_out','pause_memory','correction','delete_memory'].includes(e.type)))continue;
    const counts=new Map(),prefs=new Set(),votes=new Map();
    for(const p of positives)if(p.time<target.time) counts.set(p.item,(counts.get(p.item)||0)+1);
    for(const e of history){
      if(e.type==='explicit_preference')prefs.add(e.item);
      if(e.type==='save' || e.type==='skip')votes.set(e.item,e.type==='save'?2:-2);
    }
    const scores=[id=>counts.get(id)||0,id=>Number(prefs.has(id.replace('track_','artist_'))),
      id=>Number(prefs.has(id.replace('track_','artist_')))+(votes.get(id)||0)];
    results.push({sparse:history.length<2,hits:scores.map(score=>[...tracks].sort((a,b)=>score(b.entity_id)-score(a.entity_id)).slice(0,5).some(t=>t.entity_id===target.item))});
  }
  return ['all','sparse','other'].map(group=>{
    const rows=results.filter(r=>group==='all'||r.sparse===(group==='sparse'));
    return {group,listeners:rows.length,...Object.fromEntries(['popularity','artist_memory','feedback_proxy'].map((label,i)=>[label,rows.length?Number((rows.filter(r=>r.hits[i]).length/rows.length).toFixed(3)):null]))};
  });
}

console.table(evaluate(events,users,catalog.entities));
