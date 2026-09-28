/**
 * 看板端（副屏）核对（真 Chrome · 横屏 1600×900）
 *
 *   node test/board_check.mjs        # 截图落到 test/.shots/board/
 *
 * 纸色版（v38）：宣纸米白 + 三栏（左课表 / 中打卡码 / 右量化与未到），栏间只走一条细线，不用卡片。
 *
 * 核这几件事：
 *   1. 网址带 ?board=1 → 开机/刷新直接落在看板上（桌面快捷方式走的就是这条路）
 *   2. 落上去之后侧栏 / 顶栏 / 底栏全隐，屏上只剩数字；底是米白不是正白
 *   3. 应到 / 实到 两个大数算得对，迟到·请假·未到 收成一行小字 —— 含「请假不算未到」这条口径
 *   4. 时钟在走、打卡码画得出来，二维码**放中间且够大**，编的是那串数字本身（不是网址）
 *   5. 班级量化榜最多 5 格、按分数从高到低（真造 7 个班来验上限）
 *   6. 退出按钮能回工作台，而且**不带参数重开不会再掉进看板**（_lastPage 没被污染）
 *   7. 三处导航里都找不到「看板端」，入口只在设置页那张卡
 *   8. 五档屏宽都铺得满（宽屏三栏并排、≤900px 叠成一栏），没有横向溢出
 *   9. 学生用砺蕴自带的「扫一扫」扫那块码 → 只留数字、填进输入框、不抢焦点，
 *      定位就绪时直接提交；取景窗在扫完 / 切页 / 重复调时都收得干净
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
    return { cls: cls.id, n: Store.list('students').filter(s => s.classId === cls.id).length };
  })()`);
  t('造好一份数据（40 人：26 正常 / 4 迟到 / 3 请假 / 7 未到）', () => {
    assert(seeded.n === 40, '该有 40 个学生，实际 ' + seeded.n);
    return '班 ' + seeded.cls + ' / 40 人';
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

  /* 打卡码：预览服务没实现取码接口，这里直接灌一发值验渲染链路
     （固定码与派生码两种形态都过一遍） */
  const code = await cdp.eval(`(() => {
    Board._fixed = true; Board._code = '8866'; Board._until = 0; Board.paintCode();
    const fixed = { txt: document.getElementById('bdCode').textContent, hint: document.getElementById('bdCodeHint').textContent };
    Board._fixed = false; Board._code = '3172'; Board._until = Date.now() + 30000; Board.paintCode();
    const live = { txt: document.getElementById('bdCode').textContent, bar: document.getElementById('bdBar').style.width, hint: document.getElementById('bdCodeHint').textContent };
    return { fixed, live };
  })()`);
  t('打卡码画得出来：固定码写明不变，派生码带倒计时进度', () => {
    assert(code.fixed.txt === '8866', '固定码该显示 8866，实际 ' + code.fixed.txt);
    assert(/固定码/.test(code.fixed.hint), '固定码该有说明，实际「' + code.fixed.hint + '」');
    assert(code.live.txt === '3172', '派生码该显示 3172，实际 ' + code.live.txt);
    assert(/秒自动换码/.test(code.live.hint), '派生码该带倒计时，实际「' + code.live.hint + '」');
    return '固定码「' + code.fixed.hint + '」/ 派生码「' + code.live.hint + '」进度 ' + code.live.bar;
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
     顺带守住它用的是「章不带米黄底」的那一版（brand-lock.png 贴在米白纸上会露淡黄方块）。 */
  const brand = await cdp.eval(`(() => {
    const img = document.querySelector('.bd-lock');
    if (!img) return { err: '顶带里没有品牌标' };
    const r = img.getBoundingClientRect(), top = document.querySelector('.bd-top').getBoundingClientRect();
    return { src: img.currentSrc || img.src, complete: img.complete,
             nw: img.naturalWidth, nh: img.naturalHeight,
             w: Math.round(r.width), h: Math.round(r.height),
             inTop: r.top >= top.top - 1 && r.bottom <= top.bottom + 1,
             scheme: getComputedStyle(document.documentElement).colorScheme };
  })()`);
  t('顶带有博艺的品牌标，图真加载出来了（不是空白占位）', () => {
    assert(!brand.err, brand.err);
    assert(brand.complete && brand.nw > 0, '图没加载出来：' + JSON.stringify(brand));
    assert(/brand-lock-alpha/.test(brand.src), '该用透明底那版（米白纸上不露黄块），实际 ' + brand.src);
    assert(brand.inTop, '标该在顶带里，实际位置 ' + JSON.stringify(brand));
    assert(brand.w >= 60, '标不该小到看不清，实际 ' + brand.w + 'px 宽');
    return brand.nw + '×' + brand.nh + ' 原图 → 屏上 ' + brand.w + '×' + brand.h + 'px';
  });

  console.log('\n=== 2. 五个数算得对（含「请假不算未到」）===');
  const stats = await cdp.eval(`(() => {
    Board._fixed = true; Board._code = '8866';   /* 让屏幕好看点，后面截图用 */
    Board._data = Board.collect(Util.today());
    Board.paint();
    return {
      d: Board._data,
      should: document.getElementById('bdShould').textContent,
      here: document.getElementById('bdHere').textContent,
      mini: document.getElementById('bdMini').textContent.replace(/\\s+/g, ' ').trim(),
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
    return '标题「' + stats.missTitle + '」名单 ' + all;
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
             cells: cells, lab: lab, mini: document.getElementById('bdMini').textContent.trim() };
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
  t('迟到 / 请假 / 未到 收成一行小字，未到那个数标红', () => {
    assert(/迟到\s*4/.test(tiles.mini), '该写「迟到 4」，实际「' + tiles.mini + '」');
    assert(/请假\s*3/.test(tiles.mini), '该写「请假 3」，实际「' + tiles.mini + '」');
    assert(/未到\s*7/.test(tiles.mini), '该写「未到 7」，实际「' + tiles.mini + '」');
    return tiles.mini;
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
      return { vw: innerWidth, vh: innerHeight, w: Math.round(bd.width), h: Math.round(bd.height),
        /* 「铺满」＝铺满**内容区**：窄屏时 .main 自己会出纵向滚动条（约 15px），
           拿 innerWidth 比会误判成「没铺满」。所以参照系取 .main 的 clientWidth。 */
        cw: document.querySelector('.main').clientWidth,
        n: cols.length, side: side, stacked: stacked, disjoint: disjoint, cols: cols,
        qr: Math.round(document.getElementById('bdQr').getBoundingClientRect().width),
        codeFs: getComputedStyle(document.getElementById('bdCode')).fontSize,
        spill: Math.max(0, Math.round(document.documentElement.scrollWidth - innerWidth)) };
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
      return '铺满 ' + m.w + '×' + m.h + '，' + (m.vw <= 900 ? '叠成一栏' : '三栏并排')
           + '，二维码 ' + m.qr + 'px，数字码 ' + m.codeFs;
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
    Board._fixed = true; Board._code = '8866'; Board.paintCode();
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
  t('二维码里编的是纯数字本身，不是网址（学生用砺蕴自带扫一扫）', () => {
    assert(qr.code.length >= 4, '屏上没读到码：' + JSON.stringify(qr.code));
    assert(qr.scan === qr.code, '编进去的该就是屏上那串数字，实际 scanText()=「' + qr.scan + '」/ 屏上「' + qr.code + '」');
    assert(/^\d+$/.test(qr.scan), '该是纯数字，实际「' + qr.scan + '」');
    ['http', '://', '?code=', 'liyun'].forEach(s =>
      assert(!qr.scan.includes(s), '不该编网址（含「' + s + '」）：' + qr.scan));
    return '编的是「' + qr.scan + '」';
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

  console.log('\n=== 9. 学生用砺蕴自带的「扫一扫」扫那块码 → 直接进打卡 ===');
  /* 二维码里编的只是数字，所以扫码这条路**完全发生在砺蕴内部**：
     学生打开打卡页 → 点「扫一扫」→ 对着屏上的码一照 → 码填进输入框（定位已就绪就直接提交）。
     全程不经过微信、不用把网址从聊天窗导进浏览器 —— 这正是用户要这条路的原因。
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

  /* 走到打卡页、定位就绪：这一步该长得像「一个输入框 + 一个扫一扫按钮」。 */
  const gate = await stu.eval(`(() => {
    App.go('stuSign');
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };   /* 定位直接塞结果，不去真要权限 */
    StuSign._scanned = '';
    StuSign.renderStep();
    const step = document.getElementById('stuSignStep');
    return { has: !!document.getElementById('stuCode'),
             scanBtn: [...step.querySelectorAll('button')].some(b => b.textContent.trim() === '扫一扫'),
             box: !!document.getElementById('scanBox'),
             hint: step.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) };
  })()`);
  t('打卡页摆着「扫一扫」按钮，没点之前不弹取景框（不白开摄像头）', () => {
    assert(gate.has, '该渲染出打卡码输入框');
    assert(gate.scanBtn, '该有「扫一扫」按钮，实际按钮：' + gate.hint);
    assert(!gate.box, '没点之前不该出现取景框');
    return '提示「' + gate.hint + '」';
  });

  /* 仿真一次「扫到了」：定位还没拿到时先扫，码该被存下来、滤掉非数字。
     onScan 的参数就是解码器吐出来的字符串 —— 这里换成带脏字符的形态，
     顺带把「只留数字」这条守住。 */
  const scanned = await stu.eval(`(() => {
    StuSign._geo = null; StuSign._scanned = '';
    StuSign.onScan(' 24-68 13 ');
    return { scanned: StuSign._scanned, cam: !!StuSign._cam, box: !!document.getElementById('scanBox') };
  })()`);
  t('扫到码只留数字存下来，取景窗当场关掉（摄像头指示灯不许一直亮）', () => {
    assert(scanned.scanned === '246813', '该存下 246813（滤掉空格和横杠），实际「' + scanned.scanned + '」');
    assert(!scanned.cam && !scanned.box, '扫完该把取景窗和摄像头一起收掉');
    return '「 24-68 13 」→ ' + scanned.scanned;
  });

  /* 定位到位之后再渲染：扫来的码该已经填在输入框里，而且**不抢焦点**
     （手机上一点焦点就弹键盘，把上面那个大圈盖住）。 */
  const filled = await stu.eval(`(() => {
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };
    StuSign.renderStep();
    const inp = document.getElementById('stuCode');
    return { val: inp ? inp.value : null, focused: inp ? document.activeElement === inp : null,
             hint: document.getElementById('stuSignStep').textContent.replace(/\s+/g, ' ').trim().slice(0, 60) };
  })()`);
  t('扫来的码已经填进输入框，而且不抢焦点（弹键盘会挡住打卡圈）', () => {
    assert(filled.val === '246813', '该填好 246813，实际 ' + JSON.stringify(filled.val));
    assert(filled.focused !== true, '扫来的码不该抢焦点（一聚焦就弹键盘盖住上面的圈）');
    return '输入框 = ' + filled.val + '；提示「' + filled.hint + '」';
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
  await stu.eval(`StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 }; StuSign._scanned = '246813'; StuSign.renderStep();`);
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
