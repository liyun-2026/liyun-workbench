/**
 * 整页截图：把一个本地 HTML 渲染成一张完整的长图（无头 Chrome + CDP）。
 *
 *   node test/html2png.mjs <输入.html> <输出.png> [CSS宽] [倍率]
 *   例：node test/html2png.mjs ../安卓加到桌面教程/x.html out.png 540 2
 *
 * 说明：
 *   · 窗口按 CSS 宽给（默认 540），倍率 2 → 出图 1080 宽，微信里看正合适；
 *   · 用的是 captureBeyondViewport，一次把整页拍下来，不用拼图；
 *   · 拍之前会等网页自带字体 + 图片全部就绪（document.fonts.ready + img.decode），
 *     否则长图顶部那几行常常是回退字体。
 *   ⚠️ 无头截图的窗口有最小宽度钳制（约 500px），CSS 宽别给 390 那种值，
 *      否则内容会缩在左边、右边空一大条。
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [inFile, outFile, wArg, dsfArg] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error('用法：node test/html2png.mjs <输入.html> <输出.png> [CSS宽=540] [倍率=2]');
  process.exit(1);
}
const W = Number(wArg || 540);
const DSF = Number(dsfArg || 2);
const DEBUG = 9500;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
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
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params)); };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

let chrome;
try {
  const url = 'file://' + path.resolve(inFile);
  const profile = await mkdtemp(path.join(tmpdir(), 'h2p-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server',
    `--window-size=${W},1200`, '--hide-scrollbars', url],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });

  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.startsWith('about:'));
  }, { what: 'Chrome 调试端口', tries: 40 });

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: 1200, deviceScaleFactor: DSF, mobile: false });
  await cdp.eval(`document.readyState === 'complete' ? 1 : new Promise(r => addEventListener('load', r, { once: true }))`);
  /* 字体 + 图片就绪：否则长图顶部几行常常是回退字体 */
  await cdp.eval(`(async () => {
    try { await document.fonts.ready; } catch(e){}
    await Promise.all([...document.images].map(im => im.decode ? im.decode().catch(()=>{}) : Promise.resolve()));
    return 1;
  })()`);
  await sleep(400);

  const h = await cdp.eval(`Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))`);
  console.log(`尺寸 ${W} × ${h} CSS px  →  出图 ${W * DSF} × ${h * DSF} px`);
  if (h * DSF > 16000) console.log(`⚠️ 高度 ${h * DSF}px 超过 16000，Chrome 可能截不全，考虑拆成两张`);

  /* 把「窗口」撑到整页高再拍 —— 比给 clip 稳（带 clip 时 Chrome 会报 Invalid parameters，
     而且 clip 的 scale 会和 deviceScaleFactor 叠乘，出图大一倍）。 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: DSF, mobile: false });
  await sleep(500);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  await writeFile(outFile, Buffer.from(r.data, 'base64'));
  const st = await stat(outFile);
  console.log('✅ 已写出 ' + outFile + '（' + Math.round(st.size / 1024) + ' KB）');
} catch (e) {
  console.error('💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
}
