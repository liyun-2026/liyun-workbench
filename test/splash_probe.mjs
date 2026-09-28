/**
 * 开屏（splash）「跳了几次」的测量内核 + 命令行诊断
 *
 *   node test/splash_probe.mjs <url> [等待秒数] [复用哪个用户目录]
 *   例：node test/splash_probe.mjs https://liyun2026.top/ 20
 *        node test/splash_probe.mjs http://127.0.0.1:5391/ 20 /tmp/profile
 *
 * 做什么：开一个 Chrome（可指定用户目录，默认全新 = 等于第一次访问），
 *   打开目标站，每 250ms 采一次样：文档加载了几次（注入脚本 + sessionStorage，
 *   reload 也不会丢）、开屏层此刻在不在。最后把「开屏可见」压成若干**连续段** ——
 *   段数 = 用户肉眼看到「跳」的次数。
 *
 * 为什么需要它：开屏重放是纯时序问题，读代码只能猜。这个脚本给可复现的数字。
 * `measure()` 被 test/splash_once_check.mjs 复用（那条是回归断言）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Cdp {
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
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function waitDebugPort(db) {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${db}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
      const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch {}
    await sleep(400);
  }
  throw new Error('等不到 Chrome 调试端口');
}

/**
 * 打开 url 采样观测。返回 { loads, segs, samples, navs, profile }
 *   profile 传一个已存在的用户目录 = 「第 N 次打开」（SW 已装好）。
 */
export async function measure({ url, profile: reProfile = '', watchMs = 20000, dbgPort = 5399, quiet = false } = {}) {
  const profile = reProfile || await mkdtemp(path.join(tmpdir(), 'splash-probe-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  try {
    const target = await waitDebugPort(dbgPort);
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    /* 每次文档加载都记一笔。sessionStorage 跨 reload 保留，正好用来数「加载了几次」。 */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const n = (Number(sessionStorage.getItem('__probeLoads')) || 0) + 1;
        sessionStorage.setItem('__probeLoads', String(n));
        window.__probeLoadNo = n;
      })();`,
    });

    const navs = [];
    cdp.events.set('Page.frameNavigated', new Set([p => {
      if (p.frame && !p.frame.parentId) navs.push({ t: Date.now(), url: p.frame.url });
    }]));

    const t0 = Date.now();
    await cdp.send('Page.navigate', { url });

    const samples = [];
    while (Date.now() - t0 < watchMs) {
      let s = { loads: 0, loadNo: 0, splash: false, off: false, gate: false, page: '' };
      try {
        s = await cdp.eval(`(() => {
          const sp = document.getElementById('splash');
          const g = document.getElementById('gate');
          return {
            loads: Number(sessionStorage.getItem('__probeLoads')) || 0,
            loadNo: Number(sessionStorage.getItem('__probeLoads')) || 0,
            splash: !!sp, off: !!(sp && sp.classList.contains('off')),
            gate: !!(g && g.classList.contains('on')),
            page: (document.querySelector('.page.on') || {}).id || '',
          };
        })()`, 8000);
      } catch {}
      samples.push({ ms: Date.now() - t0, ...s });
      await sleep(200);
    }

    /* 压成「开屏可见」连续段 */
    const segs = [];
    for (const s of samples) {
      const visible = s.splash && !s.off;
      const cur = segs[segs.length - 1];
      if (visible && (!cur || cur.end !== undefined)) segs.push({ start: s.ms, end: undefined });
      else if (!visible && cur && cur.end === undefined) cur.end = s.ms;
    }
    const last = segs[segs.length - 1];
    if (last && last.end === undefined) last.end = samples[samples.length - 1].ms;

    const loads = Math.max(...samples.map(s => s.loads), 0);
    /* ⭐ 关键指标：**重放了几次入场动画**。
       数「段数」不够用 —— 如果重载正好落在开屏还在的时候，前后两段会连成一段，
       看着像一段其实动画已经从头重播了。所以按「第几次文档加载」分组：
       第 2 次及以后那几趟里，只要还看得见开屏，就是重放了一次。 */
    const byLoad = new Map();
    for (const s of samples) {
      if (!s.loadNo) continue;
      if (!byLoad.has(s.loadNo)) byLoad.set(s.loadNo, []);
      byLoad.get(s.loadNo).push(s);
    }
    const replays = [...byLoad.entries()]
      .filter(([n, ss]) => n >= 2 && ss.some(s => s.splash && !s.off))
      .map(([n]) => n);
    const splashMs = segs.reduce((a, s) => a + (s.end - s.start), 0);

    if (!quiet) {
      console.log('时间轴（每 200ms 采样，● = 开屏可见）：');
      console.log('  ' + samples.map(s => (s.splash && !s.off) ? '●' : '·').join(''));
      console.log('文档加载次数：', loads, '   （每次加载都会把入场动画从头播一遍）');
      navs.forEach((n, i) => console.log(`  导航 #${i + 1}  t+${((n.t - t0) / 1000).toFixed(1)}s`));
      console.log('开屏可见段：', segs.length, '段，累计 ' + (splashMs / 1000).toFixed(1) + 's');
      segs.forEach((s, i) => console.log(`  第${i + 1}段  t+${(s.start / 1000).toFixed(2)}s → t+${(s.end / 1000).toFixed(2)}s  共 ${((s.end - s.start) / 1000).toFixed(1)}s`));
    }
    return { loads, segs, replays, splashMs, samples, navs, profile };
  } finally {
    try { chrome.kill(); } catch {}
  }
}

/* ── 命令行 ── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] || 'https://liyun2026.top/';
  const watchMs = Number(process.argv[3] || 20) * 1000;
  const reuse = process.argv[4] || '';
  console.log(`\n▶ 打开 ${target}${reuse ? '（复用已有用户目录 = 老用户回访）' : '（全新浏览器目录 = 第一次访问）'}\n`);
  const r = await measure({ url: target, profile: reuse, watchMs });
  if (!reuse) console.log('profile::' + r.profile);
  console.log('\n结论：' + (r.replays.length === 0
    ? '✅ 入场动画全程只播了一遍'
    : `⚠️ 入场动画重放了 ${r.replays.length} 次（第 ${r.replays.join('、')} 次加载）—— 就是用户说的「跳好几次」`));
  process.exit(r.replays.length === 0 ? 0 : 1);
}
