/**
 * 把一张 HTML 长图渲染成 PNG（真 Chrome，全页截图）。
 *   node test/make_longposter.mjs <html路径> <输出png路径> [宽度]
 *
 * 用法与用途：培训材料里的「使用教程长图」由 长图.html 描述版式，
 * 本脚本负责用真实 Chrome 渲染并整页截图，保证中文字体与图片都按预期呈现。
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const HTML = process.argv[2];
const OUT = process.argv[3];
const WIDTH = Number(process.argv[4] || 1080);
if (!HTML || !OUT) { console.error('用法：node test/make_longposter.mjs <html> <out.png> [宽度]'); process.exit(1); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5399;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const profile = await mkdtemp(path.join(tmpdir(), 'lyposter-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--disable-gpu',
  '--force-device-scale-factor=1',
  '--allow-file-access-from-files',
  `file://${path.resolve(HTML)}`,
], { stdio: 'ignore' });

let cdp;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  if (!target) throw new Error('找不到 Chrome 页面目标');
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 等文档与所有图片就绪
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await cdp.eval(`(() => document.readyState === 'complete' && Array.from(document.images).every(im => im.complete && im.naturalWidth > 0))()`).catch(() => false);
    if (!ready) await sleep(400);
  }
  if (!ready) console.warn('⚠️ 有图片可能未加载完，仍继续渲染');
  await sleep(600);

  const height = await cdp.eval(`Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`);
  console.log('页面内容高度：', height, 'px，宽度：', WIDTH, 'px');

  console.log('设置视口…');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  console.log('开始截图…');

  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  console.log('截图完成，字节数：', r.data.length);
  await writeFile(OUT, Buffer.from(r.data, 'base64'));
  console.log('✅ 已输出', OUT);
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
