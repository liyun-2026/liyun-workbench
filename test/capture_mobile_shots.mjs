/**
 * 手机端逐页长截图 —— 专门用来「看手机版到底排成什么样」。
 *
 *   node test/capture_mobile_shots.mjs [端口]
 *
 * 为什么单独写一个：现有的 capture_shots.mjs 是给手册 PPT 采集用的，只截
 * **视口那一屏**，而且最后才切到手机。手机端版面问题（一行挤成一条、
 * 字号过大把行撑爆、表格横向溢出）大多出现在**首屏以下**，只看一屏看不出来。
 * 这个脚本截**整页长图**（captureBeyondViewport），浅色深色各一遍。
 *
 * 输出：test/.shots/mobile/{tag}_{page}_{light|dark}.png
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5341);
const DEBUG_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'mobile');
const SUPER = { user: '李老师', pass: 'liyun2026' };

/** 要看哪几页。前 5 个是这次搬到线上的页，后面几个是顺带体检的常用页。 */
const PAGES = [
  ['home',     '今日'],
  ['att',      '考勤'],
  ['roster',   '名册'],
  ['homework', '作业'],
  ['settings', '设置'],
  ['quant',    '量化'],
  ['timetable','课表'],
  ['students', '学生账号'],
];

/** 要测的机型宽度。390 是 iPhone 14/15/16 的 CSS 宽，360 是最常见的安卓。 */
const DEVICES = [
  ['390', 390, 844],
  ['360', 360, 800],
];

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

/** 逐屏拍内滚动容器（默认 #main）。
 *
 *  🔴 为什么不能直接「整页长图」：本应用是**外壳定高 + 内容区自己滚**的结构 ——
 *     body{overflow:hidden} + .app{height:100%} + .main{flex:1;overflow-y:auto}。
 *     文档本身永远只有一个视口高，captureBeyondViewport 拍到的是外壳之外的空白
 *     （踩过：考勤截出来 3 屏，后 2 屏全白）。
 *     正确做法是改 .main 的 scrollTop，一屏一屏拍，每屏之间留一点重叠免得把行切开。
 *
 *  产出：test/.shots/mobile/_tiles/<tag>_<page>_<scheme>/NN.png
 *  另有一张整壳图（顶栏 + 底部标签栏），因为这两条不在 .main 里。 */
const MAX_TILES = 20;      // 今日页有 79 条新闻、能滚 16 屏，看前 20 屏足够了
async function shotScroller(cdp, dir, name){
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: cdp._w, height: cdp._h, deviceScaleFactor: 2, mobile: true });
  await cdp.eval(`(() => {
    const m = document.getElementById('main');
    if (m) m.scrollTop = 0;
    window.scrollTo(0, 0);
    return 1;
  })()`);
  await sleep(360);
  const geo = await cdp.eval(`(() => {
    const m = document.getElementById('main');
    const r = m.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, scrollH: m.scrollHeight };
  })()`);
  const overlap = 48;                          // 留一点重叠，别把一行字切两半
  const step = Math.max(120, Math.floor(geo.h - overlap));
  const total = Math.ceil(Math.max(1, geo.scrollH - geo.h) / step) + 1;
  const n = Math.min(total, MAX_TILES);
  for (let i = 0; i < n; i++) {
    const y = i * step;
    await cdp.eval(`(() => { document.getElementById('main').scrollTop = ${y}; return 1; })()`);
    await sleep(300);
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: geo.x, y: geo.y, width: geo.w, height: geo.h, scale: 2 },
    });
    await writeFile(path.join(dir, String(i + 1).padStart(2, '0') + '.png'), Buffer.from(r.data, 'base64'));
  }
  console.log(`  📸 ${name}  ${n}/${total} 屏（内容区高 ${geo.scrollH}）`);
  return { n, total };
}

/** 整壳图：顶栏 + 底部标签栏不在 .main 里，单独留一张。 */
async function shotShell(cdp, dir, name){
  await cdp.eval(`(() => { const m = document.getElementById('main'); if (m) m.scrollTop = 0; return 1; })()`);
  await sleep(280);
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: cdp._w, height: cdp._h, scale: 2 },
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log(`  📸 ${name}（整壳）`);
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'mob-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  cdp._w = 390; cdp._h = 844;
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2600);

  // ── 登录（第一个账号＝首位教务） ─────────────────────
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2000));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败');
  console.log('已登录，角色：' + lg.role + '\n');

  // ── 灌演示数据（够撑出真实版面即可：满班人数 + 各种状态） ──
  console.log('建立演示数据…');
  const seed = await cdp.eval(`(async () => {
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });
    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
    const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
    // 考勤：正常 / 迟到 / 病假 / 事假 / 早退 各来几个，行宽差异才看得出来
    s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
      status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : i === 7 ? '早退' : '正常' }));
    s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    // 作息
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
    sch('周一', p1.id, '普通话语音基础', '砺蕴一班');
    sch('周一', p3.id, '新闻播报实训', '砺蕴一班');
    sch('周二', p1.id, '即兴评述训练', '集训班');
    sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
    sch('周四', p3.id, '模拟主持', '集训班');
    // 量化
    Quant.syncAtt(c1.id, today); Quant.syncAtt(c2.id, today);
    const add = (clsId, date, label, delta) => Store.upsert('quant_log', { clsId, date, label, delta });
    add(c1.id, today, '课堂表现良好', 2); add(c1.id, today, '作业全交', 2);
    add(c1.id, today, '课堂纪律', -1);   add(c2.id, today, '晚自习过关率第一', 3);
    ['cls:课堂互动:+5','cls:评述集体通关:+15','cls:课堂纪律（当场扣）:-1'].forEach(t => {
      const [k, d] = t.split(':'); const [label, delta] = d.split(':');
      Store.upsert('quant_rules', { id: 'r_cls:' + label, key: 'cls:' + label, label, delta: Number(delta) });
    });
    // 作业
    const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
    s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false); hk(s1[7].id, false);
    Store.upsert('hw:' + h1.id, { studentId: s1[0].id, done: true });
    // 班干部
    Store.upsert('officers', { clsId: c1.id, title: '班长', studentId: s1[0].id });
    Store.upsert('officers', { clsId: c1.id, title: '学习委员', studentId: s1[3].id });
    // 学生请假（考勤页要批）
    Store.upsert('tickets', { type: '学生请假', studentId: s1[5].id, kind: '病假', date: today,
      text: '昨晚发烧到 39 度，今天在家休息，明天正常到。', status: 'open', createdAt: Date.now() - 5400e3 });
    Store.upsert('tickets', { type: '学生请假', studentId: s2[1].id, kind: '事假', date: today,
      text: '上午回学校办毕业手续，下午到岗。', status: 'done', createdAt: Date.now() - 90000e3 });
    // 学生账号（学生账号页要列）
    try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c2.id] }); } catch(e){}
    try { await Auth.call('users', { op: 'create', user: '王敏', name: '王敏', role: 'admin', pass: 'liyun2026', classIds: [] }); } catch(e){}
    try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch(e){}

    Store.set('_attCls', c1.id); Store.set('_attDate', today);
    Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
    Store.set('_qCls', c1.id);
    Store.set('_rosterCls', c1.id);
    Store.set('_pfCls', c1.id);  Store.set('_pfStu', s1[0].id);
    return { c1: c1.id, c2: c2.id, today, n1: N1.length, n2: N2.length };
  })()`);
  console.log(`  砺蕴一班 ${seed.n1} 人 / 集训班 ${seed.n2} 人\n`);

  await cdp.eval(`(async () => { App.go('settings'); await new Promise(r => setTimeout(r, 500)); Quant.syncAllAtt && Quant.syncAllAtt(); return 1; })()`);

  // ── 逐机型 × 逐页 × 浅深 ────────────────────────────
  for (const [tag, w, h] of DEVICES) {
    cdp._w = w; cdp._h = h;
    await view(cdp, { width: w, height: h, dsf: 2, mobile: true });
    await sleep(400);
    console.log(`── 机型 ${tag}（${w}×${h}） ──`);
    for (const scheme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(260);
      for (const [id, label] of PAGES) {
        await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); await new Promise(r => setTimeout(r, 260)); return 1; })()`);
        await sleep(560);
        const tdir = path.join(OUT, '_tiles', `${tag}_${id}_${scheme}`);
        await mkdir(tdir, { recursive: true });
        await shotScroller(cdp, tdir, `${tag}_${id}_${scheme}`);
      }
    }
    // 整壳图（顶栏 + 底部标签栏）—— 亮色一张、深色一张
    for (const scheme of ['light', 'dark']) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await cdp.eval(`(async () => { App.go('home'); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
      await sleep(500);
      await shotShell(cdp, OUT, `${tag}_shell_${scheme}`);
    }
    // 抽屉（手机端导航）
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await cdp.eval(`(async () => { App.go('home'); await new Promise(r=>setTimeout(r,300)); App.drawer(true); await new Promise(r=>setTimeout(r,560)); return 1; })()`);
    await shotShell(cdp, OUT, `${tag}_drawer_light`);
    await cdp.eval(`(() => { App.drawer(false); return 1; })()`);
  }
  console.log('\n✅ 完成 → test/.shots/mobile/');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
