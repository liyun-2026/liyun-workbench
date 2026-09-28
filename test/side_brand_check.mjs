/**
 * 侧栏门头（电脑端左上那枚白牌）核对 —— 真 Chrome
 *   node test/side_brand_check.mjs [port]
 *
 * 核这几件事：
 *   1. 门头里「融合标 / 系统名 / 端口名」**收在一条中轴**上（用户 2026-09-28 的定稿）
 *      —— 三者的水平中心都得落在牌面的水平中心上（±1px）
 *   2. 牌下那行问候语（谢一鸣老师，晚上好）也跟着走中轴，不贴着左边各说各话
 *   3. 牌面有 1px 暖金描边 + 标与字之间那条「短金线嵌金点」的分隔
 *   4. 五端都成立（教师 / 教务 / 兼岗 / 学生 / 首位），宽窄两种侧栏宽度都成立
 *   5. 落两张特写截图给人眼看
 *
 * ⚠️ 文字的水平中心要用 Range 量，不能拿元素 rect：
 *    .b-sys 上有 ::before 伪元素（那条金线），元素盒子比文字本身宽。
 * ⚠️ 必须带 ?nosw=1，否则 SW 接管后自动重载会打断 evaluate。
 *
 * 一次性账号，结束 dev-reset 清场。产物落 test/.shots/side/
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5351);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'side');
const SUPER = { user: '侧栏测试教务', pass: 'sidepass123' };

const PORTS = [
  ['super',   'role-super'],
  ['admin',   'role-admin'],
  ['both',    'role-both'],
  ['teacher', 'role-teacher'],
  ['stu',     'stu'],
];

let pass = 0, fail = 0; const fails = [];
function assert(c, m){ if (!c) throw new Error(m); }
function t(name, fn){
  try { const d = fn(); pass++; console.log('  ✅ ' + name + (d ? '  → ' + d : '')); }
  catch (e) { fail++; fails.push(name); console.log('  ❌ ' + name + '\n       ' + e.message); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
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
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); 
    return r.result.value; }
}

let server; const chromes = [];
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name, clip){
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: 2 };
  const r = await cdp.send('Page.captureScreenshot', p);
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}

/* 量门头：牌面 / 融合标 / 系统名 / 端口名 / 问候语的水平中心，
   外加边框与金线。文字中心一律走 Range（伪元素会把元素盒撑宽）。 */
const MEASURE = `(() => {
  const card = document.querySelector('.side .brand');
  if (!card) return { err: '找不到 .side .brand' };
  const R = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2 }; };
  const T = el => { if (!el) return null; const g = document.createRange(); g.selectNodeContents(el);
    const b = g.getBoundingClientRect(); return { x: b.x, w: b.width, cx: b.x + b.width / 2, text: el.textContent }; };
  const lock = card.querySelector('.brand-lock');
  const sys = card.querySelector('.b-sys');
  const port = card.querySelector('.b-port');
  const greet = document.getElementById('sideGreet');
  const cs = getComputedStyle(card);
  const brand = R(card), sysT = T(sys), portT = T(port), greetT = T(greet);
  const pre = sys ? getComputedStyle(sys, '::before') : null;
  /* 伪元素盒子：Range 摸不到，用元素盒 - 文字盒推不出，改用高度差判断它在不在 */
  return {
    card: { x: brand.x, y: brand.y, w: brand.w, h: brand.h, cx: brand.cx },
    lock: lock ? R(lock) : null,
    sys: sysT, port: portT, greet: greetT,
    align: cs.textAlign, radius: cs.borderTopLeftRadius,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
    bg: cs.backgroundColor,
    goldLine: pre ? pre.backgroundImage : '',
    preH: pre ? pre.height : '',
    greetAlign: greet ? getComputedStyle(greet).textAlign : '',
    vw: innerWidth, sideW: document.querySelector('.side') ? document.querySelector('.side').getBoundingClientRect().width : 0,
  };
})()`;

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'side-chrome-'));
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

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded;
  await sleep(700);

  const login = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { gateOff: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent, cls: document.body.className };
  })()`);
  if (!login.gateOff) throw new Error('登录失败：' + (login.err || ''));
  const REAL = login.cls;
  console.log('已登录，body.class = "' + REAL + '"（首个账号＝首位教务）\n');

  console.log('=== 1. 门头收在中轴上（1440×900，侧栏最宽那档）===');
  const m = await cdp.eval(MEASURE);
  t('融合标水平居中', () => {
    assert(m.lock, '没找到融合标');
    const off = Math.abs(m.lock.cx - m.card.cx);
    assert(off <= 1, '标心 ' + m.lock.cx.toFixed(1) + ' 与牌心 ' + m.card.cx.toFixed(1)
      + ' 差 ' + off.toFixed(1) + 'px（该 ≤1）—— 还靠在左边');
    return '标 ' + Math.round(m.lock.w) + 'px，偏 ' + off.toFixed(2) + 'px';
  });
  t('系统名（砺蕴工作系统）文字居中', () => {
    const off = Math.abs(m.sys.cx - m.card.cx);
    assert(off <= 1, '文字心 ' + m.sys.cx.toFixed(1) + ' 与牌心 ' + m.card.cx.toFixed(1)
      + ' 差 ' + off.toFixed(1) + 'px（该 ≤1）');
    assert(m.align === 'center', '牌面 text-align 该是 center，实际 ' + m.align);
    return '「' + m.sys.text + '」偏 ' + off.toFixed(2) + 'px';
  });
  t('端口名（首位教务）文字居中，且与系统名同一中轴', () => {
    const off = Math.abs(m.port.cx - m.card.cx);
    assert(off <= 1, '文字心与牌心差 ' + off.toFixed(1) + 'px（该 ≤1）');
    assert(Math.abs(m.port.cx - m.sys.cx) <= 1, '端口名与系统名不在一条竖线上（'
      + m.port.cx.toFixed(1) + ' vs ' + m.sys.cx.toFixed(1) + '）');
    return '「' + m.port.text + '」偏 ' + off.toFixed(2) + 'px，两行对齐';
  });
  t('牌下的问候语也跟着走中轴', () => {
    assert(m.greet, '没找到 #sideGreet');
    const off = Math.abs(m.greet.cx - m.card.cx);
    assert(m.greetAlign === 'center', '问候语 text-align 该是 center，实际 ' + m.greetAlign);
    assert(off <= 1.5, '问候语中心与牌心差 ' + off.toFixed(1) + 'px（该 ≤1.5）—— 还贴着左边');
    return '「' + m.greet.text + '」偏 ' + off.toFixed(2) + 'px';
  });

  console.log('\n=== 2. 牌面的描边与金线 ===');
  t('牌面有 1px 暖金描边（中式册页的做法，比投影轻）', () => {
    assert(/^1px solid/.test(m.border), '该是 1px solid，实际「' + m.border + '」');
    const rgba = ((m.border.match(/\(([^)]+)\)/) || [])[1] || '').split(',').map(Number);
    assert(rgba.length >= 3 && Math.abs(rgba[0] - 201) <= 6 && Math.abs(rgba[1] - 171) <= 6 && Math.abs(rgba[2] - 124) <= 6,
      '描边该走品牌金 rgb(201,171,124)，实际 ' + m.border);
    return m.border;
  });
  t('标与字之间有那条「短金线嵌金点」的分隔', () => {
    assert(/radial-gradient/.test(m.goldLine), '::before 该是一条金线（linear）+ 中间金点（radial），实际「'
      + m.goldLine.slice(0, 60) + '」');
    assert(parseFloat(m.preH) > 0, '分隔线高度该 >0，实际 ' + m.preH);
    return 'linear + radial 双层，高 ' + m.preH;
  });
  t('牌面还是白牌（没有跟着端口色走），圆角没被描边吃掉', () => {
    assert(m.bg !== 'rgba(0, 0, 0, 0)', '牌面该有底色，实际透明');
    assert(/^1[34]px$/.test(m.radius), '圆角该是 14px，实际 ' + m.radius);
    return m.bg + ' · 圆角 ' + m.radius;
  });

  console.log('\n=== 3. 五端都成立 ===');
  for (const [label, cls] of PORTS) {
    await cdp.eval(`document.body.className = ${JSON.stringify(cls)}; Port.syncChrome(); true`);
    await sleep(260);
    const mm = await cdp.eval(MEASURE);
    t(label + ' 端：标 / 系统名 / 端口名 / 问候语 全在一条中轴上', () => {
      assert(mm.lock && mm.sys && mm.port && mm.greet, '有元素没渲染出来：' + JSON.stringify(Object.keys(mm)));
      const offs = [mm.lock.cx, mm.sys.cx, mm.port.cx, mm.greet.cx].map(x => Math.abs(x - mm.card.cx));
      assert(Math.max(...offs) <= 1.5, '最大偏离 ' + Math.max(...offs).toFixed(1) + 'px（该 ≤1.5）'
        + ' —— 偏离明细 ' + offs.map(v => v.toFixed(1)).join(' / '));
      return '最大偏 ' + Math.max(...offs).toFixed(2) + 'px · ' + mm.sys.text + ' / ' + mm.port.text;
    });
  }
  await cdp.eval(`document.body.className = ${JSON.stringify(REAL)}; Port.syncChrome(); true`);

  console.log('\n=== 4. 窄一点的侧栏（1024×768，侧栏 200px 那档）也要居中 ===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const narrow = await cdp.eval(MEASURE);
  t('1024 宽：侧栏 ' + Math.round(narrow.sideW) + 'px，标与两行字仍然居中', () => {
    assert(Math.abs(narrow.sideW - 200) < 2 || Math.abs(narrow.sideW - 236) < 2,
      '侧栏宽该是 200 或 236，实际 ' + narrow.sideW);
    const offs = [narrow.lock.cx, narrow.sys.cx, narrow.port.cx].map(x => Math.abs(x - narrow.card.cx));
    assert(Math.max(...offs) <= 1.5, '最大偏离 ' + Math.max(...offs).toFixed(1) + 'px'
      + '（牌面只有 ' + Math.round(narrow.card.w) + 'px 宽，更容易偏心）');
    return '牌面 ' + Math.round(narrow.card.w) + '×' + Math.round(narrow.card.h)
      + 'px，最大偏 ' + Math.max(...offs).toFixed(2) + 'px';
  });
  await shot(cdp, 'side-1024.png', { x: 0, y: 0, width: 260, height: 210 });

  console.log('\n=== 5. 深色模式下也成立（这块门头跟着系统深浅色走）===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  const dark = await cdp.eval(MEASURE);
  t('深色：牌面转深底、暖金描边还在、仍在一条中轴上', () => {
    assert(dark.bg !== m.bg, '深色下牌面底色该跟着换（浅色是 ' + m.bg + '，现在还是 ' + dark.bg + '）');
    assert(/^1px solid/.test(dark.border), '深色下描边不该消失，实际「' + dark.border + '」');
    const offs = [dark.lock.cx, dark.sys.cx, dark.port.cx].map(x => Math.abs(x - dark.card.cx));
    assert(Math.max(...offs) <= 1.5, '深色下最大偏离 ' + Math.max(...offs).toFixed(1) + 'px');
    return dark.bg + ' · ' + dark.border;
  });
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await sleep(300);

  /* 给人眼看的两张特写：牌面往外各扩 6px，2x 出图 */
  await cdp.eval(`document.body.className = ${JSON.stringify(REAL)}; Port.syncChrome(); App.go('home'); true`);
  await sleep(700);
  const box = await cdp.eval(`(() => {
    const c = document.querySelector('.side .brand').getBoundingClientRect();
    const g = document.getElementById('sideGreet').getBoundingClientRect();
    return { x: Math.max(0, c.x - 8), y: Math.max(0, c.y - 8),
             right: c.right + 8, bottom: Math.max(c.bottom, g.bottom) + 10 };
  })()`);
  await shot(cdp, 'side-head.png', { x: box.x, y: box.y, width: box.right - box.x, height: box.bottom - box.y });
  await shot(cdp, 'side-page.png');

  console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' 项通过' + (fail ? '，' + fail + ' 项失败：\n   - ' + fails.join('\n   - ') : ''));
  console.log('   截图 → test/.shots/side/');
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}
