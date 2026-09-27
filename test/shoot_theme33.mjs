/**
 * 五端「云淡」皮肤 · 真机截图核对
 *   node test/shoot_theme33.mjs [port]
 * 产物：test/.shots/theme33/{d,m}-<port>.png
 *
 * ⚠️ 两个坑，别再踩：
 *  1) 先 App.go(页面) 再改 body.className。反过来的话 App.render() 会把类名重置回真实角色，
 *     五张图会全是一个颜色。
 *  2) 读颜色/截图前必须禁用过渡 —— index.html 有
 *     `.nav button,.btn,.card,.chip{transition:all .18s}`，
 *     否则刚切完类名那一帧读到的还是上一个端口的色（会误判成「按钮没跟端口」）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5391);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'theme33');
const SUPER = { user: '配色核对', pass: 'themepass123' };

const PORTS = [
  ['teacher', 'role-teacher'],
  ['admin',   'role-admin'],
  ['both',    'role-both'],
  ['student', 'stu'],
  ['super',   'role-super'],
];

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

let server, chrome, shots = 0;
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };
const shot = async (cdp, name) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  shots++; console.log('  📸 ' + name);
};

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'theme-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded;
  await sleep(600);

  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2200));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
  console.log('已登录首位教务');

  // 禁过渡（见文件头注释 ②）
  await cdp.eval(`(() => {
    const s = document.createElement('style'); s.id = '__shotkill';
    s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(s); return 'ok';
  })()`);

  // 电脑端：逐端
  await cdp.eval(`App.go('home'); true`);
  await sleep(700);
  for (const [label, cls] of PORTS) {
    await cdp.eval(`(() => { document.body.className = ${JSON.stringify(cls)}; Port.syncChrome(); return 'ok'; })()`);
    await sleep(260);
    await shot(cdp, `d-${label}.png`);
  }

  // 手机端：逐端
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  for (const [label, cls] of PORTS) {
    await cdp.eval(`(() => { document.body.className = ${JSON.stringify(cls)}; Port.syncChrome(); return 'ok'; })()`);
    await sleep(260);
    await shot(cdp, `m-${label}.png`);
  }

  // 高视口：900px 高时导航按钮铺满侧栏、白描被压在按钮后面量不到，
  // 拉高到 1500 才露出侧栏下半段，用来核对白描到底渲染没渲染、浓淡如何。
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  for (const [label, cls] of PORTS) {
    await cdp.eval(`(() => { document.body.className = ${JSON.stringify(cls)}; Port.syncChrome(); return 'ok'; })()`);
    await sleep(260);
    await shot(cdp, `tall-${label}.png`);
  }
  const artInfo = await cdp.eval(`(() => {
    document.body.className = 'role-teacher';
    const cs = getComputedStyle(document.querySelector('.side'), '::before');
    const side = getComputedStyle(document.querySelector('.side'));
    return { content: cs.content, opacity: cs.opacity, bg: cs.backgroundColor,
      maskImg: (cs.maskImage || cs.webkitMaskImage || '').slice(0, 60),
      maskSize: cs.maskSize, maskPos: cs.maskPosition,
      sideBg: side.backgroundColor, sideH: document.querySelector('.side').getBoundingClientRect().height };
  })()`);
  console.log('\n侧栏 ::before 计算样式 →', JSON.stringify(artInfo, null, 1));

  console.log('\n✅ 共 ' + shots + ' 张 → ' + OUT);
} catch (e) {
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset().catch(()=>{});
  if (chrome) chrome.kill();
  if (server) server.kill();
  await sleep(300); process.exit(process.exitCode || 0);
}
