/**
 * 课时统计 · 「两条识别通路」统一夹具实测（只为重画 D 图提供实测数字）
 *
 *   node test/measure_hours_two_paths.mjs [工程目录] [端口]
 *
 * 为什么单独写这一份：
 *   test/hours_recognize_check.mjs 里两条通路**分母不一样** ——
 *     · docx 真值 TBL_ROWS 是 3 天 × 3 节 = 9 格（断言 9/9）
 *     · 图片真值 IMG_ROWS 是 5 天 × 3 节 = 15 格（阈值 13/15）
 *   两个数并列会被误读成「左边更强」。这里统一到**同一份 15 格夹具**：
 *     · 用 test/fixtures/hours_tt.html 的同一份内容造一份**同内容 docx** → 走 docx 通路；
 *     · 用 test/html2png.mjs 把 hours_tt.html 渲成 PNG → 走图片 OCR 通路；
 *     · 两条都按「15 格」统计。
 *
 * 统计口径（如实记录，不凑）：
 *   · docx 通路：逐格**一字不差**（归一化空白后严格相等）→ X/15
 *   · 图片通路：逐格「认出」= 该天记录里与真值的最高相似度 ≥ 0.75 → N/15
 *     （沿用 hours_recognize_check.mjs 的门槛，便于与旧报的 13/15 对齐）
 *     同时另记一份**严格相等**格数，供交叉核对。
 *
 * 不改工程源码、不 commit。结果写 test/.shots/plan-keshitongji/stage1/_measure_two_paths.json
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.argv[2] || path.join(here, '..'));
const PORT = Number(process.argv[3] || 5390);
const CDP = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PY = '/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3';
const NODE = process.execPath;
const FIX = path.join(WORK, 'test', 'fixtures');
const TMPFIX = path.join(FIX, '_two_paths');
const OUT = path.join(WORK, 'test', '.shots', 'plan-keshitongji', 'stage1');
const SUPER = { user: '李老师', pass: 'liyun2026' };

/* ── 统一真值：与 test/fixtures/hours_tt.html 逐格一致（5 天 × 3 节 = 15 格） ── */
const HEADER = ['时间', '周一', '周二', '周三', '周四', '周五'];
const DAYS = HEADER.slice(1);
const ROWS = [
  ['08:00-09:40', '成人书法基础', '少儿口才', '播音发声', '形体训练', '模拟主持'],
  ['10:00-11:40', '形体训练', '即兴评述', '新闻播报', '文学朗读', '影视配音'],
  ['14:00-15:40', '模拟主持', '新闻播报', '成人书法基础', '少儿口才', '即兴评述'],
];
const NCELLS = DAYS.length * ROWS.length;   // 15

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
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

const PAGE_HELPERS = `
window.__mkFile = (b64, name, type) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type });
};
`;

const normText = s => String(s == null ? '' : s).replace(/[\s，。、,.;；:：!！?？~～\-—_（）()【】\[\]{}\/\\|]/g, '');
function sim(a, b) {
  a = normText(a); b = normText(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  let best = 0;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    if (dp[i][j] > best) best = dp[i][j];
  }
  return (2 * best) / (m + n);
}
/* 归一化空白后严格相等：空白不算「字」 */
const sameExact = (a, b) => String(a == null ? '' : a).replace(/\s+/g, '') === String(b == null ? '' : b).replace(/\s+/g, '');

let server, chrome, profile, cdp;
const report = { truth: { header: HEADER, rows: ROWS, cells: NCELLS }, fixtures: {}, docx: null, image: null };

try {
  await mkdir(TMPFIX, { recursive: true });
  await mkdir(OUT, { recursive: true });

  /* ── 1. 造「同内容 docx」── */
  const truthPath = path.join(tmpdir(), 'hours_truth_15.json');
  await writeFile(truthPath, JSON.stringify({ header: HEADER, rows: ROWS }), 'utf8');
  const py = spawnSync(PY, [path.join(WORK, 'test', 'make_hours_fixtures.py'), TMPFIX, truthPath], { encoding: 'utf8' });
  if (py.status !== 0) throw new Error('造 docx 夹具失败：' + (py.stderr || py.stdout));
  const docxPath = path.join(TMPFIX, 'hours_tt.docx');
  console.log('· 同内容 docx：' + docxPath);

  /* ── 2. 渲 PNG（同一份 hours_tt.html）── */
  const pngPath = path.join(TMPFIX, 'hours_tt15.png');
  const pngOut = spawnSync(NODE, [path.join(WORK, 'test', 'html2png.mjs'),
    path.join(FIX, 'hours_tt.html'), pngPath, '1100', '2'], { encoding: 'utf8', cwd: WORK });
  if (pngOut.status !== 0) throw new Error('渲 PNG 失败：' + (pngOut.stderr || pngOut.stdout));
  console.log('· 图片夹具：' + pngPath + '  ' + ((pngOut.stdout || '').trim().split('\n')[0] || ''));
  report.fixtures = { docx: docxPath, png: pngPath };

  const docxB64 = (await readFile(docxPath)).toString('base64');
  const pngB64 = (await readFile(pngPath)).toString('base64');

  /* ── 3. 起服务 + 真 Chrome ── */
  server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务' });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'hours-measure-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
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
  await sleep(2600);

  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { role: Auth.role(), name: Auth.name() };
  })()`);
  console.log('· 已登录：' + login.name + '（role=' + login.role + '）');

  /* ── 4. docx 通路（15 格，逐格一字不差）── */
  console.log('\n【docx 通路】readSource(hours_tt.docx) …');
  const docx = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(docxB64)}, 'hours_tt.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, ms: m.ms, days: m.days,
      rows: m.rows.map(r => ({ label: r.label, time: r.time,
        cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text])) })),
      n: m.records.length };
  })()`);
  const docxCells = [];
  let docxExact = 0;
  for (let i = 0; i < ROWS.length; i++) {
    for (let j = 0; j < DAYS.length; j++) {
      const got = ((docx.rows[i] || {}).cells || {})[DAYS[j]];
      const want = ROWS[i][j + 1];
      const hit = sameExact(got, want);
      if (hit) docxExact++;
      docxCells.push({ row: i, day: DAYS[j], want, got: got == null ? null : got, exact: hit });
    }
  }
  report.docx = { via: docx.via, mode: docx.mode, ms: docx.ms, days: docx.days, records: docx.n,
    cells: NCELLS, exactMatch: docxExact, detail: docxCells };
  console.log(`  via=${docx.via} mode=${docx.mode} 数据行=${docx.rows.length} records=${docx.n}`);
  console.log(`  ✅ 逐格一字不差：${docxExact}/${NCELLS}`);
  const dMiss = docxCells.filter(c => !c.exact).map(c => `${c.day}「${c.want}」→「${c.got}」`);
  if (dMiss.length) console.log('  未中：' + dMiss.join('、'));

  /* ── 5. 图片 OCR 通路（15 格，认出数 + 严格数）── */
  console.log('\n【图片 OCR 通路】readSource(hours_tt.png) …（真跑识别，耐心等）');
  const img = await cdp.eval(`(async () => {
    ${PAGE_HELPERS}
    const f = window.__mkFile(${JSON.stringify(pngB64)}, 'hours_tt15.png', 'image/png');
    const m = await Hours.readSource(f, () => {});
    return { via: m.via, mode: m.mode, ms: m.ms, days: m.days, W: m.width, H: m.height,
      unassigned: m.unassigned.length, warnings: m.warnings,
      rows: m.rows.map(r => ({ label: r.label, time: r.time,
        cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v.text])) })),
      records: m.records.map(r => ({ day: r.day, startMin: r.startMin, endMin: r.endMin,
        cls: r.cls, room: r.room, title: r.title, raw: r.raw, teacher: r.teacher, conf: r.conf })) };
  })()`);
  console.log(`  画布 ${img.W}×${img.H} · 用时 ${(img.ms / 1000).toFixed(1)}s · 模式 ${img.mode} · 星期列 ${JSON.stringify(img.days)}`);
  console.log(`  识别到 ${img.records.length} 条；表外文字 ${img.unassigned} 处`);

  const recs = img.records || [];
  const imgCells = [];
  let imgHit = 0, imgExact = 0;
  for (let i = 0; i < ROWS.length; i++) {
    for (let j = 0; j < DAYS.length; j++) {
      const want = ROWS[i][j + 1];
      const day = DAYS[j];
      const cellText = ((img.rows[i] || {}).cells || {})[day];
      const dayRecs = recs.filter(r => r.day === day);
      let best = 0, bestTxt = '';
      for (const r of dayRecs) {
        const s = Math.max(sim(r.title || '', want), sim(r.raw || '', want));
        if (s > best) { best = s; bestTxt = r.title || r.raw || ''; }
      }
      const hit = best >= 0.75;
      const ex = sameExact(cellText, want);
      if (hit) imgHit++;
      if (ex) imgExact++;
      imgCells.push({ row: i, day, want, cellText: cellText == null ? null : cellText,
        bestSim: Number(best.toFixed(3)), bestMatch: bestTxt, recognized: hit, exact: ex });
    }
  }
  report.image = { via: img.via, mode: img.mode, ms: img.ms, days: img.days, W: img.W, H: img.H,
    records: recs.length, unassigned: img.unassigned, warnings: img.warnings,
    cells: NCELLS, recognized: imgHit, exactMatch: imgExact, detail: imgCells,
    allRecords: recs };
  console.log(`  ✅ 认出（相似度≥0.75）：${imgHit}/${NCELLS} = ${(imgHit / NCELLS * 100).toFixed(0)}%`);
  console.log(`  · 严格一字不差：${imgExact}/${NCELLS}`);
  const iMiss = imgCells.filter(c => !c.recognized).map(c => `${c.day}「${c.want}」(最高 ${c.bestSim} →「${c.bestMatch}」)`);
  if (iMiss.length) console.log('  未认出：' + iMiss.join('、'));

  await writeFile(path.join(OUT, '_measure_two_paths.json'), JSON.stringify(report, null, 2));
  console.log('\n===JSON===\n' + JSON.stringify({
    docxExact: report.docx.exactMatch, docxCells: NCELLS,
    imageRecognized: report.image.recognized, imageExact: report.image.exactMatch
  }, null, 2));
} catch (e) {
  console.error('\n💥 ' + (e && e.message ? e.message : e));
  if (e && e.stack) console.error(String(e.stack).split('\n').slice(0, 12).join('\n'));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
