/**
 * ==5.75== 出效果图：班委登记的账落到教务端「今日检查」长什么样
 *   node test/hw_merge_shots.mjs [端口]
 * 产出 test/.shots/hwmerge/{merge-desktop.png, roster-miss-m390.png}
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5499);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'hwmerge');
const ADMIN = { user: '效果图教务', pass: 'shotpass123' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch { /* 等 */ } await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('超时')), 5000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('连不上')); }; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach((f) => f(m.params)); };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise((res) => { const set = this.events.get(method) || new Set(); const fn = (p) => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome;
try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: 'server' });
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const DBG = 9477;
  const profile = await mkdtemp(path.join(tmpdir(), 'hwshot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded; await sleep(600);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ADMIN.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ADMIN.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1500));
  })()`);

  const seeded = await cdp.eval(`(() => {
    const d = Util.today();
    const cls = Store.upsert('classes', { id: null, name: '05班' });
    const names = ['林清和','周予安','陈书言','许亦然','赵嘉禾','孙望舒','刘知远','郭曼青'];
    const s = names.map((n, i) => Store.upsert('students', { id: null, name: n, classId: cls.id, ord: i + 1 }));
    const hw = Store.upsert('homework', { clsId: cls.id, date: d, text: '普通话声母辨正 20 分钟 + 气息练习', abbr: '普通' });
    const dep = (sid, done, i) => Store.upsert('hw:' + hw.id, { id: 'r' + i, studentId: sid, done, by: '陈书言' });
    dep(s[0].id, 1, 1); dep(s[1].id, 1, 2); dep(s[2].id, 1, 3);
    dep(s[3].id, 1, 4); dep(s[4].id, 0, 5); dep(s[5].id, 1, 6); dep(s[6].id, 0, 7);
    Store.set('_hkCls', cls.id); Store.set('_hkDate', d);
    App.go('homework'); Homework.renderChk();
    return { cls: cls.id, date: d };
  })()`);
  await sleep(700);

  /* 桌面：今日检查整块 */
  const rect = await cdp.eval(`(() => {
    const el = document.getElementById('hkBody');
    const card = el.closest('.card') || el.parentElement;
    const r = card.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(r.width + 16, 1416), height: Math.min(r.height + 16, 980) };
  })()`);
  const s1 = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 2 } });
  await writeFile(path.join(OUT, 'merge-desktop.png'), Buffer.from(s1.data, 'base64'));

  /* 手机：账号没挂学籍的提示 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  /* 第二张：真建一个「账号没挂到学籍」的学生，用它登录去看作业页 */
  await cdp.eval(`(async () => {
    await Auth.call('users', { op: 'create', user: '未挂档学员', pass: 'stushot1234', role: 'student',
                               name: '未挂档学员', studentId: 'gid_旧档案' });
    return true;
  })()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const l2 = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await l2; await sleep(800);
  const r2 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '未挂档学员';
    document.getElementById('gPass').value = 'stushot1234';
    await Auth.submit(); await new Promise(r => setTimeout(r, 1600));
    const off = !document.getElementById('gate').classList.contains('on');
    App.go('stuHw');
    await new Promise(r => setTimeout(r, 600));
    const m = document.getElementById('main'); if (m) m.scrollTop = 0;
    const card = document.getElementById('stuHwEntryCard');
    return { off, visible: card ? (getComputedStyle(card).display !== 'none') : false,
             txt: (document.getElementById('stuHwEntry') || {}).innerText || '' };
  })()`);
  console.log('  学生登录：' + (r2.off ? '成功' : '失败') + ' · 提示卡可见：' + r2.visible);
  await sleep(500);
  const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, 'roster-miss-m390.png'), Buffer.from(s2.data, 'base64'));

  console.log('📸 ' + path.join(OUT, 'merge-desktop.png'));
  console.log('📸 ' + path.join(OUT, 'roster-miss-m390.png'));
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}
