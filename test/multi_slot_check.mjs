/**
 * ==5.81== 同机双账号：`?slot=2` 那一路跟默认那一路各登各的，谁也不顶掉谁
 *   node test/multi_slot_check.mjs [端口]
 *
 * 主理人 2026-11-28：「这台电脑放着看板端，我要再登录另一个账号」。
 * 同一个浏览器共用一个 localStorage，一个键只存一个 token ——
 * 以前后登的那个会把常驻看板顶掉。现在网址带 slot 就走独立命名空间。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5533);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const A = { user: '看板窗口账号', pass: 'slotpass123' };
const B = { user: '工作窗口账号', pass: 'slotpass456' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 80, gap = 300, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch { /* 等 */ } await sleep(gap); }
  throw new Error('等不到' + what);
}
let pass = 0, failed = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { failed++; console.log('  ❌ ' + label + (extra ? '\n        → ' + extra : '')); } };
const section = (t) => console.log('\n' + t);

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
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: 'server' });
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const DBG = 9496;
  const profile = await mkdtemp(path.join(tmpdir(), 'slot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const go = async (url) => { const l = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await l; await sleep(700); };
  const login = async (u, p) => cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(u)};
    document.getElementById('gPass').value = ${JSON.stringify(p)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1200));
    return { name: (Auth._me && Auth._me.name) || '', role: (Auth._me && Auth._me.role) || '',
             gate: document.getElementById('gate').classList.contains('on') };
  })()`);
  const whoami = async () => cdp.eval(`(() => ({
    name: (Auth._me && Auth._me.name) || '',
    hasToken: !!Auth.token(),
    gate: document.getElementById('gate').classList.contains('on'),
    title: document.title,
    classes: Store.list('classes').map(c => c.name),
    slotKeys: Object.keys(localStorage).filter(k => k.indexOf('bysdash:') === 0 && k.indexOf('@') > 0).length
  }))()`);

  section('▶ 1. 默认那一路（= 常驻看板）：登录 A 并建一个班');
  await go(`${BASE}/?nosw=1`);
  const a1 = await login(A.user, A.pass);
  await cdp.eval(`(() => { Store.upsert('classes', { id: null, name: 'A窗的班' }); return true; })()`);
  const a2 = await whoami();
  ok(a1.gate === false, 'A 登录成功（默认命名空间）', JSON.stringify(a1));
  ok(a2.classes.indexOf('A窗的班') >= 0, 'A 那里能看到自己建的班', JSON.stringify(a2.classes));
  const tokenA = await cdp.eval(`Auth.token()`);

  section('▶ 2. 打开 ?slot=2：必须是干净的另一路（不共享 A 的登录）');
  await go(`${BASE}/?slot=2&nosw=1`);
  const s1 = await whoami();
  ok(s1.hasToken === false && s1.gate === true, 'slot=2 是未登录状态（登录门在）', JSON.stringify(s1));
  ok(s1.classes.length === 0, '没登录时什么都看不到（不会蹭到 A 的缓存）', JSON.stringify(s1.classes));

  section('▶ 3. 在 slot=2 登录 B');
  await cdp.eval(`(async () => {
    /* B 账号由 A 来建：这里直接走接口，不切窗口 */
    return true;
  })()`);
  const b1 = await cdp.eval(`(async () => {
    /* 借默认那一路的 token 建号：临时拿 A 的 token 调一次 users.create */
    const tokA = ${JSON.stringify(tokenA)};
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'users', token: tokA, op: 'create',
        user: ${JSON.stringify(B.user)}, pass: ${JSON.stringify(B.pass)}, role: 'office', name: '学管办公室' }) });
    return await r.json();
  })()`);
  ok(b1 && b1.ok !== false, 'B 账号建好了', JSON.stringify(b1).slice(0, 160));
  const b2 = await login(B.user, B.pass);
  await cdp.eval(`(() => { Store.upsert('classes', { id: null, name: 'B窗的班' }); return true; })()`);
  const b3 = await whoami();
  const tokenB = await cdp.eval(`Auth.token()`);
  ok(b2.gate === false, 'B 在 slot=2 登录成功', JSON.stringify(b2));
  ok(b3.title.indexOf('窗口 2') >= 0, '这个窗口的标题写了「窗口 2」，一眼分得清', b3.title);

  section('▶ 4. 回到默认那一路：A 还在，没被 B 顶掉');
  await go(`${BASE}/?nosw=1`);
  const a3 = await whoami();
  ok(a3.name === a1.name, '默认那一路还是 A（这就是看板能一直挂着的原因）', a3.name + ' vs ' + a1.name);
  ok(a3.classes.indexOf('A窗的班') >= 0, 'A 的班级还在', JSON.stringify(a3.classes));
  /* 两个账号同属一个机构，业务数据本来就该一样（B 建的班 A 也看得见）——
     这里要看的是「会话」没被顶掉：token 还是 A 自己的那一个。 */
  const tokenA2 = await cdp.eval(`Auth.token()`);
  ok(tokenA2 === tokenA, '默认那一路的 token 还是 A 自己的（没被 B 覆盖）', 'tokens differ');
  ok(tokenA2 !== tokenB, '跟 B 的 token 不是同一个（各登各的）', 'same token!');
  ok(a3.name !== b2.name, '两路是不同账号（A≠B）', a3.name + ' / ' + b2.name);

  section('▶ 5. 再回 slot=2：B 也还在（关掉重开不用重登）');
  await go(`${BASE}/?slot=2&nosw=1`);
  const b4 = await whoami();
  ok(b4.name === b2.name, 'slot=2 还是 B', b4.name + ' vs ' + b2.name);
  ok(b4.classes.indexOf('B窗的班') >= 0, 'B 的班级还在', JSON.stringify(b4.classes));
  ok(b4.slotKeys > 0, '两个命名空间的键并存', 'slot 键 ' + b4.slotKeys + ' 个');

  console.log('\n────────────────────────────────────────');
  console.log(failed ? `❌ 失败 ${failed} / ${pass + failed} 项` : `✅ 全部通过（${pass} 项）`);
  if (failed) process.exitCode = 1;
} catch (e) {
  console.log('\n❌ 脚本中断：' + (e && e.message));
  process.exitCode = 1;
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}
