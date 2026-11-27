/**
 * ==5.80== 成绩录入：建场次能选日期 / 已建的场次能改日期 / 能删一场
 *   node test/exam_sheet_check.mjs [端口]
 * 产出 test/.shots/examsheet/exam-sheet-desktop.png
 *
 * 主理人 2026-11-27 原话：
 *   「这个输入考试的这个，你要让我有一个可以选择日期的窗口呀，而且你要给我一个
 *     可以删除这场考试的一个窗口。你像我今天填的是明天的考试，那今天给我显示的今天，
 *     那你让我怎么去处理呢？」
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5522);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'examsheet');
const ADMIN = { user: '场次日期检查教务', pass: 'exampass123' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch { /* 等 */ } await sleep(gap); }
  throw new Error('等不到' + what);
}
let pass = 0, failed = 0;
const ok = (cond, label, extra) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { failed++; console.log('  ❌ ' + label + (extra ? '\n        → ' + extra : '')); } };
const section = (t) => console.log('\n' + t);

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('超时')), 5000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('连不上')); }; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach((f) => f(m.params)); };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise((res) => { const set = this.events.get(method) || new Set(); const fn = (p) => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome;
try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: 'server' });
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const DBG = 9494;
  const profile = await mkdtemp(path.join(tmpdir(), 'exshot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded; await sleep(600);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ADMIN.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ADMIN.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1500));
  })()`);

  const seeded = await cdp.eval(`(() => {
    const cls = Store.upsert('classes', { id: null, name: '考前05班' });
    const names = ['石娅楠','李苏嬿','刘艺霖','韩金孜','唐川淇'];
    const s = names.map((n, i) => Store.upsert('students', { id: null, name: n, classId: cls.id, ord: i + 1 }));
    Store.set('_exCls', cls.id); Store.set('_exSheet', '');
    App.go('exam');
    return { cls: cls.id, ids: s.map(x => x.id) };
  })()`);
  await sleep(600);

  section('▶ 1. 日期框在不在、默认是不是今天');
  const r1 = await cdp.eval(`(() => {
    const n = document.getElementById('exNewDate');
    return { exists: !!n, type: n ? n.type : '', val: n ? n.value : '', today: Util.today() };
  })()`);
  ok(r1.exists && r1.type === 'date', '「哪天考」是一个真的日期选择框（不是死值）', JSON.stringify(r1));
  ok(r1.val === r1.today, '默认就是今天（不改也能照旧建今天的场次）', r1.val + ' vs ' + r1.today);

  section('▶ 2. 今天建「明天」的考试 → 存下来的必须是明天');
  const r2 = await cdp.eval(`(() => {
    const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+1);
    const tomorrow = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    document.getElementById('exSheetName').value = '27届考前集训第二次模拟考试';
    document.getElementById('exNewDate').value = tomorrow;
    Exam.newSheet();
    const s = Store.list('exam_sheets').filter(x => !x._d)[0];
    const sel = document.getElementById('exSheetSel');
    return { tomorrow, date: s ? s.date : '', name: s ? s.name : '',
             selTxt: sel ? sel.options[sel.selectedIndex].textContent : '',
             curRow: getComputedStyle(document.getElementById('exCurRow')).display,
             dtVal: document.getElementById('exSheetDate').value };
  })()`);
  ok(r2.date === r2.tomorrow, '存下来的是明天，不是今天', '存成 ' + r2.date + '（应为 ' + r2.tomorrow + '）');
  ok(r2.selTxt.indexOf(r2.tomorrow) >= 0, '场次下拉里显示的就是明天', r2.selTxt);
  ok(r2.curRow !== 'none', '选中这场后「这场考试的日期」那一行亮出来了', 'display=' + r2.curRow);
  ok(r2.dtVal === r2.tomorrow, '日期框回显的也是明天', r2.dtVal);

  section('▶ 3. 建错了能改（这就是他卡住的地方）');
  const r3 = await cdp.eval(`(() => {
    const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+2);
    const after = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    Exam.setSheetDate(after);
    const s = Store.list('exam_sheets').filter(x => !x._d)[0];
    const sel = document.getElementById('exSheetSel');
    return { after, date: s ? s.date : '', selTxt: sel ? sel.options[sel.selectedIndex].textContent : '' };
  })()`);
  ok(r3.date === r3.after, '改完当场生效（不用删了重建）', r3.date);
  ok(r3.selTxt.indexOf(r3.after) >= 0, '下拉里的日期跟着变', r3.selTxt);

  section('▶ 4. 「删除这一场」：连成绩一起删干净');
  const r4 = await cdp.eval(`(() => {
    const sheet = Store.list('exam_sheets').filter(x => !x._d)[0];
    const sid = ${JSON.stringify(seeded.ids[0])};
    /* 先录一条成绩，确认删除会把成绩一起带走 */
    Store.upsert('exam_scores', { id: null, sheetId: sheet.id, clsId: ${JSON.stringify(seeded.cls)},
                                  studentId: sid, scoreRead: 88, scoreNews: 90, scoreTalk: 85 });
    const before = Store.list('exam_scores').filter(x => !x._d && x.sheetId === sheet.id).length;
    window.confirm = () => true;                    // 确认框点「确定」
    Exam.delSheet();
    const afterSheets = Exam.sheets(${JSON.stringify(seeded.cls)}).length;
    const afterScores = Store.list('exam_scores').filter(x => !x._d && x.sheetId === sheet.id).length;
    const rawSheet = Store.get('exam_sheets', []).filter(x => x.id === sheet.id && x._d).length;
    const curRow = getComputedStyle(document.getElementById('exCurRow')).display;
    return { before, afterSheets, afterScores, rawSheet, curRow };
  })()`);
  ok(r4.before === 1, '删之前这一场有 1 条成绩', 'before=' + r4.before);
  ok(r4.afterSheets === 0, '这一场从列表里消失了', 'afterSheets=' + r4.afterSheets);
  ok(r4.afterScores === 0, '它的成绩也一起删掉了（各端曲线不会留半条）', 'afterScores=' + r4.afterScores);
  ok(r4.rawSheet === 1, '删的是墓碑式软删（留 _d 标记，别的设备同步不会把它复活）', 'raw=' + r4.rawSheet);
  ok(r4.curRow === 'none', '删完没有场次了，「这场日期 / 删除」那行自己收起来', 'display=' + r4.curRow);

  section('▶ 5. 出图（建一场明天的，看这一行长什么样）');
  await cdp.eval(`(() => {
    const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+1);
    const tomorrow = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    document.getElementById('exSheetName').value = '27届考前集训第一次模拟考试';
    document.getElementById('exNewDate').value = tomorrow;
    Exam.newSheet();
    const box = document.getElementById('exSheet'); const card = box.closest('.card') || box;
    card.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(700);
  const rect = await cdp.eval(`(() => {
    const box = document.getElementById('exSheet');
    const card = box.closest('.card') || box;
    const r = card.getBoundingClientRect();
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: Math.min(r.width + 12, 1428), height: Math.min(r.height + 12, 900) };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 2 } });
  await writeFile(path.join(OUT, 'exam-sheet-desktop.png'), Buffer.from(shot.data, 'base64'));
  console.log('📸 ' + path.join(OUT, 'exam-sheet-desktop.png'));

  console.log('\n────────────────────────────────────────');
  console.log(failed ? `❌ 失败 ${failed} / ${pass + failed} 项` : `✅ 全部通过（${pass} 项）`);
  if (failed) process.exitCode = 1;
} catch (e) {
  console.log('\n❌ 脚本中断：' + (e && e.message));
  failed++;
  process.exitCode = 1;
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}
