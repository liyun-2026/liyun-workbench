/**
 * 看板端（副屏）核对（真 Chrome · 横屏 1600×900）
 *
 *   node test/board_check.mjs        # 截图落到 test/.shots/board/
 *
 * 核这几件事：
 *   1. 网址带 ?board=1 → 开机/刷新直接落在看板上（Windows 桌面快捷方式走的就是这条路）
 *   2. 落上去之后侧栏 / 顶栏 / 底栏全隐，屏上只剩数字
 *   3. 五个数（应到 / 已到 / 迟到 / 请假 / 未到）算得对 —— 含「请假不算未到」这条口径
 *   4. 时钟在走、打卡码画得出来（固定码与派生码两种）
 *   5. 退出按钮能回工作台，而且**不带参数重开不会再掉进看板**（_lastPage 没被污染）
 *   6. 三处导航里都找不到「看板端」，入口只在设置页那张卡
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

  /* 航显版把时钟挪进了顶带、码留在中带 —— 判据也跟着从「左不压右」改成「上不压下」。
     两个矩形不相交仍然是要守的那条线，只是现在该守的是纵向。 */
  t('时钟在顶带、码在中带，两条带各占一层，不叠在一起', () => {
    assert(dim.clock.b <= dim.code.y + 1,
      '时钟底边 ' + dim.clock.b + ' 该在打卡码顶边 ' + dim.code.y + ' 之上（字号给大了会压下去）');
    assert(dim.clock.w > 100 && dim.code.w > 200,
      '两块都该有足够的尺寸，实际时钟 ' + dim.clock.w + ' / 码 ' + dim.code.w);
    return '时钟 ' + dim.clock.fs + '（y=' + dim.clock.y + ' 底 ' + dim.clock.b + '）→ 码 '
         + dim.code.fs + '（y=' + dim.code.y + ' 宽 ' + dim.code.w + 'px）';
  });

  console.log('\n=== 2. 五个数算得对（含「请假不算未到」）===');
  const stats = await cdp.eval(`(() => {
    Board._fixed = true; Board._code = '8866';   /* 让屏幕好看点，后面截图用 */
    Board._data = Board.collect(Util.today());
    Board.paint();
    return {
      d: Board._data,
      tiles: [...document.querySelectorAll('#bdStats .bd-stat')].map(x => x.querySelector('b').textContent + x.querySelector('span').textContent),
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
    return stats.tiles.join(' / ');
  });
  t('未到名单是「学员34~40」，三位请假的一个都没被算成欠勤', () => {
    assert(stats.miss.length === 7, '名单该 7 人，实际 ' + stats.miss.length);
    assert(stats.miss[0] === '学员34' && stats.miss[6] === '学员40', '名单该是 34~40，实际 ' + stats.miss.join('、'));
    const all = stats.miss.join('、');
    ['学员31', '学员32', '学员33'].forEach(n =>
      assert(!all.includes(n), n + ' 已经批过假，不该出现在未到名单里'));
    return '标题「' + stats.missTitle + '」名单 ' + all;
  });

  /* 五块统计只该上数字色。系统里有个通用 `.ok{background:#eafaf0}` 状态条样式，
     早先 .bd-stat.ok 被它一起吃掉 —— 「已到」那块会平白多出一片浅绿底。 */
  const tiles = await cdp.eval(`[...document.querySelectorAll('#bdStats .bd-stat')].map(e => ({
    k: e.querySelector('span').textContent, cls: e.className,
    bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e.querySelector('b')).color }))`);
  t('六块统计只有数字着色，没被系统的通用 .ok 背景污染', () => {
    assert(tiles.length === 6, '该有 6 块（5 个考勤数 + 1 个距上课），实际 ' + tiles.length);
    tiles.forEach(x => assert(x.bg === 'rgba(0, 0, 0, 0)', '「' + x.k + '」不该有底色，实际 ' + x.bg + '（类名 ' + x.cls + '）'));
    assert(tiles[1].cls === 'bd-stat bd-ok', '类名该带 bd- 前缀，实际「' + tiles[1].cls + '」');
    /* 这格的标签随时间变：还没到点是「分后上课」、正点是「正在上课」、过了是「已经上课」 */
    assert(tiles[5].cls === 'bd-stat bd-soon' && ['分后上课', '正在上课', '已经上课'].includes(tiles[5].k),
      '第 6 格该是「距上课」，实际「' + tiles[5].k + '」类名「' + tiles[5].cls + '」');
    return tiles.map(x => x.k + ' ' + x.c).join(' / ');
  });

  const paints = await cdp.eval(`[...document.querySelectorAll('#page-board *')]
    .map(e => ({ t: e.tagName + '.' + (e.className || ''), bg: getComputedStyle(e).backgroundColor }))
    .filter(x => x.bg && x.bg !== 'rgba(0, 0, 0, 0)' && x.bg !== 'transparent')
    .map(x => x.t + '→' + x.bg).slice(0, 12)`);
  console.log('     看板里带底色的元素：' + paints.join(' | '));

  /* 滚动只该在「塞不下」时开：7 个人放得下，就该老老实实不滚、而且居中摆着（.fit）；
     人一多才该复制一份上滚，而且只复制一份 —— 不能每半分钟刷新就翻一倍。 */
  const clip = await cdp.eval(`(() => {
    const rows = document.getElementById('bdMiss');
    const box = rows.parentElement;
    const panel = rows.closest('.bd-miss');
    const h3 = panel.querySelector('h3');
    const pr = panel.getBoundingClientRect(), hr = h3.getBoundingClientRect(), lr = box.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const fits = { loop: rows.classList.contains('loop'), fit: rows.classList.contains('fit'),
                   panelFit: panel.classList.contains('fit'),
                   rowsH: rows.scrollHeight, boxH: box.clientHeight,
                   /* 标题上方、名单下方各剩多少 —— 真居中就该差不多相等 */
                   above: Math.round(hr.top - (pr.top + parseFloat(cs.paddingTop))),
                   below: Math.round((pr.bottom - parseFloat(cs.paddingBottom)) - lr.bottom) };
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
  t('名单装得下就居中不滚；塞不下才复制一份上滚，且不会越滚越多', () => {
    assert(!clip.fits.loop, '7 个人在 ' + clip.fits.boxH + 'px 的面板里放得下，不该开滚动（实际高 ' + clip.fits.rowsH + '）');
    assert(clip.fits.fit, '7 个人放得下时该加 .fit 居中摆着，实际没加（内容 ' + clip.fits.rowsH + ' / 面板 ' + clip.fits.boxH + '）');
    /* ⚠️ 光看类名不够：.fit 曾经挂在 .bd-rows 上、而 .bd-rows 没有高度，
       align-content:center 是空转的 —— 类名加了，名字照样顶在上边。所以这里量几何。 */
    assert(clip.fits.panelFit, '.fit 该挂在 .bd-miss 面板上（居中要连标题一起，不是只居中名单）');
    assert(Math.abs(clip.fits.above - clip.fits.below) <= 4,
      '标题上方剩 ' + clip.fits.above + 'px、名单下方剩 ' + clip.fits.below + 'px —— 没真居中');
    assert(clip.over.loop, '260 个人该开滚动（实际内容 ' + clip.over.rowsH + ' / 面板 ' + clip.over.boxH + '）');
    assert(!clip.over.fit, '要滚了就不该再挂 .fit —— 居中和滚动一起上，上下两头都会露不出来');
    assert(clip.over.rowsH > clip.over.boxH, '复制后总高该超出面板，实际 ' + clip.over.rowsH + ' ≤ ' + clip.over.boxH);
    assert(clip.again.rowsH === clip.over.rowsH, '同一份内容重灌不该再复制（' + clip.over.rowsH + ' → ' + clip.again.rowsH + '）');
    assert(parseFloat(clip.over.dur) >= 14, '滚动时长该有个下限，实际 ' + clip.over.dur);
    return '装得下：整组居中（上 ' + clip.fits.above + ' / 下 ' + clip.fits.below + 'px，内容 '
         + clip.fits.rowsH + ' / 面板 ' + clip.fits.boxH + '）· 塞不下：高 '
         + clip.over.rowsH + 'px 上滚 ' + clip.over.dur;
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

  console.log('\n=== 7. 换一台屏也铺得满、不重叠 ===');
  /* 这块屏要挂的可能是 55 寸电视，也可能是办公室那台老笔记本 —— 字号全走 vw/vh，
     同一套代码都得铺满。窄屏（顺手用手机打开）走单列，时钟和码上下排，更不会叠。 */
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
      const ck = document.getElementById('bdClock').getBoundingClientRect();
      const cd = document.getElementById('bdCode').getBoundingClientRect();
      return { vw: innerWidth, vh: innerHeight, w: Math.round(bd.width), h: Math.round(bd.height),
        overlap: ck.right > cd.left + 1 && !(ck.bottom < cd.top || cd.bottom < ck.top),
        ckFs: getComputedStyle(document.getElementById('bdClock')).fontSize,
        cdFs: getComputedStyle(document.getElementById('bdCode')).fontSize,
        spill: Math.max(0, Math.round(document.documentElement.scrollWidth - innerWidth)) };
    })()`);
    t(w + '×' + h + '：铺满整屏、时钟与码不重叠、没有横向溢出', () => {
      assert(Math.abs(m.w - m.vw) < 2, '该满宽 ' + m.vw + '，实际 ' + m.w);
      assert(m.vw <= 760 || m.h >= m.vh * 0.9, '该吃满高度，实际 ' + m.h + ' / ' + m.vh);
      assert(!m.overlap, '时钟和码叠在一起了（时钟 ' + m.ckFs + ' / 码 ' + m.cdFs + '）');
      assert(m.spill === 0, '横向溢出了 ' + m.spill + 'px');
      return '铺满 ' + m.w + '×' + m.h + '，时钟 ' + m.ckFs + ' / 码 ' + m.cdFs;
    });
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await shot(cdp, 'board-1920x1080.png');

  console.log('\n=== 8. 打卡二维码（数字码上面那一块）===');
  /* 二维码是这次新加的「第二条路」：学生扫一下就直接落进打卡页、码已填好，
     不必凑到屏前抄 6 位数字。这一节验到**屏幕像素**这一层 —— 把那块像素截下来
     交给真解码器读，读回来必须正是这一秒显示的那条链接。 */
  const qr = await cdp.eval(`(() => {
    const box = document.getElementById('bdQr');
    const svg = box.querySelector('svg');
    const code = (document.getElementById('bdCode').textContent || '').trim();
    const link = Board.scanLink();
    const enc = QRLib.encode(link);
    const r = box.getBoundingClientRect();
    const vb = (svg.getAttribute('viewBox') || '').split(' ').map(Number);
    return { code: code, link: link, version: enc.version, mods: enc.size, vb: vb,
             bg: getComputedStyle(box).backgroundColor, w: Math.round(r.width), h: Math.round(r.height),
             pad: Math.round((vb[2] - enc.size) / 2),
             x: r.x, y: r.y };
  })()`);
  t('二维码块是纯白底（深墨底上反色二维码，手机多半认不出）', () => {
    assert(qr.bg === 'rgb(255, 255, 255)', '底色该是纯白，实际 ' + qr.bg);
    return qr.bg;
  });
  t('SVG 自带 4 格静默区（少了手机直接扫不出）', () => {
    assert(qr.pad === 4, '每边该留 4 格静默区，实际 ' + qr.pad + ' 格');
    return '码 ' + qr.mods + ' 格（v' + qr.version + '）+ 每边 4 格 → viewBox ' + qr.vb[2];
  });
  t('二维码画得够大、是正方形（站在门口也扫得动）', () => {
    assert(qr.w >= 180, '边长该 ≥180px，实际 ' + qr.w);
    assert(Math.abs(qr.w - qr.h) < 2, '该是正方形，实际 ' + qr.w + '×' + qr.h);
    return qr.w + '×' + qr.h + '（约 ' + (qr.w / (qr.mods + 8)).toFixed(1) + 'px 一格）';
  });
  t('二维码编的是本站 ?code= 链接，跟屏上那串数字一致', () => {
    assert(qr.code.length >= 4, '屏上没读到码：' + JSON.stringify(qr.code));
    const want = BASE + '/?code=' + qr.code;
    assert(qr.link === want, '链接不对：' + qr.link + '（期望 ' + want + '）');
    return qr.link;
  });
  await shot(cdp, 'board-qr.png', { x: qr.x, y: qr.y, width: qr.w, height: qr.h, scale: 1 });
  const dec = qrDecode(path.join(OUT, 'board-qr.png'));
  t('屏幕上的二维码能被真解码器读回那条链接（截屏 → OpenCV 解码）', () => {
    assert(dec.ok, '解码器没读出来' + (dec.err ? '（' + dec.err + '）' : '') + '，输出「' + dec.text + '」');
    assert(dec.text === qr.link, '读出来是「' + dec.text + '」，期望「' + qr.link + '」');
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

  console.log('\n=== 9. 学生扫这条链接 → 落在打卡页、码已填好 ===');
  /* 二维码要是不落进打卡页、或者码没替他填上，那它就只是个装饰。
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

  /* 扫的就是屏幕那块二维码里编的那条链接（带上 ?nosw=1 免得 SW 换版重载打断登录） */
  await go(stu, `${BASE}/?nosw=1&code=${qr.code}`);
  const caught = await stu.eval(`({ saved: Store.get('_scanCode') || '', search: location.search })`);
  t('扫码进来当场收下码，并把它从地址栏抹掉（不留在历史里、不当普通链接转发）', () => {
    assert(caught.saved === qr.code, '该存下 ' + qr.code + '，实际「' + caught.saved + '」');
    assert(caught.search.indexOf('code=') < 0, '地址栏里的码该被抹掉，实际 ' + caught.search);
    return '存下 ' + caught.saved + '；location.search = "' + caught.search + '"';
  });

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
  t('学生登录后直接落在打卡页（不走「上次停在哪」）', () => {
    assert(stuLogin.gateOff, '学生登录失败：' + (stuLogin.err || ''));
    assert(stuLogin.page === 'page-stuSign', '该落在 page-stuSign，实际「' + stuLogin.page + '」');
    return stuLogin.page;
  });

  const filled = await stu.eval(`(() => {
    /* 定位直接塞结果，不去真要权限 —— 这一趟只验「码有没有替他填上」 */
    StuSign._geo = { lat: 34.75, lng: 113.62, acc: 12 };
    StuSign.renderStep();
    const inp = document.getElementById('stuCode');
    const step = document.getElementById('stuSignStep');
    return { val: inp ? inp.value : null, has: !!inp,
             focused: inp ? document.activeElement === inp : null,
             hint: step ? step.textContent.replace(/\\s+/g, ' ').trim().slice(0, 46) : '' };
  })()`);
  t('输入框已经填好扫来的码，而且不抢焦点（手机上弹键盘会挡住打卡圈）', () => {
    assert(filled.has, '没渲染出打卡码输入框：' + JSON.stringify(filled));
    assert(filled.val === qr.code, '该填好 ' + qr.code + '，实际 ' + JSON.stringify(filled.val));
    assert(filled.focused !== true, '扫来的码不该抢焦点（会弹键盘盖住上面的圈）');
    return '输入框 = ' + filled.val + '；提示「' + filled.hint + '」';
  });
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
