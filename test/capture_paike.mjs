/**
 * 排课台截图（供使用手册）：登录 → 填模板 → 预览截面板图 → 生成整期截大课表图。
 *   node test/capture_paike.mjs
 * 输出：test/.shots/paike_1_panel.png / paike_2_grid.png （1440×900）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5335);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots');
const SUPER = { user: '李老师', pass: 'liyun2026' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params)); };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 90000) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
async function shot(cdp, name) {
  await sleep(320);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  📸 ' + name);
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'paike-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=5336',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5336/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

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
  if (!lg.ok) throw new Error('登录失败');
  await cdp.eval(`window.confirm = () => true; 'ok';`);
  console.log('已登录（' + lg.role + '），开始排课台截图\n');

  // 进课表页 → 排课台卡片 → 设节次 → 填模板 → 预览
  await cdp.eval(`(async () => { App.go('timetable'); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
  await cdp.eval(`(() => {
    [['早功','06:30','07:30'],['第1节','08:00','09:40'],['第2节','10:00','11:40'],['第3节','14:00','15:40'],['第4节','16:00','17:40']].forEach(p =>
      Store.upsert('periods', { name: p[0], start: p[1], end: p[2] }));
    Schedule.render();
    Schedule.ppFillPeriods();
    const data = [
      { title:'科学发声', cls:'BY05/BY06', room:'BY08' },
      { title:'即兴评述', cls:'BY05',      room:'BY08' },
      { title:'新闻播报', cls:'BY06',      room:'BY09' },
      { title:'形体',     cls:'BY05/BY06', room:'BY03' },
      { title:'晚功',     cls:'BY05/BY06', room:'BY08' }
    ];
    const rows = [...document.querySelectorAll('#ppRows .pprow')];
    rows.forEach((el, i) => { if (!data[i]) return;
      el.querySelector('.pp-title').value = data[i].title;
      el.querySelector('.pp-cls').value = data[i].cls;
      el.querySelector('.pp-room').value = data[i].room; });
    document.getElementById('ppFrom').value = '2026-07-10';
    document.getElementById('ppTo').value = '2026-07-23';
    Schedule.ppPreview();
    return 1;
  })()`);
  await cdp.eval(`document.getElementById('ppRows').scrollIntoView({ block: 'center' }); 'ok';`);
  await sleep(500);
  await shot(cdp, 'paike_1_panel.png');

  // 生成整期 → 等提示消失 → 截大课表
  await cdp.eval(`Schedule.ppGenerate(false); 'ok';`);
  await sleep(2600);
  await cdp.eval(`document.getElementById('gridWrap').scrollIntoView({ block: 'center' }); 'ok';`);
  await sleep(500);
  await shot(cdp, 'paike_2_grid.png');

  console.log('\n✅ 排课台截图完成 → test/.shots/');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
