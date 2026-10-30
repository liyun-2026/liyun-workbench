/* 一次性探针：今日页「其他功能」下拉是否被内容遮挡（elementFromPoint 实证 + 截图） */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY='*';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname).split('/').map(decodeURIComponent).join('/'), '..');
const PORT=5531, BASE=`http://127.0.0.1:${PORT}`;
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jfetch=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(8000)});
async function waitFor(fn,{tries=40,gap=500,what=''}={}){for(let i=0;i<tries;i++){try{const v=await fn();if(v)return v}catch{}await sleep(gap)}throw new Error('等不到'+what)}
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.waiting=new Map()}
 static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('CDP 连不上'))});const c=new Cdp(ws);
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.waiting.has(m.id)){const{res,rej}=c.waiting.get(m.id);c.waiting.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result)}};return c}
 send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>this.waiting.set(id,{res,rej}))}
 async eval(expr,timeout=90000){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout});
  if(r.exceptionDetails)throw new Error('页面报错：'+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value}}
const srv=spawn(process.execPath,[path.join(dir,'test','dev-server.mjs'),String(PORT)],{cwd:dir,stdio:'ignore'});
let chrome; const fails=[];
try{
  await waitFor(async()=>(await jfetch(`${BASE}/api/sync`,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"hello"}'})).ok,{what:'dev 服务'});
  try{await jfetch(`${BASE}/api/dev-reset`,{method:'POST'})}catch{}
  const profile=await mkdtemp(path.join(tmpdir(),'dd-chrome-'));
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5532',`--user-data-dir=${profile}`,'--no-proxy-server','about:blank'],{stdio:'ignore'});
  const target=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5532/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'Chrome'});
  const cdp=await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:BASE+'/'}); await sleep(4500);
  const lg=await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='李老师';document.getElementById('gPass').value='liyun2026';
    await Auth.submit();await new Promise(r=>setTimeout(r,2400));
    return {ok:!document.getElementById('gate').classList.contains('on')}})()`);
  if(!lg.ok) throw new Error('登录失败');
  await cdp.eval(`(async()=>{App.go('today');await new Promise(r=>setTimeout(r,600));return 1})()`);
  const res=await cdp.eval(`(()=>{
    const more=document.querySelector('.xf-more'); if(!more) return {err:'找不到 .xf-more'};
    more.classList.add('open');
    const panel=more.querySelector('.xf-more-panel');
    if(!panel||getComputedStyle(panel).display==='none') return {err:'面板没展开'};
    const items=[...panel.querySelectorAll('a,button')].filter(e=>e.offsetParent!==null||panel.contains(e));
    const out=[];
    for(const it of items){
      const r=it.getBoundingClientRect();
      if(r.height<4) continue;
      const cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
      const top=document.elementFromPoint(cx,cy);
      const covered=!(top===it||panel.contains(top)||top.contains(it));
      out.push({t:(it.textContent||'').trim().slice(0,8), covered, top: top?top.className.toString().slice(0,30):'null'});
    }
    const pr=panel.getBoundingClientRect();
    return {items:out, panel:{x:Math.round(pr.left),y:Math.round(pr.top),w:Math.round(pr.width),h:Math.round(pr.height)}};
  })()`);
  console.log(JSON.stringify(res,null,1));
  const bad=(res.items||[]).filter(i=>i.covered);
  console.log(bad.length? '✗ 被遮挡条目: '+bad.map(b=>b.t).join(',') : '✅ 面板全部条目浮于内容之上');
  const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile('/tmp/dd-today.png',Buffer.from(r.data,'base64'));
  process.exitCode = bad.length?1:0;
}catch(e){console.error('PROBE FAIL:',e.message);process.exitCode=2}
finally{try{chrome&&chrome.kill()}catch{};try{srv.kill()}catch{}}
