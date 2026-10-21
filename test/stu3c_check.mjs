/**
 * v87 两页样例结构重排验证脚本 —— stuHome（← m-home-student）/ home（← m-home-admin）自证。
 *
 *   node test/stu3c_check.mjs
 *
 * 做四件事：
 *   1) 桌面 ≥1100 逐像素一致自证：当前工作区 vs 0c5f170 基线 worktree，同一份演示数据、
 *      屏蔽动态内容（时钟/新闻/游标/问候）后，1440×1000 截 home（super）与 stuHome（学生）
 *      逐像素比对。
 *   2) 390px 整页截图（浅色/深色 × 两页）：#main.scrollTop 逐屏滚动 + clip，纵向拼接，
 *      不撑视口；存 docs/stu3c-sample-shots/。
 *   3) 样张 vs 成品对照长图（左样张右成品，同宽对齐 + 区块名标注）。
 *   4) 功能断言：数盘/待办数字与 Store 实算一致（举例对照）、mtabbar 点击切页、
 *      打卡大按钮入口可达、hero 问候用真实登录人姓名、390 无横向溢出。
 *
 * 基线 worktree：git worktree add /tmp/ly87-base 0c5f170（脚本自建）。
 * 截图输出：docs/stu3c-sample-shots/（工作区侧）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const PORT_A = 5471, PORT_B = 5472;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'stu3c-sample-shots');
const BASE_DIR = '/tmp/ly87-base';
const SAMPLE_DIR = path.join(dir, 'docs', 'preview-mobile-2026-10');
const SUPER = { user: '李老师', pass: 'liyun2026' };
const STU   = { user: '陈同学', pass: 'liyun2026' };

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
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });
const scheme = (cdp, v) => cdp.send('Emulation.setEmulatedMedia',
  { features: [{ name: 'prefers-color-scheme', value: v }] });

/** 屏蔽动态内容（时钟 / 新闻 / 「现在」游标 / 问候与日期副题）—— 基线与工作区两侧同一份 */
const MASK_JS = `(() => {
  document.querySelectorAll('.clock, .m2-greet, .m2-sub, .tl-now, #tlNowSr, [data-next]').forEach(e => e.style.visibility = 'hidden');
  ['newsBody','newsMore','newsMeta','m2Rate','m2WeekHrs','m2OpenCnt'].forEach(id => {
    const e = document.getElementById(id); if (e) e.textContent = '';
  });
  return 1;
})()`;

/** 演示数据（两侧同构；时刻固定，避开「x 分钟前」抖动） */
const SEED_JS = `(async () => {
  const today = Util.today();
  const todayName = Schedule.DAYS[(new Date().getDay() + 6) % 7];
  const c1 = Store.upsert('classes', { name: '砺蕴一班' });
  const c2 = Store.upsert('classes', { name: '集训班' });
  const N1 = ['陈同学','李思远','张予诺','王梓涵','刘浩然','赵一诺','孙嘉禾','周若溪'];
  const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
  const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
  const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
  s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id, pid: 'am',
    status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : '正常' }));
  s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, pid: 'am', status: '正常' }));
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
  const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
  const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
  sch(todayName, p1.id, '普通话语音基础', '砺蕴一班');
  sch(todayName, p3.id, '新闻播报实训', '砺蕴一班');
  sch(todayName, p2.id, '即兴评述训练', '集训班');
  sch('周一', p1.id, '声乐基训', '砺蕴一班');
  sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
  sch('周五', p3.id, '模拟主持', '集训班');
  Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
  Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
  const hk = (sid, done) => Store.upsert('hwchk:' + today, { classId: c1.id, studentId: sid, done });
  s1.slice(0, 4).forEach(s => hk(s.id, true)); hk(s1[5].id, false);
  Store.upsert('tickets', { type: '调课申请', byName: '张伟', text: '周三第 2 节想换到周四同一节',
    status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  Store.upsert('tickets', { type: '学生请假', studentId: s1[5].id, kind: '病假', date: today,
    text: '昨晚发烧到 39 度，今天在家休息。', status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  Store.upsert('notices', { date: today, text: '十月家长开放日安排\\n本周六 14:00 开放上镜实训观摩，欢迎家长到教室旁听。', by: '李老师', at: Date.now() - 86400000 });
  Store.upsert('notices', { date: today, text: '下周三外拍报名截止\\n滨江实景外拍名额有限，请在限时征集里完成报名。', by: '李老师', at: Date.now() - 3600000 });
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id, c2.id] }); } catch(e){}
  try { await Auth.call('users', { op: 'create', user: '陈同学', name: '陈同学', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch(e){}
  /* 学生换设备密钥 ×2：测试浏览器视口一变 Stu.dev() 指纹就变，第二次学生登录要过设备门 */
  try {
    const kIn = document.getElementById('devKeyNew');
    if (kIn && typeof Settings !== 'undefined' && Settings.devKeyAdd){
      kIn.value = 'STU3C-1'; Settings.devKeyAdd();
      kIn.value = 'STU3C-2'; Settings.devKeyAdd();
    }
  } catch(e){}
  try { await Sync.push(); } catch(e){}
  Store.set('_attCls', c1.id); Store.set('_attDate', today);
  Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
  /* 注意：不要在这里压「记得备份」横幅 —— 两侧消失时机不同会制造桌面 diff 假差异 */
  return { c1: c1.id, c2: c2.id, todayName };
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
    await new Promise(r => setTimeout(r, 2200));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + cred.user);
  return lg.role;
}
/** 学生登录：视口指纹变了会弹「设备密钥」门 —— 用种子里预置的 STU3C-1 过门后重登 */
let CUR_BASE = '';
async function loginStudent(cdp, cred) {
  await login(cdp, cred);
  let gateOn = await cdp.eval(`document.getElementById('devGate').classList.contains('on')`);
  if (gateOn) {
    await cdp.eval(`(async () => {
      document.getElementById('devKeyIn').value = 'STU3C-1';
      await StuDev.submit();
      await new Promise(r => setTimeout(r, 1200));
      return 1;
    })()`);
    await sleep(400);
    await cdp.send('Page.navigate', { url: CUR_BASE + '/' });
    await sleep(2800);
    await login(cdp, cred);
    gateOn = await cdp.eval(`document.getElementById('devGate').classList.contains('on')`);
    if (gateOn) throw new Error('学生设备密钥门没过（STU3C-1）');
  }
}
async function go(cdp, pageId, wait = 700) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  await sleep(wait);
}

/** 逐像素比对：两张 PNG 喂 canvas，数差异像素（容差 8/通道） */
async function diffTwo(cdp, bufA, bufB) {
  const a = bufA.toString('base64'), b = bufB.toString('base64');
  return cdp.eval(`(async () => {
    const load = b64 => new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('img load fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const ia = await load(${JSON.stringify(a)}), ib = await load(${JSON.stringify(b)});
    if (ia.width !== ib.width || ia.height !== ib.height) return { mismatch: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const ca = document.createElement('canvas'); ca.width = ia.width; ca.height = ia.height;
    const cb = document.createElement('canvas'); cb.width = ib.width; cb.height = ib.height;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, ia.width, ia.height).data;
    const db = xb.getImageData(0, 0, ib.width, ib.height).data;
    let bad = 0, fx = -1, fy = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) {
        bad++; if (fx < 0) { const p = i / 4; fx = p % ia.width; fy = Math.floor(p / ia.width); }
      }
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4), first: fx < 0 ? null : [fx, fy] };
  })()`);
}

/** 等 #main 高度稳定（新闻流/横幅等异步渲染会让 scrollHeight 连涨几轮） */
async function settleMain(cdp) {
  let prev = -1;
  for (let i = 0; i < 25; i++){
    const h = await cdp.eval(`document.getElementById('main').scrollHeight`);
    if (h === prev && h > 0) return h;
    prev = h;
    await sleep(400);
  }
  return prev;
}

/** 整页截图：#main.scrollTop 逐屏（步长 = 视口高 − 底栏 68）滚动，整视口截屏后纵向拼接。
    不用 clip：clip 坐标是文档系，跟视口滚动叠加会把同一段内容截 N 遍。
    滚动赋值带重试：页面高度异步变化时 scrollTop 会被吞，读到不符就再设一遍。 */
async function fullShot(cdp, file, { dsf = 2, vw = 390, vh = 844, tab = 68 } = {}) {
  await cdp.eval(`document.getElementById('main').scrollTop = 0`);
  const H = await settleMain(cdp);
  const step = vh - tab;
  const segs = [];
  let y = 0;
  while (true) {
    const want = Math.max(0, Math.min(y, H - vh));
    let at = -1;
    for (let t = 0; t < 6; t++){
      at = await cdp.eval(`(() => { const m = document.getElementById('main'); m.scrollTop = ${want}; return m.scrollTop; })()`);
      if (at === want) break;
      await sleep(320);
    }
    await sleep(300);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const last = at + vh >= H - 2;
    segs.push({ b64: r.data, at, last });
    if (last) break;
    const nxt = at + step;
    if (nxt <= at || nxt > 30000) { segs[segs.length - 1].last = true; break; }
    y = nxt;
  }
  /* 拼接：除末段外裁掉底部 tab 高度（.mtabbar 是 fixed，会烙进每屏截图） */
  const expr = `(async () => {
    const segs = ${JSON.stringify(segs.map(s => ({ b64: s.b64, at: s.at, last: s.last })))};
    const dsf = ${dsf}, tab = ${tab}, H = ${H};
    const load = b64 => new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('seg load fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const imgs = [];
    for (const s of segs) imgs.push({ img: await load(s.b64), at: s.at, last: s.last });
    const cw = imgs[0].img.width, ch = Math.ceil(H * dsf);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#f7f6f2'; cx.fillRect(0, 0, cw, ch);
    imgs.forEach(o => {
      const cropH = o.last ? o.img.height : o.img.height - tab * dsf;
      cx.drawImage(o.img, 0, 0, o.img.width, cropH, 0, o.at * dsf, o.img.width, cropH);
    });
    return cv.toDataURL('image/png').split(',')[1];
  })()`;
  const b64 = await cdp.eval(expr);
  await writeFile(file, Buffer.from(b64, 'base64'));
  console.log('  fullShot:', path.basename(file), 'H=' + H, 'segs=' + segs.length, 'ats=' + segs.map(s => s.at).join('/'));
  return { h: H, segs: segs.length };
}

/** 对照长图：左样张右成品（同宽对齐），样张侧标注区块名 */
async function composeCmp(cdp, samplePng, productPng, blocks, file, { pageH } = {}) {
  const expr = `(async () => {
    const load = b64 => new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('img fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const s = await load(${JSON.stringify(samplePng.toString('base64'))});
    const p = await load(${JSON.stringify(productPng.toString('base64'))});
    const W = 390, gap = 88, pad = 24, head = 46;
    const ph = Math.round(p.height / (p.width / W));          /* 成品缩放到 390 宽 */
    const H = head + Math.max(s.height, ph) + pad;
    const cv = document.createElement('canvas'); cv.width = pad + W + gap + W + pad; cv.height = H;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#e9e7e1'; cx.fillRect(0, 0, cv.width, H);
    cx.fillStyle = '#2b3a5e'; cx.font = '600 20px "PingFang SC"';
    cx.fillText('样张（验收稿）', pad, 30);
    cx.fillText('成品（v87 生产）', pad + W + gap, 30);
    cx.drawImage(s, pad, head);
    cx.drawImage(p, 0, 0, p.width, p.height, pad + W + gap, head, W, ph);
    cx.strokeStyle = '#a8895a'; cx.lineWidth = 1;
    cx.font = '12px "PingFang SC"'; cx.fillStyle = '#6b7284';
    const blocks = ${JSON.stringify(blocks)};
    for (const b of blocks) {
      const y = head + b.y;
      cx.beginPath(); cx.moveTo(pad - 14, y); cx.lineTo(pad + W + 14, y); cx.stroke();
      cx.fillText(b.t, pad - 10, y - 4);
    }
    return cv.toDataURL('image/png').split(',')[1];
  })()`;
  const b64 = await cdp.eval(expr);
  await writeFile(file, Buffer.from(b64, 'base64'));
}

/* ── 基线 worktree ── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} 0c5f170`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

try {
  await mkdir(OUT, { recursive: true });
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(0c5f170 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'stu3c-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5498',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5498/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  /* ═══ 1) 桌面 1440 像素 diff（vs 0c5f170）═══ */
  console.log('── 桌面 1440 像素 diff（动态内容已屏蔽）──');
  await view(cdp, { width: 1440, height: 1000, dsf: 1, mobile: false });
  const shots = { A: {}, B: {} };
  for (const [tag, base, store] of [['A', BASE_A, shots.A], ['B', BASE_B, shots.B]]) {
    CUR_BASE = base;
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2800);
    await login(cdp, SUPER);
    await cdp.eval(SEED_JS);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    await sleep(1000);
    await go(cdp, 'home');
    await cdp.eval(MASK_JS); await sleep(220);
    let r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, `desktop-${tag}-home.png`), Buffer.from(r.data, 'base64'));
    store.home = path.join(OUT, `desktop-${tag}-home.png`);
    /* 学生端 stuHome */
    await loginStudent(cdp, STU);
    await go(cdp, 'stuHome');
    await cdp.eval(MASK_JS); await sleep(220);
    r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, `desktop-${tag}-stuHome.png`), Buffer.from(r.data, 'base64'));
    store.stuHome = path.join(OUT, `desktop-${tag}-stuHome.png`);
  }
  for (const [id, label] of [['home', '教务首页'], ['stuHome', '学生今日']]) {
    const d = await diffTwo(cdp, await readFile(shots.A[id]), await readFile(shots.B[id]));
    const good = !d.mismatch && d.bad === 0;
    ok(`桌面 1440 · ${label} 与 0c5f170 逐像素一致`, good,
      d.mismatch ? ('尺寸不一致 ' + d.mismatch) : (`差异像素 ${d.bad}/${d.total}` + (d.first ? ' 首个 ' + JSON.stringify(d.first) : '')));
  }

  /* ═══ 2) 390 手机视口：整页截图（浅/深 × 两页）+ 功能断言 ═══ */
  console.log('\n── 390 手机视口：整页截图 + 功能断言（工作区）──');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  await scheme(cdp, 'light');
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  CUR_BASE = BASE_A;
  await sleep(2800);
  /* 学生：stuHome */
  await loginStudent(cdp, STU);
  await go(cdp, 'stuHome');
  const stuCheck = await cdp.eval(`(() => {
    const g = (id) => (document.getElementById(id) || {}).textContent || '';
    return {
      greet: g('m2StuGreet'), sub: g('m2StuSub'),
      bt: g('m2StuSignBt'), bs: g('m2StuSignBs'),
      clsMore: g('m2StuClsMore'), clsExp: Stu.todayLessons().length + ' 节',
      notices: document.querySelectorAll('#m2StuNotices .m2-notice').length,
      heroVisible: getComputedStyle(document.querySelector('#page-stuHome .m2-hero')).display !== 'none',
      oldTitleHidden: getComputedStyle(document.querySelector('#page-stuHome .page-title')).display === 'none',
      tabN: document.querySelectorAll('.mtabbar button').length,
      wm: getComputedStyle(document.getElementById('watermark')).maskImage.includes('svg'),
      name: Auth.name(),
    };
  })()`);
  ok('stuHome hero 问候用真实登录人姓名', stuCheck.greet.includes(stuCheck.name) && stuCheck.greet.includes('好'),
    JSON.stringify({ greet: stuCheck.greet, name: stuCheck.name }));
  ok('stuHome 打卡大按钮为真实状态（未打卡）', stuCheck.bt.includes('进入打卡') && stuCheck.bs.includes('还没打卡'), JSON.stringify({ bt: stuCheck.bt, bs: stuCheck.bs }));
  ok('stuHome 「今天上课」节数=Stu.todayLessons() 实算', stuCheck.clsMore === stuCheck.clsExp, `DOM=${stuCheck.clsMore} 实算=${stuCheck.clsExp}`);
  ok('stuHome 校园公告渲染 2 条（真实 notices）', stuCheck.notices === 2, '条数=' + stuCheck.notices);
  ok('stuHome 新结构可见、桌面页头隐藏（<1100）', stuCheck.heroVisible && stuCheck.oldTitleHidden);
  ok('stuHome 5-Tab 在位', stuCheck.tabN === 5);
  ok('StuMark 水印原样在位（学生端）', stuCheck.wm);
  await fullShot(cdp, path.join(OUT, 'm-stuHome-light.png'));
  await scheme(cdp, 'dark'); await sleep(500);
  await fullShot(cdp, path.join(OUT, 'm-stuHome-dark.png'));
  await scheme(cdp, 'light');
  /* 打卡大按钮入口可达 + mtabbar 切页 */
  await cdp.eval(`(() => { document.querySelector('#page-stuHome .m2-bigbtn').click(); return 1; })()`);
  await sleep(600);
  const btnGo = await cdp.eval(`document.querySelector('.page.on').id`);
  ok('打卡大按钮点击 → 打卡页（现有页面 id）', btnGo === 'page-stuSign', btnGo);
  await cdp.eval(`(() => { [...document.querySelectorAll('.mtabbar button')].find(b => b.dataset.id === 'stuHome').click(); return 1; })()`);
  await sleep(500);
  const mb1 = await cdp.eval(`(async () => { App.go('stuHw'); await new Promise(r => setTimeout(r, 500)); return [...document.querySelectorAll('.mtabbar button.on')].map(b => b.dataset.tab).join(','); })()`);
  ok('mtabbar 切页高亮跟随（stuHw → 作业）', mb1 === '作业', mb1);

  /* 教务：home */
  await cdp.eval(`(async () => { Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200)); return 1; })()`);
  await sleep(800);
  await go(cdp, 'home');
  /* 手机端截图不带「记得备份」横幅噪声（桌面 diff 阶段已结束，不影响基线比对） */
  await cdp.eval(`(() => { Store.set('_lastBackup', Date.now());
    document.querySelectorAll('.page.on .banner').forEach(e => e.remove()); return 1; })()`);
  await sleep(300);
  /* 数盘/待办 与 Store 实算对照（举例核对） */
  const adm = await cdp.eval(`(() => {
    const g = id => (document.getElementById(id) || {}).textContent || '';
    const today = Util.today();
    const stus = Util.realStudents();
    const slots = Att.SLOTS();
    let okc = 0, tot = 0;
    slots.forEach(sl => { const map = Att.byStu(today, sl.id); stus.forEach(s => { tot++; if (map[s.id] === '正常') okc++; }); });
    const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const wd = new Set(); for (let i = 0; i < 7; i++){ const d = new Date(monday); d.setDate(monday.getDate() + i); wd.add(Schedule.DAYS[(d.getDay() + 6) % 7]); }
    const open = Store.list('tickets').filter(x => x && x.status === 'open' && x.type !== '学生消息').length;
    return {
      domRate: g('m2Rate'), domStu: g('m2StuCnt'), domHrs: g('m2WeekHrs'), domOpen: g('m2OpenCnt'),
      expRate: tot ? Math.round(okc / tot * 100) + '%' : '--', expStu: String(stus.length),
      expHrs: String(Store.list('schedule').filter(x => wd.has(x.day)).length), expOpen: String(open),
      badge: g('m2AdmBadgeTx'), sub: g('m2AdmSub'),
      todoRows: document.querySelectorAll('#m2TodoBody .m2-row').length,
      todoTx: (document.getElementById('m2TodoBody') || {}).textContent || '',
      greet: g('m2AdmGreet'), name: Auth.name(),
      gridN: document.querySelectorAll('#page-home .m2-grid4 .gi').length,
      tlThere: !!document.getElementById('tlWrap') && document.querySelectorAll('#tlAxis .tl-tick').length > 0,
    };
  })()`);
  ok('数盘·今日出勤率与 Store 实算一致（正常/应到）', adm.domRate === adm.expRate, `DOM=${adm.domRate} 实算=${adm.expRate}`);
  ok('数盘·在读学员=Util.realStudents()', adm.domStu === adm.expStu, `DOM=${adm.domStu} 实算=${adm.expStu}`);
  ok('数盘·本周课时=schedule 本周一~周日', adm.domHrs === adm.expHrs, `DOM=${adm.domHrs} 实算=${adm.expHrs}`);
  ok('数盘·待处理=open 工单数', adm.domOpen === adm.expOpen, `DOM=${adm.domOpen} 实算=${adm.expOpen}`);
  ok('待办区真实数据（1 请假 + 1 上报 → 2 行）', adm.todoRows === 2 && adm.todoTx.includes('学生请假') && adm.todoTx.includes('老师上报'), adm.todoTx.slice(0, 80));
  ok('hero 角色徽标+副题真实（姓名/班级数/学员数）', adm.badge === '总教务' && adm.sub.includes('个班') && adm.sub.includes('位在读学员'), adm.sub);
  ok('hero 问候含真实姓名', adm.greet.includes(adm.name), adm.greet);
  ok('宫格 8 项', adm.gridN === 8);
  ok('时间轴主轴 #tlWrap 保留且刻度在位', adm.tlThere);
  await settleMain(cdp);   /* 等新闻流等异步内容高度稳定再截整页 */
  await fullShot(cdp, path.join(OUT, 'm-home-light.png'));
  await scheme(cdp, 'dark'); await sleep(500);
  await fullShot(cdp, path.join(OUT, 'm-home-dark.png'));
  await scheme(cdp, 'light');
  /* mtabbar：首页 → 考勤页 */
  await go(cdp, 'home', 400);
  await cdp.eval(`(() => { [...document.querySelectorAll('.mtabbar button')].find(b => b.dataset.id === 'att').click(); return 1; })()`);
  await sleep(600);
  const mb2 = await cdp.eval(`document.querySelector('.page.on').id`);
  ok('mtabbar 点击切页（首页→考勤）', mb2 === 'page-att', mb2);

  /* 390 溢出检查 */
  for (const [id, label] of [['stuHome', '学生今日'], ['home', '教务首页']]) {
    if (id === 'stuHome'){
      await cdp.eval(`(async () => { Store.setSecret('token',''); Auth._me = null; Auth.show();
        document.getElementById('gUser').value = ${JSON.stringify(STU.user)};
        document.getElementById('gPass').value = ${JSON.stringify(STU.pass)};
        await Auth.submit(); await new Promise(r => setTimeout(r, 2200)); return 1; })()`);
      await sleep(800);
      const g2 = await cdp.eval(`document.getElementById('devGate').classList.contains('on')`);
      if (g2) throw new Error('390 溢出检查：学生设备门又弹了');
    }
    await go(cdp, id, 500);
    const r = await cdp.eval(`(() => {
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
      return { docOk: document.documentElement.scrollWidth <= window.innerWidth, overflowEl, detail };
    })()`);
    ok(`390px · ${label} 无横向溢出`, r.docOk && !r.overflowEl, r.overflowEl ? (r.overflowEl + ' ' + r.detail) : '');
  }

  /* ═══ 3) 样张 vs 成品对照长图 ═══ */
  console.log('\n── 样张 vs 成品对照长图 ──');
  await view(cdp, { width: 390, height: 844, dsf: 1, mobile: true });
  await scheme(cdp, 'light');
  /* 样张：学生今日（隐藏样张自身 fixed 底栏，避免整页捕获时烙进长图伪影） */
  await cdp.send('Page.navigate', { url: 'file://' + path.join(SAMPLE_DIR, 'm-home-student.html') });
  await sleep(1200);
  await cdp.eval(`(() => { const st = document.createElement('style'); st.textContent = '.tabbar,.mtabbar,.lg-tabbar{display:none!important}'; document.head.appendChild(st); return 1; })()`);
  const stuBlocks = await cdp.eval(`(() => {
    const out = [];
    const g = document.querySelector('.hero .greet'); if (g) out.push({ t: 'hero 问候', y: Math.max(0, g.getBoundingClientRect().top + scrollY - 40) });
    document.querySelectorAll('.sec').forEach(s => out.push({ t: (s.querySelector('h2') || {}).textContent || '', y: s.getBoundingClientRect().top + scrollY - 8 }));
    return out;
  })()`);
  let r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const sampleStu = Buffer.from(r.data, 'base64');
  /* 样张：教务首页（同样隐藏 fixed 底栏） */
  await cdp.send('Page.navigate', { url: 'file://' + path.join(SAMPLE_DIR, 'm-home-admin.html') });
  await sleep(1200);
  await cdp.eval(`(() => { const st = document.createElement('style'); st.textContent = '.tabbar,.mtabbar,.lg-tabbar{display:none!important}'; document.head.appendChild(st); return 1; })()`);
  const admBlocks = await cdp.eval(`(() => {
    const out = [];
    const g = document.querySelector('.hero .greet'); if (g) out.push({ t: 'hero 问候', y: Math.max(0, g.getBoundingClientRect().top + scrollY - 40) });
    document.querySelectorAll('.sec').forEach(s => out.push({ t: (s.querySelector('h2') || {}).textContent || '', y: s.getBoundingClientRect().top + scrollY - 8 }));
    return out;
  })()`);
  r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const sampleAdm = Buffer.from(r.data, 'base64');
  /* 成品整页图已在上面截好，直接读文件拼对照 */
  await composeCmp(cdp, sampleStu, await readFile(path.join(OUT, 'm-stuHome-light.png')), stuBlocks, path.join(OUT, 'cmp-stuHome.png'));
  await composeCmp(cdp, sampleAdm, await readFile(path.join(OUT, 'm-home-light.png')), admBlocks, path.join(OUT, 'cmp-home.png'));
  ok('对照长图 2 张已生成', true, 'docs/stu3c-sample-shots/cmp-stuHome.png · cmp-home.png');

  console.log('\n' + (fails.length ? '❌ 失败 ' + fails.length + ' 项：' + fails.join('；') : '✅ 全部通过'));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\n✗ 验证失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  srvA.kill(); srvB.kill();
  try { execSync(`git -C ${JSON.stringify(dir)} worktree remove --force ${BASE_DIR}`, { stdio: 'pipe' }); } catch {}
}
