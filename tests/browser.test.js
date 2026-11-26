import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';

const chrome=['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
async function until(fn){
  let failure;
  for(let i=0;i<120;i++){
    try{const result=await fn();if(result)return result;}catch(e){failure=e;}
    await delay(100);
  }
  throw failure || Error('Browser state did not appear');
}
test('desktop and narrow listening desk supports account signup, feedback and guest logout',
  {skip:!chrome,timeout:90000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'listening-ui-'));
  const reserve=createServer();
  await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  const app=spawn(process.execPath,['server.js','--port',String(port)],{env:{...process.env,DATABASE_PATH:join(dir,'test.sqlite')},stdio:'ignore'});
  const browser=spawn(chrome,['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0','--user-data-dir='+dir+'/browser','about:blank'],{stdio:'ignore'});
  t.after(async()=>{browser.kill();app.kill();await delay(300);await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const origin='http://127.0.0.1:'+port;
  await until(async()=>(await fetch(origin+'/health/ready')).ok);
  const debug=await until(async()=>(await readFile(dir+'/browser/DevToolsActivePort','utf8')).split('\n')[0]);
  const pages=await (await fetch('http://127.0.0.1:'+debug+'/json')).json();
  const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  t.after(()=>ws.close());
  let sequence=0;
  function send(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const listener=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;ws.removeEventListener('message',listener);m.error?reject(Error(m.error.message)):resolve(m.result);};
      ws.addEventListener('message',listener);ws.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression){
    const result=await send('Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || 'Page evaluation failed');
    return result.result.value;
  }
  const select=value=>evaluate("document.querySelector('#profile').value='"+value+"';document.querySelector('#profile').dispatchEvent(new Event('change'))");
  await send('Page.navigate',{url:origin});
  await until(()=>evaluate("!!document.querySelector('[data-item]') && !!document.querySelector('#profile option[value=signup]')"));
  await select('signup');
  await evaluate("const form=document.querySelector('#edit');form.email.value='test@example.test';form.password.value='browser-test-passphrase';form.eligible.checked=true;form.requestSubmit()");
  await until(()=>evaluate("document.querySelector('#profile').value==='personal' && !document.querySelector('#dialog').open"));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("document.querySelector('[data-vote=more]').closest('details').open=true;document.querySelector('[data-vote=more]').click()");
  await until(()=>evaluate("!!document.querySelector('[data-vote=undo]')"));
  assert.ok(await evaluate("document.querySelector('#search').getBoundingClientRect().width>0"));
  await select('logout');
  await until(()=>evaluate("document.querySelector('#profile').value==='U0001'"));
});
