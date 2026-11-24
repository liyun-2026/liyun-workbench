/**
 * 学生档案「方块日历」实拍 —— 作业 15 方块 / 考勤上下两格
 *   node test/sq_block_shot.mjs [端口]
 * 输出：test/.shots/sq/*.png（电脑端 + 手机端）
 *
 * 只渲染真页面、真数据，不做断言。数据全是临时演示数据，跑完 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5341);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'sq');
const SUPER = { user: '李老师', pass: 'liyun2026' };

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
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });
const DESK = { width: 1440, height: 980, dsf: 2, mobile: false };
const MOB  = { width: 400,  height: 900, dsf: 2, mobile: true };

async function shotRegion(cdp, jsFind, name, pad = 16){
  const ok = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return 0;
    el.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()`);
  if (!ok) { console.log('  ⚠ 找不到 ' + name); return false; }
  await sleep(320);
  const b = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; })()`);
  if (!b || b.w < 4) { console.log('  ⚠ 无尺寸 ' + name); return false; }
  let w = b.w + pad * 2, h = b.h + pad * 2;
  if (w > b.vw || h > b.vh){ const k = Math.min(b.vw / w, b.vh / h); w *= k; h *= k; }
  const x = Math.max(0, Math.min(b.x + b.w / 2 - w / 2, b.vw - w));
  const y = Math.max(0, Math.min(b.y + b.h / 2 - h / 2, b.vh - h));
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), scale: 2 },
  });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log(`  ✂ ${name} ${Math.round(w)}×${Math.round(h)}`);
  return true;
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'sq-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5342', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5342/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, DESK);
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);

  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败');
  console.log('已登录：' + lg.role);

  const seed = await cdp.eval(`(async () => {
    const c = Store.upsert('classes', { name: '考前06班' });
    const st = Store.upsert('students', { classId: c.id, name: '谢一鸣' });
    const sid = st.id;
    const PAT = ['正常','正常','迟到','正常','事假','正常','正常','病假','正常','未到'];
    for (let i = 0; i < 20; i++){
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = Util.dateOf(d);
      Store.upsert('att:' + day, { studentId: sid, status: PAT[i % PAT.length], pid: 'am' });
      if (i % 5 !== 3)
        Store.upsert('att:' + day, { studentId: sid, status: PAT[(i + 3) % PAT.length], pid: 'pm' });
    }
    for (let i = 0; i < 18; i++){
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = Util.dateOf(d);
      Store.upsert('homework', { date: day, text: '第' + (18 - i) + '次 · 气息与咬字练习', clsId: c.id });
      const k = i % 4;
      if (k !== 3) Store.upsert('hwchk:' + day, { studentId: sid, done: (k === 0 ? 0 : 1), classId: c.id });
    }
    App.go('profile');
    await new Promise(r => setTimeout(r, 500));
    Student.pickStu(sid);
    await new Promise(r => setTimeout(r, 900));
    const cards = document.querySelectorAll('#pfBody .card');
    return { sid, cards: cards.length,
      att: !!document.querySelector('#pfBody .sq-day'),
      hw: document.querySelectorAll('#pfBody .sq-hw').length,
      day: document.querySelectorAll('#pfBody .sq-day').length };
  })()`);
  console.log('数据：', JSON.stringify(seed));

  console.log('诊断：', JSON.stringify(await cdp.eval(`(() => {
    const c = document.querySelectorAll('#pfBody .card')[1];
    const pg = document.getElementById('page-students');
    const r = c ? c.getBoundingClientRect() : null;
    return { pgCls: pg ? pg.className : 'none', pgDisp: pg ? getComputedStyle(pg).display : '',
      cardDisp: c ? getComputedStyle(c).display : '', rect: r ? [Math.round(r.width), Math.round(r.height), Math.round(r.top)] : null,
      bodyDisp: getComputedStyle(document.getElementById('pfBody')).display };
  })()`)));
  { const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, 'desk-full.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸 desk-full.png'); }
  console.log('样式：', JSON.stringify(await cdp.eval(`(() => {
    const d = document.querySelector('.sq-day');
    const cs = d ? getComputedStyle(d) : null;
    let found = 0, total = 0;
    for (const ss of Array.from(document.styleSheets)){
      total++;
      try { for (const r of Array.from(ss.cssRules || [])) if ((r.selectorText||'').indexOf('sqgrid') >= 0) found++; } catch(e){}
    }
    return { has: !!d, disp: cs ? cs.display : '', w: cs ? cs.width : '', h: cs ? cs.height : '',
      radius: cs ? cs.borderRadius : '', sheets: total, rules: found,
      parentHTML: d && d.parentElement ? d.parentElement.className : '' };
  })()`)));
  console.log('链：', JSON.stringify(await cdp.eval(`(() => {
    let el = document.getElementById('pfBody'), out = [];
    for (let i = 0; i < 6 && el; i++, el = el.parentElement){
      const r = el.getBoundingClientRect();
      out.push([el.id || el.className.split(' ')[0], Math.round(r.width), Math.round(r.height), getComputedStyle(el).display]);
    }
    return out;
  })()`)));
  await shotRegion(cdp, `document.querySelectorAll('#pfBody .card')[1]`, 'desk-att.png');
  await shotRegion(cdp, `document.querySelectorAll('#pfBody .card')[2]`, 'desk-hw.png');

  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await view(cdp, MOB);
  await sleep(500);
  await cdp.eval(`(async () => {
    if (typeof App.onResize === 'function') App.onResize();
    App.go('profile');
    await new Promise(r => setTimeout(r, 300));
    Student.pickStu(${JSON.stringify(seed.sid)});
    await new Promise(r => setTimeout(r, 600));
  })()`);
  await sleep(500);
  console.log('手机端宽度：', JSON.stringify(await cdp.eval(`(() => {
    const b = document.getElementById('pfBody'); const r = b ? b.getBoundingClientRect() : null;
    return { w: r ? Math.round(r.width) : -1, vw: innerWidth, splitCols: (() => {
      const sp = document.querySelector('#page-profile .split');
      return sp ? getComputedStyle(sp).gridTemplateColumns : '';
    })() };
  })()`)));
  await shotRegion(cdp, `document.querySelectorAll('#pfBody .card')[1]`, 'mob-att.png', 10);
  await shotRegion(cdp, `document.querySelectorAll('#pfBody .card')[2]`, 'mob-hw.png', 10);

  /* 考勤页：印章四色统一后的样子 */
  await view(cdp, DESK);
  await sleep(400);
  await cdp.eval(`(async () => {
    App.go('att');
    await new Promise(r => setTimeout(r, 900));
  })()`);
  await sleep(700);
  { const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, 'desk-att-page.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸 desk-att-page.png'); }

  console.log('✅ 完成，图在 test/.shots/sq/');
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
