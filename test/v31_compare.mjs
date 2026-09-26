/**
 * v31 改前/改后对照出图（真 Chrome，CDP）。
 *
 *   node test/v31_compare.mjs [port]
 *
 * 做法：登录一次，先拍「改后」；再用一段「回退样式」把
 *   ① 底部标签栏（图标 19 / 文字 10 / 内边距 7 / 内容区 108）
 *   ② 五端暗纹（从 `git show HEAD:index.html` 里取 v30 那一整块）
 * 覆盖回 v30，再拍「改前」。同一台机器、同一时刻，只有这两处变量不同。
 *
 * 产出：test/.shots/v31cmp/{after,before}-{mob,desk}[-dark].png
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5351);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'v31cmp');
const SUPER = { user: '__v31cmp__', pass: 'v31cmp2026' };

const MOB  = { width: 390,  height: 844, dsf: 2, mobile: true };
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };

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

/* ── 从 git 取 v30 的整块暗纹 CSS ─────────────────────────── */
const OLD_HTML = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const A = '/* ════════ 五端复合暗纹（自动生成';
const B = '/* ════════ 学生端：整页水印';
const OLD_PATTERNS = OLD_HTML.slice(OLD_HTML.indexOf(A), OLD_HTML.indexOf(B));

const REVERT_CSS = `
/* 回退到 v30：底部标签栏尺寸 */
.tabbar button .ico{font-size:19px !important}
.tabbar button{font-size:10px !important;gap:3px !important;padding:7px 2px !important}
.tabbar{padding:7px 10px !important}
.main{padding-bottom:calc(108px + env(safe-area-inset-bottom,0)) !important}
/* 回退到 v30：五端暗纹（整块搬过来，靠层叠顺序覆盖） */
${OLD_PATTERNS}
`;

const setRevert = (cdp, on) => cdp.eval(`(() => {
  let s = document.getElementById('__revert_v30');
  if (${on}) {
    if (!s) { s = document.createElement('style'); s.id = '__revert_v30'; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(REVERT_CSS)};
  } else if (s) s.remove();
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

async function open(cdp){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` });
  await loaded;
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand')`), { what: '门头装配', tries: 40, gap: 200 });
  await sleep(700);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) s.remove();
    const t = document.getElementById('toast'); if (t) t.classList.remove('on'); return 'ok'; })()`);
  await sleep(300);
}

async function pair(cdp, tag, vp){
  await view(cdp, vp);
  await sleep(350);
  await open(cdp);
  await cdp.eval(`App.go('home')`);
  await sleep(1200);
  await cdp.eval(`(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); return 'ok'; })()`);
  await sleep(200);
  await shot(cdp, `after-${tag}.png`);
  await setRevert(cdp, true);
  await sleep(500);
  await shot(cdp, `before-${tag}.png`);
  await setRevert(cdp, false);
  await sleep(200);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok,
    { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'v31cmp-chrome-'));
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
  await open(cdp);
  const lg = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent, role: Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + (lg.err || ''));
  console.log('已登录，角色：' + lg.role);

  console.log('\n浅色 · 手机 / 电脑');
  await pair(cdp, 'mob', MOB);
  await pair(cdp, 'desk', DESK);

  console.log('\n深色 · 手机 / 电脑');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await pair(cdp, 'mob-dark', MOB);
  await pair(cdp, 'desk-dark', DESK);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

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
