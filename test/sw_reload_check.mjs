/**
 * 换版时机核对（Service Worker 更新）· 真 Chrome
 *
 *   node test/sw_reload_check.mjs        # 端口默认 5339（调试口 5341）
 *
 * 背景：2026-09-29 用户问「桌面上的砺蕴系统，我怎么见没有更新呢？」。
 * 查下来线上与本机缓存都已是新版（本机 SW CacheStorage 里 index.html 与三档
 * brand-plate 都已是当时最新内容），问题是**换版永远赶不上**：
 * 这壳子在境外节点，新 SW 装完要下 index.html(644KB) 外加十几个资源（含三档
 * brand-plate 共 670KB），跨境实测 5~10 秒；而页面端的老规矩是「只在开屏层
 * 还盖着时才静默换版」，开屏只有 1.2 秒 + 0.55 秒淡出 —— controllerchange 回来
 * 时开屏早收了，于是发版后第一次打开必然是旧版，得关掉再开一次才变新的；
 * 看板那块 24 小时常亮的屏更是永远换不了（它从不重开）。
 *
 * 现在放宽成三种「用户还没开始用」的情况都换：
 *   ① 开屏期  ② 打开 30 秒内用户一次都没碰过  ③ 看板屏(board-mode)空闲 2 分钟
 * 用户一旦动过手（点/按/滚/输入）就一律不换，留到下次打开自然生效。
 *
 * 核这几件事：
 *   1. 首次安装（页面加载时还没有 SW 在管）→ 不重载（本来就要从网上取一次）
 *   2. 有 SW 在管 + 用户没动过手 → 收到换版通知就重载（覆盖 ①② 两条）
 *   3. 用户动过手 → **不**重载（不能把正在填的表单/正在看的页刷掉）
 *   4. 本会话已经换过一次 → 不再换第二次（挡「一进站跳两三次开场动画」）
 *   5. ③ 那条岔路与「常亮屏 20 分钟自检」：源码级判据（真机不好把时钟拨快两分钟）
 *   6. v46 开屏时长与「把换版吃进开屏期」：源码级判据（这套时序只能读代码核）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5339);
const DBG = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* 源码原文：③ 那条岔路和 20 分钟自检在真机上不好验（得把时钟拨快两分钟），
   直接看代码。当场读盘，不另抄一份 —— 抄的那份会过期。 */
const SRC = await readFile(path.join(dir, 'index.html'), 'utf8');
const FLAT = SRC.replace(/\s+/g, ' ');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(5000) });
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
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
  on(method, fn){ const set = this.events.get(method) || new Set(); set.add(fn); this.events.set(method, set); }
  async eval(expr, timeout = 30000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server; let chrome;
const pass = [], fail = [];
const t = (name, fn) => {
  try { const v = fn(); pass.push(name); console.log('  ✅ ' + name + (v !== undefined && v !== true ? '  → ' + v : '')); }
  catch (e) { fail.push(name + ' → ' + e.message); console.log('  ❌ ' + name + ' → ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}',
  })).ok, { what: '预览服务', tries: 40 });
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'swreload-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });

  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  /* 数文档加载次数：加载 +1。重载发生了，这个数就会涨。 */
  let loads = 0;
  cdp.on('Page.loadEventFired', () => { loads++; });

  async function go(url){
    const p = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await p;
    await sleep(450);
  }
  /* 页面端 `_onShellReady` 就是挂在这个事件上的 —— 真事假事它分不出来，
     所以拿一次手动派发就等于「新 SW 接管了」。 */
  const fireShell = () => cdp.eval(`(navigator.serviceWorker.dispatchEvent(new Event('controllerchange')), true)`);
  async function reloaded(before, ms = 1800){
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (loads > before) return true; await sleep(100); }
    return false;
  }

  console.log('\n=== 1. 首次安装：不该重载 ===');
  await go(`${BASE}/`);
  await waitFor(async () => await cdp.eval(`!!navigator.serviceWorker.controller`), { what: 'SW 接管本页', tries: 40 });
  const hadCtl = await cdp.eval(`!!navigator.serviceWorker.controller`);
  assert(hadCtl, 'SW 没接管，后面几条就都没意义了');
  {
    const before = loads;
    await fireShell();
    const r = await reloaded(before);
    t('首次安装（加载时还没有 SW 在管）→ 不重载', () => {
      assert(!r, '首次安装也重载了 —— 白跑一趟，还多播一遍开屏动画');
      return '没重载';
    });
  }

  console.log('\n=== 2. 用户没动过手：该重载 ===');
  await cdp.eval(`(sessionStorage.clear(), true)`);
  await go(`${BASE}/?case=2`);
  const ctl2 = await cdp.eval(`!!navigator.serviceWorker.controller`);
  assert(ctl2, '第二趟加载时 SW 没在管（缓存没生效）');
  const touched2 = await cdp.eval(`!!window._swReloading`);
  assert(!touched2, '这一趟一进来就重载了 —— 会变成连跳');
  {
    const before = loads;
    await fireShell();
    const r = await reloaded(before);
    t('有 SW 在管 + 用户没动过手 → 收到换版通知就重载', () => {
      assert(r, '没重载 —— 用户又会看到「怎么没更新」，得关掉再开一次');
      return '重载了';
    });
  }

  console.log('\n=== 3. 用户动过手：不该重载 ===');
  await cdp.eval(`(sessionStorage.clear(), true)`);
  await go(`${BASE}/?case=3`);
  /* ⚠️ 必须**真等到开屏收掉**再动手。开屏 v46 起保底 2.4s + 淡出 0.7s，
     用固定 sleep 会赶在开屏还盖着的时候派发事件 —— 那时走的是「开屏期」分支，
     而那条分支本来就该换版，这条用例就白测了（改前是 sleep(1300)，开屏一拉长当场失效）。 */
  await waitFor(async () => await cdp.eval(`!document.getElementById('splash')`),
    { what: '开屏收掉', tries: 40, gap: 300 });
  await cdp.eval(`(window.dispatchEvent(new Event('pointerdown', { bubbles: true })), true)`);
  {
    const before = loads;
    await fireShell();
    const r = await reloaded(before);
    t('用户动过手（点了/滚了/输入了）→ 不重载，留到下次打开', () => {
      assert(!r, '用户正在用也把页面刷了 —— 会丢掉填了一半的表单');
      return '没重载';
    });
  }

  console.log('\n=== 4. 本会话已经换过一次：不该再换 ===');
  await cdp.eval(`(sessionStorage.clear(), true)`);
  await go(`${BASE}/?case=4`);
  await cdp.eval(`(sessionStorage.setItem('liyun_sw_reloaded', '1'), true)`);
  {
    const before = loads;
    await fireShell();
    const r = await reloaded(before);
    t('本会话已换过一次 → 不再换第二次（挡「一进站跳两三次」）', () => {
      assert(!r, '挡不住第二次 —— 开场动画会连跳');
      return '没重载';
    });
  }

  console.log('\n=== 5. 看板空闲自动换版 + 常亮自检：源码判据 ===');
  t('③ 看板屏空闲那条岔路在（board-mode + 不在输入框 + 空闲够久）', () => {
    assert(/if \(_boardMode\(\) && !_editingNow\(\) && Date\.now\(\) - _lastAct > IDLE_GAP\) return true;/.test(FLAT),
      '源码里找不到看板空闲换版那条判断 —— 常亮的看板屏就永远换不了版');
    assert(/const IDLE_GAP = 120000;/.test(FLAT), 'IDLE_GAP 不是 2 分钟');
    return '在';
  });
  t('常亮屏每 20 分钟主动问一次有没有新版', () => {
    assert(/const CHECK_EVERY = 20 \* 60 \* 1000;/.test(FLAT), '自检间隔不是 20 分钟');
    assert(/reg\.update\(\)/.test(FLAT), '没有调 registration.update() —— 浏览器只在导航时才会去问 sw.js');
    assert(/if \(document\.hidden\) return;/.test(FLAT), '后台标签页没跳过，白耗电');
    return '在';
  });
  t('「用户动过手」的交互清单齐全（点/按/触/滚/输入/聚焦）', () => {
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input', 'scroll', 'focusin'])
      assert(SRC.includes(`'${ev}'`), '少了 ' + ev + ' —— 那种操作就不算「动过手」了');
    return 7 + ' 种';
  });
  t('开屏期这条老规矩还在（换来的是一整段连续入场动画）', () => {
    assert(/if \(_splashStillUp\(\)\) return true;/.test(FLAT), '开屏期分支没了');
    return '在';
  });
  t('打开 30 秒内未交互也算「还没开始用」', () => {
    assert(/const OPEN_GRACE = 30000;/.test(FLAT), 'OPEN_GRACE 不是 30 秒');
    assert(/if \(!_touched && Date\.now\(\) - _openedAt < OPEN_GRACE\) return true;/.test(FLAT), '少判断了「没动过手」');
    return '在';
  });

  /* ── v46：开屏拉长 + 把换版吃进开屏期（用户：「把开屏动画拉到两秒多」） ── */
  console.log('\n=== 6. 开屏时长把换版吃进去：源码判据 ===');
  const sm = /const SPLASH_MIN = (\d+), SPLASH_MAX = (\d+), FADE_OUT = (\d+);/.exec(FLAT);
  const splashMin = sm && +sm[1], splashMax = sm && +sm[2], fadeOut = sm && +sm[3];
  /* 各处动画的真实收束时刻（负延迟＝提前开始，正延迟＝往后挪） */
  const ringDraw = /s-ring-draw (\d+(?:\.\d+)?)s var\(--ease\) -([\d.]+)s/.exec(FLAT);
  const lockIn = /s-lock-in (\d+(?:\.\d+)?)s var\(--ease\) ([\d.]+)s/.exec(FLAT);
  const boardIn = /s-board-in (\d+(?:\.\d+)?)s var\(--ease\) both/.exec(FLAT);
  t('开屏保底 ≥2 秒（用户要求「拉到两秒多」，不是一闪而过）', () => {
    assert(sm, '源码里找不到 SPLASH_MIN/SPLASH_MAX/FADE_OUT —— 开屏时长没人管了');
    assert(splashMin >= 2000, `SPLASH_MIN 只有 ${splashMin}ms —— 又变回一闪而过`);
    return splashMin + 'ms';
  });
  t('整套动画都在保底时长内演完（否则等于白画）', () => {
    assert(ringDraw && lockIn && boardIn, 'CSS 里的开屏动画名改了？解析不到 s-ring-draw / s-lock-in / s-board-in');
    const fin = [
      ['金环描绘', +ringDraw[1] - +ringDraw[2]],
      ['融合标落底板', +lockIn[1] + +lockIn[2]],
      ['底板浮现', +boardIn[1]],
    ];
    const last = Math.max(...fin.map(f => f[1]));
    for (const [name, t2] of fin)
      assert(t2 * 1000 <= splashMin - 200,
        `${name} t+${t2.toFixed(2)}s 才演完，离保底 ${splashMin}ms 太近 —— 收屏时还在动，等于白画`);
    return '最后收束 t+' + last.toFixed(2) + 's（保底 ' + splashMin + 'ms）';
  });
  t('开屏期遇到换版会多留一会儿（让重载落在用户看不见的时候）', () => {
    assert(/window\.__swPendingUpdate === true && age\(\) < SPLASH_MAX/.test(FLAT),
      '开屏层没看 __swPendingUpdate —— 换版又会等到界面出来才刷，用户看到的还是「闪第二次」');
    assert(/_watchUpdate\(reg\); try \{ reg\.update\(\); \}/.test(FLAT),
      '注册后没有立刻 reg.update()（浏览器只在导航时才去问，等发现新版时开屏早收了）');
    assert(/首次安装：没有旧版要换，不必等/.test(FLAT),
      '首次安装那条守卫没了 —— 白等一趟（那趟本来就不重载）');
    return '在';
  });
  t('等待上限 + 淡出仍在 6 秒兜底之内（绝不把人卡在开屏）', () => {
    assert(splashMax + fadeOut + 60 < 6000,
      `最长在场 ${splashMax + fadeOut}ms 顶到了 6 秒兜底，得留余量`);
    assert(/Auth\._splashOff\(true\)/.test(FLAT),
      '兜底计时器没传 force —— 到点了还得再排一次队');
    return `最长 ${((splashMax + fadeOut) / 1000).toFixed(1)}s < 6s`;
  });

  console.log('\n────────────────────────────────────────');
  console.log(`通过 ${pass.length} / 失败 ${fail.length}`);
  if (fail.length) { fail.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
} catch (e) {
  console.error('跑挂了：' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
  await sleep(300);
}
