export function ensure(ok,message,status=422){if(!ok)throw Object.assign(Error(message),{status});}
export const blank=()=>({version:2,artists:[],terms:[],votes:{},samples:[],paused:false,feeds:0});
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value) {return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}

export async function sessionFor(request,db) {
  const bearer=request.headers.get('Authorization');
  const cookie=(request.headers.get('Cookie') || '').match(/(?:^|;\s*)lm_session=([a-f\d]{64})(?:;|$)/);
  const tabToken=request.headers.get('X-Listening-Session');
  if(tabToken && !/^[a-f\d]{64}$/.test(tabToken)) return null;
  const raw=tabToken || (bearer ? bearer.match(/^Bearer ([a-f\d]{64})$/)?.[1] : cookie?.[1]);
  if (!raw) return null;
  return db.prepare('SELECT * FROM sessions WHERE digest=? AND expires>?').bind(await digest(raw),Date.now()).first();
}
export async function issueSession(db,workspace,subject,reviewer,state) {
  const raw=hex(crypto.getRandomValues(new Uint8Array(32)));
  const hash=await digest(raw);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO workspaces(id,subject_id,document) VALUES(?,?,?)').bind(workspace,subject,JSON.stringify(state)),
    db.prepare('INSERT INTO sessions(digest,workspace_id,reviewer,expires) VALUES(?,?,?,?)').bind(hash,workspace,reviewer,Date.now()+86400000)
  ]);
  return raw;
}
export async function limit(db,key,max) {
  const minute=Math.floor(Date.now()/60000);
  const row=await db.prepare('INSERT INTO rate_windows(scope,minute,uses) VALUES(?,?,1) ON CONFLICT(scope) DO UPDATE SET uses=CASE WHEN minute=excluded.minute THEN uses+1 ELSE 1 END, minute=excluded.minute RETURNING uses').bind(key,minute).first();
  ensure(row.uses<=max,'rate_limit',429);
}
