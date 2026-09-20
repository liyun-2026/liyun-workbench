/**
 * 图片识别（OCR）真浏览器验收
 *
 *   node scripts/ocr_browser_test.mjs <工程目录>              # 本地跑（自带静态服务）
 *   node scripts/ocr_browser_test.mjs <工程目录> 5200         # 换端口
 *   OCR_TARGET=https://你的域名 node scripts/ocr_browser_test.mjs <工程目录>
 *                                                            # 直接打线上真实网址
 *
 * 为什么非要开真浏览器：识别跑在 Web Worker + WASM 里，jsdom 根本没有这两样，
 * 模拟出来的「通过」是假的 —— 真机上一样会挂。这个脚本会：
 *   1. 检查 <工程目录>/ocr/ 四个资源在（并核对体积合理）
 *   2. 起一个静态服务（有 test/dev-server.mjs 就用它，没有就用内置的）
 *   3. 用真 Chrome（无头）打开页面
 *   4. 在页面里画一张带中文名的图片，喂给 Ocr.recognize
 *   5. 打印识别结果与耗时，并确认资源确实来自「站内同源」而不是第三方 CDN
 *
 * 通过标准：识别出的文字里包含画上去的姓名，且资源来自同源 ocr/。
 * 打线上时不会登录、不写任何数据，只验证识别链路本身。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.argv[2] || path.join(here, '..'));
const PORT = Number(process.argv[3] || 5199);
const TARGET = (process.env.OCR_TARGET || '').replace(/\/$/, '');   // 有值＝打线上，自带服务不启动
const BASE = TARGET || `http://127.0.0.1:${PORT}`;
const CDP = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NAMES = ['张三', '李四', '王五', '赵六'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(gap);
  }
  throw new Error('等不到' + what);
}

/** 兜底用的极简静态服务（工程里没有 test/dev-server.mjs 时） */
function staticServer(root, port) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gz': 'application/gzip' };
  return createServer(async (req, res) => {
    const rel = new URL(req.url, 'http://localhost').pathname.replace(/^\/+/, '') || 'index.html';
    const f = path.join(root, rel);
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404).end('404'); }
  }).listen(port);
}

class Cdp {
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
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method) {
    return new Promise(res => {
      const set = this.events.get(method) || new Set();
      const fn = p => { set.delete(fn); res(p); };
      set.add(fn); this.events.set(method, set);
    });
  }
  async eval(expr, timeout = 240000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const NEED = [
  ['tesseract.min.js', 50_000],
  ['worker.min.js', 100_000],
  ['tesseract-core-simd.wasm.js', 3_000_000],
  ['chi_sim.traineddata.gz', 1_000_000],
];

let server, chrome, profile, cdp, failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };

try {
  console.log(`\n【1/5】识别资源（${TARGET || WORK + '/ocr'}）…`);
  for (const [f, min] of NEED) {
    if (TARGET) {
      const r = await fetch(`${TARGET}/ocr/${f}`);
      const n = Number(r.headers.get('content-length') || 0);
      ok(r.ok, `ocr/${f}  HTTP ${r.status}${n ? '  ' + (n / 1048576).toFixed(2) + ' MB' : ''}`);
    } else {
      try {
        const s = await stat(path.join(WORK, 'ocr', f));
        ok(s.size >= min, `ocr/${f}  ${(s.size / 1048576).toFixed(2)} MB${s.size < min ? '  ← 体积不对，可能下的是错误页' : ''}`);
      } catch { ok(false, `ocr/${f}  不存在 ← 先跑 scripts/fetch_ocr_assets.py`); }
    }
  }

  console.log('\n【2/5】起页面服务 …');
  if (TARGET) {
    console.log('  打线上，跳过');
  } else if (await stat(path.join(WORK, 'test', 'dev-server.mjs')).then(() => true).catch(() => false)) {
    server = spawn(process.execPath, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
    console.log('  用工程自带的 test/dev-server.mjs');
  } else {
    server = staticServer(WORK, PORT);
    console.log('  用内置静态服务');
  }
  if (!TARGET) await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/`)).ok, { what: '页面服务' });

  console.log('\n【3/5】起真 Chrome（无头）…');
  profile = await mkdtemp(path.join(tmpdir(), 'ocr-chrome-'));
  chrome = spawn(CHROME, [
    // ⚠️ --no-sandbox 不能省（宿主沙箱里 Chrome 自带沙箱起不来，进程秒退、CDP 等不到）
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  console.log('  页面已打开');

  console.log('\n【4/5】页面里画一张中文名单图，走真识别 …');
  const out = await cdp.eval(`(async () => {
    if (typeof Ocr === 'undefined') return { err: '页面里没有 Ocr，识别功能可能没接上' };
    const t0 = performance.now();
    const c = document.createElement('canvas');
    c.width = 720; c.height = 260;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = '56px "PingFang SC","Heiti SC",sans-serif';
    const names = ${JSON.stringify(NAMES)};
    names.forEach((n, i) => x.fillText(n, 40 + (i % 2) * 340, 90 + Math.floor(i / 2) * 110));
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const msgs = [];
    const text = await Ocr.recognize(blob, m => msgs.push(m));
    return { text, ms: Math.round(performance.now() - t0), msgs: [...new Set(msgs)],
             base: (typeof OCR_BASE !== 'undefined' ? OCR_BASE : (window.OCR_BASE || '(未暴露)')) };
  })()`);

  if (out.err) { ok(false, out.err); } else {
    console.log(`  资源来源：${out.base}`);
    console.log(`  阶段提示：${out.msgs.join(' | ')}`);
    console.log(`  识别耗时：${(out.ms / 1000).toFixed(1)} 秒`);
    console.log(`  识别结果：${JSON.stringify(out.text)}`);

    console.log('\n【5/5】判定 …');
    const hit = NAMES.filter(n => (out.text || '').includes(n));
    ok(out.base === `${BASE}/ocr` || String(out.base).startsWith(BASE), `识别资源来自站内同源（${out.base}），不依赖第三方 CDN`);
    ok(hit.length >= 3, `中文识别命中 ${hit.length}/${NAMES.length}（${hit.join('、') || '无'}）`);
    ok(out.ms < 240000, `耗时 ${(out.ms / 1000).toFixed(1)}s 在可接受范围`);
    ok(out.msgs.some(m => /识别包|内核/.test(m)), '加载有分阶段提示（不是干等一个转圈）');
  }

  console.log(failed ? `\n❌ 有 ${failed} 项没过\n` : '\n✅ 图片识别全流程通过\n');
} catch (e) {
  console.error('\n💥 测试中断：' + (e && e.message) + '\n');
  failed++;
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill('SIGKILL');
  server?.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
