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
 *   3) csv 通路：网格逐格一致
 *   4) 路由与权限：super/admin 看得到「课时统计」且能进；teacher/student 看不到、也进不去
 *   5) 不回归：跑一遍仓库里已有的 test/ocr_browser_test.mjs（Ocr.recognize 没被改坏）
 *   6) 手机端：test/probe_mobile_layout.mjs 量 hours 在 390 / 360 下的 overX 与 <16px 控件
 *
 * 🔴 任何一项没过都会在最下面汇总并把 exit code 置 1。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };
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
  console.log('\n【0/6】生成夹具 …');
  const truthPath = path.join(tmpdir(), 'hours_truth.json');
  await writeFile(truthPath, JSON.stringify({ header: TBL_HEADER, rows: TBL_ROWS }), 'utf8');
  const py = spawnSync(PY, [path.join(WORK, 'test', 'make_hours_fixtures.py'), FIX, truthPath], { encoding: 'utf8' });
  ok(py.status === 0, 'docx / csv 夹具生成：' + (py.stdout || '').trim() + (py.status === 0 ? '' : ('｜stderr: ' + (py.stderr || '').trim())));

  const pngOut = spawnSync(NODE, [path.join(WORK, 'test', 'html2png.mjs'),
    path.join(FIX, 'hours_tt.html'), path.join(FIX, 'hours_tt.png'), '1100', '2'],
    { encoding: 'utf8', cwd: WORK });
  ok(pngOut.status === 0 && /已写出/.test(pngOut.stdout || ''),
     '图片夹具生成：' + ((pngOut.stdout || '').trim().split('\n').pop() || '') + (pngOut.status === 0 ? '' : ('｜' + (pngOut.stderr || '').trim())));

  const docxB64 = (await readFile(path.join(FIX, 'hours_tt.docx'))).toString('base64');
  const csvB64 = (await readFile(path.join(FIX, 'hours_tt.csv'))).toString('base64');
  const pngB64 = (await readFile(path.join(FIX, 'hours_tt.png'))).toString('base64');
  console.log(`  · docx ${Math.round(docxB64.length * 3 / 4 / 1024)}KB · csv ${Math.round(csvB64.length * 3 / 4 / 1024)}KB · png ${Math.round(pngB64.length * 3 / 4 / 1024)}KB`);

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
  console.log('\n【1/6】路由、侧栏顺序、模块与 Ocr ──');
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

  /* ── 2. docx 通路 ── */
  console.log('\n【2/6】docx 通路（mammoth → 表格，精确）──');
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
  console.log('\n【3/6】csv 通路 ──');
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

  /* ── 4. 图片通路（端到端 OCR）── */
  console.log('\n【4/6】图片通路（OCR + 坐标重建）…（这一步要跑真识别，耐心等）');
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
  console.log('\n【5/6】路由与权限（super / admin / teacher / student）──');
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

  /* ── 6. 收尾：关掉自己的服务，跑仓库里已有的两个脚本 ── */
  try { cdp?.ws.close(); } catch {}
  chrome?.kill('SIGKILL'); server?.kill('SIGKILL');
  chrome = null; server = null;
  await sleep(800);

  console.log('\n【6/6】跑仓库已有的脚本（不回归 + 手机端）──');
  const ocrRun = spawnSync(NODE, [path.join(WORK, 'test', 'ocr_browser_test.mjs'), WORK, String(5490)],
    { encoding: 'utf8', cwd: WORK, maxBuffer: 32 * 1024 * 1024 });
  console.log('  ── test/ocr_browser_test.mjs 末几行 ──');
  console.log((ocrRun.stdout || '').trim().split('\n').slice(-8).map(l => '     ' + l).join('\n'));
  ok(ocrRun.status === 0, `已有 OCR 测试仍然通过（exit ${ocrRun.status}）` + (ocrRun.status === 0 ? '' : ('｜' + (ocrRun.stderr || '').trim().slice(0, 400))));

  for (const w of [390, 360]) {
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

  console.log(failed ? `\n❌ 有 ${failed} 项没过\n` : '\n✅ 课时统计 · 阶段一 全部检查通过\n');
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
