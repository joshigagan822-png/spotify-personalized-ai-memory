import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ensure, newState } from './memory.js';
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
    ensure(input.eligible === true, 'adult_india_pilot_only', 422);
    ensure(input.password.length >= 12, 'use_at_least_12_characters', 422);
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
  const state = newState({subject_id:row.subject,locale:'en-IN',market:'IN',age_band:'adult',
    initial_consent:'granted',primary_surface:'listening_ai',cohort:'memory_enabled'});
  state.clock = {at:new Date().toISOString(),started:Date.now()};
  return issueSession(db,'account/'+row.subject,row.subject,row.subject,state);
}
