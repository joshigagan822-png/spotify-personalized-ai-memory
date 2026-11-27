const $=s=>document.querySelector(s),view=$('#view'),dialog=$('#dialog'),search=$('#search');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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



let state,feed,page='session',type='all',version=0,timer;
const labels={all:'All',track:'Songs',episode:'Podcasts',playlist:'Playlists'};
async function api(path,body){const r=await fetch('/v1/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error.replaceAll('_',' ')),{status:r.status});return d;}
function modal(title,html){$('#dialogBody').innerHTML='<h2>'+esc(title)+'</h2>'+html;if(!dialog.open)dialog.showModal();}
dialog.onclose=()=>{if(!dialog.open)$('#dialogBody').replaceChildren();};
function welcome(){disposePlayers();state=null;version++;clearTimeout(timer);document.body.classList.add('welcome');
view.innerHTML='<section class="entry"><div class="entry-copy"><div class="brand"><span class="sound" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>Spotify Memory</div><h1>Your listening space.</h1><p>Find songs, podcasts and playlists. Choose the artists you love and shape what you hear next.</p><div class="actions"><button class="primary" data-auth="signup">Sign up</button><button class="secondary" data-auth="login">Log in</button><button class="link" data-auth="guest">Try demo</button></div></div><div class="entry-art" aria-hidden="true"><div class="vinyl"></div><div class="sleeve"></div></div></section>';}
function fail(e){if(e.status===401&&!dialog.open)welcome();$('#alert').textContent=e.message;}
async function enter(){state=await api('state');document.body.classList.remove('welcome');$('#profile').textContent=state.guest?'Guest account':'My account';page='session';type='all';search.value='';await refresh();}
function auth(mode){const signup=mode==='signup';
modal(signup?'Create your account':'Log in','<form id="auth"><label class="field">Email<input name="email" type="email" autocomplete="username" required></label><label class="field">Password<input type="password" name="password" maxlength="128" '+(signup?'minlength="4" placeholder="At least 4 characters" autocomplete="new-password"':'autocomplete="current-password"')+' required></label>'+(signup?'':'<button type="button" data-forgot class="link">Forgot password?</button>')+'<p role="status"></p><button class="primary">'+(signup?'Sign up':'Log in')+'</button></form>');
$('#auth').onsubmit=async e=>{e.preventDefault();const f=e.target,btn=f.querySelector('button.primary');btn.disabled=true;try{const result=await api(mode,{email:f.email.value,password:f.password.value});dialog.close();await enter();if(result.recoveryCode)showKey(result.recoveryCode,signup?'taste':'home');else if(signup)taste(true);}catch(err){f.querySelector('p').textContent=err.message;}finally{btn.disabled=false;}};}
function showKey(code,next){
 modal('Save your recovery code','<p>Keep this code in your password manager. You’ll need it to reset your password.</p><label class="field">Recovery code<input readonly value="'+esc(code)+'"></label><button class="primary" id="saved-code">I saved my code</button>');
 $('#saved-code').onclick=()=>{dialog.close();if(next==='taste')taste(true);if(next==='login')auth('login');};
}
function forgot(email){
 modal('Reset your password','<form id="reset"><label class="field">Email<input name="email" type="email" autocomplete="username" value="'+esc(email)+'" required></label><label class="field">Saved recovery code<input name="code" autocapitalize="none" spellcheck="false" required></label><label class="field">New password<input name="password" type="password" autocomplete="new-password" minlength="4" maxlength="128" placeholder="At least 4 characters" required></label><p role="status"></p><button class="primary">Reset password</button> <button type="button" class="link" data-auth="login">Back to login</button></form>');
 $('#reset').onsubmit=async e=>{e.preventDefault();const f=e.target,btn=f.querySelector('.primary');btn.disabled=true;
 try{const result=await api('reset-password',Object.fromEntries(new FormData(f)));showKey(result.recoveryCode,'login');}
 catch(err){f.querySelector('p').textContent=err.message;}finally{btn.disabled=false;}};
}
function taste(skip){modal('Favourite artists','<form id="taste"><p>Choose up to three artists or enter their names.</p><datalist id="options">'+state.options.map(a=>'<option value="'+esc(a)+'">').join('')+'</datalist>'+[0,1,2].map(i=>'<label class="field">Artist '+(i+1)+'<input name="artist" list="options" maxlength="80" value="'+esc(state.artists[i])+'"></label>').join('')+'<button class="primary">Save artists</button> '+(skip?'<button type="button" class="link" data-close>Skip for now</button>':'')+'</form>');
$('#taste').onsubmit=async e=>{e.preventDefault();try{await api('memory',{action:'artists',artists:new FormData(e.target).getAll('artist').map(a=>a.trim()).filter(Boolean)});dialog.close();await refresh();}catch(err){fail(err);}};}
const panel=(t,body)=>'<section class="panel"><h2>'+esc(t)+'</h2>'+body+'</section>';
const players=new Set();
let playerAPI,activePlayer,apiLoading=false;
function disposePlayers(){
 activePlayer=null;
 for(const controller of players)controller.destroy();
 players.clear();
}
function mountPlayers(){
 const slots=view.querySelectorAll('[data-player-host]');
 if(!slots.length)return;
 if(!playerAPI){
  if(apiLoading)return;
  apiLoading=true;
  const script=document.createElement('script');
  script.src='https://open.spotify.com/embed/iframe-api/v1';script.async=true;
  script.onerror=()=>{apiLoading=false;script.remove();};
  document.head.append(script);return;
 }
 for(const slot of slots){
  if(slot.dataset.mounted)continue;
  slot.dataset.mounted='1';
  const target=document.createElement('div');slot.append(target);
  playerAPI.createController(target,{uri:'spotify:'+slot.dataset.playerHost,width:'100%',height:152},controller=>{
   if(!slot.isConnected){controller.destroy();return;}
   players.add(controller);
   const frame=slot.querySelector('iframe');
   if(frame){frame.className='inline-player';frame.title=slot.dataset.title;}
   let playing=false;
   function activate(){
    if(!slot.isConnected||activePlayer===controller)return;
    const last=activePlayer;activePlayer=controller;
    if(last)last.pause();
   }
   controller.addListener('playback_started',()=>{playing=true;activate();});
   controller.addListener('playback_update',event=>{
    const nowPlaying=event.data.isPaused===false && !event.data.isBuffering;
    if(nowPlaying&&!playing)activate();
    if(nowPlaying || event.data.isPaused===true)playing=nowPlaying;
   });
  });
 }
}
window.onSpotifyIframeApiReady=api=>{playerAPI=api;mountPlayers();};
function card(t){
 const url='https://open.spotify.com/'+t.type+'/'+t.id;
 return '<article class="musiccard"><div class="player-slot">'+(t.image?'<img class="pending-art" src="'+esc(t.image)+'" alt="" loading="lazy">':'')+'<div data-player-host="'+esc(t.key)+'" data-player="'+esc(t.key)+'" data-title="Play '+esc(t.title)+' on Spotify"></div></div><footer><div class="record-caption"><strong>'+esc(t.title)+'</strong><a class="spotify-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a></div><details><summary aria-label="Options for '+esc(t.title)+'">⋯</summary><div class="menu"><button data-source="'+esc(t.key)+'">View source</button>'+(!state.paused?['more','less'].map(v=>'<button data-vote="'+v+'" data-key="'+esc(t.key)+'">'+(v==='more'?'More':'Less')+' like this</button>').join(''):'')+(state.votes[t.key]?'<button data-undo="'+esc(t.key)+'">Undo feedback</button>':'')+'</div></details></footer></article>';
}
async function refresh(remember=false){
 const rev=++version;const q=search.value.trim();const nextFeed=page==='session'?await api('feed',{type,q,remember}):null;
 const nextState=await api('state');if(rev!==version)return;disposePlayers();state=nextState;
 document.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-current',b.dataset.page===page?'page':'false'));
 if(page==='session'){feed=nextFeed;view.innerHTML='<div class="home-heading"><h1>Home</h1><div class="filters">'+Object.entries(labels).map(([k,v])=>'<button data-filter="'+k+'" aria-pressed="'+(type===k)+'">'+v+'</button>').join('')+'</div></div><section class="shelf"><h2>'+esc(q?'Matches for “'+q+'”':state.artists.length||state.terms.length||Object.keys(state.votes).length?'Tailored to your memory & search taste':'Discover something new')+'</h2><p class="desc">'+(feed.search?'Spotify catalog · India':'Featured on Spotify · full search unavailable')+'</p><div class="musicgrid">'+feed.items.map(card).join('')+'</div>'+(!feed.items.length?'<p>No matching results.</p>':'')+(q&&!feed.search?'<a class="spotify-link" href="https://open.spotify.com/search/'+encodeURIComponent(q)+'" target="_blank" rel="noopener">Search Spotify ↗</a>':'')+'</section>';mountPlayers();return;}
 const rows=state.quality.map(r=>'<tr><td>'+esc(r.method)+'</td><td>'+r.n+'</td><td>'+(r.hit===null?'—':Math.round(r.hit*100)+'%')+'</td><td>'+(r.rank?.toFixed(2)||'—')+'</td></tr>').join('');
 const pages={memories:panel('Memory in use','<p>'+(state.paused?'Memory is paused. Resume when you want to use your saved taste again.':'Your favourite artists and recent searches shape Home. Feedback moves only the item you rated.')+'</p><button class="secondary" data-pause>'+(state.paused?'Resume memory':'Pause memory')+'</button>')+panel('Favourite artists','<p>'+esc(state.artists.join(', ')||'No favourites yet.')+'</p><button class="secondary" data-taste>Edit artists</button>')+panel('Recent searches',state.terms.map(q=>'<p>'+esc(q)+' <button class="link" data-forget="'+esc(q)+'">Forget</button></p>').join('')||'<p>No saved searches yet.</p>')+panel('Your feedback',Object.entries(state.votes).map(([k,v])=>'<p>'+esc(v.title)+' · '+esc(v.choice)+' <button class="link" data-undo="'+esc(k)+'">Undo</button></p>').join('')||'<p>No ratings yet.</p>')+panel('Clear memory','<button class="link" data-clear>Clear my listening memory</button>'),
 quality:panel('Recommendation quality','<p>Your first positive rating tests where the song appeared before you rated it. A smaller mean rank is better.</p><div class="table-wrap"><table><tr><th>Method</th><th>Ratings</th><th>Hit@5</th><th>Mean rank</th></tr>'+rows+'</table></div>'),
 ops:panel('Workspace activity','<p>Remembered feed requests: '+state.feeds+'</p><p>Saved searches: '+state.terms.length+'</p><p>Rated items: '+Object.keys(state.votes).length+'</p>'),
 policy:panel('How your memory works','<p>This '+(state.guest?'guest':'personal')+' workspace stores artist choices, search terms, item feedback and ranking observations. Opening a player does not count as listening to a full song.</p><p>Memory is '+(state.paused?'paused':'active')+'. Edit, pause or clear it in Memory controls. Community popularity counts positive item ratings.</p>')};
 view.innerHTML='<h1>'+({memories:'Memory controls',quality:'Quality review',ops:'Operations',policy:'Schema & policy'}[page])+'</h1><div class="stack">'+pages[page]+'</div>';
}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;try{
 $('#alert').textContent='';
 if('forgot'in d){forgot($('#auth').email.value);return;}
 if(d.auth==='guest'){await api('guest',{});await enter();return;}if(d.auth){auth(d.auth);return;}
 if('close'in d){dialog.close();return;}if(b.id==='profile'){modal(state.guest?'Guest account':'My account','<button class="secondary" data-logout>Log out</button>');return;}
 if('logout'in d){await api('logout',{});dialog.close();welcome();return;}
 if(d.page){page=d.page;clearTimeout(timer);await refresh();return;}if(d.filter){type=d.filter;await refresh();return;}
 if(d.source){const t=feed.items.find(x=>x.key===d.source);if(t)modal('Why this appeared','<p>'+esc(t.title)+'</p><p>'+esc(t.reason)+'</p>');return;}
 if('taste'in d){taste(false);return;}
 if('clear'in d){modal('Clear listening memory?','<p>This removes your artists, searches, ratings and quality observations.</p><button class="secondary" data-confirm>Clear memory</button>');return;}
 if(d.vote)await api('rate',{batch:feed.batch,key:d.key,choice:d.vote});
 else if(d.undo)await api('memory',{action:'undo',key:d.undo});
 else if(d.forget)await api('memory',{action:'forget',term:d.forget});
 else if('pause'in d)await api('memory',{action:'pause',paused:!state.paused});
 else if('confirm'in d){await api('memory',{action:'clear'});dialog.close();}else return;
 await refresh();}catch(err){fail(err);}});
search.oninput=()=>{clearTimeout(timer);version++;page='session';timer=setTimeout(()=>refresh(true).catch(fail),600);};
enter().catch(e=>e.status===401?welcome():fail(e));
