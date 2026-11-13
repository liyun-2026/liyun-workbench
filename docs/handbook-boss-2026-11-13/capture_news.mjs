/**
 * 手册补拍：教务端「每日新闻」页（page-news）—— capture_shots.mjs 没覆盖这一页。
 *   node docs/handbook-boss-2026-11-13/capture_news.mjs
 * 复用 capture_shots.mjs 的 CDP 连接方式；dev 数据沿用上次灌好的演示种子（落盘不丢）。
 * 新闻优先真拉央视接口（JSONP），拉不到再种子兜底并如实标记。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 5342;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.dirname(fileURLToPath(import.meta.url));
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

  const profile = await mkdtemp(path.join(tmpdir(), 'news-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5343',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5343/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  /* 每日新闻页 roles:['teacher','both'] —— 是授课老师端的页面，super 进不去，必须用老师号 */
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '张伟';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败（张伟）');
  console.log('已登录：张伟（' + lg.role + '）');

  /* 先清当日缓存，再真拉一次央视接口；拉不到就种子兜底（如实标记 demo） */
  const src = await cdp.eval(`(async () => {
    Store.set('news_cache', null);
    News.fetch();
    await new Promise(r => setTimeout(r, 9000));
    const c = Store.get('news_cache');
    if (c && c.items && c.items.length) return { real: true, n: c.items.length };
    return { real: false, n: 0 };
  })()`);
  if (!src.real) {
    await cdp.eval(`(async () => {
      const now = new Date(); const pad = x => String(x).padStart(2, '0');
      const hm = () => pad(now.getHours()) + ':' + pad(now.getMinutes());
      const mk = (t, b) => ({ id: Util.uid(), title: t, url: '', brief: b, time: hm(), date: Util.today() });
      Store.set('news_cache', { date: Util.today(), _u: Date.now(), items: [
        mk('（演示数据）今日要闻头条占位标题一则', '本地环境拉不到央视接口时的兜底条目，仅用于版式示意'),
        mk('（演示数据）第二条要闻占位标题', '示意条目'),
        mk('（演示数据）第三条要闻占位标题', '示意条目'),
        mk('（演示数据）第四条要闻占位标题', '示意条目'),
        mk('（演示数据）第五条要闻占位标题', '示意条目'),
        mk('（演示数据）第六条要闻占位标题', '示意条目'),
      ]});
      return 1;
    })()`);
  }
  console.log('新闻数据：' + (src.real ? `真实拉取央视接口成功（${src.n} 条）` : '真实接口未通，已用演示条目兜底'));

  await cdp.eval(`(async () => { App.go('news'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,500)); return 1; })()`);
  await sleep(400);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, 'shots', '04-news.png'), Buffer.from(r.data, 'base64'));
  console.log('📸 shots/04-news.png（' + (src.real ? '真实新闻' : '演示兜底') + '）');
  console.log('✅ 补拍完成');
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
