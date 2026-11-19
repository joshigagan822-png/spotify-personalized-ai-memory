// Measure the full local HTTP request, including session lookup and the trace write.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATABASE_PATH:':memory:'},stdio:['ignore','pipe','inherit']});
try {
  const [line]=await once(child.stdout,'data');
  const origin=String(line).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  async function post(path,body,token){
    const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    if(!response.ok) throw Error('HTTP '+response.status);
    return response.json();
  }
  const {access_token}=await post('/demo/session',{subject_id:'U0001',client:'cli'});
  const report={};
  for(const mode of ['cold','warm']){
    const values=[];
    for(let i=0;i<50;i++){
      const start=performance.now();
      const r=await post('/v1/context/compose',{utterance:'What should I listen to next? '+(mode==='cold'?i:''),
        surface:'listening_ai',locale:'en-IN',context_token_budget:96,max_context_items:3},access_token);
      if(!r.context.length) throw Error('Unexpected fallback');
      values.push(performance.now()-start);
    }
    values.sort((a,b)=>a-b);
    report[mode]={requests:50,p50_ms:+values[24].toFixed(2),p95_ms:+values[47].toFixed(2),p99_ms:+values[49].toFixed(2)};
  }
  writeFileSync(new URL('../docs/local-latency.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(report);
} finally{child.kill();}
