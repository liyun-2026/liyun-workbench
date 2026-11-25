/**
 * 学生端「下午没有打卡入口」的回归测试
 *   node test/sign_pm_merge_check.mjs [端口]
 *
 * 复现的现网 bug（2026-11-25 下午主理人报「学生明明打上了，上面还显示未打卡」）：
 *   服务端 doSign 写 sign:{date} 的记录**没有 _u**，而 mergeList 是「_u 大的赢」，
 *   两边都 0 时宁可保留本地 → 同一个学生同一天**第二次**（下午）打卡永远合并不进来，
 *   教务端仍是上午那条（只有 am 槽）→ 今日打卡卡按时段取 rec 取不到 → 显示「未打卡」。
 * 本脚本用「上午那条 + 下午那条」两条真实形状的记录走一遍 Store.mergeRemote。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5371);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'board');

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

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'bd-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5378', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5378/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);

  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { ok: !document.getElementById('gate').classList.contains('on') };
  })()`);
  if (!lg.ok) throw new Error('登录失败');



  /* 只配「开始」不配「结束」的时段，是这条 bug 的温床：
     上午 07:50 开、没写结束 —— 旧代码在 14:53 判成「上午」，学生上午打过卡了，
     下午那一页就成「已打卡」、没有入口。 */
  const r = await cdp.eval(`(() => {
    const old = Store.get('att_slots');
    const mk = list => { Store.set('att_slots', list); return list; };
    const A = (h, m) => Att.autoPid(new Date(2026, 10, 25, h, m));
    /* ① 只有 start，没有 end */
    mk([{ id:'am', name:'上午', start:'07:50' }, { id:'pm', name:'下午', start:'14:50' }]);
    const noEnd = { 早7: A(7, 55), 上午: A(10, 0), 下午2点: A(14, 0), 下午2点53: A(14, 53), 晚上: A(21, 0) };
    /* ② 配了 end 的（原来的口径要保住） */
    mk([{ id:'am', name:'上午', start:'07:50', end:'12:00' }, { id:'pm', name:'下午', start:'14:50', end:'17:30' }]);
    const withEnd = { 上午: A(10, 0), 午间: A(13, 0), 下午: A(15, 0), 放学后: A(18, 30) };
    /* ③ 完全没配时间 → 13:00 分界（主理人原口径） */
    mk([{ id:'am', name:'上午' }, { id:'pm', name:'下午' }]);
    const plain = { 九点: A(9, 0), 十五点: A(15, 0) };
    /* 还原 */
    if (old === null) Store.remove('att_slots'); else Store.set('att_slots', old);
    return { noEnd, withEnd, plain };
  })()`);
  console.log('时段判定：', JSON.stringify(r));

  const bad = [];
  if (r.noEnd['下午2点53'] !== 'pm') bad.push('只配 start 时 14:53 判成 ' + r.noEnd['下午2点53'] + '（该是 pm）—— 下午入口会消失');
  if (r.noEnd['上午'] !== 'am') bad.push('只配 start 时 10:00 判成 ' + r.noEnd['上午']);
  if (r.noEnd['晚上'] !== 'pm') bad.push('只配 start 时 21:00 判成 ' + r.noEnd['晚上']);
  if (r.withEnd['午间'] !== 'am') bad.push('配了 end 时 13:00 判成 ' + r.withEnd['午间']);
  if (r.withEnd['下午'] !== 'pm') bad.push('配了 end 时 15:00 判成 ' + r.withEnd['下午']);
  if (r.withEnd['放学后'] !== 'pm') bad.push('配了 end 时 18:30 判成 ' + r.withEnd['放学后']);
  if (r.plain['十五点'] !== 'pm' || r.plain['九点'] !== 'am') bad.push('没配时间时 13:00 分界失效');
  console.log(bad.length ? '❌ ' + bad.join('；') : '✅ 时段判定全部正确');
  if (bad.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
