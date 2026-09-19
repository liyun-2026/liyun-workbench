/**
 * 端到端验收：① 教务端新增「今日作业检查」（直接勾今天谁交没交）
 *              ② 老师端「录入今日」多条作业时，每组「交了/没交」标出是哪条作业（消除重复感）
 *   node test/hw_check.mjs
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

  const profile = await mkdtemp(path.join(tmpdir(), 'hw-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 2, mobile: true });
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

  const setup = await cdp.eval(`(() => {
    const c = Store.upsert('classes', { name: '集训班' });
    const mk = n => Store.upsert('students', { classId: c.id, name: n });
    return { cid: c.id, a: mk('甲').id, b: mk('乙').id, d: mk('丙').id, today: Util.today() };
  })()`);

  console.log('① 作业页有「今日作业检查」入口（不用先布置作业也能记）');
  const s1 = await cdp.eval(`(async () => {
    Store.set('_hkCls', ${JSON.stringify(setup.cid)});
    Store.set('_hkDate', ${JSON.stringify(setup.today)});
    App.go('homework');
    await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#page-homework .card')]
      .find(c => (c.querySelector('h2') || {}).textContent?.includes('今日作业检查'));
    return {
      hasCard: !!card,
      hasCls: !!document.getElementById('hkCls'),
      hasDate: !!document.getElementById('hkDate'),
      rows: document.querySelectorAll('#hkBody .item').length,
      sum: (document.querySelector('#hkBody p.hint') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`);
  ok(s1.hasCard, '作业页顶部出现「今日作业检查」卡');
  ok(s1.hasCls && s1.hasDate, '有班级下拉 + 日期框（默认今天）');
  ok(s1.rows === 3, '列出该班 3 名学员，一人一行');
  ok(/已交 0 · 未交 0 · 未登记 3/.test(s1.sum), '计数行正确：' + s1.sum);

  console.log('\n② 点「已交 / 未交」就记上，再点取消');
  const s2 = await cdp.eval(`(async () => {
    Homework.markChk(${JSON.stringify(setup.a)}, 1);
    Homework.markChk(${JSON.stringify(setup.b)}, 0);
    await new Promise(r => setTimeout(r, 200));
    const recs = Store.list('hwchk:' + ${JSON.stringify(setup.today)});
    const sum = document.querySelector('#hkBody p.hint').textContent.replace(/\\s+/g, ' ').trim();
    Homework.markChk(${JSON.stringify(setup.a)}, 1);           // 再点一下 = 取消
    await new Promise(r => setTimeout(r, 200));
    const after = Store.list('hwchk:' + ${JSON.stringify(setup.today)});
    return { n: recs.length, sum,
             aDone: (recs.find(x => x.studentId === ${JSON.stringify(setup.a)}) || {}).done,
             bDone: (recs.find(x => x.studentId === ${JSON.stringify(setup.b)}) || {}).done,
             afterN: after.length, afterHasA: after.some(x => x.studentId === ${JSON.stringify(setup.a)}) };
  })()`);
  ok(s2.n === 2 && s2.aDone === 1 && s2.bDone === 0, '甲=已交、乙=未交 都写进 hwchk:{日期}');
  ok(/已交 1 · 未交 1 · 未登记 1/.test(s2.sum), '计数行跟着变：' + s2.sum);
  ok(s2.afterN === 1 && !s2.afterHasA, '再点「已交」取消，甲的登记被清掉');

  console.log('\n③ 同一天既有作业登记又有检查时，以检查为准（不重复计分）');
  const s3 = await cdp.eval(`(async () => {
    const cid = ${JSON.stringify(setup.cid)}, a = ${JSON.stringify(setup.a)}, d = ${JSON.stringify(setup.today)};
    const h = Store.upsert('homework', { clsId: cid, date: d, text: '新闻播报练习' });
    Store.upsert('hw:' + h.id, { studentId: a, done: 0 });       // 作业登记：未交（-2）
    const onlyHw = Quant.compute(cid, d, d).find(x => x.name === '甲').score;
    Store.upsert('hwchk:' + d, { studentId: a, classId: cid, date: d, done: 1 });   // 当日检查：已交（+1）
    const withChk = Quant.compute(cid, d, d).find(x => x.name === '甲').score;
    return { onlyHw, withChk };
  })()`);
  console.log('   只作业登记(未交) =', s3.onlyHw, '｜ 再加当日检查(已交) =', s3.withChk);
  ok(s3.onlyHw === -2, '只登记作业未交 → −2 分');
  ok(s3.withChk === 1, '当天做了检查就以检查为准 → +1 分（不是 −2+1 的 −1，没重复计）');

  console.log('\n④ 学员档案：作业流水里能看到「今日作业检查」');
  const s4 = await cdp.eval(`(async () => {
    Store.set('_pfCls', ${JSON.stringify(setup.cid)});
    Store.set('_pfStu', ${JSON.stringify(setup.b)});
    App.go('profile');
    await new Promise(r => setTimeout(r, 400));
    const box = document.querySelector('#page-profile');
    const txt = box.textContent.replace(/\\s+/g, ' ');
    const cards = [...box.querySelectorAll('.card')];
    const hwCard = cards.find(c => (c.querySelector('h2') || {}).textContent?.includes('作业'));
    return { hasChkRow: !!hwCard && hwCard.textContent.includes('今日作业检查'),
             txt: hwCard ? hwCard.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
             miss: (box.textContent.match(/作业未交\\s*(\\d+)/) || [])[1] };
  })()`);
  ok(s4.hasChkRow, '作业卡里出现「今日作业检查」这一行');
  console.log('   作业卡：', s4.txt);

  await shot(cdp, 'hw-check.png');

  console.log('\n⑤ 老师端「录入今日」：多条作业时每组按钮标出作业名（不再是一串一样的交了/没交）');
  const s5 = await cdp.eval(`(async () => {
    const cid = ${JSON.stringify(setup.cid)}, d = ${JSON.stringify(setup.today)};
    Store.list('homework').forEach(h => Store.softDelete('homework', h.id));   // 清掉前面步骤造的作业，保证这里正好两条
    Store.upsert('homework', { clsId: cid, date: d, text: '新闻播报练习' });
    Store.upsert('homework', { clsId: cid, date: d, text: '即兴评述提纲（家乡）' });
    Store.set('_rcCls', cid); Store.set('_rcDate', d);
    Record.render();
    await new Promise(r => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#rcBody .row')].filter(x => x.textContent.includes('交了'));
    const labels = rows.map(x => { const s = x.querySelector('span.hint'); return s ? s.textContent.trim() : ''; });
    return { n: rows.length, labels, uniq: [...new Set(labels)] };
  })()`);
  console.log('   每行标签：', JSON.stringify(s5.uniq));
  ok(s5.n === 6, '3 名学员 × 2 条作业 = 6 组（每组各带作业名）');
  ok(s5.uniq.length === 2 && s5.uniq.every(x => x.length > 0), '每组都标了作业名，且两条名字不同 → 不再看着像重复');

  await shot(cdp, 'hw-record-teacher.png');

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  chrome.kill(); server.kill();
  await devReset();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('\n✗ 出错：', e.message);
  process.exit(1);
}
