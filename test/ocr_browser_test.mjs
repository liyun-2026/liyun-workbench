/**
 * 图片识别（OCR）真浏览器验收
 *
 *   node test/ocr_browser_test.mjs          # 用 5199 端口，默认无头
 *   node test/ocr_browser_test.mjs 5200
 *
 * 为什么非要开真浏览器：识别跑在 Web Worker + WASM 里，jsdom 根本没有这两样，
 * 模拟出来的「通过」是假的 —— 真机上一样会挂。这个脚本会：
 *   1. 起本地预览服务（真 sync.js）
 *   2. 用真 Chrome（无头）打开页面
 *   3. 在页面里画一张带中文名的图片，喂给 Ocr.recognize
 *   4. 打印识别结果和耗时，并确认资源确实来自「本站」而不是第三方 CDN
 *
 * 通过标准：识别出的文字里包含画上去的姓名，且加载的是同源 ocr/ 资源。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5199);
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
  async eval(expr, timeout = 180000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome, profile, cdp, failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };

try {
  console.log('\n【1/5】起本地预览服务 …');
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  console.log(`  服务就绪 → http://127.0.0.1:${PORT}`);

  console.log('\n【2/5】同源识别资源是否可取 …');
  for (const f of ['tesseract.min.js', 'worker.min.js', 'tesseract-core-simd.wasm.js', 'chi_sim.traineddata.gz']) {
    const r = await fetch(`http://127.0.0.1:${PORT}/ocr/${f}`);
    const n = Number(r.headers.get('content-length') || 0);
    ok(r.ok, `${f}  HTTP ${r.status}  ${(n / 1048576).toFixed(2)} MB`);
  }

  console.log('\n【3/5】起真 Chrome（无头）…');
  profile = await mkdtemp(path.join(tmpdir(), 'ocr-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await loaded;
  console.log('  页面已打开');

  console.log('\n【4/5】页面里画一张中文名单图，走真识别 …');
  const out = await cdp.eval(`(async () => {
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
    const text = await Ocr.recognize(blob, m => { msgs.push(m); window.__ocrLast = m; });
    return { text, ms: Math.round(performance.now() - t0), msgs: [...new Set(msgs)], base: OCR_BASE, hasT: !!window.Tesseract };
  })()`);

  console.log(`  引擎来源：${out.base}`);
  console.log(`  连接判定：${out.hasT ? 'tesseract.js 已加载' : '没加载上'}`);
  console.log(`  阶段提示：${out.msgs.join(' | ')}`);
  console.log(`  识别耗时：${(out.ms / 1000).toFixed(1)} 秒`);
  console.log(`  识别结果：${JSON.stringify(out.text)}`);

  console.log('\n【5/5】判定 …');
  ok(out.base.startsWith(`http://127.0.0.1:${PORT}`), '识别资源来自本站（同源），不依赖第三方 CDN');
  const hit = NAMES.filter(n => out.text.includes(n));
  ok(hit.length >= 3, `中文识别命中 ${hit.length}/${NAMES.length}（${hit.join('、') || '无'}）`);
  ok(out.ms < 120000, `耗时 ${(out.ms / 1000).toFixed(1)}s 在可接受范围`);
  ok(out.msgs.some(m => /中文识别包/.test(m)), '下载语言包时给了明确提示（不是干等）');

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
