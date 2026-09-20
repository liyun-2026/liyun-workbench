/**
 * 启动速度 / 开屏覆盖验收（真 Chrome）
 *
 *   node test/launch_check.mjs
 *
 * 用户反馈过「开启页面还是有几秒的停顿」。那段停顿的构成是：
 *   ① index.html 要从境外节点下载（跨境握手 ≈1s）—— 这段是白屏
 *   ② 页面解析到能画第一帧（≈0.4s）
 *   ③ 旧代码还要 await probe() → await boot() 两次网络往返，全压在开屏后面
 *
 * 这个脚本就盯这三件事：
 *   静态 —— 开屏图和图标有没有配齐（缺档位 = 那个机型开机白屏）
 *   动态 —— 模拟跨境延迟，量「导航开始 → 第一帧」到底多久；
 *          并且对比「第一次（没有 SW）」和「第二次（SW 接管后）」，
 *          证明 SW 真的把①那段跨境下载盖掉了
 *   开屏 —— 不能一闪而过（像闪屏故障），也不能一直不收
 *
 * 全程一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5213);
const DBG = 5355;
const BASE = `http://127.0.0.1:${PORT}`;
const LATENCY = 300;                 // 模拟跨境：每次请求 +300ms（真机约 900ms）
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };
const chromes = [], profiles = [];
let server;

/* ── PNG 尺寸：不引依赖，直接读 IHDR ── */
async function pngSize(p) {
  const b = await readFile(p);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const exists = async p => { try { await stat(p); return true; } catch { return false; } };

/* ── CDP 小客户端 ── */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 接管超时（5s）')), 5000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP 连不上')); };
    });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id);
        c.waiting.delete(m.id);
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
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

/* 在页面脚本之前埋点：记下第一帧和开屏出现的时刻 */
const PROBE = `
window.__t = { t0: performance.now(), marks: [] };
const mk = (k, v) => { try { window.__t.marks.push([k, Math.round(v ?? performance.now())]); } catch(e){} };
const obs = () => new MutationObserver(() => {
  const g = document.getElementById('gate');
  if (g && g.classList.contains('on')) mk('登录门可见');
  const sp = document.getElementById('splash');
  if (sp && sp.classList.contains('off')) mk('开屏开始淡出');
  if (!document.getElementById('splash')) { mk('开屏已移除'); }
});
let mo = null;
addEventListener('DOMContentLoaded', () => { mk('DOMContentLoaded'); mo = obs(); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); });
requestAnimationFrame(() => requestAnimationFrame(() => {
  const sp = document.getElementById('splash');
  mk(sp ? '第一帧（开屏已出现）' : '第一帧（没有开屏）');
  mk('first-paint', (performance.getEntriesByType('paint')[0] || {}).startTime);
}));
addEventListener('load', () => {
  mk('load');
  if (!mo) mo = obs(); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  const g = document.getElementById('gate');
  if (g && g.classList.contains('on')) mk('登录门可见');
  const sp = document.getElementById('splash');
  if (sp && sp.classList.contains('off')) mk('开屏开始淡出');
  if (!sp) mk('开屏已移除');
});
`;

async function measure(cdp, { fresh = false } = {}) {
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: LATENCY, downloadThroughput: 1.5e6, uploadThroughput: 8e5,
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });
  if (fresh) {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  }
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(6000);
  const out = await cdp.eval(`(() => {
    const m = Object.fromEntries(window.__t ? window.__t.marks : []);
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return { marks: m, transfer: nav.transferSize, controlled: !!navigator.serviceWorker.controller };
  })()`);
  return out;
}

try {
  /* ════════ 一、静态：开屏图与图标配齐了没 ════════ */
  console.log('\n【1/4】静态检查：开屏图 / 图标 / manifest');

  const html = await readFile(path.join(dir, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="apple-touch-startup-image"[^>]*href="([^"]+)"[^>]*>/g)]
    .map(m => ({ href: m[1], tag: m[0] }));
  ok(links.length >= 24, `开屏图清单有 ${links.length} 条（≥24，覆盖主流 iPhone 档位）`);

  const missing = [];
  for (const l of links) if (!(await exists(path.join(dir, l.href)))) missing.push(l.href);
  ok(missing.length === 0, missing.length ? `有 ${missing.length} 张开屏图缺失：${missing.slice(0, 3).join('、')}` : '清单里的开屏图文件全部存在');

  const sizes = new Set(links.map(l => l.href.replace(/.*splash-/, '').replace(/-dark|\.png/g, '')));
  for (const need of ['1125x2436', '1170x2532', '1179x2556', '1290x2796', '1320x2868']) {
    ok(sizes.has(need), `覆盖了 ${need} 这一档（旧版漏掉的常见机型）`);
  }
  const darks = links.filter(l => l.href.includes('-dark')).length;
  ok(darks === links.length / 2, `深浅色各 ${darks} 张（深色跟随系统主题）`);

  ok(links.every(l => /\(device-width: \d+px\) and \(device-height: \d+px\) and \(-webkit-device-pixel-ratio: \d\)/.test(l.tag)),
    '每条 media 查询都写全了 device-width / device-height / 像素比');

  const icons = [['icon.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]];
  for (const [f, px] of icons) {
    const p = path.join(dir, f);
    if (!(await exists(p))) { ok(false, `${f} 不存在`); continue; }
    const s = await pngSize(p);
    ok(s.w === px && s.h === px, `${f} 是 ${s.w}×${s.h}（应为 ${px}×${px}）`);
  }

  const mf = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const anyI = mf.icons.filter(i => i.purpose === 'any').length;
  const maskI = mf.icons.filter(i => i.purpose === 'maskable').length;
  ok(anyI >= 2 && maskI >= 2, `manifest 把 any（${anyI}）和 maskable（${maskI}）分开声明了`);
  ok(!mf.icons.some(i => i.purpose === 'any maskable'),
    '不再用 "any maskable" 混写（安卓会把图标当纯 maskable 加一圈难看的留白）');

  /* ════════ 二、SW 预缓存清单里的文件都在 ════════ */
  console.log('\n【2/4】Service Worker');
  const sw = await readFile(path.join(dir, 'sw.js'), 'utf8');
  const shellBlock = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  const shell = shellBlock ? [...shellBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
  ok(shell.length > 0, `SW 预缓存清单有 ${shell.length} 项`);
  const swMissing = [];
  for (const u of shell) {
    const p = path.join(dir, u.replace(/^\.\//, '').replace(/\/$/, '/index.html'));
    if (!(await exists(p))) swMissing.push(u);
  }
  ok(swMissing.length === 0, swMissing.length ? `预缓存清单里有不存在的文件：${swMissing.join('、')}` : '预缓存清单里的文件都存在（不会出现装好了但少东西）');
  ok(/pathname\.startsWith\('\/api\/'\)\) return/.test(sw), 'SW 明确绕开了 /api/（数据必须实时，缓存了会出大事）');
  ok(/req\.mode === 'navigate'/.test(sw), '导航请求走单独策略（缓存优先 + 后台比对更新）');

  /* ════════ 三、动态：真有变快吗 ════════ */
  console.log('\n【3/4】模拟跨境延迟，实测两次打开');
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok) break; } catch {}
    await sleep(400);
  }
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'launch-chrome-'));
  profiles.push(profile);
  const chrome = spawn(CHROME, [
    // ⚠️ --no-sandbox 不能省：宿主沙箱里 Chrome 自带沙箱起不来，进程会秒退
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);

  let cdp;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) { cdp = await Cdp.connect(t.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(400);
  }
  if (!cdp) throw new Error('连不上 Chrome');

  const cold = await measure(cdp, { fresh: true });
  const fp1 = cold.marks['first-paint'];
  console.log(`     第一次（无 SW）：第一帧 ${fp1}ms  文档传输 ${cold.transfer} 字节`);
  ok(cold.marks['第一帧（开屏已出现）'] !== undefined, '开屏层在第一次打开时就出现了（不是白屏）');
  /* ⚠️ 不能拿 navigator.serviceWorker.controller 判「有没有被接管」——
     SW 装好会立刻 clients.claim()，那一刻当前这个页面也会被接管。
     真正的证据是这一趟**确实从网络下载了文档**。 */
  ok(cold.transfer > 0, `第一次确实是走网络取的文档（${cold.transfer} 字节）—— 这正是要盖掉的那一段`);

  // 等 SW 装好并接管
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = await cdp.eval(`navigator.serviceWorker.ready.then(() => true).catch(() => false)`);
    if (ready) break;
    await sleep(500);
  }
  ok(ready, 'Service Worker 安装成功（预缓存完成）');

  const warm = await measure(cdp, { fresh: false });
  const fp2 = warm.marks['first-paint'];
  console.log(`     第二次（SW 接管）：第一帧 ${fp2}ms  文档传输 ${warm.transfer} 字节`);
  ok(warm.controlled, '第二次打开由 Service Worker 接管页面');
  ok(fp2 < fp1, `第二次第一帧更早：${fp1}ms → ${fp2}ms（省下 ${fp1 - fp2}ms，这一段就是原来白屏的时间）`);
  ok(fp1 - fp2 >= LATENCY * 0.5,
    `省下的时间达到模拟延迟的一半以上（${fp1 - fp2}ms ≥ ${Math.round(LATENCY * 0.5)}ms）—— 真机跨境约 900ms，省得更多`);
  ok(warm.transfer === 0, `第二次没再下载 index.html（传输 ${warm.transfer} 字节）—— 跨境那一秒被彻底盖掉`);

  /* ════════ 四、开屏节奏 ════════ */
  console.log('\n【4/4】开屏节奏：不能一闪而过，也不能赖着不走');
  const shown = warm.marks['第一帧（开屏已出现）'] ?? warm.marks['first-paint'];
  const gone = warm.marks['开屏已移除'] ?? warm.marks['开屏开始淡出'];
  ok(gone !== undefined, '开屏最终被收掉了（不会一直卡在开屏）');
  if (gone !== undefined) {
    const stay = gone - shown;
    ok(stay >= 600, `开屏在场 ${stay}ms（≥600ms，不会一闪而过像闪屏故障）`);
    ok(stay <= 6000, `开屏在场 ${stay}ms（≤6000ms，兜底计时器管住了）`);
  }
  const gate = warm.marks['登录门可见'];
  ok(gate !== undefined, `开屏收起时登录门已经可见（${gate}ms 出现）—— 收开屏前界面已就绪`);

  console.log(`\n${failed ? '❌ 有 ' + failed + ' 项没过' : '✅ 启动链路验收全部通过'}`);
} catch (e) {
  console.error('\n❌ 跑挂了：', e.message);
  failed++;
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  chromes.forEach(c => c.kill());
  if (server) server.kill();
  await sleep(300);
}
process.exit(failed ? 1 : 0);
