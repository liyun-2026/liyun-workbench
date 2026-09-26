/**
 * 桌面侧栏「花鸟白描」效果预览（真 Chrome，CDP）。
 *
 *   node test/side_art_preview.mjs [port]
 *
 * 登录一次，然后在真实界面上把侧栏背景换成各张白描图，逐一截图：
 *   - 沉底（画按栏宽铺满、沉在栏底，上方留白）
 *   - 满铺（cover 裁切铺满整栏）
 *   - 两种浓淡（_m 中 / _s 淡）
 * 另外拍一张「手机端去掉纹样（纯色大方）」。
 *
 * 产出：test/.shots/sideart/real-*.png
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5355);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'sideart');
const ACCT = { user: '__sideart__', pass: 'sideart2026' };

const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };
const NB   = { width: 1280, height: 800, dsf: 2, mobile: false };
const MOB  = { width: 390,  height: 844, dsf: 2, mobile: true };

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
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server; const chromes = []; const shots = [];
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };

const FILE = f => `/test/.shots/sideart/${f}.png`;

/* 侧栏换成白描图：pos=bottom(沉底) / cover(满铺) / mid(中下悬) */
const artCss = (f, mode = 'bottom', size = '100% auto') =>
  `.side{background-image:url("${FILE(f)}") !important;background-repeat:no-repeat !important;`
  + `background-position:center ${mode === 'cover' ? 'center' : mode === 'mid' ? '58%' : 'bottom 24px'} !important;`
  + `background-size:${mode === 'cover' ? 'cover' : size} !important}`;

/* 手机端：去掉顶栏/底栏全部纹样（纯色大方） */
const MOB_PLAIN = `.topbar,.tabbar{background-image:none !important}`;

const setArt = (cdp, css) => cdp.eval(`(() => {
  let s = document.getElementById('__sideart');
  if (${JSON.stringify(css)} === null) { if (s) s.remove(); return 'off'; }
  if (!s) { s = document.createElement('style'); s.id = '__sideart'; document.head.appendChild(s); }
  s.textContent = ${JSON.stringify(css)};
  return 'ok';
})()`);

async function shot(cdp, name){
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  shots.push(name);
  console.log('  📸 ' + name);
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: o.mobile });

async function cleanUI(cdp){
  await sleep(900);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) s.remove();
    const t = document.getElementById('toast'); if (t) t.classList.remove('on');
    const d = document.querySelector('.drawer'); if (d) d.classList.remove('on'); return 'ok'; })()`);
  await sleep(250);
}

/* 一个场景：注入 -> 截图 -> 清掉 */
async function scene(cdp, tag, css){
  await setArt(cdp, css);
  await cleanUI(cdp);
  await shot(cdp, `real-${tag}.png`);
  await setArt(cdp, null);
  await sleep(150);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok,
    { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'sideart-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  await view(cdp, MOB);
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` });
  await loaded;
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand')`), { what: '门头装配', tries: 40, gap: 200 });
  await sleep(700);
  const lg = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ACCT.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ACCT.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent, role: Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + (lg.err || ''));
  console.log('已登录，角色：' + lg.role);
  await cdp.eval(`App.go('home')`);

  /* ── 桌面 1440（侧栏 236px）── */
  await view(cdp, DESK);
  await cleanUI(cdp);
  console.log('\n桌面 1440 · 侧栏 236px');
  await scene(cdp, 'D0-cur', null);
  await scene(cdp, 'P1-zhushi-82', artCss('zhushi_pure', 'bottom', '82% auto'));
  await scene(cdp, 'P2-songhe-82', artCss('songhe_pure', 'bottom', '82% auto'));
  await scene(cdp, 'P3-lanhua-82', artCss('lanhua_pure', 'bottom', '82% auto'));
  await scene(cdp, 'P4-zhushi-100', artCss('zhushi_pure', 'bottom', '100% auto'));
  await scene(cdp, 'P5-songhe-mid', artCss('songhe_pure', 'mid', '82% auto'));
  await scene(cdp, 'P6-zhushi-mid', artCss('zhushi_pure', 'mid', '82% auto'));
  console.log('\n更淡一档');
  await scene(cdp, 'P7-zhushi-lite', artCss('zhushi_lite', 'bottom', '82% auto'));
  await scene(cdp, 'P8-songhe-lite', artCss('songhe_lite', 'bottom', '82% auto'));
  await scene(cdp, 'P9-lanhua-lite', artCss('lanhua_lite', 'bottom', '82% auto'));

  /* ── 笔记本 1280（侧栏 200px）── */
  await view(cdp, NB);
  await cleanUI(cdp);
  console.log('\n笔记本 1280 · 侧栏 200px');
  await scene(cdp, 'Q1-zhushi-82', artCss('zhushi_pure', 'bottom', '82% auto'));
  await scene(cdp, 'Q2-songhe-82', artCss('songhe_pure', 'bottom', '82% auto'));

  /* ── 手机：去纹样（简单大方）── */
  await view(cdp, MOB);
  await cleanUI(cdp);
  console.log('\n手机 390 · 去掉纹样');
  await scene(cdp, 'M0-cur', null);
  await scene(cdp, 'M1-plain', MOB_PLAIN);

  console.log('\n✅ 共 ' + shots.length + ' 张 -> ' + OUT);
} catch(e){
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}
