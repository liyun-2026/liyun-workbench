/**
 * 端到端验收：模考三科录入 + 自动总分 + 五等评段 + 合格线 + 学员档案三科强弱
 *   node test/exam_check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5321);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots');
const SUPER = { user: '测试教务', pass: 'shotpass123' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
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
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name){ const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('  📸 ' + name); }

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

try {
  await mkdir(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'exam-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  const r = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), mode: Auth.mode };
  })()`);
  if (!r.gateOff) throw new Error('登录失败');
  console.log('已登录（模式：' + r.mode + '）\n');

  console.log('① 三科录入 → 自动总分 + 五等 + 合格线');
  const setup = await cdp.eval(`(async () => {
    const c = Store.upsert('classes', { name: '5班' });
    const cid = c.id;
    const st = Store.upsert('students', { classId: cid, name: '张三' });
    const sid = st.id;
    const sh = Store.upsert('exam_sheets', { clsId: cid, name: '9月第3周模考', date: Util.today() });
    Store.set('_exCls', cid);
    Store.set('_exSheet', sh.id);
    App.go('exam');
    await new Promise(r => setTimeout(r, 400));
    // 三科：朗读88 / 播报76 / 评述62
    Exam.saveScore(sid, 'read', 88);
    Exam.saveScore(sid, 'news', 76);
    Exam.saveScore(sid, 'talk', 62);
    await new Promise(r => setTimeout(r, 200));
    return { cid, sid, shid: sh.id };
  })()`);
  await sleep(400);

  // 抓取录入页里张三那行的文本
  const rowTxt = await cdp.eval(`(() => {
    const items = [...document.querySelectorAll('#exSheet .item')];
    const it = items.find(x => x.textContent.indexOf('张三') >= 0);
    return it ? it.textContent.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  console.log('   录入行文本：', JSON.stringify(rowTxt));
  ok(/226 \/ 300/.test(rowTxt), '总分栏显示「226 / 300」(88+76+62)');
  ok(/三等·中等/.test(rowTxt), '总分评段显示「三等·中等」(226→75.3→三等)');
  const statTxt = await cdp.eval(`document.getElementById('exExpStat') ? document.getElementById('exExpStat').textContent : (document.querySelector('.page .hint')||{}).textContent || ''`);
  ok(/过线 1\/1/.test(statTxt), '统计显示「过线 1/1」(226≥200合格线)');

  await cdp.eval(`(() => { const el = [...document.querySelectorAll('#exSheet .item')].find(x => x.textContent.indexOf('张三') >= 0); if (el) el.scrollIntoView({ block: 'center' }); })()`);
  await sleep(300);
  await shot(cdp, 'exam-entry.png');

  console.log('\n② 学员档案：三科强弱 + 最薄弱板块');
  const prof = await cdp.eval(`(async () => {
    Store.set('_pfCls', ${JSON.stringify(setup.cid)});
    Store.set('_pfStu', ${JSON.stringify(setup.sid)});
    App.go('profile');
    await new Promise(r => setTimeout(r, 600));
    const card = [...document.querySelectorAll('#pfBody .card')].find(c => c.querySelector('h2') && c.querySelector('h2').textContent.indexOf('模考成绩') >= 0);
    if (!card) return { err: '没找到模考成绩卡' };
    card.scrollIntoView({ block: 'start' });
    const txt = card.textContent.replace(/\\s+/g, ' ').trim();
    return { txt, hasWeak: !!card.querySelector('.weak'), weakest: (txt.match(/最薄弱板块：(\\S+)/) || [])[1] || '' };
  })()`);
  console.log('   档案卡文本片段：', JSON.stringify((prof.txt || '').slice(0, 200)));
  ok(!prof.err, '找到模考成绩卡片');
  ok(prof.hasWeak, '显示「三科强弱」面板(.weak)');
  ok(/话题评述/.test(prof.txt) && /朗读/.test(prof.txt) && /新闻播报/.test(prof.txt), '三科名目齐全（作品朗读/新闻播报/话题评述）');
  ok(prof.weakest.indexOf('话题评述') === 0, '自动判定最薄弱板块 = 话题评述(62 最低)');
  ok(/已过合格线 200/.test(prof.txt), '档案显示「已过合格线 200」');
  ok(/达本科线 212/.test(prof.txt), '档案显示「达本科线 212」(226≥212)');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1400, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await cdp.eval(`(() => { const card = [...document.querySelectorAll('#pfBody .card')].find(c => c.querySelector('h2') && c.querySelector('h2').textContent.indexOf('模考成绩') >= 0); if (card) card.scrollIntoView({ block: 'center' }); })()`);
  await sleep(400);
  await shot(cdp, 'exam-profile.png');

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  if (fail) process.exitCode = 1;
  await devReset();
  chrome.kill(); server.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
} catch(e){
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
  process.exit(1);
}
