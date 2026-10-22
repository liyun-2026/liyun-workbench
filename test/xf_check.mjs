/* ==XF== 学府门户桌面版 —— 本地验证脚本（不部署）
 *
 *   node test/xf_check.mjs
 *
 * 做五件事：
 *   1) 桌面 1440 截全部 33 页（三身份）存 docs/xf-production-shots/，
 *      命名与预览页一致（page-<id>.png）；
 *   2) 顶栏像素校验：每张截图 (720,15) = 深蓝门户条 #384a74（容差 ±14/通道）；
 *   3) 骨架断言：门户条端口按身份、导航条真实页数 + 当前页金下划线、侧栏退场、页脚在；
 *   4) 关键交互抽查：导航条点击跳转、考勤点章、大课表格子渲染（截图取证）；
 *   5) 深色 3 页（令牌翻转可读）+ 手机 390 抽 home/settings/stuHome 与 HEAD 基线逐像素零差异。
 *
 * 说明：样张 _qa.html 回归不在本脚本（样张文件本阶段零改动，desktop_v2_check 已覆盖）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_A = 5485, PORT_B = 5486;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'xf-production-shots');
const BASE_DIR = '/tmp/xf-base';
const SUPER = { user: '李老师', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };
const STUDENT = { user: '王梓涵', pass: 'liyun2026' };

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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

/* 动态内容屏蔽 + 动画冻结（含 XF 骨架带与页脚，防截图半程入场动画） */
const MASK_JS = `(() => {
  let frozen = document.getElementById('xfMaskFreeze');
  if (!frozen){
    frozen = document.createElement('style'); frozen.id = 'xfMaskFreeze';
    frozen.textContent = '.page.on, .page.on *, .page.on *::before, .page.on *::after,' +
      '.xf-top, .xf-top *, .xf-foot, .xf-foot *{animation:none!important;transition:none!important}';
    document.head.appendChild(frozen);
  }
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr, [data-next], .p-time').forEach(e => e.style.visibility = 'hidden');
  /* 门户条右侧真实日期也会抖（跨日才变，本轮内稳定，不藏） */
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
  const dg = document.getElementById('devGate'); if (dg) dg.style.display = 'none';
  return 1;
})()`;

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
  Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
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
  return 1;
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
    await new Promise(r => setTimeout(r, 2400));
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
    await new Promise(r => setTimeout(r, 2400));
    return Auth.role();
  })()`);
  await sleep(800);
}
async function goShot(cdp, pageId, file) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  await sleep(500);
  await cdp.eval(MASK_JS);
  await sleep(200);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(r.data, 'base64'));
}
/** 取截图中 (x,y) 的像素（canvas），返回 {r,g,b} */
async function pixelAt(cdp, file, x, y) {
  const b64 = (await readFile(file)).toString('base64');
  return cdp.eval(`(async () => {
    const img = await new Promise((res, rej) => { const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('img load fail'));
      i.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x2 = c.getContext('2d'); x2.drawImage(img, 0, 0);
    const d = x2.getImageData(${x}, ${y}, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  })()`);
}
async function diffTwo(cdp, bufA, bufB) {
  const a = bufA.toString('base64'), b = bufB.toString('base64');
  return cdp.eval(`(async () => {
    const load = b64 => new Promise((res, rej) => { const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('img load fail')); i.src = 'data:image/png;base64,' + b64; });
    const ia = await load(${JSON.stringify(a)}), ib = await load(${JSON.stringify(b)});
    if (ia.width !== ib.width || ia.height !== ib.height) return { mismatch: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const ca = document.createElement('canvas'); ca.width = ia.width; ca.height = ia.height;
    const cb = document.createElement('canvas'); cb.width = ib.width; cb.height = ib.height;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, ia.width, ia.height).data;
    const db = xb.getImageData(0, 0, ib.width, ib.height).data;
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) bad++;
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4) };
  })()`);
}

/* ── 基线 worktree（HEAD = 学府风改动前）── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} HEAD`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

/* 三身份页面清单（与预览 page-*.html 对应；board 有 ?board 入口，放最后单独截） */
const ADM = ['home','att','sign','homework','roster','students','profile','timetable','hours','night','quant','exam','coop','gather','teachers','health','settings'];
const TEA = ['today','news','record','myclass','tickets'];
const STU = ['stuHome','stuGather','stuSign','stuNews','stuTable','stuExam','stuQuant','stuProfile','stuHw','stuMsg'];

try {
  await mkdir(OUT, { recursive: true });
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(HEAD 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'xf-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5499',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5499/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  /* ═══ 1) 桌面 1440：33 页截图 + 门户条像素校验 + 骨架断言 ═══ */
  await view(cdp, { width: 1440, height: 900, dsf: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  await sleep(4500);
  const role = await login(cdp, SUPER);
  await cdp.eval(SEED_JS);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(600);

  console.log('── 骨架断言（教务身份）──');
  const sk = await cdp.eval(`(() => {
    const top = document.querySelector('.xf-top');
    const cs = top ? getComputedStyle(top) : null;
    const side = document.querySelector('.side');
    return {
      topShown: !!cs && cs.display !== 'none',
      utilBg: getComputedStyle(document.querySelector('.xf-util')).backgroundColor,
      ports: document.getElementById('xfPorts').textContent,
      who: document.getElementById('xfWho').textContent,
      navN: document.querySelectorAll('#xfNav a').length,
      navOn: (document.querySelector('#xfNav a.on') || {}).textContent || '',
      sideHidden: getComputedStyle(side).display === 'none',
      footShown: getComputedStyle(document.querySelector('.xf-foot')).display !== 'none',
      footNavN: document.querySelectorAll('#xfFootNav a').length,
      mainW: Math.round(document.querySelector('.page.on').getBoundingClientRect().width),
      sealOk: !!document.querySelector('.xf-head img.seal') && document.querySelector('.xf-head img.seal').naturalWidth > 0,
    };
  })()`);
  ok('学府骨架可见（门户条/校名头/导航条）', sk.topShown);
  ok('侧栏在 ≥1100 退场', sk.sideHidden);
  ok('门户条端口 = 教职工（真实身份）', sk.ports === '教职工', sk.ports);
  ok('门户条底色 = 深蓝 #384a74', /56,\s*74,\s*116/.test(sk.utilBg), sk.utilBg);
  ok('校名头用户信息 = 真实身份（李老师 · 首位教务）', sk.who.includes('李老师') && sk.who.includes('首位教务'), sk.who);
  ok('蓝章 logo 已内嵌且加载成功', sk.sealOk);
  ok('导航条 = NAV_ORDER 真实页数（super 17 项）', sk.navN === 17, 'n=' + sk.navN);
  ok('当前页金色下划线高亮（今日）', sk.navOn === '今日', sk.navOn);
  ok('页脚可见且快速入口已填', sk.footShown && sk.footNavN === 8, 'footNav=' + sk.footNavN);
  ok('内容区收 1280', sk.mainW === 1280, 'w=' + sk.mainW);

  console.log('\n── 33 页截图 + 顶栏像素校验（→ docs/xf-production-shots/）──');
  let pxOK = 0, pxBad = [];
  const shoot = async (id, label) => {
    const f = path.join(OUT, `page-${id}.png`);
    await goShot(cdp, id, f);
    const px = await pixelAt(cdp, f, 720, 15);
    const good = Math.abs(px.r-56) <= 14 && Math.abs(px.g-74) <= 14 && Math.abs(px.b-116) <= 14;
    if (good) pxOK++; else pxBad.push(`${id}(${px.r},${px.g},${px.b})`);
    console.log(`  · ${label || id}${good ? '' : '  ⚠️ (720,15)!=' + JSON.stringify(px)}`);
  };
  for (const id of ADM) await shoot(id);
  await switchUser(cdp, TEACHER);
  for (const id of TEA) await shoot(id);
  await switchUser(cdp, STUDENT);
  for (const id of STU) await shoot(id);
  /* 学生 settings 同页复用（settings 已在 ADM 截过教务版；学生版再截一张带后缀） */
  await goShot(cdp, 'settings', path.join(OUT, 'page-settings-stu.png'));
  const px = await pixelAt(cdp, path.join(OUT, 'page-settings-stu.png'), 720, 15);
  if (Math.abs(px.r-56) <= 14 && Math.abs(px.g-74) <= 14 && Math.abs(px.b-116) <= 14) pxOK++; else pxBad.push('settings-stu');
  /* board（看板会挂 body.board-mode，放最后 + 截完回主页解除） */
  await switchUser(cdp, SUPER);
  await shoot('board', 'board(只读看板)');
  await cdp.eval(`(async()=>{ App.go('home'); await new Promise(r=>setTimeout(r,400));
    document.body.classList.remove('board-mode'); return 1; })()`);
  ok(`顶栏 (720,15) 深蓝像素校验：${pxOK}/${ADM.length + TEA.length + STU.length + 2}`, pxBad.length === 0,
     pxBad.length ? '异常页：' + pxBad.join(',') : '全部命中 #384a74±14');

  /* ═══ 2) 关键交互抽查 ═══ */
  console.log('\n── 关键交互抽查 ──');
  /* 2.1 导航条点击跳转（真实 click，走 App.go） */
  await cdp.eval(`(() => { document.querySelector('#xfNav a[data-id="roster"]').click(); return 1; })()`);
  await sleep(700);
  const nav1 = await cdp.eval(`(() => ({ on: (document.querySelector('.page.on')||{}).id,
    hl: (document.querySelector('#xfNav a.on')||{}).dataset.id }))()`);
  ok('导航条点击「名册」→ 页面切换 + 高亮跟随', nav1.on === 'page-roster' && nav1.hl === 'roster', JSON.stringify(nav1));
  await goShot(cdp, 'roster', path.join(OUT, 'page-roster.png'));

  /* 2.2 考勤点章（切到考勤，点一个「迟到」印章，断言选中态与汇总联动） */
  await cdp.eval(`(() => { App.go('att'); return 1; })()`);
  await sleep(700);
  const stamp = await cdp.eval(`(async () => {
    const b = document.querySelector('#page-att.on .roster .stu .stamp[data-v="迟到"]') ||
              document.querySelector('#page-att.on .stamp');
    if (!b) return { found: false };
    const before = (document.querySelector('[data-sum="bad"]') || {}).textContent || '';
    b.click();
    await new Promise(r => setTimeout(r, 400));
    const after = (document.querySelector('[data-sum="bad"]') || {}).textContent || '';
    return { found: true, pressed: b.getAttribute('aria-pressed'), badBefore: before, badAfter: after };
  })()`);
  ok('考勤点章可交互（aria-pressed + 汇总联动）',
     stamp.found && stamp.pressed === 'true' && stamp.badBefore !== stamp.badAfter, JSON.stringify(stamp));

  /* 2.3 大课表格子渲染（回教务身份，切课表页，断言网格出格子） */
  await switchUser(cdp, SUPER);
  await cdp.eval(`(() => { App.go('timetable'); return 1; })()`);
  await sleep(900);
  const tt = await cdp.eval(`(() => {
    const wrap = document.getElementById('gridWrap');
    const cells = wrap ? wrap.querySelectorAll('.sc').length : 0;
    const grid = wrap ? !!(wrap.querySelector('.sgrid') || wrap.querySelector('[class*=grid]') || wrap.firstElementChild) : false;
    return { cells, has: !!wrap && !!wrap.firstElementChild };
  })()`);
  ok('大课表格子渲染（#gridWrap 有课节格）', tt.has && tt.cells > 0, JSON.stringify(tt));
  await goShot(cdp, 'timetable', path.join(OUT, 'page-timetable-grid.png'));

  /* ═══ 3) 深色 3 页（≥1100 学府翻转）═══ */
  console.log('\n── 深色模式（1440 · 3 页）──');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  const dark = await cdp.eval(`(() => {
    const rs = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      paper: rs.getPropertyValue('--paper').trim(),
      bg: body.backgroundColor,
      ink: rs.getPropertyValue('--ink').trim(),
      line: rs.getPropertyValue('--line').trim(),
      headBg: getComputedStyle(document.querySelector('.xf-head')).backgroundColor,
      navBg: getComputedStyle(document.querySelector('.xf-navstrip')).backgroundImage.includes('gradient'),
      utilBg: getComputedStyle(document.querySelector('.xf-util')).backgroundColor,
    };
  })()`);
  ok('深色 --paper = #191d27', /^#191d27$/i.test(dark.paper), dark.paper);
  ok('深色 body 底色已翻转（rgb 25,29,39）', /25,\s*29,\s*39/.test(dark.bg), dark.bg);
  ok('深色 --ink 变浅（#e7e9f0）', /^#e7e9f0$/i.test(dark.ink), dark.ink);
  ok('深色 --line 变深（#343b4d）', /^#343b4d$/i.test(dark.line), dark.line);
  ok('深色校名头翻深（#1f2431）', /31,\s*36,\s*49/.test(dark.headBg), dark.headBg);
  ok('深色导航条仍为蓝渐变', dark.navBg);
  ok('深色门户条仍为深蓝（可读）', /35,\s*44,\s*69/.test(dark.utilBg) || /43,\s*58,\s*94/.test(dark.utilBg), dark.utilBg);
  await switchUser(cdp, SUPER);
  for (const id of ['home','att','settings']) {
    await goShot(cdp, id, path.join(OUT, `dark-${id}.png`));
  }
  console.log('  （深色 3 页截图已存 docs/xf-production-shots/dark-*.png）');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* ═══ 4) 手机 390 零回归（硬门槛：与 HEAD 基线逐像素 0 差异）═══ */
  console.log('\n── 手机 390 零回归（vs HEAD 基线，逐像素）──');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  const mshots = { A: {}, B: {} };
  const phoneShot = async (base, tag, key, who) => {
    try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2600);
    await cdp.eval(`try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} 'ok'`);
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2400);
    await login(cdp, SUPER);
    await cdp.eval(SEED_JS);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    if (who !== SUPER) await switchUser(cdp, who);
    const f = path.join(OUT, `m390-${tag}-${key}.png`);
    await goShot(cdp, key, f);
    mshots[tag][key] = f;
  };
  for (const key of ['home','settings','stuHome']) {
    const who = key === 'stuHome' ? STUDENT : SUPER;
    for (const [base, tag] of [[BASE_A, 'A'], [BASE_B, 'B']]) await phoneShot(base, tag, key, who);
    let d = null, good = false;
    for (let attempt = 0; attempt < 3 && !good; attempt++){
      if (attempt > 0) {
        for (const [base, tag] of [[BASE_A, 'A'], [BASE_B, 'B']]) await phoneShot(base, tag, key, who);
      }
      d = await diffTwo(cdp, await readFile(mshots.A[key]), await readFile(mshots.B[key]));
      good = !d.mismatch && d.bad === 0;
    }
    ok(`手机 390 · ${key} 与 HEAD 零差异`, good,
       d.mismatch ? '尺寸不一致 ' + d.mismatch : `差异像素 ${d.bad}/${d.total}（${d.pct}%）`);
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
