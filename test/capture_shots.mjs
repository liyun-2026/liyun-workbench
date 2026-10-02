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
/** 局部裁切图的实际像素尺寸（@2x）—— 版式里给图片框定尺寸时要照着它来，
 *  不能凭猜：猜小了会被拉变形，猜大了留白。跑完落在 .shots/ppt/_sizes.json。 */
const REGION_SIZES = {};

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
/** 只截某一个元素（按它自己的实际尺寸 + 一圈留白）。
 *
 *  为什么不能直接用整页图裁：整页图是 1440×900 的视口快照，卡片在页面里的
 *  纵坐标随上面内容的高度漂移 —— 手写裁切框迟早会对不齐。这里让浏览器自己
 *  报出元素的位置和尺寸，落盘就是「刚好那一块」。
 *
 *  ⚠️ 曾经这里还能指定目标宽高比、把框撑成那个比例。**别再加回来**：
 *  页面里的卡片大多是又宽又扁的一条（比例 4:1 上下），为了凑 1.55 的比例
 *  就得往上下各撑一大截，结果把上面和下面那两张卡一起框了进来（踩过）。
 *  现在一律按元素原样裁，版式那边照着 _sizes.json 里的真实比例摆。
 *
 *  jsFind 是一段返回 Element 的 JS 表达式，例如：
 *      "document.getElementById('skBody').closest('.card')"
 */
async function shotRegion(cdp, jsFind, name, pad = 14){
  const okScroll = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return 0;
    el.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()`);
  if (!okScroll){ console.log('  ⚠ 找不到元素，跳过 ' + name); return false; }
  await sleep(280);
  const b = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }; })()`);
  if (!b || b.w < 4 || b.h < 4){ console.log('  ⚠ 元素没尺寸，跳过 ' + name); return false; }
  let w = b.w + pad * 2, h = b.h + pad * 2;
  if (w > b.vw || h > b.vh){
    const k = Math.min(b.vw / w, b.vh / h);
    w *= k; h *= k;
    console.log(`  ⚠ ${name} 比视口大，缩到 ${Math.round(w)}×${Math.round(h)}`);
  }
  const x = Math.max(0, Math.min(b.x + b.w / 2 - w / 2, b.vw - w));
  const y = Math.max(0, Math.min(b.y + b.h / 2 - h / 2, b.vh - h));
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), scale: 2 },
  });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  REGION_SIZES[name] = [Math.round(w) * 2, Math.round(h) * 2];
  console.log(`  ✂ ${name}  ${Math.round(w)}×${Math.round(h)} (比例 ${(w/h).toFixed(2)}) @2x`);
  return true;
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
    // 学生账号：王梓涵（挂在已灌数据的真实学员档案 s1[0] 上，学生端才看得到数据）
    try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch (e) {}
    // 让学生端「打卡」页有动态码可显示
    try { Store.upsert('sign_rules', { code: '8821', radius: 150, lat: 34.75, lng: 113.62 }); } catch (e) {}

    /* ── v54 手册新增：打卡记录 / 位置密钥 / 班干部 / 学生请假 / 学生消息 ──
       这几样原来一套都没有，手册讲到「打卡管理」只能拿空页面凑数。
       数字都挑过的：7 个人里要凑出「正常 / 迟到 / 待核 / 未打卡」四种行，
       还要让「需核对」黄标有出处（待核、geo-none、geo-far、同设备多学生、断网补传）。 */
    const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
    // 打卡规则完整一些，手册截图才看得到「校区已采集 · 半径 · 上课 · 零宽限」那句
    Store.set('sign_rules', { startAt: '08:30', lateAfter: 0, windowBefore: 60, windowAfter: 30,
                              radius: 150, pid: '', lat: 34.75218, lng: 113.62473 });

    const keyId = Store.upsert('sign_keys', { clsId: c1.id, code: '4826', date: today, limit: 5, by: '李老师' }).id;
    const sg = (i, o) => Store.upsert('sign:' + today, Object.assign(
      { id: s1[i].id, studentId: s1[i].id, date: today }, o));
    // 王梓涵：本来待核，教务已改判为准时到 + 同一台设备上还登过张予诺 → 仍挂「需核对」
    sg(0, { status: '正常', at: at(8, 24), way: 'code', dist: 12, dev: 'DEV-A', keyId,
            fix: { by: 'manual', at: Date.now() - 600e3, from: '待核' } });
    // 李思远：正常走码，迟到 11 分钟（用了位置密钥）
    sg(1, { status: '迟到', at: at(8, 41), way: 'code', dist: 9, dev: 'DEV-B', lateMin: 11, keyId });
    // 张予诺：跟王梓涵同一台设备 → 两人都挂「需核对」
    sg(2, { status: '正常', at: at(8, 26), way: 'code', dist: 14, dev: 'DEV-A' });
    // 陈可儿：定位压不进半径 → 待核
    sg(3, { status: '待核', at: at(8, 33), way: 'geo-far', dist: 430, dev: 'DEV-C', lateMin: 3 });
    // 刘浩然：一切正常
    sg(4, { status: '正常', at: at(8, 21), way: 'code', dist: 18, dev: 'DEV-D' });
    // 赵一诺（s1[5]）：故意不打卡 —— 手册要演示「未打卡」那一行
    // 孙嘉禾：断网补传 → 挂「需核对」
    sg(6, { status: '正常', at: at(8, 55), way: 'code', dist: 7, dev: 'DEV-E', offline: true, recvAt: at(9, 2) });

    // 班干部：先有职务名、再有是谁（手册里的设定顺序就是这样）
    Store.upsert('officers', { clsId: c1.id, title: '班长', studentId: s1[0].id });
    Store.upsert('officers', { clsId: c1.id, title: '学习委员', studentId: s1[3].id });

    // 学生请假（在「考勤」页批）：一条待批、一条已批准
    Store.upsert('tickets', { type: '学生请假', studentId: s1[5].id, kind: '病假', date: today,
      text: '昨晚发烧到 39 度，今天在家休息，明天正常到。', status: 'open', createdAt: Date.now() - 5400e3 });
    Store.upsert('tickets', { type: '学生请假', studentId: s2[5].id, kind: '事假', date: yest,
      text: '上午回学校办毕业手续，下午到岗。', status: 'done', createdAt: Date.now() - 90000e3 });

    // 学生消息（协作页第一栏，用学生实名）
    Store.upsert('tickets', { type: '学生消息', studentId: s1[2].id,
      text: '老师，我下周三要参加学校的模拟考，想请一天假，可以吗？', status: 'open', createdAt: Date.now() - 2400e3 });
    Store.upsert('tickets', { type: '学生消息', studentId: s2[0].id,
      text: '我的课表上周末那节课能不能往后调半小时？', status: 'done',
      reply: '可以，已经帮你调到周日上午第二节。', repliedAt: Date.now() - 1200e3, createdAt: Date.now() - 7200e3 });

    // 作业：其中一条由班干部登记过，卡片上要能看到「登记人」
    Store.upsert('hw:' + h1.id, { studentId: s1[0].id, done: true, by: '陈可儿', byId: s1[3].id });
    Store.upsert('hw:' + h1.id, { studentId: s1[2].id, done: true, by: '陈可儿', byId: s1[3].id });

    // 学生换设备密钥：一枚没用过、一枚已经用过（手册要讲「一次性」）
    Store.set('dev_keys', [
      { code: '8866-A', used: false, createdAt: Date.now() - 3600e3 },
      { code: '2043-B', used: true, usedBy: '吴俊熙', usedAt: Date.now() - 86400e3, createdAt: Date.now() - 172800e3 },
    ]);

    // 座位卡：量化页快捷按钮由 quant_rules 里 cls: 开头的条目驱动，先补两条常用的
    ['cls:课堂互动:+5', 'cls:评述集体通关:+15', 'cls:课堂纪律（当场扣）:-1'].forEach(s => {
      const [k, d] = s.split(':'); const [label, delta] = d.split(':');
      Store.upsert('quant_rules', { id: 'r_cls:' + label, key: 'cls:' + label, label, delta: Number(delta) });
    });

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
  // 学生账号页（单独端口，教务手册用）
  await go('students');   await shot(cdp, 'pg_students.png');
  // 巡检页：只有首位教务 / 总教务进得去（v54 起设置页那张卡也收起来了）。
  // 这一张必须在**首位教务**身份下拍 —— 后面切成授课老师就再也拍不到了。
  await go('health', 900); await shot(cdp, 'pg_health.png');

  // ══════════════════════════════════════════════════════════════
  //  ③b 教务老师端 —— 新版《教务老师使用手册》的全套截图
  //
  //  ⚠️ 必须用「教务老师(admin)」的号登，不能用首位教务。两边界面不一样：
  //     · 学生账号页少了「改密码 / 停用 / 删除」三个按钮
  //     · 设置页少了「接口配置 / 演示账号 / 危险操作」三张卡
  //     · 侧栏没有「老师管理」，设置页没有「系统健康」和「老师管理」入口
  //     手册是给教务老师看的，截图就得是他自己那台设备上看到的样子。
  // ══════════════════════════════════════════════════════════════
  console.log('\n③b 教务老师端（登录「王敏」＝教务老师视角）');
  const loginAs = async (user, pass = 'liyun2026') => {
    await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
    const l = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l;
    await sleep(2400);
    const r = await cdp.eval(`(async () => {
      if (!Auth.mode) await Auth.probe();
      document.getElementById('gUser').value = ${JSON.stringify(user)};
      document.getElementById('gPass').value = ${JSON.stringify(pass)};
      await Auth.submit();
      await new Promise(r => setTimeout(r, 1900));
      return { ok: !document.getElementById('gate').classList.contains('on'),
               role: Auth.role && Auth.role(), name: Auth.name && Auth.name() };
    })()`);
    if (!r.ok) throw new Error('登录失败：' + user);
    console.log('   已切换为 ' + user + '（' + r.role + '）');
    return r;
  };

  await view(cdp, DESK);
  await loginAs('王敏');
  // 把各页的选择状态钉在「砺蕴一班 · 今天」，免得截图里一会儿这个班、一会儿那个日期
  await cdp.eval(`(() => { const T = ${JSON.stringify(seed.today)}, C = ${JSON.stringify(seed.c1)};
    [['_attCls',C],['_attDate',T],['_signCls',C],['_signDate',T],['_signKeyCls',C],
     ['_hkCls',C],['_hkDate',T],['_qCls',C],['_exCls',C],['_rosterCls',C],
     ['_nightCls',C],['_nightDate',T],['_pfCls',C],['_pfStu',${JSON.stringify(seed.s1[0])}],
     ['_wkDate',T],['_signCls',C]].forEach(([k,v]) => Store.set(k, v)); return 1; })()`);

  const ago = async (id, wait = 780) => {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,90)); return 1; })()`);
    await sleep(wait);
  };
  const rowOf = (box, n) => `(document.querySelectorAll('${box} .item')[${n}] || document.querySelectorAll('${box} .item')[0])`;

  await ago('home');      await shot(cdp, 'jw_home.png');
  await ago('att');       await shot(cdp, 'jw_att.png');
  await shotRegion(cdp, "document.getElementById('attLeaveList').closest('.card')", 'jw_att_leave.png');
  await shotRegion(cdp, "(document.getElementById('attSlot').closest('.row') || document.getElementById('attSlot').parentElement)", 'jw_att_slot.png', 8);
  await ago('sign', 1500); await shot(cdp, 'jw_sign.png');
  await shotRegion(cdp, "document.getElementById('signCodeBox').closest('.card')", 'jw_sign_code.png');
  await shotRegion(cdp, "document.getElementById('sgStat').closest('.card')", 'jw_sign_rules.png');
  await shotRegion(cdp, "document.getElementById('skBody').closest('.card')", 'jw_sign_key.png');
  // 「今日打卡一览」不拍整张表 —— 拍某一行。一行里有姓名、需核对黄标、方式与距离、
  // 状态、以及那一排补正按键，教学上比一张长表清楚得多。
  await shotRegion(cdp, rowOf('#signToday', 3), 'jw_sign_row_far.png');
  await shotRegion(cdp, rowOf('#signToday', 6), 'jw_sign_row_off.png');
  await ago('homework');  await shot(cdp, 'jw_homework.png');
  await shotRegion(cdp, "document.getElementById('hkBody').closest('.card')", 'jw_hk.png');
  await ago('roster');    await shot(cdp, 'jw_roster.png');
  await shotRegion(cdp, "document.getElementById('officerBox').closest('.card')", 'jw_roster_off.png');
  await ago('students');  await shot(cdp, 'jw_students.png');
  await ago('profile');   await shot(cdp, 'jw_profile.png');
  await ago('timetable'); await shot(cdp, 'jw_timetable.png');
  await ago('night');     await shot(cdp, 'jw_night.png');
  await ago('quant');     await shot(cdp, 'jw_quant.png');
  await shotRegion(cdp, "document.getElementById('qBtns').closest('.card')", 'jw_quant_btns.png');
  await shotRegion(cdp, rowOf('#qLogBody', 0), 'jw_quant_row.png');
  await ago('exam');      await shot(cdp, 'jw_exam.png');
  await shotRegion(cdp, "document.getElementById('drBody').closest('.card')", 'jw_exam_draw.png');
  await shotRegion(cdp, "document.getElementById('aiBody').closest('.card')", 'jw_exam_ai.png');
  await ago('coop');      await shot(cdp, 'jw_coop.png');
  await shotRegion(cdp, "document.getElementById('coopStuMsg').closest('.card')", 'jw_coop_stumsg.png');
  await ago('gather');    await shot(cdp, 'jw_gather.png');
  await ago('settings');  await shot(cdp, 'jw_settings.png');
  await shotRegion(cdp, "document.getElementById('acctRole').closest('.card')", 'jw_set_acct.png');
  await shotRegion(cdp, "document.getElementById('backupInfo').closest('.card')", 'jw_set_backup.png');
  await shotRegion(cdp, "document.getElementById('slotList').closest('.card')", 'jw_set_slot.png');
  await shotRegion(cdp, "document.getElementById('devKeyList').closest('.card')", 'jw_set_devkey.png');
  await ago('rules');     await shot(cdp, 'jw_rules.png');
  await ago('board', 1700); await shot(cdp, 'jw_board.png');

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
  // 今日页「新闻」区特写（授课老师手册用）
  await cdp.eval(`(async () => { App.go('today'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'tc_today_news.png');
  // 老师端手机版（老师实际是在手机上用）
  await view(cdp, MOB);
  await sleep(500);
  await cdp.eval(`(async () => { App.go('record'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'm5-record.png');

  // ── ⑤b 授课老师手机端（张伟仍在登录，MOB 视图） ────────
  console.log('④b 授课老师手机端');
  await cdp.eval(`(async () => { App.go('today'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'js_today.png');
  await cdp.eval(`(async () => { App.go('record'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'js_record.png');
  await cdp.eval(`(async () => { App.go('myclass'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'js_myclass.png');
  await cdp.eval(`(async () => { App.go('tickets'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'js_tickets.png');
  await cdp.eval(`(async () => { App.go('profile'); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return 1; })()`);
  await shot(cdp, 'js_profile.png');
  await cdp.eval(`(async () => { App.drawer(true); await new Promise(r=>setTimeout(r,520)); return 1; })()`);
  await shot(cdp, 'js_drawer.png');
  await cdp.eval(`(() => { App.drawer(false); return 1; })()`);

  // ── ⑤c 学生端（王梓涵账号，挂在已灌数据的真实学员档案上） ──
  console.log('⑤ 学生端（登录真实学员账号「王梓涵」）');
  await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
  { const l = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l; await sleep(2400); }
  const sl = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '王梓涵';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role(), stu: Auth.isStudent() };
  })()`);
  if (!sl.ok) throw new Error('学生登录失败：王梓涵');
  console.log('   已切换为学生：王梓涵（' + sl.role + '）');

  await view(cdp, DESK);
  const sgo = async (id, name) => { await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,450)); return 1; })()`); await shot(cdp, name); };
  await sgo('stuHome',   'stu_home.png');
  /* 「待核 → 用位置密钥更正」这一段是 v51 改动的重点，手册必须讲清楚，
     所以先把他今天的打卡记录临时改成「待核 / geo-none」，截完再原样还原。
     不还原的话后面几张学生端截图会莫名其妙带着「已记录（待核）」。 */
  await cdp.eval(`(() => {
    const sid = Stu.sid(), d = Util.today();
    const old = Store.list('sign:' + d).find(x => x && x.studentId === sid);
    window.__oldSign = old ? JSON.parse(JSON.stringify(old)) : null;
    if (old) Store.upsert('sign:' + d, Object.assign({}, old, { status: '待核', way: 'geo-none', lateMin: 0, fix: null }));
    return 1; })()`);
  await sgo('stuSign',   'stu_sign_pending.png');
  await shotRegion(cdp, "document.getElementById('stuKey').closest('.card')", 'stu_sign_key.png');
  await cdp.eval(`(() => { const d = Util.today();
    if (window.__oldSign) Store.upsert('sign:' + d, window.__oldSign); return 1; })()`);
  await sgo('stuSign',   'stu_sign.png');
  await sgo('stuSign',   'stu_leave.png');
  await sgo('stuNews',   'stu_news.png');
  await sgo('stuGather', 'stu_gather.png');
  await sgo('stuTable',  'stu_table.png');
  await sgo('stuExam',   'stu_exam.png');
  await sgo('stuQuant',  'stu_quant.png');
  await sgo('stuProfile','stu_profile.png');
  await sgo('stuHw',     'stu_hw.png');
  await sgo('settings',  'stu_settings.png');

  await view(cdp, MOB);
  await sleep(500);
  const smgo = async (id, name) => { await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,450)); return 1; })()`); await shot(cdp, name); };
  await smgo('stuHome',  'stum_home.png');
  await smgo('stuSign',  'stum_sign.png');
  await smgo('stuNews',  'stum_news.png');
  await smgo('stuTable', 'stum_table.png');
  await smgo('stuQuant', 'stum_quant.png');

  // ── ⑦ 登出后的登录门 ────────────────────────────────
  console.log('⑥ 登录门');
  await view(cdp, DESK);
  await sleep(400);
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Store.setSecret('acct','');
    await new Promise(r => setTimeout(r, 200));
    const g = document.getElementById('gate');
    if (g){ g.classList.add('on'); }
    /* 上面刚用张伟登过录，输入框里会留着他的名字 —— 给手册用的登录页截图要空的，
       否则看着像「只有张伟能登」。顺便把「本机预览」那行提示藏掉。 */
    document.getElementById('gUser').value = '';
    document.getElementById('gPass').value = '';
    const n = document.getElementById('gNote');
    if (n) n.style.display = 'none';
    return 1;
  })()`);
  await sleep(600);
  await shot(cdp, 'g2-gate.png');

  // 把局部裁切图的实际尺寸记下来，供版式定图片框用
  await writeFile(path.join(OUT, '_sizes.json'), JSON.stringify(REGION_SIZES, null, 2));
  console.log('\n✅ 全部截图完成 → test/.shots/ppt/');
  const names = Object.keys(REGION_SIZES);
  if (names.length) console.log('   局部图 ' + names.length + ' 张，尺寸已记入 _sizes.json');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
