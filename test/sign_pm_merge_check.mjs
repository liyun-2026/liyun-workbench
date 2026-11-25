/**
 * 学生「下午打卡」同步不进来的回归测试
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
    '--remote-debugging-port=5376', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5376/json/list')).json();
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


  const r = await cdp.eval(`(async () => {
    const c = Store.upsert('classes', { name: '合并测试班' });
    const s = Store.upsert('students', { classId: c.id, name: '合并测试生' });
    const today = Util.today();
    const AM = new Date(); AM.setHours(8, 5, 0, 0);
    const PM = new Date(); PM.setHours(14, 33, 0, 0);
    const amSlot = { at: +AM, way: 'code', status: '正常', lateMin: 0, pid: 'am', by: 'self' };
    const pmSlot = { at: +PM, way: 'code', status: '正常', lateMin: 0, pid: 'pm', by: 'self' };
    /* ① 本地这条 = 上午从服务端拉下来的（服务端写的记录没有 _u，照原样存着） */
    Store.set('sign:' + today, [{ id: s.id, studentId: s.id, at: +AM, date: today,
      way: 'code', status: '正常', lateMin: 0, recvAt: +AM, slots: { am: amSlot } }]);
    /* ② 服务端 14:33 又写了一次（同一 id，多出 pm 槽；同样没有 _u） */
    const remote = { id: s.id, studentId: s.id, at: +PM, date: today,
      way: 'code', status: '正常', lateMin: 0, recvAt: +PM,
      slots: { am: amSlot, pm: pmSlot } };
    const changed = Store.mergeRemote({ ['sign:' + today]: [remote] });
    const back = Store.list('sign:' + today).find(x => x.id === s.id);
    const hasPm = !!(back && back.slots && back.slots.pm);
    /* ③ 今日打卡卡按下午时段能不能取到这条 */
    const rec = (typeof Sign !== 'undefined' && Sign.slotRec) ? Sign.slotRec(back, 'pm') : null;
    /* ④ 清理测试数据，别把测试班留在本地 */
    Store.remove('sign:' + today);
    Store.softDelete('students', s.id);
    Store.softDelete('classes', c.id);
    return { changed, hasPm, slotRecOk: !!rec, recAt: rec ? new Date(rec.at).getHours() + ':' + new Date(rec.at).getMinutes() : '',
             stored: back ? Object.keys(back.slots || {}) : [] };
  })()`);
  console.log('合并结果：', JSON.stringify(r));

  const bad = [];
  if (!r.hasPm) bad.push('下午那条没合进来（sign 记录里没有 pm 槽）');
  if (!r.slotRecOk) bad.push('按下午时段取不到打卡记录 → 卡片会显示「未打卡」');
  console.log(bad.length ? '❌ ' + bad.join('；') : '✅ 下午打卡能正常合并、卡片能取到');
  if (bad.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
