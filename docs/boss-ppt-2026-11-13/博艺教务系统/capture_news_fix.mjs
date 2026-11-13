/**
 * 补拍：老师端新闻页（ppt_news.png）——主脚本在新闻段被中断后单独补。
 *   node docs/boss-ppt-2026-11-13/博艺教务系统/capture_news_fix.mjs
 * dev 数据沿用已灌种子；新闻真拉央视，拉不到兜底。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(DIR, '..', '..', '..');
const PORT = 5362, CPORT = 5364;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(DIR, 'assets');
const TEACH = { user: '张伟', pass: 'liyun2026' };
const SUPER = { user: '李老师', pass: 'liyun2026' };
const SIZES = {};

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

async function shotRegion(cdp, jsFind, name, pad = 14){
  const okScroll = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return 0;
    el.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()`);
  if (!okScroll){ throw new Error('找不到元素：' + name); }
  await sleep(320);
  const b = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }; })()`);
  if (!b || b.w < 4 || b.h < 4){ throw new Error('元素没尺寸：' + name); }
  let w = b.w + pad * 2, h = b.h + pad * 2;
  if (w > b.vw || h > b.vh){
    const k = Math.min(b.vw / w, b.vh / h);
    w *= k; h *= k;
    console.log(`  ⚠ ${name} 比视口大，缩到 ${Math.round(w)}×${Math.round(h)}`);
  }
  const x = Math.max(0, Math.min(b.x + b.w / 2 - w / 2, b.vw - w));
  const y = Math.max(0, Math.min(b.y + b.h / 2 - h / 2, b.vh - h));
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), scale: 2 },
  });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  SIZES[name] = [Math.round(w) * 2, Math.round(h) * 2];
  console.log(`  ✂ ${name}  ${Math.round(w)}×${Math.round(h)} (比例 ${(w / h).toFixed(2)}) @2x`);
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'ppt-news-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=' + CPORT,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${CPORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('李老师登录失败');
  console.log('已登录：李老师（' + lg.role + '）');

  /* 先确保张伟（授课老师）账号存在：上一轮 dev-reset 清过库 */
  const mk = await cdp.eval(`(async () => {
    try {
      const j = await Auth.call('users', { op:'createMany', list:[{ user:'张伟', name:'张伟', role:'teacher', pass:'liyun2026' }] });
      return { ok: true, msg: (j && j.created && j.created.length) ? '已创建' : '可能已存在' };
    } catch (e) { return { ok: /已存在|占/.test(e.message || ''), msg: e.message }; }
  })()`);
  console.log('张伟账号：' + mk.msg);
  if (!mk.ok) throw new Error('建号失败：' + mk.msg);

  /* 绕过 Auth.logout（有 confirm 弹窗会卡死 headless）——直接清登录令牌再刷新 */
  await cdp.eval(`(async () => {
    Store.setSecret('token', ''); Store.setSecret('me', '');
    location.reload(); return 1;
  })()`);
  await sleep(2600);

  const lg2 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(TEACH.user)};
    document.getElementById('gPass').value = ${JSON.stringify(TEACH.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg2.ok) throw new Error('张伟登录失败');
  console.log('已登录：张伟（' + lg2.role + '）');

  await cdp.eval(`(async () => { App.go('news'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,300)); return 1; })()`);
  await sleep(600);
  const src = await cdp.eval(`(async () => {
    Store.set('news_cache', null);
    News.fetch();
    await new Promise(r => setTimeout(r, 9000));
    const c = Store.get('news_cache');
    return { real: !!(c && c.items && c.items.length) };
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
      App.go('news'); await new Promise(r=>setTimeout(r,500));
      return 1;
    })()`);
  }
  console.log('新闻数据：' + (src.real ? '真实拉取央视接口成功' : '真实接口未通，已用演示条目兜底'));

  await cdp.eval(`(async () => { App.go('news'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,200)); return 1; })()`);
  await sleep(500);
  await shotRegion(cdp, "document.getElementById('nNewsBody').closest('.card')", 'ppt_news.png');
  console.log('✅ 补拍完成');
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
