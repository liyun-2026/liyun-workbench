/**
 * 请假按时段 · 真实渲染截图（不是示意稿）
 *   node test/leave_slot_shot.mjs [端口]
 * 出三张：
 *   leave_student_pick.png  学生端请假卡（390px 手机，三块时段卡）
 *   leave_admin_list.png    教务端审批列表（带时段标签）
 *   leave_night.png         晚自习页（请假的人显示「晚自习请假」）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5393);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'leave');

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

  const profile = await mkdtemp(path.join(tmpdir(), 'lvshot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5394', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5394/json/list')).json();
    return list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  const shotOf = async (sel, name, pad = 14) => {
    const r = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const sx = window.scrollX || 0, sy = window.scrollY || 0;
      return { x: b.x + sx, y: b.y + sy, w: b.width, h: b.height };
    })()`);
    if (!r) { console.log('  ⚠️ 找不到 ' + sel); return; }
    const res = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale: 1 },
    });
    await writeFile(path.join(OUT, name), Buffer.from(res.data, 'base64'));
    console.log('  ✅ ' + name + '  ' + Math.round(r.w) + '×' + Math.round(r.h));
  };

  /* ── 登录教务 ── */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2400);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s){ s.style.opacity='0'; s.style.display='none'; } })()`);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
  })()`);

  /* ── 造数据 ── */
  await cdp.eval(`(() => {
    const D = Util.today();
    Store.upsert('classes', { id:'c_t5', name:'05班' });
    ['s_zy|张晗依','s_sy|李思远','s_yn|王一诺'].forEach(x => {
      const [id,name] = x.split('|');
      Store.upsert('students', { id, classId:'c_t5', name });
    });
    Store.upsert('tickets', { id:'t_zy', type:'学生请假', studentId:'s_zy', kind:'事假',
      date:D, pids:['am'], text:'上午去医院复查，下午回校', status:'done', createdAt:Date.now()-3e5 });
    Store.upsert('tickets', { id:'t_sy', type:'学生请假', studentId:'s_sy', kind:'病假',
      date:D, pids:['am','pm'], text:'发烧，医院证明已交教务', status:'open', createdAt:Date.now()-2e5 });
    Store.upsert('tickets', { id:'t_yn', type:'学生请假', studentId:'s_yn', kind:'事假',
      date:D, pids:['night'], text:'家里有事，晚自习请假，白天正常', status:'done', createdAt:Date.now()-1e5 });
    /* 临时假：路上堵车，预计 10:30 到 */
    Store.upsert('tickets', { id:'t_tp', type:'学生请假', studentId:'s_tp', kind:'临时假',
      date:D, eta:'10:30', pids:['am'], text:'路上堵车，十点半到', status:'open', createdAt:Date.now()-5e4 });
    Store.upsert('students', { id:'s_tp', classId:'c_t5', name:'柯临时' });
  })()`);

  /* ── ① 教务端审批列表 ── */
  await cdp.eval(`(async () => {
    App.go('att');
    await new Promise(r => setTimeout(r, 900));
    Att.render();
    await new Promise(r => setTimeout(r, 500));
    const el = document.getElementById('attLeaveList');
    if (el){ el.scrollIntoView({ block:'start' }); el.scrollTop = 0;
      let p = el.parentElement; while (p){ try { p.scrollTop = 0; } catch(e){} p = p.parentElement; } }
    await new Promise(r => setTimeout(r, 300));
  })()`);
  await shotOf('#attLeaveList', 'leave_admin_list.png');

  /* ── ② 学生端请假卡：390px 手机视口，真样式 ── */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(700);
  await cdp.eval(`(() => {
    /* 授课老师进不了学生端，这页直接点亮画一遍 —— 只为看真实渲染，不改任何业务数据 */
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    const pg = document.getElementById('page-stuSign');
    pg.classList.add('on');
    const d = document.getElementById('lvDate'); if (d) d.value = Util.today();
    StuLeave._pick = null;
    StuLeave.render();
    /* 下面「我这个月的打卡」「我请过的假」两张空卡不参与截图 */
    [...pg.querySelectorAll('.card')].forEach((c, i) => { if (i >= 3) c.style.display = 'none'; });
    window.scrollTo(0, 0);
    pg.scrollIntoView({ block:'start' });
  })()`);
  await sleep(600);
  await shotOf('#lvCard', 'leave_student_pick.png', 10);
  await cdp.eval(`(() => { StuLeave.pickKind('临时假'); document.getElementById('lvEtaTime').value='10:30';
    document.querySelectorAll('#lvEta .lv-qc button')[0].classList.add('on'); })()`);
  await sleep(400);
  await shotOf('#lvCard', 'leave_student_temp.png', 10);

  /* ── ③ 晚自习页 ── */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 2, mobile: false });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await sleep(500);
  await cdp.eval(`(async () => {
    App.go('night');
    await new Promise(r => setTimeout(r, 700));
    Store.set('_nightCls', 'c_t5');
    Store.set('_nightDate', Util.today());
    Night.render();
    await new Promise(r => setTimeout(r, 500));
  })()`);
  await shotOf('#page-night .card', 'leave_night.png', 10);

} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}
