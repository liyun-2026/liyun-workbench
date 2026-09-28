/**
 * 授课老师端使用教程素材采集
 *   node test/capture_tea_tutorial.mjs [PORT]
 *
 * 采集授课老师端「手机为主 + 电脑为辅」的完整界面，并复现关键交互状态：
 *   今天（五张卡）/ 每日新闻 / 录入今日（选班→点有情况的学生→状态/作业/表现）/ 我带的班 /
 *   学员档案 / 上报与申请（调课时段面板）/ 设置 / 设备密钥门 / 登录页
 *
 * 演示数据刻意灌满（通知、考勤、课表、作业、评语、老师发的工单含已处理+回复），避免空状态。
 * 输出：test/.shots/teatut/*.png
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5341);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'teatut');
const SUPER = { user: '李老师', pass: 'liyun2026' };

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
async function shot(cdp, name){
  await sleep(340);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  📸 ' + name);
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };
const MOB  = { width: 420,  height: 940, dsf: 2, mobile: true };

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'stutut-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5342',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5342/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  // ── 登录首位教务（super）并灌数据 ────────────────────
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败');
  console.log('   已登录 super，角色：' + lg.role + '\n');

  console.log('② 灌入演示数据');
  const seed = await cdp.eval(`(async () => {
    const today = Util.today();
    const d = new Date(today); d.setDate(d.getDate() - 1);
    const yest = Util.dateOf(d);

    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });

    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾'];
    const N2 = ['周若溪','吴俊熙','郑雨桐','冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));

    // 考勤
    s1.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s1[2].id, status: '迟到' });
    Store.upsert('att:' + today, { studentId: s1[4].id, status: '事假' });
    Store.upsert('att:' + today, { studentId: s1[5].id, status: '病假' });
    s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));

    // 作息 + 课表
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    const p4 = Store.upsert('periods', { name: '晚课',  start: '18:30', end: '20:30' });
    const sch = (day, periodId, title, cls, stu, room) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu, room });
    sch('周一', p1.id, '普通话语音基础', '砺蕴一班', '', '教室1');
    sch('周一', p3.id, '新闻播报实训',   '砺蕴一班', '', '上镜教室');
    sch('周三', p2.id, '文学作品朗读',   '砺蕴一班', '');
    sch('周四', p3.id, '模拟主持',       '砺蕴一班', '');
    Store.upsert('schedule', { kind: 'small', day: '周二', periodId: p4.id, title: '一对一纠音', cls: '', stu: '王梓涵' });

    // 量化
    Quant.syncAtt(c1.id, today);
    const add = (clsId, date, label, delta) => Store.upsert('quant_log', { clsId, date, label, delta });
    add(c1.id, today, '课堂表现良好', 2);
    add(c1.id, today, '作业全交', 2);
    add(c1.id, yest, '早功出勤满', 1);

    // 模考：三次，王梓涵朗读强 / 评述弱
    const sh1 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第1次模考', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 14); return Util.dateOf(x); })() });
    const sh2 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第2次模考', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 7); return Util.dateOf(x); })() });
    const sh3 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第3次模考', date: today });
    const put = (sheetId, sid, r, n, t) => Store.upsert('exam_scores', { sheetId, studentId: sid, scoreRead: r, scoreNews: n, scoreTalk: t });
    put(sh1.id, s1[0].id, 86, 78, 64); put(sh2.id, s1[0].id, 88, 80, 66); put(sh3.id, s1[0].id, 91, 82, 69);
    put(sh3.id, s1[1].id, 76, 92, 84); put(sh3.id, s1[2].id, 87, 84, 81);

    // 作业 + 今日检查（学生端「今日作业」读 homework + hwchk）
    const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    const h2 = Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
    hk(s1[0].id, true); hk(s1[1].id, true);
    Store.upsert('hw:' + h1.id, { studentId: s1[0].id, done: true });

    // 教务通知（今日卡不空）
    Store.upsert('notices', { text: '明天早功 7:20 在形体房集合，请提前十分钟到，带上练声稿。', date: today, by: '王敏', at: Date.now() - 3600e3 });
    Store.upsert('notices', { text: '本周五下午统一拍摄证件照，穿白色衬衫，注意仪容。', date: today, by: '王敏', at: Date.now() - 7200e3 });

    // 抽签：王梓涵在名单里
    Store.upsert('exam_draws', { name: '9月月考出场顺序', ids: s1.map(x => x.id), seed: 20260926, round: 1, at: Date.now() - 86400e3, by: '王敏' });

    // 老师评语
    Store.upsert('records', { studentId: s1[0].id, text: '本周语音面貌进步明显，声母归音到位，继续保持。评述注意论点收束，别铺太开。', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 3); return Util.dateOf(x); })(), byName: '陈静' });

    // 学生请假记录（已批准）
    Store.upsert('tickets', { type: '学生请假', text: '上午去医院复查，下午回校。', status: 'done', createdAt: Date.now() - 172800e3, studentId: s1[0].id, kind: '病假', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 2); return Util.dateOf(x); })() });
    Store.upsert('tickets', { type: '学生请假', text: '家中有事，下午请假半天。', status: 'open', createdAt: Date.now() - 3600e3, studentId: s1[0].id, kind: '事假', date: today });

    // 限时征集（一条进行中、一条已完成）
    const g1 = Store.upsert('gathers', { title: '国庆晚会节目申报', desc: '每人报一个节目，注明形式与时长。', deadline: (() => { const x = new Date(today); x.setDate(x.getDate() + 3); return Util.dateOf(x) + 'T18:00'; })(), questions: ['节目名称', '节目形式', '预计时长'], createdAt: Date.now() - 7200e3 });
    const g2 = Store.upsert('gathers', { title: '新学期信息核对', desc: '核对一下你的联系方式。', questions: ['手机号'], createdAt: Date.now() - 259200e3 });
    Store.upsert('gresp:' + g2.id, { id: s1[0].id, gatherId: g2.id, answers: ['138****6621'] });

    Store.upsert('sign_rules', { code: '8821', radius: 150, lat: 34.75, lng: 113.62, startAt: '08:30', lateAfter: 0 });

    // 账号
    const mkAcc = async (user, name, role, classIds, studentId) => {
      try { await Auth.call('users', { op: 'create', user, name, role, pass: 'liyun2026', classIds, studentId }); } catch(e){}
    };
    await mkAcc('王敏', '王敏', 'admin', []);
    await mkAcc('陈静', '陈静', 'teacher', [c1.id]);

    // 老师「上报与申请 → 我发过的」要非空：留几条工单（含已处理 + 教务回复）
    Store.upsert('tickets', { type: '调课申请', text: '周三第 2 节想换到周四同一节，连续三周都撞专业课。', status: 'open', createdAt: Date.now() - 86400e3, byName: '陈静' });
    Store.upsert('tickets', { type: '学生异常', text: '张予诺最近三天早功迟到两次，情绪也偏低落，请教务关注。', status: 'done', reply: '已约谈，家长已知情，后续由我跟进。', createdAt: Date.now() - 172800e3, byName: '陈静' });
    Store.upsert('tickets', { type: '请假上报', text: '李思远下周需请假参加艺考校考，材料随后补。', status: 'open', createdAt: Date.now() - 3600e3, byName: '陈静' });

    // 注：「录入今日 → 已记 N 人」由采集脚本在陈静登录后按她真实 id 写入，避免 id 不匹配
    return { c1: c1.id, sid: s1[0].id, today, sids: s1.map(x => x.id) };
  })()`);
  console.log('   数据就绪：砺蕴一班 7 人 + 通知/抽签/评语/请假/征集/成绩\n');

  // ── 切授课老师账号 ──────────────────────────────────
  const asTeacher = async () => {
    await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
    const l = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l; await sleep(2400);
    const r = await cdp.eval(`(async () => {
      if (!Auth.mode) await Auth.probe();
      document.getElementById('gUser').value = '陈静';
      document.getElementById('gPass').value = 'liyun2026';
      await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
      return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role(), staff: Auth.isStaff() };
    })()`);
    if (!r.ok) throw new Error('老师登录失败');
    console.log('   已登录授课老师：陈静（' + r.role + '）\n');
  };

  // ── 手机端逐页（主角）────────────────────────────────
  console.log('③ 手机端（授课老师实际使用的形态）');
  await view(cdp, MOB);
  await sleep(500);
  const mgo = async (id, name) => {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=0; await new Promise(r=>setTimeout(r,420)); return 1; })()`);
    await shot(cdp, name);
  };

  await asTeacher();
  // 预置：录入今日先选好班；并给陈静留几条「今日情况」让录入页显示「已记 N 人」
  await cdp.eval(`(async () => { Store.set('_rcCls', ${JSON.stringify(seed.c1)}); return 1; })()`);
  await cdp.eval(`(async () => {
    const c1 = ${JSON.stringify(seed.c1)};
    const sids = ${JSON.stringify(seed.sids)};
    const me = Auth.me().id, today = Util.today();
    const set = (sid, state, perf) => Store.upsert('records', {
      studentId: sid, classId: c1, date: today, byId: me, byName: Auth.name(), state, perf: perf || '', hw: '' });
    set(sids[1], '状态好', '新闻播报状态稳，镜头感好。');
    set(sids[2], '需关注', '评述论点松散，需加强收束。');
    set(sids[3], '一般', '');
    return 1;
  })()`);

  await mgo('today', 'm-tea-home.png');
  // 今日页滚到底：让「本周我的课 / 每日新闻」整卡可见
  await cdp.eval(`(async () => { const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=940; window.scrollTo(0,940); await new Promise(r=>setTimeout(r,380)); return 1; })()`);
  await shot(cdp, 'm-tea-home-scroll.png');

  // 录入今日：选好班后，学生一行一行
  await mgo('record', 'm-tea-record.png');
  await cdp.eval(`(async () => { const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=720; window.scrollTo(0,720); await new Promise(r=>setTimeout(r,380)); return 1; })()`);
  await shot(cdp, 'm-tea-record-scroll.png');

  // 我带的班
  await mgo('myclass', 'm-tea-myclass.png');
  // 学员档案：从「我带的班」点开一个学生
  await cdp.eval(`(async () => { Student.openFor(${JSON.stringify(seed.sid)}); await new Promise(r=>setTimeout(r,560)); return 1; })()`);
  await shot(cdp, 'm-tea-profile.png');
  await cdp.eval(`(async () => { App.go('myclass'); await new Promise(r=>setTimeout(r,420)); return 1; })()`);

  // 上报与申请：默认态
  await mgo('tickets', 'm-tea-tickets.png');
  // 触发调课时段面板：填一句调课的话点「发出」
  await cdp.eval(`(async () => {
    const t=document.getElementById('tkType'); if(t) t.value='调课申请';
    const x=document.getElementById('tkText'); if(x) x.value='周三第 2 节想换到周四同一节，连续三周都撞专业课。';
    Ticket.send();
    await new Promise(r=>setTimeout(r,520));
    return 1;
  })()`);
  await shot(cdp, 'm-tea-tickets-slots.png');
  await cdp.eval(`(() => { Ticket.slotsOff(); return 1; })()`);

  await mgo('news', 'm-tea-news.png');
  await mgo('settings', 'm-tea-settings.png');

  // 「全部功能」抽屉：点手机顶栏那个按钮弹出来的
  await mgo('today', 'm-tea-home.png');
  await cdp.eval(`(async () => { App.drawer(true); await new Promise(r=>setTimeout(r,460)); return 1; })()`);
  await shot(cdp, 'm-tea-drawer.png');
  await cdp.eval(`(() => { App.drawer(false); return 1; })()`);

  // 设备密钥门
  await cdp.eval(`(() => { StuDev.open({}); return 1; })()`);
  await sleep(400);
  await shot(cdp, 'm-tea-devgate.png');
  await cdp.eval(`(() => { StuDev.close(); return 1; })()`);

  // ── 电脑端逐页（辅）──────────────────────────────────
  console.log('④ 电脑端');
  await view(cdp, DESK);
  await sleep(500);
  const dgo = async (id, name) => {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=0; await new Promise(r=>setTimeout(r,420)); return 1; })()`);
    await shot(cdp, name);
  };
  await dgo('today',   'd-tea-home.png');
  await dgo('record',  'd-tea-record.png');
  await dgo('myclass', 'd-tea-myclass.png');
  await dgo('tickets', 'd-tea-tickets.png');
  await dgo('news',    'd-tea-news.png');
  await dgo('settings','d-tea-settings.png');
  await cdp.eval(`(async () => { Student.openFor(${JSON.stringify(seed.sid)}); await new Promise(r=>setTimeout(r,560)); return 1; })()`);
  await shot(cdp, 'd-tea-profile.png');
  await cdp.eval(`(async () => { App.go('today'); await new Promise(r=>setTimeout(r,420)); return 1; })()`);

  // ── 登录页（电脑 + 手机）白底干净 ────────────────────
  console.log('⑤ 登录页');
  const showGate = async () => {
    await cdp.eval(`(async () => {
      Store.setSecret('token',''); Store.setSecret('acct','');
      await new Promise(r => setTimeout(r, 200));
      const g = document.getElementById('gate'); if (g) g.classList.add('on');
      const u = document.getElementById('gUser'); if (u) u.value='';
      const p = document.getElementById('gPass'); if (p) p.value='';
      const n = document.getElementById('gNote'); if (n) n.style.display='none';
      return 1;
    })()`);
    await sleep(600);
  };
  await view(cdp, DESK);
  await showGate();
  await shot(cdp, 'd-tea-gate.png');
  await view(cdp, MOB);
  await sleep(400);
  await showGate();
  await shot(cdp, 'm-tea-gate.png');

  console.log('\n✅ 授课老师端教程素材完成 → test/.shots/teatut/');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
