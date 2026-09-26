/**
 * 视觉核对：五端皮肤 + 手机/电脑骨架（真 Chrome 截图，登录后的真实界面）
 *   node test/shot_ports.mjs [port]
 *
 * 做法：登录一次（首个账号＝首位教务），然后**逐个改 body 的端口类名**
 * 再截图 —— 皮肤全靠 body.role-* / body.stu 这套 CSS 变量驱动，
 * 改类名等同于「切到那个端口看」，不必来回建号登录。
 *
 * 产物落到 test/.shots/ports/
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5341);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'ports');
const SUPER = { user: '测试教务', pass: 'shotpass123' };

const PORTS = [
  ['super',   'role-super'],
  ['admin',   'role-admin'],
  ['both',    'role-both'],
  ['teacher', 'role-teacher'],
  ['stu',     'stu'],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
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
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value; }
}

let server; const chromes = []; const shots = [];
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name){
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, name);
  await writeFile(file, Buffer.from(r.data, 'base64'));
  shots.push(file);
}

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'ports-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5342', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5342/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // 手机视口（iPhone 15 Pro Max：430×932 @3x）
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 3, mobile: true });
  const loaded = cdp.once('Page.loadEventFired');
  /* ⚠️ 一定要带 ?nosw=1：不带的话首次加载会注册 Service Worker，
     新的 SW 一接管控制权，主页就按「自动更新」逻辑 reload 一次，
     CDP 这边还在跑的 evaluate 会被打断，报 "Inspected target navigated or closed"。 */
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded;
  await sleep(600);

  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, mode: Auth.mode, cls: document.body.className };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
  console.log('已登录（' + r.mode + '）body.class = "' + r.cls + '"');

  const REAL = r.cls;

  // 顶栏/侧栏 logo 实测尺寸（这就是「logo 还很大」要量化的东西）
  const box = await cdp.eval(`(() => {
    const g = e => { const el = document.querySelector(e); if (!el) return null; const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return { bar: g('#topbar'), brand: g('#topBrand .brand-lock'), side: g('.side .brand-lock'), name: g('#topName'), more: g('.t-more') };
  })()`);
  console.log('手机顶栏实测 →', JSON.stringify(box));

  // 每个端口的主题面 + theme-color 是否跟着走
  const tint = await cdp.eval(`(() => {
    const out = {};
    for (const [label, cls] of ${JSON.stringify(PORTS)}) {
      document.body.className = cls; Port.syncChrome();
      const cs = getComputedStyle(document.body);
      out[label] = [cs.getPropertyValue('--tint').trim(), cs.getPropertyValue('--rail').trim(), cs.getPropertyValue('--accent').trim(),
        document.querySelector('meta[name="theme-color"]').getAttribute('content')].join('  ');
    }
    return out;
  })()`);
  for (const k of Object.keys(tint)) console.log(('  ' + k).padEnd(12) + 'tint/rail/accent/theme-color → ' + tint[k]);

  // 逐个端口截图
  for (const [label, cls] of PORTS) {
    await cdp.eval(`document.body.className = ${JSON.stringify(cls)}; Port.syncChrome(); App.go('home'); true`);
    await sleep(900);
    await shot(cdp, `m-${label}-home.png`);
  }
  for (const [label, cls] of PORTS) {
    await cdp.eval(`document.body.className = ${JSON.stringify(cls)}; App.go('settings'); true`);
    await sleep(700);
    await shot(cdp, `m-${label}-set.png`);
  }

  // 电脑视口
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  for (const [label, cls] of PORTS) {
    await cdp.eval(`document.body.className = ${JSON.stringify(cls)}; App.go('home'); true`);
    await sleep(800);
    await shot(cdp, `d-${label}-home.png`);
  }

  // 复原
  await cdp.eval(`document.body.className = ${JSON.stringify(REAL)}; true`);
  console.log('\n✅ 截完 ' + shots.length + ' 张 → test/.shots/ports/');
} catch (e) {
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}
