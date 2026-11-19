import demo from '../data/demo.json' with {type:'json'};
import { replay } from './replay.js';
import { Problem, ensure, purge } from './memory.js';

export const profiles=demo.users.map(({subject_id,cohort,primary_surface})=>({subject_id,cohort,primary_surface}));
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value) {return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export const clock=s=>new Date(Date.parse(s.clock.at) + Date.now()-s.clock.started).toISOString();

export async function sessionFor(request,db) {
  const bearer=request.headers.get('Authorization');
  const cookie=(request.headers.get('Cookie') || '').match(/(?:^|;\s*)lm_session=([a-f\d]{64})(?:;|$)/);
  const tabToken=request.headers.get('X-Listening-Session');
  if(tabToken && !/^[a-f\d]{64}$/.test(tabToken)) return null;
  const raw=tabToken || (bearer ? bearer.match(/^Bearer ([a-f\d]{64})$/)?.[1] : cookie?.[1]);
  if (!raw) return null;
  return db.prepare('SELECT * FROM sessions WHERE digest=? AND expires>?').bind(await digest(raw),Date.now()).first();
}
export async function startSession(db,subject,previous) {
  const user=demo.users.find(u=>u.subject_id===subject);
  ensure(user,'unknown_demo_profile',404);
  const reviewer=previous?.reviewer || crypto.randomUUID(), workspace=reviewer+'/'+subject;
  const history=demo.events.filter(e=>e.subject_id===subject);
  const last=history.filter(e=>e.event_type==='ai_interaction').at(-1);
  const at=new Date(Date.parse(last.received_at)+60000).toISOString();
  const {state}=replay(user,history,at);
  state.clock={at,started:Date.now()};
  const raw=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await digest(raw);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO workspaces(id,subject_id,document) VALUES(?,?,?)').bind(workspace,subject,JSON.stringify(state)),
    db.prepare('INSERT INTO sessions(digest,workspace_id,reviewer,expires) VALUES(?,?,?,?)').bind(hash,workspace,reviewer,Date.now()+86400000)
  ]);
  return raw;
}
export async function readState(db,id) {
  const row=await db.prepare('SELECT revision, document FROM workspaces WHERE id=?').bind(id).first();
  ensure(row,'session_expired',401);
  const state=JSON.parse(row.document);
  purge(state,clock(state));
  return {state,revision:row.revision};
}
// Graph edges, vectors, queue receipts and consent share one atomic revision.
// A concurrent correction causes a fresh read instead of overwriting newer state.
export async function change(db,id,action) {
  for (let attempt=0;attempt<5;attempt++) {
    const {state,revision}=await readState(db,id);
    const result=action(state);
    const changed=await db.prepare('UPDATE workspaces SET document=?, revision=revision+1 WHERE id=? AND revision=?')
      .bind(JSON.stringify(state),id,revision).run();
    if(changed.meta.changes===1) return result;
  }
  throw new Problem('concurrent_update_retry',409);
}
export async function limit(db,key,max) {
  const minute=Math.floor(Date.now()/60000);
  const row=await db.prepare('INSERT INTO rate_windows(scope,minute,uses) VALUES(?,?,1) ON CONFLICT(scope) DO UPDATE SET uses=CASE WHEN minute=excluded.minute THEN uses+1 ELSE 1 END, minute=excluded.minute RETURNING uses').bind(key,minute).first();
  ensure(row.uses<=max,'rate_limit',429);
}
