/**
 * 看板 5.54 专项：课程同步 + 时段去重 + 量化密度
 *
 *   node test/board554_check.mjs        # 截图落到 test/.shots/board554/
 *
 * 主理人报的两件事，逐条钉死：
 *   ① 看板课程没更新
 *      - 生产 schedule.day 存「一」不是「周一」。过去看板拿「周一」比 → 永远「今天没有排课」。
 *        现在 Board.rowsOn() 按 date 取（老数据退回「星期几字符」，两种写法都认）。
 *      - 顶带时段重复「09:30-10:10 · 09:30-10:10」：periodTxt 过去无条件拼 name + start–end。
 *        现在 slotTxt 只在名字里没有起点时间时才拼。
 *      - 作息里重复段要自己去重（用户的作息表还没清干净）→ uniqPeriods。
 *      - 新数据不用手动刷新：Board._pull 每 30s 走一遍 refresh → paint。
 *   ② 班级量化版块放大
 *      - 按班级数分档（data-n）：1–2 个班行撑满、名字 20px、分数 30px 加粗；
 *        3 个班略放；4–5 个班回落紧凑。断言是量出来的行高/字号，不是看截图猜。
 *      - 深蓝底对比度：截 #bdQuant 一块真像素，算 WCAG 对比度 ≥ 4.5。
 *      - 米白纸皮（sign）与深蓝皮（dash）各拍一张，确认两套都还在。
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5333);
const DBG = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'board554');
const SUPER = { user: '看板554教务', pass: 'board554pass' };
const PY = path.join(process.env.HOME, '.workbuddy/binaries/python/envs/default/bin/python3');

const BOARD_SRC = await readFile(path.join(dir, 'index.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(5000) });
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
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server; const chromes = []; const shots = [];
const pass = [], fail = [];
const t = (name, fn) => {
  try { const v = fn(); pass.push(name); console.log('  ✅ ' + name + (v !== undefined && v !== true ? '  → ' + v : '')); }
  catch (e) { fail.push(name + ' → ' + e.message); console.log('  ❌ ' + name + ' → ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name, clip){
  const r = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' });
  const f = path.join(OUT, name);
  await writeFile(f, Buffer.from(r.data, 'base64'));
  shots.push(f);
  console.log('  📸 ' + name);
  return f;
}
function lumStats(png){
  const r = spawnSync(PY, [path.join(dir, 'test', 'lum_stats.py'), png], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('亮度统计失败：' + (r.stderr || '').trim());
  return JSON.parse(r.stdout.trim());
}
async function go(cdp, url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(600);
}
const DUP_RANGE = /(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})[\s\S]*?\1/;

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'board554-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  /* 页面上的 JS 异常全都记下来，最后一个字都不许有 */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__errs = [];
    addEventListener('error', e => __errs.push('error: ' + (e.message || e.type)));
    addEventListener('unhandledrejection', e => __errs.push('reject: ' + (e.reason && e.reason.message || e.reason)));
  ` });
  /* 副屏 = 1920×1080 电视/显示器，按这个档量字号与行高 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  await go(cdp, `${BASE}/?nosw=1`);
  console.log('\n=== 0. 登录 + 造今日课表（含重复作息 / 老数据 / 明日课）===');
  const r0 = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r0.gateOff) throw new Error('登录失败：' + (r0.err || ''));

  const seeded = await cdp.eval(`(() => {
    const d = Util.today();
    const wd = '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];
    const mk = (base, n) => { const x = new Date(base + 'T00:00:00'); x.setDate(x.getDate() + n); return Util.dateOf(x); };
    const tmr = mk(d, 1), yst = mk(d, -1);
    const wdOf = dt => '日一二三四五六'[new Date(dt + 'T00:00:00').getDay()];

    const c5 = Store.upsert('classes', { id: null, name: '考前05班' });
    const c6 = Store.upsert('classes', { id: null, name: '考前06班' });

    /* 作息：三段正常 + 一段**完全重复** + 一段空 start（迁移写坏的） */
    const p1  = Store.upsert('periods', { id: null, name: '08:00-09:00', start: '08:00', end: '09:00' });
    const p1b = Store.upsert('periods', { id: null, name: '08:00-09:00', start: '08:00', end: '09:00' });
    const p2  = Store.upsert('periods', { id: null, name: '09:30-10:10', start: '09:30', end: '10:10' });
    const p3  = Store.upsert('periods', { id: null, name: '', start: '10:30', end: '11:20' });
    Store.upsert('periods', { id: null, name: '坏段', start: '', end: '' });

    /* 今日课：两个班同一节同一门（要合并成一行）+ 另一节 */
    Store.upsert('schedule', { id:null, date:d, day:wd, periodId:p1.id, time:'', title:'指定稿件朗读', cls:'考前05班', kind:'big' });
    Store.upsert('schedule', { id:null, date:d, day:wd, periodId:p1.id, time:'', title:'指定稿件朗读', cls:'考前06班', kind:'big' });
    Store.upsert('schedule', { id:null, date:d, day:wd, periodId:p2.id, time:'', title:'新闻播报', cls:'考前05班', kind:'big' });
    /* 老排课：右侧只有 teacher 字符串（没有 cls / teacherId）—— 不许空着 */
    Store.upsert('schedule', { id:null, date:d, day:wd, periodId:p2.id, time:'09:30', title:'上镜实训', teacher:'刘老师', kind:'big' });
    /* 老数据：没有 date，只有 day（「一」这种写法）→ 退回按星期几认 */
    Store.upsert('schedule', { id:null, day:wd, periodId:p3.id, title:'模拟主持', cls:'考前06班', kind:'big' });
    /* 明日 / 昨天各一条，验日期不串 */
    Store.upsert('schedule', { id:null, date:tmr, day:wdOf(tmr), periodId:p2.id, title:'明日模拟考', cls:'考前05班', kind:'big' });
    Store.upsert('schedule', { id:null, date:yst, day:wdOf(yst), periodId:p2.id, title:'昨天旧课', cls:'考前05班', kind:'big' });

    Store.set('_boardMode', 'dash');   /* 量化榜在 dash（深蓝）这套骨架上 */
    return { d, tmr, yst, wd, p1: p1.id, p1b: p1b.id, p2: p2.id, p3: p3.id,
             classes: Util.realClasses().length, periodsRaw: Store.list('periods').length };
  })()`);
  t('造好今日课表（两班同课 / 老数据只有 day / 重复作息 / 空段 / 明日与昨天各一条）', () => {
    assert(seeded.classes === 2, '该有 2 个真班，实际 ' + seeded.classes);
    assert(seeded.periodsRaw === 5, '作息该 5 条（含 1 重复 + 1 坏段），实际 ' + seeded.periodsRaw);
    return '今天 ' + seeded.d + ' · 2 个班 · 5 条作息（去重后应为 3）';
  });

  console.log('\n=== 1. 看板课程：今天真实课表上屏 ===');
  await go(cdp, `${BASE}/?nosw=1&board=1`);
  await waitFor(async () => (await cdp.eval(`document.getElementById('bdSched').textContent.trim().length > 0`)), { what: '课表上屏', tries: 30 });
  await sleep(800);

  const A = await cdp.eval(`(() => {
    const box = document.getElementById('bdSched');
    const ps = Board.uniqPeriods();
    const per = Store.list('periods');
    const at = st => per.find(p => p.start === st) || {};
    return {
      rowsToday: Board.rowsOn(${JSON.stringify(seeded.d)}).length,
      rowsTmr: Board.rowsOn(${JSON.stringify(seeded.tmr)}).length,
      rowsYst: Board.rowsOn(${JSON.stringify(seeded.yst)}).length,
      ps: ps.length,
      psDup: ps.filter(p => p.start === '08:00').length,
      slot1: Board.slotTxt(at('08:00')),
      slot2: Board.slotTxt(at('09:30')),
      slot3: Board.slotTxt(at('10:30')),
      text: box.textContent.replace(/\\s+/g, ' ').trim(),
      html: box.innerHTML,
      mode: document.getElementById('page-board').dataset.mode,
    };
  })()`);
  t('今天排课按 date 取：4 条今天 / 1 条明天 / 1 条昨天，互不串', () => {
    assert(A.rowsToday === 5, '今天该 5 条，实际 ' + A.rowsToday);
    assert(A.rowsTmr === 1, '明天该 1 条，实际 ' + A.rowsTmr);
    assert(A.rowsYst === 1, '昨天该 1 条，实际 ' + A.rowsYst);
    return '今天 5 · 明天 1 · 昨天 1';
  });
  t('老数据只有 day（「' + seeded.wd + '」）也能认出来 —— 不再拿「周X」去比', () => {
    assert(A.text.includes('模拟主持'), '没有 date 的老排课该按星期几认出来，实际课表：' + A.text);
    return '无 date 的「模拟主持」已上屏';
  });
  t('作息去重：5 条里重复段折成 1 段、空 start 的坏段丢掉 → 3 段', () => {
    assert(A.ps === 3, '去重后该 3 段，实际 ' + A.ps);
    assert(A.psDup === 1, '08:00 那段该只剩 1 条，实际 ' + A.psDup);
    return '3 段（08:00 / 09:30 / 10:30），重复段 ×1';
  });
  t('课程块显示今天的真实课程名（含班级），不是「今天没有排课」', () => {
    assert(!A.text.includes('今天没有排课'), '还在显示空态：' + A.text);
    ['指定稿件朗读', '新闻播报', '模拟主持', '上镜实训'].forEach(x => assert(A.text.includes(x), '课表缺「' + x + '」：' + A.text));
    assert(A.text.includes('考前05班 / 考前06班'), '同课两班该并在一行：' + A.text);
    return '指定稿件朗读 / 新闻播报 / 模拟主持 / 上镜实训 · 班级并列';
  });
  t('老排课只有 teacher 字符串时，右侧照样挂上老师名（不空着）', () => {
    assert(A.text.includes('刘老师'), '只有 teacher 字段的排课右侧该出「刘老师」：' + A.text);
    return '上镜实训 → 刘老师';
  });
  t('同一节同一门两个班合并成一行（20 条排课 ≠ 20 行）', () => {
    const n = (A.html.match(/指定稿件朗读/g) || []).length;
    assert(n === 1, '「指定稿件朗读」该只出 1 行，实际 ' + n);
    return '两条排课 → 1 行 + 班级并列';
  });
  t('明日预览取的是**明天**的课，昨天的课一条都不许混进来', () => {
    assert(A.text.includes('明日预览'), '缺「明日预览」分组：' + A.text);
    assert(A.text.includes('明日模拟考'), '明日预览缺明天的课：' + A.text);
    assert(!A.text.includes('昨天旧课'), '昨天的课不该上今天的屏：' + A.text);
    return '明日模拟考（置灰）· 无昨日旧课';
  });
  t('课表在 dash（深蓝信息中枢）骨架上', () => {
    assert(A.mode === 'dash', '该落在 dash 模式，实际 ' + A.mode);
    return 'data-mode=dash';
  });

  console.log('\n=== 2. 顶部时段：不重复、按 date 带课程名 ===');
  const B = await cdp.eval(`(() => {
    const old = Board._off;
    const at = h => { const x = new Date(); x.setHours(h, 30, 0, 0); return x.getTime() - Date.now(); };
    Board._off = at(8);   const inP1 = Board.periodTxt();
    Board._off = at(9);   const inP2 = Board.periodTxt();
    Board._off = at(3);   const none = Board.periodTxt();
    Board._off = old;
    const el = document.querySelector('[data-bd="period"]');
    return { inP1, inP2, none, dom: el ? el.textContent : '' };
  })()`);
  t('时段文字不重复：名字本身是区间时不再拼一遍 start–end', () => {
    assert(A.slot1 === '08:00–09:00', 'slotTxt 该只出一次区间，实际「' + A.slot1 + '」');
    assert(!DUP_RANGE.test(A.slot1) && !DUP_RANGE.test(A.slot2), '区间重复了：' + A.slot1 + ' / ' + A.slot2);
    assert(!DUP_RANGE.test(B.dom), '顶带时段重复：' + B.dom);
    return '「' + A.slot1 + '」「' + A.slot2 + '」各一次';
  });
  t('时段没名字（name 空）时退回「开始–结束」', () => {
    assert(A.slot3 === '10:30–11:20', '空名字该出区间，实际「' + A.slot3 + '」');
    return A.slot3;
  });
  t('当前节次 = 时段 · 这节课的课程名（08:30 落在第 1 节）', () => {
    assert(B.inP1 === '08:00–09:00 · 指定稿件朗读', '第 1 节实际「' + B.inP1 + '」');
    assert(B.inP2 === '09:30–10:10 · 新闻播报 / 上镜实训', '实际「' + B.inP2 + '」');
    return B.inP1 + ' ／ ' + B.inP2;
  });
  t('不在任何一节里就说「当前无课」，不硬凑', () => {
    assert(B.none === '当前无课', '凌晨 03:30 该是当前无课，实际「' + B.none + '」');
    return '03:30 → 当前无课';
  });

  console.log('\n=== 3. 新数据自动上屏（30 秒那一趟 refresh）===');
  const C = await cdp.eval(`(async () => {
    const d = Util.today();
    const p2 = Store.list('periods').find(p => p.start === '09:30');
    const row = Store.upsert('schedule', { id:null, date:d, day:'', periodId:p2.id, time:'', title:'临时加课', cls:'考前05班', kind:'big' });
    /* 模拟 30 秒定时器到点：走的就是 Board.start 里挂的那个 refresh */
    await Board.refresh();
    const on = document.getElementById('bdSched').textContent.includes('临时加课');
    Store.softDelete('schedule', row.id);
    await Board.refresh();
    const off = document.getElementById('bdSched').textContent.includes('临时加课');
    return { on, off, pull: typeof Board._pull, sec: typeof Board._sec };
  })()`);
  t('外部加了课 → 跑一趟 refresh 就上屏（不用手刷）', () => {
    assert(C.on, 'refresh 之后课表该出现「临时加课」');
    assert(!C.off, '删掉之后下一趟该收回去');
    return '加课 → 上屏；删课 → 收回';
  });
  t('看板自己挂着 1s 时钟 + 30s 拉数据两条定时器', () => {
    assert(C.pull === 'number', 'Board._pull 该是 setInterval 句柄，实际 ' + C.pull);
    assert(C.sec === 'number', 'Board._sec 该在跑');
    assert(/this\._pull = setInterval\(\(\) => this\.refresh\(\), 30000\)/.test(BOARD_SRC), '源码里 30s 的 refresh 定时器不见了');
    return '1s tick + 30s refresh';
  });
  t('源码里再没有拿「周一」去比 schedule.day 的老写法', () => {
    assert(!BOARD_SRC.includes("=== '周一'") && !BOARD_SRC.includes('=== "周一"'), '还留着「周一」比较');
    assert(/filter\(x => x && \(x\.date \? x\.date === d/.test(BOARD_SRC), 'rowsOn 该优先按 date 取');
    return 'Board.rowsOn：date 优先，day 字符兜底';
  });

  console.log('\n=== 4. 班级量化：2 个班撑满放大 ===');
  const Q2 = await cdp.eval(`(() => {
    Board.paintQuant();
    const q = document.getElementById('bdQuant');
    const rows = [...q.querySelectorAll('.bd-q')];
    const cs = el => getComputedStyle(el);
    const gap = parseFloat(cs(q).rowGap) || 0;
    const hs = rows.map(r => Math.round(r.getBoundingClientRect().height));
    return {
      n: q.dataset.n,
      hs,
      panel: Math.round(q.getBoundingClientRect().height),
      gap: Math.round(gap),
      name: parseFloat(cs(rows[0].querySelector('.bd-q-n')).fontSize),
      nameW: cs(rows[0].querySelector('.bd-q-n')).fontWeight,
      val: parseFloat(cs(rows[0].querySelector('.bd-q-v')).fontSize),
      valW: cs(rows[0].querySelector('.bd-q-v')).fontWeight,
      k: parseFloat(cs(rows[0].querySelector('.bd-q-k')).fontSize),
      text: q.textContent.replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  t('2 个班：容器打上 data-n=2，两行都在', () => {
    assert(Q2.n === '2', 'data-n 该是 2，实际 ' + Q2.n);
    assert(Q2.hs.length === 2, '该 2 行，实际 ' + Q2.hs.length);
    assert(Q2.text.includes('考前05班') && Q2.text.includes('考前06班'), '班级名缺：' + Q2.text);
    return 'data-n=2 · ' + Q2.text;
  });
  t('2 个班：班级名 20px、分数 30px 加粗、名次 18px（1920 档）', () => {
    assert(Q2.name >= 19.5, '班级名该 20px，实际 ' + Q2.name);
    assert(Q2.nameW >= 600, '班级名该加粗，实际 ' + Q2.nameW);
    assert(Q2.val >= 29.5, '分数该 30px，实际 ' + Q2.val);
    assert(Number(Q2.valW) >= 700, '分数该 700 加粗，实际 ' + Q2.valW);
    assert(Q2.k >= 17.5, '名次该 18px，实际 ' + Q2.k);
    return '名 ' + Q2.name + 'px/' + Q2.nameW + ' · 分 ' + Q2.val + 'px/' + Q2.valW + ' · 次 ' + Q2.k + 'px';
  });
  t('2 个班：竖条撑满可用高度（两行 + 间距 ≥ 面板 90%）', () => {
    const used = Q2.hs.reduce((a, b) => a + b, 0) + Q2.gap * (Q2.hs.length - 1);
    const ratio = used / Q2.panel;
    assert(ratio >= 0.9, '两行只占了 ' + Math.round(ratio * 100) + '%（行高 ' + Q2.hs.join('/') + '，面板 ' + Q2.panel + '）');
    assert(Math.min(...Q2.hs) >= 90, '每行该撑到 ≥90px，实际 ' + Q2.hs.join('/'));
    return '行高 ' + Q2.hs.join(' / ') + 'px · 占面板 ' + Math.round(ratio * 100) + '%';
  });

  const q2box = await cdp.eval(`(() => {
    const r = document.getElementById('bdQuant').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  await shot(cdp, 'quant-dash-2.png', q2box);

  console.log('\n=== 5. 响应式密度：3 个班略放、5 个班回落紧凑 ===');
  const Q3 = await cdp.eval(`(() => {
    for (let i = 1; i <= 3; i++) Store.upsert('classes', { id: null, name: '补班0' + i });
    Board.paintQuant();
    const q = document.getElementById('bdQuant');
    const rows = [...q.querySelectorAll('.bd-q')];
    const hs = rows.map(r => Math.round(r.getBoundingClientRect().height));
    const name = parseFloat(getComputedStyle(rows[0].querySelector('.bd-q-n')).fontSize);
    const val = parseFloat(getComputedStyle(rows[0].querySelector('.bd-q-v')).fontSize);
    return { n: q.dataset.n, hs, name, val };
  })()`);
  t('5 个班：data-n=5、回落紧凑（行高明显小于 2 个班）', () => {
    assert(Q3.n === '5', 'data-n 该是 5，实际 ' + Q3.n);
    assert(Q3.hs.length === 5, '该 5 行，实际 ' + Q3.hs.length);
    const avg3 = Q3.hs.reduce((a, b) => a + b, 0) / Q3.hs.length;
    const avg2 = Q2.hs.reduce((a, b) => a + b, 0) / Q2.hs.length;
    assert(avg3 < avg2 * 0.7, '5 个班该显著更紧凑：2 班均 ' + Math.round(avg2) + 'px vs 5 班均 ' + Math.round(avg3) + 'px');
    assert(Q3.name < Q2.name && Q3.val < Q2.val, '紧凑档字号该小回去：' + Q3.name + '/' + Q3.val);
    return '均高 ' + Math.round(avg3) + 'px（2 班 ' + Math.round(avg2) + 'px）· 字号 ' + Q3.name + '/' + Q3.val + 'px';
  });
  const Q3b = await cdp.eval(`(() => {
    const extra = Store.list('classes').filter(c => /^补班0[12]$/.test(c.name || ''));
    extra.forEach(c => Store.softDelete('classes', c.id));
    Board.paintQuant();
    const q = document.getElementById('bdQuant');
    const rows = [...q.querySelectorAll('.bd-q')];
    const hs = rows.map(r => Math.round(r.getBoundingClientRect().height));
    const name = parseFloat(getComputedStyle(rows[0].querySelector('.bd-q-n')).fontSize);
    return { n: q.dataset.n, hs, name, cls: Store.list('classes').length };
  })()`);
  t('3 个班：data-n=3、介于 2 班与 5 班之间（密度是算出来的，不是只对 2 行好看）', () => {
    assert(Q3b.n === '3', 'data-n 该是 3，实际 ' + Q3b.n);
    const avg3 = Q3b.hs.reduce((a, b) => a + b, 0) / Q3b.hs.length;
    const avg5 = Q3.hs.reduce((a, b) => a + b, 0) / Q3.hs.length;
    const avg2 = Q2.hs.reduce((a, b) => a + b, 0) / Q2.hs.length;
    assert(avg3 > avg5, '3 班行高该大于 5 班：' + Math.round(avg3) + ' vs ' + Math.round(avg5));
    assert(avg3 < avg2, '3 班行高该小于 2 班：' + Math.round(avg3) + ' vs ' + Math.round(avg2));
    return '2班 ' + Math.round(avg2) + 'px > 3班 ' + Math.round(avg3) + 'px > 5班 ' + Math.round(avg5) + 'px';
  });
  t('密度只认 data-n，CSS 按 1/2/3 分档（4–5 班走原紧凑口径）', () => {
    assert(BOARD_SRC.includes('.bd-quant[data-n="2"]'), '缺 data-n=2 的密度规则');
    assert(BOARD_SRC.includes('.bd-quant[data-n="3"]'), '缺 data-n=3 的密度规则');
    assert(BOARD_SRC.includes("box.dataset.n = String(rows.length)"), 'paintQuant 没写 data-n');
    return 'data-n 驱动 · 1/2 撑满 · 3 略放 · 4–5 紧凑';
  });

  console.log('\n=== 6. 深蓝底对比度（真像素）与两套皮肤 ===');
  const qbox = await cdp.eval(`(() => {
    for (let i = 1; i <= 3; i++) Store.upsert('classes', { id: null, name: '补班0' + i });
    Board.paintQuant();
    const r = document.getElementById('bdQuant').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  const qpng = await shot(cdp, 'quant-dash-5.png', qbox);
  const lum = lumStats(qpng);
  t('量化块在深蓝底上的文字对比度 ≥ 4.5:1', () => {
    assert(lum.ratio >= 4.5, '对比度只有 ' + lum.ratio + ':1（暗 ' + lum.lo + ' / 亮 ' + lum.hi + '）');
    return lum.ratio + ':1（底 ' + lum.lo + ' · 字 ' + lum.hi + '）';
  });
  await shot(cdp, 'board-dash-1920.png');

  const skins = await cdp.eval(`(async () => {
    Board.setMode('sign');
    await new Promise(r => setTimeout(r, 400));
    const sign = {
      shown: getComputedStyle(document.querySelector('.bdv-sign')).display,
      dash: getComputedStyle(document.querySelector('.bdv-dash')).display,
      bg: getComputedStyle(document.querySelector('.bdv-sign')).backgroundImage.slice(0, 40),
    };
    return sign;
  })()`);
  await shot(cdp, 'board-sign-1920.png');
  t('米白纸皮（sign）切得回来、深蓝骨架让位 —— 两套皮肤都在', () => {
    assert(skins.shown === 'flex', 'sign 该显示，实际 ' + skins.shown);
    assert(skins.dash === 'none', 'dash 该隐藏，实际 ' + skins.dash);
    assert(/gradient/.test(skins.bg), 'sign 该是米白纸底，实际 ' + skins.bg);
    return 'sign=flex / dash=none · 纸底渐变在';
  });
  await cdp.eval(`Board.setMode('dash')`);
  await sleep(500);

  console.log('\n=== 7. 无 JS 异常 ===');
  const errs = await cdp.eval(`window.__errs || []`);
  t('整轮下来页面零报错', () => {
    assert(!errs.length, '有 ' + errs.length + ' 条：' + errs.slice(0, 3).join(' | '));
    return '0 条';
  });

} catch (e) {
  fail.push('脚本异常 → ' + e.message);
  console.log('\n❌ 脚本异常：' + e.message);
} finally {
  console.log('\n────────────');
  console.log('通过 ' + pass.length + ' 项，失败 ' + fail.length + ' 项');
  if (fail.length) fail.forEach(x => console.log('  ✗ ' + x));
  if (shots.length) console.log('截图：' + shots.join(' '));
  for (const c of chromes) { try { c.kill(); } catch {} }
  if (server) { try { server.kill(); } catch {} }
  await devReset();
  process.exit(fail.length ? 1 : 0);
}
