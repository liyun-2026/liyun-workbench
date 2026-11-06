/* 一次性：拍看板 5.23 真实成品三帧（sign / info / 编辑模式）给用户验收 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY='*';
const dir=path.dirname(new URL(import.meta.url).pathname).split('/').map(decodeURIComponent).join('/');
const PORT=5546, BASE=`http://127.0.0.1:${PORT}`;
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jfetch=(u,o={})=>fetch(u,{...o,signal:AbortSignal.timeout(8000)});
async function waitFor(fn,{tries=40,gap=500,what=''}={}){for(let i=0;i<tries;i++){try{const v=await fn();if(v)return v}catch{}await sleep(gap)}throw new Error('等不到'+what)}
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.waiting=new Map()}
 static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('CDP'))});const c=new Cdp(ws);
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.waiting.has(m.id)){const{res,rej}=c.waiting.get(m.id);c.waiting.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result)}};return c}
 send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>this.waiting.set(id,{res,rej}))}
 async eval(expr,timeout=90000){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout});
  if(r.exceptionDetails)throw new Error('页面报错：'+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value}}
const srv=(()=>{try{return spawn(process.execPath,[dir+'/test/dev-server.mjs',String(PORT)],{cwd:dir,stdio:'ignore'})}catch(e){return {kill(){}}}})();
let chrome;
try{
  await waitFor(async()=>(await jfetch(`${BASE}/api/sync`,{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"hello"}'})).ok,{what:'dev'});
  try{await jfetch(`${BASE}/api/dev-reset`,{method:'POST'})}catch{}
  const profile=await mkdtemp(path.join(tmpdir(),'bd-chrome-'));
  chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=5547',`--user-data-dir=${profile}`,'--no-proxy-server','--window-size=1920,1080','about:blank'],{stdio:'ignore'});
  const target=await waitFor(async()=>{const l=await(await jfetch('http://127.0.0.1:5547/json/list')).json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)},{what:'Chrome'});
  const cdp=await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:BASE+'/?board=1'}); await sleep(4500);
  await cdp.eval(`(async()=>{if(!Auth.mode)await Auth.probe();
    document.getElementById('gUser').value='李老师';document.getElementById('gPass').value='liyun2026';
    await Auth.submit();await new Promise(r=>setTimeout(r,2600));
    if(!document.getElementById('gate').classList.contains('on')) Board.enter();
    await new Promise(r=>setTimeout(r,1500)); return 1})()`);
  const shot=async name=>{const r=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile('/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/docs/board-redesign-shots/'+name,Buffer.from(r.data,'base64'));console.log('拍好',name)};
  await cdp.eval(`Store.set('_boardLayout',{preset:'sign',order:null}); Board.render && Board.render(); document.getElementById('bdEditbar')?.remove(); 1`);
  await sleep(1200); await shot('final-sign.png');
  await cdp.eval(`Store.set('_boardLayout',{preset:'info',order:null}); Board.render(); 1`);
  await sleep(1200); await shot('final-info.png');
  await cdp.eval(`(document.getElementById('bdGear')||document.querySelector('.bd-edit-btn')||document.querySelector('[onclick*=editEdit]')||{click(){Board.edit&&Board.edit()}}).click?document.querySelectorAll('.bd-edit,[id^=bdEdit]').forEach(e=>e.click()):Board.edit&&Board.edit(); 1`);
  await sleep(800); await shot('final-edit.png');
  console.log('DONE');
}catch(e){console.error('FAIL:',e.message);process.exitCode=2}
finally{try{chrome&&chrome.kill()}catch{};try{srv.kill()}catch{}}
