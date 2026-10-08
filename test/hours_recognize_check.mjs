/**
 * 课时统计 · 阶段一（识别）真浏览器验收
 *
 *   node test/hours_recognize_check.mjs [工程目录] [端口]
 *
 * 为什么非要真浏览器：识别链路里有两样 jsdom 没有的东西 ——
 *   · mammoth 解 docx（走 zip / DOMParser）
 *   · Tesseract.js 跑在 Web Worker + WASM 里
 * 以及「加载本地页面 → 执行页面内 JS → 取回结果」这套，只有真 Chrome + CDP 做得来。
 * 骨架照抄 test/ocr_browser_test.mjs（裸 WebSocket CDP，不用 puppeteer/playwright）。
 *
 * 覆盖：
 *   1) docx 通路：Python 手写最小 docx（3 天 × 3 节）→ Hours.readSource → 与真值逐格一致
 *   2) 图片通路：test/html2png.mjs 把合成课表 HTML 渲染成 PNG → Hours.readSource →
 *      走 OCR 通路、星期列数正确、≥80% 格子对得上、每条 record 的起止分钟数正确
 *   3) csv 通路：网格逐格一致；**列表式课表**（一行一节课）csv 与合成词块两路各跑一遍，7/7 天正确
 *   4) 合并单元格：colspan / rowspan 的 HTML 单元 + 真 docx（mammoth）——
 *      网格矩形、合并格文本填到每一列/行、逐天课程集合一致（不串列、不丢课）、warnings 有提示；
 *      另：真实 Word 登记表（存在才跑）断言每行 6 列、27 行
 *   5) xlsx 通路：Python 手写最小 OOXML → _readXlsx 自解 zip → 逐格一致
 *   5b) 真实形状（匿名合成夹具）：「日期+星期」表头 / 3 列行头（含合并续格）/ 格内多节拆分
 *       （[BY03]→班级、xx老师→老师、时段→slot、时间走 _tmin）/ 列表式 date+day+slot
 *   5c) 真实老版 .doc（**绝对路径读，绝不复制进仓库**；不在就 skip 且不计入通过）：
 *       8 个逐个跑，断言不抛异常、条数 = 待核数、有「尽力解析」提醒，并打印前 5 条实际记录
 *   5d) 真实 .docx（同上，绝对路径）：3 个各跑一遍并打印实际记录
 *   5e) 表格 <br>/<hr> 与 BY 码（「系统导出」件的形状）：换行不被吞、一格两节课拆得开、
 *       [BY05] / 行首 BY05 / @BY08 三种码各就各位、孤码行并回上一条、提示跟最终字段一致
 *   5f) 回归（独立复核揪出的三处缺陷）：**行头多时段 × 格内多节**必须逐段配对（P0：老代码只取第一个
 *       时段 → 整行都记到同一个时间）；「2 个时段 + 1 节 + 1 条附注」只出 1 条并覆盖整段、标待核；
 *       `_codeStrip` 的 `clsKnown`（.doc 里 [BYxx] 其实是教室）单测；非课表（纯文字）→ suspect 闸门
 *   5g) 回归（第二轮独立复核）：老版 .doc 表头里「只有日期、没写星期」的列 + 尾部空列 → 列数必须钉正
 *       （旧代码整张网格左移、班级列被教室码污染）；只有日期的列顺推星期（顺不出就留空 + 待核）；
 *       cls 是纯代码 → 安全网标待核；闸门两分支文案不再自相矛盾；`_cellBySlots` 退回提示如实；
 *       表头空隙列的内容进「未归位」（绝不静默丢）。全部直接调纯函数，不依赖真实学校文件。
 *   6) 归一化单元：norm.day 严格/宽松/不误判
 *   7) 路由与权限：super/admin 看得到「课时统计」且能进；teacher/student 看不到、也进不去
 *   8) 不回归：跑一遍仓库里已有的 test/ocr_browser_test.mjs（Ocr.recognize 没被改坏）
 *   9) 手机端：test/probe_mobile_layout.mjs 量 hours 在 390 / 360 / 320 下的 overX 与 <16px 控件
 *
 * 🔴 任何一项没过都会在最下面汇总并把 exit code 置 1。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.argv[2] || path.join(here, '..'));
const PORT = Number(process.argv[3] || 5388);
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = PORT + 1;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PY = '/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3';
const NODE = process.execPath;
const FIX = path.join(WORK, 'test', 'fixtures');

const SUPER = { user: '李老师', pass: 'liyun2026' };
const ADMIN = { user: '王敏', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };
const STUDENT = { user: '王梓涵', pass: 'liyun2026' };

/* ── 真值 ─────────────────────────────────────────────────────────── */
/* docx / csv 共用：3 天 × 3 节 */
const TBL_HEADER = ['时间', '周一', '周二', '周三'];
const TBL_ROWS = [
  ['08:00-09:40', '成人书法基础', '少儿口才', '播音发声'],
  ['10:00-11:40', '形体训练', '即兴评述', '新闻播报'],
  ['14:00-15:40', '模拟主持', '新闻播报', '成人书法基础'],
];
const TBL_MIN = [[480, 580], [600, 700], [840, 940]];   // _tmin: 08:00/09:40 · 10:00/11:40 · 14:00/15:40

/* 带合并单元格的 docx（test/fixtures/hours_tt_merged.docx，由 make_hours_fixtures.py 内置生成）：
   表头 时间|周一|周二|周三|周四；第 1 数据行『少儿口才』跨 2 列（周二+周三同一天课）、
   第 2 数据行『即兴评述』跨 2 行（周二连着两节是同一节课）。
   期望按**每天课程的多重集合**比对（比「集合」更严：连重复条数都要对得上 —— 串列/丢课/多课都能当场抓到）。 */
const MERGED_HEADER = ['时间', '周一', '周二', '周三', '周四'];
const MERGED_DAYS = MERGED_HEADER.slice(1);
const MERGED_EXPECT = {
  '周一': ['成人书法', '形体训练', '模拟主持'],
  '周二': ['少儿口才', '即兴评述', '即兴评述'],          // 跨列的『少儿口才』+ 跨行两节的『即兴评述』
  '周三': ['少儿口才', '新闻播报', '影视配音'],
  '周四': ['播音发声', '文学朗读', '少儿口才'],
};
const MERGED_COLSPAN_ROW = 1;    // 第 1 数据行（0=表头）
const MERGED_ROWSPAN_ROWS = [2, 3];

/* 列表式课表（一行一节课）：7 行 × 7 天，星期词必须被认出来、且不进 title */
const LIST_LINES = [
  '周一 08:00-09:40 成人书法 王老师 BY05 301',
  '周二 10:00-11:40 少儿口才 李老师 BY06 302',
  '周三 14:00-15:40 形体训练 张伟 BY05 303',
  '周四 08:00-09:40 播音发声 王老师 BY07 304',
  '周五 10:00-11:40 模拟主持 李老师 BY05 305',
  '周六 14:00-15:40 新闻播报 张伟 BY08 306',
  '周日 08:00-09:40 即兴评述 王老师 BY09 307',
];
const LIST_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAYWORD = /(周|星期|礼拜)[一二三四五六日天]/;

/* 真实 Word（存在才跑）：/Volumes/山野万里/… 那张「教师授课日志登记表」，首行有 colspan=5、末格 rowspan=2 */
const REAL_WORD = '/Volumes/山野万里/2019教师授课日志登记表（用专属信纸打印）.docx';

/* 🔴 用户报障的真实课表：**只按绝对路径读，绝不复制进仓库**
   （这个仓库是 EdgeOne 的部署源，放进 fixtures = 把学校真实课表公开出去）。
   不存在就明确 skip，**不计入通过**。 */
const REAL_DOCS = [
  '/Users/xielihui/Desktop/博艺/博艺暑期/26年暑期第2周学生课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/26年暑期第3周学生课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/26年暑期第3老师课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/26年暑期第一周学生课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/26年暑期课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/学生个人课表.doc',
  '/Users/xielihui/Desktop/博艺/博艺暑期/博艺2026暑期第一周学生课表（系统导出）.doc',
  '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴素材/砺蕴工作系统课表板块试用课表.doc',
];
const REAL_DOCXES = [
  '/Users/xielihui/Desktop/博艺/课件/课表.docx',
  '/Users/xielihui/Desktop/博艺/博艺暑期/学生课表模板2.docx',
  '/Users/xielihui/Desktop/博艺/课件/周末课表模板.docx',
];

/* 图片夹具（test/fixtures/hours_tt.html）：5 天 × 3 节 */
const IMG_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const IMG_ROWS = [
  { time: '08:00-09:40', min: [480, 580], cells: ['成人书法基础', '少儿口才', '播音发声', '形体训练', '模拟主持'] },
  { time: '10:00-11:40', min: [600, 700], cells: ['形体训练', '即兴评述', '新闻播报', '文学朗读', '影视配音'] },
  { time: '14:00-15:40', min: [840, 940], cells: ['模拟主持', '新闻播报', '成人书法基础', '少儿口才', '即兴评述'] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}

function staticServer(root, port) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gz': 'application/gzip' };
  return createServer(async (req, res) => {
    const rel = new URL(req.url, 'http://localhost').pathname.replace(/^\/+/, '') || 'index.html';
    const f = path.join(root, rel);
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404).end('404'); }
  }).listen(port);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method) {
    return new Promise(res => {
      const set = this.events.get(method) || new Set();
      const fn = p => { set.delete(fn); res(p); };
      set.add(fn); this.events.set(method, set);
    });
  }
  async eval(expr, timeout = 300000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

/* ── 判定记账 ── */
let failed = 0;
let okCount = 0;    // ok() 被调用的总次数（**本文件**的断言数；子脚本打印的 ✅ 不在这里计）
const skips = [];   // 明确「跳过」的项：只提示，**不计入通过**
const ok = (c, m) => { okCount++; console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normText = s => String(s || '').replace(/[\s，。、,.;；:：!！?？~～\-—_（）()【】\[\]{}\/\\|]/g, '');
/** 相似度：完全相等 1，互相包含按长度比，否则 LCS 比 */
function sim(a, b) {
  a = normText(a); b = normText(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  let best = 0;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    if (dp[i][j] > best) best = dp[i][j];
  }
  return (2 * best) / (m + n);
}

const PAGE_HELPERS = `
window.__mkFile = (b64, name, type) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type });
};
`;

let server, chrome, profile, cdp;
try {
  /* ── 0. 生成夹具 ── */
  console.log('\n【0/9】生成夹具 …');
  const truthPath = path.join(tmpdir(), 'hours_truth.json');
  await writeFile(truthPath, JSON.stringify({ header: TBL_HEADER, rows: TBL_ROWS }), 'utf8');
  const py = spawnSync(PY, [path.join(WORK, 'test', 'make_hours_fixtures.py'), FIX, truthPath], { encoding: 'utf8' });
  ok(py.status === 0, 'docx / csv / xlsx / 合并格 docx 夹具生成：' + (py.stdout || '').trim() + (py.status === 0 ? '' : ('｜stderr: ' + (py.stderr || '').trim())));

  const pngOut = spawnSync(NODE, [path.join(WORK, 'test', 'html2png.mjs'),
    path.join(FIX, 'hours_tt.html'), path.join(FIX, 'hours_tt.png'), '1100', '2'],
    { encoding: 'utf8', cwd: WORK });
  ok(pngOut.status === 0 && /已写出/.test(pngOut.stdout || ''),
     '图片夹具生成：' + ((pngOut.stdout || '').trim().split('\n').pop() || '') + (pngOut.status === 0 ? '' : ('｜' + (pngOut.stderr || '').trim())));

  const docxB64 = (await readFile(path.join(FIX, 'hours_tt.docx'))).toString('base64');
  const csvB64 = (await readFile(path.join(FIX, 'hours_tt.csv'))).toString('base64');
  const pngB64 = (await readFile(path.join(FIX, 'hours_tt.png'))).toString('base64');
  const xlsxB64 = (await readFile(path.join(FIX, 'hours_tt.xlsx'))).toString('base64');
  const mergedB64 = (await readFile(path.join(FIX, 'hours_tt_merged.docx'))).toString('base64');
  const realGeomB64 = (await readFile(path.join(FIX, 'hours_tt_realgeom.docx'))).toString('base64');
  console.log(`  · docx ${Math.round(docxB64.length * 3 / 4 / 1024)}KB · csv ${Math.round(csvB64.length * 3 / 4 / 1024)}KB · png ${Math.round(pngB64.length * 3 / 4 / 1024)}KB · xlsx ${Math.round(xlsxB64.length * 3 / 4 / 1024)}KB · 合并格 docx ${Math.round(mergedB64.length * 3 / 4 / 1024)}KB · 真实几何 docx ${Math.round(realGeomB64.length * 3 / 4 / 1024)}KB`);

  /* ── 起服务 + 浏览器 ── */
  console.log('\n【起】静态服务 + 真 Chrome（无头）…');
  if (await readFile(path.join(WORK, 'test', 'dev-server.mjs')).then(() => true).catch(() => false)) {
    server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  } else {
    server = staticServer(WORK, PORT);
  }
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务' });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'hours-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  await sleep(2600);

  /* 登录：第一个账号就是首位教务 */
  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { role: Auth.role(), name: Auth.name() };
  })()`);
  ok(login.role === 'super', `已登录：${login.name}（role=${login.role}）`);

  /* 建几个角色账号 + 一点名册，供权限与字段匹配用 */
  await cdp.eval(`(async () => {
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    Store.upsert('rooms', { name: 'BY05' });
    Store.upsert('periods', { name: '第1节', start: '08:00', end: '09:40' });
    Store.upsert('periods', { name: '第2节', start: '10:00', end: '11:40' });
    Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:40' });
    const st = Store.upsert('students', { classId: c1.id, name: '王梓涵' });
    try { await Auth.call('users', { op:'create', user:${JSON.stringify(ADMIN.user)},   name:${JSON.stringify(ADMIN.user)},   role:'admin',   pass:${JSON.stringify(ADMIN.pass)},   classIds:[] }); } catch(e){}
    try { await Auth.call('users', { op:'create', user:${JSON.stringify(TEACHER.user)}, name:${JSON.stringify(TEACHER.user)}, role:'teacher', pass:${JSON.stringify(TEACHER.pass)}, classIds:[c1.id] }); } catch(e){}
    try { await Auth.call('users', { op:'create', user:${JSON.stringify(STUDENT.user)}, name:${JSON.stringify(STUDENT.user)}, role:'student', pass:${JSON.stringify(STUDENT.pass)}, studentId: st.id }); } catch(e){}
    await Staff.load();
    return { classes: Store.list('classes').map(x=>x.name), rooms: Store.list('rooms').map(x=>x.name), teachers: Staff.teachers().map(u=>u.name), today };
  })()`);

  /* ── 1. 路由 / 导航 / 模块存在性 ── */
  console.log('\n【1/9】路由、侧栏顺序、模块与 Ocr ──');
  const rt = await cdp.eval(`(() => {
    const ids = App.routes.map(r => r.id);
    const has = (a, id) => Array.isArray(a) && a.indexOf(id) >= 0;
    const r = App.routes.find(x => x.id === 'hours') || {};
    const n = App.NAV_ORDER, t = App.TAB_ORDER;
    return {
      routeExists: ids.indexOf('hours') >= 0,
      name: r.name, icon: r.icon, roles: r.roles || [],
      pageExists: !!document.getElementById('page-hours'),
      hoursOk: typeof Hours === 'object' && typeof Hours.readSource === 'function' && typeof Hours.render === 'function',
      recWords: typeof Ocr.recognizeWords === 'function',
      recIntact: typeof Ocr.recognize === 'function' && Ocr.recognize.toString().indexOf("T.recognize(file, 'chi_sim'") >= 0,
      nav: { super: has(n.super,'hours'), office: has(n.office,'hours'), admin: has(n.admin,'hours'), both: has(n.both,'hours'),
             teacher: has(n.teacher,'hours'), student: has(n.student,'hours') },
      tab: { super: has(t.super,'hours'), office: has(t.office,'hours'), admin: has(t.admin,'hours'), both: has(t.both,'hours'),
             teacher: has(t.teacher,'hours'), student: has(t.student,'hours') },
      after: { super: n.super.indexOf('hours') - n.super.indexOf('timetable') }
    };
  })()`);
  ok(rt.routeExists, "App.routes 里有 id='hours'");
  ok(rt.name === '课时统计' && rt.icon === 'clock', `名称/图标：${rt.name} / ${rt.icon}`);
  ok(eq(rt.roles, ['super','office','admin','both']), 'roles 恰为 super/office/admin/both：' + JSON.stringify(rt.roles));
  ok(rt.pageExists, 'HTML 里有 #page-hours');
  ok(rt.hoursOk, 'Hours 模块已定义（readSource / render 都在）');
  ok(rt.recWords, 'Ocr.recognizeWords 已定义');
  ok(rt.recIntact, "Ocr.recognize 仍是原来的写法（没被改坏）");
  ok(rt.nav.super && rt.nav.office && rt.nav.admin && rt.nav.both, "NAV_ORDER 四个教务串都有 'hours'");
  ok(!rt.nav.teacher && !rt.nav.student, "teacher / student 的 NAV_ORDER 里没有 'hours'");
  ok(!rt.tab.super && !rt.tab.office && !rt.tab.admin && !rt.tab.both && !rt.tab.teacher && !rt.tab.student,
     'TAB_ORDER 一个都没动（底栏不含 hours）');
  ok(rt.after.super === 1, "'hours' 紧跟在 'timetable' 后面");

  /* 1b. 上传框 accept 回归 —— 用户报的 bug：没写 .doc，macOS 选择器把 .doc 全部置灰，根本选不了 */
  const acc = await cdp.eval(`(() => {
    const el = document.getElementById('hrsFile');
    return { accept: el ? (el.getAttribute('accept') || '') : null,
             hint: (document.querySelector('#page-hours .hint') || {}).textContent || '' };
  })()`);
  ok(!!acc.accept && /\.doc\b/.test(acc.accept) && /\.docx\b/.test(acc.accept),
     '上传框 accept 含 .doc 与 .docx（用户报障的回归）：' + acc.accept);
  ok(!!acc.accept && /\.xls\b/.test(acc.accept) && /\.xlsx\b/.test(acc.accept) && /\.pdf\b/.test(acc.accept),
     '上传框 accept 含 .xls / .xlsx / .pdf：' + acc.accept);
  ok(/\.doc/.test(acc.hint) && /PDF|截图/.test(acc.hint),
     '上传卡片文案说明了 .doc 支持与 PDF 截图：' + acc.hint.slice(0, 90) + '…');

  /* ── 2. docx 通路 ── */
  console.log('\n【2/9】docx 通路（mammoth → 表格，精确）──');
  const docx = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(docxB64)}, 'hours_tt.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const m = await Hours.readSource(f, () => {});
    return {
      via: m.via, mode: m.mode, ms: m.ms, days: m.days,
      rows: m.rows.map(r => ({ label: r.label, time: r.time,
        cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text])) })),
      n: m.records.length
    };
  })()`);
  ok(docx.via === 'docx', `走的是 docx 通路（via=${docx.via}）`);
  ok(docx.mode === 'grid', `模式判定为网格（mode=${docx.mode}）`);
  ok(eq(docx.days, TBL_HEADER.slice(1)), `星期列 = ${JSON.stringify(docx.days)}`);
  ok(docx.rows.length === TBL_ROWS.length, `数据行 ${docx.rows.length} 行（真值 ${TBL_ROWS.length}）`);
  let cellBad = [];
  for (let i = 0; i < TBL_ROWS.length; i++) {
    const row = docx.rows[i] || { cells: {} };
    for (let j = 0; j < TBL_HEADER.length - 1; j++) {
      const got = (row.cells || {})[TBL_HEADER[j+1]];
      if (got !== TBL_ROWS[i][j+1]) cellBad.push(`[${i}][${TBL_HEADER[j+1]}] 期望「${TBL_ROWS[i][j+1]}」得到「${got}」`);
    }
  }
  ok(cellBad.length === 0, cellBad.length ? ('格子对不上：' + cellBad.join(' / ')) : '逐格与真值一致（9/9）');
  ok(docx.n === 9, `records 条数 = ${docx.n}（期望 9）`);

  /* ── 3. csv 通路 ── */
  console.log('\n【3/9】csv 通路 + 列表式课表 ──');
  const csv = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(csvB64)}, 'hours_tt.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, days: m.days,
      rows: m.rows.map(r => Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text]))),
      n: m.records.length };
  })()`);
  ok(csv.via === 'csv', `走的是 csv 通路（via=${csv.via}）`);
  ok(csv.mode === 'grid', `模式判定为网格（mode=${csv.mode}）`);
  ok(eq(csv.days, TBL_HEADER.slice(1)), `星期列 = ${JSON.stringify(csv.days)}`);
  let csvBad = [];
  for (let i = 0; i < TBL_ROWS.length; i++)
    for (let j = 0; j < TBL_HEADER.length - 1; j++)
      if (((csv.rows[i] || {})[TBL_HEADER[j+1]]) !== TBL_ROWS[i][j+1])
        csvBad.push(`[${i}][${TBL_HEADER[j+1]}] 期望「${TBL_ROWS[i][j+1]}」得到「${(csv.rows[i]||{})[TBL_HEADER[j+1]]}」`);
  ok(csvBad.length === 0, csvBad.length ? ('格子对不上：' + csvBad.join(' / ')) : '逐格与真值一致（9/9）');
  ok(csv.n === 9, `records 条数 = ${csv.n}（期望 9）`);

  /* ── 3b. 列表式课表（一行一节课）：星期必须被认出来、且不进 title ── */
  const listText = LIST_LINES.join('\n');
  const listB64 = Buffer.from(listText, 'utf8').toString('base64');
  const listCsv = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(listB64)}, 'hours_list.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, days: m.days,
      recs: m.records.map(r => ({ day: r.day, title: r.title, label: r.label })) };
  })()`);
  ok(listCsv.via === 'csv' && listCsv.mode === 'list',
     `列表式课表走 csv 通路 + 列表模式（via=${listCsv.via} mode=${listCsv.mode}）`);
  {
    const badDay = listCsv.recs.map((r, i) => r.day === LIST_DAYS[i] ? null : `第${i + 1}行 期望${LIST_DAYS[i]} 得到「${r.day}」`).filter(Boolean);
    ok(listCsv.recs.length === 7 && badDay.length === 0,
       `列表式课表 csv：${listCsv.recs.length}/7 行的 day 正确` + (badDay.length ? '｜' + badDay.join(' / ') : '') +
       '｜实际=' + JSON.stringify(listCsv.recs.map(r => r.day)));
    const dayInTitle = listCsv.recs.filter(r => DAYWORD.test(r.title)).map(r => `${r.day}→「${r.title}」`);
    ok(dayInTitle.length === 0, dayInTitle.length ? ('title 里还残留星期词：' + dayInTitle.join(' / ')) : '列表式课表 csv：title 里没有星期词');
  }

  /* 合成词块（OCR 列表）同一份数据再走一遍 */
  const words = [];
  LIST_LINES.forEach((line, i) => {
    let x = 40;
    for (const p of line.split(' ')) {
      const w = p.length * 16;
      words.push({ text: p, bbox: { x0: x, y0: 40 + i * 40, x1: x + w, y1: 40 + i * 40 + 26 }, confidence: 95 });
      x += w + 8;
    }
  });
  const listWords = await cdp.eval(`(() => {
    const m = Hours._wordsToModel(${JSON.stringify(words)}, 1000, 400);
    return { mode: m.mode, days: m.days, recs: m.records.map(r => ({ day: r.day, title: r.title })) };
  })()`);
  ok(listWords.mode === 'list', `合成词块判定为列表模式（mode=${listWords.mode}）`);
  {
    const badDay = listWords.recs.map((r, i) => r.day === LIST_DAYS[i] ? null : `第${i + 1}行 期望${LIST_DAYS[i]} 得到「${r.day}」`).filter(Boolean);
    ok(listWords.recs.length === 7 && badDay.length === 0,
       `合成词块：${listWords.recs.length}/7 行的 day 正确` + (badDay.length ? '｜' + badDay.join(' / ') : '') +
       '｜实际=' + JSON.stringify(listWords.recs.map(r => r.day)));
    const badTitle = listWords.recs.filter(r => DAYWORD.test(r.title)).map(r => r.title);
    ok(badTitle.length === 0, badTitle.length ? ('title 里还残留星期词：' + badTitle.join(' / ')) : '合成词块：title 里没有星期词');
  }

  /* ── 4/9. 合并单元格（colspan / rowspan）── */
  console.log('\n【4/9】合并单元格（colspan / rowspan 不串列、不丢课）──');
  /* 4a. 直接给 _htmlTableToGrid 一段带 colspan/rowspan 的 HTML：确定性覆盖网格算法本身 */
  const htmlGrid = await cdp.eval(`(() => {
    const html = '<table>'
      + '<tr><td>时间</td><td>周一</td><td>周二</td><td>周三</td><td>周四</td></tr>'
      + '<tr><td>08:00-09:40</td><td>成人书法</td><td colspan="2">少儿口才</td><td>播音发声</td></tr>'
      + '<tr><td>10:00-11:40</td><td>形体训练</td><td rowspan="2">即兴评述</td><td>新闻播报</td><td>文学朗读</td></tr>'
      + '<tr><td>14:00-15:40</td><td>模拟主持</td><td>影视配音</td><td>少儿口才</td></tr>'
      + '</table>';
    const g = Hours._htmlTableToGrid(html);
    return { rows: g.length, widths: g.map(r => r.length),
      texts: g.map(r => r.map(c => c && c.text)), merged: g.map(r => r.map(c => !!(c && c.merged))) };
  })()`);
  ok(htmlGrid.widths.every(w => w === 5) && htmlGrid.rows === 4,
     `HTML 合并格：矩形网格，每行 ${JSON.stringify(htmlGrid.widths)} 列、${htmlGrid.rows} 行`);
  ok(htmlGrid.texts[1][2] === '少儿口才' && htmlGrid.texts[1][3] === '少儿口才' && htmlGrid.merged[1][3] === true,
     `HTML colspan：『少儿口才』填到被合并的每一列（周二/周三）：${JSON.stringify(htmlGrid.texts[1])}`);
  ok(htmlGrid.texts[2][2] === '即兴评述' && htmlGrid.texts[3][2] === '即兴评述' && htmlGrid.merged[3][2] === true,
     `HTML rowspan：『即兴评述』填到被合并的每一行（第 2/3 数据行）`);
  ok(htmlGrid.texts[3][3] === '影视配音' && htmlGrid.texts[3][4] === '少儿口才',
     `HTML 合并格之后**没有串列**：${JSON.stringify(htmlGrid.texts[3])}`);

  /* 4b. 真 docx 走 mammoth → _htmlTableToGrid → _gridToModel，逐天比对课程集合 */
  const merged = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(mergedB64)}, 'hours_tt_merged.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, days: m.days, warnings: m.warnings,
      rows: m.rows.map(r => r.cells),
      recs: m.records.map(r => ({ day: r.day, title: r.title, merged: !!r.merged, needCheck: !!r.needCheck })) };
  })()`);
  ok(merged.via === 'docx' && merged.mode === 'grid', `合并格 docx 走 docx 网格通路（via=${merged.via} mode=${merged.mode}）`);
  ok(eq(merged.days, MERGED_DAYS), `合并格 docx 星期列 = ${JSON.stringify(merged.days)}`);
  {
    let bad = [];
    for (const day of MERGED_DAYS) {
      const got = merged.recs.filter(r => r.day === day).map(r => r.title).sort();
      const want = MERGED_EXPECT[day].slice().sort();
      if (!eq(got, want)) bad.push(`${day} 期望 ${JSON.stringify(want)} 得到 ${JSON.stringify(got)}`);
    }
    ok(bad.length === 0, bad.length ? ('逐天比对不一致：' + bad.join(' / ')) : '合并格 docx：逐天课程与真值一致（4/4 天，含条数；无串列、无丢失、无多课）');
  }
  ok(merged.recs.some(r => r.merged && r.needCheck),
     `合并格复制出来的记录标了 merged 且计入待确认（merged 记录 ${merged.recs.filter(r => r.merged).length} 条）`);
  ok((merged.warnings || []).some(w => /合并单元格/.test(w)),
     `warnings 里有合并提示：${JSON.stringify(merged.warnings)}`);

  /* 4b2. 对抗用例：第三轮独立复核揪出的 3 个重写回归 */
  const adv = await cdp.eval(`(() => {
    const perDay = recs => { const d = {}; recs.forEach(r => { (d[r.day] = d[r.day] || []).push(r.title); }); return d; };

    /* A8：最后一行的 <td rowspan="5"> 跨过表尾 —— 不许凭空造行、不许把一节课复制成 N 条 */
    const g8 = Hours._htmlTableToGrid('<table><tr><td>时间</td><td>周一</td><td>周二</td></tr>'
      + '<tr><td>08:00</td><td rowspan="5">A课</td><td>B课</td></tr></table>');
    const m8 = Hours._gridToModel(g8, 'docx');

    /* A11：3 个 <tr>，最后一行 <td rowspan="2"> —— 同样不许造行 */
    const g11 = Hours._htmlTableToGrid('<table><tr><td>时间</td><td>周一</td><td>周二</td></tr>'
      + '<tr><td>08:00</td><td>A</td><td>B</td></tr>'
      + '<tr><td>10:00</td><td rowspan="2">C</td><td>D</td></tr></table>');
    const m11 = Hours._gridToModel(g11, 'docx');

    /* A12：表头 <td colspan="2">周一</td> —— 重复星期列不许静默丢格 */
    const g12 = Hours._htmlTableToGrid('<table><tr><td>时间</td><td colspan="2">周一</td><td>周二</td></tr>'
      + '<tr><td>08:00</td><td>A</td><td>B</td><td>C</td></tr></table>');
    const m12 = Hours._gridToModel(g12, 'docx');

    return {
      a8:  { gridRows: g8.length,  dataRows: m8.rows.length,  perDay: perDay(m8.records),  warnings: m8.warnings  },
      a11: { gridRows: g11.length, dataRows: m11.rows.length, perDay: perDay(m11.records), warnings: m11.warnings },
      a12: { gridRows: g12.length, dataRows: m12.rows.length, perDay: perDay(m12.records), unassigned: m12.unassigned, warnings: m12.warnings }
    };
  })()`);
  ok(adv.a8.gridRows === 2 && eq(adv.a8.perDay['周一'], ['A课']) && eq(adv.a8.perDay['周二'], ['B课']),
     `A8 rowspan 越界不造幽灵行：网格 ${adv.a8.gridRows} 行（期望 2）、数据行 ${adv.a8.dataRows}，逐天 ${JSON.stringify(adv.a8.perDay)}（期望 周一[A课] 周二[B课]）`);
  ok((adv.a8.warnings || []).some(w => /跨过了表格末尾/.test(w)),
     `A8 越界已截断并有提醒：${JSON.stringify(adv.a8.warnings)}`);
  ok(adv.a11.gridRows === 3 && eq(adv.a11.perDay['周一'], ['A','C']) && eq(adv.a11.perDay['周二'], ['B','D']),
     `A11 rowspan 越界不造幽灵行：网格 ${adv.a11.gridRows} 行（期望 3）、数据行 ${adv.a11.dataRows}，逐天 ${JSON.stringify(adv.a11.perDay)}（期望 周一[A,C] 周二[B,D]）`);
  ok(adv.a12.gridRows === 2 && eq(adv.a12.perDay['周一'], ['A']) && eq(adv.a12.perDay['周二'], ['C']) &&
     (adv.a12.unassigned || []).indexOf('B') >= 0,
     `A12 表头重复列：网格 ${adv.a12.gridRows} 行，只按第一列取课 ${JSON.stringify(adv.a12.perDay)}（期望 周一[A] 周二[C]），多余列内容进未归位 = ${JSON.stringify(adv.a12.unassigned)}`);
  ok((adv.a12.warnings || []).some(w => /出现了 2 次/.test(w)),
     `A12 重复列有提醒：${JSON.stringify(adv.a12.warnings)}`);

  /* 4c. 「真实模板几何」常驻夹具：27 行 × 6 列，首行首格 colspan=5、首行末格 rowspan=2。
         复刻自 /Volumes/山野万里/2019教师授课日志登记表（用专属信纸打印）.docx 的真实几何 ——
         这条断言**永远会跑**，不再依赖外接卷在不在。 */
  const realGeom = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    if (!window.mammoth) await loadFirstScript([CDN.mammoth], () => window.mammoth, '文档解析引擎');
    const f = window.__mkFile(${JSON.stringify(realGeomB64)}, 'hours_tt_realgeom.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const r = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    const g = Hours._htmlTableToGrid(r.value);
    return { rows: g.length, widths: g.map(x => x.length) };
  })()`);
  ok(realGeom.rows === 27 && realGeom.widths.every(w => w === 6),
     `真实模板几何夹具：行数 = ${realGeom.rows}（期望 27）、每行列数 = ${JSON.stringify([...new Set(realGeom.widths)])}（期望 [6]）`);

  /* 4d. 真实 Word（外接卷在时才额外跑；卷不在 = 明确「跳过」，**不计入通过**） */
  if (existsSync(REAL_WORD)) {
    const realB64 = readFileSync(REAL_WORD).toString('base64');
    const real = await cdp.eval(`(async () => {
      ${PAGE_HELPERS}
      if (!window.mammoth) await loadFirstScript([CDN.mammoth], () => window.mammoth, '文档解析引擎');
      const f = window.__mkFile(${JSON.stringify(realB64)}, 'real.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const r = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
      const g = Hours._htmlTableToGrid(r.value);
      return { rows: g.length, widths: g.map(x => x.length) };
    })()`);
    ok(real.widths.length === 27 && real.widths.every(w => w === 6),
       `真实 Word 课表：行数 = ${real.rows}（期望 27）、每行列数 = ${JSON.stringify([...new Set(real.widths)])}（期望 [6]）`);
  } else {
    skips.push(`真实 Word 不在（${REAL_WORD}）—— 已由 4c 的常驻几何夹具覆盖 27×6`);
    console.log(`  ⏭️  跳过：真实 Word 不在（${REAL_WORD}）—— 已由 4c 的常驻几何夹具覆盖 27×6`);
  }

  /* ── 5/9. xlsx 通路 ── */
  console.log('\n【5/9】xlsx 通路 ──');
  const xlsx = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(xlsxB64)}, 'hours_tt.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, days: m.days,
      rows: m.rows.map(r => Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text]))),
      n: m.records.length };
  })()`);
  ok(xlsx.via === 'xlsx', `走的是 xlsx 通路（via=${xlsx.via}）`);
  ok(xlsx.mode === 'grid', `模式判定为网格（mode=${xlsx.mode}）`);
  ok(eq(xlsx.days, TBL_HEADER.slice(1)), `星期列 = ${JSON.stringify(xlsx.days)}`);
  let xlsxBad = [];
  for (let i = 0; i < TBL_ROWS.length; i++)
    for (let j = 0; j < TBL_HEADER.length - 1; j++)
      if (((xlsx.rows[i] || {})[TBL_HEADER[j+1]]) !== TBL_ROWS[i][j+1])
        xlsxBad.push(`[${i}][${TBL_HEADER[j+1]}] 期望「${TBL_ROWS[i][j+1]}」得到「${(xlsx.rows[i]||{})[TBL_HEADER[j+1]]}」`);
  ok(xlsxBad.length === 0, xlsxBad.length ? ('格子对不上：' + xlsxBad.join(' / ')) : '逐格与真值一致（9/9）');
  ok(xlsx.n === 9, `records 条数 = ${xlsx.n}（期望 9）`);

  /* ── 5b/9. 真实课表的四种形状（匿名合成夹具，永远能跑）── */
  console.log('\n【5b/9】真实形状：日期+星期表头 / 多列行头 / 格内多节 / 列表式 ──');
  const b64Of = n => readFileSync(path.join(FIX, n)).toString('base64');
  const ddB64 = b64Of('hours_tt_dateday.csv');
  const h3B64 = b64Of('hours_tt_head3.csv');
  const l3B64 = b64Of('hours_tt_list3.csv');
  const l2B64 = b64Of('hours_tt_list2.csv');

  /* ① 表头「日期 + 星期」混写 + 行头 2 列 + 格内多节 */
  const dateday = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(ddB64)}, 'hours_tt_dateday.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via:m.via, mode:m.mode, days:m.days,
      recs:m.records.map(r=>({day:r.day,date:r.date,slot:r.slot,cls:r.cls,teacher:r.teacher,title:r.title,start:r.start,end:r.end,startMin:r.startMin,endMin:r.endMin})) };
  })()`);
  ok(dateday.via === 'csv' && dateday.mode === 'grid',
     `日期+星期表头被判成网格（via=${dateday.via} mode=${dateday.mode}）`);
  ok(eq(dateday.days, ['周一','周二','周三']),
     `日期+星期表头：星期列 = ${JSON.stringify(dateday.days)}（期望 周一/周二/周三）`);
  {
    /* 周一那一格 = 「02:50-03:10普通话发音[BY03]03:10-03:50余老师·声调调值1[BY03]」
       → 必须拆成 2 条，时间 890/910/950 全走 _tmin（02:50 → 14:50） */
    const sec = dateday.recs.filter(r => r.startMin === 890 || r.startMin === 910);
    ok(sec.length === 2 && sec.every(r => r.day === '周一' && r.date === '7月27日'),
       `格内多节：周一那一格拆成 2 条（02:50→890 走 _tmin 的下午 +12h）：${JSON.stringify(sec.map(r => r.start + '-' + r.end + ' ' + r.title))}`);
    ok(sec.length === 2 && sec.every(r => r.cls === 'BY03'),
       `内容里的 [BY03] → cls：${JSON.stringify([...new Set(sec.map(r => r.cls))])}`);
    ok(sec.some(r => r.teacher === '余老师'),
       `老师名 → teacher：${JSON.stringify(sec.map(r => r.teacher))}`);
    ok(sec.length === 2 && sec.every(r => r.slot === '下午'),
       `行头「下午」→ slot（不进 title）：${JSON.stringify([...new Set(sec.map(r => r.slot))])}`);
    const dirty = sec.filter(r => /余老师|BY03|下午/.test(r.title));
    ok(dirty.length === 0, `title 里没残留 老师名 / [BYxx] / 时段：${JSON.stringify(sec.map(r => r.title))}`);
  }

  /* ② 行头 3 列（BY08｜上午｜08:40-09:10）+ 合并续格（第 2 行「BY08」留空要沿用） */
  const head3 = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(h3B64)}, 'hours_tt_head3.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via:m.via, mode:m.mode, days:m.days,
      recs:m.records.map(r=>({day:r.day,date:r.date,slot:r.slot,cls:r.cls,label:r.label,title:r.title})) };
  })()`);
  ok(head3.mode === 'grid' && eq(head3.days, ['周一','周六','周日']),
     `3 列行头：仍判成网格、星期列 = ${JSON.stringify(head3.days)}（按 DAYS 排序 → 周一/周六/周日）`);
  {
    const r1 = head3.recs.filter(r => r.label === '08:40-09:10');
    ok(r1.length === 3 && r1.every(x => x.cls === 'BY08' && x.slot === '上午'),
       `行头三列各就各位（BY08→cls、上午→slot、08:40-09:10→时间），没被当成课程内容：${JSON.stringify(r1)}`);
    const r2 = head3.recs.filter(r => r.label === '03:00-03:40');
    ok(r2.length === 3 && r2.every(x => x.cls === 'BY08' && x.slot === '下午'),
       `行头「合并续格」（第 2 行 BY08 留空）沿用上一行，且「下午」覆盖继承来的「上午」：${JSON.stringify(r2)}`);
    const bad = head3.recs.filter(r => /BY08|上午|下午|08:40|03:00/.test(r.title));
    ok(bad.length === 0, `title 里没有残留行头：${JSON.stringify(head3.recs.map(r => r.title))}`);
  }

  /* ③ 3 列列表式：8月17日周一｜上午｜09:30-09:40… （首列合并跨上午/下午） */
  const list3 = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(l3B64)}, 'hours_tt_list3.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via:m.via, mode:m.mode, days:m.days,
      recs:m.records.map(r=>({day:r.day,date:r.date,slot:r.slot,label:r.label,startMin:r.startMin,title:r.title})) };
  })()`);
  ok(list3.via === 'csv' && list3.mode === 'list',
     `3 列列表式：走列表模式（via=${list3.via} mode=${list3.mode}）`);
  {
    const mon = list3.recs.filter(r => r.day === '周一');
    ok(mon.length === 4 && mon.every(r => r.date === '8月17日') &&
       mon.filter(r => r.slot === '上午').length === 2 && mon.filter(r => r.slot === '下午').length === 2,
       `8月17日周一 → date+day；上午/下午 → slot；格内 2+2 节各自拆开：${JSON.stringify(mon.map(r => ({ d:r.day, dt:r.date, s:r.slot, l:r.label, t:r.title })))}`);
    ok(mon.some(r => r.startMin === 570) && mon.some(r => r.startMin === 930),
       `3 列列表式：时间走 _tmin（09:30=570、03:30→15:30=930）：${JSON.stringify(mon.map(r => r.label))}`);
  }

  /* ④ 2 列列表式：8月22日周六上午｜09:30-09:40… （日期+星期+时段挤在一格） */
  const list2 = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(l2B64)}, 'hours_tt_list2.csv', 'text/csv');
    const m = await Hours.readSource(f, () => {});
    return { via:m.via, mode:m.mode, days:m.days,
      recs:m.records.map(r=>({day:r.day,date:r.date,slot:r.slot,label:r.label,startMin:r.startMin,title:r.title})) };
  })()`);
  {
    const sat = list2.recs.filter(r => r.day === '周六');
    ok(sat.length === 4 && sat.every(r => r.date === '8月22日') &&
       sat.filter(r => r.slot === '上午').length === 2 && sat.filter(r => r.slot === '下午').length === 2,
       `2 列列表式：8月22日周六上午 → date+day+slot、格内 2 节拆开：${JSON.stringify(sat.map(r => ({ l:r.label, t:r.title, s:r.slot, dt:r.date })))}`);
    const am = sat.filter(r => r.slot === '上午');
    ok(am.some(r => r.startMin === 570) && am.some(r => r.startMin === 580),
       `2 列列表式：两条各自的时间对（09:30=570 / 09:40=580）：${JSON.stringify(am.map(r => r.label))}`);
  }

  /* ── 5c/9. 真实老版 .doc（绝对路径读；不在就 skip，不计入通过）── */
  console.log('\n【5c/9】真实老版 .doc（CFB / OLE2；读绝对路径，不复制进仓库）──');
  let docRan = 0;
  for (const p of REAL_DOCS) {
    if (!existsSync(p)) { skips.push(`真实 .doc 不在（${p}）`); console.log('  ⏭️  跳过：不存在 ' + p); continue; }
    docRan++;
    const b64 = readFileSync(p).toString('base64');
    const r = await cdp.eval(`(async () => {
      ${PAGE_HELPERS}
      try {
        const f = window.__mkFile(${JSON.stringify(b64)}, ${JSON.stringify(path.basename(p))}, 'application/msword');
        const m = await Hours.readSource(f, () => {});
        return { ok:true, via:m.via, mode:m.mode, days:m.days, n:m.records.length,
          need:m.records.filter(x => x.needCheck).length, ms:m.ms, warnings:m.warnings,
          top:m.records.slice(0,5).map(x => ({ day:x.day, date:x.date, slot:x.slot, label:x.label, cls:x.cls, teacher:x.teacher, title:x.title })) };
      } catch(e){ return { ok:false, err:String((e && e.message) || e) }; }
    })()`);
    console.log(`  · ${path.basename(p)}`);
    if (!r.ok) { ok(false, `  「${path.basename(p)}」识别时抛异常：${r.err}`); continue; }
    ok(true, `  不抛异常（via=${r.via} mode=${r.mode} 记录 ${r.n} 条 / 待核 ${r.need} 条 / ${(r.ms/1000).toFixed(1)}s）`);
    console.log(`      星期列=${JSON.stringify(r.days)}; 提醒=${JSON.stringify(r.warnings)}`);
    r.top.forEach((x, i) => console.log(`      [${i+1}] ` + JSON.stringify(x)));
    ok(r.need === r.n && r.n > 0, `  老版 .doc 通路：${r.need}/${r.n} 条全标「待核」`);
    ok((r.warnings || []).some(w => /老版 Word/.test(w)), '  老版 .doc 通路有「尽力解析、请逐格核对」提醒');
  }
  console.log(`  · 真实 .doc：跑了 ${docRan}/${REAL_DOCS.length} 个（其余不存在已跳过）`);

  /* ── 5d/9. 真实 .docx（绝对路径读；不在就 skip）── */
  console.log('\n【5d/9】真实 .docx（mammoth → <table>）──');
  let docxRan = 0;
  for (const p of REAL_DOCXES) {
    if (!existsSync(p)) { skips.push(`真实 .docx 不在（${p}）`); console.log('  ⏭️  跳过：不存在 ' + p); continue; }
    docxRan++;
    const b64 = readFileSync(p).toString('base64');
    const r = await cdp.eval(`(async () => {
      ${PAGE_HELPERS}
      try {
        if (!window.mammoth) await loadFirstScript([CDN.mammoth], () => window.mammoth, '文档解析引擎');
        const f = window.__mkFile(${JSON.stringify(b64)}, ${JSON.stringify(path.basename(p))},
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        const m = await Hours.readSource(f, () => {});
        return { ok:true, via:m.via, mode:m.mode, days:m.days, n:m.records.length, ms:m.ms, warnings:m.warnings,
          top:m.records.slice(0,5).map(x => ({ day:x.day, date:x.date, slot:x.slot, label:x.label, cls:x.cls, teacher:x.teacher, title:x.title })) };
      } catch(e){ return { ok:false, err:String((e && e.message) || e) }; }
    })()`);
    console.log(`  · ${path.basename(p)}`);
    if (!r.ok) { ok(false, `  「${path.basename(p)}」识别时抛异常：${r.err}`); continue; }
    ok(true, `  不抛异常（via=${r.via} mode=${r.mode} 记录 ${r.n} 条 / ${(r.ms/1000).toFixed(1)}s）`);
    console.log(`      星期列=${JSON.stringify(r.days)}; 提醒=${JSON.stringify(r.warnings)}`);
    r.top.forEach((x, i) => console.log(`      [${i+1}] ` + JSON.stringify(x)));
  }
  console.log(`  · 真实 .docx：跑了 ${docxRan}/${REAL_DOCXES.length} 个（其余不存在已跳过）`);

  /* ── 5e/9. 表格里的 <br>/<hr> 与 BY 码（真实「系统导出」件的形状）──
     那 8 个真实 .doc 里有一份其实**不是 Word，是系统导出的 HTML**
     （`博艺2026暑期第一周学生课表（系统导出）.doc`，实测文件头是 UTF-8 BOM + `<html>`）。
     它一格长这样：`BY05 科学发声<br>@BY08<hr>BY06 科学发声<br>@BY08`
     —— 一格是**两节课**（BY05 / BY06 各一节「科学发声」，教室 BY08）。
     旧代码用 textContent 取文，`<br>` / `<hr>` 全被吞掉 → 粘成
     `BY05 科学发声 @BY08BY06 科学发声 @BY08`，谁也拆不开（42 条全是这种粘连标题）。
     这里钉住四件事：① 换行别再被吞；② BY 码三种写法（[BY05] / 行首 BY05 / @BY08）；
     ③ 「只有码」的孤行并回上一条；④ 提示跟最终字段一致（班级填上了就别再说「班级没认出来」）。 */
  console.log('\n【5e/9】表格 <br>/<hr> 与 BY 码（系统导出件形状）──');
  const brhr = await cdp.eval(`(() => {
    const html = '<table><tr><th>节次/时间</th><th>07-10<br>周五</th><th>07-11<br>周六</th></tr>'
      + '<tr><td>第1节<br>08:50–09:10</td><td>BY05 科学发声<br>@BY08<hr>BY06 科学发声<br>@BY08</td>'
      + '<td>一模考试</td></tr></table>';
    const grid = Hours._htmlTableToGrid(html);
    const m = Hours._gridToModel(grid, 'doc');
    const cs = Hours._codeStrip('[BY03] 普通话发音 @BY08');
    const jl = Hours._joinCodeLines('BY05 科学发声\\n@BY08');
    const jl2 = Hours._joinCodeLines('BY05\\n艺考服装\\n拍摄 试穿');
    const mkOn  = Hours._mkRecord({ cls:'BY05', title:'科学发声', unmatched:['班级没认出来','老师没认出来'] }, '周五', null, 'x', 100, 'csv');
    const mkOff = Hours._mkRecord({ cls:'',     title:'科学发声', unmatched:['班级没认出来','老师没认出来'] }, '周五', null, 'x', 100, 'csv');
    return { cell: grid[1][1].text, head: grid[0].map(c => c.text),
             mode: m.mode, days: m.days,
             recs: m.records.map(r => ({ day:r.day, date:r.date, label:r.label, cls:r.cls, room:r.room, title:r.title })),
             cs: { s: cs.s.trim(), cls: cs.cls, room: cs.room },
             jl: jl, jl2: jl2, notesOn: mkOn.notes, notesOff: mkOff.notes };
  })()`);
  ok(brhr.cell.indexOf('\n') >= 0 && brhr.cell.indexOf('@BY08BY06') < 0,
    `<br>/<hr> 取成换行、不再把两节课粘成一行：${JSON.stringify(brhr.cell)}`);
  ok(JSON.stringify(brhr.head) === JSON.stringify(['节次/时间', '07-10\n周五', '07-11\n周六']),
    `表头日期也换行了，仍是「日期+星期」：${JSON.stringify(brhr.head)}`);
  ok(brhr.mode === 'grid' && JSON.stringify(brhr.days) === '["周五","周六"]' && brhr.recs.length === 3,
    `一格两节课 → 3 条记录（周五 2 + 周六 1）：mode=${brhr.mode} days=${JSON.stringify(brhr.days)} n=${brhr.recs.length}`);
  ok(brhr.recs[0].cls === 'BY05' && brhr.recs[1].cls === 'BY06'
     && brhr.recs[0].room === 'BY08' && brhr.recs[1].room === 'BY08'
     && brhr.recs[0].title === '科学发声' && brhr.recs[1].title === '科学发声',
    `行首 BY05/BY06 → 班级、@BY08 → 教室、title 干净：${JSON.stringify(brhr.recs.slice(0, 2))}`);
  ok(brhr.recs[2].title === '一模考试' && brhr.recs[2].cls === '',
    `单格一条照旧：${JSON.stringify(brhr.recs[2])}`);
  ok(brhr.recs[0].label === '08:50-09:10' && brhr.recs[0].date === '7月10日' && brhr.recs[0].day === '周五',
    `行头「第1节 / 08:50–09:10」以文件里明写的钟点为准（不拿第X节去套作息表）：${JSON.stringify({ label: brhr.recs[0].label, date: brhr.recs[0].date, day: brhr.recs[0].day })}`);
  ok(brhr.cs.s === '普通话发音' && brhr.cs.cls === 'BY03' && brhr.cs.room === 'BY08',
    `三种 BY 码写法都剥干净（[BY03]→班级、@BY08→教室、标题不留残渣）：${JSON.stringify(brhr.cs)}`);
  ok(brhr.jl.length === 1 && /@BY08/.test(brhr.jl[0]),
    `「只有码」的孤行并回上一行（不再变成没课名的空记录）：${JSON.stringify(brhr.jl)}`);
  ok(brhr.jl2.length === 2 && brhr.jl2[0] === 'BY05 艺考服装',
    `开头的孤码并到下一行（「BY05」顶头、下面是课名）：${JSON.stringify(brhr.jl2)}`);
  ok(brhr.notesOn.indexOf('班级没认出来') < 0 && brhr.notesOn.indexOf('老师没认出来') >= 0,
    `班级已填上就不再挂「班级没认出来」，缺老师的提示保留：${JSON.stringify(brhr.notesOn)}`);
  ok(brhr.notesOff.indexOf('班级没认出来') >= 0,
    `班级真的没认出来时，提示照旧保留：${JSON.stringify(brhr.notesOff)}`);

  /* ── 5f/9. 回归：行头多时段 × 格内多节 / 附注 / _codeStrip.clsKnown / 非课表闸门 ──
     对应独立复核揪出的三处缺陷，其中第一处是 P0（会让人**把课排到错误的时段**）：
     老代码遇到「行头写了 3 个时段」只取第一个 → 整行都记到同一个时间，
     10:10-10:50 / 11:00-11:40 这些真实时段**一条都不会出现**。 */
  console.log('\n【5f/9】回归：行头多时段配对 / 附注 / clsKnown / 非课表闸门 ──');

  /* ① 行头 3 个时段 × 格内 3 节（`课表.docx` 形状：行头 3 列、表头首格 colspan=3、4 个日列） */
  const slots3 = await cdp.eval(`(() => {
    const am = '<p>09:20-10:00</p><p>10:10-10:50</p><p>11:00-11:40</p>';
    const pm = '<p>03:00-03:40</p><p>03:50-04:30</p><p>04:40-05:20</p>';
    const three = t => '<p>' + t + '</p><p>' + t + '</p><p>' + t + '</p>';
    const html = '<table>'
      + '<tr><td colspan="3"></td><td>7月20日 周六</td><td>7月21日 周日</td><td>7月22日 周一</td><td>7月23日 周二</td></tr>'
      + '<tr><td>BY08</td><td>上午</td><td>' + am + '</td>'
      +     '<td>' + three('文稿朗诵') + '</td><td>' + three('即兴评述') + '</td>'
      +     '<td>' + three('新闻播音') + '</td><td>' + three('文稿朗诵') + '</td></tr>'
      + '<tr><td></td><td>下午</td><td>' + pm + '</td>'
      +     '<td>' + three('即兴评述') + '</td><td>' + three('文稿朗诵') + '</td>'
      +     '<td>' + three('新闻播音') + '</td><td>' + three('即兴评述') + '</td></tr>'
      + '</table>';
    const grid = Hours._htmlTableToGrid(html);
    const m = Hours._gridToModel(grid, 'docx');
    const per = {};
    m.records.forEach(r => { per[r.day] = per[r.day] || []; per[r.day].push(r.label); });
    return { n: m.records.length, days: m.days, per, all: m.records.map(r => r.label),
             mins: m.records.map(r => r.startMin),
             suspect: m.suspect === true, warnings: m.warnings };
  })()`);
  ok(slots3.n === 24, `行头 3 时段 × 格内 3 节：共 ${slots3.n} 条（4 天 × (上午 3 + 下午 3) = 24）`);
  {
    /* 标签保留文件里明写的钟点（03:00-03:40），**分钟数**才走 _tmin 的 +12h —— 与既有口径一致 */
    const want = ['09:20-10:00', '10:10-10:50', '11:00-11:40', '03:00-03:40', '03:50-04:30', '04:40-05:20'].sort();
    const bad = [];
    ['周六', '周日', '周一', '周二'].forEach(d => {
      const got = (slots3.per[d] || []).slice().sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(d + ' 得到 ' + JSON.stringify(got));
    });
    ok(bad.length === 0, bad.length ? ('逐天时间对不上：' + bad.join(' / '))
      : `每个日列都拆成 6 条、上午 3 个 + 下午 3 个时段各 1 次：${JSON.stringify(slots3.per['周六'])}`);
  }
  {
    const pm = slots3.mins.filter(m => [900, 950, 1000].indexOf(m) >= 0);
    ok(pm.length === 12, `下午三个时段的分钟数已走 _tmin 的 +12h（03:00→900 · 03:50→950 · 04:40→1000，共 12 条）：${JSON.stringify([...new Set(pm)].sort((a, b) => a - b))}`);
  }
  {
    const uniq = [...new Set(slots3.all)];
    const maxSame = Math.max(...uniq.map(l => slots3.all.filter(x => x === l).length));
    ok(slots3.all.indexOf('10:10-10:50') >= 0 && slots3.all.indexOf('11:00-11:40') >= 0 &&
       slots3.all.indexOf('03:50-04:30') >= 0 && slots3.all.indexOf('04:40-05:20') >= 0,
      `第 2 / 3 个时段都真的出现了（不再「整行全记成第一个时段」）：去重时间 = ${JSON.stringify(uniq)}`);
    ok(maxSame === 4, `没有任何时段被重复记成「整行」：出现最多的也只出现 ${maxSame} 次（= 每个日列 1 次）`);
    ok(!slots3.suspect, `正常课表不会被「非课表闸门」误伤（24 条全部带时间/星期）：suspect=${slots3.suspect}｜提醒=${JSON.stringify(slots3.warnings)}`);
  }

  /* ② 行头 2 个时段 × 格内 1 节 + 1 条附注（`副本课表.docx` 8月6/7日上午的形状；日列要 ≥2 才走网格通路） */
  const note1 = await cdp.eval(`(() => {
    const html = '<table>'
      + '<tr><td colspan="3"></td><td>8月6日 周二</td><td>8月7日 周三</td></tr>'
      + '<tr><td>BY05</td><td>上午</td><td><p>09:30-10:10</p><p>10:10-11:00</p></td>'
      +     '<td><p>科学发声——口腔控制</p><p>（重点训练咬字力度）</p></td>'
      +     '<td><p>播音创作基础——节奏</p></td></tr>'
      + '</table>';
    const grid = Hours._htmlTableToGrid(html);
    const m = Hours._gridToModel(grid, 'docx');
    return { n: m.records.length, recs: m.records.map(r => ({ day:r.day, start:r.start, end:r.end,
      startMin:r.startMin, endMin:r.endMin, title:r.title, needCheck:r.needCheck, notes:r.notes })) };
  })()`);
  {
    const tue = note1.recs.filter(r => r.day === '周二');
    const wed = note1.recs.filter(r => r.day === '周三');
    ok(tue.length === 1 && wed.length === 1 && note1.n === 2,
      `行头 2 时段 + 格内 1 节 + 1 附注：每个日列各 1 条（附注并入同一条，不另立一节课）：共 ${note1.n} 条`);
    ok(tue.length === 1 && tue[0].startMin === 570 && tue[0].endMin === 660,
      `8月6日上午那一条覆盖整段 09:30-11:00（570→660）：${JSON.stringify(tue.map(r => r.start + '-' + r.end))}`);
    ok(tue.length === 1 && tue[0].needCheck === true,
      `「1 条课占满 2 个时段」已标待核：needCheck=${tue.length === 1 ? tue[0].needCheck : '—'}｜notes=${JSON.stringify(tue.length === 1 ? tue[0].notes : [])}`);
    ok(tue.length === 1 && /科学发声/.test(tue[0].title || '') && /重点训练咬字力度/.test(tue[0].title || ''),
      `附注并进了 title：${JSON.stringify(tue.length === 1 ? tue[0].title : '')}`);
    ok(wed.length === 1 && wed[0].startMin === 570 && wed[0].endMin === 660 && wed[0].needCheck === true,
      `8月7日上午只有 1 节也照整段记 1 条 + 待核：${JSON.stringify(wed)}`);
  }

  /* ③ _codeStrip：班级已知时 [BYxx] 归**教室**（.doc 的语义）；未传 opts（默认 false）行为一字不变 */
  const cs2 = await cdp.eval(`(() => {
    const on  = Hours._codeStrip('08:50-09:10科学发声[BY05]', { clsKnown: true });
    const off = Hours._codeStrip('08:50-09:10科学发声[BY05]', { clsKnown: false });
    const dft = Hours._codeStrip('08:50-09:10科学发声[BY05]');
    const sys = Hours._codeStrip('BY05 科学发声 @BY08', { clsKnown: true });
    return { on:{cls:on.cls, room:on.room, s:on.s.trim()}, off:{cls:off.cls, room:off.room},
             dft:{cls:dft.cls, room:dft.room}, sys:{cls:sys.cls, room:sys.room} };
  })()`);
  ok(cs2.on.room === 'BY05' && cs2.on.cls === '', `clsKnown:true → [BY05] 归教室、title 干净：${JSON.stringify(cs2.on)}`);
  ok(cs2.off.cls === 'BY05' && cs2.off.room === '', `clsKnown:false → [BY05] 仍归班级：${JSON.stringify(cs2.off)}`);
  ok(cs2.dft.cls === 'BY05' && cs2.dft.room === '', `不传 opts（默认 false）行为不变 → 仍归班级：${JSON.stringify(cs2.dft)}`);
  ok(cs2.sys.cls === 'BY05' && cs2.sys.room === 'BY08',
    `clsKnown 不影响另两种既有写法：行首裸码仍归班级、@BY08 仍归教室：${JSON.stringify(cs2.sys)}`);

  /* ④ 非课表闸门：纯文字段落（无星期、无时间）→ suspect=true 且提醒里含「不像是课表」 */
  const notTt = await cdp.eval(`(() => {
    const lines = Array.from({ length: 25 }, (_, i) => '这是一段讲义正文的测试内容，用于验证非课表闸门，段落编号为' + (i + 1) + '。');
    const html = '<table>' + lines.map(s => '<tr><td>' + s + '</td></tr>').join('') + '</table>';
    const grid = Hours._htmlTableToGrid(html);
    const m = Hours._gridToModel(grid, 'docx');
    return { n: m.records.length, via: m.via, mode: m.mode,
             suspect: m.suspect === true, warnings: m.warnings, first: m.warnings[0] || '' };
  })()`);
  ok(notTt.n >= 20, `非课表夹具认出了 ${notTt.n} 条内容（≥20 才会走闸门判定）`);
  ok(notTt.suspect === true, `纯文字段落 → suspect=true（via=${notTt.via} mode=${notTt.mode}）`);
  ok(/不像是课表/.test(notTt.first),
    `非课表提醒已**置顶**在 warnings 第一位：${JSON.stringify(notTt.first).slice(0, 120)}…`);

  /* ── 5g/9. 回归（第二轮独立复核揪出的 1 处硬伤 + 2 处误导文案 + 1 个安全网缺口）──
     硬伤：老版 .doc 表头里「只有日期、没写星期」的列（`7月31日` / `8月1日`）被漏掉 →
     整张网格左移，班级列被教室码污染。**全部直接调纯函数**，不依赖真实学校文件
     （仓库即 EdgeOne 部署源，真实件绝不进 test/fixtures）。 */
  console.log('\n【5g/9】回归：.doc 只有日期的表头列 / 顺推星期 / cls 纯代码安全网 / 误导文案 ──');

  /* ① 表头 9 格（尾部还有一个空列）+「只有日期」的 2 列 → 列数必须是 9，班级来自行头、[BYxx] 归教室 */
  const docGrid = await cdp.eval(`(() => {
    const lesson = () => '08:50-09:10科学发声[BY05]\\n09:10-09:50余老师[BY06]\\n10:00-10:40朗诵艺术鉴赏[BY03]\\n10:50-11:30形体[BY05]';
    const cells = ['', '7月26日  周六', '7月27日  周日', '7月28日  周一', '7月29日  周二', '7月30日  周三', '7月31日', '8月1日', ''];
    ['暑6班\\n（半天班）', '暑8班\\n（全天班）', '暑9班\\n（全天班）'].forEach(name => {
      cells.push(name);
      for (let k = 0; k < 7; k++) cells.push(lesson());
      cells.push('');                       // 尾部那个空列（真实 .doc 每行也是 9 格，与表头对齐）
    });
    const built = Hours._docCellsToGrid(cells);
    const m = Hours._gridToModel(built.grid, 'doc');
    const clsCode = /^[A-Za-z]{1,4}\\d{1,3}$/;
    return { colCount: built.colCount, r0: built.r0, r1: built.r1, head: built.grid[0],
             n: m.records.length, days: m.days,
             clsSet: [...new Set(m.records.map(r => r.cls).filter(Boolean))].sort(),
             badCls: m.records.filter(r => clsCode.test(String(r.cls || ''))).length,
             roomNonEmpty: m.records.filter(r => r.room).length,
             guessedDays: [...new Set(m.records.filter(r => (r.notes || []).some(t => /顺推/.test(t))).map(r => r.day))].sort() };
  })()`);
  ok(docGrid.colCount === 9, `.doc 表头「只有日期」+ 尾部空列 → colCount=${docGrid.colCount}（期望 9；旧代码 6、只放宽 dayAt 只得 8、仍错位）`);
  ok(docGrid.head.length === 9 && docGrid.head[7] === '8月1日' && docGrid.head[8] === '',
    `表头 9 格、尾部空列被算进来：${JSON.stringify(docGrid.head)}`);
  ok(docGrid.badCls === 0 && docGrid.clsSet.indexOf('暑6班') >= 0 && docGrid.clsSet.indexOf('暑8班') >= 0,
    `没有任何记录的 cls 是纯代码（班级该来自行头班名）：badCls=${docGrid.badCls}｜cls 集合=${JSON.stringify(docGrid.clsSet)}`);
  ok(docGrid.roomNonEmpty > 0 && docGrid.roomNonEmpty === docGrid.n,
    `行头班级已知 → [BYxx] 全归教室：room 非空 ${docGrid.roomNonEmpty}/${docGrid.n}`);
  ok(docGrid.guessedDays.indexOf('周四') >= 0 && docGrid.guessedDays.indexOf('周五') >= 0 && docGrid.days.length === 7,
    `只有日期的两列顺推出周四/周五并标待核：guessed=${JSON.stringify(docGrid.guessedDays)}｜星期列=${JSON.stringify(docGrid.days)}`);

  /* ② 顺推不出来（前一列没日期）→ day 留空 + 待核，绝不错猜 */
  const noGuess = await cdp.eval(`(() => {
    const cells = ['', '周一', '周二', '7月31日', '暑6班', '08:50-09:10科学发声[BY05]', '08:50-09:10形体[BY05]', '08:50-09:10台词[BY05]'];
    const built = Hours._docCellsToGrid(cells);
    const m = Hours._gridToModel(built.grid, 'doc');
    const blank = m.records.filter(r => !r.day);
    return { colCount: built.colCount, n: m.records.length, blank: blank.length,
             notes: blank.map(r => r.notes || []), days: m.days };
  })()`);
  ok(noGuess.blank === 1 && noGuess.notes.every(ns => ns.some(t => /星期没认出来/.test(t))),
    `前一列没有日期 → 推不出星期：该列留空 + 标待核（不瞎猜）：${JSON.stringify(noGuess.notes)}`);
  ok(noGuess.colCount === 4 && noGuess.n === 3 && noGuess.days.indexOf('周一') >= 0 && noGuess.days.indexOf('周二') >= 0,
    `推不出的列不进星期列表、也不丢格：colCount=${noGuess.colCount} n=${noGuess.n} days=${JSON.stringify(noGuess.days)}`);

  /* ③ Fix G 安全网：cls 是纯代码（`BY05`）→ 标待核 + 注记；是班名 → 不触发 */
  const fixG = await cdp.eval(`(() => {
    const t = { start:'08:00', end:'09:40', startMin:480, endMin:580 };
    const a = Hours._mkRecord({ cls:'BY05', title:'某课', unmatched:[] }, '周一', t, 'BY05 某课', 100, 'csv');
    const b = Hours._mkRecord({ cls:'暑6班', title:'某课', unmatched:[] }, '周一', t, '暑6班 某课', 100, 'csv');
    const c = Hours._mkRecord({ cls:'TEACH01', title:'某课', unmatched:[] }, '周一', t, 'TEACH01 某课', 100, 'csv');
    return { a:{nc:a.needCheck, notes:a.notes}, b:{nc:b.needCheck, notes:b.notes}, c:{nc:c.needCheck, notes:c.notes} };
  })()`);
  ok(fixG.a.nc === true && fixG.a.notes.some(t => /班级这一列现在填的是代码「BY05」/.test(t)),
    `cls 是纯代码 → 标待核 + 注记「看起来像教室号」：${JSON.stringify(fixG.a.notes)}`);
  ok(fixG.b.nc === false && !fixG.b.notes.some(t => /班级这一列/.test(t)),
    `cls 是班名（暑6班）→ 不触发安全网：${JSON.stringify(fixG.b.notes)}`);
  ok(fixG.c.nc === false, `cls「TEACH01」字母超 4 位 → 不算纯代码、不触发（边界）：${JSON.stringify(fixG.c.notes)}`);

  /* ④ Fix F2 闸门文案：dayed===0 与「时间占比低」分开说，不再「20 条里只有 20 条带时间」 */
  const gate = await cdp.eval(`(() => {
    const mk = (dayed, timed, n) => Array.from({ length: n }, (_, i) => ({ day: dayed ? '周一' : '', startMin: i < timed ? 480 : NaN, label:'', title:'文字' + i }));
    const a = Hours._finish({ mode:'list', via:'csv', days:[], rows:[], records: mk(false, 0, 25), unassigned:[], warnings:[] });
    const b = Hours._finish({ mode:'list', via:'csv', days:[], rows:[], records: mk(true, 0, 25), unassigned:[], warnings:[] });
    const c = Hours._finish({ mode:'list', via:'csv', days:[], rows:[], records: mk(true, 25, 25), unassigned:[], warnings:[] });
    return { a:{suspect:a.suspect, msg:a.suspectMsg}, b:{suspect:b.suspect, msg:b.suspectMsg}, c:{suspect:c.suspect} };
  })()`);
  ok(gate.a.suspect === true && /但一条都没认出是星期几/.test(gate.a.msg) && !/条带时间/.test(gate.a.msg),
    `闸门 dayed===0 分支不再自相矛盾：${gate.a.msg}`);
  ok(gate.b.suspect === true && /其中只有 0 条带时间（HH:MM）/.test(gate.b.msg),
    `闸门「时间占比低」分支说清条数：${gate.b.msg}`);
  ok(gate.c.suspect !== true, `正常课表（25 条全带时间/星期）不误伤：suspect=${gate.c.suspect}`);

  /* ⑤ Fix F1 `_cellBySlots` 退回提示：如实描述 + 带日列，不谎称「已按第一个时段取」 */
  const f1 = await cdp.eval(`(() => {
    const html = '<table>'
      + '<tr><td colspan="3"></td><td>7月25日 周四</td><td>7月26日 周五</td></tr>'
      + '<tr><td>BY08</td><td>上午</td><td><p>09:00-09:40</p><p>09:50-10:30</p><p>10:40-11:20</p></td>'
      +     '<td><p>模考</p><p>09:00候场抽题</p></td><td><p>正常课</p></td></tr>'
      + '</table>';
    const m = Hours._gridToModel(Hours._htmlTableToGrid(html), 'docx');
    return { warn: (m.warnings || []).filter(w => /对不上/.test(w)) };
  })()`);
  ok(f1.warn.length >= 1 && f1.warn.every(w => w.indexOf('已按第一个时段取') < 0) &&
     f1.warn.some(w => /周四/.test(w) && /7月25日/.test(w)),
    `退回提示改成如实描述、且带上日列：${JSON.stringify(f1.warn)}`);

  /* ⑥ 表头空隙列（既非日列也非行头）→ 内容进「未归位」，绝不静默丢 */
  const gapCol = await cdp.eval(`(() => {
    const html = '<table>'
      + '<tr><th>时间</th><th>周一</th><th></th><th>周二</th></tr>'
      + '<tr><td>08:00-09:40</td><td>成人书法</td><td>这是空隙列的字</td><td>少儿口才</td></tr>'
      + '</table>';
    const m = Hours._gridToModel(Hours._htmlTableToGrid(html), 'docx');
    return { un: m.unassigned, days: m.days, n: m.records.length };
  })()`);
  ok(gapCol.un.some(u => /空隙列的字/.test(u)),
    `表头空隙列的内容进了「未归位」、不静默丢：unassigned=${JSON.stringify(gapCol.un)}`);

  /* ── 4. 图片通路（端到端 OCR）── */
  console.log('\n【6/9】图片通路（OCR + 坐标重建）…（这一步要跑真识别，耐心等）');
  const img = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(pngB64)}, 'hours_tt.png', 'image/png');
    const m = await Hours.readSource(f, () => {});
    return {
      via: m.via, mode: m.mode, ms: m.ms, days: m.days, W: m.width, H: m.height,
      unassigned: m.unassigned.length, warnings: m.warnings,
      rows: m.rows.map(r => ({ label: r.label, time: r.time,
        cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text])) })),
      records: m.records.map(r => ({ day: r.day, startMin: r.startMin, endMin: r.endMin,
        cls: r.cls, room: r.room, title: r.title, teacher: r.teacher, conf: r.conf }))
    };
  })()`);
  console.log(`  画布 ${img.W}×${img.H} · 用时 ${(img.ms / 1000).toFixed(1)}s · 模式 ${img.mode}`);
  console.log(`  星期列：${JSON.stringify(img.days)}`);
  console.log(`  识别到 ${img.records.length} 条；表外文字 ${img.unassigned} 处`);
  if (img.warnings && img.warnings.length) console.log('  提醒：' + img.warnings.join(' ｜ '));
  console.log('  各行：' + JSON.stringify(img.rows.map(r => ({ t: r.label, c: r.cells }))));

  ok(img.via === 'ocr', `走的是图片 OCR 通路（via=${img.via}）`);
  ok(img.mode === 'grid', `模式判定为网格（mode=${img.mode}）`);
  ok(img.days.length === 5, `星期列数 = ${img.days.length}（期望 5）`);

  /* 格子文本命中率：真值 15 格，记录里能找到 >=80% 高相似匹配 */
  const recs = img.records || [];
  let hit = 0;
  const missList = [];
  for (const row of IMG_ROWS) for (let j = 0; j < IMG_DAYS.length; j++) {
    const truth = row.cells[j];
    const day = IMG_DAYS[j];
    const best = recs.filter(r => r.day === day)
      .reduce((mx, r) => Math.max(mx, sim(r.title || r.raw || '', truth)), 0);
    if (best >= 0.75) hit++; else missList.push(`${day}「${truth}」(最高相似 ${best.toFixed(2)})`);
  }
  const rate = hit / 15;
  ok(rate >= 0.8, `格子命中 ${hit}/15 = ${(rate * 100).toFixed(0)}%（门槛 80%）${missList.length ? '｜未中：' + missList.join('、') : ''}`);

  /* 起止分钟数：每条记录都必须是三个真值之一 */
  const truthPairs = IMG_ROWS.map(r => r.min.join('-'));
  const badMin = recs.filter(r => truthPairs.indexOf([r.startMin, r.endMin].join('-')) < 0)
    .map(r => `${r.day} ${r.title}=${r.startMin}-${r.endMin}`);
  ok(recs.length > 0 && badMin.length === 0, badMin.length ? ('有记录的时序对不上：' + badMin.join(' / ')) : `全部 ${recs.length} 条记录的起止分钟数都在真值集合内（${truthPairs.join('、')}）`);

  /* 每行时间正确（记录数按行分布：理想 3×5；至少每行都认出来） */
  const perRow = IMG_ROWS.map(r => recs.filter(x => x.startMin === r.min[0] && x.endMin === r.min[1]).length);
  ok(perRow.every(c => c >= 4), `每行都认出 ≥4 格：${JSON.stringify(perRow)}`);

  /* ── 5. 路由与权限 ── */
  console.log('\n【7/9】路由与权限（super / admin / teacher / student）──');
  const probePerm = () => cdp.eval(`(() => {
    const navHas = [...document.querySelectorAll('#nav button')].some(b => b.dataset.id === 'hours');
    const drawerHas = [...document.querySelectorAll('#dgrid button')].some(b => b.dataset.id === 'hours');
    const tabHas = [...document.querySelectorAll('#tabs button')].some(b => b.dataset.id === 'hours');
    const can = App.can('hours');
    App.go('hours');
    const on = document.getElementById('page-hours').classList.contains('on');
    return { navHas, drawerHas, tabHas, can, on, cur: (document.querySelector('.page.on') || {}).id };
  })()`);
  const switchTo = (cred) => cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { role: Auth.role(), name: Auth.name() };
  })()`);

  const pSuper = await probePerm();
  ok(pSuper.navHas && pSuper.can && pSuper.on, `super：侧栏看得到 + 能进（on=${pSuper.on}）`);
  ok(!pSuper.tabHas, 'super：底栏没有「课时统计」');

  const aLogin = await switchTo(ADMIN);
  const pAdmin = await probePerm();
  ok(aLogin.role === 'admin', `已切换 admin：${aLogin.name}`);
  ok(pAdmin.navHas && pAdmin.can && pAdmin.on, `admin：侧栏看得到 + 能进（on=${pAdmin.on}）`);

  const tLogin = await switchTo(TEACHER);
  const pTeacher = await probePerm();
  ok(tLogin.role === 'teacher', `已切换 teacher：${tLogin.name}`);
  ok(!pTeacher.navHas && !pTeacher.can && !pTeacher.on && pTeacher.cur !== 'page-hours',
     `teacher：看不到也进不去（navHas=${pTeacher.navHas} can=${pTeacher.can} on=${pTeacher.on} cur=${pTeacher.cur}）`);

  const sLogin = await switchTo(STUDENT);
  const pStudent = await probePerm();
  ok(sLogin.role === 'student', `已切换 student：${sLogin.name}`);
  ok(!pStudent.navHas && !pStudent.can && !pStudent.on && pStudent.cur !== 'page-hours',
     `student：看不到也进不去（navHas=${pStudent.navHas} can=${pStudent.can} on=${pStudent.on} cur=${pStudent.cur}）`);

  /* 页面正常渲染不报错：切回 super 进 hours，检查 DOM 没炸 */
  await switchTo(SUPER);
  const paint = await cdp.eval(`(() => {
    App.go('hours');
    return { on: document.getElementById('page-hours').classList.contains('on'),
             hasUpload: !!document.getElementById('hrsFile'),
             body: (document.getElementById('hrsBody') || {}).innerHTML ? true : false,
             title: (document.querySelector('#page-hours .page-title') || {}).textContent };
  })()`);
  ok(paint.on && paint.hasUpload && paint.body && String(paint.title).indexOf('课时统计') >= 0,
     `super 进页正常渲染（标题「${paint.title}」，上传框在，识别区有内容）`);

  /* ── 8/9. 归一化单元：星期识别 ── */
  console.log('\n【8/9】归一化单元（norm.day）──');
  const dayUnit = await cdp.eval(`(() => ({
    strictWord: Hours.norm.day('周一'),
    strictStar: Hours.norm.day('星期一'),
    single:     Hours.norm.day('一'),
    inLine:     Hours.norm.day('周一 08:00-09:40 成人书法 王老师 BY05 301'),
    strictMode: Hours.norm.day('周一 08:00-09:40 成人书法 王老师 BY05 301', { strict: true }),
    weekend:    Hours.norm.day('周末'),
    plain:      Hours.norm.day('成人书法基础')
  }))()`);
  ok(dayUnit.strictWord === '周一' && dayUnit.strictStar === '周一' && dayUnit.single === '周一',
     `孤立星期词仍认得出：${JSON.stringify(dayUnit.strictWord)}/${JSON.stringify(dayUnit.strictStar)}/${JSON.stringify(dayUnit.single)}`);
  ok(dayUnit.inLine === '周一', `整行里也能挖出星期：norm.day('周一 08:00-09:40 …') = ${JSON.stringify(dayUnit.inLine)}`);
  ok(dayUnit.strictMode === '', `strict 模式对整行不触发（仍给表头用）：${JSON.stringify(dayUnit.strictMode)}`);
  ok(dayUnit.weekend === '' && dayUnit.plain === '',
     `『周末』『成人书法基础』不硬塞成某一天：${JSON.stringify(dayUnit.weekend)}/${JSON.stringify(dayUnit.plain)}`);

  /* 8b. 宽松模式改成「字段边界」判定后：名字里含「周X」的不许误判，紧贴/带前缀的仍要认得 */
  const dayBound = await cdp.eval(`(() => ({
    everyDay:    Hours.norm.day('每周一练'),
    qiang:       Hours.norm.day('周三强化班'),
    spaceTime:   Hours.norm.day('周一 08:00-09:40 成人书法 王老师 BY05 301'),
    tight:       Hours.norm.day('周一08:00'),
    everyFri:    Hours.norm.day('每周五 08:00'),
    range:       Hours.norm.day('周一至周三'),
    classSuffix: Hours.norm.day('周一班'),
    weekend:     Hours.norm.day('周末'),
    cycle:       Hours.norm.day('周期'),
    thirdWeek:   Hours.norm.day('第三周'),
    oneWeek:     Hours.norm.day('一周'),
    comma:       Hours.norm.day('周一,08:00'),
    fullBang:    Hours.norm.day('周一；08:00'),
    twoDays:     Hours.norm.day('周一周二'),
    morning:     Hours.norm.day('上午周一')
  }))()`);
  ok(dayBound.everyDay === '' && dayBound.qiang === '' && dayBound.classSuffix === '',
     `名含「周X」不误判：每周一练=${JSON.stringify(dayBound.everyDay)} 周三强化班=${JSON.stringify(dayBound.qiang)} 周一班=${JSON.stringify(dayBound.classSuffix)}`);
  ok(dayBound.spaceTime === '周一' && dayBound.tight === '周一' && dayBound.everyFri === '周五' && dayBound.range === '周一',
     `紧贴 / 带「每」/ 区间 仍认得：'周一 08:00…'=${JSON.stringify(dayBound.spaceTime)} '周一08:00'=${JSON.stringify(dayBound.tight)} '每周五 08:00'=${JSON.stringify(dayBound.everyFri)} '周一至周三'=${JSON.stringify(dayBound.range)}`);
  ok(dayBound.weekend === '' && dayBound.cycle === '' && dayBound.thirdWeek === '' && dayBound.oneWeek === '',
     `『周末』『周期』『第三周』『一周』都不误判：${JSON.stringify([dayBound.weekend, dayBound.cycle, dayBound.thirdWeek, dayBound.oneWeek])}`);
  ok(dayBound.comma === '周一' && dayBound.fullBang === '周一',
     `逗号 / 分号紧贴仍认得：'周一,08:00'=${JSON.stringify(dayBound.comma)} '周一；08:00'=${JSON.stringify(dayBound.fullBang)}｜'周一周二'=${JSON.stringify(dayBound.twoDays)}（无分隔符，不认）｜'上午周一'=${JSON.stringify(dayBound.morning)}（前字非边界，不认）`);

  /* 8c. 列表模式：班级/老师/教室一律用**完整原始行**匹配 —— 名字里含「周X」的班级必须认得出 */
  const wdCls = await cdp.eval(`(() => {
    const ctx = { classes:['每周一练','周三强化班'], rooms:['BY05'], teachers:[{name:'王老师', id:'t1'}] };
    const a = Hours.norm.fields('每周一练 18:00 王老师 BY05', ctx);
    const b = Hours.norm.fields('周三强化班 10:00 王老师 BY05', ctx);
    return {
      a:{day:a.day,cls:a.cls,teacher:a.teacher,room:a.room,title:a.title},
      b:{day:b.day,cls:b.cls,teacher:b.teacher,room:b.room,title:b.title}
    };
  })()`);
  ok(wdCls.a.day === '' && wdCls.a.cls === '每周一练' && wdCls.a.teacher === '王老师' && wdCls.a.room === 'BY05',
     `名含「周X」的班级认得出：${JSON.stringify(wdCls.a)}（期望 day='' cls='每周一练' teacher='王老师' room='BY05'）`);
  ok(wdCls.b.day === '' && wdCls.b.cls === '周三强化班' && wdCls.b.teacher === '王老师',
     `同上（周三强化班）：${JSON.stringify(wdCls.b)}`);

  /* 8d. 多星期候选：名字里混进了星期词时，取「结束位置最靠近时间词」的那个，并标 dayGuessed（第五轮复核的真风险）。
     这三行原先会把整节课**静默记到错的那一天**：名字里的「周X」被当成了整行的星期。 */
  const multiDay = await cdp.eval(`(() => {
    const ctx = { classes:['每周一练'], rooms:['BY05','BY06','BY07','BY08','BY09'],
                  teachers:[{name:'王老师',id:'t1'},{name:'李老师',id:'t2'},{name:'张伟',id:'t3'}] };
    const pick = l => { const x = Hours.norm.fields(l, ctx); return { day:x.day, g:x.dayGuessed, c:x.dayCandidates }; };
    const rg = Hours.norm.fields('每周一练 18:00 王老师 BY05', ctx);
    return {
      a: pick('周二,强化 周三 08:00 王老师 BY05'),
      b: pick('"周一"特别班 周二 08:00 王老师 BY05'),
      c: pick('《周一》节目 周三 08:00 王老师 BY05'),
      d: pick('（周一）08:00 成人书法 王老师'),
      e: pick('周一 08:00-09:40 成人书法 王老师 BY05 301'),
      regress: { day: rg.day, cls: rg.cls, g: rg.dayGuessed }
    };
  })()`);
  ok(multiDay.a.day === '周三' && multiDay.a.g === true,
     `多星期候选取最近时间的那个：'周二,强化 周三 08:00 …' → day=${JSON.stringify(multiDay.a.day)} dayGuessed=${multiDay.a.g}（期望 周三/true）候选=${JSON.stringify(multiDay.a.c)}`);
  ok(multiDay.b.day === '周二' && multiDay.b.g === true,
     `引号里的星期不当真：'"周一"特别班 周二 08:00 …' → day=${JSON.stringify(multiDay.b.day)} dayGuessed=${multiDay.b.g}（期望 周二/true）候选=${JSON.stringify(multiDay.b.c)}`);
  ok(multiDay.c.day === '周三' && multiDay.c.g === true,
     `书名号里的星期不当真：'《周一》节目 周三 08:00 …' → day=${JSON.stringify(multiDay.c.day)} dayGuessed=${multiDay.c.g}（期望 周三/true）候选=${JSON.stringify(multiDay.c.c)}`);
  ok(multiDay.d.day === '周一' && multiDay.d.g === false,
     `括号包住的星期能认出来：'（周一）08:00 成人书法 王老师' → day=${JSON.stringify(multiDay.d.day)} dayGuessed=${multiDay.d.g}（期望 周一/false）`);
  ok(multiDay.e.day === '周一' && multiDay.e.g === false,
     `单候选不标「猜的」：'周一 08:00-09:40 …' → day=${JSON.stringify(multiDay.e.day)} dayGuessed=${multiDay.e.g}（期望 周一/false）`);
  ok(multiDay.regress.day === '' && multiDay.regress.cls === '每周一练' && multiDay.regress.g === false,
     `回归护栏（第三轮修好的）：'每周一练 18:00 王老师 BY05' → day=${JSON.stringify(multiDay.regress.day)} cls=${JSON.stringify(multiDay.regress.cls)} dayGuessed=${multiDay.regress.g}（期望 ''/每周一练/false）`);

  /* 8e. 降噪（最重要的一条）：正常列表式课表跑**完整流程**后 7/7 天正确、7/7 行**不带 needCheck**。
     用一份与名册完全对得上的 ctx 跑 readSource —— 否则「班级/老师没认出来」的 unmatched 也会把行标黄，
     那不是这里要证的点。临时替换 Hours._ctx 注入干净名册，跑完复原。 */
  const listB64b = Buffer.from(LIST_LINES.join('\n'), 'utf8').toString('base64');
  const noise = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const ctx = { classes:['成人书法','少儿口才','形体训练','播音发声','模拟主持','新闻播报','即兴评述'],
                  rooms:['BY05','BY06','BY07','BY08','BY09'],
                  teachers:[{name:'王老师',id:'t1'},{name:'李老师',id:'t2'},{name:'张伟',id:'t3'}] };
    const orig = Hours._ctx;
    Hours._ctx = () => ctx;
    try {
      const f = window.__mkFile(${JSON.stringify(listB64b)}, 'hours_list2.csv', 'text/csv');
      const m = await Hours.readSource(f, () => {});
      return { mode:m.mode, recs:m.records.map(r => ({ day:r.day, title:r.title, needCheck:!!r.needCheck,
        notes:r.notes || [], guessed:!!Hours.norm.fields(r.raw, ctx).dayGuessed })) };
    } finally { Hours._ctx = orig; }
  })()`);
  {
    const badDay = noise.recs.map((r, i) => r.day === LIST_DAYS[i] ? null : `第${i + 1}行 期望${LIST_DAYS[i]} 得到「${r.day}」`).filter(Boolean);
    ok(noise.mode === 'list' && noise.recs.length === 7 && badDay.length === 0,
       `降噪 · 完整流程：${noise.recs.length}/7 行的 day 正确` + (badDay.length ? '｜' + badDay.join(' / ') : '') +
       '｜实际=' + JSON.stringify(noise.recs.map(r => r.day)));
    ok(noise.recs.length === 7 && noise.recs.every(r => r.guessed === false),
       `降噪 · dayGuessed 全为 false（唯一候选不算猜）：${JSON.stringify(noise.recs.map(r => r.guessed))}`);
    const yellow = noise.recs.map((r, i) => r.needCheck ? `第${i + 1}行(${r.notes.join('；')})` : null).filter(Boolean);
    ok(yellow.length === 0, yellow.length ? ('正常列表被误标黄：' + yellow.join(' / ')) : '降噪 · 7/7 行都不带 needCheck（黄底没有被滥标）');
    const dayInTitle2 = noise.recs.filter(r => DAYWORD.test(r.title)).map(r => `${r.day}→「${r.title}」`);
    ok(dayInTitle2.length === 0, dayInTitle2.length ? ('title 里还残留星期词：' + dayInTitle2.join(' / ')) : '降噪 · title 里没有星期词');
  }

  /* ── 6. 收尾：关掉自己的服务，跑仓库里已有的两个脚本 ── */
  try { cdp?.ws.close(); } catch {}
  chrome?.kill('SIGKILL'); server?.kill('SIGKILL');
  chrome = null; server = null;
  await sleep(800);

  console.log('\n【9/9】跑仓库已有的脚本（不回归 + 手机端）──');
  const ocrRun = spawnSync(NODE, [path.join(WORK, 'test', 'ocr_browser_test.mjs'), WORK, String(5490)],
    { encoding: 'utf8', cwd: WORK, maxBuffer: 32 * 1024 * 1024 });
  console.log('  ── test/ocr_browser_test.mjs 末几行 ──');
  console.log((ocrRun.stdout || '').trim().split('\n').slice(-8).map(l => '     ' + l).join('\n'));
  ok(ocrRun.status === 0, `已有 OCR 测试仍然通过（exit ${ocrRun.status}）` + (ocrRun.status === 0 ? '' : ('｜' + (ocrRun.stderr || '').trim().slice(0, 400))));

  for (const w of [390, 360, 320]) {
    const jsonOut = path.join(tmpdir(), `hours_probe_${w}.json`);
    const pr = spawnSync(NODE, [path.join(WORK, 'test', 'probe_mobile_layout.mjs'),
      String(5600 + w % 10), '--width=' + w, '--pages=hours', '--role=super', '--json=' + jsonOut],
      { encoding: 'utf8', cwd: WORK, maxBuffer: 32 * 1024 * 1024 });
    let v = null;
    try { v = JSON.parse(await readFile(jsonOut, 'utf8')).pages.hours; } catch {}
    if (!v) {
      ok(false, `probe @${w}：拿不到度量 JSON（exit ${pr.status}）｜${(pr.stderr || pr.stdout || '').trim().slice(0, 300)}`);
      continue;
    }
    const low = (v.smallCtl || []).map(c => `${c.tag}( ${c.fs}px )`);
    ok(pr.status === 0 && !v.error && v.overX === 0,
       `probe @${w}：overX = ${v.overX}（要求 0）· 页面高 ${v.pageH} · exit ${pr.status}${v.error ? ('｜' + v.error) : ''}`);
    ok((v.smallCtl || []).length === 0, `probe @${w}：没有 <16px 的表单控件${low.length ? '｜' + low.join(' | ') : ''}`);
  }

  console.log(`\n本文件 ok() 断言共调用 ${okCount} 次（子脚本 ocr_browser_test.mjs 打印的 ✅ 不计入 —— 上一轮口径差就在这里）`);
  console.log(failed ? `\n❌ 有 ${failed} 项没过\n` : '\n✅ 课时统计 · 阶段一 全部检查通过\n');
  if (skips.length) console.log('⏭️  跳过 ' + skips.length + ' 项（**不计入通过**）：\n     ' + skips.join('\n     ') + '\n');
} catch (e) {
  console.error('\n💥 测试中断：' + (e && e.message ? e.message : e) + '\n');
  console.error(e && e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : '');
  failed++;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
