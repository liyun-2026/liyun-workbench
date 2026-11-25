/**
 * ==5.71== 学生端「我的档案」与教务端「学员档案」对齐 · 回归
 *   node test/stu_profile_check.mjs [端口]
 * 守的是主理人 2026-11-25 那句：「学生的作业、考勤、体重这些出现在学员档案中的，
 * 该和学生同步就和学生同步，让学生也能在他的学生端看到。」
 * 数据全靠服务端本来就下发给本人的那几个键，这里验的是**页面补齐了没有**。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5491);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'stu');
const ACC = { user: '档案测试员', pass: 'profile12345' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
const chromes = []; const R = [];
const t = (n, ok, ex) => R.push({ n, ok: !!ok, ex });

async function launch(debugPort, w, h, mobile){
  const profile = await mkdtemp(path.join(tmpdir(), 'pf-chrome-'));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  chromes.push(ch);
  const tgt = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口 ' + debugPort, tries: 40 });
  const cdp = await Cdp.connect(tgt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });
  if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}
async function go(cdp, url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url }); await loaded;
  await sleep(2300);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s){ s.style.opacity='0'; s.style.display='none'; } })()`);
}
async function login(cdp, user, pass){
  return cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(user)};
    document.getElementById('gPass').value = ${JSON.stringify(pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1900));
    return { gateOff: !document.getElementById('gate').classList.contains('on'),
             err: (document.getElementById('gErr') || {}).textContent || '',
             page: (document.querySelector('.page.on') || {}).id || '' };
  })()`);
}

try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  /* ── ① 教务造数据 ── */
  const staff = await launch(PORT + 1, 1600, 900, false);
  await go(staff, `${BASE}/?nosw=1`);
  const lg = await login(staff, '李老师', 'liyun2026');
  if (!lg.gateOff) throw new Error('教务登录失败：' + lg.err);

  const seed = await staff.eval(`(async () => {
    const cls = Store.upsert('classes', { name: '档案测试班' });
    const me  = Store.upsert('students', { classId: cls.id, name: '档案测试员' });
    const oth = Store.upsert('students', { classId: cls.id, name: '隔壁同学' });

    /* 考勤：三天，其中一天上下午不同 */
    const D = ['2026-11-21','2026-11-22','2026-11-23'];
    Store.upsert('att:' + D[0], { studentId: me.id, status: '正常', pid: 'am' });
    Store.upsert('att:' + D[0], { studentId: me.id, status: '正常', pid: 'pm' });
    Store.upsert('att:' + D[1], { studentId: me.id, status: '迟到', pid: 'am' });
    Store.upsert('att:' + D[1], { studentId: me.id, status: '正常', pid: 'pm' });
    Store.upsert('att:' + D[2], { studentId: me.id, status: '未到', pid: 'am' });
    /* 别人的考勤 —— 学生端一条都不该出现 */
    Store.upsert('att:' + D[2], { studentId: oth.id, status: '正常', pid: 'am' });

    /* 作业：三次，三种状态 */
    const hw = (text, done) => {
      const h = Store.upsert('homework', { clsId: cls.id, date: '2026-11-2' + (hw.n || 1), text });
      Store.upsert('hw:' + h.id, { studentId: me.id, done });
      hw.n = (hw.n || 1) + 1;
      return h;
    };
    hw('绕口令练习', true); hw('新闻播报稿', false);
    /* 第三次只布置、没人登记检查 → 待检查（Homework.flow 里没有 hw: 记录就是 null） */
    Store.upsert('homework', { clsId: cls.id, date: '2026-11-23', text: '即兴评述提纲' });

    /* 晚自习：两次过、一次未过 */
    Store.upsert('night:2026-11-22', { studentId: me.id, st: '过' });
    Store.upsert('night:2026-11-23', { studentId: me.id, st: '过' });
    Store.upsert('night:2026-11-24', { studentId: me.id, st: '未过' });

    /* 体重 */
    ['2026-11-10|54.2', '2026-11-16|53.4', '2026-11-23|52.9'].forEach(x => {
      const [date, v] = x.split('|');
      Store.upsert('weights', { studentId: me.id, date, value: Number(v) });
    });

    /* 模考：两场 */
    const sh1 = Store.upsert('exam_sheets', { clsId: cls.id, name: '第一次模考', date: '2026-11-10' });
    const sh2 = Store.upsert('exam_sheets', { clsId: cls.id, name: '第二次模考', date: '2026-11-20' });
    Store.upsert('exam_scores', { sheetId: sh1.id, studentId: me.id, scoreRead: 72, scoreNews: 68, scoreTalk: 65 });
    Store.upsert('exam_scores', { sheetId: sh2.id, studentId: me.id, scoreRead: 78, scoreNews: 74, scoreTalk: 71 });

    /* 评语 */
    Store.upsert('records', { studentId: me.id, date: '2026-11-23', text: '气息稳了，咬字还要收紧', byName: '李老师' });

    await Sync.push();
    const acc = await Auth.call('users', { op: 'create', user: ${JSON.stringify(ACC.user)},
      name: ${JSON.stringify(ACC.user)}, role: 'student', pass: ${JSON.stringify(ACC.pass)}, studentId: me.id });
    return { cls: cls.id, sid: me.id, oth: oth.id, acc: JSON.stringify(acc).slice(0, 60) };
  })()`);
  t('教务数据造好了（考勤 5 条 / 作业 3 次 / 晚自习 3 次 / 体重 3 次 / 模考 2 场）', !!seed.sid, JSON.stringify(seed));

  /* ── ② 学生登录 ── */
  const stu = await launch(PORT + 2, 390, 844, true);
  await go(stu, `${BASE}/?nosw=1`);
  const sl = await login(stu, ACC.user, ACC.pass);
  t('学生登得进去', sl.gateOff, sl.err || sl.page);

  const view = await stu.eval(`(async () => {
    try { await Sync.pull(); } catch(e) {}
    App.go('stuProfile');
    await new Promise(r => setTimeout(r, 900));
    StuProfile.render();
    await new Promise(r => setTimeout(r, 600));
    const box = document.getElementById('stuPfBody');
    const cards = [...box.querySelectorAll('.card')];
    const pick = name => cards.find(c => ((c.querySelector('h2') || {}).textContent || '').indexOf(name) >= 0);
    const attC = pick('考勤明细'), hwC = pick('作业'), ngC = pick('晚自习'), exC = pick('模考'), wtC = pick('体重'), rcC = pick('老师评语');
    return {
      titles: cards.map(c => ((c.querySelector('h2') || {}).textContent || '').trim().split(/\\s+/)[0]),
      metrics: [...box.querySelectorAll('.card.wide .num')].map(x => x.textContent.trim()),
      attDays: attC ? attC.querySelectorAll('.sq-day').length : 0,
      attColors: attC ? new Set([...attC.querySelectorAll('.sq-day i')].map(i => i.style.background)).size : 0,
      attLegend: attC ? attC.querySelectorAll('.sqlg span').length : 0,
      hwDays: hwC ? hwC.querySelectorAll('.sq-hw').length : 0,
      hwStates: hwC ? [...hwC.querySelectorAll('.sq-hw span')].map(x => x.textContent.trim()) : [],
      nightOk: ngC ? (ngC.querySelector('.num') || {}).textContent || '' : '',
      nightRows: ngC ? ngC.querySelectorAll('.item').length : 0,
      examHero: exC ? (exC.querySelector('.hero') || {}).textContent || '' : '',
      examRows: exC ? exC.querySelectorAll('.item').length : 0,
      examCurve: exC ? !!exC.querySelector('polyline') : false,
      weightHero: wtC ? (wtC.querySelector('.hero') || {}).textContent || '' : '',
      recRows: rcC ? rcC.querySelectorAll('.item').length : 0,
      inputs: box.querySelectorAll('input,button,.del').length,
      other: box.textContent.indexOf('隔壁同学') >= 0,
      h: Math.round(box.getBoundingClientRect().height),
    };
  })()`);

  t('六张卡都在（考勤/作业/晚自习/模考/体重/评语）',
    ['考勤明细', '作业', '晚自习过关', '模考成绩', '体重', '老师评语'].every(k => view.titles.indexOf(k) >= 0),
    JSON.stringify(view.titles));
  t('考勤改成方块日历：3 天 = 3 个块，四色里至少用到 3 种', view.attDays === 3 && view.attColors >= 3,
    JSON.stringify({ attDays: view.attDays, attColors: view.attColors }));
  t('考勤图例 5 项齐全（正常/迟到/请假/未到/无记录）', view.attLegend === 5, String(view.attLegend));
  t('作业是方块日历：3 块 + 三态都在',
    view.hwDays === 3 && ['已交', '未交', '待检查'].every(s => view.hwStates.indexOf(s) >= 0),
    JSON.stringify({ hwDays: view.hwDays, hwStates: view.hwStates }));
  t('晚自习过关：2 次过关 + 3 条记录', view.nightOk.trim() === '2' && view.nightRows === 3,
    JSON.stringify({ ok: view.nightOk, rows: view.nightRows }));
  t('模考：最近一次 223 分 + 两场明细 + 曲线', /223/.test(view.examHero || '') && view.examRows >= 2 && view.examCurve,
    JSON.stringify({ hero: view.examHero, rows: view.examRows, curve: view.examCurve }));
  t('体重：最近一次 52.9 kg', /52\.9/.test(view.weightHero || ''), view.weightHero);
  t('评语 1 条', view.recRows === 1, String(view.recRows));
  t('整页没有任何输入框/按钮/删除键（学生只能看自己）', view.inputs === 0, String(view.inputs));
  t('看不到同班别人的东西', !view.other, String(view.other));
  t('概览里带「晚自习过关」计数', view.metrics.join(',').indexOf('2') >= 0 && view.metrics.length >= 8, JSON.stringify(view.metrics));

  /* ── 截图：整页（撑高视口再截） ── */
  const fullH = await stu.eval(`(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    return Math.ceil(document.getElementById('stuPfBody').getBoundingClientRect().height) + 320;
  })()`);
  await stu.send('Emulation.setDeviceMetricsOverride', { width: 390, height: Math.max(1600, fullH), deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: Math.max(1600, fullH) });
  await sleep(900);
  const rect = await stu.eval(`(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
    const el = document.getElementById('page-stuProfile');
    const b = el.getBoundingClientRect();
    return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: Math.min(b.height, 3000) };
  })()`);
  const res = await stu.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.w, height: rect.h, scale: 1 } });
  await writeFile(path.join(OUT, 'stu_profile_full.png'), Buffer.from(res.data, 'base64'));
  console.log('  📸 stu_profile_full.png  ' + Math.round(rect.w) + '×' + Math.round(rect.h));
} finally {
  for (const c of chromes) { try { c.kill('SIGKILL'); } catch {} }
  try { server.kill('SIGKILL'); } catch {}
}
const bad = R.filter(x => !x.ok);
R.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok || !x.ex ? '' : '   → ' + x.ex)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length}` : `✅ 全部通过（${R.length} 项）`));
if (bad.length) process.exitCode = 1;
