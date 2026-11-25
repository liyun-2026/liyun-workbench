/** 学生端量化页（细则 + 全列加扣分）真渲染截图与断言
 *   node test/stu_quant_shot.mjs [端口]
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5417);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'quant');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
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
  send(m, p = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(m){ return new Promise(res => { const set = this.events.get(m) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(m, set); }); }
  async eval(e, t = 90000){ const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, timeout: t });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome; const R = [];
const t = (n, ok, ex) => R.push({ n, ok: !!ok, ex });
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method:'POST', headers:{'content-type':'application/json'}, body:'{"action":"hello"}' })).ok, { what:'预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method:'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'sq-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--remote-debugging-port=5418',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
    '--disable-extensions','--no-proxy-server','--force-device-scale-factor=2','about:blank'], { stdio:'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5418/json/list')).json();
    return list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
  }, { what:'调试端口' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2400);
  await cdp.eval(`(()=>{
    const s=document.getElementById('splash'); if(s){s.style.opacity='0';s.style.display='none';}
    const g=document.getElementById('gate'); if(g){g.classList.remove('on');g.style.display='none';}
  })()`);

  const r = await cdp.eval(`(async () => {
    /* 授课老师进不了学生端，这里只为看真实渲染：造一个班 + 一个学员，把页面点亮 */
    Store.upsert('classes', { id:'c_q5', name:'考前06班' });
    Store.upsert('students', { id:'s_q', classId:'c_q5', name:'黄紫佳' });
    Store.upsert('quant_rules', { id:'r_att:正常', key:'att:正常', label:'出勤正常', delta:1 });
    Store.upsert('quant_rules', { id:'r_att:迟到', key:'att:迟到', label:'迟到（10 分钟内 2 分/分钟；超 10 分钟一次 20 分）', delta:-2 });
    Store.upsert('quant_rules', { id:'r_att:病假', key:'att:病假', label:'病假', delta:-1 });
    Store.upsert('quant_rules', { id:'r_att:事假', key:'att:事假', label:'事假', delta:-2 });
    Store.upsert('quant_rules', { id:'r_hw:已交', key:'hw:已交', label:'作业按时提交', delta:1 });
    Store.upsert('quant_rules', { id:'r_hw:未交', key:'hw:未交', label:'作业未交', delta:-2 });
    Store.upsert('quant_rules', { id:'r_night:过', key:'night:过', label:'晚自习过关', delta:1 });
    Store.upsert('quant_rules', { id:'r_night:未过', key:'night:未过', label:'晚自习未过', delta:-1 });
    Store.upsert('quant_rules', { id:'r_cls:fullAtt', key:'cls:fullAtt', label:'全勤（无请假 / 迟到 / 早退 / 旷课，班级）', delta:30 });
    Store.upsert('quant_rules', { id:'r_cls:cleanOk', key:'cls:cleanOk', label:'教室卫生与安全排查 合格', delta:10 });
    Store.upsert('quant_rules', { id:'r_cls:phone', key:'cls:phone', label:'上课玩手机或做与学习无关的事（每人次）', delta:-5 });
    Store.upsert('quant_log', { id:'q1', clsId:'c_q5', date:Util.today(), label:'全勤', delta:30 });
    Store.upsert('quant_log', { id:'q2', clsId:'c_q5', date:Util.today(), label:'教室卫生 合格', delta:10 });
    const _cls = Stu.clsId, _rec = Stu.rec, _sid = Stu.sid;
    Stu.clsId = () => 'c_q5'; Stu.rec = () => ({ id:'s_q', name:'黄紫佳', classId:'c_q5' }); Stu.sid = () => 's_q';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
    document.getElementById('page-stuQuant').classList.add('on');
    StuQuant.render();
    await new Promise(r => setTimeout(r, 400));
    const box = document.getElementById('stuQuantRules');
    const grps = [...box.querySelectorAll('.sq-grp')].map(x => x.textContent);
    const rows = box.querySelectorAll('.sq-rule').length;
    const mineRows = document.querySelectorAll('#stuQuantMine .sq-rule').length;
    const dim = document.querySelectorAll('#stuQuantMine .sq-rule.dim').length;
    const plus = box.querySelectorAll('.v.plus').length;
    const minus = box.querySelectorAll('.v.minus').length;
    Stu.clsId = _cls; Stu.rec = _rec; Stu.sid = _sid;
    const cards = [...document.querySelectorAll('#page-stuQuant .card')];
    const dbg = cards.map(c => {
      const b = c.getBoundingClientRect(); const cs = getComputedStyle(c);
      return { h: Math.round(b.height), y: Math.round(b.y), d: cs.display, v: cs.visibility, o: cs.opacity };
    });
    dbg.push({ page: Math.round(document.getElementById('page-stuQuant').getBoundingClientRect().height) });
    return { grps, rows, mineRows, dim, plus, minus, dbg };
  })()`);
  t('细则卡有四个分组（考勤/作业/晚自习/班级）', r.grps.join(',') === '考勤,作业,晚自习,班级', JSON.stringify(r.grps));
  t('细则把 11 条全列出来', r.rows === 11, String(r.rows));
  t('加分与扣分都有（红/绿两类）', r.plus >= 5 && r.minus >= 5, JSON.stringify([r.plus, r.minus]));
  t('我的加扣分全列个人项（8 条，班级项不进个人榜）', r.mineRows === 8 && r.dim >= 7, JSON.stringify([r.mineRows, r.dim]));
  console.log('  🔎 调试：', JSON.stringify(r.dbg));

  /* 先把视口撑到整页高度再截（#main 是滚动容器，超出视口的内容 headless 不会画） */
  const fullH = await cdp.eval(`(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    const el = document.getElementById('page-stuQuant');
    return Math.ceil(el.getBoundingClientRect().height) + 220;
  })()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: Math.max(1200, fullH), deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: Math.max(1200, fullH) });
  await sleep(900);
  const shot = await cdp.eval(`(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
    const el = document.getElementById('page-stuQuant');
    const b = el.getBoundingClientRect();
    return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: Math.min(b.height, 2400) };
  })()`);
  const res = await cdp.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, fromSurface:true,
    clip:{ x: Math.max(0, shot.x), y: Math.max(0, shot.y), width: shot.w, height: shot.h, scale: 1 } });
  await writeFile(path.join(OUT, 'stu_quant_rules.png'), Buffer.from(res.data, 'base64'));
  console.log('  📸 stu_quant_rules.png ' + Math.round(shot.w) + '×' + Math.round(shot.h));
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}
const bad = R.filter(x => !x.ok);
R.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok || !x.ex ? '' : '   → ' + x.ex)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length}` : `✅ 全部通过（${R.length} 项）`));
