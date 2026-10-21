/* ==MOBILE-V1== 版本一（集美式）13 页终稿 —— 验证脚本
 *
 *   node test/v1_mobile_check.mjs
 *
 * 做四件事：
 *   1) 桌面 ≥1100 零影响自证：起两份 fresh 服务（工作区 / HEAD 基线 worktree），
 *      同一份演示数据、同样屏蔽动态内容后，1440×1000 逐页截屏并逐像素比对
 *      （admin 5 页 + teacher 3 页 + student 4 页）。
 *   2) 撤蓝头断言：12 页（除 settings）页面背景无蓝渐变；浅底大标题
 *      （24px/800/非白）；att chead 复原；settings 蓝框保留且收小 + 20px 圆角。
 *   3) 三首页轮播断言：C 款金渐变卡（天数 = 距 LIYUN_EXAM_DATE 实算）、
 *      概览卡露边、圆点、顶栏（logo 30px + 问候无逗号 + 角色金签）、m2-hero 隐藏、
 *      stuHome 版序（轮播 → 打卡）。
 *   4) 深色 2 页（--paper #18211E）+ 375/320 溢出抽查 + mtabbar 五 Tab。
 *
 * 截图输出：docs/v1-mobile-shots/（mobile/ 与 desktop/）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_A = 5471, PORT_B = 5472;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'v1-mobile-shots');
const BASE_DIR = '/tmp/lyv1-base';
const SUPER = { user: '李老师', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };
const STUDENT = { user: '王梓涵', pass: 'liyun2026' };
/* 与生产 ==MOBILE-V1== JS 的 EXAM_DATE 单一来源保持一致（仅用于天数核对） */
const EXAM_DATE = '2027-01-09';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method){ return new Promise(res => { const orig = this.ws.onmessage;
    this.ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.method === method){ this.ws.onmessage = orig; res(m.params); }
      else if (orig) orig(ev); }; }); }
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

/** 屏蔽动态内容（时钟 / 打卡秒表 / 相对时间 / 新闻 / 「现在」游标）—— 两侧跑同一份 */
const MASK_JS = `(() => {
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr, [data-next]').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.p-time').forEach(e => e.style.visibility = 'hidden');
  /* 冻结动画/过渡须连伪元素一起（打卡圈呼吸画在 ::before/::after 上），inline 管不到 */
  let frozen = document.getElementById('v1MaskFreeze');
  if (!frozen){
    frozen = document.createElement('style'); frozen.id = 'v1MaskFreeze';
    frozen.textContent = '.page.on, .page.on *, .page.on *::before, .page.on *::after{animation:none!important;transition:none!important}';
    document.head.appendChild(frozen);
  }
  /* 相对时间（「x 分钟前 / x 小时前 / 刚刚」）与实时时钟（2026/10/22 01:30:18）
     随两侧截图时刻抖动 → 整体藏起 */
  const re = /(\\d+\\s*(分钟|小时|秒)前|^刚刚$|刚刚，|\\d+\\s*天前)/;
  const reClock = /\\d{4}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2}/;
  document.querySelectorAll('.page.on *').forEach(e => {
    if (e.children.length === 0){
      const t = (e.textContent || '').trim();
      if (re.test(t) || reClock.test(t)) e.style.visibility = 'hidden';
    }
  });
  ['newsBody','newsMore','tNewsBody','newsMeta','tNewsMeta','nNewsMeta','stuNewsMeta'].forEach(id => {
    const e = document.getElementById(id); if (e) e.innerHTML = '';
  });
  /* 学生设备门是测试流程切换三身份的产物（业务遮罩），视觉断言前藏起 */
  const dg = document.getElementById('devGate'); if (dg) dg.style.display = 'none';
  /* 冻结动画/过渡的 style 已在上面按 id 守卫注入一次，此处无需重复 */
  return 1;
})()`;

/** 演示数据（教务/教师侧；时间偏移避开「x 分钟前」抖动） */
const SEED_JS = `(async () => {
  const today = Util.today();
  const c1 = Store.upsert('classes', { name: '砺蕴一班' });
  const c2 = Store.upsert('classes', { name: '集训班' });
  const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
  const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
  const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
  const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
  s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
    status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : '正常' }));
  s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
  const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
  const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
  sch('周一', p1.id, '普通话语音基础', '砺蕴一班');
  sch('周一', p3.id, '新闻播报实训', '砺蕴一班');
  sch('周二', p1.id, '即兴评述训练', '集训班');
  sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
  sch('周四', p1.id, '即兴评述训练', '砺蕴一班');
  sch('周四', p3.id, '模拟主持', '集训班');
  const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
  Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
  const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
  s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false); hk(s1[7].id, false);
  Store.upsert('tickets', { type: '调课申请', byName: '张伟', text: '周三第 2 节想换到周四同一节',
    status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  Store.upsert('tickets', { type: '学生请假', studentId: s1[5].id, kind: '病假', date: today,
    text: '昨晚发烧到 39 度，今天在家休息。', status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id, c2.id] }); } catch(e){}
  try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch(e){}
  Store.set('_attCls', c1.id); Store.set('_attDate', today);
  Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
  Store.set('_tdAttCls', c1.id);
  return { c1: c1.id, c2: c2.id };
})()`;

async function boot(base) {
  await waitFor(async () => (await jfetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: `预览服务 ${base}`, tries: 40 });
  try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
}
async function login(cdp, cred) {
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2000));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + cred.user);
  return lg.role;
}
async function switchUser(cdp, cred) {
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2200));
    return Auth.role();
  })()`);
  await sleep(1000);
}
async function goShot(cdp, pageId, file) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  await sleep(600);
  await cdp.eval(MASK_JS);
  await sleep(220);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(r.data, 'base64'));
}
/** 逐像素比对：两张 PNG 喂 canvas，数差异像素（容差 8/通道），返回 bbox */
async function diffTwo(cdp, bufA, bufB) {
  const a = bufA.toString('base64'), b = bufB.toString('base64');
  return cdp.eval(`(async () => {
    const load = b64 => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('img load fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const ia = await load(${JSON.stringify(a)});
    const ib = await load(${JSON.stringify(b)});
    if (ia.width !== ib.width || ia.height !== ib.height) return { mismatch: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const ca = document.createElement('canvas'); ca.width = ia.width; ca.height = ia.height;
    const cb = document.createElement('canvas'); cb.width = ib.width; cb.height = ib.height;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, ia.width, ia.height).data;
    const db = xb.getImageData(0, 0, ib.width, ib.height).data;
    let bad = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) {
        bad++;
        const p = i / 4, x = p % ia.width, y = Math.floor(p / ia.width);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4),
             bbox: bad ? [minX, minY, maxX, maxY] : null };
  })()`);
}

/* ── 基线 worktree（HEAD = 本次修改前）── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} HEAD`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

try {
  await mkdir(path.join(OUT, 'mobile'), { recursive: true });
  await mkdir(path.join(OUT, 'desktop'), { recursive: true });
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(HEAD 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'v1mob-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5498',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5498/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  /* ═══ 1) 桌面 1440 像素 diff（vs HEAD 基线）═══ */
  await view(cdp, { width: 1440, height: 1000, dsf: 1, mobile: false });
  console.log('── 桌面 1440 像素 diff（动态内容已屏蔽）──');
  const DESK_ADMIN = [['home','教务首页'],['att','考勤'],['homework','作业'],['timetable','课表'],['settings','我的(设置)']];
  const DESK_TEACHER = [['today','教师今天'],['myclass','我的班级'],['tickets','上报']];
  const DESK_STUDENT = [['stuHome','学生今日'],['stuSign','打卡'],['stuHw','作业'],['stuTable','课表']];
  const shots = { A: {}, B: {} };
  for (const [tag, base, store] of [[ 'A', BASE_A, shots.A ], [ 'B', BASE_B, shots.B ]]) {
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2800);
    await login(cdp, SUPER);
    await cdp.eval(SEED_JS);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    await sleep(600);
    for (const [id] of DESK_ADMIN) {
      const f = path.join(OUT, 'desktop', `${tag}-${id}.png`);
      await goShot(cdp, id, f);
      store[id] = f;
    }
    await switchUser(cdp, TEACHER);
    for (const [id] of DESK_TEACHER) {
      const f = path.join(OUT, 'desktop', `${tag}-t-${id}.png`);
      await goShot(cdp, id, f);
      store['t-' + id] = f;
    }
    await switchUser(cdp, STUDENT);
    for (const [id] of DESK_STUDENT) {
      const f = path.join(OUT, 'desktop', `${tag}-s-${id}.png`);
      await goShot(cdp, id, f);
      store['s-' + id] = f;
    }
  }
  console.log('逐页比对（admin A-/B-，teacher A-t-/B-t-，student A-s-/B-s-）：');
  /* 偶发亚像素渲染抖动（定位标 SVG / 圆环边缘，面积 ~0.015%）→ 差异非零时重截重比 */
  const reshoot = async (key, pageId, who) => {
    for (const [base, tag] of [[BASE_A, 'A'], [BASE_B, 'B']]){
      let loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', { url: base + '/' }); await loaded;
      await sleep(2600);
      const st = await cdp.eval(`({ on: (document.querySelector('.page.on')||{}).id || '', gate: document.getElementById('gate').classList.contains('on') })`);
      if (st.gate || st.on !== 'page-' + pageId) await login(cdp, who);
      await goShot(cdp, pageId, shots[tag][key]);
    }
  };
  for (const [id, label] of [...DESK_ADMIN, ...DESK_TEACHER, ...DESK_STUDENT]) {
    const key = DESK_TEACHER.some(x => x[0] === id) ? 't-' + id : (DESK_STUDENT.some(x => x[0] === id) ? 's-' + id : id);
    const pageId = key.startsWith('t-') ? key.slice(2) : (key.startsWith('s-') ? key.slice(2) : key);
    const who = key.startsWith('t-') ? TEACHER : (key.startsWith('s-') ? STUDENT : SUPER);
    let d = null, good = false;
    for (let attempt = 0; attempt < 3 && !good; attempt++){
      if (attempt > 0) await reshoot(key, pageId, who);
      d = await diffTwo(cdp, await readFile(shots.A[key]), await readFile(shots.B[key]));
      good = !d.mismatch && d.bad === 0;
    }
    ok(`桌面 1440 · ${label}（${key}）`, good, d.mismatch ? ('尺寸不一致 ' + d.mismatch) : (`差异像素 ${d.bad}/${d.total}（${d.pct}%）` + (d.bbox ? ' bbox=' + JSON.stringify(d.bbox) : '')));
  }

  /* ═══ 2) 手机 390 断言（工作区 A）—— 按身份分组 ═══ */
  console.log('\n── 撤蓝头 / 大标题 / 轮播断言（工作区 · 390 手机视口）──');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  await sleep(2800);
  await login(cdp, SUPER);
  await cdp.eval(SEED_JS);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(600);

  /* 2.1 撤蓝头：教务 4 页背景无蓝渐变 */
  const bg = await cdp.eval(`(async () => {
    const ids = ['home','att','homework','timetable'];
    const out = {};
    for (const id of ids) {
      App.go(id); await new Promise(r => setTimeout(r, 420));
      const pg = document.querySelector('.page.on');
      out[id] = pg ? (getComputedStyle(pg).backgroundImage || '').includes('linear-gradient') : null;
    }
    return out;
  })()`);
  const stillBlue = Object.entries(bg).filter(([, v]) => v).map(([k]) => k);
  const missPg = Object.entries(bg).filter(([, v]) => v === null).map(([k]) => k);
  ok('撤蓝头：教务 4 页背景无蓝渐变', stillBlue.length === 0 && missPg.length === 0,
     (stillBlue.length ? '仍有蓝带：' + stillBlue.join(',') : '') + (missPg.length ? ' 页面未渲染：' + missPg.join(',') : ''));

  /* 2.3 att chead 复原：无蓝带、标题非白 */
  const ch = await cdp.eval(`(async () => {
    App.go('att'); await new Promise(r => setTimeout(r, 450));
    const c = document.querySelector('#page-att.on .chead');
    if (!c) return null;
    const h = c.querySelector('h2');
    return { cheadGrad: (getComputedStyle(c).backgroundImage || '').includes('linear-gradient'), hColor: getComputedStyle(h).color };
  })()`);
  ok('att 章节头复原（无蓝带 / 标题非白）', ch && !ch.cheadGrad && !/255,\s*255,\s*255/.test(ch.hColor), JSON.stringify(ch));

  /* 2.4 settings 蓝框：::before 渐变 + 底部圆角 20px + 收小（高 < 160px） */
  const me = await cdp.eval(`(async () => {
    App.go('settings'); await new Promise(r => setTimeout(r, 450));
    const pg = document.querySelector('#page-settings.on');
    if (!pg) return null;
    const cs = getComputedStyle(pg, '::before');
    return { grad: (cs.backgroundImage || '').includes('linear-gradient'), radius: cs.borderBottomLeftRadius, h: parseFloat(cs.height) };
  })()`);
  ok('我的页蓝框保留（渐变 + 底部 20px 圆角 + 收小）', me && me.grad && me.radius === '20px' && me.h < 160, JSON.stringify(me));

  /* 2.5 教务首页轮播：C 卡金渐变 + 天数实算 + 露边 + 圆点 */
  const expDays = Math.ceil((new Date(2027, 0, 9) - new Date(new Date().setHours(0,0,0,0))) / 864e5);
  const car = await cdp.eval(`(async () => {
    App.go('home'); await new Promise(r => setTimeout(r, 500));
    const pg = document.querySelector('.page.on');
    const carEl = pg.querySelector('.v1-carousel');
    const cdCard = document.getElementById('v1CdCardAdm');
    const days = document.getElementById('v1CdDaysAdm');
    const ov = pg.querySelector('.v1-ov');
    const dots = carEl ? carEl.querySelectorAll('.v1-dots i') : [];
    const hero = pg.querySelector(':scope > .m2-hero');
    const tb = document.getElementById('topbar');
    const name = document.getElementById('topName');
    const badge = document.getElementById('v1Badge');
    const lock = document.querySelector('#topbar .brand-lock');
    return {
      shown: !!(carEl && getComputedStyle(carEl).display !== 'none'),
      grad: !!cdCard && (getComputedStyle(cdCard).backgroundImage || '').includes('rgb(220, 197, 154)'),
      days: days ? days.textContent : null,
      ovLeft: ov ? Math.round(ov.getBoundingClientRect().left) : null,
      ovRight: ov ? Math.round(ov.getBoundingClientRect().right) : null,
      vw: window.innerWidth,
      dots: dots.length,
      dotOn: carEl ? carEl.querySelectorAll('.v1-dots i.on').length : 0,
      heroHidden: !hero || getComputedStyle(hero).display === 'none',
      topbarShown: tb && getComputedStyle(tb).display !== 'none',
      greet: name ? name.textContent : '',
      badge: badge ? badge.textContent : '',
      lockH: lock ? Math.round(lock.getBoundingClientRect().height) : null,
    };
  })()`);
  ok('轮播·home 可见且 C 卡金渐变', car.shown && car.grad, JSON.stringify({ shown: car.shown, grad: car.grad }));
  /* computed 里 hex 会被 Chrome 转成 rgb()：#dcc59a → rgb(220, 197, 154) */
  ok('轮播·home 倒计时天数 = 距 2027-01-09 实算', car.days === String(expDays), `实际 ${car.days} / 期望 ${expDays}`);
  ok('轮播·home 概览卡右缘露边', car.ovRight > car.vw - 40 && car.ovLeft < car.vw, `left=${car.ovLeft} right=${car.ovRight} vw=${car.vw}`);
  ok('轮播·home 圆点 2 枚第 1 枚亮', car.dots === 2 && car.dotOn === 1, JSON.stringify({ dots: car.dots, on: car.dotOn }));
  ok('home m2-hero 已隐藏', car.heroHidden);
  ok('教务顶栏（显示 / 问候无逗号 / 金签「教务」/ logo 高 30px）',
     car.topbarShown && !car.greet.includes('，') && car.badge === '教务' && car.lockH === 30,
     JSON.stringify({ greet: car.greet, badge: car.badge, lockH: car.lockH }));
  const admOv = await cdp.eval(`(() => {
    const n = document.getElementById('v1OvNumAdm');
    const ft = document.getElementById('v1OvFt2Adm');
    return { num: n ? n.textContent : null, rate: ft ? ft.textContent : null };
  })()`);
  ok('教务概览卡真数据（学员数 / 出勤率来自数盘）',
     /^\d+$/.test(admOv.num || '') && /(\d+%|--)/.test(admOv.rate || ''), JSON.stringify(admOv));

  /* 2.6 撤蓝头后其他页顶栏维持隐藏（<699），mtabbar 五 Tab 不动 */
  const keep = await cdp.eval(`(async () => {
    App.go('att'); await new Promise(r => setTimeout(r, 450));
    const tbHidden = getComputedStyle(document.getElementById('topbar')).display === 'none';
    const btns = document.querySelectorAll('.mtabbar button');
    const barVisible = getComputedStyle(document.getElementById('mtabbar')).display !== 'none';
    return { tbHidden, n: btns.length, barVisible };
  })()`);
  ok('非首页顶栏维持隐藏（<699）+ mtabbar 五 Tab 不动', keep.tbHidden && keep.n === 5 && keep.barVisible, JSON.stringify(keep));

  /* 2.7 教师轮播 + 概览卡真数据 */
  await switchUser(cdp, TEACHER);
  const tcar = await cdp.eval(`(async () => {
    App.go('today'); await new Promise(r => setTimeout(r, 600));
    const pg = document.querySelector('.page.on');
    const cdCard = document.getElementById('v1CdCardTd');
    const days = document.getElementById('v1CdDaysTd');
    const n = document.getElementById('v1OvNumTd');
    const sub = document.getElementById('v1OvSubTd');
    const ov = pg.querySelector('.v1-ov');
    const tb = document.getElementById('topbar');
    const name = document.getElementById('topName');
    const badge = document.getElementById('v1Badge');
    const lock = document.querySelector('#topbar .brand-lock');
    return {
      shown: !!(cdCard && getComputedStyle(cdCard).display !== 'none'),
      days: days ? days.textContent : null,
      ovNum: n ? n.textContent : null,
      ovSub: sub ? sub.textContent : null,
      ovRight: ov ? Math.round(ov.getBoundingClientRect().right) : null,
      vw: window.innerWidth,
      topbarShown: tb && getComputedStyle(tb).display !== 'none',
      greet: name ? name.textContent : '',
      badge: badge ? badge.textContent : '',
      lockH: lock ? Math.round(lock.getBoundingClientRect().height) : null,
      titleHidden: getComputedStyle(document.querySelector('#page-today.on > .page-title')).display === 'none',
    };
  })()`);
  ok('轮播·today 可见且天数实算', tcar.shown && tcar.days === String(expDays), `days=${tcar.days}`);
  ok('教师概览卡真数据（今日节数 = #tdToday 行数）', /^\d+$/.test(tcar.ovNum || ''), `num=${tcar.ovNum} sub=${tcar.ovSub}`);
  ok('轮播·today 概览卡右缘露边', tcar.ovRight > tcar.vw - 40, `right=${tcar.ovRight} vw=${tcar.vw}`);
  ok('教师顶栏（显示 / 问候无逗号 / 金签「教师」/ logo 高 30px）',
     tcar.topbarShown && !tcar.greet.includes('，') && tcar.badge === '教师' && tcar.lockH === 30,
     JSON.stringify({ greet: tcar.greet, badge: tcar.badge, lockH: tcar.lockH }));
  ok('today 大标题行已隐藏', tcar.titleHidden);

  /* 2.8 教师页背景无蓝渐变 */
  const tbg = await cdp.eval(`(async () => {
    const ids = ['today','myclass','tickets'];
    const out = {};
    for (const id of ids) {
      App.go(id); await new Promise(r => setTimeout(r, 420));
      const pg = document.querySelector('.page.on');
      out[id] = pg ? (getComputedStyle(pg).backgroundImage || '').includes('linear-gradient') : null;
    }
    return out;
  })()`);
  const tStillBlue = Object.entries(tbg).filter(([, v]) => v).map(([k]) => k);
  ok('撤蓝头：教师 3 页背景无蓝渐变', tStillBlue.length === 0, tStillBlue.join(','));

  /* ═══ 3) 学生 4 页断言 ═══ */
  console.log('\n── 学生端断言 ──');
  await switchUser(cdp, STUDENT);
  /* 3.1 浅底大标题：stuSign 24px/800/非白 */
  const pt = await cdp.eval(`(async () => {
    App.go('stuSign'); await new Promise(r => setTimeout(r, 500));
    const el = document.querySelector('#page-stuSign.on > .page-title');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { fs: cs.fontSize, fw: cs.fontWeight, color: cs.color, text: el.textContent.trim() };
  })()`);
  ok('浅底大标题（打卡页 24px/800 非白）', pt && pt.fs === '24px' && (pt.fw === '800' || pt.fw === 'bold') && !/255,\s*255,\s*255/.test(pt.color), JSON.stringify(pt));

  const stu = await cdp.eval(`(async () => {
    App.go('stuHome'); await new Promise(r => setTimeout(r, 700));
    const pg = document.querySelector('#page-stuHome.on');
    if (!pg) return null;
    const order = [...pg.children]
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => ({ cls: el.className || el.tagName, ord: +getComputedStyle(el).order || 0,
                    top: Math.round(el.getBoundingClientRect().top) }))
      .sort((a, b) => a.top - b.top)
      .map(x => x.cls);
    const carEl = pg.querySelector('.v1-carousel');
    const cdCard = document.getElementById('v1CdCardStu');
    const days = document.getElementById('v1CdDaysStu');
    const ov = pg.querySelector('.v1-ov');
    const dots = carEl ? carEl.querySelectorAll('.v1-dots i') : [];
    const hero = pg.querySelector(':scope > .m2-hero');
    return {
      order: order.slice(0, 6),
      shown: !!(carEl && getComputedStyle(carEl).display !== 'none'),
      grad: !!cdCard && (getComputedStyle(cdCard).backgroundImage || '').includes('rgb(220, 197, 154)'),
      days: days ? days.textContent : null,
      ovNum: document.getElementById('v1OvNumStu') ? document.getElementById('v1OvNumStu').textContent : null,
      ovSub: document.getElementById('v1OvSubStu') ? document.getElementById('v1OvSubStu').textContent : null,
      ovFt: document.getElementById('v1OvFtStu') ? document.getElementById('v1OvFtStu').textContent : null,
      ovRight: ov ? Math.round(ov.getBoundingClientRect().right) : null,
      vw: window.innerWidth,
      dots: dots.length,
      dotOn: carEl ? carEl.querySelectorAll('.v1-dots i.on').length : 0,
      heroHidden: !hero || getComputedStyle(hero).display === 'none',
      greet: document.getElementById('topName') ? document.getElementById('topName').textContent : '',
      badge: !!document.getElementById('v1Badge'),
      wm: !!document.querySelector('#watermark') && getComputedStyle(document.querySelector('#watermark')).display !== 'none',
    };
  })()`);
  ok('stuHome 版序：轮播 → 打卡卡（类序替代 nth-child）',
     stu && stu.order.length >= 2 && String(stu.order[0]).includes('v1-carousel') && String(stu.order[1]).includes('m2-k-sign'),
     JSON.stringify(stu && stu.order));
  ok('轮播·stuHome 可见且 C 卡金渐变 + 天数实算', stu && stu.shown && stu.grad && stu.days === String(expDays), `days=${stu && stu.days}`);
  ok('轮播·stuHome 概览卡露边 + 圆点', stu && stu.ovRight > stu.vw - 40 && stu.dots === 2 && stu.dotOn === 1, `right=${stu && stu.ovRight}`);
  ok('学生概览卡真数据（今日节数 / 下一节 / 日期周次）',
     stu && /^\d+$/.test(stu.ovNum || '') && !!stu.ovSub && !!stu.ovFt, JSON.stringify({ num: stu && stu.ovNum, sub: stu && stu.ovSub, ft: stu && stu.ovFt }));
  ok('stuHome m2-hero 已隐藏', stu && stu.heroHidden);
  ok('学生顶栏问候无逗号且无角色金签', stu && !stu.greet.includes('，') && !stu.badge, `greet=${stu && stu.greet}`);
  ok('学生水印仍在（StuMark 不动）', stu && stu.wm);

  /* 3.2 学生三页背景无蓝渐变 */
  const sbg = await cdp.eval(`(async () => {
    const ids = ['stuSign','stuHw','stuTable'];
    const out = {};
    for (const id of ids) {
      App.go(id); await new Promise(r => setTimeout(r, 420));
      const pg = document.querySelector('.page.on');
      out[id] = pg ? (getComputedStyle(pg).backgroundImage || '').includes('linear-gradient') : null;
    }
    return out;
  })()`);
  const sStillBlue = Object.entries(sbg).filter(([, v]) => v).map(([k]) => k);
  ok('撤蓝头：学生 3 页背景无蓝渐变', sStillBlue.length === 0, sStillBlue.join(','));

  /* ═══ 3b) 三身份 13 页手机截图（对照样张用）═══ */
  await switchUser(cdp, SUPER);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(400);
  for (const id of ['home','att','homework','timetable','settings']) {
    await goShot(cdp, id, path.join(OUT, 'mobile', `A-${id}.png`));
  }
  await switchUser(cdp, TEACHER);
  for (const id of ['today','myclass','tickets']) {
    await goShot(cdp, id, path.join(OUT, 'mobile', `A-t-${id}.png`));
  }
  await switchUser(cdp, STUDENT);
  for (const id of ['stuHome','stuSign','stuHw','stuTable']) {
    await goShot(cdp, id, path.join(OUT, 'mobile', `A-s-${id}.png`));
  }
  console.log('  （13 页手机截图已存 docs/v1-mobile-shots/mobile/）');

  /* ═══ 4) 深色 2 页 ═══ */
  console.log('\n── 深色模式 2 页 ──');
  await switchUser(cdp, SUPER);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  const dark = await cdp.eval(`(async () => {
    const out = {};
    App.go('home'); await new Promise(r => setTimeout(r, 500));
    out.homePaper = getComputedStyle(document.querySelector('#page-home.on')).getPropertyValue('--paper').trim();
    out.goldNum = getComputedStyle(document.querySelector('#page-home.on .m2-stat.hot .num')).color;
    App.go('settings'); await new Promise(r => setTimeout(r, 450));
    const me = document.querySelector('#page-settings.on');
    out.mePaper = getComputedStyle(me).getPropertyValue('--paper').trim();
    out.meBefore = (getComputedStyle(me, '::before').backgroundImage || '').includes('linear-gradient');
    return out;
  })()`);
  ok('深色·教务首页 --paper #18211E', /18211E/i.test(dark.homePaper), dark.homePaper);
  ok('深色·数盘热格数字翻深色金 #D9BE86', /217,\s*190,\s*134/.test(dark.goldNum), dark.goldNum);
  ok('深色·我的页蓝框仍在（固定品牌面）', dark.meBefore);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* ═══ 5) 375 / 320 溢出抽查 ═══ */
  console.log('\n── 375 / 320 溢出与底部遮挡（抽查）──');
  const overflowProbe = (w, id) => cdp.eval(`(async () => {
    const dg = document.getElementById('devGate'); if (dg) dg.style.display = 'none';
    App.go(${JSON.stringify(id)}); await new Promise(r => setTimeout(r, 550));
    const pg = document.querySelector('.page.on');
    let overflowEl = null, detail = '';
    document.querySelectorAll('.page.on *').forEach(el => {
      if (overflowEl) return;
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed') {
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') { clipped = true; break; }
        }
        if (clipped) return;
        overflowEl = (el.className && String(el.className)) || el.tagName;
        detail = el.tagName + ' right=' + Math.round(b.right) + ' «' + (el.textContent || '').trim().slice(0, 18) + '»';
      }
    });
    return { docOk: document.documentElement.scrollWidth <= window.innerWidth,
             pagePadBottom: parseFloat(getComputedStyle(pg).paddingBottom), overflowEl, detail };
  })()`).then(r => {
    ok(`${w}px · ${id} 无横向溢出`, r.docOk && !r.overflowEl, r.overflowEl ? ('溢出：' + r.overflowEl + ' ' + r.detail) : '');
    ok(`${w}px · ${id} 底部不被 mtabbar 遮挡`, r.pagePadBottom >= 68, 'padding-bottom=' + r.pagePadBottom);
  });
  for (const w of [375, 320]) {
    await view(cdp, { width: w, height: 812, dsf: 2, mobile: true });
    await sleep(400);
    for (const id of ['stuHome','stuSign']) await overflowProbe(w, id);   // 学生页（当前是学生身份）
    await switchUser(cdp, SUPER);
    for (const id of ['home','att','settings']) await overflowProbe(w, id);
    if (w === 320) break;
    await switchUser(cdp, STUDENT);   // 回学生，供下一宽度继续
  }

  console.log('\n' + (fails.length ? '❌ 失败 ' + fails.length + ' 项：\n  - ' + fails.join('\n  - ') : '✅ 全部通过'));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\n✗ 验证失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  srvA.kill(); srvB.kill();
  try { execSync(`git -C ${JSON.stringify(dir)} worktree remove --force ${BASE_DIR}`, { stdio: 'pipe' }); } catch {}
}
