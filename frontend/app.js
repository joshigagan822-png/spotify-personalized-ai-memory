const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const human=value=>String(value??'').replaceAll('_',' ');
const date=iso=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(iso));
const id=()=>crypto.randomUUID();
// Embedded browsers may deny cookies or tab storage. A short-lived, scoped
// credential in memory keeps the current tab usable in either case.
function readTab(key){try{return sessionStorage.getItem(key);}catch{return null;}}
function writeTab(key,value){try{sessionStorage.setItem(key,value);}catch{/* Memory-only tab. */}}
let demoToken=readTab('lm:token');
const browserSession=readTab('lm:session') || id();
writeTab('lm:session',browserSession);
const names={listening_ai:'Listening',playlist_ai:'Playlists',podcast_ai:'Podcasts'};
const profileNames={U0001:'Listening',U0002:'Playlists',U0003:'Podcasts',U0016:'Sparse history'};
const example={listening_ai:'What should I listen to next?',playlist_ai:'Build my usual playlist.',podcast_ai:'Resume my unfinished episode.'};
const reasons={insufficient_history:'This listener has no eligible history for that request.',experiment_disabled:'Memory is switched off for this comparison.',
  memory_paused:'This listener paused memory.',consent_revoked:'This listener opted out of memory.',
  outside_surface_scope:'The saved preference belongs to a different surface.',dependency_timeout:'A memory dependency was unavailable.',
  deleted:'The saved memory was removed.',different_intent:'The saved history belongs to a different request.',
  context_budget:'No eligible memory fits the selected budget.',negative_feedback:'The listener marked this memory irrelevant.'};
const view=$('#view'), alert=$('#alert'), dialog=$('#dialog');
let page='session',dashboard,memories=[],surface='listening_ai',utterance='',last=null,mode='',quality,policy;
const note=message=>{alert.textContent=message;};
async function api(path,body,method) {
  const options={method:method || (body?'POST':'GET'),credentials:'same-origin',cache:'no-store'};
  options.headers={};
  if(demoToken) options.headers['X-Listening-Session']=demoToken;
  if(body) {options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch(path,options);
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || data.reason || 'Request failed');
  return data;
}
function heading(title,detail) {
  return '<div class="headrow"><div><h1>'+esc(title)+'</h1><p>'+esc(detail)+'</p></div><div class="clock">Demo clock · UTC<strong>'+date(dashboard.at)+'</strong></div></div>';
}
function table(headers,rows) {
  if(!rows.length) return '<p class="empty">No records yet.</p>';
  return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function details(title,inner){return '<details><summary>'+esc(title)+'</summary>'+inner+'</details>';}
function metric(label,value){return '<div class="metric"><div>'+esc(label)+'</div><strong>'+esc(value)+'</strong></div>';}
function chip(label){return '<span class="chip">'+esc(label)+'</span>';}
function option(v,label,selected=false){return '<option value="'+esc(v)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';}
function field(name,html){return '<label class="field">'+esc(name)+html+'</label>';}
function catalogOptions(selected) {
  return dashboard.catalog.filter(x=>['artist','playlist','topic','episode','track'].includes(x.entity_type))
    .sort((a,b)=>(a.entity_type==='artist'?0:1)-(b.entity_type==='artist'?0:1) || a.canonical_name.localeCompare(b.canonical_name))
    .map(x=>option(x.entity_id,x.canonical_name,selected===x.entity_id)).join('');
}
function modal(title,content){$('#dialogBody').innerHTML='<h2>'+esc(title)+'</h2>'+content;dialog.showModal();}
async function refresh() {
  [dashboard,{memories}]=await Promise.all([api('/v1/dashboard'),api('/v1/memories')]);
  $('#profile').innerHTML=dashboard.profiles.map(p=>option(p.subject_id,p.subject_id+' · '+profileNames[p.subject_id],p.subject_id===dashboard.user.subject_id)).join('');
}
function memoryCard(m,controls=false) {
  const active=m.status==='active';
  return '<article class="fact"><div class="between">'+chip(human(m.memory_type))+
    '<small>'+esc(Math.round(m.confidence*100))+'% confidence</small></div><h3>'+esc(m.normalized_fact || 'Removed memory')+'</h3>'+
    '<small>'+esc(m.source_class==='explicit_user'?'Listener statement':'Listening activity')+' · '+esc(date(m.valid_from))+'</small>'+
    (controls?'<div class="tagline tiny">'+esc(m.memory_id)+' · '+esc(human(m.status))+' · '+esc(names[m.surface])+'</div>':'')+
    (controls?'<div class="actions">'+(active && ['explicit_preference','inferred_preference','exclusion'].includes(m.memory_type)?
      '<button class="secondary" data-act="correct" data-id="'+esc(m.memory_id)+'">Correct</button>':'')+
      '<button class="link" data-act="delete" data-id="'+esc(m.memory_id)+'">Remove</button></div>':
      '<div class="actions"><button class="link" data-act="explain" data-id="'+esc(m.memory_id)+'">View source</button>'+
      '<button class="link" data-act="feedback" data-id="'+esc(m.memory_id)+'">Mark irrelevant</button></div>')+'</article>';
}
const icons = {
  home:'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3Z',
  library:'M4 4v16M8 4v16m4-15 6-2 4 16-6 2Z',
  check:'m7 12 3 3 7-7M3 5h18v15H3Z',
  pulse:'M2 13h5l3-8 4 14 3-8h5',
  shield:'M12 3 4 6v5c0 5 4 8 8 10 4-2 8-5 8-10V6Z',
  search:'M16 16l5 5m-3-11a8 8 0 1 1-16 0 8 8 0 1 1 16 0',
  user:'M16 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0M4 21a8 8 0 0 1 16 0',
  arrow:'M5 12h14m-6-6 6 6-6 6', note:'M9 18V6l11-2v12M9 16c-6-2-8 4-4 5 2 0 4-1 4-3m11-4c-6-2-8 4-4 5 2 0 4-1 4-3',
  wave:'M3 10v4m4-7v10m5-14v18m5-15v12m4-8v4'
};
function icon(name) {
  return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+icons[name]+'"/></svg>';
}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));

let browseFilter='all';
const inkColors=['#e2b946','#e89bb1','#a2c7e4','#acd090','#e59369','#cab4e4'];
function recordArt(entity, large=false) {
  const number=Number(entity?.entity_id.split('_').pop()) || 1;
  const index=(number-1)%6;
  const file=String(index+1).padStart(2,'0');
  return '<span aria-hidden="true" class="art '+(large?'large-art':'thumb')+'" style="--sleeve:'+inkColors[index]+'">'+
    (large?'<span class="sleeve-band">'+(entity.entity_type==='episode'?'Artist profile':'Listening mix')+' <b>✦</b></span>':'')+
    '<img alt="" src="/art/cover-'+file+'.webp"></span>';
}
function artistFor(item) {
  const suffix=item.entity_id.split('_').pop();
  return dashboard.catalog.find(x=>x.entity_id==='artist_'+suffix)?.canonical_name || '';
}
function browseCards() {
  const term=$('#search').value.trim().toLowerCase();
  const podcasts=browseFilter==='podcasts';
  const catalog=dashboard.catalog;
  const group=(type)=>catalog.filter(x=>x.entity_type===type && (!term || (x.canonical_name+' '+artistFor(x)).toLowerCase().includes(term)));
  const shelf=group(podcasts?'episode':'playlist').slice(0,term?12:6);
  const rows=(browseFilter==='all' && term?[...group('track'),...group('episode')]:group(podcasts?'episode':'track')).slice(0,term?24:6);
  function card(item) {
    const singer=artistFor(item);
    return '<button class="cover-card" data-item="'+esc(item.entity_id)+'" aria-label="Explore '+esc(item.canonical_name)+'">'+recordArt(item,true)+
      '<strong>'+esc(singer)+'</strong><small>'+esc(podcasts?'Indian Singer Stories':dashboard.catalog.find(x=>x.entity_id===item.entity_id.replace('playlist_','track_'))?.canonical_name || 'Listening mix')+'</small></button>';
  }
  function track(item) {
    return '<button class="track" data-item="'+esc(item.entity_id)+'">'+recordArt(item)+'<span class="track-copy"><strong>'+esc(item.canonical_name.replace(/^Artist Profile: /,''))+'</strong><small>'+
      esc(item.entity_type==='episode'?'Indian Singer Stories · Podcast':artistFor(item))+'</small></span><span class="track-arrow">'+icon('arrow')+'</span></button>';
  }
  const none='<p class="empty">No matches. Try an artist or title from the catalog.</p>';
  const shortcuts=[['listening_ai','Discover music','track_01'],['playlist_ai','Build a playlist','playlist_04'],['podcast_ai','Resume a podcast','episode_06']]
    .filter(([key])=>!term && (browseFilter==='all' || (podcasts?key==='podcast_ai':key!=='podcast_ai')));
  const quick=shortcuts.map(([key,label,id])=>'<button data-shortcut="'+key+'">'+recordArt(catalog.find(x=>x.entity_id===id))+'<strong>'+label+'</strong>'+icon('arrow')+'</button>').join('');
  $('#shelves').innerHTML=(quick?'<div class="shortcuts">'+quick+'</div>':'')+'<section class="shelf"><h2>'+(podcasts?'Artist stories':'Artist mixes')+'</h2>'+(shelf.length?'<div class="covers">'+shelf.map(card).join('')+'</div>':none)+'</section>'+
    '<section class="shelf"><h2>'+(podcasts?'Podcast episodes':'Quick picks')+'</h2>'+(rows.length?'<div class="tracks">'+rows.map(track).join('')+'</div>':none)+'</section>';
}
function updateNow() {
  const bar=$('#now');
  bar.hidden=!last;
  if(!last)return;
  const key=last.context[0]?.entity_id;
  const entity=dashboard.catalog.find(x=>x.entity_id===key);
  bar.innerHTML='<div class="now-inner">'+(entity?recordArt(entity):'<span class="empty-art">'+icon('note')+'</span>')+
    '<div class="now-copy"><small>Latest recommendation</small><strong>'+esc(last.reply.text)+'</strong></div>'+
    '<button class="now-link" data-jump="request-panel">View request '+icon('arrow')+'</button></div>';
}
function desk() {
  const s=last,used=s?.context||[];
  const paths=Object.entries(names).map(([v,n])=>'<button type="button" data-surface="'+v+'" aria-pressed="'+(v===surface)+'">'+esc(n)+'</button>').join('');
  const comparison=field('Experiment','<select id="mode">'+option('','Assigned cohort',!mode)+option('memory_enabled','Memory on',mode==='memory_enabled')+option('memory_disabled','Memory off',mode==='memory_disabled')+'</select>');
  const trace=s?details('Inspect retrieval trace','<p class="tiny">Trace '+esc(s.trace_id)+'</p>'+
    table(['Candidate','Score','Reason'],s.candidates.map(x=>[x.memory_id,x.score,human(x.relevance_reason)]))+
    (s.removals.length?table(['Filtered memory','Reason'],s.removals.map(x=>[x.memory_id,human(x.reason)])):'')+
    '<p class="tiny">'+s.token_estimate+' estimated context units used.</p>'):'';
  const filters=['all','music','podcasts'].map(f=>'<button data-filter="'+f+'" aria-pressed="'+(f===browseFilter)+'">'+f[0].toUpperCase()+f.slice(1)+'</button>').join('');
  view.innerHTML='<div class="home-heading"><h1>Home</h1><div class="filters" aria-label="Browse catalog">'+filters+'</div></div><div id="shelves"></div>'+
    '<section id="request-panel" class="shelf" tabindex="-1"><h2>Listening desk</h2>'+
    (s?'<div class="response"><span class="response-icon">'+icon('wave')+'</span><div><small>'+(used.length?'Personalized response':'Response without memory')+'</small><h3>'+esc(s.reply.text)+'</h3></div></div>':'')+
    '<div class="grid"><section class="panel"><h2>Listener request</h2><div class="seg">'+paths+'</div><form id="query">'+
    field('What would you like to hear?','<textarea id="utterance" required maxlength="600">'+esc(utterance)+'</textarea>')+
    '<div class="controls-row">'+comparison+'<button class="primary" type="submit">Run request</button></div></form></section>'+
    '<section class="panel"><div class="between"><h2>Memory in use</h2>'+chip(used.length+' of 3')+'</div>'+
    (used.length?used.map(m=>memoryCard(m)).join(''):'<p class="empty">'+esc(s?(reasons[s.fallback_reason] || human(s.fallback_reason)):'Run a request to see its sources.')+'</p>')+trace+'</section></div></section>';
  browseCards();
}
function controlsPage() {
  const recent=dashboard.jobs[0],active=dashboard.control==='active';
  view.innerHTML=heading('Memory controls','Review a listener’s timeline, correct a preference or remove it.')+
    '<div class="grid"><section class="panel"><div class="between"><h2>Memory timeline</h2><button class="secondary" data-act="add">Add preference</button></div>'+
    (memories.length?memories.map(m=>memoryCard(m,true)).join(''):'<p class="empty">This listener has no stored memories to review.</p>')+
    '</section><div class="stack"><section class="panel"><div class="between"><h2>Personal memory</h2>'+chip(human(dashboard.control))+'</div><p class="desc">Consent is '+esc(dashboard.consent)+'.</p><div class="actions spaced">'+
    (dashboard.consent==='revoked'?'<button class="secondary" data-act="opt_in">Grant consent</button>':
    '<button class="secondary" data-act="'+(active?'pause_memory':'resume_memory')+'">'+(active?'Pause memory':'Resume memory')+'</button><button class="link" data-act="optout">Opt out</button>')+
    '</div><button class="link spaced" data-act="export">Export active memories</button></section><section class="panel"><h2>Capture a listening event</h2>'+
    '<p class="desc">Log a play, save or follow to see how listening activity becomes evidence.</p><button class="secondary spaced" data-act="capture">Record event</button></section>'+
    (recent?'<section class="panel"><h2>Latest deletion</h2>'+chip(recent.status)+details('Propagation status',table(['Store','Status'],['graph','vector','cache','operational_metadata','backup_policy'].map(k=>[human(k),human(recent[k])])) )+'</section>':'')+'</div></div>';
}
function qualityPage() {
  const q=quality,g2=q.cases.find(x=>x.case_id==='G0002'),g81=q.cases.find(x=>x.case_id==='G0081');
  view.innerHTML=heading('Quality review','Historical queries are replayed at their original timestamps.')+
    '<div class="strip">'+metric('Retrieval cases passed',q.passed+' / '+q.total)+metric('Micro precision at 3',Math.round(100*q.precision_at_3)+'%')+
      metric('Prohibited memories returned',q.prohibited_returned)+metric('Provenance matches',q.provenance_matches+' / '+q.context_records)+'</div>'+
    '<section class="panel"><h2>Same request, memory on and off</h2><p class="desc">Listener U0002 asked for more Alka Yagnik songs in their usual playlist.</p>'+
    table(['Case','Mode','Retrieved context','Outcome'],[[g2.case_id,'Memory on',g2.actual_context.join(', '),g2.actual_policy],
    [g81.case_id,'Memory off','None',human(g81.actual_policy)]])+'</section><section class="panel secondary-panel"><h2>Golden case results</h2>'+
    '<p class="desc">Rank, final context, policy and control checks. Full field-level scores are in the project report.</p>'+
    details('Show all '+q.total+' cases',table(['Case','Scenario','Policy result','Checks'],q.cases.map(r=>[r.case_id,human(r.scenario),human(r.actual_policy),r.passed?'Pass':'Review'])))+'</section>';
}
function opsPage(){
  const m=dashboard.metrics;
  view.innerHTML=heading('Operations','Measurements from this demo listener’s workspace.')+
    '<div class="strip">'+metric('Retrieval P95 · target 250 ms',m.p95==null?'—':m.p95+' ms')+metric('Without memory',m.fallbacks+' / '+m.queries)+
    metric('Events in queue',m.queued)+metric('Deletions pending',m.pending_deletions)+'</div>'+
    '<div class="pair"><section class="panel"><h2>Processing</h2>'+table(['Measure','Value'],[
      ['Latest ingestion lag',m.last_ingestion_lag_ms==null?'No processed event yet':m.last_ingestion_lag_ms+' ms'],
      ['Cache hits / misses',(m.counters.cache_hits || 0)+' / '+(m.counters.cache_misses || 0)],['Graph writes',m.counters.graph_writes || 0],
      ['Write failures',m.counters.write_failures || 0],['P50 / P99 (ms)',(m.p50??'—')+' / '+(m.p99??'—')],['Dead letters',m.dead.length]])+
      m.dead.map(k=>'<button class="secondary" data-act="replay" data-id="'+esc(k)+'">Retry event</button>').join('')+
    '</section><section class="panel"><h2>Experiment outcomes</h2>'+table(['Mode','Queries','Personalized','Repeated'],m.experiments.map(r=>[human(r.mode),r.queries,r.with_context,r.repeated]))+
    '<p class="tiny">Repeated counts identical requests within a mode. Live retention or satisfaction needs a user study.</p></section></div>'+
    '<section class="panel secondary-panel"><h2>Recent audit events</h2>'+table(['Time (UTC)','Operation','Outcome','Memory IDs'],dashboard.traces.map(t=>[
      t.at.slice(11,19),human(t.action),human(t.outcome),t.used.join(', ') || '—']))+'</section>';
}
function policyPage(){
  view.innerHTML=heading('Schema & policy','The same rules govern event capture, retrieval and deletion.')+
    '<section class="panel"><h2>Retention by memory type</h2>'+table(['Type','Retention','Min. confidence','Can retrieve','Source'],policy.policies.map(r=>[
      human(r.memory_type),r.fact_retention_days+' days',r.minimum_confidence ?? '—',r.retrieval_allowed?'Yes':'No',human(r.eligible_sources || '—').replaceAll('|',', ')]))+
    '</section><div class="pair secondary-panel"><section class="panel"><h2>Graph and vector schema</h2><p>Each memory links one listener to a catalog entity. The edge stores its time window, source events, policy and confidence. The vector uses the same memory ID.</p><p class="tiny">Schema '+esc(policy.schema_version)+' · '+esc(policy.vector_model)+' · '+esc(policy.dimensions)+' dimensions</p></section>'+
    '<section class="panel"><h2>Policy review</h2><p>Personalization is limited to consenting adult demo listeners in the IN market and the original listening surface.</p>'+
    table(['Blocked reason','Count'],Object.entries(dashboard.metrics.counters).filter(([k])=>k.startsWith('blocked.')).map(([k,v])=>[human(k.slice(8)),v]))+'</section></div>';
}
async function render(){
  document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  updateNow();
  if(page==='session') desk();
  if(page==='memories') controlsPage();
  if(page==='ops') opsPage();
  if(page==='quality'){quality ||= await api('/v1/quality');qualityPage();}
  if(page==='policy'){policy ||= await api('/v1/policy');policyPage();}
}
async function run() {
  last=await api('/v1/respond',{utterance:utterance.trim(),surface,locale:'en-IN',max_context_items:3,context_token_budget:96,...(mode?{experiment:mode}:{})});
  await refresh();await render();
}
async function loadProfile(subject,create) {
  if(create) {
    const result=await api('/demo/session',{subject_id:subject,client:'browser'});
    demoToken=result.access_token;
    writeTab('lm:token',demoToken);
  }
  await refresh();surface=dashboard.user.primary_surface;mode='';utterance=example[surface];last=null;
  page='session';browseFilter='all';$('#search').value='';await run();
}
function formModal(title,fields,submit,action) {
  modal(title,'<form id="edit">'+fields+'<button class="primary" type="submit">'+esc(submit)+'</button></form>');
  $('#edit').addEventListener('submit',e=>{e.preventDefault();guard(async()=>{
    const form=e.target;form.querySelector('button[type=submit]').disabled=true;
    try{const message=await action(new FormData(form));dialog.close();last=null;await refresh();await render();note(message);}
    finally{if(form.isConnected)form.querySelector('button[type=submit]').disabled=false;}
  });});
}
const selectEntity=(current)=>field('Catalog item','<select name="entity">'+catalogOptions(current)+'</select>');
async function act(action,key) {
  const m=memories.find(x=>x.memory_id===key);
  if(action==='explain') {
    const v=await api('/v1/explain',{memory_id:key,trace_id:last.trace_id});
    modal('Why this memory was used',table(['Field','Value'],[['Memory',key],['Reason',human(v.relevance_reason)],['Source events',v.source_event_ids.join(', ')],['Policy',v.policy_id],['Confidence',v.confidence]]));return;
  }
  if(action==='feedback') {
    await api('/v1/feedback',{memory_id:key,trace_id:last.trace_id,response_id:last.response_id,verdict:'irrelevant'});
    await run();note('Feedback saved. The reply now uses the remaining eligible memories.');return;
  }
  if(action==='add' || action==='correct') {
    const edit=action==='correct';
    formModal(edit?'Correct preference':'Add a preference',selectEntity(m?.entity_id || 'artist_01')+
      (edit?'':field('Choice','<select name="polarity"><option value="positive">Prefer</option><option value="negative">Exclude</option></select>')+
      field('Surface','<select name="surface">'+Object.entries(names).map(([v,n])=>option(v,n,v===surface)).join('')+'</select>')),
      edit?'Save correction':'Save preference',async f=>{
        if(edit) await api('/v1/memories/'+key,{replacement_entity_id:f.get('entity'),expected_graph_version:m.graph_version,idempotency_key:id()},'PATCH');
        else await api('/v1/memories',{entity_id:f.get('entity'),polarity:f.get('polarity'),surface:f.get('surface'),idempotency_key:id()});
        return edit?'Correction saved. The previous version is in the timeline.':'Preference saved.';
      });return;
  }
  if(action==='delete') {
    formModal('Remove this memory?','<p>'+esc(m.normalized_fact)+'</p><p>Removal immediately stops retrieval and starts erasure.</p>','Remove memory',async()=>{
      const job=await api('/v1/memories/'+key,{idempotency_key:id()},'DELETE');const status=await api('/v1/deletions/'+job.job_id);
      return 'Deletion '+status.status+'. View the store-by-store receipt below.';});return;
  }
  if(action==='optout'){
    formModal('Opt out of memory?','<p>New memories and personalized retrieval will stop. You can still review or remove your existing records.</p>','Confirm opt-out',async()=>{await api('/v1/control',{action:'opt_out'});return 'Consent revoked.';});return;
  }
  if(['pause_memory','resume_memory','opt_in'].includes(action)) {
    const state=await api('/v1/control',{action});last=null;await refresh();await render();note('Memory is now '+human(state.control)+'.');return;
  }
  if(action==='export') {
    const data=await api('/v1/export');const a=document.createElement('a');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    a.href=url;a.download=dashboard.user.subject_id+'-memories.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    note('Exported '+data.memories.length+' active memories.');return;
  }
  if(action==='capture'){
    formModal('Record listening activity',field('Activity','<select name="kind"><option value="playback">Play</option><option value="save">Save</option><option value="follow">Follow</option></select>')+
      selectEntity('track_01'), 'Record event',async f=>{
      const u=dashboard.user,at=dashboard.at,key=id();
      const event={contract_version:'1.0.0',event_id:key,source_event_id:'ui-'+key,idempotency_key:key,subject_id:u.subject_id,authenticated_subject_id:u.subject_id,
        session_id:browserSession,surface,locale:u.locale,market:u.market,event_at:at,received_at:at,raw_expires_at:new Date(Date.parse(at)+30*86400000).toISOString(),
        event_type:f.get('kind'),source_class:'product_signal',consent_state:dashboard.consent,entity_reference:f.get('entity'),utterance:null,target_memory_id:null,
        payload:f.get('kind')==='playback'?{completion_fraction:.8}:{}};
      const v=await api('/v1/events',event);const receipt=await api('/v1/events/'+v.event_id);
      return 'Event '+receipt.status+' · '+human(receipt.reason || v.status)+'.';});return;
  }
  if(action==='replay'){await api('/v1/replay',{event_id:key});await refresh();await render();note('Event queued for retry.');}
}
let busy=false;
async function guard(fn) {
  if(busy) return;
  busy=true;
  try {note('');await fn();}
  catch(e){const message='Could not complete the request. '+human(e.message)+'.';note(message);if(dialog.open){let err=$('#dialogError');if(!err){err=document.createElement('p');err.id='dialogError';err.setAttribute('role','alert');$('#dialogBody').append(err);}err.textContent=message;}}
  finally{busy=false;}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.page)guard(async()=>{page=b.dataset.page;await refresh();await render();window.scrollTo(0,0);});
  if(b.dataset.filter){browseFilter=b.dataset.filter;view.querySelectorAll('[data-filter]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.filter===browseFilter)));browseCards();}
  if(b.dataset.shortcut)guard(async()=>{surface=b.dataset.shortcut;utterance=example[surface];await run();$('#request-panel').focus();});
  if(b.dataset.item)guard(async()=>{
    const item=dashboard.catalog.find(x=>x.entity_id===b.dataset.item);
    surface={track:'listening_ai',playlist:'playlist_ai',episode:'podcast_ai'}[item.entity_type];
    utterance=item.entity_type==='track'?'Recommend music like '+item.canonical_name+' by '+artistFor(item)+'.':
      item.entity_type==='episode'?'Explore the podcast about '+artistFor(item)+'.':'Build a playlist with '+artistFor(item)+'.';
    await run();$('#request-panel').focus();
  });
  if(b.dataset.jump)guard(async()=>{page='session';await render();$('#request-panel').focus();});
  if(b.dataset.surface)guard(async()=>{surface=b.dataset.surface;utterance=example[surface];last=null;await render();});
  if(b.dataset.act)guard(()=>act(b.dataset.act,b.dataset.id));
});
document.addEventListener('submit',e=>{if(e.target.id==='query'){
  e.preventDefault();guard(async()=>{utterance=$('#utterance').value;mode=$('#mode').value;const btn=e.target.querySelector('[type=submit]');btn.disabled=true;
    try{await run();}finally{if(btn.isConnected)btn.disabled=false;}});
}});
$('#search').addEventListener('input',()=>{
  if(!dashboard)return;
  if(page!=='session'){page='session';render();}else browseCards();
});
$('#profile').addEventListener('change',e=>guard(()=>loadProfile(e.target.value,true)));
guard(async()=>{try{await loadProfile(null,false);}catch(e){if(e.message!=='authentication_required')throw e;await loadProfile('U0001',true);}});
