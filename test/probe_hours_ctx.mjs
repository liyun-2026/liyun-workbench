/**
 * 探针：登录后 dump 名册上下文（班级 / 教室 / 老师），用于造夹具。
 *   node test/probe_hours_ctx.mjs [--port=5415]
 * 只读，不写任何工程源码。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '..');
const FLAGS = process.argv.slice(2).filter(a => a.startsWith('--'));
const flag = (n, d) => { const h = FLAGS.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const PORT = Number(flag('port', 5415));
const CDP = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NODE = process.execPath;
const SUPER = { user: '李老师', pass: 'liyun2026' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set();
    const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 600000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome, profile, cdp;
try {
  console.log('【起】静态服务 + 无头 Chrome …');
  server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务', tries: 50 });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'hours-probe-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2800);

  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2600));
    return { role: Auth.role && Auth.role(), name: Auth.name && Auth.name() };
  })()`);
  console.log('登录：' + JSON.stringify(login));

  const dump = await cdp.eval(`(() => {
    try { Staff.load(); } catch(e){}
    const classes = Store.list('classes').map(c => c.name);
    const rooms = Store.list('rooms').map(r => r.name);
    const teachers = (typeof Staff !== 'undefined' && Staff.teachers) ? Staff.teachers().map(t => ({ name: t.name, id: t.id, subject: t.subject })) : [];
    const ctx = Hours._ctx();
    const periods = (typeof Schedule !== 'undefined' && Schedule.periods) ? Schedule.periods() : [];
    let sched = [];
    try { sched = Store.list('schedule').slice(0, 5).map(s => ({ day:s.day, cls:s.cls, teacher:s.teacher, room:s.room, start:s.start })); } catch(e){}
    return { classes, rooms, teachers, ctx, periods, sched, staffLoaded: !!(typeof Staff !== 'undefined' && Staff.loaded) };
  })()`);
  console.log('\n===名册上下文===');
  console.log(JSON.stringify(dump, null, 2));
} catch (e) {
  console.error('💥 ' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
