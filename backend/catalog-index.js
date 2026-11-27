import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';

const path=new URL('./catalog-index.sqlite',import.meta.url);
let database;
export function searchIndexedTracks(query,offset=0){
  if(!existsSync(path))return null;
  const terms=query.normalize('NFKC').match(/[\p{L}\p{M}\p{N}]+/gu)?.slice(0,16);
  if(!terms?.length)return {tracks:[],hasNext:false};
  database ||= new DatabaseSync(path,{readOnly:true});
  const match=terms.map(word=>'"'+word+'"*').join(' AND ');
  const rows=database.prepare(`SELECT t.id,t.title,t.artist,'track' AS type
    FROM lookup JOIN tracks t ON t.rowid=lookup.rowid
    WHERE lookup MATCH ?
    ORDER BY (t.normalized=?) DESC,t.popularity DESC,bm25(lookup),t.id
    LIMIT 11 OFFSET ?`).all(match,query.normalize('NFKD').toLowerCase().trim(),offset);
  return {tracks:rows.slice(0,10),hasNext:rows.length>10};
}
