/**
 * 作息时间轴向核（VoxOS 5.55）—— 主理人「改了没反应 + 一直在跳 + 一直错乱」
 *
 *   node test/periods_check.mjs        # 截图落到 test/.shots/periods/
 *
 * 钉四件事：
 *   1. 24 小时制：14:50 就写 14:50，不再转成「02:50」；老数据里的 02:50 仍按下午解读。
 *   2. 改开始时间 = 锁成锚点（auto 立刻 false），结束时间按原时长重算，后面 auto 段跟着走；
 *      再跑两遍 recalcPeriods 也不会把手动段改回去。
 *   3. 编辑过程中不整块重灌面板：焦点留在正在编辑的输入框、滚动位置不动。
 *   4. 刚改过的 45 秒内，pull 的远端旧值盖不回来；过了保护期才按 _u 正常合并。
 *   5. 重建：以真实节次时间为源建 10 段式的干净时间轴，排课按时间重挂、绝不丢课；
 *      坏段（空起止 / end<=start / 重复）软删；今日页刻度数 = 真实节次，零空刻度。
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5335);
const DBG = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'periods');
const SUPER = { user: '作息测试教务', pass: 'periodspass123' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(5000) });
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
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server; const chromes = []; const shots = [];
const pass = [], fail = [];
const t = (name, fn) => {
  try { const v = fn(); pass.push(name); console.log('  ✅ ' + name + (v !== undefined && v !== true ? '  → ' + v : '')); }
  catch (e) { fail.push(name + ' → ' + e.message); console.log('  ❌ ' + name + ' → ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name){
  await sleep(350);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, name);
  await writeFile(f, Buffer.from(r.data, 'base64'));
  shots.push(f);
  console.log('  📸 ' + name);
}
async function go(cdp, url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(600);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'periods-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__errs = [];
    addEventListener('error', e => __errs.push('error: ' + (e.message || e.type)));
    addEventListener('unhandledrejection', e => __errs.push('reject: ' + (e.reason && e.reason.message || e.reason)));
  ` });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(cdp, `${BASE}/?nosw=1`);

  console.log('\n=== 0. 登录 + 摆一份「生产同款」乱作息 ===');
  const r0 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { ok: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r0.ok) throw new Error('登录失败：' + r0.err);

  const seeded = await cdp.eval(`(() => {
    const d = Util.today();
    const wd = '日一二三四五六'[new Date(d + 'T00:00:00').getDay()];
    const add = (o) => Store.upsert('periods', o);
    const p1 = add({ name: '07:50-08:30', start: '07:50', end: '08:30', dur: 40, gap: 10, auto: false });
    const p1dup = add({ name: '07:50-08:30', start: '07:50', end: '08:30', dur: 40, gap: 10, auto: false });
    const p2 = add({ name: '08:40-09:20', start: '08:40', end: '09:20', dur: 40, gap: 10, auto: true });
    const p3 = add({ name: '09:30-10:10', start: '09:30', end: '10:10', dur: 40, gap: 10, auto: true });
    /* 迁移写坏：只剩 id（没有起止） */
    const pbad = add({ name: '02:50-03:30' });
    /* 另一条坏行：end < start（12:30 写成上午 12 点） */
    const pbad2 = add({ name: '02:50-03:30', start: '02:50', end: '12:30', dur: 40, gap: 0, auto: false });

    const mk = (pid, cls, title) => Store.upsert('schedule', { id: null, date: d, day: wd, periodId: pid, time: '', title, cls, kind: 'big' });
    mk(p1.id, '集训BY05班', '新闻语感晨练');
    mk(p1.id, '集训BY06班', '新闻语感晨练');
    mk(p2.id, '集训BY05班', '即兴评述');
    mk(p2.id, '集训BY06班', '文稿朗诵');
    /* 悬空：这个节次已经从 periods 消失，但两节课还挂在它上面 */
    mk('ghost_period_id', '集训BY05班', '每日即评通关');
    mk('ghost_period_id', '集训BY06班', '每日即评通关');
    /* 自定义时间的小课：只有 time，没有 periodId */
    Store.upsert('schedule', { id: null, date: d, day: wd, periodId: '', time: '13:10', title: '晚课·一对一', cls: '集训BY05班', kind: 'small' });

    return { d, ids: { p1: p1.id, p1dup: p1dup.id, p2: p2.id, p3: p3.id, pbad: pbad.id, pbad2: pbad2.id },
             periods: Store.list('periods').length, sched: Store.list('schedule').length };
  })()`);
  t('摆好乱作息（重复段 / 只剩 id / end<start / 悬空 periodId / 自定义时间）', () => {
    assert(seeded.periods === 6, '该 6 段，实际 ' + seeded.periods);
    assert(seeded.sched === 7, '该 7 条排课，实际 ' + seeded.sched);
    return '6 段（2 条坏 + 1 条重复）· 7 条排课（2 条悬空）';
  });

  console.log('\n=== 1. 时间写法：24 小时制 ===');
  const fmt = await cdp.eval(`(() => ({
    f1450: Schedule._fmtMin(14 * 60 + 50),
    f1230: Schedule._fmtMin(12 * 60 + 30),
    t1450: Schedule._tmin('14:50'),
    t0250old: Schedule._tmin('02:50'),
    t0710: Schedule._tmin('07:10'),
    fmt0710: Schedule._fmtMin(7 * 60 + 10),
  }))()`);
  t('写出去就是 14:50，不再转 12 小时制；07:10 也不会被当成晚上', () => {
    assert(fmt.f1450 === '14:50', '14:50 该写 14:50，实际 ' + fmt.f1450);
    assert(fmt.f1230 === '12:30', '12:30 该写 12:30，实际 ' + fmt.f1230);
    assert(fmt.fmt0710 === '07:10', '07:10 该写 07:10，实际 ' + fmt.fmt0710);
    assert(fmt.t0710 === 430, '07:10 该是 430 分钟，实际 ' + fmt.t0710);
    return '14:50 / 12:30 / 07:10 全部原样';
  });
  t('老数据「02:50」仍按下午 14:50 解读（不读错）', () => {
    assert(fmt.t0250old === fmt.t1450, '02:50 该与 14:50 同值：' + fmt.t0250old + ' vs ' + fmt.t1450);
    return '02:50 → ' + fmt.t0250old + ' 分（= 14:50）';
  });

  console.log('\n=== 2. 坏行不再被「补字段」补成鬼时间 ===');
  const bad = await cdp.eval(`(() => {
    Schedule.renderPeriods();
    const ps = Store.list('periods');
    const b = ps.find(p => p.id === ${JSON.stringify(seeded.ids.pbad)});
    const chips = document.getElementById('ruleChips').textContent;
    return { start: b && b.start, end: b && b.end, dur: b && b.dur, gap: b && b.gap,
             ghost: /99:99|NaN|undefined/.test(chips), chips: chips.slice(0, 160) };
  })()`);
  t('只剩 id 的坏行保持原样，不会被写成 99:99 / undefined', () => {
    assert(!bad.start && !bad.end, '坏行不该凭空长出起止，实际 ' + bad.start + '→' + bad.end);
    assert(bad.dur == null && bad.gap == null, '坏行不该被补 dur/gap，实际 ' + bad.dur + '/' + bad.gap);
    assert(!bad.ghost, '界面上出现了 99:99/NaN/undefined：' + bad.chips);
    return '坏行原样保留（等重建时删）';
  });

  console.log('\n=== 3. 改开始时间：锁成锚点，后面 auto 段跟着走 ===');
  const edit = await cdp.eval(`(() => {
    const id = ${JSON.stringify(seeded.ids.p2)};
    Schedule.ruleEdit(id, 'start', '08:00');
    const ps = () => Store.list('periods');
    const g = x => ps().find(p => p.id === x);
    const first = { auto: g(id).auto, start: g(id).start, end: g(id).end,
                    p3: { start: g(${JSON.stringify(seeded.ids.p3)}).start, end: g(${JSON.stringify(seeded.ids.p3)}).end } };
    Schedule.recalcPeriods(); Schedule.recalcPeriods();
    const after = { start: g(id).start, end: g(id).end, auto: g(id).auto };
    Schedule._ruleOpen = true;
    Schedule.renderPeriods();
    const input = document.querySelector('[data-pid="' + id + '"] [data-k="start"]');
    return { first, after, disabled: input ? input.disabled : null };
  })()`);
  t('改过开始时间的那段：auto 立刻关掉、结束按原时长重算（08:00–08:40）', () => {
    assert(edit.first.auto === false, '改开始时间该自动关掉 auto，实际 ' + edit.first.auto);
    assert(edit.first.start === '08:00', '开始该是 08:00，实际 ' + edit.first.start);
    assert(edit.first.end === '08:40', '结束该按 40 分钟重算成 08:40，实际 ' + edit.first.end);
    return '08:00–08:40 · 自动顺延已取消';
  });
  t('后面那条 auto 段从新结束时间顺延（08:40 + 课间 10 = 08:50）', () => {
    assert(edit.first.p3.start === '08:50', '第 3 段该 08:50，实际 ' + edit.first.p3.start);
    assert(edit.first.p3.end === '09:30', '第 3 段该 09:30 结束，实际 ' + edit.first.p3.end);
    return '08:50–09:30';
  });
  t('再跑两遍重算也不会把这段改回去（手动的就是锚点）', () => {
    assert(edit.after.start === '08:00' && edit.after.end === '08:40' && edit.after.auto === false,
      '重算把手动段改了：' + JSON.stringify(edit.after));
    return 'recalc ×2 → 08:00–08:40 不动';
  });
  t('自动段的开始时间输入框不再禁用（旧版 disabled，等于「改不了」）', () => {
    assert(edit.disabled === false, '开始时间输入框该可编辑，实际 disabled=' + edit.disabled);
    return 'input[type=time] 可编辑';
  });

  console.log('\n=== 4. 编辑时焦点/滚动不跳 ===');
  const focus = await cdp.eval(`(async () => {
    App.go('timetable');
    await new Promise(r => setTimeout(r, 400));
    Schedule._ruleOpen = true;
    const panel = document.getElementById('rulePanel');
    panel.style.display = '';
    Schedule.renderPeriods();
    window.scrollTo(0, 240);
    const row = panel.querySelector('[data-pid="${seeded.ids.p3}"]');
    const gap = row.querySelector('[data-k="gap"]');
    window.__probeRow = row;
    gap.focus();
    const before = { top: Math.round(window.scrollY), active: document.activeElement === gap, html: panel.innerHTML.length };
    Schedule.ruleEdit('${seeded.ids.p3}', 'gap', '12');
    const after = { top: Math.round(window.scrollY), active: document.activeElement === gap,
                    sameRow: !!window.__probeRow && window.__probeRow.isConnected,
                    rows: panel.querySelectorAll('.per-row').length, val: gap.value };
    return { before, after, page: (document.querySelector('.page.on') || {}).id,
             box: Math.round(panel.getBoundingClientRect().height) };
  })()`);
  t('改课间时：焦点还在这个输入框、滚动位置不动、面板没被整块重灌', () => {
    assert(focus.before.active, '前置条件：焦点该在课间输入框（页 ' + focus.page + ' · 面板高 ' + focus.box + '）');
    assert(focus.after.active, '改完焦点丢了（旧版整块 render 的毛病）');
    assert(focus.after.top === focus.before.top, '滚动位置跳了：' + focus.before.top + ' → ' + focus.after.top);
    assert(focus.after.sameRow, '行节点被重建了（innerHTML 重灌）');
    assert(focus.after.rows === 6, '面板行数该还是 6，实际 ' + focus.after.rows);
    return '焦点保留 · 滚动 ' + focus.before.top + 'px 不动 · 行节点还是原来那个';
  });
  await shot(cdp, 'periods-panel.png');

  console.log('\n=== 5. 刚改过的 45 秒内，pull 盖不回来 ===');
  const hold = await cdp.eval(`(() => {
    const id = '${seeded.ids.p3}';
    const p = Store.list('periods').find(x => x.id === id);
    Store.upsert('periods', Object.assign({}, p, { start: '09:00', end: '09:40' }));
    const old = Object.assign({}, p, { start: '08:50', end: '09:30', _u: Date.now() + 999999 });
    Store.mergeRemote({ periods: [old] });
    const held = Store.list('periods').find(x => x.id === id).start;
    Store._wroteAt.periods = Date.now() - 46000;    // 模拟过了保护期
    Store.mergeRemote({ periods: [old] });
    const merged = Store.list('periods').find(x => x.id === id).start;
    return { held, merged };
  })()`);
  t('本地刚改完：远端旧值（_u 更大）也盖不回来；45 秒后才正常合并', () => {
    assert(hold.held === '09:00', '45 秒内该保留本地 09:00，实际 ' + hold.held);
    assert(hold.merged === '08:50', '过了保护期该按 _u 合并成 08:50，实际 ' + hold.merged);
    return '45s 内本地赢 · 之后按 _u 合并';
  });

  console.log('\n=== 6. 重建：10 段式时间轴 + 排课重挂 ===');
  const rep = await cdp.eval(`(() => {
    /* 先把第 2/3 段放回真实时间，再按真实节次重建 */
    Schedule.ruleEdit(${JSON.stringify(seeded.ids.p2)}, 'start', '08:40');
    Schedule.ruleEdit(${JSON.stringify(seeded.ids.p3)}, 'start', '09:30');
    const slots = [
      { start: '07:50', end: '08:30' },
      { start: '08:40', end: '09:20' },
      { start: '09:30', end: '10:10' },
      { start: '10:10', end: '10:30' },
      { start: '10:30', end: '11:10' },
      { start: '12:30', end: '13:10' },
      { start: '13:10', end: '13:50' },
      { start: '13:50', end: '14:30' },
      { start: '14:50', end: '15:30' },
      { start: '15:40', end: '16:20' },
    ];
    const before = Store.list('schedule').length;
    const r = Schedule.repairPeriods(slots, { remap: { ghost_period_id: '13:10' } });
    const ps = Schedule.periods();
    const sched = Store.list('schedule');
    const ghost = sched.filter(x => /每日即评通关/.test(x.title)).map(x => x.periodId);
    const targets = ghost.map(id => (ps.find(p => p.id === id) || {}).start);
    const unresolved = sched.filter(x => x.periodId && !ps.some(p => p.id === x.periodId)).length;
    const custom = sched.find(x => x.title === '晚课·一对一');
    return { r, before, after: Store.list('schedule').length, rawBefore: 0,
      n: ps.length, first: ps[0].start + '–' + ps[0].end, last: ps[ps.length - 1].start + '–' + ps[ps.length - 1].end,
      names: ps.map(p => p.name), ghost: targets, unresolved,
      customStart: (ps.find(p => p.id === custom.periodId) || {}).start || '(未挂)',
      raw: (Store.get('periods', []) || []).length,
      tombs: (Store.get('periods', []) || []).filter(p => p._d).length,
      allValid: ps.every(p => p.start && p.end && Schedule._tmin(p.end) > Schedule._tmin(p.start)),
      titles: sched.every(x => !!String(x.title || '').trim()),
    };
  })()`);
  t('重建出 10 段干净时间轴（07:50 起 · 15:40 收），全部有起止、end>start', () => {
    assert(rep.n === 10, '该 10 段，实际 ' + rep.n);
    assert(rep.first === '07:50–08:30', '第 1 段该 07:50–08:30，实际 ' + rep.first);
    assert(rep.last === '15:40–16:20', '最后一段该 15:40–16:20，实际 ' + rep.last);
    assert(rep.allValid, '仍有空起止 / end<=start 的段');
    return rep.first + ' … ' + rep.last + ' · 10 段全合法';
  });
  t('排课一条不丢、没有一条挂在已删节次上', () => {
    assert(rep.after === rep.before, '排课条数变了：' + rep.before + ' → ' + rep.after);
    assert(rep.unresolved === 0, '还有 ' + rep.unresolved + ' 条挂着不存在的节次');
    assert(rep.titles, '有排课丢了课程名');
    return rep.after + ' 条排课全挂上了';
  });
  t('悬空 periodId 的两节课按人工映射挂到 13:10，不是被丢掉', () => {
    assert(rep.ghost.length === 2, '该有 2 条悬空排课，实际 ' + rep.ghost.length);
    assert(rep.ghost.every(x => x === '13:10'), '悬空课该挂到 13:10，实际 ' + rep.ghost.join('/'));
    return '每日即评通关 ×2 → 13:10';
  });
  t('自定义时间的小课也按 13:10 挂上节次', () => {
    assert(rep.customStart === '13:10', '该挂到 13:10，实际 ' + rep.customStart);
    return '晚课·一对一 → 13:10';
  });
  t('坏段 / 重复段全部软删（墓碑留在底层，别的设备拉不回来）', () => {
    assert(rep.r.removed >= 3, '至少该删 3 段（重复 + 2 条坏行），实际 ' + rep.r.removed);
    assert(rep.tombs >= 3, '墓碑数不足：' + rep.tombs);
    assert(rep.r.moved >= 3, '重挂的排课太少：' + rep.r.moved);
    return '删 ' + rep.r.removed + ' 段（墓碑 ' + rep.tombs + '）· 重挂 ' + rep.r.moved + ' 条排课';
  });

  console.log('\n=== 7. 今日页刻度 = 真实节次，零空刻度 ===');
  const home = await cdp.eval(`(async () => {
    App.go('home');
    await new Promise(r => setTimeout(r, 700));
    const tk = Home.ticks();
    const ticks = [...document.querySelectorAll('#tlAxis .tl-tick')];
    return { n: tk.list.length, fallback: tk.fallback,
      dom: ticks.length,
      empty: ticks.filter(x => !((x.querySelector('.tl-label .num') || {}).textContent || '').trim()).length,
      labels: ticks.slice(0, 3).map(x => ((x.querySelector('.tl-label .num') || {}).textContent || '').trim()),
      hint: document.querySelectorAll('#tlAxis .tl-nodes > p.hint').length };
  })()`);
  t('今日页刻度数 = 10 段，没有空白刻度', () => {
    assert(home.n === 10, 'Home.ticks 该 10 段，实际 ' + home.n);
    assert(!home.fallback, '不该走考勤兜底刻度');
    assert(home.dom === 10, '轴上该 10 个刻度，实际 ' + home.dom);
    assert(home.empty === 0, '还有 ' + home.empty + ' 个刻度没时间标签');
    return '10 个刻度 · 时间标签齐 · 空刻度 0';
  });
  await cdp.eval(`(() => { const a = document.getElementById('tlAxis'); if (a) a.scrollIntoView({ block: 'center' }); })()`);
  await sleep(400);
  await shot(cdp, 'today-axis.png');
  t('刻度上的时段是真 24 小时制（不再 01:10/02:50 混着）', () => {
    const bad = home.labels.filter(x => /^0[1-5]:/.test(x));
    assert(!bad.length, '前面几个刻度还是 12 小时制：' + home.labels.join(' / '));
    return home.labels.join(' / ');
  });
  console.log('\n=== 8. 无 JS 异常 ===');
  const errs = await cdp.eval(`(window.__errs || [])`);
  t('整轮零报错', () => {
    assert(!errs.length, '有 ' + errs.length + ' 条：' + errs.slice(0, 3).join(' | '));
    return '0 条';
  });

} catch (e) {
  fail.push('脚本异常 → ' + e.message);
  console.log('\n❌ 脚本异常：' + e.message);
} finally {
  console.log('\n────────────');
  console.log('通过 ' + pass.length + ' 项，失败 ' + fail.length + ' 项');
  if (fail.length) fail.forEach(x => console.log('  ✗ ' + x));
  if (shots.length) console.log('截图：' + shots.join(' '));
  for (const c of chromes) { try { c.kill(); } catch {} }
  if (server) { try { server.kill(); } catch {} }
  await devReset();
  process.exit(fail.length ? 1 : 0);
}
