import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {metrics} from '../backend/rank.js';
const path=process.env.DATABASE_PATH||'runtime/memory.sqlite';let n=0,samples=[];
if(existsSync(path)){const db=new DatabaseSync(path,{readOnly:true});for(const {document} of db.prepare("SELECT document FROM workspaces WHERE id LIKE 'account/%'").iterate()){const s=JSON.parse(document);if(s.version===2&&s.samples?.length){n++;samples.push(...s.samples);}}db.close();}
console.log(JSON.stringify({listeners:n,results:metrics(samples)},null,2));