/**
 * 对 HTML 页面按指定区域截取 PNG（真 Chrome + CDP clip）。
 *   node test/shot_clip.mjs <html路径> <输出png> <y> <height> [width]
 *
 * 用途：核对超长页面（如使用教程长图）的首尾与关键区段，
 * 无需依赖图像库切图，直接让浏览器按矩形区域出图。
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const HTML = process.argv[2];
const OUT = process.argv[3];
const CLIP_Y = Number(process.argv[4] || 0);
const CLIP_H = Number(process.argv[5] || 1200);
const WIDTH = Number(process.argv[6] || 1080);
if (!HTML || !OUT) { console.error('用法：node test/shot_clip.mjs <html> <out.png> <y> <height> [width]'); process.exit(1); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5402;
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

const profile = await mkdtemp(path.join(tmpdir(), 'lyclip-'));
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

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await cdp.eval(`(() => document.readyState === 'complete' && Array.from(document.images).every(im => im.complete && im.naturalWidth > 0))()`).catch(() => false);
    if (!ready) await sleep(400);
  }
  if (!ready) console.warn('⚠️ 有图片可能未加载完');
  await sleep(600);

  const total = await cdp.eval(`Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: total, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);

  const y = Math.max(0, Math.min(CLIP_Y, total - 1));
  const h = Math.min(CLIP_H, total - y);
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y, width: WIDTH, height: h, scale: 1 },
  });
  await writeFile(OUT, Buffer.from(r.data, 'base64'));
  console.log(`✅ 已输出 ${OUT}｜页面总高 ${total}px，本次截取 y=${y} 高 ${h}px`);
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
