export const key=t=>t.type+':'+t.id;
export function ranking(items,state,counts,offset=0){
 const cards=items.map((t,index)=>{
  const k=key(t),text=(t.title+' '+t.artist).toLowerCase();
  const artist=state.artists.find(a=>(t.artist.toLowerCase()===a.toLowerCase() || t.artist.toLowerCase().split(', ').includes(a.toLowerCase())));
  const term=state.terms.find(q=>text.includes(q.toLowerCase())),v=state.votes[k]?.choice;
  const taste=(artist?3:0)+(term?1:0);
  return {...t,key:k,taste,score:taste+(v==='more'?10:v==='less'?-10:0),pop:counts[k]||0,
   tie:(index+items.length-offset%items.length)%items.length,
   reason:[artist&&'Favourite artist: '+artist,term&&'Recent search: '+term,v&&'Your feedback: '+v].filter(Boolean).join(' · ')||'Catalog discovery'};
 });
 const sorted=f=>[...cards].sort((a,b)=>b[f]-a[f]||a.tie-b.tie);
 return {cards:sorted('score'),orders:['pop','taste','score'].map(f=>sorted(f).filter(t=>t.type==='track').map(t=>t.key))};
}
export function metrics(samples){
 return ['Community popularity','Artist and search memory','Memory with feedback'].map((method,i)=>{
 const n=samples.length;return {method,n,hit:n?samples.filter(s=>s.ranks[i]<=5).length/n:null,rank:n?samples.reduce((sum,s)=>sum+s.ranks[i],0)/n:null};});
}
