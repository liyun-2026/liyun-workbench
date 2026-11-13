/**
 * VoxOS 5.33 桌面锁版 + 标题锁死 CDP 验证
 *   node test/desk_lock_check.mjs
 * 桌面 1440/1100/900/800/700 五档：恒为桌面骨架 + 大标题单行无溢出；
 * 390 触屏模拟：手机版形态不变（desktop-lock 不挂、mtabbar 在、手机块生效）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5372, CPORT = 5373;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride', {
  width: o.width, height: o.height, deviceScaleFactor: o.dsf || 1, mobile: !!o.mobile,
  screenOrientation: o.mobile ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 0 },
});
const DESK = w => ({ width: w, height: 900, dsf: 1, mobile: false });
const MOB = { width: 390, height: 844, dsf: 2, mobile: true };

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond){ PASS++; console.log('  ✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { FAIL++; console.log('  🔴 ' + name + (extra ? ' · ' + extra : '')); }
};

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'desklock-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=' + CPORT,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${CPORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, DESK(1440));
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return !document.getElementById('gate').classList.contains('on');
  })()`);
  console.log('已登录：李老师\n');

  await cdp.eval(`(async () => { App.go('home'); await new Promise(r=>setTimeout(r,500)); return 1; })()`);

  /* ── 桌面五档 ── */
  for (const w of [1440, 1100, 900, 800, 700]){
    console.log('◆ 桌面 ' + w + 'px');
    await view(cdp, DESK(w));
    await sleep(400);
    await cdp.eval(`window.dispatchEvent(new Event('resize')); 1;`);
    await sleep(400);
    const r = await cdp.eval(`(() => {
      const R = {};
      R.lock = document.documentElement.classList.contains('desktop-lock');
      R.deskFn = !!window.__desk && window.__desk();
      const mb = document.querySelector('.mtabbar'), tb = document.querySelector('.topbar'), sd = document.querySelector('.side');
      R.mtabbar = mb ? getComputedStyle(mb).display : 'missing';
      R.topbar = tb ? getComputedStyle(tb).display : 'missing';
      R.side = sd ? getComputedStyle(sd).display : 'missing';
      R.hero = (() => { const h = document.querySelector('.xf-hero'); return h ? getComputedStyle(h).display : 'missing'; })();
    const single = sel => {
      const out = [];
      document.querySelectorAll(sel).forEach(el => {
        if (!el.getClientRects().length) return;
        /* 只测「本行」：直接文本节点 + 行内子元素（如 h1 里的 · span、page-title 的时钟）；
           块级子元素（chead h2 的 small）不算行数 —— 它们单独由自己的选择器测。 */
        const rects = [];
        [...el.childNodes].forEach(n => {
          const isText = n.nodeType === 3 && n.textContent.trim();
          const isInline = n.nodeType === 1 && getComputedStyle(n).display.startsWith('inline');
          if (!isText && !isInline) return;
          const rg = document.createRange(); rg.selectNodeContents(n);
          [...rg.getClientRects()].filter(x => x.width > 2).forEach(x => rects.push(x));
        });
        const lines = new Set(rects.map(x => Math.round(x.top))).size;
        out.push({ el, lines, over: el.scrollWidth - el.clientWidth, fs: getComputedStyle(el).fontSize });
      });
      return out;
    };
      R.heroH1 = single('.xf-slide.on .xf-stx h1');
      R.heroSub = single('.xf-slide.on .xf-stx .ssub');
      R.ptitle = single('#page-home.on .page-title');
      return R;
    })()`);
    ok('desktop-lock 挂载', r.lock);
    ok('__desk() true', r.deskFn);
    ok('mtabbar 隐藏', r.mtabbar === 'none', r.mtabbar);
    ok('topbar 隐藏', r.topbar === 'none', r.topbar);
    const xftop = await cdp.eval(`(() => { const t = document.querySelector('.xf-top'); return t ? getComputedStyle(t).display : 'missing'; })()`);
    ok('XF 顶栏显示（侧栏退场）', r.side === 'none' && xftop === 'block', 'side=' + r.side + ' xf-top=' + xftop);
    ok('xf-hero 横幅渲染', r.hero === 'block', r.hero);
    ok('hero 主标题单行', r.heroH1.every(x => x.lines === 1 && x.over <= 1), r.heroH1.map(x => `${x.lines}行 fs=${x.fs} over=${x.over}`).join(','));
    ok('hero 副题单行', r.heroSub.every(x => x.lines === 1 && x.over <= 1), r.heroSub.map(x => `${x.lines}行 fs=${x.fs}`).join(','));
    ok('page-title 单行', r.ptitle.every(x => x.lines === 1 && x.over <= 1), r.ptitle.map(x => `${x.lines}行 fs=${x.fs}`).join(','));
    console.log('');
  }

  /* ── 考勤页 chead h2（窄档抽查 800） ── */
  await view(cdp, DESK(800));
  await sleep(400);
  await cdp.eval(`(async () => { App.go('att'); await new Promise(r=>setTimeout(r,600)); return 1; })()`);
  const chead = await cdp.eval(`(() => {
    const h2 = document.querySelector('#page-att.on .chead h2');
    if (!h2 || !h2.getClientRects().length) return null;
    const rects = [];
    [...h2.childNodes].forEach(n => {
      const isText = n.nodeType === 3 && n.textContent.trim();
      const isInline = n.nodeType === 1 && getComputedStyle(n).display.startsWith('inline');
      if (!isText && !isInline) return;
      const rg = document.createRange(); rg.selectNodeContents(n);
      [...rg.getClientRects()].filter(x => x.width > 2).forEach(x => rects.push(x));
    });
    const lines = new Set(rects.map(x => Math.round(x.top))).size;
    return { lines, over: h2.scrollWidth - h2.clientWidth, fs: getComputedStyle(h2).fontSize };
  })()`);
  console.log('◆ 桌面 800px · 考勤章节头');
  ok('chead h2 单行无溢出', chead && chead.lines === 1 && chead.over <= 1, chead ? `${chead.lines}行 fs=${chead.fs}` : 'missing');
  const small = await cdp.eval(`(() => {
    const sm = document.querySelector('#page-att.on .chead h2 small');
    if (!sm || !sm.getClientRects().length) return null;
    const rg = document.createRange(); rg.selectNodeContents(sm);
    const lines = new Set([...rg.getClientRects()].filter(x => x.width > 2).map(x => Math.round(x.top))).size;
    return { lines, fs: getComputedStyle(sm).fontSize };
  })()`);
  ok('chead h2 small 单行', small ? small.lines === 1 : true, small ? `${small.lines}行 fs=${small.fs}` : 'missing');
  console.log('');

  /* ── 390 触屏模拟：媒体特征 + 触摸 + 窄窗，重载后按真实手机特征判定 ── */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [
    { name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' },
    { name: 'any-hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' },
  ]});
  await view(cdp, MOB);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return 1;
  })()`);
  await cdp.eval(`(async () => { App.go('home'); await new Promise(r=>setTimeout(r,500)); return 1; })()`);
  const m = await cdp.eval(`(() => {
    const R = {};
    R.lock = document.documentElement.classList.contains('desktop-lock');
    R.deskFn = !!window.__desk && window.__desk();
    const mb = document.querySelector('.mtabbar'), sd = document.querySelector('.side');
    R.mtabbar = mb ? getComputedStyle(mb).display : 'missing';
    R.side = sd ? getComputedStyle(sd).display : 'missing';
    R.hero = (() => { const h = document.querySelector('.xf-hero'); return h ? getComputedStyle(h).display : 'missing'; })();
    R.fitInstalled = !!window.FitLine;
    return R;
  })()`);
  console.log('◆ 390 触屏模拟');
  ok('desktop-lock 不挂载', m.lock === false);
  ok('__desk() false', m.deskFn === false);
  ok('mtabbar 手机底栏在', m.mtabbar !== 'none' && m.mtabbar !== 'missing', m.mtabbar);
  ok('side 侧栏隐藏', m.side === 'none', m.side);
  ok('xf-hero 横幅不渲染', m.hero === 'none', m.hero);
  const fitIdle = await cdp.eval(`(() => {
    const h = document.querySelector('#page-home.on .page-title');
    return !h || !h.style.whiteSpace;
  })()`);
  ok('FitLine 触屏端不生效（标题无内联 nowrap）', fitIdle);

  console.log(`\n═══ 结果：✅ ${PASS} · 🔴 ${FAIL} ═══`);
  process.exit(FAIL ? 1 : 0);
} catch (e) {
  console.error('💥', e.message);
  process.exit(2);
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}
