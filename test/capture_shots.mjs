/**
 * 素材采集：为「系统介绍 + 使用培训」PPT 与教程长图，采集一套干净的真实界面截图。
 *   node test/capture_shots.mjs
 *
 * 与验收测试的区别：本脚本不做断言，只负责用真实感的演示数据把每个页面渲染出来并截图。
 * 输出：test/.shots/ppt/*.png
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5331);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'ppt');
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
  await sleep(320);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  📸 ' + name);
}
/** 滚动到某元素再截（用于卡片下方的模块） */
async function shotAt(cdp, sel, name){
  await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({ block: 'start' }); })()`);
  await shot(cdp, name);
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };
const MOB  = { width: 420,  height: 940, dsf: 2, mobile: true };

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'shots-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5332',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5332/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);   // 等开屏动画走完

  // ── ① 开屏（手动点亮） ─────────────────────────────
  console.log('① 开屏与登录门');
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.classList.remove('off','hide','done'); s.style.display=''; s.style.opacity='1'; } })()`);
  await shot(cdp, 'g1-splash.png');
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);

  // ── ② 登录（首个账号即首位教务） ─────────────────────
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败');
  console.log('   已登录，角色：' + lg.role + '\n');

  // ── ③ 灌入真实感演示数据 ────────────────────────────
  console.log('② 建立演示数据（班级 / 学员 / 考勤 / 量化 / 模考 / 作业 / 周末班）');
  const seed = await cdp.eval(`(async () => {
    const today = Util.today();
    const d = new Date(today); d.setDate(d.getDate() - 1);
    const yest = Util.dateOf(d);
    const sat = (() => { const x = new Date(today); x.setDate(x.getDate() - ((x.getDay() + 6) % 7) - 1); return Util.dateOf(x); })();

    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });

    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾'];
    const N2 = ['周若溪','吴俊熙','郑雨桐','冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));

    // 今日考勤：2 迟到 / 1 事假 / 1 病假，其余正常
    const mk = (arr, st, n) => arr.slice(0, n).forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id, status: st }));
    s1.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s1[2].id, status: '迟到' });
    Store.upsert('att:' + today, { studentId: s1[4].id, status: '事假' });
    Store.upsert('att:' + today, { studentId: s1[5].id, status: '病假' });
    s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s2[1].id, status: '迟到' });

    // 晚自习：集训班 昨天 + 今天
    s2.slice(0, 6).forEach((s, i) => Store.upsert('night:' + yest, { studentId: s.id, st: i < 5 ? '过' : '未过' }));
    s2.slice(0, 6).forEach((s, i) => Store.upsert('night:' + today, { studentId: s.id, st: i < 5 ? '过' : '未过' }));

    // 作息 + 课表
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    const p4 = Store.upsert('periods', { name: '晚课',  start: '18:30', end: '20:30' });
    const sch = (day, periodId, title, cls, stu) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu });
    sch('周一', p1.id, '普通话语音基础', '砺蕴一班', '');
    sch('周一', p3.id, '新闻播报实训',   '砺蕴一班', '');
    sch('周二', p1.id, '即兴评述训练',   '集训班',   '');
    sch('周三', p2.id, '文学作品朗读',   '砺蕴一班', '');
    sch('周四', p3.id, '模拟主持',       '集训班',   '');
    sch('周六', p4.id, '统考全真模拟',   '集训班',   '');
    sch('周日', p4.id, '考前冲刺集训',   '集训班',   '');
    Store.upsert('schedule', { kind: 'small', day: '周二', periodId: p4.id, title: '一对一纠音', cls: '', stu: '周若溪、徐子墨' });
    Store.upsert('schedule', { kind: 'small', day: '周四', periodId: p4.id, title: '上镜补录', cls: '', stu: '冯亦辰' });

    // 量化：先让考勤自动进分
    Quant.syncAtt(c1.id, today);
    Quant.syncAtt(c2.id, today);
    // 再补几条手工加减分
    const add = (clsId, date, label, delta) => Store.upsert('quant_log', { clsId, date, label, delta });
    add(c1.id, today, '课堂表现良好', 2);
    add(c1.id, today, '作业全交', 2);
    add(c2.id, today, '课堂纪律', -1);
    add(c2.id, yest, '晚自习过关率第一', 3);

    // 模考：三场，让科目强弱有区分
    const sh1 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第1次模考', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 14); return Util.dateOf(x); })() });
    const sh2 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第2次模考', date: (() => { const x = new Date(today); x.setDate(x.getDate() - 7); return Util.dateOf(x); })() });
    const sh3 = Store.upsert('exam_sheets', { clsId: c1.id, name: '9月第3次模考', date: today });
    Store.set('_exCls', c1.id); Store.set('_exSheet', sh3.id);
    const put = (sheetId, sid, r, n, t) => Store.upsert('exam_scores', { sheetId, studentId: sid, scoreRead: r, scoreNews: n, scoreTalk: t });
    // 王梓涵：朗读强 / 评述弱
    put(sh1.id, s1[0].id, 86, 78, 64); put(sh2.id, s1[0].id, 88, 80, 66); put(sh3.id, s1[0].id, 91, 82, 69);
    // 李思远：播报强 / 朗读弱
    put(sh1.id, s1[1].id, 72, 88, 80); put(sh2.id, s1[1].id, 74, 90, 82); put(sh3.id, s1[1].id, 76, 92, 84);
    // 张予诺：稳步上升
    put(sh1.id, s1[2].id, 78, 75, 72); put(sh2.id, s1[2].id, 83, 80, 77); put(sh3.id, s1[2].id, 87, 84, 81);
    // 陈可儿：评述强
    put(sh1.id, s1[3].id, 80, 79, 90); put(sh2.id, s1[3].id, 82, 81, 92); put(sh3.id, s1[3].id, 84, 83, 94);
    // 刘浩然 / 赵一诺 / 孙嘉禾
    put(sh3.id, s1[4].id, 76, 74, 70);
    put(sh3.id, s1[5].id, 82, 85, 79);
    put(sh3.id, s1[6].id, 85, 83, 88);

    // 作业：两条 + 今日检查
    const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    const h2 = Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    Store.set('_hkCls', c1.id); Store.set('_hkDate', today);
    const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
    s1.slice(0, 5).forEach(s => hk(s.id, true));
    hk(s1[5].id, false);
    // 昨天的作业登记
    Store.upsert('hw:' + h1.id, { studentId: s1[0].id, done: true });

    // 周末班：上周六 + 本周六（今天）
    const wk = (date, ids) => ids.forEach(sid => Store.upsert('wk:' + date, { studentId: sid }));
    wk(sat, [s1[0].id, s1[2].id, s2[0].id, s2[2].id, s2[4].id]);
    wk(today, [s1[0].id, s1[2].id, s1[4].id, s2[0].id, s2[2].id, s2[4].id, s2[6].id]);
    Store.set('_wkDate', today);

    // 工单：老师上报
    Store.upsert('tickets', { type: '调课申请', text: '周三下午第 2 节「文学作品朗读」与「即兴评述训练」时间冲突，申请把朗读课调到周四下午。', status: 'open', createdAt: Date.now() - 3600e3 });
    Store.upsert('tickets', { type: '设备报修', text: '上镜教室 2 号机位的补光灯不亮了，需要更换。', status: 'open', createdAt: Date.now() - 7200e3 });
    Store.upsert('tickets', { type: '学生情况上报', text: '周若溪连续两次作业未交，已单独沟通过，家长表示会配合监督。', status: 'done', reply: '收到，已记录，下周重点跟进。', repliedAt: Date.now() - 1800e3, createdAt: Date.now() - 9000e3 });

    Store.set('_qCls', c1.id);
    Store.set('_pfCls', c1.id); Store.set('_pfStu', s1[0].id);
    Store.set('_attCls', c1.id); Store.set('_attDate', today);
    Store.set('_nightCls', c2.id); Store.set('_nightDate', yest);
    Store.set('_rosterCls', c1.id);

    // 老师账号：张伟（带集训班）、王敏（教务老师）、陈静（教务兼授课）
    const mkAcc = async (user, name, role, classIds) => {
      try { await Auth.call('users', { op: 'create', user, name, role, pass: 'liyun2026', classIds }); } catch(e){}
    };
    await mkAcc('张伟', '张伟', 'teacher', [c2.id]);
    await mkAcc('王敏', '王敏', 'admin', []);
    await mkAcc('陈静', '陈静', 'both', [c1.id]);
    return { c1: c1.id, c2: c2.id, s1: s1.map(x => x.id), s2: s2.map(x => x.id), today, yest };
  })()`);
  console.log('   数据就绪：砺蕴一班 7 人 / 集训班 8 人 + 3 个老师账号\n');

  // 让量化细则先落种子（否则考勤分值取不到）
  await cdp.eval(`(async () => { App.go('settings'); await new Promise(r => setTimeout(r, 500)); Quant.syncAllAtt && Quant.syncAllAtt(); return 1; })()`);

  // ── ④ 教务端逐页截图 ───────────────────────────────
  console.log('③ 教务端各页面');
  const go = async (id, wait = 620) => { await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); await new Promise(r => setTimeout(r, 60)); return 1; })()`); await sleep(wait); };

  await go('home');       await cdp.eval(`window.scrollTo(0,0); document.querySelectorAll('.main,#main,.content').forEach(e=>e.scrollTop=0)`); await shot(cdp, '01-home.png');
  await go('att');        await shot(cdp, '02-att.png');
  await go('homework');   await shot(cdp, '03-homework.png');
  await go('roster');     await shot(cdp, '04-roster.png');
  await shotAt(cdp, '#wkBody', '05-weekend.png');
  await go('profile');    await shot(cdp, '06-profile.png');
  await go('timetable');  await shot(cdp, '07-timetable.png');
  await go('night');      await shot(cdp, '08-night.png');
  await go('quant');      await shot(cdp, '09-quant.png');
  await go('exam');       await shot(cdp, '10-exam.png');
  await go('coop');       await shot(cdp, '11-coop.png');
  await go('teachers');   await shot(cdp, '12-teachers.png');
  // 身份选择窗口
  await cdp.eval(`(async () => { Teachers.openRole(); await new Promise(r => setTimeout(r, 560)); return 1; })()`);
  await shot(cdp, '13-role-picker.png');
  await cdp.eval(`(() => { Teachers.closeRole(); return 1; })()`);
  await go('settings');   await shot(cdp, '14-settings.png');

  // ── ⑤ 手机端 ───────────────────────────────────────
  console.log('④ 手机端');
  await view(cdp, MOB);
  await sleep(500);
  await cdp.eval(`(async () => { App.go('home'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,300)); return 1; })()`);
  await shot(cdp, 'm1-home.png');
  await cdp.eval(`(async () => { App.go('att'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,300)); return 1; })()`);
  await shot(cdp, 'm2-att.png');
  await cdp.eval(`(async () => { App.go('quant'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,300)); return 1; })()`);
  await shot(cdp, 'm3-quant.png');
  await cdp.eval(`(async () => { App.drawer(true); await new Promise(r=>setTimeout(r,520)); return 1; })()`);
  await shot(cdp, 'm4-drawer.png');
  await cdp.eval(`(() => { App.drawer(false); return 1; })()`);

  // ── ⑥ 建老师账号并切角色截老师端 ─────────────────────
  console.log('⑤ 老师端（切角色登录）');

  const asUser = async (user, pass) => {
    await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
    const l = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l;
    await sleep(2400);
    const r = await cdp.eval(`(async () => {
      if (!Auth.mode) await Auth.probe();
      document.getElementById('gUser').value = ${JSON.stringify(user)};
      document.getElementById('gPass').value = ${JSON.stringify(pass)};
      await Auth.submit();
      await new Promise(r => setTimeout(r, 1800));
      return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
    })()`);
    if (!r.ok) throw new Error('登录失败：' + user);
    console.log('   已切换为 ' + user + '（' + r.role + '）');
    return r;
  };

  await view(cdp, DESK);
  await asUser('张伟', 'liyun2026');
  // 老师端默认落在「集训班」（他带的班），而不是系统里第一个班
  await cdp.eval(`(() => { Store.set('_rcCls', ${JSON.stringify(seed.c2)}); Store.set('_rcDate', ${JSON.stringify(seed.today)}); Store.set('_attCls', ${JSON.stringify(seed.c2)}); return 1; })()`);
  await cdp.eval(`(async () => { App.go('today'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 't1-today.png');
  for (const [id, name] of [['record','t2-record.png'],['myclass','t3-myclass.png'],['tickets','t4-tickets.png']]) {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
    await shot(cdp, name);
  }
  // 老师端手机版（老师实际是在手机上用）
  await view(cdp, MOB);
  await sleep(500);
  await cdp.eval(`(async () => { App.go('record'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'm5-record.png');

  // ── ⑦ 登出后的登录门 ────────────────────────────────
  console.log('⑥ 登录门');
  await view(cdp, DESK);
  await sleep(400);
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Store.setSecret('acct','');
    await new Promise(r => setTimeout(r, 200));
    const g = document.getElementById('gate');
    if (g){ g.classList.add('on'); }
    return 1;
  })()`);
  await sleep(600);
  await shot(cdp, 'g2-gate.png');

  console.log('\n✅ 全部截图完成 → test/.shots/ppt/');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
