import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handle} from './backend/routes.js';
import {openLocal} from './backend/local-db.js';
import {advance} from './backend/service.js';
import {change} from './backend/store.js';
const root=path.dirname(fileURLToPath(import.meta.url));
try {process.loadEnvFile(path.join(root,'.env'));} catch(e) {if(e.code!=='ENOENT') throw e;}
const db=openLocal(process.env.DATABASE_PATH || path.join(root,'runtime','memory.sqlite'));
const env={DB:db,OLLAMA_URL:process.env.OLLAMA_URL,OLLAMA_MODEL:process.env.OLLAMA_MODEL};
const files={'/':['frontend/index.html','text/html'], '/app.js':['frontend/app.js','text/javascript'], '/style.css':['frontend/style.css','text/css']};
for (let n=1; n<=6; n++) {
  const cover='/art/cover-'+String(n).padStart(2,'0')+'.webp';
  files[cover]=['frontend'+cover,'image/webp'];
}
const asset=(url,method)=>{
  const f=Object.hasOwn(files,url) && files[url];
  if(!f || method!=='GET') return new Response('Not found',{status:404});
  return new Response(fs.readFileSync(path.join(root,f[0])),{headers:{'Content-Type':f[1],'X-Content-Type-Options':'nosniff'}});
};
const ctx={waitUntil:p=>{p.catch(()=>{});}};
const server=http.createServer(async(req,res)=>{
  try {
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>16384){res.writeHead(413);res.end();return;}chunks.push(chunk);}
    const host=req.headers.host || 'localhost';
    const request=new Request('http://'+host+req.url,{method:req.method,headers:req.headers,
      body:chunks.length ? Buffer.concat(chunks):undefined});
    const result=await handle(request,env,ctx,asset);
    res.writeHead(result.status,Object.fromEntries(result.headers));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.writeHead(500);res.end('Request failed');}
});
// Recover queued work after a restart, including work for an idle listener.
let cursor='';
const recovery=setInterval(async()=>{
  try {
    const row=await db.prepare('SELECT id FROM workspaces WHERE id>? ORDER BY id LIMIT 1').bind(cursor).first();
    cursor=row?.id || '';
    if(row) await change(db,row.id,advance);
    await db.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()).run();
  } catch { /* A busy writer will be retried on the next tick. */ }
},15000);
recovery.unref();
const argPort=process.argv.indexOf('--port');
const port=Number(argPort>=0 ? process.argv[argPort+1]:process.env.PORT || 8000);
const host=process.argv.includes('--host') ? (process.argv[process.argv.indexOf('--host')+1] || '127.0.0.1'):process.env.HOST || '127.0.0.1';
server.listen(port,host,()=>console.log('Listening Memory at http://'+host+':'+server.address().port));
