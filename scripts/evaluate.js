import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { metrics } from '../backend/rank.js';

const path = process.env.DATABASE_PATH || 'runtime/memory.sqlite';
let db;
try {
  db = new DatabaseSync(path, { readOnly: true });
  const query = readFileSync(new URL('../analysis/account-feedback.sql', import.meta.url), 'utf8');
  let listeners = 0;
  const samples = [];
  for (const row of db.prepare(query).iterate()) {
    const observations = JSON.parse(row.samples);
    for (const observation of observations) {
      if (!Array.isArray(observation?.ranks) || observation.ranks.length !== 3 ||
          !observation.ranks.every(rank => Number.isSafeInteger(rank) && rank > 0)) {
        throw new Error('Invalid ranking observation in the application database');
      }
      samples.push(observation);
    }
    listeners++;
  }
  console.log(JSON.stringify({ listeners, results: metrics(samples) }, null, 2));
} catch (error) {
  console.error('Evaluation unavailable. Set DATABASE_PATH to a readable application database.', error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
