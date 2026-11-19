import { newState, processEvent, finishDelete, purge } from './memory.js';

export function replay(user, events, at, {deletions=[], feedbackReceipts=[]}={}) {
  const state=newState(user);
  const actions=events.filter(e=>e.subject_id === user.subject_id && Date.parse(e.received_at) <= Date.parse(at))
    .map(event=>({time:event.received_at,event}));
  for (const job of deletions.filter(j=>j.subject_id===user.subject_id && j.completed_at && Date.parse(j.completed_at)<=Date.parse(at)))
    actions.push({time:job.completed_at,job});
  actions.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const decisions={};
  for (const {time,event,job} of actions) {
    if (job) {
      const pending=Object.values(state.jobs).find(j=>j.memory_id === job.memory_id);
      if (pending) finishDelete(state,pending,time);
      continue;
    }
    if (event.event_type==='relevance_feedback') {
      const receipt=feedbackReceipts.find(t=>t.subject_id===user.subject_id && t.response_id===event.payload.response_id);
      if (receipt) state.traces.push({...receipt,at:time,candidates:[],removals:[]});
    }
    decisions[event.event_id]=processEvent(state,event);
  }
  // Run expiry at the historical query clock, including sessions with no new events.
  purge(state,at);
  return {state,decisions};
}
