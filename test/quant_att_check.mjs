/**
 * 端到端验收：① 考勤（迟到/事假）自动进量化 ② 量化区间改日历选日期（不再本周/本月）
 *   node test/quant_att_check.mjs
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

  const profile = await mkdtemp(path.join(tmpdir(), 'qatt-chrome-'));
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

  // 造数据：一个班 + 三个学生
  const setup = await cdp.eval(`(() => {
    const c = Store.upsert('classes', { name: '集训班' });
    const mk = n => Store.upsert('students', { classId: c.id, name: n });
    const a = mk('甲'), b = mk('乙'), d = mk('丙');
    return { cid: c.id, a: a.id, b: b.id, d: d.id };
  })()`);

  console.log('① 考勤标「迟到 / 事假」→ 量化里自动出现（不用再去量化页点）');
  const s1 = await cdp.eval(`(async () => {
    Store.set('_attCls', ${JSON.stringify(setup.cid)});
    Store.set('_attDate', Util.today());
    App.go('att');
    await new Promise(r => setTimeout(r, 300));
    Att.mark(${JSON.stringify(setup.a)}, '迟到');
    Att.mark(${JSON.stringify(setup.b)}, '事假');
    await new Promise(r => setTimeout(r, 200));
    const att = Store.list('quant_log').filter(x => x._src === 'att' && x.clsId === ${JSON.stringify(setup.cid)});
    return { n: att.length, labels: att.map(x => x.label + x.delta).sort().join(','), score: Quant.score(${JSON.stringify(setup.cid)}) };
  })()`);
  console.log('   自动生成的量化记录：', s1.labels, '｜总分', s1.score);
  ok(s1.n === 2, '考勤两点 → 量化自动生成 2 条记录');
  ok(s1.labels === '事假-2,迟到-2', '分值正确（迟到−2、事假−2，取自量化细则）');
  ok(s1.score === 96, '班级总分自动变成 96（100−2−2）');

  console.log('\n② 量化页：区间是日历选日期，且能筛出考勤来的记录');
  const s2 = await cdp.eval(`(async () => {
    App.go('quant');
    await new Promise(r => setTimeout(r, 500));
    const hasFrom = !!document.getElementById('qFrom');
    const hasTo   = !!document.getElementById('qTo');
    const hasOld  = !!document.getElementById('qRange');   // 老的「本周/本月」下拉应已删除
    document.getElementById('qFrom').value = Util.today();
    document.getElementById('qTo').value = Util.today();
    Quant.render();
    await new Promise(r => setTimeout(r, 200));
    const rows = [...document.querySelectorAll('#qLogBody .item')].map(x => x.textContent.replace(/\\s+/g,' ').trim());
    const tags = rows.filter(t => t.indexOf('考勤') >= 0).length;
    const undo = document.querySelectorAll('#qLogBody .item .del').length;
    const card = (document.getElementById('qScoreCard')||{}).textContent || '';
    return { hasFrom, hasTo, hasOld, rows, tags, undo, card: card.replace(/\\s+/g,' ').trim() };
  })()`);
  ok(s2.hasFrom && s2.hasTo, '区间用两个日历日期框（qFrom / qTo）');
  ok(!s2.hasOld, '老的「本周/本月」下拉已移除');
  ok(s2.rows.length === 2 && s2.tags === 2, '今天这段：2 条记录都带「考勤」标记');
  ok(s2.undo === 0, '考勤来的记录不给 ✕（源头在考勤，改考勤即可）');
  ok(/96/.test(s2.card) && /迟到/.test(s2.card) && /事假/.test(s2.card), '总分卡显示 96 且原因含「迟到、事假」');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1250, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  await shot(cdp, 'quant-att.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  await sleep(200);

  console.log('\n③ 集训日不在本周：按日期选定即显示（证明不按日历周走）');
  const s3 = await cdp.eval(`(async () => {
    const D = '2026-08-01';                       // 一个不落在「本周」的日子
    Store.set('_attDate', D);
    const ae = document.getElementById('attDate'); if (ae) ae.value = D;   // 日期框是页面上的源头
    App.go('att');
    await new Promise(r => setTimeout(r, 300));
    Att.mark(${JSON.stringify(setup.d)}, '事假');
    await new Promise(r => setTimeout(r, 200));
    App.go('quant');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('qFrom').value = D;
    document.getElementById('qTo').value = D;
    Quant.render();
    await new Promise(r => setTimeout(r, 200));
    const rows = [...document.querySelectorAll('#qLogBody .item')].map(x => x.textContent.replace(/\\s+/g,' ').trim());
    return { rows, hasAug: rows.some(t => t.indexOf('08-01') >= 0), hasToday: rows.some(t => t.indexOf(Util.today().slice(5)) >= 0) };
  })()`);
  ok(s3.hasAug && s3.rows.length === 1, '把区间设成集训那天(08-01)，只显示那天的记录');
  ok(!s3.hasToday, '今天(非该区间)的记录不显示 —— 说明是按选定日期，不是按周/月');

  console.log('\n④ 考勤改回「正常」→ 量化对应扣分自动撤销');
  const s4 = await cdp.eval(`(async () => {
    Store.set('_attDate', Util.today());
    const ae = document.getElementById('attDate'); if (ae) ae.value = Util.today();
    App.go('att');
    await new Promise(r => setTimeout(r, 300));
    Att.mark(${JSON.stringify(setup.a)}, '正常');     // 甲 由迟到改正常
    await new Promise(r => setTimeout(r, 200));
    const att = Store.list('quant_log').filter(x => x._src === 'att' && x.clsId === ${JSON.stringify(setup.cid)});
    return { n: att.length, labels: att.map(x => x.label).sort().join(','), score: Quant.score(${JSON.stringify(setup.cid)}) };
  })()`);
  console.log('   剩余自动记录：', s4.labels, '｜总分', s4.score);
  ok(s4.n === 2 && s4.labels === '事假,事假', '甲的迟到记录已被撤销，只剩两条事假（今天+集训日）');
  ok(s4.score === 96, '总分回到 96（100−2−2）');

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
