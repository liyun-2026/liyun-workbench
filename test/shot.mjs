/**
 * 视觉核对：真 Chrome 截图（手机 + 电脑）
 *   1. 左上角问候语（某某老师早上好…）
 *   2. 「今日」标题旁的 24 时制时分秒
 *   3. 账号列表：首位教务行不带「首位教务（你）」/「谁都动不了」
 *
 *   node test/shot.mjs        # 截图落到 test/.shots/
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 本机 127.0.0.1 一律不走系统代理 —— 用户机器上装了代理软件，
   node 的 fetch 会被劫持然后挂死（curl 加 --noproxy 才通） */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5311);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots');
const SUPER = { user: '测试教务', pass: 'shotpass123' };
const NEW = [
  { user: '测试教师甲', name: '测试教师甲', role: 'admin',   pass: 'pass12345' },
  { user: '测试教师乙', name: '测试教师乙', role: 'teacher', pass: 'pass12345' },
  { user: '测试教师丙', name: '测试教师丙', role: 'teacher', pass: 'pass12345' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(5000) });
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
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }

async function shot(cdp, name){
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, name);
  await writeFile(file, Buffer.from(r.data, 'base64'));
  shots.push(file);
  console.log('  📸 ' + name);
}

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'shot-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5312', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5312/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // 手机视口
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;

  // 首个账号 = 首位教务
  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, mode: Auth.mode };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
  console.log('已登录（模式：' + r.mode + '）');

  // 建几个老师，让列表像真实情况
  for (const t of NEW){
    await cdp.eval(`Auth.call('users', ${JSON.stringify({ op: 'create', ...t })})`).catch(() => {});
  }

  const greet = await cdp.eval(`({ top: document.getElementById('topName').textContent, side: document.getElementById('sideGreet').textContent, ck: document.getElementById('ckHome').textContent })`);
  console.log('问候语 →', JSON.stringify(greet));

  await cdp.eval(`App.go('home')`); await sleep(1200);
  await shot(cdp, 'm-home.png');

  await cdp.eval(`App.go('teachers')`); await sleep(1500);
  await shot(cdp, 'm-teachers.png');

  // 电脑视口
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await cdp.eval(`App.go('home')`); await sleep(1200);
  await shot(cdp, 'd-home.png');

  await cdp.eval(`App.go('teachers')`); await sleep(1500);
  await shot(cdp, 'd-teachers.png');

  // 老师视角的问候语（名字已含「老师」就不再叠一个）：换掉档案里的名字各算一遍
  const t2 = await cdp.eval(`(() => {
    const bak = Auth._me;
    Auth._me = Object.assign({}, bak, { name: '王老师' });
    const named = Greet.text();
    Auth._me = Object.assign({}, bak, { name: '王一涵' });
    const plain = Greet.text();
    Auth._me = bak;
    return { named, plain };
  })()`);
  console.log('老师视角 →', JSON.stringify(t2));

  console.log('\n✅ 截图完成');
} catch(e){
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300);
  for (const s of shots) console.log('  ' + s);
  process.exit(process.exitCode || 0);
}
