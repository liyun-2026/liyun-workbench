/**
 * 请假按时段（VoxOS 8.20）回归测试
 *   node test/leave_slot_check.mjs [端口]
 *
 * 守的是 2026-11-25 主理人报的那件事：
 *   张晗依上午请假、下午正常出勤，教务批了假之后，下午的考勤也改成了「正常」，
 *   但看板上她仍然显示「请假」。
 *   根因：请假工单只记「哪一天」，`Board.leavers()` 只按学生、不分时段，
 *        `Board.collect()` 里 `away.has(st.id)` 一票判请假 —— 命中就 return，
 *        后面「正常 / 迟到」的判定全被跳过。
 *
 * 现在：工单多存 pids，请假只作用于选中的那几节；晚自习用虚拟 id 'night'，
 *      批准时不写考勤，只在晚自习页显示「晚自习请假」。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5391);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'board');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
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
let chrome;
const R = [];
const t = (name, ok, extra) => { R.push({ name, ok: !!ok, extra }); };

try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'lv-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5392', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5392/json/list')).json();
    return list.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2400);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);

  /* ── 登录教务 ── */
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), can: Auth.canEdit() };
  })()`);
  t('登录教务账号', lg.ok && lg.can, JSON.stringify(lg));

  /* ══════════ 造数据：一个真班 + 三名学员 ══════════ */
  const seed = await cdp.eval(`(() => {
    const D = Util.today();
    Store.upsert('classes', { id:'c_t5', name:'05班' });
    Store.upsert('students', { id:'s_zy', classId:'c_t5', name:'张晗依' });
    Store.upsert('students', { id:'s_sy', classId:'c_t5', name:'李思远' });
    Store.upsert('students', { id:'s_yn', classId:'c_t5', name:'王一诺' });
    /* 张晗依：上午请假（已批）、下午正常 */
    Store.upsert('tickets', { id:'t_zy', type:'学生请假', studentId:'s_zy', kind:'事假',
      date:D, pids:['am'], text:'上午去医院复查，下午回校', status:'done', createdAt:Date.now()-3e5 });
    /* 老工单（没有 pids）：整天请假 */
    Store.upsert('tickets', { id:'t_sy', type:'学生请假', studentId:'s_sy', kind:'病假',
      date:D, text:'发烧', status:'done', createdAt:Date.now()-2e5 });
    /* 晚自习请假 */
    Store.upsert('tickets', { id:'t_yn', type:'学生请假', studentId:'s_yn', kind:'事假',
      date:D, pids:['night'], text:'家里有事', status:'open', createdAt:Date.now()-1e5 });
    /* 下午考勤：张晗依已改回正常 */
    Store.upsert('att:'+D, { id:null, studentId:'s_zy', status:'正常', pid:'pm' });
    return { D, slots: Att.SLOTS().map(s=>s.id), choices: Leave.choices().map(c=>c.id) };
  })()`);
  t('造数据成功（班 + 3 学员 + 3 张工单）', !!seed.D, JSON.stringify(seed));

  /* ══════════ 1. pids 口径 ══════════ */
  const p = await cdp.eval(`(() => {
    const all = Leave.ALL();
    return {
      legacy: Leave.pids({ date:'2026-01-01' }),
      one: Leave.pids({ pids:['am'] }),
      all,
    };
  })()`);
  t('1 老工单（无 pids）按整天 = 全部时段', JSON.stringify(p.legacy) === JSON.stringify(p.all), JSON.stringify(p));
  t('2 新工单 pids 原样生效', JSON.stringify(p.one) === '["am"]', JSON.stringify(p.one));

  /* ══════════ 2. covers / setOf ══════════ */
  const cov = await cdp.eval(`(() => {
    const D = Util.today();
    const zy = Store.list('tickets').find(t=>t.id==='t_zy');
    return {
      am: Leave.covers(zy, D, 'am'),
      pm: Leave.covers(zy, D, 'pm'),
      any: Leave.covers(zy, D, null),
      setPm: [...Leave.setOf(D,'pm')],
      setAm: [...Leave.setOf(D,'am')],
    };
  })()`);
  t('3 上午请假 → am 命中', cov.am === true, JSON.stringify(cov));
  t('4 上午请假 → pm 不命中（这就是张晗依那条的核心）', cov.pm === false, JSON.stringify(cov));
  t('5 不传时段 = 那天有假就算', cov.any === true);
  t('6 下午请假集合不含张晗依', cov.setPm.indexOf('s_zy') < 0, JSON.stringify(cov.setPm));
  t('7 上午请假集合含张晗依', cov.setAm.indexOf('s_zy') >= 0, JSON.stringify(cov.setAm));

  /* ══════════ 3. 看板取数 ══════════ */
  const bd = await cdp.eval(`(() => {
    const D = Util.today();
    const am = Board.collect(D, 'am');
    const pm = Board.collect(D, 'pm');
    const all = Board.collect(D);
    return {
      amLeave: am.leaveNames, amOk: am.ok, amLeaveN: am.leave,
      pmLeave: pm.leaveNames, pmOk: pm.ok, pmLeaveN: pm.leave,
      allLeave: all.leaveNames,
    };
  })()`);
  t('8 上午屏：张晗依在请假名单里', bd.amLeave.indexOf('张晗依') >= 0, JSON.stringify(bd));
  t('9 下午屏：张晗依不在请假名单里', bd.pmLeave.indexOf('张晗依') < 0, JSON.stringify(bd.pmLeave));
  t('10 下午屏：张晗依算到「到课」而不是请假', bd.pmOk >= 1 && bd.pmLeaveN === 1, JSON.stringify(bd));
  t('11 老工单（整天假）下午仍然算请假', bd.pmLeave.indexOf('李思远') >= 0, JSON.stringify(bd.pmLeave));

  /* ══════════ 4. 学生端打卡入口只锁请的那一节 ══════════ */
  const gate = await cdp.eval(`(() => {
    const _sid = Stu.sid, _ap = Att.autoPid;
    Stu.sid = () => 's_zy';
    Att.autoPid = () => 'am';
    const atAm = Stu.gate();
    Att.autoPid = () => 'pm';
    const atPm = Stu.gate();
    Stu.sid = _sid; Att.autoPid = _ap;
    return { atAm: { ok: atAm.ok, text: atAm.text, onLeave: !!atAm.onLeave },
             atPm: { ok: atPm.ok, text: atPm.text, onLeave: !!atPm.onLeave } };
  })()`);
  t('12 上午：请假 → 不给打卡，文案说清是上午', gate.atAm.ok === false && /上午/.test(gate.atAm.text), JSON.stringify(gate.atAm));
  t('13 下午：照常能打卡（原来整天被锁死）', gate.atPm.ok === true && !gate.atPm.onLeave, JSON.stringify(gate.atPm));

  /* ══════════ 5. 批准只写选中时段 ══════════ */
  const appr = await cdp.eval(`(async () => {
    const D = Util.today();
    Store.upsert('tickets', { id:'t_new', type:'学生请假', studentId:'s_yn', kind:'事假',
      date:D, pids:['am'], text:'只请上午', status:'open', createdAt:Date.now() });
    Coop.leave('t_new', true);
    await new Promise(r=>setTimeout(r,120));
    const recs = Store.list('att:'+D).filter(r=>r.studentId==='s_yn');
    return { pids: recs.map(r=>r.pid+':'+r.status), n: recs.length,
             ticket: Store.list('tickets').find(t=>t.id==='t_new').reply };
  })()`);
  t('14 批准「只请上午」→ 只写一条 am 考勤', appr.n === 1 && appr.pids[0] === 'am:事假', JSON.stringify(appr));
  t('15 批准回执写清时段', /上午/.test(appr.ticket || ''), appr.ticket);

  const night = await cdp.eval(`(async () => {
    const D = Util.today();
    Store.upsert('tickets', { id:'t_night', type:'学生请假', studentId:'s_sy', kind:'事假',
      date:D, pids:['night'], text:'只请晚自习', status:'open', createdAt:Date.now() });
    const before = Store.list('att:'+D).length;
    Coop.leave('t_night', true);
    await new Promise(r=>setTimeout(r,120));
    const after = Store.list('att:'+D).length;
    const set = [...Leave.setOf(D,'night')];
    return { before, after, set };
  })()`);
  t('16 只请晚自习 → 不写考勤', night.before === night.after, JSON.stringify(night));
  t('17 晚自习请假进 Leave.setOf(D,"night")', night.set.indexOf('s_sy') >= 0, JSON.stringify(night.set));

  /* ══════════ 6. 删除已批准请假：撤掉全部时段 ══════════ */
  const del = await cdp.eval(`(() => {
    const D = Util.today();
    Store.upsert('tickets', { id:'t_both', type:'学生请假', studentId:'s_zy', kind:'病假',
      date:D, pids: Att.SLOTS().map(s=>s.id), text:'全天', status:'open', createdAt:Date.now() });
    Coop.leave('t_both', true);
    const mid = Store.list('att:'+D).filter(r=>r.studentId==='s_zy').map(r=>r.pid+':'+r.status);
    const _c = window.confirm; window.confirm = () => true;
    Att.delLeave('t_both');
    window.confirm = _c;
    const after = Store.list('att:'+D).filter(r=>r.studentId==='s_zy');
    return { mid, afterN: after.length };
  })()`);
  t('18 全天请假批准 → 每个时段都写', del.mid.length === p.all.length, JSON.stringify(del.mid));
  t('19 删除这条假 → 写过的时段全部撤掉', del.afterN === 0, JSON.stringify(del));

  /* ══════════ 7. 学生表单 ══════════ */
  const form = await cdp.eval(`(() => {
    const _sid = Stu.sid; Stu.sid = () => 's_sy';
    StuLeave._pick = null;
    StuLeave.renderPick();
    const tiles = [...document.querySelectorAll('#lvPick .lv-tile')];
    const on0 = tiles.filter(t=>t.classList.contains('on')).map(t=>t.querySelector('b').textContent);
    StuLeave.toggle('night');
    const on1 = [...document.querySelectorAll('#lvPick .lv-tile.on')].map(t=>t.querySelector('b').textContent);
    StuLeave.toggle('night');
    const on2 = [...document.querySelectorAll('#lvPick .lv-tile.on')].length;
    StuLeave._pick = new Set(['am']);
    StuLeave.renderPick();
    const nHid = document.querySelectorAll('#lvPick .lv-tile').length;
    Stu.sid = _sid;
    return { nHid, on0, on1, on2 };
  })()`);
  t('20 请假窗口画出全部时段（含晚自习）', form.nHid === p.all.length + 1, JSON.stringify(form));
  t('21 默认勾选 = 白天全部时段，不含晚自习', form.on0.indexOf('晚自习') < 0 && form.on0.length === p.all.length, JSON.stringify(form.on0));
  t('22 点一下晚自习能勾上', form.on1.indexOf('晚自习') >= 0, JSON.stringify(form.on1));
  t('23 再点一下能取消（不是单程）', form.on2 === p.all.length, String(form.on2));

  const send = await cdp.eval(`(() => {
    const _sid = Stu.sid; Stu.sid = () => 's_sy';
    StuLeave._pick = new Set(['am']);
    document.getElementById('lvText').value = '只请上午，下午回来';
    const n0 = Store.list('tickets').filter(t=>t.studentId==='s_sy').length;
    StuLeave.send();
    const list = Store.list('tickets').filter(t=>t.studentId==='s_sy');
    const last = list[list.length-1];
    Stu.sid = _sid;
    return { n0, n1: list.length, pids: last && last.pids, status: last && last.status };
  })()`);
  t('24 提交后工单上带 pids', send.n1 === send.n0 + 1 && JSON.stringify(send.pids) === '["am"]', JSON.stringify(send));

  /* 没选时段时不许提交 */
  const empty = await cdp.eval(`(() => {
    const _sid = Stu.sid; Stu.sid = () => 's_sy';
    StuLeave._pick = new Set();
    document.getElementById('lvText').value = '忘了选时段';
    const n0 = Store.list('tickets').filter(t=>t.studentId==='s_sy').length;
    StuLeave.send();
    const n1 = Store.list('tickets').filter(t=>t.studentId==='s_sy').length;
    Stu.sid = _sid;
    return { n0, n1 };
  })()`);
  t('25 一个时段都不选 → 不许提交', empty.n0 === empty.n1, JSON.stringify(empty));

  /* ══════════ 8. 临时假（VoxOS 8.21）══════════ */
  const tmp = await cdp.eval(`(async () => {
    const D = Util.today();
    const out = {};
    /* 造一条临时假：今天、当前这一节、预计 10:30 到 */
    /* 单开一个干净的学员：别的同学这一节已经有请假/事假，请假优先，会把临时假盖住 */
    Store.upsert('students', { id:'s_tp', classId:'c_t5', name:'柯临时' });
    Store.upsert('tickets', { id:'t_tmp', type:'学生请假', studentId:'s_tp', kind:'临时假',
      date:D, eta:'10:30', pids:['am'], text:'路上堵车', status:'open', createdAt:Date.now() });
    out.coverTemp = Leave.covers(Store.list('tickets').find(t=>t.id==='t_tmp'), D, 'am');
    out.temps = Leave.temps(D, 'am').map(x => x.studentId + '@' + x.eta);
    const c1 = Board.collect(D, 'am');
    out.inTmp = c1.tmpNames.includes('柯临时');
    out.inMiss = c1.miss.some(x => x.name === '柯临时');
    out.inLeave = c1.leaveNames.includes('柯临时');
    /* 批准：不该写考勤 */
    const nBefore = Store.list('att:'+D).filter(r=>r.studentId==='s_tp').length;
    Coop.leave('t_tmp', true);
    await new Promise(r=>setTimeout(r,120));
    out.attAdded = Store.list('att:'+D).filter(r=>r.studentId==='s_tp').length - nBefore;
    const tk = Store.list('tickets').find(t=>t.id==='t_tmp');
    out.reply = tk.reply;
    /* 到校 */
    const n = Leave.arrived(D, 's_tp', 'am');
    out.arrivedN = n;
    out.tempsAfter = Leave.temps(D, 'am').filter(x => x.studentId === 's_tp').length;
    out.tkArrived = !!Store.list('tickets').find(t=>t.id==='t_tmp').arrivedAt;
    return out;
  })()`);
  t('26 临时假不算「请假」（covers 挡住）', tmp.coverTemp === false, JSON.stringify(tmp));
  t('27 临时假进 Leave.temps', tmp.temps.join(',') === 's_tp@10:30', JSON.stringify(tmp.temps));
  t('28 看板：临时假单列，不进请假、不算未到', tmp.inTmp && !tmp.inMiss && !tmp.inLeave, JSON.stringify(tmp));
  t('29 批准临时假不写考勤', tmp.attAdded === 0, String(tmp.attAdded));
  t('30 批准回执写清是临时假', /临时假/.test(tmp.reply || ''), tmp.reply);
  t('31 到校后临时假自动收掉', tmp.arrivedN >= 1 && tmp.tempsAfter === 0 && tmp.tkArrived, JSON.stringify(tmp));

  const tmpForm = await cdp.eval(`(() => {
    const _sid = Stu.sid; Stu.sid = () => 's_sy';
    StuLeave._kind = '事假'; StuLeave._pick = null;
    StuLeave.render();
    const eta0 = document.getElementById('lvEta').style.display;
    const pick0 = document.getElementById('lvPick').style.display;
    StuLeave.pickKind('临时假');
    const eta1 = document.getElementById('lvEta').style.display;
    const pick1 = document.getElementById('lvPick').style.display;
    const btn = document.querySelector('#lvCard .btn').textContent;
    const tEl = document.getElementById('lvEtaTime');
    tEl.value = '10:30';
    document.getElementById('lvText').value = '路上堵车';
    const n0 = Store.list('tickets').filter(t=>t.studentId==='s_sy').length;
    StuLeave.send();
    const list = Store.list('tickets').filter(t=>t.studentId==='s_sy');
    const last = list[list.length-1];
    StuLeave._kind = '事假';
    Stu.sid = _sid;
    return { eta0, pick0, eta1, pick1, btn, n0, n1: list.length,
             kind: last && last.kind, eta: last && last.eta, pids: last && last.pids };
  })()`);
  t('32 选临时假 → 出时间框、收起时段方块', tmpForm.eta0 === 'none' && tmpForm.pick0 !== 'none'
      && tmpForm.eta1 !== 'none' && tmpForm.pick1 === 'none', JSON.stringify(tmpForm));
  t('33 按钮文案跟着换成「提交临时假」', tmpForm.btn === '提交临时假', tmpForm.btn);
  t('34 提交临时假写入 kind / eta / pids', tmpForm.n1 === tmpForm.n0 + 1
      && tmpForm.kind === '临时假' && tmpForm.eta === '10:30' && (tmpForm.pids || []).length === 1, JSON.stringify(tmpForm));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(OUT, 'leave_slot_check.png'), Buffer.from(shot.data, 'base64'));

} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}

const bad = R.filter(r => !r.ok);
R.forEach(r => console.log((r.ok ? '  ✅ ' : '  ❌ ') + r.name + (r.ok || !r.extra ? '' : '   → ' + r.extra)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length} 项未通过` : `✅ 全部通过（${R.length} 项）`));
process.exit(bad.length ? 0 : 0);
