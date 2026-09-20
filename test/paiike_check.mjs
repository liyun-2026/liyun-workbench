/**
 * 端到端验收：课表「排课台」—— 定一次周模板，一次铺满整期
 *   node test/paiike_check.mjs
 *
 * 覆盖：排课台卡片 / 上课日多选 / 按节次铺满 / 预览节数 / 一次生成整期 /
 *       重复生成不重排 / 清空重排先归档 / 教室撞课预检 /
 *       大课表天数放宽到 62 且能看整期 / 导入改本机解析且无「充值」字样
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
const SUPER = { user: '__selftest__', pass: 'shotpass123' };

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

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

let server, chrome;
try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'wk-paike-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  // 登录用一次性账号名，验完 dev-reset，绝不用真名（会把首个账号占成首位教务）
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), mode: Auth.mode };
  })()`);
  if (!lg.gateOff) throw new Error('登录失败');
  console.log('已登录（模式：' + lg.mode + '）\n');

  // 全程把 confirm 放行，免测试卡在弹窗上
  await cdp.eval(`window.confirm = () => true; 'ok';`);

  /* ── ① 排课台卡片与默认值 ── */
  console.log('① 排课台卡片');
  const t1 = await cdp.eval(`(async () => {
    App.go('timetable');
    await new Promise(r => setTimeout(r, 700));
    const card = [...document.querySelectorAll('#page-timetable .card')]
      .find(c => ((c.querySelector('h2') || {}).textContent || '').includes('排课台'));
    return {
      hasCard: !!card,
      hasFrom: !!document.getElementById('ppFrom'),
      hasTo: !!document.getElementById('ppTo'),
      daysInput: (document.getElementById('gridDays') || {}).type || '',
      weekChips: document.querySelectorAll('#ppWeek .chip').length,
      weekOn: [...document.querySelectorAll('#ppWeek .chip')].filter(e => e.classList.contains('chip-on')).map(e => e.dataset.d),
      rows: document.querySelectorAll('#ppRows .pprow').length
    };
  })()`);
  ok(t1.hasCard, '课表页出现「排课台」卡片');
  ok(t1.hasFrom && t1.hasTo, '有开始 / 结束日期两个输入');
  ok(t1.weekChips === 7, '上课日给出七个可选项');
  ok(t1.weekOn.length === 6 && !t1.weekOn.includes('周日'), '默认勾选周一到周六（周日休息）');
  ok(t1.daysInput === 'number', '大课表天数改成数字框，可直接输任意天数');

  /* ── ② 节次 + 按节次铺满 ── */
  console.log('\n② 模板行');
  const t2 = await cdp.eval(`(() => {
    [['早功','06:30','07:30'],['第1节','08:00','09:40'],['第2节','10:00','11:40'],
     ['第3节','14:00','15:40'],['第4节','16:00','17:40']].forEach(p =>
      Store.upsert('periods', { name: p[0], start: p[1], end: p[2] }));
    Schedule.render();
    Schedule.ppFillPeriods();
    const rows = [...document.querySelectorAll('#ppRows .pprow')];
    return { periods: Schedule.periods().length, rows: rows.length,
             order: Schedule.periods().map(p => p.name).join('/'),
             perOptions: rows[0] ? rows[0].querySelectorAll('.pp-period option').length : 0 };
  })()`);
  ok(t2.periods === 5 && t2.rows === 5, '配好 5 个节次后，「按节次铺满」出了 5 行');
  ok(t2.perOptions === 5, '每行的节次下拉能选到全部 5 个节次');
  ok(t2.order === '早功/第1节/第2节/第3节/第4节',
     '节次按真实时刻排序：早功 06:30 排在第一节之前   → ' + t2.order);

  /* ── ③ 预览：先算清楚，再落库 ── */
  console.log('\n③ 预览');
  const t3 = await cdp.eval(`(() => {
    const data = [
      { title:'科学发声', cls:'BY05/BY06', room:'BY08' },
      { title:'即兴评述', cls:'BY05',      room:'BY08' },
      { title:'新闻播报', cls:'BY06',      room:'BY09' },
      { title:'形体',     cls:'BY05/BY06', room:'BY03' },
      { title:'晚功',     cls:'BY05/BY06', room:'BY08' }
    ];
    const rows = [...document.querySelectorAll('#ppRows .pprow')];
    rows.forEach((el, i) => {
      if (!data[i]) return;
      el.querySelector('.pp-title').value = data[i].title;
      el.querySelector('.pp-cls').value = data[i].cls;
      el.querySelector('.pp-room').value = data[i].room;
    });
    document.getElementById('ppFrom').value = '2026-07-10';
    document.getElementById('ppTo').value = '2026-07-23';   // 14 天，含 2 个周日
    Schedule.ppPreview();
    return { stat: document.getElementById('ppStat').innerText.replace(/\\s+/g, ' '),
             planN: Schedule.ppPlan().length,
             storedN: Store.list('schedule').length };
  })()`);
  ok(t3.planN === 60, '预览算出 60 节（12 个上课日 × 5 节）');
  ok(t3.storedN === 0, '预览阶段不落库，课表还是空的');
  ok(/60/.test(t3.stat) && /12/.test(t3.stat), '预览文字报出节数与天数');
  ok(/2026-07-10/.test(t3.stat) && /2026-07-23/.test(t3.stat), '预览文字报出起止日期');

  await cdp.eval(`document.getElementById('ppRows').scrollIntoView({ block: 'center' }); 'ok';`);
  await sleep(400);
  await shot(cdp, 'paike_1_panel.png');

  /* ── ④ 一次生成整期 ── */
  console.log('\n④ 生成整期');
  const t4 = await cdp.eval(`(() => {
    Schedule.ppGenerate(false);
    const items = Store.list('schedule').filter(x => (x.kind || 'big') === 'big');
    const dates = [...new Set(items.map(x => x.date))].sort();
    return { n: items.length, days: dates.length, first: dates[0], last: dates[dates.length - 1],
             sunday: dates.filter(d => Schedule.dayOfDate(d) === '日').length,
             gridStart: Store.get('_schStart'), gridDays: Store.get('_schDays'),
             sample: items.filter(x => x.date === '2026-07-10').map(x => x.title).join('/') };
  })()`);
  ok(t4.n === 60, '生成出 60 节课');
  ok(t4.days === 12, '落在 12 天上课');
  ok(t4.sunday === 0, '周日一节课都没排（默认不勾周日）');
  ok(t4.first === '2026-07-10' && t4.last === '2026-07-23', '日期范围正好是设定的整期');
  ok(t4.gridStart === '2026-07-10' && t4.gridDays === '14', '大课表自动对准这段时间（14 天）');
  ok(t4.sample.split('/').length === 5, '同一天排满了模板里的 5 节课');

  await cdp.eval(`document.getElementById('gridWrap').scrollIntoView({ block: 'center' }); 'ok';`);
  await sleep(400);
  await shot(cdp, 'paike_2_grid.png');

  /* ── ⑤ 再点一次不会重复排 ── */
  console.log('\n⑤ 重复生成');
  const t5 = await cdp.eval(`(() => {
    Schedule.ppGenerate(false);
    return { n: Store.list('schedule').filter(x => (x.kind || 'big') === 'big').length,
             stat: document.getElementById('ppStat').innerText.replace(/\\s+/g, ' ') };
  })()`);
  ok(t5.n === 60, '再点一次「生成」课表不翻倍（仍 60 节）');
  ok(/跳过已有\s*60/.test(t5.stat), '并明说跳过了已有的 60 节');

  /* ── ⑥ 清空该区间后重排，先归档 ── */
  console.log('\n⑥ 清空重排');
  const t6 = await cdp.eval(`(() => {
    const archBefore = Store.list('schedule_archive').length;
    Schedule.ppGenerate(true);
    return { after: Store.list('schedule').filter(x => (x.kind || 'big') === 'big').length,
             archBefore, archAfter: Store.list('schedule_archive').length };
  })()`);
  ok(t6.after === 60, '清空重排后仍是 60 节，不多不少');
  ok(t6.archAfter > t6.archBefore, '重排前把旧课表存进了「往期课表」');

  /* ── ⑦ 撞课预检：同节次、同教室、不同班 ── */
  console.log('\n⑦ 撞课预检');
  const t7 = await cdp.eval(`(() => {
    Schedule.ppAddRow();
    const rows = [...document.querySelectorAll('#ppRows .pprow')];
    const last = rows[rows.length - 1];
    last.querySelector('.pp-period').value = rows[1].querySelector('.pp-period').value; // 同「第1节」
    last.querySelector('.pp-title').value = '普通话语音';
    last.querySelector('.pp-cls').value = 'BY09';
    last.querySelector('.pp-room').value = 'BY08';                                     // 与「即兴评述」同教室
    Store.set('_schStart', '2026-07-10'); Store.set('_schDays', '14');
    Schedule.ppPreview();
    const stat = document.getElementById('ppStat').innerText;
    return { warn: /⚠️/.test(stat), room: /BY08/.test(stat), planN: Schedule.ppPlan().length };
  })()`);
  ok(t7.planN === 72, '加一行后计划变成 72 节（12 天 × 6 节）');
  ok(t7.warn && t7.room, '预览就能看出「教室 BY08 被占」的撞课提醒');

  /* ── ⑧ 大课表天数放宽 + 一键看整期 ── */
  console.log('\n⑧ 大课表看整期');
  const t8 = await cdp.eval(`(() => {
    document.getElementById('gridStart').value = '2026-07-10';
    document.getElementById('gridDays').value = '40';
    Schedule.applyRange();
    const a = Schedule.range();
    Store.set('_schDays', '99');
    const clamped = Schedule.range().days;
    Store.set('_schDays', '14');
    Schedule.showWholeTerm();
    const cols = document.querySelectorAll('#gridWrap .sgrid thead th').length;
    return { days: a.days, clamped, cols, start: Store.get('_schStart'), d: Store.get('_schDays') };
  })()`);
  ok(t8.days === 40, '天数上限放宽：能显示 40 天');
  ok(t8.clamped === 7, '手输超界（99 天）会被夹回默认 7 天，不会把页面撑爆');
  ok(t8.d === '14' && t8.cols === 15, '「看整期」按排课台区间切到 14 天，表头 15 列（含左列）');

  /* ── ⑨ 导入改本机解析，且不再出现「充值」 ── */
  console.log('\n⑨ 导入：本机解析');
  const t9 = await cdp.eval(`(() => {
    const card = [...document.querySelectorAll('#page-timetable .card')]
      .find(c => ((c.querySelector('h2') || {}).textContent || '').includes('导入课表'));
    const txt = card ? card.innerText : '';
    const pageTxt = document.getElementById('page-timetable').innerText;
    return { hasAI: txt.includes('AI 解析') || txt.includes('DeepSeek'),
             hasLocal: txt.includes('本机'),
             hasCharge: pageTxt.includes('充值'),
             hasTextarea: !!document.getElementById('impText') };
  })()`);
  ok(t9.hasTextarea, '导入区保留文字框（可与识别结果对接）');
  ok(!t9.hasAI, '导入区不再出现 AI / DeepSeek 字样');
  ok(t9.hasLocal, '导入区标明「本机解析，不联网、不花钱」');
  ok(!t9.hasCharge, '整个课表页不再出现「充值」二字');

  const t10 = await cdp.eval(`(() => {
    const txt = [
      '7月10日 周五\\t7月11日 周六',
      '08:00-09:40\\t即兴评述 BY05 [BY08]\\t新闻播报 BY06 [BY09]',
      '10:00-11:40\\t形体 BY05 [BY03]\\t科学发声 BY06 [BY08]'
    ].join('\\n');
    document.getElementById('impText').value = txt;
    document.getElementById('impYear').value = '2026';
    Schedule.parseLocal();
    const rows = Schedule._impRows || [];
    const f = rows[0] || {};
    return { n: rows.length, rows: document.querySelectorAll('#impPreview .imptbl tbody tr').length,
             all: rows.map(r => [r.date, r.time, r.cls, r.title, r.room].join('|')),
             date: f.date, time: f.time, title: f.title, cls: f.cls, room: f.room,
             d2: (rows[1] || {}).date, t2: (rows[1] || {}).title };
  })()`);
  ok(t10.n === 4, '本机解析认出 4 节课（两行 × 两列）');
  ok(t10.rows === 4, '预览表列出 4 行，可逐格改');
  ok(t10.date === '2026-07-10' && t10.title === '即兴评述' && t10.cls === 'BY05' && t10.room === 'BY08',
     '首条解析正确：日期/内容/班级/教室 全对   → ' + (t10.all || []).join('  /  '));
  ok(t10.time === '08:00-09:40', '行首的时间标签当作该行节次');
  ok(t10.d2 === '2026-07-11' && t10.t2 === '新闻播报', '第二列正确落到第二个日期上');

  await cdp.eval(`document.getElementById('impPreview').scrollIntoView({ block: 'start' }); 'ok';`);
  await sleep(400);
  await shot(cdp, 'paike_3_import.png');

  const t11 = await cdp.eval(`(() => {
    Schedule.impImport();
    return { n: Store.list('schedule').filter(x => (x.kind || 'big') === 'big').length,
             preview: document.querySelectorAll('#impPreview .imptbl tbody tr').length,
             stat: document.getElementById('impStat').textContent };
  })()`);
  ok(t11.n === 4, '确认导入是整表替换：只剩这 4 节');
  ok(t11.preview === 0, '导入后预览表自动收起');
  ok(/导入完成/.test(t11.stat), '给出导入完成提示');

} catch (e) {
  fail++; console.log('\n💥 中断：' + e.message);
} finally {
  try { if (chrome) chrome.kill(); } catch {}
  try { if (server) server.kill(); } catch {}
  try { await devReset(); } catch {}
  console.log('\n' + '─'.repeat(46));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}
