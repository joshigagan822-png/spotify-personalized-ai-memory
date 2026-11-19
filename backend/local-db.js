import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// This small adapter gives local SQLite the same prepared-statement interface as D1.
export function openLocal(filename) {
  if(filename!==':memory:') fs.mkdirSync(path.dirname(filename),{recursive:true});
  const sql=new DatabaseSync(filename);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500; PRAGMA secure_delete=ON;');
  const version=sql.prepare('PRAGMA user_version').get().user_version;
  if(version===0) {
    const migration=fs.readFileSync(new URL('../drizzle/0000_pilot.sql',import.meta.url),'utf8');
    sql.exec('BEGIN IMMEDIATE');
    try {sql.exec(migration);sql.exec('PRAGMA user_version=1; COMMIT');}
    catch(e) {sql.exec('ROLLBACK');throw e;}
  } else if(version!==1) {throw Error('Unsupported schema version '+version);}
  function prepared(query,args=[]) {
    return {bind:(...params)=>prepared(query,params),
      first:()=>sql.prepare(query).get(...args) || null,
      run:()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})};
  }
  return {prepare:prepared,batch(statements) {
    sql.exec('BEGIN IMMEDIATE');
    try {const results=statements.map(statement=>statement.run());sql.exec('COMMIT');return results;}
    catch(error) {sql.exec('ROLLBACK');throw error;}
  },close:()=>sql.close()};
}
