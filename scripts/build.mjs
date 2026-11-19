// Pack the small ES modules and their JSON imports into one portable Worker.
// The classroom server runs the original modules directly.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const registry=new Map(), blocks=[];
function bundle(filename) {
  if(registry.has(filename)) return registry.get(filename);
  const key='module'+registry.size;registry.set(filename,key);
  const source=fs.readFileSync(filename,'utf8');
  if(filename.endsWith('.json')) {blocks.push('const '+key+' = '+JSON.stringify(JSON.parse(source))+';');return key;}
  const imports=/^import\s+(.+?)\s+from\s+['"]([^'"]+)['"](?:\s+with\s*\{[^}]+\})?;$/gm;
  let body=source.replace(imports,(_,binding,reference)=>{
    const child=bundle(path.resolve(path.dirname(filename),reference));
    return 'const '+binding+' = '+child+';';
  });
  const names=[];
  body=body.replace(/^export (async function|function|class|const) (\w+)/gm,(_,kind,name)=>{names.push(name);return kind+' '+name;});
  blocks.push('const '+key+' = (()=>{\n'+body+'\nreturn {'+names.join(',')+'};\n})();');
  return key;
}
const router=bundle(path.join(root,'backend/routes.js'));
const assets={};
for(const [route,name,mime] of [['/','index.html','text/html'],['/style.css','style.css','text/css'],['/app.js','app.js','text/javascript']]) {
  assets[route]=[mime,fs.readFileSync(path.join(root,'frontend',name),'utf8')];
}
for (let n=1; n<=6; n++) {
  const cover='/art/cover-'+String(n).padStart(2,'0')+'.webp';
  assets[cover]=['image/webp',fs.readFileSync(path.join(root,'frontend',cover)).toString('base64')];
}
blocks.push('const assets = '+JSON.stringify(assets)+';');
blocks.push(`function asset(path,method){
  if(method!=='GET' || !Object.hasOwn(assets,path)) return new Response('Not found',{status:404});
  const [type,content]=assets[path];
  const body=type==='image/webp'?Uint8Array.from(atob(content),c=>c.charCodeAt(0)):content;
  return new Response(body,{headers:{'Content-Type':type==='image/webp'?type:type+'; charset=utf-8','X-Content-Type-Options':'nosniff'}});
}
export default {fetch(request,env,ctx){return ${router}.handle(request,env,ctx,asset);}};`);
fs.mkdirSync(path.join(root,'dist/server'),{recursive:true});fs.mkdirSync(path.join(root,'dist/.openai'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/server/index.js'),blocks.join('\n'));
fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(root,'dist/.openai/hosting.json'));
