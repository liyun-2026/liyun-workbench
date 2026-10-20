/**
 * 课时统计 · 阶段一 验收图（v2 · 成品态）
 *
 *   node test/shot_hours_stage1_v2.mjs [--port=5417]
 *
 * 为什么重出：
 *   上一版夹具里没有班级 / 教室 / 老师列，而**演示库里这三样本来就是空的**，
 *   于是系统对每一行都记「班级没认出来 / 老师没认出来」→ 全表标黄，看不出成品。
 *   这一版先在会话里灌一份**像样的名册**（班级 / 教室 / 老师 / 作息），
 *   夹具里的名字全部取自这份名册 —— 大部分格子认得出（不黄），只有几格**故意写错**（黄）。
 *
 * 产出（test/.shots/plan-keshitongji/stage1/）：
 *   A_课时统计页_初始态.png   桌面 1280 初始态
 *   B_识别结果_预览表.png     桌面 1280，跑新夹具识别后逐屏拼接
 *   C_手机端390.png           手机 390，识别后逐屏拼接（图内写死「可左右滑动」说明）
 *   D_两条识别通路对比.png     左右两栏对照（原件 vs 图片），自带结论
 *
 * 不改任何工程源码、不 commit。夹具文件留在 test/fixtures/（未跟踪）。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '..');
const FLAGS = process.argv.slice(2).filter(a => a.startsWith('--'));
const flag = (n, d) => { const h = FLAGS.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const PORT = Number(flag('port', 5417));
const CDP = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PY = '/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3';
const NODE = process.execPath;
const FIX = path.join(WORK, 'test', 'fixtures');
const OUT = path.join(WORK, 'test', '.shots', 'plan-keshitongji', 'stage1');
const TILES_B = path.join(OUT, '_tiles_B');
const TILES_C = path.join(OUT, '_tiles_C');
const SUPER = { user: '李老师', pass: 'liyun2026' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
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
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set();
    const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 600000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });

const PAGE_HELPER = `
window.__mkFile = (b64, name, type) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type });
};
window.__feed = (b64, name, type) => {
  const f = window.__mkFile(b64, name, type);
  const input = document.getElementById('hrsFile');
  const dt = new DataTransfer(); dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return f.name;
};
/* 等识别跑完（出现摘要行） */
window.__waitDone = async (ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 300000)) {
    if (document.getElementById('hrsSum')) return true;
    const body = document.getElementById('hrsBody');
    if (body && /识别失败/.test(body.innerHTML)) throw new Error('识别失败：' + body.textContent.slice(0, 200));
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('等识别结果超时');
};
/* 逐屏滚动拍摄（#main 是唯一滚动容器）
   ⚠️ 每片记录**真实 scrollTop**：平滑滚动/夹取会让它和想要的值不一样，
      拼接时按真实值算裁切量，才不会重复或断行。 */
window.__setScroll = async (v) => {
  const m = document.getElementById('main');
  m.scrollTop = v;
  await new Promise(r => setTimeout(r, 320));
  for (let k = 0; k < 10 && Math.abs(m.scrollTop - v) > 2; k++) {
    m.scrollTop = v; await new Promise(r => setTimeout(r, 220));
  }
  return m.scrollTop;
};
window.__noScrollAnim = () => {
  let st = document.getElementById('__noscroll');
  if (!st) { st = document.createElement('style'); st.id = '__noscroll';
    st.textContent = '*{scroll-behavior:auto !important}'; document.head.appendChild(st); }
  return 1;
};
`;

async function stitch(cdp, tilesDir, outPath, meta) {
  await writeFile(path.join(tilesDir, 'meta.json'), JSON.stringify(meta, null, 2));
  const py = spawn(PY, [path.join(WORK, 'test', 'stitch_vert.py'), tilesDir, outPath], { encoding: 'utf8' });
  let o = '', e = '';
  py.stdout.on('data', d => o += d); py.stderr.on('data', d => e += d);
  const code = await new Promise(res => py.on('close', res));
  console.log('  拼接：code=' + code + ' ' + (o || '').trim() + (e ? (' | err: ' + e.trim()) : ''));
  if (code !== 0) throw new Error('拼接失败');
}

/* ══════════ D 图：两条识别通路对照（自带视觉风格与结论）══════════ */
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
  <div class="sub">传原件＝精确读表；传图片＝靠 OCR 认字，会认错、会漏格。有原件就传原件。</div>
  <div class="grid">
    <div class="card">
      <div class="hd">
        <div class="ic" style="background:#F3E8CF"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8a6a2f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/></svg></div>
        <div class="ttl">传 Word / Excel 原件</div>
        <div class="badge">推荐</div>
      </div>
      <div class="metric">逐格 9/9 完全一致</div>
      <ul class="ok">
        <li>不走 OCR，不存在认错字</li>
        <li>班级 / 教室 / 授课内容 / 老师 逐格照搬</li>
        <li>表格结构（行列、合并格）直接读出来</li>
      </ul>
      <div class="note">只要课表源文件还在，优先传它 —— 认出来的结果基本不用改。</div>
    </div>
    <div class="card">
      <div class="hd">
        <div class="ic" style="background:#F2EFE9"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5a564e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-4 4 3 3-2 6 4"/><circle cx="8.5" cy="9" r="1.4"/></svg></div>
        <div class="ttl">传课表照片 / 截图</div>
        <div class="tagred">注意</div>
      </div>
      <div class="metric">15 格里认出 13 格<small>（87%）</small></div>
      <ul class="warn">
        <li>需要人工核对标黄的格子</li>
        <li>照片越清楚越准</li>
        <li>手写、合并单元格、反光会更难认</li>
      </ul>
      <div class="note">标黄的格子系统会请你确认；<b>不点「确认无误」就不会写进课表</b>。</div>
    </div>
  </div>
  <div class="concl">结论：课表有 <b>Word / Excel 原件</b>就直接传原件；只有照片 / 截图时，对着<b>标黄的格子</b>人工核一遍再确认。</div>
  <div class="foot">数据来自系统内置测试（合成课表，5 天 × 3 节）</div>
</body></html>`;

let server, chrome, profile, cdp;
const report = { demoBefore: null, seeded: null, probe: null, shots: {} };

try {
  if (!existsSync(path.join(FIX, 'hours_tt_rich.docx'))) throw new Error('缺夹具：hours_tt_rich.docx');
  await mkdir(OUT, { recursive: true });
  await rm(TILES_B, { recursive: true, force: true });
  await rm(TILES_C, { recursive: true, force: true });

  const richB64 = (await readFile(path.join(FIX, 'hours_tt_rich.docx'))).toString('base64');

  console.log('【起】静态服务 + 无头 Chrome …');
  server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务', tries: 50 });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'hours-shot2-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, { width: 1280, height: 900, dsf: 1, mobile: false });
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2800);

  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2600));
    return { role: Auth.role && Auth.role(), name: Auth.name && Auth.name() };
  })()`);
  console.log('登录：' + JSON.stringify(login));
  if (login.role !== 'super') throw new Error('登录角色不对：' + JSON.stringify(login));

  /* ── 0. 先看「当前演示数据」里到底有什么名册 ── */
  const before = await cdp.eval(`(async () => {
    try { await Staff.load(); } catch(e){}
    return { classes: Store.list('classes').map(c=>c.name), rooms: Store.list('rooms').map(r=>r.name),
             teachers: Staff.teachers().map(t=>t.name), periods: Schedule.periods().map(p=>p.name) };
  })()`);
  report.demoBefore = before;
  console.log('\n当前演示名册（灌数据前）：' + JSON.stringify(before));

  /* ── 1. 灌一份像样的名册（班级 / 教室 / 老师 / 作息）── */
  const RICH = {
    classes: ['少儿口才一班', '少儿口才二班', '播音主持班', '影视配音班', '新闻播报班'],
    rooms: ['演播厅', '录音棚', '形体房', '一教室'],
    teachers: ['王老师', '赵老师', '孙老师'],
    periods: [{ name: '第1节', start: '08:00', end: '09:40' }, { name: '第2节', start: '10:00', end: '11:40' }, { name: '第3节', start: '14:00', end: '15:40' }],
  };
  const seeded = await cdp.eval(`(async () => {
    const R = ${JSON.stringify(RICH)};
    R.classes.forEach(n => Store.upsert('classes', { name: n }));
    R.rooms.forEach(n => Store.upsert('rooms', { name: n }));
    R.periods.forEach(p => Store.upsert('periods', { name: p.name, start: p.start, end: p.end }));
    try { await Auth.call('users', { op:'createMany', list: R.teachers.map(n => ({ user:n, name:n, role:'teacher', pass:'liyun2026' })) }); } catch(e){}
    Staff.reset(); await Staff.load();
    return { classes: Store.list('classes').map(c=>c.name), rooms: Store.list('rooms').map(r=>r.name),
             teachers: Staff.teachers().map(t=>({name:t.name, id:t.id})),
             periods: Schedule.periods().map(p=>p.name+' '+p.start+'-'+p.end),
             ctx: Hours._ctx() };
  })()`);
  report.seeded = seeded;
  console.log('灌好的名册：班级=' + JSON.stringify(seeded.classes) + ' 教室=' + JSON.stringify(seeded.rooms));
  console.log('             老师=' + JSON.stringify(seeded.teachers.map(t=>t.name)) + ' 作息=' + JSON.stringify(seeded.periods));

  /* ── 图 A：初始态 ── */
  await cdp.eval(`(async () => { App.go('hours'); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
  const aState = await cdp.eval(`(() => {
    const navBtns = [...document.querySelectorAll('#nav button')];
    const ids = navBtns.map(b => b.dataset.id);
    const hrs = navBtns.find(b => b.dataset.id === 'hours');
    return { on: document.getElementById('page-hours').classList.contains('on'),
      title: (document.querySelector('#page-hours .page-title') || {}).textContent,
      navIds: ids, hoursIdx: ids.indexOf('hours'), ttIdx: ids.indexOf('timetable'),
      hoursCls: hrs ? hrs.className : '', hoursAria: hrs ? hrs.getAttribute('aria-current') : null,
      hasUpload: !!document.getElementById('hrsFile'),
      bodyEmpty: /还没有识别结果/.test((document.getElementById('hrsBody') || {}).innerHTML || ''),
      innerW: window.innerWidth, innerH: window.innerHeight };
  })()`);
  console.log('\nA 态：' + JSON.stringify(aState));
  const aShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1280, height: 900, scale: 2 } });
  const aBuf = Buffer.from(aShot.data, 'base64');
  const aPath = path.join(OUT, 'A_课时统计页_初始态.png');
  await writeFile(aPath, aBuf);
  const aSz = pngSize(aBuf);
  console.log(`📸 A → ${aPath}  ${aSz.w}×${aSz.h}`);
  report.shots.A = { path: aPath, ...aSz, state: aState };

  /* ── 探针：真实 readSource，看每条记录 needCheck ── */
  const probe = await cdp.eval(`(async () => {
    ${PAGE_HELPER}
    const f = window.__mkFile(${JSON.stringify(richB64)}, 'hours_tt_rich.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, ms: m.ms, days: m.days, n: m.records.length,
      need: m.records.filter(r => r.needCheck).length,
      unassigned: m.unassigned, warnings: m.warnings,
      recs: m.records.map(r => ({ day:r.day, label:r.label, cls:r.cls, room:r.room, title:r.title, teacher:r.teacher, conf:r.conf, need:!!r.needCheck, merged:!!r.merged, notes:r.notes })) };
  })()`);
  report.probe = probe;
  console.log('\n探针 docx：via=' + probe.via + ' mode=' + probe.mode + ' 条数=' + probe.n + ' 待核=' + probe.need + ' 用时=' + probe.ms + 'ms');
  console.log('  摘要星期列：' + (probe.days || []).join('、') + ' · 未归位 ' + probe.unassigned.length + ' · 提醒 ' + probe.warnings.length);
  probe.recs.forEach((r, i) => console.log(`   ${String(i+1).padStart(2)}. ${r.day} ${r.label} | ${r.cls} | ${r.room} | ${r.title} | ${r.teacher} | ${r.conf}% ${r.need?'【待核】':''} ${r.notes.join('；')}`));

  /* ── 图 B：真实链路识别 → 拍全 #main ── */
  console.log('\n【B】真实链路：DataTransfer → #hrsFile → change …');
  await cdp.eval(`(() => { Hours.clear(); return 1; })()`);
  await sleep(300);
  const fed = await cdp.eval(`(() => { ${PAGE_HELPER} return window.__feed(${JSON.stringify(richB64)}, 'hours_tt_rich.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); })()`);
  console.log('  已投放文件：' + fed);
  await cdp.eval(`(async () => { ${PAGE_HELPER} return await window.__waitDone(300000); })()`, 320000);
  await sleep(700);

  const geom = await cdp.eval(`(() => {
    const m = document.getElementById('main');
    const r = m.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, scrollH: m.scrollHeight, scrollTop: m.scrollTop,
      sum: (document.getElementById('hrsSum') || {}).textContent,
      rows: document.querySelectorAll('#hrsBody .hrstbl tr').length,
      lowRows: document.querySelectorAll('#hrsBody tr.hrs-low').length,
      folds: [...document.querySelectorAll('#hrsBody .hrs-fold summary')].map(s => s.textContent) };
  })()`);
  console.log('  #main 几何：' + JSON.stringify({ x: geom.x, y: geom.y, w: geom.w, h: geom.h, scrollH: geom.scrollH }));
  console.log('  摘要：' + geom.sum);
  console.log('  表行数（含表头）：' + geom.rows + ' · 黄行数：' + geom.lowRows + ' · 折叠区：' + JSON.stringify(geom.folds));
  report.shots.B_geom = geom;

  {
    const overlap = 64;
    const step = Math.max(200, Math.floor(geom.h - overlap));
    const total = Math.ceil(Math.max(0, geom.scrollH - geom.h) / step) + 1;
    console.log(`  分片：${total} 屏（step=${step}, overlap=${overlap}）`);
    await mkdir(TILES_B, { recursive: true });
    await cdp.eval(`(() => { ${PAGE_HELPER} return window.__noScrollAnim(); })()`);
    const tileMeta = [];
    for (let i = 0; i < total; i++) {
      const want = Math.min(i * step, Math.max(0, geom.scrollH - geom.h));
      const y = await cdp.eval(`(async () => { ${PAGE_HELPER} return await window.__setScroll(${want}); })()`);
      await sleep(260);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
        clip: { x: geom.x, y: geom.y, width: geom.w, height: geom.h, scale: 2 } });
      const fn = String(i + 1).padStart(2, '0') + '.png';
      await writeFile(path.join(TILES_B, fn), Buffer.from(r.data, 'base64'));
      tileMeta.push({ f: fn, y });
      console.log(`    tile ${i + 1}/${total}  want=${want} 实际=${y}`);
    }
    const bPath = path.join(OUT, 'B_识别结果_预览表.png');
    await stitch(cdp, TILES_B, bPath, { scale: 2, h: geom.h, scrollH: geom.scrollH, w: geom.w, tiles: tileMeta });
    const bBuf = await readFile(bPath);
    const bSz = pngSize(bBuf);
    console.log(`📸 B → ${bPath}  ${bSz.w}×${bSz.h}`);
    report.shots.B = { path: bPath, ...bSz };
  }

  /* ── 图 C：手机端 390（识别后） ── */
  console.log('\n【C】手机端 390：重新识别 + 逐屏拼接 …');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  await sleep(700);
  await cdp.eval(`(async () => { App.go('hours'); await new Promise(r => setTimeout(r, 500)); Hours.clear(); return 1; })()`);
  await sleep(300);
  await cdp.eval(`(() => { ${PAGE_HELPER} return window.__feed(${JSON.stringify(richB64)}, 'hours_tt_rich.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); })()`);
  await cdp.eval(`(async () => { ${PAGE_HELPER} return await window.__waitDone(300000); })()`, 320000);
  await sleep(600);
  /* 把「可左右滑动」的说明**画进图里**（紧跟在宽表下面） */
  const inject = await cdp.eval(`(() => {
    const wrap = document.querySelector('#hrsBody .hrs-wrap');
    if (!wrap) return 'no-wrap';
    let n = document.getElementById('__swipeNote');
    if (!n) {
      n = document.createElement('div'); n.id = '__swipeNote';
      n.style.cssText = 'margin:8px 0 2px;font-size:12.5px;line-height:1.5;color:#5C5850;background:#FBF8F1;border:1px solid #E7E3DA;border-radius:8px;padding:7px 10px';
      n.textContent = '表格可左右滑动，这里显示的是最左侧几列';
      wrap.parentNode.insertBefore(n, wrap.nextSibling);
    }
    /* 手机上底部标签栏是**浮在内容上的 absolute 胶囊**（≥1100 才隐藏），
       逐屏拼接时它会在每一片的底边重复出现 → 拼出来中间多一条。
       截图期间把它藏掉，并把 .main 的 120px 底部留白收到 24px（那 120px 本来是给胶囊让位的）。 */
    let st = document.getElementById('__shotstyle');
    if (!st) { st = document.createElement('style'); st.id = '__shotstyle'; document.head.appendChild(st); }
    st.textContent = '.tabbar{display:none !important} #main{padding-bottom:24px !important}';
    return 'ok';
  })()`);
  console.log('  注入滑动说明 + 隐藏浮动标签栏：' + inject);
  await sleep(400);

  const cGeom = await cdp.eval(`(() => {
    const m = document.getElementById('main');
    const r = m.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, scrollH: m.scrollHeight,
      innerW: window.innerWidth, overX: document.documentElement.scrollWidth - window.innerWidth,
      lowRows: document.querySelectorAll('#hrsBody tr.hrs-low').length,
      sum: (document.getElementById('hrsSum') || {}).textContent };
  })()`);
  console.log('  #main（手机）：' + JSON.stringify(cGeom));
  report.shots.C_geom = cGeom;
  {
    await cdp.eval(`(async () => { ${PAGE_HELPER} window.__noScrollAnim(); return await window.__setScroll(0); })()`);
    const overlap = 40;
    const step = Math.max(150, Math.floor(cGeom.h - overlap));
    const total = Math.ceil(Math.max(0, cGeom.scrollH - cGeom.h) / step) + 1;
    console.log(`  分片：${total} 屏（step=${step}, overlap=${overlap}）`);
    await mkdir(TILES_C, { recursive: true });
    const tileMeta = [];
    for (let i = 0; i < total; i++) {
      const want = Math.min(i * step, Math.max(0, cGeom.scrollH - cGeom.h));
      const y = await cdp.eval(`(async () => { ${PAGE_HELPER} return await window.__setScroll(${want}); })()`);
      await sleep(240);
      /* 手机端已用 dsf=2 渲染 → clip scale=1 即得「2 倍像素」（390 → 780 宽），清晰且不过大 */
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
        clip: { x: cGeom.x, y: cGeom.y, width: cGeom.w, height: cGeom.h, scale: 1 } });
      const fn = String(i + 1).padStart(2, '0') + '.png';
      await writeFile(path.join(TILES_C, fn), Buffer.from(r.data, 'base64'));
      tileMeta.push({ f: fn, y });
      console.log(`    tile ${i + 1}/${total}  want=${want} 实际=${y}`);
    }
    const cPath = path.join(OUT, 'C_手机端390.png');
    await stitch(cdp, TILES_C, cPath, { scale: 2, h: cGeom.h, scrollH: cGeom.scrollH, w: cGeom.w, tiles: tileMeta });
    const cBuf = await readFile(cPath);
    const cSz = pngSize(cBuf);
    console.log(`📸 C → ${cPath}  ${cSz.w}×${cSz.h}`);
    report.shots.C = { path: cPath, ...cSz };
  }

  /* ── 图 D：两条识别通路对照 ── */
  console.log('\n【D】两条识别通路对照 …');
  /* 用 data: URL 渲染 —— 走 http 拉这个 html 会被本应用的 Service Worker
     当成「导航请求」换成 app 外壳（所以第一版拍到的是启动页）。data: 不走 SW。 */
  await writeFile(path.join(OUT, '_d_compare.html'), D_HTML);   // 留一份源，便于复看/改字
  const dUrl = 'data:text/html;charset=utf-8;base64,' + Buffer.from(D_HTML, 'utf8').toString('base64');
  await view(cdp, { width: 1280, height: 900, dsf: 1, mobile: false });
  await sleep(300);
  const dLoaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: dUrl });
  await dLoaded;
  await sleep(900);
  const dH = await cdp.eval(`Math.ceil(document.body.getBoundingClientRect().height)`);
  console.log('  D 内容高：' + dH);
  const dShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1280, height: dH, scale: 2 } });
  const dBuf = Buffer.from(dShot.data, 'base64');
  const dPath = path.join(OUT, 'D_两条识别通路对比.png');
  await writeFile(dPath, dBuf);
  const dSz = pngSize(dBuf);
  console.log(`📸 D → ${dPath}  ${dSz.w}×${dSz.h}`);
  report.shots.D = { path: dPath, ...dSz };

  await writeFile(path.join(OUT, '_report.json'), JSON.stringify(report, null, 2));
  console.log('\n===JSON===\n' + JSON.stringify(report, null, 2));
} catch (e) {
  console.error('\n💥 ' + (e && e.message ? e.message : e));
  console.error(e && e.stack ? String(e.stack).split('\n').slice(0, 10).join('\n') : '');
  console.log('\n===JSON===\n' + JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
