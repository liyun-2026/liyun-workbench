/**
 * v32 真机核验：桌面五端侧栏白描（真实 index.html 映射）+ 手机端去纹样。
 * 登录一次，逐一切换 body 角色类截图；不注入任何 CSS，验证的是线上真实规则。
 * 产出：test/.shots/v32/real-D-<role>.png 与 real-M-<role>.png
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5361);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'v32');
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
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params)); };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

let server; const chromes = []; const shots = [];
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: o.mobile });
const shot = async (cdp, name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); shots.push(name); console.log('  📸 ' + name); };
const cleanUI = async (cdp) => { await sleep(800);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) s.remove();
    const t = document.getElementById('toast'); if (t) t.classList.remove('on');
    const d = document.querySelector('.drawer'); if (d) d.classList.remove('on'); return 'ok'; })()`);
  await sleep(250); };
const setRole = (cdp, role) => cdp.eval(`(() => {
  document.body.classList.forEach(c => { if (/^role-/.test(c) || c === 'stu') document.body.classList.remove(c); });
  document.body.classList.add(${JSON.stringify(role)});
  return document.body.className; })()`);
const dumpSkin = (cdp, tag) => cdp.eval(`(() => { const s = document.querySelector('.side'); const cs = getComputedStyle(s); const rb = getComputedStyle(document.body);
  return ${JSON.stringify(tag)} + ' | cls=' + document.body.className + ' | rail=' + rb.getPropertyValue('--rail').trim() + ' | sideBg=' + cs.backgroundColor + ' | img=' + cs.backgroundImage.slice(0,60); })()`);

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });

  const profile = await mkdtemp(path.join(tmpdir(), 'v32-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, MOB);
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` }); await loaded;
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand')`), { what: '门头装配', tries: 40, gap: 200 });
  await sleep(700);
  const lg = await cdp.eval(`(async () => { if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ACCT.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ACCT.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, role: Auth.role() }; })()`);
  if (!lg.ok) throw new Error('登录失败：' + (lg.err || ''));
  console.log('已登录，初始角色：' + lg.role);
  await cdp.eval(`App.go('home')`);
  await cleanUI(cdp);
  console.log('\n原生 super 状态：');
  console.log('  ' + await dumpSkin(cdp, 'native'));
  await shot(cdp, 'real-D-superN.png');   /* 原生 super 真实渲染（songhe） */
  const rect = await cdp.eval(`(() => { const nav=document.querySelector('.nav'); const last=nav&&nav.lastElementChild; const sb=document.querySelector('.side');
    return { sideH:Math.round(sb.getBoundingClientRect().height), navTop: nav?Math.round(nav.getBoundingClientRect().top):null,
             navBottom: nav?Math.round(nav.getBoundingClientRect().bottom):null,
             lastBottom: last?Math.round(last.getBoundingClientRect().bottom):null,
             artTopCSS: (function(){ var cs=getComputedStyle(sb); var m=cs.backgroundSize.match(/([\\d.]+)%/); return m?Math.round(sb.getBoundingClientRect().height*(1 - (parseFloat(cs.backgroundPosition.split(' ')[1]||'100%').replace('%','')/100))):null; })() }; })()`);
  console.log('布局:', JSON.stringify(rect));

  const ROLES = [
    ['teacher', 'role-teacher', '竹石'],
    ['both',    'role-both',    '竹石'],
    ['admin',   'role-admin',   '兰花'],
    ['stu',     'stu',          '兰花'],
    ['super',   'role-super',   '松鹤'],
  ];

  /* 桌面 1440（侧栏 236px）— 逐端真实映射 */
  await view(cdp, DESK); await cleanUI(cdp);
  console.log('\n桌面 1440 · 五端侧栏白描（真实映射）');
  for (const [key, cls, art] of ROLES) {
    await setRole(cdp, cls); await sleep(350);
    console.log('  ' + await dumpSkin(cdp, cls));
    await cleanUI(cdp);
    await shot(cdp, `real-D-${key}.png`);
    console.log(`   ${key.padEnd(8)} -> ${art}`);
  }

  /* 笔记本 1280（侧栏 200px）— 抽查教师/首位 */
  await view(cdp, NB); await cleanUI(cdp);
  console.log('\n笔记本 1280 · 侧栏 200px');
  for (const [key, cls] of [['teacher','role-teacher'],['super','role-super']]) {
    await setRole(cdp, cls); await sleep(300); await cleanUI(cdp);
    await shot(cdp, `real-NB-${key}.png`);
  }

  /* 隔离测量：隐藏导航+品牌牌，确认白描真实纵向边界（不压菜单） */
  await view(cdp, DESK); await setRole(cdp, 'role-teacher'); await sleep(300);
  await cdp.eval(`(() => { let s=document.getElementById('__iso'); if(!s){s=document.createElement('style');s.id='__iso';document.head.appendChild(s);} s.textContent='.nav,.side .brand,.splash,.drawer{display:none !important}'; })()`);
  await sleep(400); await cleanUI(cdp);
  await shot(cdp, 'real-D-teacher-iso.png');
  console.log('\n已出 real-D-teacher-iso.png（隐藏导航，纯白描边界）');

  /* 手机 390 — 去纹样核验（顶栏+底栏纯色） */
  await view(cdp, MOB); await cleanUI(cdp);
  console.log('\n手机 390 · 去纹样核验');
  await setRole(cdp, 'role-super'); await sleep(300); await cleanUI(cdp);
  await shot(cdp, 'real-M-super.png');
  await setRole(cdp, 'role-teacher'); await sleep(300); await cleanUI(cdp);
  await shot(cdp, 'real-M-teacher.png');

  console.log('\n✅ 共 ' + shots.length + ' 张 -> ' + OUT);
} catch(e) {
  console.error('\n💥 ' + (e && e.message)); process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300); process.exit(process.exitCode || 0);
}
