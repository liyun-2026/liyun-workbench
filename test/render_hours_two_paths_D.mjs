/**
 * 用「两条通路统一夹具实测」的**实测数字**重画 D 图（只重出 D，A/B/C 不动）。
 *
 *   node test/render_hours_two_paths_D.mjs
 *
 * 输入：test/.shots/plan-keshitongji/stage1/_measure_two_paths.json
 *       （由 test/measure_hours_two_paths.mjs 现场跑出来）
 * 输出：test/.shots/plan-keshitongji/stage1/D_两条识别通路对比.png   （覆盖原文件）
 *       test/.shots/plan-keshitongji/stage1/_d_compare.html          （留一份源）
 *
 * 出图方式与旧版一致：data: URL + 无头 Chrome，按**内容高**裁切（clip），倍率 2 → 2560 宽。
 * （不用 test/html2png.mjs：它按窗口高 1200 补白，底部会多出一大条空白。）
 *
 * 硬约束：分母都是 15；数字一律取实测，不写死、不凑。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '..');
const OUT = path.join(WORK, 'test', '.shots', 'plan-keshitongji', 'stage1');
const JSON_PATH = path.join(OUT, '_measure_two_paths.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG = 9595;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 40, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const mm = JSON.parse(ev.data);
      if (mm.id && c.waiting.has(mm.id)) { const { res, rej } = c.waiting.get(mm.id); c.waiting.delete(mm.id); mm.error ? rej(new Error(mm.error.message)) : res(mm.result); }
      else if (mm.method && c.events.has(mm.method)) c.events.get(mm.method).forEach(f => f(mm.params)); };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set();
    const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const m = JSON.parse(await readFile(JSON_PATH, 'utf8'));
const N = m.truth.cells;                       // 15
const docxExact = m.docx.exactMatch;           // 逐格一字不差
const imgRec = m.image.recognized;             // 认出（相似度≥0.75）
const imgExact = m.image.exactMatch;           // 严格一字不差（仅记录）

const leftMetric = docxExact === N ? `${N} 格里逐格一字不差` : `${docxExact} / ${N} 格逐格一字不差`;
const rightMetric = `${N} 格里认出 ${imgRec} 格`;

const D_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  :root{--paper:#F6F5F2;--card:#FFFFFF;--line:#E7E3DA;--gold:#C9AB7C;--red:#B23A2E;--text:#26241F;--dim:#6E6A61}
  *{box-sizing:border-box}html,body{margin:0}
  body{background:var(--paper);color:var(--text);width:1280px;padding:44px 48px 36px;
       font-family:-apple-system,"PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  h1{font-size:31px;font-weight:600;margin:0 0 8px;letter-spacing:-.01em}
  .sub{font-size:16.5px;color:var(--dim);margin:0 0 30px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px 28px 24px;position:relative}
  .hd{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .hd .ic{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:none}
  .hd .ttl{font-size:20px;font-weight:600}
  .badge{margin-left:auto;font-size:14px;font-weight:600;color:#7a5f27;background:#F3E8CF;border:1px solid var(--gold);
         border-radius:999px;padding:4px 14px;letter-spacing:.04em}
  .tagred{margin-left:auto;font-size:14px;font-weight:600;color:var(--red);background:#F7E6E3;border:1px solid #E4BDB6;
         border-radius:999px;padding:4px 14px;letter-spacing:.04em}
  .chip{display:inline-block;font-size:13px;color:var(--dim);background:#F4F1EA;border:1px solid var(--line);
        border-radius:999px;padding:3px 11px;margin-bottom:12px;letter-spacing:.02em}
  .metric{font-size:32px;font-weight:700;letter-spacing:-.01em;margin:6px 0 18px;font-variant-numeric:tabular-nums}
  .metric small{font-size:17px;font-weight:500;color:var(--dim);margin-left:6px}
  ul{list-style:none;margin:0;padding:0}
  li{position:relative;padding:7px 0 7px 26px;font-size:16px;line-height:1.5}
  li::before{position:absolute;left:2px;top:7px;font-weight:700}
  .ok li::before{content:"✓";color:#8a9a5b}
  .warn li::before{content:"!";color:var(--red)}
  .note{margin-top:16px;font-size:14px;color:var(--dim);background:#FBF8F1;border:1px solid var(--line);
        border-radius:10px;padding:10px 12px;line-height:1.6}
  .concl{margin-top:30px;background:var(--card);border:1px solid var(--line);border-left:5px solid var(--gold);
         border-radius:12px;padding:18px 22px;font-size:17.5px;line-height:1.6}
  .concl b{color:#7a5f27}
  .foot{margin-top:18px;font-size:13.5px;color:var(--dim);text-align:center}
</style></head><body>
  <h1>两条识别通路对比</h1>
  <div class="sub">同一份 5 天 × 3 节合成课表，分别走「传原件」和「传照片」两条路识别，结果对照。</div>
  <div class="grid">
    <div class="card">
      <div class="hd">
        <div class="ic" style="background:#F3E8CF"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8a6a2f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/></svg></div>
        <div class="ttl">传 Word / Excel 原件</div>
        <div class="badge">推荐</div>
      </div>
      <div class="chip">同一份课表 · 同样这 15 格</div>
      <div class="metric">${leftMetric}<small>（${docxExact} / ${N}）</small></div>
      <ul class="ok">
        <li>走表格结构，不经过文字识别</li>
        <li>班级 / 教室 / 授课内容 / 老师 逐格照搬</li>
        <li>行列、合并单元格都能读出来</li>
      </ul>
      <div class="note">只要课表源文件还在，优先传它 —— 识别结果基本不用改。</div>
    </div>
    <div class="card">
      <div class="hd">
        <div class="ic" style="background:#F2EFE9"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5a564e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-4 4 3 3-2 6 4"/><circle cx="8.5" cy="9" r="1.4"/></svg></div>
        <div class="ttl">传课表照片 / 截图</div>
        <div class="tagred">注意</div>
      </div>
      <div class="chip">同一份课表 · 同样这 15 格</div>
      <div class="metric">${rightMetric}<small>（${imgRec} / ${N}）</small></div>
      <ul class="warn">
        <li>需要人工核对标黄的格子</li>
        <li>照片越清楚越准</li>
        <li>手写、合并单元格、反光会更难认</li>
      </ul>
      <div class="note">标黄的格子系统会请你确认；<b>不点「确认无误」就不会写进课表</b>。</div>
    </div>
  </div>
  <div class="concl">结论：课表有 <b>Word / Excel 原件</b>就直接传原件；只有照片 / 截图时，对着<b>标黄的格子</b>人工核一遍再确认。</div>
  <div class="foot">数据来自系统内置测试 · 同一份 5 天 × 3 节合成课表 · 两个数字均为实测</div>
</body></html>`;

const HTML_PATH = path.join(OUT, '_d_compare.html');
await writeFile(HTML_PATH, D_HTML);
console.log('已写 HTML 源：' + HTML_PATH);
console.log(`左栏 = ${docxExact}/${N}（docx 逐格一字不差）  右栏 = ${imgRec}/${N}（图片 OCR 认出；严格一字不差 ${imgExact}/${N}）`);

let chrome, profile;
try {
  profile = await mkdtemp(path.join(tmpdir(), 'd-render-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const dUrl = 'data:text/html;charset=utf-8;base64,' + Buffer.from(D_HTML, 'utf8').toString('base64');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: dUrl });
  await loaded;
  await cdp.eval(`(async () => { try { await document.fonts.ready; } catch(e){} return 1; })()`);
  await sleep(900);
  const dH = await cdp.eval(`Math.ceil(document.body.getBoundingClientRect().height)`);
  console.log('  内容高：' + dH + ' CSS px');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1280, height: dH, scale: 2 } });
  const buf = Buffer.from(shot.data, 'base64');
  const dPath = path.join(OUT, 'D_两条识别通路对比.png');
  await writeFile(dPath, buf);
  console.log(`✅ 已写出 ${dPath}  ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}  ${Math.round(buf.length / 1024)}KB`);
} catch (e) {
  console.error('💥 ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
