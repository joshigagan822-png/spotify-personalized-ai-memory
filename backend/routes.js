import {issueRecovery,resetPassword} from './accounts.js';
import {searchIndexedTracks} from './catalog-index.js';
import picks from './featured.json' with {type:'json'};
import {blank,ensure,issueSession,sessionFor,limit} from './store.js';
import {ranking,key,metrics} from './rank.js';
const kinds=['track','episode','playlist'];
const json=(b,status=200,headers={})=>Response.json(b,{status,headers:{'Cache-Control':'no-store',...headers}});
let featured=picks,refreshTime=0;
function refreshCatalog(){
 if(Date.now()-refreshTime<3600000)return;
 refreshTime=Date.now();
 Promise.all(picks.map(async t=>{
  try{const r=await fetch('https://open.spotify.com/oembed?url='+encodeURIComponent('https://open.spotify.com/'+t.type+'/'+t.id),{signal:AbortSignal.timeout(5000)});
   if(r.ok){const m=await r.json();if(m.title)return {...t,title:m.title,image:m.thumbnail_url};}
  }catch{}
  return featured.find(x=>x.id===t.id)||t;
 })).then(rows=>{featured=rows;});
}
function read(db,id){
 const old=JSON.parse(db.prepare('SELECT document FROM workspaces WHERE id=?').bind(id).first().document);
 if(old.version===2)return old;
 const s=blank();s.paused=old.control==='paused'||old.consent==='revoked';
 // Legacy ordinal IDs had no stable mapping to Spotify artists or recordings.
 for(const [id,choice] of Object.entries(old.trackVotes||{})){
  if(!/^spotify:[A-Za-z0-9]{22}$/.test(id)||!['more','less'].includes(choice))continue;
  const t=featured.find(item=>item.id===id.slice(8));
  if(t)s.votes[key(t)]={choice,title:t.title};
 }
 return s;
}
export async function handle(req,env,ctx,asset){
 const url=new URL(req.url),p=url.pathname,db=env.DB,post=req.method==='POST';
 try{
 if(p==='/health/ready'||p==='/health/live'){db.prepare('SELECT 1').first();return json({status:'ready'});}
 if(!p.startsWith('/v1/'))return asset(p,req.method);
 ensure(!req.headers.get('origin')||req.headers.get('origin')===url.origin,'origin_not_allowed',403);
 if(post)ensure(req.headers.get('content-type')?.includes('application/json'),'expected_json',415);
 const b=post?await req.json():{},cookie=(token,n)=>'lm_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+n+(url.protocol==='https:'?'; Secure':'');
 if(post&&p==='/v1/reset-password')return json({recoveryCode:await resetPassword(db,b)});
 if(post&&['/v1/signup','/v1/login','/v1/guest'].includes(p)){
 let token;if(p==='/v1/guest'){await limit(db,'guest-entry',120);const u=crypto.randomUUID();token=await issueSession(db,'guest/'+u,u,u,blank());}
 else token=await env.accountSession(db,p.slice(4),b);
 const recoveryCode=p==='/v1/guest'?null:issueRecovery(db,db.prepare('SELECT subject FROM accounts WHERE email=?').bind(String(b.email).trim().toLowerCase()).first().subject);
 return json({ok:true,recoveryCode},200,{'Set-Cookie':cookie(token,86400)});}
 const session=await sessionFor(req,db);ensure(session&&/^(guest|account)\//.test(session.workspace_id),'sign_in_required',401);
 const id=session.workspace_id;await limit(db,id,240);
 let s=read(db,id);const save=()=>db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(s),id).run();
 if(post&&p==='/v1/logout'){db.prepare('DELETE FROM sessions WHERE digest=?').bind(session.digest).run();return json({},200,{'Set-Cookie':cookie('',0)});}
 if(!post&&p==='/v1/state')return json({guest:id.startsWith('guest/'),artists:s.artists,terms:s.terms,votes:s.votes,paused:s.paused,feeds:s.feeds,quality:metrics(s.samples),options:[...new Set(picks.filter(t=>t.type==='track').map(t=>t.artist))]});
 if(post&&p==='/v1/memory'){
 switch(b.action){
 case 'artists':ensure(Array.isArray(b.artists)&&b.artists.length<=3&&b.artists.every(a=>typeof a==='string'&&a.trim()&&a.length<=80),'choose_up_to_three_artists');s.artists=[...new Set(b.artists.map(a=>a.trim()))];break;
 case 'pause':s.paused=!!b.paused;break;
 case 'forget':s.terms=s.terms.filter(q=>q!==b.term);break;
 case 'undo':delete s.votes[b.key];s.samples=s.samples.filter(x=>x.key!==b.key);break;
 case 'clear':s={...blank(),paused:s.paused};break;
 default:ensure(false,'unknown_action');}
 delete s.batch;save();return json({ok:true});}
 if(post&&p==='/v1/feed'){
 const q=String(b.q||'').trim().slice(0,512),types=kinds.includes(b.type)?[b.type]:kinds;
 const offset=Number(b.offset||0);
 ensure(Number.isInteger(offset)&&offset>=0&&offset<=1000&&offset%10===0,'invalid_page');
 const link=q.match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|episode|playlist)[/:]([a-zA-Z0-9]{22})(?:[?#].*)?$/);
 const request=q||(!s.paused&&(s.artists[s.feeds%Math.max(s.artists.length,1)]||s.terms[0]))||'Indian';
 refreshCatalog();
 let direct=null;
 if(link&&types.includes(link[1])){
  const [,type,id]=link;
  const existing=featured.find(x=>x.id===id&&x.type===type);
  if(existing)direct=existing;
  else {
   try {
    const endpoint='https://open.spotify.com/oembed?url='+encodeURIComponent('https://open.spotify.com/'+type+'/'+id);
    const response=await fetch(endpoint,{signal:AbortSignal.timeout(5000)});
    if(response.ok){const meta=await response.json();direct={type,id,title:meta.title,artist:'Spotify',image:meta.thumbnail_url};}
   }catch{}
  }
 }
 const remote=link?[]:await Promise.all(types.map(t=>env.spotifySearch(request,t,offset)));s=read(db,id);
 const trackIndex=types.indexOf('track');
 const indexed=q&&!link&&trackIndex>=0&&!remote[trackIndex]?.available?searchIndexedTracks(q,offset):null;
 if(indexed)remote[trackIndex]={...indexed,available:false};
 const local=offset?[]:featured.filter(t=>types.includes(t.type)&&(!q||(t.title+' '+t.artist+' '+(t.aliases||'')).toLowerCase().includes(q.toLowerCase())));
 const items=[...new Map([...local,...remote.flatMap(r=>r.tracks),...(direct?[direct]:[])].map(t=>[key(t),t])).values()];
 const counts=JSON.parse(db.prepare("SELECT json_group_object(k,n) c FROM (SELECT v.key k,count(*) n FROM accounts a JOIN workspaces w ON w.id='account/'||a.subject AND w.subject_id=a.subject JOIN json_each(w.document,'$.votes') v WHERE json_extract(w.document,'$.version')=2 AND json_extract(v.value,'$.choice')='more' GROUP BY v.key)").first().c);
 const ranked=ranking(items,s.paused?blank():s,counts,q?0:Math.floor(Date.now()/3600000));
 if(!s.paused){s.feeds++;if(q&&!link&&b.remember)s.terms=[q,...s.terms.filter(x=>x!==q)].slice(0,12);
 s.batch={id:crypto.randomUUID(),orders:ranked.orders,titles:Object.fromEntries(items.map(t=>[key(t),t.title]))};save();}
 return json({items:ranked.cards,batch:s.paused?null:s.batch.id,direct:!!direct,indexed:!!indexed,hasNext:!!q&&offset<1000&&remote.some(r=>r.hasNext),search:remote.some(r=>r.available)});}
 if(post&&p==='/v1/rate'){
 ensure(!s.paused&&s.batch?.id===b.batch&&Object.hasOwn(s.batch.titles,b.key),'refresh_results',409);ensure(['more','less'].includes(b.choice),'invalid_choice');
 if(!s.votes[b.key]&&b.choice==='more'&&b.key.startsWith('track:'))s.samples=[...s.samples,{key:b.key,ranks:s.batch.orders.map(a=>1+a.indexOf(b.key))}].slice(-500);
 if(b.choice==='less')s.samples=s.samples.filter(x=>x.key!==b.key);
 s.votes[b.key]={choice:b.choice,title:s.batch.titles[b.key]};save();return json({ok:true});}
 return json({error:'unknown_route'},404);
 }catch(e){return json({error:e.status?e.message:'request_failed'},e.status||503);}
}
