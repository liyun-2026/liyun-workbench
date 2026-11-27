/**
 * ==5.77== 出图：班干部入口在「今天没作业 / 昨天的还没登记」时到底长什么样
 *   node test/officer_entry_shot.mjs [端口]
 * 产出 test/.shots/hwmerge/officer-entry-m390.png
 * 走真身份：教务建号 → 指定学习委员 → 布置昨天的作业 → 班干部登录 → 我的作业
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5511);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'hwmerge');
const ADMIN = { user: '出图教务', pass: 'shotpass123' };
const STU = { user: '陈书言', pass: 'stushot1234' };

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

  const DBG = 9483;
  const profile = await mkdtemp(path.join(tmpdir(), 'offshot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    'about:blank'], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded; await sleep(700);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ADMIN.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ADMIN.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1500));
  })()`);

  /* 教务：建班 + 学员 + 指定学习委员 + 昨天的作业（今天一条都没有） */
  const seeded = await cdp.eval(`(async () => {
    const dayOff = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const y = dayOff(-1);
    const cls = Store.upsert('classes', { id: null, name: '05班' });
    const names = ['林清和','周予安','陈书言','许亦然','赵嘉禾','孙望舒','刘知远','郭曼青'];
    const s = names.map((n, i) => Store.upsert('students', { id: null, name: n, classId: cls.id, ord: i + 1 }));
    Store.upsert('officers', { clsId: cls.id, title: '学习委员', studentId: s[2].id });
    Store.upsert('homework', { clsId: cls.id, date: y, text: '完成今日一镜到底，录制视频提交到QQ群相册', abbr: '一镜' });
    Store.upsert('homework', { clsId: cls.id, date: y, text: '普通话声母辨正 20 分钟', abbr: '声母' });
    await Sync.push();
    await Auth.call('users', { op: 'create', user: ${JSON.stringify(STU.user)}, pass: ${JSON.stringify(STU.pass)},
                               role: 'student', name: ${JSON.stringify(STU.user)}, studentId: s[2].id });
    return { cls: cls.id, y, sid: s[2].id };
  })()`);
  console.log('已铺数据：昨天 ' + seeded.y + ' 两条作业，今天一条没有');

  /* 换班干部登录 */
  await cdp.eval(`(() => { try { Store.setSecret('token',''); } catch(e){ try { localStorage.removeItem('bysdash$secret:token'); } catch(_){} } return true; })()`);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded; await sleep(900);
  const r = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(STU.user)};
    document.getElementById('gPass').value = ${JSON.stringify(STU.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200));
    const off = !document.getElementById('gate').classList.contains('on');
    App.go('stuHw');
    await new Promise(r => setTimeout(r, 800));
    const m = document.getElementById('main'); if (m) m.scrollTop = 0;
    const box = document.getElementById('stuHwEntry');
    return { off, role: document.body.className,
             txt: box ? box.innerText.replace(/\\s+/g,' ').slice(0,200) : '',
             hasSelect: !!(box && box.querySelector('select')),
             chips: box ? box.querySelectorAll('button.chip').length : 0 };
  })()`);
  console.log('班干部登录：' + (r.off ? '成功' : '失败') + ' · 有日期下拉：' + r.hasSelect + ' · 可点按钮 ' + r.chips + ' 个');
  console.log('入口文案：' + r.txt);
  await sleep(600);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, 'officer-entry-m390.png'), Buffer.from(shot.data, 'base64'));
  console.log('📸 ' + path.join(OUT, 'officer-entry-m390.png'));
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}
