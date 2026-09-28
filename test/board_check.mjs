/**
 * 看板端（副屏）核对（真 Chrome · 横屏 1600×900）
 *
 *   node test/board_check.mjs        # 截图落到 test/.shots/board/
 *
 * 纸色版：宣纸米白 + 三栏（左课表 / 中打卡码 / 右量化与未到），栏间只走一条细线，不用卡片。
 *
 * 核这几件事：
 *   1. 网址带 ?board=1 → 开机/刷新直接落在看板上（桌面快捷方式走的就是这条路）
 *   2. 落上去之后侧栏 / 顶栏 / 底栏全隐，屏上只剩数字；底是米白不是正白
 *   3. 应到 / 实到 两个大数算得对 —— 含「请假不算未到」这条口径，
 *      以及「演示班 / 演示学员一个字都不许上屏」
 *   4. 时钟在走；打卡码是 **6 位、60 秒一换**，底下带「N 秒后换码」倒计时
 *      （固定码这条岔路已拆：源码里逐条验过）
 *   5. 迟到 / 请假 / 未到**三个数放大**（原来一行 19px 小字，站远了看不见）
 *   6. 二维码**放中间且够大**，编的是那串数字本身（不是网址），且与数字码是同一枚
 *   7. 班级量化榜最多 5 格、按分数从高到低（真造 7 个班来验上限）
 *   8. 退出按钮能回工作台，而且**不带参数重开不会再掉进看板**（_lastPage 没被污染）
 *   9. 三处导航里都找不到「看板端」，入口只在设置页那张卡
 *  10. 五档屏宽都铺得满（宽屏三栏并排、≤900px 叠成一栏），没有横向溢出
 *  11. 学生「扫面前的二维码」= **扫到即打完**：扫码与手输二选一（点「手输」才出输入框），
 *      扫到的码不经输入框也提交得上去（用户报过「扫完还要再输一遍」）；
 *      取景窗在扫完 / 切页 / 重复调时都收得干净
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
const PORT = Number(process.argv[2] || 5331);
const DBG = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'board');
const SUPER = { user: '看板测试教务', pass: 'boardpass123' };

/* 源码原文：有几条判据只能看代码才验得准（「固定码这条岔路是不是真拆了」、
   「换码窗口与码长是不是钉死的」）。当场读盘，不另抄一份 —— 抄的那份会过期。 */
const BOARD_SRC = await readFile(path.join(dir, 'index.html'), 'utf8');
const SYNC_SRC = await readFile(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');

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
  const r = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  const f = path.join(OUT, name);
  await writeFile(f, Buffer.from(r.data, 'base64'));
  shots.push(f);
  console.log('  📸 ' + name);
}
/* 把一张图里的二维码读出来。用的是托管 venv 里的 OpenCV（真解码器）——
   自己画的矩阵「看着像二维码」不算数，得真读回来。 */
const PY = path.join(process.env.HOME, '.workbuddy/binaries/python/envs/default/bin/python3');
function qrDecode(png){
  const r = spawnSync(PY, [path.join(dir, 'test', 'qr_decode.py'), png], { encoding: 'utf8' });
  return { ok: r.status === 0, text: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
async function go(cdp, url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(500);
}

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'board-chrome-'));
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

  /* 副屏是横屏大窗口，照这个尺寸量 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ⚠️ 一律带 ?nosw=1：sw.js 一注册就 controllerchange → 整页 reload，
     正好撞在下面登录那段 await 上（CDP 报 "Inspected target navigated or closed"）。 */
  await go(cdp, `${BASE}/?nosw=1`);

  console.log('\n=== 0. 登录 + 造一份看得懂的数据 ===');
  const r0 = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, mode: Auth.mode };
  })()`);
  if (!r0.gateOff) throw new Error('登录失败：' + (r0.err || ''));
  console.log('已登录（模式：' + r0.mode + '，身份：' + await cdp.eval(`Auth.role()`) + '）');

  /* 造数据：一个班 40 人 —— 26 正常、4 迟到、3 请假、7 没来。
     请假三种写法都覆盖：2 个走「已批的请假工单」、1 个走打卡状态里的「病假」，
     验的是「请假不算未到」这条口径两头都认。人数给足，才看得出名单滚动。 */
  const seeded = await cdp.eval(`(() => {
    const d = Util.today(), now = Date.now();
    const cls = Store.upsert('classes', { id: null, name: '看板测试班' });
    const sto = [];
    for (let i = 1; i <= 40; i++) sto.push(Store.upsert('students', { id: null, name: '学员' + String(i).padStart(2, '0'), classId: cls.id, ord: i }));
    const mark = (s, status, extra) => Store.upsert('sign:' + d, Object.assign({ id: s.id, studentId: s.id, status, at: now, way: 'code' }, extra || {}));
    for (let i = 0; i < 26; i++) mark(sto[i], '正常');
    for (let i = 26; i < 30; i++) mark(sto[i], '迟到', { lateMin: i - 25 });
    mark(sto[30], '病假');
    Store.upsert('tickets', { id: null, type: '学生请假', status: 'done', studentId: sto[31].id, date: d, name: sto[31].name });
    Store.upsert('tickets', { id: null, type: '学生请假', status: 'done', studentId: sto[32].id, from: d, to: d, name: sto[32].name });
    /* 33~39 一共 7 个人什么都没写 = 未到 */

    /* 故意把「演示班 + 演示学员」也摆进来（用户实机就踩到这个）：
       演示数据是他自己按「第一次用：建好这四个账号」建出来的，
       但它不该混进名册、人数、出勤、量化 —— 这块屏上一个字都不许露。 */
    Store.upsert('classes',  { id: 'cls_demo', name: '演示班', demo: true });
    Store.upsert('students', { id: 'stu_demo', name: '演示学员', classId: 'cls_demo', demo: true });
    Store.upsert('quant_log', { id: 'q_demo_probe', clsId: 'cls_demo', date: d, label: '实测', delta: 99, _u: Date.now() });

    return {
      cls: cls.id,
      n: Store.list('students').filter(s => s.classId === cls.id).length,
      allStu: Store.list('students').length,
      rawStu: Store.listRaw('students').length,
      allCls: Store.list('classes').length,
      rawCls: Store.listRaw('classes').length,
    };
  })()`);
  t('造好一份数据（40 人：26 正常 / 4 迟到 / 3 请假 / 7 未到）', () => {
    assert(seeded.n === 40, '该有 40 个学生，实际 ' + seeded.n);
    return '班 ' + seeded.cls + ' / 40 人';
  });
  /* 用户三令五申的那条：演示班 / 演示学员不进正式系统。
     滤在数据层（Store.list），所以名册、人数、出勤、量化、导出一起干净 ——
     不是某一页忘了贴补丁就露出来。 */
  t('演示班 / 演示学员被数据层挡住：名册、人数、班级都不认它们', () => {
    assert(seeded.allStu === 40, 'list("students") 该只剩 40 个真学员，实际 ' + seeded.allStu);
    assert(seeded.rawStu === 41, 'listRaw("students") 该连演示学员一起拿到 41 个，实际 ' + seeded.rawStu);
    assert(seeded.allCls === 1, 'list("classes") 该只剩 1 个真班，实际 ' + seeded.allCls);
    assert(seeded.rawCls === 2, 'listRaw("classes") 该连演示班一起拿到 2 个，实际 ' + seeded.rawCls);
    return '真学员 40 / 底层 41 · 真班 1 / 底层 2（demo 标记与 cls_demo 两条判据都认）';
  });

  console.log('\n=== 1. 网址带 ?board=1 → 直接落在看板上 ===');
  await go(cdp, `${BASE}/?nosw=1&board=1`);
  const landed = await cdp.eval(`(() => ({
    on: document.body.classList.contains('board-mode'),
    page: document.getElementById('page-board').classList.contains('on'),
    side: getComputedStyle(document.querySelector('.side')).display,
    top: getComputedStyle(document.querySelector('.topbar')).display,
    tabs: getComputedStyle(document.querySelector('.tabbar')).display,
  }))()`);
  t('带参数打开 = 直接进看板，侧栏/顶栏/底栏三处全隐', () => {
    assert(landed.on, 'body 该带 board-mode');
    assert(landed.page, 'page-board 该是 on');
    assert(landed.side === 'none', '侧栏该隐藏，实际 ' + landed.side);
    assert(landed.top === 'none', '顶栏该隐藏，实际 ' + landed.top);
    assert(landed.tabs === 'none', '底栏该隐藏，实际 ' + landed.tabs);
    return '侧栏/顶栏/底栏 display=none';
  });

  /* 真·拿一次码：预览服务跑的就是 edge-functions 里那份真 sync.js，
     code 这个 action 是通的 —— 先验一遍「服务端给的确实是 6 位」。
     （下面几节会往 Board._code 里灌固定值，那是为了截图和量尺寸时数值稳定。） */
  const live = await cdp.eval(`(async () => {
    await Board.refresh();
    return { code: Board._code, until: Board._until - Date.now(), shown: document.getElementById('bdCode').textContent };
  })()`);
  t('看板真的能从服务端取到 6 位动态码（不是写死的假值）', () => {
    assert(/^\d{6}$/.test(live.code), '服务端该给 6 位码，实际「' + live.code + '」');
    assert(live.shown === live.code, '屏上显示的该与服务端一致，实际屏上「' + live.shown + '」');
    assert(live.until > 0 && live.until <= 60000, '该带回「这一枚还剩多久」用于倒计时，实际 ' + Math.round(live.until) + 'ms');
    return live.code + '（还剩 ' + Math.round(live.until / 1000) + ' 秒）';
  });

  /* ⚠️ 固定码这条路已经拆了 —— 现在**只有**「6 位、60 秒一换」一种形态，
     底下必须挂着倒计时（用户点名要的那个「还有几秒换」）。 */
  const code = await cdp.eval(`(() => {
    Board._code = '317204'; Board._until = Date.now() + 30000; Board.paintCode();
    const a = {
      txt: document.getElementById('bdCode').textContent,
      bar: document.getElementById('bdBar').style.width,
      left: document.getElementById('bdLeft').textContent,
      unit: document.querySelector('.bd-cd span').textContent,
      soon: document.getElementById('bdLeft').classList.contains('soon'),
    };
    /* 走到最后 10 秒：秒数该转朱砂（soon）催一下 */
    Board._until = Date.now() + 6000; Board.paintCode();
    const b = { left: document.getElementById('bdLeft').textContent,
                soon: document.getElementById('bdLeft').classList.contains('soon'),
                bar: document.getElementById('bdBar').style.width };
    /* 还剩 30 秒 → 进度条该在半程附近；6 秒 → 该掉到尾巴上 */
    Board._until = Date.now() + 30000; Board.paintCode();
    return { a: a, b: b, early: document.getElementById('bdBar').style.width };
  })()`);
  t('打卡码画得出来：6 位数字 + 进度条 + 「N 秒后换码」倒计时', () => {
    assert(code.a.txt === '317204', '该显示 317204，实际 ' + code.a.txt);
    assert(/^\d+$/.test(code.a.left), '倒计时要有个秒数，实际「' + code.a.left + '」');
    assert(code.a.unit === '秒后换码', '倒计时的单位该是「秒后换码」，实际「' + code.a.unit + '」');
    /* ⚠️ CSSOM 会归一化：设进去的 "50.0%" 读回来是 "50%"。别把小数位写进判据。 */
    assert(/^\d+(\.\d+)?%$/.test(code.a.bar), '进度条该有具体宽度，实际 ' + code.a.bar);
    const w30 = parseFloat(code.early), w6 = parseFloat(code.b.bar);
    assert(w30 > 40 && w30 < 60, '剩 30 秒时进度条该在半程（约 50%），实际 ' + code.early);
    assert(w6 < 15, '剩 6 秒时进度条该快走完了，实际 ' + code.b.bar);
    assert(!code.a.soon, '剩 30 秒不该转红');
    assert(code.b.soon, '剩 6 秒该转朱砂催一下，实际没转');
    return code.a.left + ' 秒后换码 · 进度 ' + code.a.bar + '（30s ' + code.early + ' → 6s ' + code.b.bar + '，末 10 秒转红）';
  });
  /* 码到底多久换一次、一位是几位 —— 这两件事以前是「教务自己设」，4/6/8 位混着来。
     现在只认服务端派生的 6 位 / 60 秒，代码里不许再出现第二种形态。 */
  t('动态码只有一种形态：6 位、60 秒一换（没有「教务自设固定码」这条岔路）', () => {
    assert(!/localCode|saveCode|randCode|_fixed/.test(BOARD_SRC), 'index.html 里不该再有固定码的残迹');
    const m = SYNC_SRC.match(/const CODE_WINDOW_MS = (\d+)/);
    assert(m && Number(m[1]) === 60000, '服务端的换码窗口该是 60000ms，实际 ' + (m ? m[1] : '找不到'));
    const n = SYNC_SRC.match(/const CODE_LEN = (\d+)/);
    assert(n && Number(n[1]) === 6, '服务端的码长该钉在 6 位，实际 ' + (n ? n[1] : '找不到'));
    assert(!/sign_rules\.code|rules\.code/.test(SYNC_SRC), '服务端不该再读教务自设的固定码了');
    return 'CODE_WINDOW_MS=' + m[1] + ' · CODE_LEN=' + n[1] + ' · 固定码分支已拆除';
  });

  /* ── 尺寸体检：铺满屏是这块屏的第一要求，任何一层没撑开都要看得见 ── */
  const dim = await cdp.eval(`(() => {
    const g = s => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
               d: cs.display, flex: cs.flex, align: cs.alignSelf }; };
    return { vw: innerWidth, vh: innerHeight,
      body: [...document.body.children].map(e => (e.id || e.className || e.tagName) + ':' + getComputedStyle(e).display),
      kids: [...document.getElementById('page-board').children].map(e =>
        e.className + ' pos=' + getComputedStyle(e).position + ' y=' + Math.round(e.getBoundingClientRect().y)),
      banner: (() => { const b = document.querySelector('#page-board .banner');
        return b ? getComputedStyle(b).display : 'none'; })(),
      clock: (() => { const r = document.getElementById('bdClock').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                 r: Math.round(r.right), b: Math.round(r.bottom),
                 fs: getComputedStyle(document.getElementById('bdClock')).fontSize }; })(),
      code: (() => { const r = document.getElementById('bdCode').getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                 r: Math.round(r.right), b: Math.round(r.bottom),
                 fs: getComputedStyle(document.getElementById('bdCode')).fontSize }; })(),
      app: g('.app'), col: g('.col'), main: g('#main'), page: g('#page-board'), bd: g('.bd'), rows: g('.bd-rows') };
  })()`);
  console.log('     视口 ' + dim.vw + '×' + dim.vh + ' | #page-board 子元素 ' + dim.kids.join(' , '));
  for (const k of ['app', 'col', 'main', 'page', 'bd'])
    console.log(`     ${k.padEnd(5)} x=${dim[k].x} y=${dim[k].y} ${dim[k].w}×${dim[k].h}  display=${dim[k].d} flex=${dim[k].flex}`);

  t('铺满整屏：page 与 .bd 都吃满视口，提醒条不让它下移', () => {
    assert(dim.page.display === undefined || dim.page.d !== 'grid',
      '宽屏那条 .page.on{grid-template-columns:repeat(2,1fr)} 会把看板切掉一半，实际 display=' + dim.page.d);
    assert(Math.abs(dim.page.w - dim.vw) < 2, '看板页该满宽 ' + dim.vw + '，实际 ' + dim.page.w);
    assert(Math.abs(dim.bd.w - dim.vw) < 2, '.bd 该满宽，实际 ' + dim.bd.w);
    assert(dim.bd.y === 0, '.bd 该从顶边开始，实际 y=' + dim.bd.y + '（有东西压在上面）');
    assert(dim.bd.h > dim.vh * 0.92, '.bd 该吃满高度，实际 ' + dim.bd.h + ' / ' + dim.vh);
    assert(dim.banner === 'none', '备份/自检提醒条在看板上该隐掉，实际 display=' + dim.banner);
    return '.bd ' + dim.bd.w + '×' + dim.bd.h + '，banner display=none';
  });

  /* 纸色版：时钟在顶带右端，二维码与数字码在中间那栏 ——
     两块的矩形仍然不能相交，这条判据一直要守。 */
  t('时钟在顶带、打卡码在中栏，各占一层，不叠在一起', () => {
    assert(dim.clock.b <= dim.code.y + 1,
      '时钟底边 ' + dim.clock.b + ' 该在打卡码顶边 ' + dim.code.y + ' 之上（字号给大了会压下去）');
    assert(dim.clock.w > 100 && dim.code.w > 200,
      '两块都该有足够的尺寸，实际时钟 ' + dim.clock.w + ' / 码 ' + dim.code.w);
    return '时钟 ' + dim.clock.fs + '（y=' + dim.clock.y + ' 底 ' + dim.clock.b + '）→ 码 '
         + dim.code.fs + '（y=' + dim.code.y + ' 宽 ' + dim.code.w + 'px）';
  });

  /* 「看板要白色页面吧……要米白或者是黄白，不要正白晃眼」—— 用户这一轮点名的。
     这块屏 24 小时亮着，正白 #FFF 会刺眼；米白压一点、暖一点（R ≥ G ≥ B 且不是纯白）。 */
  const paper = await cdp.eval(`(() => {
    const cs = getComputedStyle(document.body);
    const bd = getComputedStyle(document.querySelector('.bd'));
    const m = (bd.backgroundColor || '').match(/\\d+/g) || [];
    const hex = (cs.getPropertyValue('--bg') || '').trim();
    return { varBg: hex, bg: bd.backgroundColor, rgb: m.slice(0, 3).map(Number),
             scheme: cs.colorScheme, dark: matchMedia('(prefers-color-scheme: dark)').matches };
  })()`);
  t('底是宣纸米白，不是正白（久看不刺眼；且不跟系统深浅色变）', () => {
    const [r, g, b] = paper.rgb;
    assert(paper.rgb.length === 3, '量不到底色：' + JSON.stringify(paper));
    assert(!(r === 255 && g === 255 && b === 255), '不该是正白 #FFF（晃眼），实际 ' + paper.bg);
    assert(r >= g && g >= b, '该是暖色（R ≥ G ≥ B），实际 ' + paper.bg);
    assert(r >= 235 && r <= 253, '该是「米白/黄白」这一档亮度，实际 ' + paper.bg);
    assert(paper.varBg.toUpperCase() === '#FAF7F0', '底色该钉在 #FAF7F0，实际 ' + paper.varBg);
    return paper.bg + '（' + (paper.varBg || '') + '，系统当前' + (paper.dark ? '深色' : '浅色') + '，看板不受影响）';
  });

  /* 品牌标必须真的渲染出来 —— 用户对 logo 一直很在意，图上不出东西是最难发现的坏法。
     这块标连着翻过两次车：① v41 用 brand-lock-alpha.png（给深色底做的米黄细线描，
     本身没底色），贴米白纸上右侧砺蕴章整块化掉；② v42 整条套深墨底板，清楚但「白屏里插一块黑」，
     被用户否掉。v43 定稿 = 博艺圆章裸摆 + 只给砺蕴那半套暖米黄圆底。两次都是
     「尺寸、加载、文件名全正常，只有像素看得出来」，所以判据落在像素上。 */
  const brand = await cdp.eval(`(() => {
    const img = document.querySelector('.bd-lock');
    if (!img) return { err: '顶带里没有品牌标' };
    const r = img.getBoundingClientRect(), top = document.querySelector('.bd-top').getBoundingClientRect();
    const mid = document.querySelector('.bd-gate') || document.querySelector('.bd-col:nth-child(2)');
    const mr = mid.getBoundingClientRect(), mc = mid.querySelector('.bd-lab');
    let fit = null;
    if (mr && mc) {
      /* ⚠️ 不能拿「子元素高度之和 + 间距」跟容器比 —— 那只在子元素恰好铺满时等价。
         老老实实量首尾两个子元素的真实上下沿，跟容器的**内容盒**（去掉上下 padding）比。 */
      const kids = [...mid.children];
      const cs = getComputedStyle(mid);
      const top = mr.top + (parseFloat(cs.paddingTop) || 0);
      const bot = mr.bottom - (parseFloat(cs.paddingBottom) || 0);
      const f = kids[0].getBoundingClientRect();
      const l = kids[kids.length - 1].getBoundingClientRect();
      fit = { innerH: Math.round(bot - top),
              spanH: Math.round(l.bottom - f.top),
              over: Math.round(Math.max(0, top - f.top) + Math.max(0, l.bottom - bot)),
              slack: Math.round(Math.min(f.top - top, bot - l.bottom)) };
    }
    /* 把图读进画布量像素（**不铺底色**，保住 alpha）：
       ① 左半大半是透明的 → 说明「板只加在砺蕴那半」，博艺圆章仍是裸摆的；
       ② 右半是暖米黄圆底 + 暗金章 → 板底要亮、章线要明显暗于板，才叫「读得出」。
       这两条正是用户的要求（「只给砺蕴的 logo 加个底色」「换其他颜色」）——
       尺寸、加载、文件名全都正常，只有像素看得出来，所以判据落在像素上。 */
    let pix = null;
    try {
      const N = img.naturalWidth, M = img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = N; cv.height = M;
      const cx = cv.getContext('2d');
      cx.clearRect(0, 0, N, M);
      cx.drawImage(img, 0, 0);
      const raw = cx.getImageData(0, 0, N, M).data;
      const region = (x0, x1) => {
        const n = { t: 0, all: 0 };
        const rs = [], gs = [], bs = [], lums = [];
        for (let y = 0; y < M; y++) for (let x = x0; x < x1; x++) {
          const i = (y * N + x) * 4, a = raw[i + 3];
          n.all++;
          if (a < 20) n.t++;
          if (a > 128) { rs.push(raw[i]); gs.push(raw[i + 1]); bs.push(raw[i + 2]); }
          const k = a / 255;
          const r0 = raw[i] * k + 250 * (1 - k), g0 = raw[i + 1] * k + 247 * (1 - k),
                b0 = raw[i + 2] * k + 240 * (1 - k);
          lums.push(0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0);
        }
        const mid = (arr) => { arr.sort((a, b) => a - b);
                               return arr.length ? arr[Math.floor(arr.length / 2)] : 0; };
        lums.sort((a, b) => a - b);
        const q = (p) => lums[Math.floor(lums.length * p)] || 0;
        return { trans: n.t / n.all * 100, med: [mid(rs), mid(gs), mid(bs)],
                 p05: q(0.05), p50: q(0.5), p99: q(0.99) };
      };
      /* 左右取样区留开中间那道空（圆章与圆底之间）：左 0~48%、右 55%~100% */
      pix = { w: N, h: M, left: region(0, Math.floor(N * 0.48)),
              right: region(Math.floor(N * 0.55), N) };
      /* 左半取样区的**左上 / 右上角块**：裸摆的圆章，四个角一定是空的；给这一半
         套一块板就填满了。这是「只给砺蕴加底色」最直接的证据 ——
         ⚠️ 别只看「左半透明占比」：圆章一旦放大到快铺满左半，占比会从 55% 掉到
         24%（圆的透明率本来就是 21.5%），那条会误报（v44 实测踩到）。 */
      const box = (x0, y0, x1, y1) => {
        let t = 0, all = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          all++; if (raw[(y * N + x) * 4 + 3] < 20) t++;
        }
        return all ? t / all * 100 : 0;
      };
      pix.cornerL = [
        box(0, 0, Math.round(N * 0.06), Math.round(M * 0.10)),
        box(Math.round(N * 0.42), 0, Math.round(N * 0.48), Math.round(M * 0.10)),
      ];
      /* 按列找中间那道空，把标切成左右两块，各量外接框 —— 用户要「两枚一样大」。
         病根在生成脚本：它一度按「左半画布 bbox」量边（圆章右侧有一撮 alpha
         60~120 的淡色残影，把最长边从 526 虚撑到 623），圆章被压成 76%。
         所以这里不给容差以外的余地：两块宽高都得对得上。 */
      const segs = []; let cur = -1;
      for (let x = 0; x < N; x++) {
        let any = false;
        for (let y = 0; y < M; y++) if (raw[(y * N + x) * 4 + 3] > 30) { any = true; break; }
        if (any && cur < 0) cur = x;
        else if (!any && cur >= 0) { segs.push([cur, x - 1]); cur = -1; }
      }
      if (cur >= 0) segs.push([cur, N - 1]);
      pix.blobs = segs.map(([x0, x1]) => {
        let y0 = M, y1 = -1;
        for (let y = 0; y < M; y++) {
          for (let x = x0; x <= x1; x++) if (raw[(y * N + x) * 4 + 3] > 30) {
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
            break;
          }
        }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1, gap: 0 };
      });
      for (let i = 1; i < segs.length; i++) pix.blobs[i].gap = segs[i][0] - segs[i - 1][1] - 1;
    } catch (e) { pix = { err: String(e && e.message || e) }; }
    return { src: img.currentSrc || img.src, complete: img.complete,
             nw: img.naturalWidth, nh: img.naturalHeight,
             w: Math.round(r.width), h: Math.round(r.height),
             inTop: r.top >= top.top - 1 && r.bottom <= top.bottom + 1,
             pix, fit };
  })()`);
  t('顶带有博艺的品牌标，图真加载出来了（不是空白占位）', () => {
    assert(!brand.err, brand.err);
    assert(brand.complete && brand.nw > 0, '图没加载出来：' + JSON.stringify(brand));
    assert(/brand-plate/.test(brand.src), '该用「博艺圆章 + 砺蕴米黄圆底」那版，实际 ' + brand.src);
    assert(brand.inTop, '标该在顶带里，实际位置 ' + JSON.stringify(brand));
    assert(brand.w >= 60, '标不该小到看不清，实际 ' + brand.w + 'px 宽');
    return brand.nw + '×' + brand.nh + ' 原图 → 屏上 ' + brand.w + '×' + brand.h + 'px';
  });
  t('底色**只加在砺蕴那半**（左＝博艺圆章裸摆，右＝砺蕴圆底）', () => {
    assert(!brand.pix.err, '取像素失败：' + brand.pix.err);
    const p = brand.pix;
    /* 圆章/圆底都是圆形，两侧本该各留一圈透明；差别在「有没有一块铺满半边的板」：
       左半若被套板，透明占比会掉到个位数、两个角也会被填满。 */
    assert(p.left.trans >= 15,
      '左半（博艺圆章）透明占比只有 ' + p.left.trans.toFixed(0) + '% —— ' +
      '看着像给博艺那半也套了底板，用户要的是「只给砺蕴的 logo 加个底色」');
    assert(p.cornerL[0] >= 90 && p.cornerL[1] >= 90,
      '左半（博艺圆章）的角上有东西（左上透明 ' + p.cornerL[0].toFixed(0) + '%、右上 ' +
      p.cornerL[1].toFixed(0) + '%）—— 圆章裸摆时四角必然是空的，填上了就是套了板');
    assert(p.right.trans <= 30,
      '右半（砺蕴）透明占比 ' + p.right.trans.toFixed(0) + '% —— 圆底没画出来？');
    return '左半透明 ' + p.left.trans.toFixed(0) + '% · 两角空 ' + p.cornerL[0].toFixed(0) +
           '/' + p.cornerL[1].toFixed(0) + '%（裸摆）· 右半透明 ' +
           p.right.trans.toFixed(0) + '%（圆底）';
  });
  t('砺蕴那半的板是**暖米黄**（用了深墨/杂色这里会挂），且章线在板上读得出', () => {
    assert(!brand.pix.err, '取像素失败：' + brand.pix.err);
    const R = brand.pix.right;
    assert(R.med[0] > R.med[1] && R.med[1] > R.med[2] && R.med[0] >= 225,
      '圆底该是暖米黄（不透明像素中位色 R>G>B 且 R≥225），实际 rgb(' +
      R.med.join(',') + ') —— 深墨底板会给出 20 上下的数');
    assert(R.p50 >= 210,
      '板底亮度只有 ' + R.p50.toFixed(0) + '（暖米黄该在 230 上下）');
    assert(R.p50 - R.p05 >= 35,
      '章线跟板底几乎同亮度（p50 ' + R.p50.toFixed(0) + ' vs p05 ' + R.p05.toFixed(0) +
      '）—— 印章在纸上化掉了，正是用户报的「看不清晰」');
    return '板色 rgb(' + R.med.join(',') + ') · 亮度 p50 ' + R.p50.toFixed(0) +
           ' / 章线 p05 ' + R.p05.toFixed(0) + '（差 ' + (R.p50 - R.p05).toFixed(0) + '）';
  });
  t('两枚 logo **一样大**（左博艺圆章 = 右砺蕴圆底）', () => {
    assert(!brand.pix.err, '取像素失败：' + brand.pix.err);
    const b = brand.pix.blobs;
    assert(b && b.length === 2, '标该由左右两块组成，实际切出 ' + (b ? b.length : 0) + ' 块');
    const tol = Math.max(2, Math.round(b[0].w * 0.03));
    const dw = Math.abs(b[0].w - b[1].w), dh = Math.abs(b[0].h - b[1].h);
    assert(dw <= tol && dh <= tol,
      '两枚 logo 一大一小：左 ' + b[0].w + '×' + b[0].h + ' vs 右 ' + b[1].w + '×' + b[1].h +
      '（用户原话「这两个 logo 要一样大，不能你大我小，它俩是一样的」）');
    return '左 ' + b[0].w + '×' + b[0].h + ' · 右 ' + b[1].w + '×' + b[1].h +
           '（原图 ' + brand.nw + '×' + brand.nh + '，净空隙 ' + b[1].gap + 'px）';
  });
  t('中栏没被顶带挤溢出（挤出去会被 body 的 overflow:hidden 默默裁掉，图上少一行）', () => {
    assert(brand.fit, '没量到中栏尺寸');
    assert(brand.fit.over <= 1,
      '中栏溢出了 ' + brand.fit.over + 'px：内容 ' + brand.fit.spanH + 'px / 内容盒 ' +
      brand.fit.innerH + 'px —— 迟到请假未到那一行会被裁掉');
    return '中栏 内容 ' + brand.fit.spanH + 'px / 内容盒 ' + brand.fit.innerH +
           'px（上下各余 ' + brand.fit.slack + 'px）';
  });

  console.log('\n=== 2. 五个数算得对（含「请假不算未到」）===');
  const stats = await cdp.eval(`(() => {
    Board._code = '317204'; Board._until = Date.now() + 43000;   /* 让屏幕好看点，后面截图用 */
    Board._data = Board.collect(Util.today());
    Board.paint();
    return {
      d: Board._data,
      should: document.getElementById('bdShould').textContent,
      here: document.getElementById('bdHere').textContent,
      mini: document.getElementById('bdMini').textContent.replace(/\\s+/g, ' ').trim(),
      miniItems: [...document.querySelectorAll('#bdMini .bd-m')].map(e => ({
        k: e.querySelector('span').textContent, n: e.querySelector('b').textContent,
        c: getComputedStyle(e.querySelector('b')).color,
        fs: parseFloat(getComputedStyle(e.querySelector('b')).fontSize) })),
      quantNames: [...document.querySelectorAll('#bdQuant .bd-q-n')].map(e => e.textContent),
      miss: [...document.querySelectorAll('#bdMiss .bd-row')].map(x => x.textContent),
      missTitle: document.getElementById('bdMissTitle').textContent,
    };
  })()`);
  t('应到 37（40 人减 3 请假）、已到 30、迟到 4、请假 3、未到 7', () => {
    const d = stats.d;
    assert(d.total === 40, '名册该 40 人，实际 ' + d.total);
    assert(d.leave === 3, '请假该 3 人（2 张工单 + 1 条病假），实际 ' + d.leave);
    assert(d.should === 37, '应到该 37 人（40−3），实际 ' + d.should);
    assert(d.ok === 26, '正常该 26 人，实际 ' + d.ok);
    assert(d.late === 4, '迟到该 4 人，实际 ' + d.late);
    assert(d.miss.length === 7, '未到该 7 人，实际 ' + d.miss.length);
    return '应到 ' + stats.should + ' / 实到 ' + stats.here + '（' + stats.mini + '）';
  });
  t('未到名单是「学员34~40」，三位请假的一个都没被算成欠勤', () => {
    assert(stats.miss.length === 7, '名单该 7 人，实际 ' + stats.miss.length);
    assert(stats.miss[0] === '学员34' && stats.miss[6] === '学员40', '名单该是 34~40，实际 ' + stats.miss.join('、'));
    const all = stats.miss.join('、');
    ['学员31', '学员32', '学员33'].forEach(n =>
      assert(!all.includes(n), n + ' 已经批过假，不该出现在未到名单里'));
    /* 用户实机报的那条：未到名单里冒出「演示学员」 */
    assert(!all.includes('演示'), '演示学员不该出现在这块屏的未到名单里，实际名单：' + all);
    return '标题「' + stats.missTitle + '」名单 ' + all;
  });
  /* 演示班同样不许上量化榜 —— 它名下哪怕有 99 分也不该占一个格子 */
  t('量化榜上没有「演示班」（演示数据连班级维度都进不来）', () => {
    assert(!stats.quantNames.join('/').includes('演示'), '演示班不该出现在量化榜上，实际 ' + stats.quantNames.join(' / '));
    return stats.quantNames.length ? stats.quantNames.join(' / ') : '（榜上暂时只有真班）';
  });

  /* 纸色版的「多少个」不再摊成六格矩阵，收成「应到 / 实到」两个大数 + 底下一行小字。
     这是用户点名的排法：二维码下面就直接是「应到多少人、实到多少人」。
     颜色仍然只上数字，系统里那个通用 `.ok{background:#eafaf0}` 不许渗进来。 */
  const tiles = await cdp.eval(`(() => {
    const box = document.querySelector('.bd-count');
    const cells = [...box.querySelectorAll('b')].map(b => ({
      n: b.textContent, cls: b.parentElement.className, c: getComputedStyle(b).color }));
    const lab = [...box.querySelectorAll('span')].map(s => s.textContent);
    return { box: box.className, bg: getComputedStyle(box).backgroundColor,
             cells: cells, lab: lab,
             mini: document.getElementById('bdMini').textContent.replace(/\\s+/g, ' ').trim(),
             miniItems: [...document.querySelectorAll('#bdMini .bd-m')].map(e => {
               const cs = getComputedStyle(e);
               return { k: e.querySelector('span').textContent, n: e.querySelector('b').textContent,
                        cls: e.className,
                        c: getComputedStyle(e.querySelector('b')).color,
                        fs: parseFloat(getComputedStyle(e.querySelector('b')).fontSize),
                        labFs: parseFloat(getComputedStyle(e.querySelector('span')).fontSize),
                        bg: cs.backgroundColor, pad: cs.paddingTop, bw: cs.borderTopWidth };
             }) };
  })()`);
  t('二维码下面是「应到 / 实到」两个大数（实到 = 正常 + 迟到），只有数字着色', () => {
    assert(tiles.cells.length === 2, '该是两块（应到 / 实到），实际 ' + tiles.cells.length);
    assert(tiles.lab.join('/') === '应到/实到', '两个标签该是「应到 / 实到」，实际 ' + tiles.lab.join('/'));
    assert(tiles.cells[0].n === '37', '应到该 37，实际 ' + tiles.cells[0].n);
    assert(tiles.cells[1].n === '30', '实到该 30（26 正常 + 4 迟到），实际 ' + tiles.cells[1].n);
    assert(tiles.bg === 'rgba(0, 0, 0, 0)', '这一块不该有底色，实际 ' + tiles.bg + '（类名 ' + tiles.box + '）');
    /* 类名必须带 bd- 前缀：系统的 .ok{background:#eafaf0} 会把「已到」的绿底换成浅绿块 */
    assert(/bd-c-ok/.test(tiles.cells[1].cls), '「实到」该带 bd-c-ok（不能直接叫 ok），实际「' + tiles.cells[1].cls + '」');
    return tiles.cells.map(x => x.n).join(' / ' + '应到实到'.slice(0, 0)) + ' ｜ ' + tiles.mini;
  });
  /* 「已到、未到下面请假的等等这三个再放大一点，太小了看不到」—— 用户点名的。
     验的是**实际算出来的字号**，不是 CSS 里写了多少 —— 写了 clamp 也可能被后面的规则压掉。 */
  t('迟到 / 请假 / 未到 各自成格、数字放大到一眼能读（原来一行小字）', () => {
    const it = tiles.miniItems;
    assert(it.length === 3, '该是三个数（迟到 / 请假 / 未到），实际 ' + it.length);
    assert(it.map(x => x.k).join('/') === '迟到/请假/未到', '三个标签该是迟到/请假/未到，实际 ' + it.map(x => x.k).join('/'));
    assert(it.map(x => x.n).join('/') === '4/3/7', '三个数该是 4/3/7，实际 ' + it.map(x => x.n).join('/'));
    assert(it[0].c === 'rgb(170, 122, 30)', '迟到该是赭黄，实际 ' + it[0].c);
    assert(it[1].c === 'rgb(74, 110, 155)', '请假该是霁蓝，实际 ' + it[1].c);
    assert(it[2].c === 'rgb(178, 58, 46)', '未到该是朱砂，实际 ' + it[2].c);
    const min = Math.min(...it.map(x => x.fs));
    assert(min >= 22, '这三个数字至少 22px（原来只有 12~19px），实际最小 ' + min + 'px');
    assert(Math.min(...it.map(x => x.labFs)) >= 12, '标签也不该被压小，实际 ' + it.map(x => x.labFs).join('/'));
    /* ⚠️ 类名一律带 bd- 前缀。系统里有一批通用类（`.warn` / `.ok` / …）自带底色、内边距、
       甚至 font-size —— 直接借名会被一起吃掉：`未到` 那个数会平白多一圈黄底、
       标签被压成 13px。这条就是守这个的（.ok 已经在「实到」那条里守过一回）。 */
    it.forEach(x => {
      assert(x.bg === 'rgba(0, 0, 0, 0)', '「' + x.k + '」不该有底色（被通用类吃了？类名 ' + x.cls + '），实际 ' + x.bg);
      assert(x.pad === '0px', '「' + x.k + '」不该有内边距，实际 ' + x.pad);
      assert(/^bd-/.test(x.cls), '类名该带 bd- 前缀，实际「' + x.cls + '」');
    });
    return it.map(x => x.k + ' ' + x.n + '（' + x.fs + 'px）').join(' · ') + ' ｜ 文字「' + tiles.mini + '」';
  });

  /* 「班级量化其实只留最多五个班级的格子就够了」—— 用户点名的上限。
     样本里只有一个班，靠它是验不出上限的；这里临时造 7 个班、给 7 个不同的分，
     看榜上是不是真的只留 5 格、而且是从高到低排。验完把临时班清掉。 */
  const quant = await cdp.eval(`(() => {
    const made = [];
    const before = Store.list('classes').length;
    [30, -12, 8, 20, -5, 14, 2].forEach((dl, i) => {
      const c = Store.upsert('classes', { id: null, name: '榜' + String(i + 1).padStart(2, '0') + '班' });
      made.push(c.id);
      Store.upsert('quant_log', { id: Util.uid(), clsId: c.id, date: Util.today(), label: '实测', delta: dl, _u: Date.now() });
    });
    Board.paintQuant();
    const rows = [...document.querySelectorAll('#bdQuant .bd-q')].map(e => ({
      n: e.querySelector('.bd-q-n').textContent, v: Number(e.querySelector('.bd-q-v').textContent),
      cls: e.className, bg: getComputedStyle(e).backgroundColor }));
    const nClasses = Store.list('classes').length;
    /* 清场：临时班连流水一起删掉，别污染后面的截图和名单 */
    Store.list('quant_log').filter(x => made.includes(x.clsId)).forEach(x => Store.softDelete('quant_log', x.id));
    made.forEach(id => Store.softDelete('classes', id));
    Board.paintQuant();
    return { rows: rows, before: before, nClasses: nClasses, back: document.querySelectorAll('#bdQuant .bd-q').length };
  })()`);
  t('班级量化榜最多 5 格、按分数从高到低排（造 7 个班也只显示 5 个）', () => {
    assert(quant.nClasses === quant.before + 7, '此时该有 ' + (quant.before + 7) + ' 个班，实际 ' + quant.nClasses);
    assert(quant.rows.length === 5, '最多该 5 格（用户点名），实际 ' + quant.rows.length);
    const vs = quant.rows.map(r => r.v);
    assert(vs.join(',') === '130,120,114,108,102', '该是 130/120/114/108/102（前 5 高分），实际 ' + vs.join('/'));
    quant.rows.forEach(r => assert(/bd-q up/.test(r.cls), '分了该带 up（中式口径：涨红），实际「' + r.cls + '」'));
    assert(quant.back === quant.before, '临时班清掉后榜上该只剩原有的 ' + quant.before + ' 个班，实际 ' + quant.back);
    return vs.join(' / ') + '（第 6、7 名的 95、88 分没上屏）';
  });

  const paints = await cdp.eval(`[...document.querySelectorAll('#page-board *')]
    .map(e => ({ t: e.tagName + '.' + (e.className || ''), bg: getComputedStyle(e).backgroundColor }))
    .filter(x => x.bg && x.bg !== 'rgba(0, 0, 0, 0)' && x.bg !== 'transparent')
    .map(x => x.t + '→' + x.bg).slice(0, 12)`);
  console.log('     看板里带底色的元素：' + paints.join(' | '));

  /* 滚动只该在「塞不下」时开：7 个人放得下，就该老老实实不滚、内容靠上排；
     人一多才该复制一份上滚，而且只复制一份 —— 不能每半分钟刷新就翻一倍。
     另外守一条版面的事：右栏是「量化榜 + 未到名单」两块，名单**不能**被居中，
     否则两块之间会裂开一大段空（纸色底上留白不难看，裂缝难看）。 */
  const clip = await cdp.eval(`(() => {
    const rows = document.getElementById('bdMiss');
    const box = rows.parentElement;
    const panel = rows.closest('.bd-miss');
    const h3 = panel.querySelector('h3');
    const quant = document.getElementById('bdQuant');
    const pr = panel.getBoundingClientRect(), hr = h3.getBoundingClientRect(), lr = box.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const gap = Math.round(hr.top - quant.getBoundingClientRect().bottom);
    const fits = { loop: rows.classList.contains('loop'), fit: rows.classList.contains('fit'),
                   panelFit: panel.classList.contains('fit'),
                   rowsH: rows.scrollHeight, boxH: box.clientHeight,
                   /* 标题上方、名单下方各剩多少 —— 靠上排就该「上≈0、下很大」 */
                   above: Math.round(hr.top - (pr.top + parseFloat(cs.paddingTop))),
                   below: Math.round((pr.bottom - parseFloat(cs.paddingBottom)) - lr.bottom),
                   gap: gap };
    const many = Array.from({ length: 260 }, (_, i) => '<div class="bd-row">学员' + (i + 1) + '</div>').join('');
    Board.fill(rows, many);
    const over = { loop: rows.classList.contains('loop'), fit: rows.classList.contains('fit'),
                   rowsH: rows.scrollHeight, boxH: box.clientHeight,
                   dur: rows.style.animationDuration, h: rows.style.getPropertyValue('--bd-h') };
    Board.fill(rows, many);   /* 同一份内容再灌一次：该直接跳过，不能又复制一遍 */
    const again = { rowsH: rows.scrollHeight, loop: rows.classList.contains('loop') };
    Board.paint();            /* 还原成真实数据 */
    return { fits, over, again };
  })()`);
  t('量化榜与未到名单贴着排（中间不裂缝）；名单装得下就不滚', () => {
    assert(!clip.fits.loop, '7 个人在 ' + clip.fits.boxH + 'px 的面板里放得下，不该开滚动（实际高 ' + clip.fits.rowsH + '）');
    assert(clip.fits.fit, '7 个人放得下时该加 .fit 摆着，实际没加（内容 ' + clip.fits.rowsH + ' / 面板 ' + clip.fits.boxH + '）');
    assert(clip.fits.gap < 40, '量化榜底边到名单标题顶边隔了 ' + clip.fits.gap + 'px —— 两块被推开了');
    assert(clip.fits.above <= 2, '名单该贴着量化榜往下排，实际标题上方还空着 ' + clip.fits.above + 'px');
    assert(clip.fits.below > clip.fits.above, '留白该沉在栏底（下 ' + clip.fits.below + 'px > 上 ' + clip.fits.above + 'px）');
    assert(clip.over.loop, '260 个人该开滚动（实际内容 ' + clip.over.rowsH + ' / 面板 ' + clip.over.boxH + '）');
    assert(!clip.over.fit, '要滚了就不该再挂 .fit');
    assert(clip.over.rowsH > clip.over.boxH, '复制后总高该超出面板，实际 ' + clip.over.rowsH + ' ≤ ' + clip.over.boxH);
    assert(clip.again.rowsH === clip.over.rowsH, '同一份内容重灌不该再复制（' + clip.over.rowsH + ' → ' + clip.again.rowsH + '）');
    assert(parseFloat(clip.over.dur) >= 14, '滚动时长该有个下限，实际 ' + clip.over.dur);
    return '两块间距 ' + clip.fits.gap + 'px（上 ' + clip.fits.above + ' / 下 ' + clip.fits.below
         + 'px）· 塞不下：高 ' + clip.over.rowsH + 'px 上滚 ' + clip.over.dur;
  });

  console.log('\n=== 3. 时钟在走 / 数据新鲜度有话说 ===');
  const clockA = await cdp.eval(`document.getElementById('bdClock').textContent`);
  await sleep(1600);
  const clockB = await cdp.eval(`document.getElementById('bdClock').textContent`);
  t('时钟每秒在走（服务端校时后的时间）', () => {
    assert(/^\d{2}:\d{2}:\d{2}$/.test(clockA), '时钟格式不对：' + clockA);
    assert(clockA !== clockB, '一秒半过去了时钟没变（还是 ' + clockA + '）');
    return clockA + ' → ' + clockB;
  });
  const fresh = await cdp.eval(`(() => {
    Board._stamp = Date.now(); Board.paintFresh();
    const now = { t: document.getElementById('bdFresh').textContent, warn: document.getElementById('bdFresh').classList.contains('warn') };
    Board._stamp = Date.now() - 5 * 60000; Board.paintFresh();
    const old = { t: document.getElementById('bdFresh').textContent, warn: document.getElementById('bdFresh').classList.contains('warn') };
    return { now, old };
  })()`);
  t('数据新鲜度：刚拉过写「数据更新」，五分钟没更新亮成「可能已断网」', () => {
    assert(/数据更新/.test(fresh.now.t) && !fresh.now.warn, '刚拉过该是「数据更新」，实际「' + fresh.now.t + '」');
    assert(/可能已断网/.test(fresh.old.t) && fresh.old.warn, '五分钟没更新该警示，实际「' + fresh.old.t + '」warn=' + fresh.old.warn);
    return '「' + fresh.now.t + '」→「' + fresh.old.t + '」';
  });

  /* 左栏「今日课表」：之前没被任何断言盖到，但它是用户点名的三栏之一。
     排几节课进来，验竖排行（时间 · 课名 · 老师/班级）真的出得来。 */
  const sched = await cdp.eval(`(() => {
    const w = ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];
    const rows = [['07:30','早功·口腔操','陈老师'], ['09:00','即兴评述','刘老师'], ['14:00','新闻播报','王老师']];
    rows.forEach(([t, title, teacher], i) => {
      const pd = Store.upsert('periods', { id: null, name: '第' + (i + 1) + '节', start: t });
      Store.upsert('schedule', { id: null, day: w, periodId: pd.id, time: t, title: title, teacher: teacher });
    });
    Board.paint();
    const got = [...document.querySelectorAll('#bdSched .bd-s')].map(e => ({
      t: (e.querySelector('.bd-s-t') || {}).textContent || '',
      n: (e.querySelector('.bd-s-n') || {}).textContent || '',
      w: (e.querySelector('.bd-s-w') || {}).textContent || '' }));
    return { w: w, got: got, empty: /今天没有排课/.test(document.getElementById('bdSched').textContent) };
  })()`);
  t('左栏今日课表出来了：一行一课，带时间与老师（竖排、细线分隔）', () => {
    assert(!sched.empty, '课表还是空的（今天 ' + sched.w + '）');
    assert(sched.got.length === 3, '该有 3 行课，实际 ' + sched.got.length);
    assert(sched.got[0].t === '07:30' && sched.got[2].t === '14:00',
      '该按时间排序，实际 ' + sched.got.map(x => x.t).join(' / '));
    assert(sched.got[1].n === '即兴评述', '课名没对上，实际「' + sched.got[1].n + '」');
    assert(sched.got[1].w === '刘老师', '右侧该是老师，实际「' + sched.got[1].w + '」');
    return sched.got.map(x => x.t + ' ' + x.n + '/' + x.w).join(' · ');
  });

  /* 顺手把量化榜灌满 5 个班 —— 下面的截图才像真实用途的样子（不是只有一格空榜） */
  await cdp.eval(`(() => {
    ['播音一班','播音二班','编导班','表演班','复读班'].forEach((n, i) => {
      const c = Store.upsert('classes', { id: null, name: n });
      Store.upsert('quant_log', { id: Util.uid(), clsId: c.id, date: Util.today(), label: '本周', delta: [18, 6, -9, 12, -3][i], _u: Date.now() });
    });
    Board.paintQuant();
  })()`);

  await cdp.eval(`Board._stamp = Date.now(); Board.paintFresh();`);
  await sleep(300);
  await shot(cdp, 'board-1600x900.png');

  console.log('\n=== 4. 退出看板 → 回工作台，且不带参数重开不再掉进来 ===');
  const out1 = await cdp.eval(`(async () => {
    Board.leave();
    await new Promise(r => setTimeout(r, 600));
    return { mode: document.body.classList.contains('board-mode'),
             on: document.getElementById('page-home').classList.contains('on'),
             last: Store.get('_lastPage') };
  })()`);
  t('点退出（或按 Esc）回工作台，看板模式解开', () => {
    assert(!out1.mode, 'board-mode 该摘掉');
    assert(out1.on, '该回到「今日」页');
    assert(out1.last !== 'board', '_lastPage 不该被写成 board，实际 ' + out1.last);
    return '回到 page-home，_lastPage=' + out1.last;
  });

  await go(cdp, `${BASE}/?nosw=1`);
  const reopen = await cdp.eval(`(() => ({
    mode: document.body.classList.contains('board-mode'),
    on: document.getElementById('page-home').classList.contains('on'),
  }))()`);
  t('不带 ?board=1 重开 = 正常工作台（教务不会被锁在看板里）', () => {
    assert(!reopen.mode, '重开不该还在看板模式');
    assert(reopen.on, '该落在「今日」页');
    return '未进看板';
  });

  console.log('\n=== 5. 看板端不出现在三处导航，入口只在设置页 ===');
  const entry = await cdp.eval(`(() => {
    const grab = sel => [...document.querySelectorAll(sel)].map(b => b.dataset.id);
    App.drawer(true);
    const out = { nav: grab('#nav button'), tabs: grab('#tabs button'), dgrid: grab('#dgrid button') };
    App.drawer(false);
    App.go('settings');
    const card = document.getElementById('boardCard');
    return { ...out, cardShown: card && getComputedStyle(card).display !== 'none',
             btn: card ? card.querySelector('button').textContent.trim() : '',
             tip: document.getElementById('boardTip').textContent.trim() };
  })()`);
  t('侧栏 / 底栏 / 全部功能抽屉 里都没有 board', () => {
    ['nav', 'tabs', 'dgrid'].forEach(k => assert(!entry[k].includes('board'), k + ' 里出现了 board：' + entry[k].join(',')));
    return 'nav ' + entry.nav.length + ' 项 / tabs ' + entry.tabs.length + ' 项 / drawer ' + entry.dgrid.length + ' 项';
  });
  t('设置页有「看板端」入口卡，卡上把 ?board=1 网址直接给出来', () => {
    assert(entry.cardShown, '教务端该看到这张卡');
    assert(entry.btn === '打开看板端', '按钮文案该是「打开看板端」，实际「' + entry.btn + '」');
    assert(/board=1/.test(entry.tip), '提示里该有带 ?board=1 的网址，实际「' + entry.tip + '」');
    return '「' + entry.tip + '」';
  });
  await cdp.eval(`document.getElementById('boardCard').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await shot(cdp, 'board-settings-card.png');

  console.log('\n=== 6. 授课老师 / 学生拿不到看板 ===');
  const roles = await cdp.eval(`(() => {
    const r = App.routes.find(x => x.id === 'board');
    return { roles: r ? r.roles : null, inNav: Object.values(App.NAV_ORDER).some(list => list.includes('board')) };
  })()`);
  t('board 这条路由只发给教务三种身份，且不在任何 NAV_ORDER 里', () => {
    assert(roles.roles && roles.roles.join(',') === 'super,admin,both', 'roles 不对：' + JSON.stringify(roles.roles));
    assert(!roles.roles.includes('teacher') && !roles.roles.includes('student'), '老师和学生不该有看板');
    assert(!roles.inNav, '不该出现在 NAV_ORDER 里');
    return 'roles=' + roles.roles.join('/');
  });

  console.log('\n=== 7. 换一台屏也铺得满、三栏不叠 ===');
  /* 这块屏要挂的可能是 55 寸电视，也可能是办公室那台老笔记本 —— 字号全走 vw/vh，
     同一套代码都得铺满。宽屏三栏并排（左课表 / 中码 / 右量化），
     窄到 900px 以下（顺手用手机打开）叠成一栏，能滚着看。 */
  /* ⚠️ 必须走 Board.enter()（会带上 board-mode），不能只 App.go('board') ——
     第 4 段退出时已经把 board-mode 摘掉了，光切页的话 .bd 会落回宽屏那条两栏网格里，
     量出来的宽度只有一半，看着像布局坏了。 */
  await cdp.eval(`Board.enter()`);
  await sleep(400);
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 800], [1024, 768], [420, 900]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
    const m = await cdp.eval(`(() => {
      const bd = document.querySelector('.bd').getBoundingClientRect();
      const cols = [...document.querySelectorAll('.bd-main > .bd-col')].map(e => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                 r: Math.round(r.right), b: Math.round(r.bottom) }; });
      /* 宽屏：三栏同一行（y 相等）、横向各占一段不压线。
         窄屏：横向位置一致、纵向依次往下。 */
      const side = cols.length === 3 && Math.abs(cols[0].y - cols[1].y) < 2 && Math.abs(cols[1].y - cols[2].y) < 2;
      const stacked = cols.length === 3 && cols[1].y >= cols[0].b - 1 && cols[2].y >= cols[1].b - 1;
      const disjoint = cols.every((c, i) => i === 0 || c.x >= cols[i - 1].r - 1);
      /* 中栏（打卡码那列）在宽屏下是**不许溢出**的：body.board-mode .main 是
         overflow:hidden，多出来的部分会被无声裁掉 —— 迟到/请假/未到那一行就这么没的
         （v42 换 logo 时把顶带撑高了 10px，底下立刻少一行，图上才看出来）。 */
      const gate = document.querySelector('.bd-gate');
      const gr = gate.getBoundingClientRect(), gcs = getComputedStyle(gate);
      const gk = [...gate.children];
      const gt = gr.top + (parseFloat(gcs.paddingTop) || 0);
      const gb = gr.bottom - (parseFloat(gcs.paddingBottom) || 0);
      const gf = gk[0].getBoundingClientRect(), gl = gk[gk.length - 1].getBoundingClientRect();
      const over = Math.round(Math.max(0, gt - gf.top) + Math.max(0, gl.bottom - gb));
      return { vw: innerWidth, vh: innerHeight, w: Math.round(bd.width), h: Math.round(bd.height),
        /* 「铺满」＝铺满**内容区**：窄屏时 .main 自己会出纵向滚动条（约 15px），
           拿 innerWidth 比会误判成「没铺满」。所以参照系取 .main 的 clientWidth。 */
        cw: document.querySelector('.main').clientWidth,
        n: cols.length, side: side, stacked: stacked, disjoint: disjoint, cols: cols,
        qr: Math.round(document.getElementById('bdQr').getBoundingClientRect().width),
        codeFs: getComputedStyle(document.getElementById('bdCode')).fontSize,
        spill: Math.max(0, Math.round(document.documentElement.scrollWidth - innerWidth)),
        gateOver: over, gateH: Math.round(gl.bottom - gf.top) };
    })()`);
    t(w + '×' + h + '：铺满整屏、三栏不叠、没有横向溢出', () => {
      assert(Math.abs(m.w - m.cw) < 2, '该铺满内容区 ' + m.cw + '，实际 ' + m.w + '（视口 ' + m.vw + '）');
      assert(m.n === 3, '该有三栏（课表 / 码 / 量化），实际 ' + m.n);
      if (m.vw <= 900) {
        assert(m.stacked, '窄屏该把三栏叠成一栏往下排，实际没叠：' + JSON.stringify(m.cols));
      } else {
        assert(m.h >= m.vh * 0.9, '宽屏该吃满高度，实际 ' + m.h + ' / ' + m.vh);
        assert(m.side, '宽屏该三栏并排，实际纵向位置不一致：' + JSON.stringify(m.cols));
        assert(m.disjoint, '三栏横向互相压线了：' + JSON.stringify(m.cols));
      }
      assert(m.qr >= 120, '二维码哪一档都该有可用尺寸，实际 ' + m.qr + 'px');
      assert(m.spill === 0, '横向溢出了 ' + m.spill + 'px');
      if (m.vw > 900) assert(m.gateOver <= 1,
        '中栏纵向溢出 ' + m.gateOver + 'px（内容 ' + m.gateH + 'px）—— 会被 overflow:hidden 裁掉底下那一行');
      return '铺满 ' + m.w + '×' + m.h + '，' + (m.vw <= 900 ? '叠成一栏' : '三栏并排')
           + '，二维码 ' + m.qr + 'px，数字码 ' + m.codeFs
           + (m.vw > 900 ? '，中栏 ' + m.gateH + 'px 不溢出' : '');
    });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await shot(cdp, 'board-1920x1080.png');

  console.log('\n=== 8. 打卡二维码（编的是那 6 位数字本身）===');
  /* 二维码里**只编那串数字**，不编网址 —— 这是用户定的：学生用的是砺蕴自带的「扫一扫」，
     编网址是绕远路（手机相机/微信扫出来是一段链接，还得从微信导进浏览器，
     多好几步，也丢了「把码摆在门上一扫就走」的意义）。
     这一节验到**屏幕像素**这一层：把那块像素截下来交给真解码器读，
     读回来必须正是屏上显示的那串数字。 */
  const qr = await cdp.eval(`(() => {
    Board._code = '486205'; Board._until = Date.now() + 21000; Board.paintCode();
    const box = document.getElementById('bdQr');
    const svg = box.querySelector('svg');
    const code = (document.getElementById('bdCode').textContent || '').trim();
    const enc = QRLib.encode(Board.scanText());
    const r = box.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    return { code: code, scan: Board.scanText(), version: enc.version, mods: enc.size, vb: vb,
             bg: getComputedStyle(box).backgroundColor, w: Math.round(r.width), h: Math.round(r.height),
             pad: Math.round((vb[2] - enc.size) / 2),
             x: r.x, y: r.y };
  })()`);
  t('二维码块是纯白底（米白纸上贴一张纯白托盘，码才立得住）', () => {
    assert(qr.bg === 'rgb(255, 255, 255)', '底色该是纯白，实际 ' + qr.bg);
    return qr.bg;
  });
  t('SVG 自带 4 格静默区（少了手机直接扫不出）', () => {
    assert(qr.pad === 4, '每边该留 4 格静默区，实际 ' + qr.pad + ' 格');
    return '码 ' + qr.mods + ' 格（v' + qr.version + '）+ 每边 4 格 → viewBox ' + qr.vb[2];
  });
  t('二维码放得够大、是正方形（放中间了，就该让站远一点也扫得动）', () => {
    assert(qr.w >= 180, '边长该 ≥180px，实际 ' + qr.w);
    assert(Math.abs(qr.w - qr.h) < 2, '该是正方形，实际 ' + qr.w + '×' + qr.h);
    /* 用户这一轮点名的就是「二维码稍稍有点小了，给放大一点」—— 这里守个下限：
       至少占视口高的三成，别又缩回去。 */
    assert(qr.w >= 1080 * 0.3, '该够大（≥视口高的 3 成 ≈324px），实际 ' + qr.w + 'px');
    return qr.w + '×' + qr.h + '（约 ' + (qr.w / (qr.mods + 8)).toFixed(1) + 'px 一格）';
  });
  t('二维码里编的是那 6 位数字本身，不是网址（学生用砺蕴自带扫一扫）', () => {
    assert(qr.code.length === 6, '屏上该是 6 位码，实际「' + qr.code + '」');
    assert(qr.scan === qr.code, '编进去的该就是屏上那串数字，实际 scanText()=「' + qr.scan + '」/ 屏上「' + qr.code + '」');
    assert(/^\d{6}$/.test(qr.scan), '该是 6 位纯数字，实际「' + qr.scan + '」');
    ['http', '://', '?code=', 'liyun'].forEach(s =>
      assert(!qr.scan.includes(s), '不该编网址（含「' + s + '」）：' + qr.scan));
    return '编的是「' + qr.scan + '」（二维码与数字码是同一枚）';
  });
  await shot(cdp, 'board-qr.png', { x: qr.x, y: qr.y, width: qr.w, height: qr.h, scale: 1 });
  const dec = qrDecode(path.join(OUT, 'board-qr.png'));
  t('屏幕上的二维码能被真解码器读回那串数字（截屏 → OpenCV 解码）', () => {
    assert(dec.ok, '解码器没读出来' + (dec.err ? '（' + dec.err + '）' : '') + '，输出「' + dec.text + '」');
    assert(dec.text === qr.code, '读出来是「' + dec.text + '」，期望「' + qr.code + '」');
    return dec.text;
  });
  /* paintCode() 每秒都被 tick() 叫一次，重编码一次要跑 8 张掩码的评分。
     dataset.code 那道闸要是漏了，这块常开的屏就在白烧 CPU。 */
  const redraw = await cdp.eval(`(() => {
    const a = document.querySelector('#bdQr svg');
    Board.paintCode(); Board.paintCode();
    return { same: a === document.querySelector('#bdQr svg'), n: document.querySelectorAll('#bdQr svg').length };
  })()`);
  t('同一枚码不重画（每秒都调 paintCode，也不能每秒重编码）', () => {
    assert(redraw.same, '同一枚码下把二维码重画了 —— dataset.code 那道闸没拦住');
    assert(redraw.n === 1, '二维码块里不该堆出多张 svg，实际 ' + redraw.n + ' 张');
    return '连调两次 paintCode，svg 节点没换';
  });

  console.log('\n=== 9. 学生扫面前的二维码 → 扫到即打完（扫码与手输二选一）===');
  /* 二维码里编的只是数字，所以扫码这条路**完全发生在砺蕴内部**：
     学生打开打卡页 → 点「扫面前的二维码」→ 对着屏一照 → 当场打完。
     全程不经过微信、不用把网址从聊天窗导进浏览器 —— 这正是用户要这条路的原因。

     ⚠️ 用户报过一个「扫完还要再输一遍」的毛病，根子在这：
        以前路口同时摆着输入框和「扫一扫」，onScan 只把码存进 _scanned 不落 DOM，
        紧接着调 confirm() 却只读输入框 → 读到空 → 弹「输一下讲台上那个码」。
        现在两处都改了：路口一次只摆一条（扫码 or 手输），confirm() 优先认 _scanned。
     这条必须真跑一遍：另开一台「学生手机」。 */
  const stuAcc = { user: '扫描测试员', pass: 'scanpass123' };
  const made = await cdp.eval(`(async () => {
    const cls = Store.upsert('classes', { id: null, name: '扫描测试班' });
    const st = Store.upsert('students', { id: null, name: '扫描测试员', classId: cls.id, ord: 1 });
    await Sync.push();
    const r = await Auth.call('users', { op: 'create', user: '扫描测试员', name: '扫描测试员',
      role: 'student', pass: 'scanpass123', studentId: st.id });
    return { cls: cls.id, sid: st.id, note: JSON.stringify(r).slice(0, 80) };
  })()`);
  t('教务建好一个学生账号（专供扫码那条路验）', () => {
    assert(!!made.sid, '学生没建出来：' + made.note);
    return '班 ' + made.cls + ' / 学员 ' + made.sid;
  });

  const DBG2 = PORT + 3;
  const profile2 = await mkdtemp(path.join(tmpdir(), 'board-stu-'));
  const chrome2 = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG2}`, `--user-data-dir=${profile2}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome2);
  const tgt2 = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG2}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: '学生端 Chrome', tries: 40 });
  const stu = await Cdp.connect(tgt2.webSocketDebuggerUrl);
  await stu.send('Runtime.enable');
  await stu.send('Page.enable');
  await stu.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });

  /* 学生就是照常打开系统 —— 地址栏里**不需要**任何参数（编网址那条路已经删了）。
     ?nosw=1 只是免得 SW 换版重载打断登录。 */
  await go(stu, `${BASE}/?nosw=1`);
  const stuLogin = await stu.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(stuAcc.user)};
    document.getElementById('gPass').value = ${JSON.stringify(stuAcc.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { gateOff: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent,
             page: (document.querySelector('.page.on') || {}).id || '' };
  })()`);
  t('学生照常登录（地址栏里不带任何码）', () => {
    assert(stuLogin.gateOff, '学生登录失败：' + (stuLogin.err || ''));
    assert(stuLogin.page === 'page-stuHome', '学生该落在「今日」，实际「' + stuLogin.page + '」');
    return stuLogin.page;
  });

  /* 走进打卡页、定位就绪：路口**只该摆扫码一条**，输入框这时候不该出现
     （以前两条并排摆，看着就像「先扫、再输」，这正是用户说别扭的地方）。 */
  const gate = await stu.eval(`(() => {
    App.go('stuSign');
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };   /* 定位直接塞结果，不去真要权限 */
    StuSign._scanned = ''; StuSign._manual = false;
    StuSign.renderStep();
    const step = document.getElementById('stuSignStep');
    const txt = [...step.querySelectorAll('button')].map(b => b.textContent.trim());
    return { hasInput: !!document.getElementById('stuCode'),
             btns: txt,
             box: !!document.getElementById('scanBox'),
             hint: step.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) };
  })()`);
  t('打卡页默认只摆「扫面前的二维码」一条路，输入框先不出现（二选一，不并排）', () => {
    assert(!gate.hasInput, '没点「手输」之前不该出现输入框（两条并排会让人以为要先扫再输）');
    assert(gate.btns.includes('扫面前的二维码'), '该有「扫面前的二维码」这个按钮，实际：' + gate.btns.join(' / '));
    assert(gate.btns.includes('手输动态码'), '该有「手输动态码」的入口，实际：' + gate.btns.join(' / '));
    assert(!gate.box, '没点之前不该出现取景框');
    return '按钮 ' + gate.btns.join(' / ');
  });
  /* 这一张单拍「默认态」：只有「扫面前的二维码」一条路，输入框还没出来。
     终点那张（board-scan-stu.png）定格在「拒收 5 位码」的提示上，跟前因后果摆在一起
     容易让人以为是 bug —— 默认态才是这次改动的门面。
     ⚠️ 必须等一会儿再拍：`.page.on > *` 有入场动画（初态 opacity:0），
        刚 renderStep 完就截会得到一片空白；顺带等登录那句 toast 自己散掉。 */
  await stu.eval(`new Promise(r => setTimeout(r, 1400))`);
  await shot(stu, 'board-scan-default.png');
  /* 文案：用户点名要的「扫描面前的二维码」—— 别再写黑板/讲台，
     看板可能挂在走廊或办公室，学生面前那块屏才是他该看的。 */
  t('提示文案写的是「面前的二维码」，不再提黑板 / 讲台', () => {
    const all = BOARD_SRC;
    assert(/面前的二维码/.test(all), 'index.html 里该有「面前的二维码」这句');
    ['黑板上的二维码', '讲台上那个码', '讲台上/教务'].forEach(s =>
      assert(!all.includes(s), '不该再出现「' + s + '」'));
    return '提示：「' + gate.hint + '」';
  });

  /* 选「手输动态码」才出输入框 —— 而且这时是学生自己要打字，聚焦是对的行为。 */
  const manual = await stu.eval(`(() => {
    StuSign.manual(true);
    const inp = document.getElementById('stuCode');
    const step = document.getElementById('stuSignStep');
    return { hasInput: !!inp, focused: inp ? document.activeElement === inp : null,
             maxlen: inp ? inp.maxLength : 0, ph: inp ? inp.placeholder : '',
             btns: [...step.querySelectorAll('button')].map(b => b.textContent.trim()) };
  })()`);
  t('点「手输动态码」才出输入框：限 6 位、给到焦点（这时弹键盘正是他要的）', () => {
    assert(manual.hasInput, '选了手输该出输入框');
    assert(manual.maxlen === 6, '输入框该限 6 位（码就是 6 位），实际 ' + manual.maxlen);
    assert(manual.focused === true, '自己点进来手输，该把焦点给上去');
    assert(manual.btns.includes('改用扫码'), '手输这条路该留一个「改用扫码」的回退，实际：' + manual.btns.join(' / '));
    return '限 ' + manual.maxlen + ' 位 · placeholder「' + manual.ph + '」· 按钮 ' + manual.btns.join(' / ');
  });

  /* 仿真一次「扫到了」：定位还没拿到时先扫，码该被存下来。
     onScan 的参数就是解码器吐出来的字符串 —— 这里带脏字符，顺带守住「只留数字」。 */
  const scanned = await stu.eval(`(() => {
    StuSign._geo = null; StuSign._scanned = ''; StuSign._manual = false;
    StuSign.onScan(' 24-68 13 ');
    const a = { scanned: StuSign._scanned, cam: !!StuSign._cam, box: !!document.getElementById('scanBox'),
                manual: StuSign._manual };
    /* 定位补上之后再渲染：扫来的码该已经替他填好。
       没定位时圈下面本来就是空的（圈自己就是按钮），不用摆输入框。 */
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };
    StuSign.renderStep();
    a.shown = (document.getElementById('stuCode') || {}).value;
    StuSign._geo = null; StuSign._manual = false;
    /* 位数不对的（扫到了屏幕上别的东西）该被挡回去，不截断、不猜 */
    StuSign._scanned = '';
    StuSign.onScan('12345');
    const b = { scanned: StuSign._scanned };
    StuSign.onScan('12345678');
    const c = { scanned: StuSign._scanned };
    return { a: a, b: b, c: c };
  })()`);
  t('扫到码只留数字存下来，取景窗当场关掉（摄像头指示灯不许一直亮）', () => {
    assert(scanned.a.scanned === '246813', '该存下 246813（滤掉空格和横杠），实际「' + scanned.a.scanned + '」');
    assert(!scanned.a.cam && !scanned.a.box, '扫完该把取景窗和摄像头一起收掉');
    assert(scanned.a.manual === true, '还没定位就扫到了，该把手输那条路摆出来让他看见码已进去');
    assert(scanned.a.shown === '246813', '定位补上之后，码该已经替他填好，实际「' + scanned.a.shown + '」');
    assert(scanned.b.scanned === '', '5 位的码该被挡回去（不猜、不补零），实际「' + scanned.b.scanned + '」');
    assert(scanned.c.scanned === '', '8 位的码也该被挡回去（不截断），实际「' + scanned.c.scanned + '」');
    return '「 24-68 13 」→ ' + scanned.a.scanned + ' · 5 位 / 8 位都拒收';
  });

  /* ⚠️ 用户报的那条：扫完还得再输一遍。
     病根是 confirm() 只读输入框，而扫到码时输入框可能压根没渲染。
     这里把 doSign 换成探针，**故意不让输入框存在**，走 _scanned 这条路提交。 */
  const noRetype = await stu.eval(`(async () => {
    const orig = StuSign.doSign;
    let got = null;
    StuSign.doSign = function(p){ got = p; };
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };
    StuSign._scanned = '246813';
    StuSign._manual = false;
    StuSign.renderStep();                       /* 走扫码那条路：此刻页面上没有 stuCode */
    const hadInput = !!document.getElementById('stuCode');
    const toasts = [];
    const origToast = UI.toast; UI.toast = m => toasts.push(String(m));
    StuSign.confirm();
    UI.toast = origToast;
    StuSign.doSign = orig;
    return { hadInput: hadInput, code: got && got.code, geo: got && got.lat != null, toasts: toasts };
  })()`);
  t('扫到码之后直接提交，不会再要人「输一下码」（用户报的那个坑）', () => {
    assert(!noRetype.hadInput, '这一趟故意走扫码那条路：页面上本来就没有输入框');
    assert(noRetype.code === '246813', '提交上去的该是扫来的 246813，实际 ' + JSON.stringify(noRetype.code));
    assert(noRetype.geo, '定位也该一起带上去');
    assert(!noRetype.toasts.some(m => /输一下|输.*码/.test(m)), '不该再弹「输一下码」，实际弹了：' + noRetype.toasts.join(' / '));
    return '无输入框 + _scanned=246813 → 直接提交 code=246813，一次提示都没弹';
  });

  /* 定位已经就绪时扫到码，该**直接提交** —— 扫完还要再按一下圈，那这趟就白扫了。
     confirm() 换成探针，不然会真去提交打卡。 */
  const auto = await stu.eval(`(() => {
    const orig = StuSign.confirm;
    let hit = 0;
    StuSign.confirm = function(){ hit++; };
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };
    StuSign._scanned = '';
    StuSign.onScan('135790');
    StuSign.confirm = orig;
    return { hit: hit, scanned: StuSign._scanned, cam: !!StuSign._cam, box: !!document.getElementById('scanBox') };
  })()`);
  t('定位已就绪时扫到码直接提交，不用再按一下圈', () => {
    assert(auto.hit === 1, '该当场调 confirm() 一次，实际 ' + auto.hit + ' 次');
    assert(auto.scanned === '135790', '提交前该把码存好，实际「' + auto.scanned + '」');
    assert(!auto.cam && !auto.box, '提交的同时该把取景窗收掉');
    return 'onScan → confirm() ×1';
  });

  /* 取景窗的关法：stream 的每个 track 都要 stop、取景框要从 DOM 里摘掉、重复调不报错。
     拿一个假的 stream 进来量 —— 无头浏览器里开不了真摄像头。 */
  const cleanup = await stu.eval(`(() => {
    let stopped = 0;
    StuSign._cam = { stop: false, stream: { getTracks: () => [{ stop(){ stopped++; } }, { stop(){ stopped++; } }] },
                     timer: setTimeout(() => {}, 100000), cv: null };
    const box = document.createElement('div'); box.id = 'scanBox'; document.body.appendChild(box);
    StuSign.stopScan();
    const first = { stopped: stopped, box: !!document.getElementById('scanBox'), cam: StuSign._cam };
    let threw = '';
    try { StuSign.stopScan(); StuSign.stopScan(); } catch (e) { threw = e.message; }
    return { first: first, threw: threw };
  })()`);
  t('关取景窗：每条视频轨都 stop、框子摘掉、重复调也不报错', () => {
    assert(cleanup.first.stopped === 2, '两条轨道都该 stop，实际 ' + cleanup.first.stopped + ' 条');
    assert(!cleanup.first.box, '取景框该从 DOM 里摘掉');
    assert(!cleanup.first.cam, '_cam 该清空');
    assert(!cleanup.threw, '重复调不该报错：' + cleanup.threw);
    return '轨道 stop ×2，框子已摘，再调两次无异常';
  });

  /* 切页也要关 —— 学生扫到一半切走，摄像头不能留在那儿开着。 */
  const leave = await stu.eval(`(async () => {
    let stopped = 0;
    StuSign._cam = { stop: false, stream: { getTracks: () => [{ stop(){ stopped++; } }] }, timer: null, cv: null };
    const box = document.createElement('div'); box.id = 'scanBox'; document.body.appendChild(box);
    App.go('stuHome');
    await new Promise(r => setTimeout(r, 300));
    const out = { stopped: stopped, box: !!document.getElementById('scanBox'), cam: !!StuSign._cam };
    App.go('stuSign');
    StuSign._scanned = '';
    return out;
  })()`);
  t('从打卡页切走时自动收掉取景窗（学生扫到一半走了也不留摄像头）', () => {
    assert(leave.stopped === 1, '切页该把轨道 stop，实际 ' + leave.stopped);
    assert(!leave.box, '切页后取景框该没了');
    assert(!leave.cam, '切页后 _cam 该清空');
    return 'App.go("stuHome") → 轨道 stop、框子摘掉';
  });
  await stu.eval(`StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 }; StuSign._scanned = '246813'; StuSign._manual = true; StuSign.renderStep();`);
  await sleep(300);
  await shot(stu, 'board-scan-stu.png');

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
