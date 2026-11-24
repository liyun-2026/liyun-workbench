/**
 * 换设备密钥「删除」功能验证 + 截图
 *   node test/devkey_purge_check.mjs [端口]
 * 输出：test/.shots/sq/devkey.png
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5361);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'sq');
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

let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? ' — ' + extra : '')); };

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'dk-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5362', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5362/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on') };
  })()`);
  if (!lg.ok) throw new Error('登录失败');

  const r = await cdp.eval(`(async () => {
    const out = {};
    /* 造三枚 + 作废两枚 */
    const a = await Auth.call('device_key', { op: 'make' });
    const b = await Auth.call('device_key', { op: 'make' });
    const c = await Auth.call('device_key', { op: 'make' });
    await Sync.pull(true);
    const before = Settings.devKeys().map(k => k.id);
    out.before = before.length;
    await Auth.call('device_key', { op: 'revoke', id: before[0] });
    await Auth.call('device_key', { op: 'revoke', id: before[1] });
    await Sync.pull(true);
    out.afterRevoke = Settings.devKeys().length;
    out.deadCount = Settings.devKeys().filter(k => k.used).length;

    /* 删一枚「还在有效期的」应当被服务端拒（先确认它没 used） */
    const alive = Settings.devKeys().find(k => !k.used);
    try { await Auth.call('device_key', { op: 'purge', id: alive.id }); out.alivePurge = 'allowed'; }
    catch(e){ out.alivePurge = 'blocked: ' + e.message; }

    /* 删一枚已失效的 */
    const dead = Settings.devKeys().find(k => k.used);
    const p1 = await Auth.call('device_key', { op: 'purge', id: dead.id });
    await Sync.pull(true);
    out.afterPurge = Settings.devKeys().length;
    out.gone = !Settings.devKeys().some(k => k.id === dead.id);

    /* 再生成一枚，然后一键清空失效的 */
    await Auth.call('device_key', { op: 'make' });
    await Sync.pull(true);
    out.beforeDead = Settings.devKeys().length;
    const p2 = await Auth.call('device_key', { op: 'purgeDead' });
    await Sync.pull(true);
    out.removed = p2.removed;
    out.left = Settings.devKeys().length;
    out.leftAllAlive = Settings.devKeys().every(k => !k.used);

    /* 截图前再摆出「有一条失效」的样子，好让删除按钮出现 */
    const alive2 = Settings.devKeys();
    if (alive2[0]) await Auth.call('device_key', { op: 'revoke', id: alive2[0].id });
    await Auth.call('device_key', { op: 'make' });
    await Sync.pull(true);
    Settings.renderDevKeys();
    await new Promise(r => setTimeout(r, 400));
    out.btns = document.querySelectorAll('#devKeyList .chip-x').length;
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));

  t('生成三枚', r.before === 3, '实际 ' + r.before);
  t('作废两枚后仍在列表', r.afterRevoke === 3, '实际 ' + r.afterRevoke);
  t('有效期内那枚不许删（服务端拦）', String(r.alivePurge).startsWith('blocked'), r.alivePurge);
  t('删掉一枚已失效的', r.afterPurge === 2 && r.gone === true, '剩 ' + r.afterPurge);
  t('一键清空失效的只删失效', r.left === 2 && r.leftAllAlive === true, '删 ' + r.removed + ' 剩 ' + r.left);

  /* 截图卡片 */
  await cdp.eval(`(() => {
    App.go('settings');
    const t = document.getElementById('advToggle');
    if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
    const c = document.getElementById('devKeyCard');
    if (c) { c.style.display = ''; c.scrollIntoView({ block: 'center', behavior: 'instant' }); }
  })()`);
  await sleep(800);
  const box = await cdp.eval(`(() => {
    const c = document.getElementById('devKeyCard');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  })()`);
  const pad = 14, w = Math.min(box.w + pad * 2, box.vw), h = Math.min(box.h + pad * 2, box.vh);
  const img = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
            width: Math.round(w), height: Math.round(h), scale: 2 },
  });
  await writeFile(path.join(OUT, 'devkey.png'), Buffer.from(img.data, 'base64'));
  console.log('  📸 devkey.png');

  console.log(`\n${fail ? '❌' : '✅'} ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
