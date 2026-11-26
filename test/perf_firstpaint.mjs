/* 首屏时间量尺（纯 CDP，不依赖 puppeteer）
   ─────────────────────────────────────────────────────────────
   用法：node test/perf_firstpaint.mjs <端口> <标签>
   量四件事（ms，取 3 轮中位数）：
     · FCP      首次内容绘制
     · 标题字体  NotoSerifSC 两档 woff2 都下完的时刻（font-display:block 期间标题是空的）
     · 门底图    gate-2 / gate-4 / seal 都下完的时刻
     · LCP      最大内容绘制
   CDP 限速 1.6Mbps / RTT 150ms（接近国内 4G）并关闭缓存 —— 量的是「资源发现
   顺序」在弱网下的差别，不是线上真实速度。用 ?nosw=1 绕过 Service Worker，
   否则第二轮直接被 SW 喂缓存，A/B 就没意义了。
*/
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = process.argv[2] || '5433';
const LABEL = process.argv[3] || 'current';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBG = 9431;
const ROUNDS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* 继续等 */ }
    await sleep(gap);
  }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 接管超时：' + url)), 5000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP 连不上')); };
    });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  async eval(expr, timeout = 90000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const profile = await mkdtemp(path.join(tmpdir(), 'perf-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--no-proxy-server', '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });

const target = await waitFor(async () => {
  const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}, { what: 'Chrome 调试端口' });

const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const PROBE = `
window.__perf = { fcp: 0, lcp: 0 };
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => {
    const es = l.getEntries(); const last = es[es.length - 1];
    if (last && last.startTime > window.__perf.lcp) window.__perf.lcp = last.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch (e) {}
`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });

const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150,
    downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8),
    uploadThroughput: Math.round(400 * 1024 / 8),
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?nosw=1&fresh=${Date.now()}` });
  /* 弱网下 1.3MB 的 HTML + 五张图要慢慢下，给足 30 秒再读账 */
  await sleep(30000);

  rows.push(await cdp.eval(`(async () => {
    const gates = ['img/gate-2.webp', 'img/gate-4.webp', 'img/seal.png'];
    const fonts = ['assets/NotoSerifSC-Titles-400.woff2', 'assets/NotoSerifSC-Titles-500.woff2'];
    const res = performance.getEntriesByType('resource');
    const at = (n) => { const h = res.filter((e) => e.name.includes(n)); return h.length ? Math.max(...h.map((e) => e.responseEnd)) : 0; };
    const gateOk = await Promise.all(gates.map((g) => new Promise((ok) => {
      const im = new Image(); im.onload = () => ok(true); im.onerror = () => ok(false); im.src = g;
    })));
    return {
      fcp: Math.round(window.__perf.fcp), lcp: Math.round(window.__perf.lcp),
      fonts: Math.round(Math.max(...fonts.map(at))), gates: Math.round(Math.max(...gates.map(at))),
      gateOk: gateOk.every(Boolean), fontOk: fonts.every((f) => at(f) > 0),
      reqs: res.length,
      kb: Math.round(res.reduce((a, e) => a + (e.transferSize || 0), 0) / 1024),
      /* preload 没命中就会下两遍 —— 把重复的 URL 摆出来，别靠猜 */
      dups: Object.entries(res.reduce((m, e) => {
        const k = e.name.replace(location.origin, '').replace(/[?&]fresh=\\d+/, '');
        m[k] = (m[k] || 0) + 1; return m;
      }, {})).filter(([, n]) => n > 1).map(([k, n]) => k + ' ×' + n),
    };
  })()`));
}

try { chrome.kill(); } catch { /* 已经退了 */ }

const pick = (k) => md(rows.map((x) => x[k]));
console.log(`\n【${LABEL}】限速 1.6Mbps / RTT 150ms · 无缓存 · ${ROUNDS} 轮中位数`);
const fmt = (k, label) => console.log(`  ${label}${String(pick(k)).padStart(7)} ms`);
fmt('fcp', 'FCP 首次绘制 ');
fmt('lcp', 'LCP 最大绘制 ');
fmt('fonts', '标题字体到齐 ');
fmt('gates', '门底图到齐   ');
console.log(`  请求 ${pick('reqs')} 个 · 传输约 ${pick('kb')} KB`);
console.log(`  门底图解码 ${rows.every((x) => x.gateOk) ? '全部成功' : '⚠️ 有失败'} · 字体 ${rows.every((x) => x.fontOk) ? '都拿到' : '⚠️ 缺失'}`);
const dupAll = [...new Set(rows.flatMap((x) => x.dups || []))];
console.log(`  重复下载 ${dupAll.length ? dupAll.join(' · ') : '无'}`);
console.log('JSON ' + JSON.stringify({ label: LABEL, fcp: pick('fcp'), lcp: pick('lcp'), fonts: pick('fonts'), gates: pick('gates'), reqs: pick('reqs'), kb: pick('kb') }));
