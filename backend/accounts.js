import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure, blank } from './store.js';
import { issueSession, limit } from './store.js';

const derive = promisify(scrypt);
export async function accountSession(db, action, input) {
  const email = String(input.email || '').trim().toLowerCase();
  ensure(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'invalid_email', 422);
  ensure(typeof input.password === 'string' && input.password.length <= 128, 'invalid_password', 422);
  await limit(db, 'account-total', 60);
  await limit(db, 'account-attempt/' + email, 10);
  let row = await db.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first();
  if (action === 'signup') {
    ensure(input.password.length >= 4, 'use_at_least_4_characters', 422);
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(input.password, salt, 64)).toString('hex');
    const subject = randomUUID();
    const insert = await db.prepare('INSERT OR IGNORE INTO accounts(email,subject,salt,hash) VALUES(?,?,?,?)').bind(email,subject,salt,hash).run();
    ensure(insert.meta.changes === 1, 'email_unavailable', 409);
    row = {subject};
  } else {
    const supplied = await derive(input.password, row?.salt || 'missing-account', 64);
    ensure(row && timingSafeEqual(supplied, Buffer.from(row.hash,'hex')), 'invalid_login', 401);
  }
  const state=blank();
  return issueSession(db,'account/'+row.subject,row.subject,row.subject,state);
}

function recoveryTable(db){
  db.prepare('CREATE TABLE IF NOT EXISTS recovery_keys(subject TEXT PRIMARY KEY, digest TEXT NOT NULL)').run();
}
function newKey(){return randomBytes(16).toString('hex').match(/.{4}/g).join('-');}
function fingerprint(code){return createHash('sha256').update(String(code).trim().toLowerCase().replaceAll('-','')).digest('hex');}
export function issueRecovery(db,subject,replace=false){
  recoveryTable(db);
  const code=newKey();
  const sql=replace?'INSERT OR REPLACE':'INSERT OR IGNORE';
  const result=db.prepare(sql+' INTO recovery_keys(subject,digest) VALUES(?,?)').bind(subject,fingerprint(code)).run();
  return result.meta.changes===1?code:null;
}
export async function resetPassword(db,input){
  const email=String(input.email||'').trim().toLowerCase();
  ensure(email.length<=254 && typeof input.password==='string' && input.password.length>=4 && input.password.length<=128,'use_4_to_128_characters');
  await limit(db,'reset-total',60);await limit(db,'reset/'+email,8);
  recoveryTable(db);
  const digest=fingerprint(input.code);
  const row=db.prepare('SELECT a.subject FROM accounts a JOIN recovery_keys r ON r.subject=a.subject WHERE a.email=? AND r.digest=?').bind(email,digest).first();
  ensure(row,'invalid_email_or_recovery_code',400);
  const salt=randomBytes(16).toString('hex');
  const hash=(await derive(input.password,salt,64)).toString('hex');
  const code=newKey();
  const valid='EXISTS(SELECT 1 FROM recovery_keys WHERE subject=? AND digest=?)';
  const results=await db.batch([
    db.prepare('UPDATE accounts SET salt=?,hash=? WHERE subject=? AND '+valid).bind(salt,hash,row.subject,row.subject,digest),
    db.prepare('DELETE FROM sessions WHERE workspace_id=? AND '+valid).bind('account/'+row.subject,row.subject,digest),
    db.prepare('UPDATE recovery_keys SET digest=? WHERE subject=? AND digest=?').bind(fingerprint(code),row.subject,digest)
  ]);
  ensure(results[2].meta.changes===1,'invalid_email_or_recovery_code',400);
  return code;
}
