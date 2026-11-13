/**
 * 手册补拍：量化页 —— capture_shots.mjs 种子脚本对 'cls:课堂互动:+5' 的 split 解析
 * 有 bug（delta 取成了 undefined，页面上三个按钮显示「null」），先修数据再截。
 *   node docs/handbook-boss-2026-11-13/capture_quant_fix.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5344;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'quant-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5345',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5345/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '王敏';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败（王敏）');
  console.log('已登录：王敏（' + lg.role + '）');

  /* 修三条 cls: 规则的分值（种子脚本 split 解析 bug 留下的 undefined） */
  await cdp.eval(`(() => {
    const FIX = { '课堂互动': 5, '评述集体通关': 15, '课堂纪律（当场扣）': -1 };
    Store.list('quant_rules').forEach(r => {
      if ((r.key || '').indexOf('cls:') === 0 && FIX[r.label] != null)
        Store.upsert('quant_rules', Object.assign({}, r, { delta: FIX[r.label] }));
    });
    return Store.list('quant_rules').filter(r => (r.key || '').indexOf('cls:') === 0).map(r => r.label + ' ' + r.delta);
  })()`);

  await cdp.eval(`(async () => { App.go('quant'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,500)); return 1; })()`);
  await sleep(400);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, '05-quant.png'), Buffer.from(r.data, 'base64'));
  console.log('📸 shots/05-quant.png（已修 null 分值）');
  console.log('✅ 补拍完成');
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
