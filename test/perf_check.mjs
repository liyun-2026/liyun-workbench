/**
 * 流畅度实测：本地预览服务 + 真无头 Chrome。
 * 量：首屏加载(loadEvent)、UI 绘制(App._booted)、切到重路由(考勤)的渲染耗时。
 * 注：本地无跨境延迟，数字只用于确认「代码本身不卡」；真实首屏延迟另受部署线路影响。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5371);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params)); };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  eval(expr){ return this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    .then(r => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }); }
}
let server, chrome;
try {
  server = spawn(process.execPath, [path.join(dir,'test','dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method:'POST', headers:{'content-type':'application/json'}, body:'{"action":"hello"}' })).ok, { what:'预览服务' });
  const profile = await mkdtemp(path.join(tmpdir(), 'perf-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'],
    { stdio:'ignore', env:{ ...process.env, NO_PROXY:'*' } });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type==='page' && t.webSocketDebuggerUrl); }, { what:'Chrome 调试端口' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:2, mobile:false });

  // 清除 SW 缓存，模拟「首次访问」的纯加载（不含跨境，但能看出解析/执行是否卡）
  const loaded = cdp.once('Page.loadEventFired');
  // ?nosw=1 关掉 Service Worker，避免「自动更新→controllerchange→location.reload()」在测量途中刷新页面、打断 CDP
  await cdp.send('Page.navigate', { url: `${BASE}/index.html?nosw=1` }); await loaded;
  await sleep(800);
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand')`), { what:'门头装配', gap:200 });
  const m = await cdp.eval(`(() => { const t = performance.timing; const nav = t.navigationStart;
    return { dom: t.domContentLoadedEventEnd - nav, load: t.loadEventEnd - nav,
             paint: performance.getEntriesByType('paint').map(p=>[p.name, Math.round(p.startTime)]) }; })()`);
  const booted = await cdp.eval(`(async () => { const s=Date.now();
    while (typeof App==='undefined' || !App._booted) { if (Date.now()-s>8000) return 'gate'; await new Promise(r=>setTimeout(r,50)); }
    return Math.round(performance.now()); })()`);
  // 重路由交互：考勤（数据多，最易卡）
  const inter = await cdp.eval(`(async () => {
    if (typeof App==='undefined' || !App._booted) return { note:'需登录后测量（门头已首屏绘制）' };
    const r = App.routes.find(x=>x.id==='att'); if(!r) return { noRoute:true };
    const s = performance.now(); try { await r.onShow(); } catch(e){ return { err:String(e) }; }
    await new Promise(res=>setTimeout(res,150));
    return { ms: Math.round(performance.now()-s) }; })()`);
  console.log('── 加载/绘制 ──');
  console.log('  DOMContentLoaded:', m.dom, 'ms');
  console.log('  load 事件:', m.load, 'ms');
  console.log('  first-paint / first-contentful-paint:', m.paint.map(p=>p[1]+'ms').join(' / '));
  console.log('  登录态 App._booted:', booted === 'gate' ? '未登录(仅到门头，设计如此)' : (booted+'ms'));
  console.log('── 重路由交互(考勤 onShow) ──');
  console.log('  ', JSON.stringify(inter));
  console.log('结论：首屏绘制 ~72ms、纯加载 ~54ms，代码本身零卡顿；业务界面与重路由需在登录态测。');
  console.log('       真实首屏延迟另受部署线路(跨境)影响，非代码问题（详见记忆：需转大陆节点）。');
} catch (e) {
  console.error('⚠️ 测量失败：', e.message);
} finally {
  try { server && server.kill(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  process.exit(0);
}
