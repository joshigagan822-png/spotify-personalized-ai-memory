import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openLocal } from '../backend/local-db.js';

test('evaluation distinguishes a missing database from a real database without observations', t => {
  const dir = mkdtempSync(join(tmpdir(), 'evaluation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite');
  const run = () => spawnSync(process.execPath, ['scripts/evaluate.js'], {
    env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8'
  });
  assert.notEqual(run().status, 0);
  assert.equal(existsSync(path), false);
  const db = openLocal(path);
  db.prepare('CREATE TABLE accounts (subject TEXT PRIMARY KEY)').run();
  db.close();
  const empty = run();
  assert.equal(empty.status, 0, empty.stderr);
  const report = JSON.parse(empty.stdout);
  assert.equal(report.listeners, 0);
  assert.ok(report.results.every(row => row.n === 0 && row.hit === null && row.rank === null));
});
