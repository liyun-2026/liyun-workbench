/**
 * 端到端验收：① 名册页新增「周末班」版块（选日期 → 列出全部在册学员 → 勾谁上谁，含累计次数）
 *              ② 全站文案「砺蕴工作台」→「砺蕴工作系统」；建号文案精简 + 「随时联系办公室」
 *   node test/weekend_check.mjs
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

  const profile = await mkdtemp(path.join(tmpdir(), 'wk-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1200, deviceScaleFactor: 2, mobile: true });
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

  /* 两个班、共 5 名在册学员 */
  const setup = await cdp.eval(`(() => {
    const c1 = Store.upsert('classes', { name: '集训班' });
    const c2 = Store.upsert('classes', { name: '周末A班' });
    const mk = (cid, n) => Store.upsert('students', { classId: cid, name: n }).id;
    return { a: mk(c1.id,'甲'), b: mk(c1.id,'乙'), c: mk(c1.id,'丙'),
             d: mk(c2.id,'丁'), e: mk(c2.id,'戊'),
             d1: '2026-09-19', d2: '2026-09-20', today: Util.today() };
  })()`);

  console.log('① 名册页出现「周末班」版块（带日期选择）');
  const s1 = await cdp.eval(`(async () => {
    App.go('roster');
    await new Promise(r => setTimeout(r, 400));
    const card = [...document.querySelectorAll('#page-roster .card')]
      .find(c => (c.querySelector('h2') || {}).textContent?.includes('周末班'));
    const dateEl = document.getElementById('wkDate');
    return { hasCard: !!card, hasDate: !!dateEl && dateEl.type === 'date',
             dateVal: dateEl ? dateEl.value : '', stat: (document.getElementById('wkStat')||{}).textContent || '' };
  })()`);
  ok(s1.hasCard, '名册页有「周末班」卡片');
  ok(s1.hasDate, '卡片里有年月日选择框');
  ok(/\d{4}-\d{2}-\d{2}/.test(s1.dateVal), '日期框默认填好了（' + s1.dateVal + '）');
  ok(/在册 5 人/.test(s1.stat), '统计行：' + s1.stat);

  console.log('\\n② 系统里所有在册学员都列出来（不分班）');
  const s2 = await cdp.eval(`(async () => {
    document.getElementById('wkDate').value = ${JSON.stringify(setup.d1)};
    Weekend.pickDate(${JSON.stringify(setup.d1)});
    await new Promise(r => setTimeout(r, 300));
    const rows = [...document.querySelectorAll('#wkBody .item')];
    return { n: rows.length, names: rows.map(x => x.querySelector('.grow').textContent.trim().split(' ')[0]),
             groups: [...document.querySelectorAll('#wkBody .hint')].map(x => x.textContent.trim()).filter(t => t.includes('本期')) };
  })()`);
  ok(s2.n === 5, '5 名在册学员全部列出（实际 ' + s2.n + ' 行）');
  ok(s2.names.includes('甲') && s2.names.includes('丁'), '两个班的学员都在（' + s2.names.join('、') + '）');
  ok(s2.groups.length === 2, '按班分组显示（' + s2.groups.join(' ｜ ') + '）');
  await shot(cdp, 'weekend-empty.png');

  console.log('\\n③ 勾谁算谁：点一下参加、再点一下取消');
  const s3 = await cdp.eval(`(async () => {
    Weekend.mark(${JSON.stringify(setup.a)});
    await new Promise(r => setTimeout(r, 200));
    const on1 = document.getElementById('wkStat').textContent;
    const btn1 = [...document.querySelectorAll('#wkBody .item')]
      .find(x => x.textContent.includes('甲')).querySelector('button').textContent.trim();
    Weekend.mark(${JSON.stringify(setup.a)});
    await new Promise(r => setTimeout(r, 200));
    const on2 = document.getElementById('wkStat').textContent;
    const btn2 = [...document.querySelectorAll('#wkBody .item')]
      .find(x => x.textContent.includes('甲')).querySelector('button').textContent.trim();
    return { on1, on2, btn1, btn2 };
  })()`);
  ok(/本期参加 1 人/.test(s3.on1) && /未参加 4 人/.test(s3.on1), '勾上甲 → ' + s3.on1);
  ok(s3.btn1.includes('已参加'), '甲的按钮变「' + s3.btn1 + '」');
  ok(/本期参加 0 人/.test(s3.on2), '再点一下取消 → ' + s3.on2);
  ok(s3.btn2.trim() === '参加', '按钮回到「' + s3.btn2 + '」');

  console.log('\\n④ 全部参加 / 全部取消');
  const s4 = await cdp.eval(`(async () => {
    Weekend.all(1);
    await new Promise(r => setTimeout(r, 250));
    const all1 = document.getElementById('wkStat').textContent;
    Weekend.all(0);
    await new Promise(r => setTimeout(r, 250));
    return { all1, all2: document.getElementById('wkStat').textContent };
  })()`);
  ok(/本期参加 5 人/.test(s4.all1), '全部参加 → ' + s4.all1);
  ok(/本期参加 0 人/.test(s4.all2), '全部取消 → ' + s4.all2);

  console.log('\\n⑤ 累计次数：同一个人跨两期都参加 → 累计 2 次');
  const s5 = await cdp.eval(`(async () => {
    Weekend.pickDate(${JSON.stringify(setup.d1)});
    Weekend.mark(${JSON.stringify(setup.a)});
    Weekend.pickDate(${JSON.stringify(setup.d2)});
    await new Promise(r => setTimeout(r, 200));
    Weekend.mark(${JSON.stringify(setup.a)});
    Weekend.mark(${JSON.stringify(setup.b)});
    await new Promise(r => setTimeout(r, 250));
    Weekend.pickDate(${JSON.stringify(setup.d1)});
    await new Promise(r => setTimeout(r, 250));
    const row = x => [...document.querySelectorAll('#wkBody .item')]
      .find(e => e.textContent.includes(x)).textContent.replace(/\\s+/g,' ').trim();
    return { a: row('甲'), b: row('乙'), stat: document.getElementById('wkStat').textContent,
             sessions: Weekend.sessionCount() };
  })()`);
  ok(/累计 2 次/.test(s5.a), '甲累计 2 次（' + s5.a + '）');
  ok(/累计 1 次/.test(s5.b), '乙累计 1 次（' + s5.b + '）');
  ok(s5.sessions === 2, '已开 2 期（实到 ' + s5.sessions + '）');
  ok(/已开 2 期/.test(s5.stat), '统计行带期数：' + s5.stat);
  await shot(cdp, 'weekend-marked.png');

  console.log('\\n⑥ 数据落在 wk:{日期}（不是 hw:，不会跟作业登记串）');
  const s6 = await cdp.eval(`(() => {
    const keys = Object.keys(Store.dump()).filter(k => k.indexOf('wk:') === 0);
    return { keys, recs: keys.map(k => Store.list(k).length) };
  })()`);
  ok(s6.keys.length >= 2, 'wk: 分日期存了（' + s6.keys.join('、') + '）');
  ok(s6.recs.every(n => n > 0), '每期都有记录（' + s6.recs.join('/') + ' 条）');
  ok(s6.keys.every(k => k.indexOf('hw:') !== 0), '没有跟 hw: 作业前缀混在一起');

  console.log('\\n⑦ 建号文案：改名 + 精简 + 结尾改办公室');
  const s7 = await cdp.eval(`(() => {
    const t = Teachers.greet('王老师', 'wanglaoshi', 'abcd1234');
    return { t, hasOld: t.includes('砺蕴工作台'), hasSys: t.includes('工作系统'),
             hasOffice: t.includes('随时联系办公室'), hasMe: t.includes('随时联系我'),
             hasChatty: t.includes('像 App 一样用') };
  })()`);
  ok(s7.hasSys, '文案里是「工作系统账号」（不是工作台）');
  ok(!s7.hasOld, '文案里不再有「砺蕴工作台」');
  ok(s7.hasOffice && !s7.hasMe, '结尾改成「随时联系办公室」');
  ok(!s7.hasChatty, '「添加到桌面」后面那句大白话已精简');

  console.log('\\n⑧ 全站不再出现「砺蕴工作台」');
  const s8 = await cdp.eval(`(() => {
    const html = document.documentElement.outerHTML;
    return { old: (html.match(/砺蕴工作台/g) || []).length,
             neu: (html.match(/砺蕴工作系统/g) || []).length };
  })()`);
  ok(s8.old === 0, '页面里「砺蕴工作台」0 处（实到 ' + s8.old + '）');
  ok(s8.neu > 0, '页面里有「砺蕴工作系统」（' + s8.neu + ' 处）');

  console.log('\\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  chrome.kill(); server.kill();
  if (fail) process.exit(1);
} catch (e) {
  console.error('\\n💥 ' + e.message);
  process.exit(1);
}
