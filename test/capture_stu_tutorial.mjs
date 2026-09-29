/**
 * 学生端使用教程素材采集
 *   node test/capture_stu_tutorial.mjs [PORT]
 *
 * 采集学生端「手机为主 + 电脑为辅」的完整界面，并复现关键交互状态：
 *   今日 / 打卡两步（定位→输码）/ 打卡完成 / 定位失败 / 请假 / 每日新闻 /
 *   课表 / 考试与抽签 / 本班量化 / 我的档案 / 我的作业 / 限时征集 / 设置 /
 *   设备密钥门 / 登录页 / 全部功能抽屉
 *
 * 演示数据刻意灌满（通知、抽签号、评语、请假记录、征集），避免教程配图全是空状态。
 * 输出：test/.shots/stutut/*.png
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
const OUT = path.join(dir, 'test', '.shots', 'stutut');
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
  /* --use-fake-device-for-media-stream：无头环境里没有真摄像头，加这两个开关后
     getUserMedia 会返回一路合成的测试画面。教程要拍「扫一扫」的取景窗，
     没有它 StuSign.scan() 会直接走 catch 分支、什么都拍不到。
     --use-fake-ui-for-media-stream 顺带跳过权限弹窗（不然卡在那儿）。 */
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5342',
    '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
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
    /* hw:{作业id} 是 v47 班干部登记那张表（done 用 1/0，前端是 === 1 判的） */
    Store.upsert('hw:' + h1.id, { id: 'hwr-' + s1[0].id, studentId: s1[0].id, done: 1 });

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
    await mkAcc('王梓涵', '王梓涵', 'student', [], s1[0].id);
    /* v47：再建一个「班长」账号 —— 教程要拍班干部视角。
       刻意不让王梓涵当班干部：他是主角，普通学生的那些页（我的作业列表等）
       还得用他的干净图。 */
    await mkAcc('李思远', '李思远', 'student', [], s1[1].id);

    /* ── v47 四项新功能：教程配图要用的演示数据 ── */
    // ① 班干部：教务先定职务名，再指定是谁
    Store.upsert('officers', { clsId: c1.id, title: '班长', studentId: s1[1].id });
    // ② 位置密钥：今天这个班的一枚 4 位码 + 已经有 3 个人用它打上了（进度条有内容）
    const sk = Store.upsert('sign_keys', { clsId: c1.id, code: '4821', date: today, limit: 5, by: '王敏', createdAt: Date.now() });
    const useKey = (sid2, min) => Store.upsert('sign:' + today, {
      id: sid2, studentId: sid2, date: today, way: 'key', status: '正常', lateMin: 0,
      keyId: sk.id, at: Date.now() - min * 60000, dev: 'tut-' + sid2, by: 'self' });
    useKey(s1[2].id, 42); useKey(s1[3].id, 37); useKey(s1[4].id, 33);
    // ③ 学生消息：一条已经回过话的（学生这页要能看出「办公室回复」长什么样）
    Store.upsert('tickets', { type: '学生消息', status: 'open', createdAt: Date.now() - 5400e3,
      studentId: s1[0].id, toId: '',
      text: '老师，我今天就在教室里，可是定位一直不准，打不上卡，怎么办？',
      reply: '在教室里的话，找我要一枚当天的位置密钥（4 位数字），填进去就能打上。' });
    // ④ 作业登记：今晚两项作业，让「登记今晚作业」那张卡有东西可打勾
    Store.upsert('hw:' + h2.id, { id: s1[0].id, studentId: s1[0].id, done: 1, by: '李思远' });
    Store.upsert('hw:' + h2.id, { id: s1[1].id, studentId: s1[1].id, done: 1, by: '李思远' });
    Store.upsert('hw:' + h2.id, { id: s1[3].id, studentId: s1[3].id, done: 0, by: '李思远' });

    return { c1: c1.id, sid: s1[0].id, today };
  })()`);
  console.log('   数据就绪：砺蕴一班 7 人 + 通知/抽签/评语/请假/征集/成绩\n');

  // ── 教室里那块屏（看板端）───────────────────────────
  // 学生打卡要抬头看的那块屏幕。用宽一点的桌面尺寸拍，跟教室电视的比例对得上。
  console.log('②.5 教室那块屏（看板）');
  await view(cdp, { width: 1600, height: 900, dsf: 1, mobile: false });
  {
    const bl = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/?board=1` }); await bl;
    // 看板要等唤醒锁 / 首次取数 / 二维码画出来，给足时间
    await sleep(3600);
    await shot(cdp, 'board.png');
  }
  console.log('');

  // ── 切学生账号 ──────────────────────────────────────
  const asStudent = async () => {
    await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
    const l = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l; await sleep(2400);
    const r = await cdp.eval(`(async () => {
      if (!Auth.mode) await Auth.probe();
      document.getElementById('gUser').value = '王梓涵';
      document.getElementById('gPass').value = 'liyun2026';
      await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
      return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role(), stu: Auth.isStudent() };
    })()`);
    if (!r.ok) throw new Error('学生登录失败');
    console.log('   已登录学生：王梓涵（' + r.role + '）\n');
    /* 手册用干净图：把学生端整页水印关掉。
       （水印是防截屏外传的，叠加在每张图上都是「砺蕴一班 · 王梓涵」，
         裁开放进手册会糊住正文。inline display:none 不会被 StuMark.paint 重置 ——
         它只设 maskImage，从不碰 display。） */
    await cdp.eval(`(() => { const w = document.getElementById('watermark'); if (w) w.style.display = 'none'; return 1; })()`);
  };

  // ── 手机端逐页（主角）────────────────────────────────
  console.log('③ 手机端（学生实际使用的形态）');
  await view(cdp, MOB);
  await sleep(500);
  const mgo = async (id, name) => {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=0; await new Promise(r=>setTimeout(r,420)); return 1; })()`);
    await shot(cdp, name);
  };

  // 先给「今天有课 / 有通知 / 有作业」的状态：把课表挪到今天是做不到的（按星期排），
  // 所以今日页保留真实形态即可。先截「今日」。
  await asStudent();
  await mgo('stuHome', 'm-home.png');
  // 今日页滚到底：让「今日作业」整卡可见
  await cdp.eval(`(async () => { const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=520; window.scrollTo(0,520); await new Promise(r=>setTimeout(r,380)); return 1; })()`);
  await shot(cdp, 'm-home-scroll.png');

  // 打卡：① 初始（还没定位，圈就是按钮）
  await cdp.eval(`(() => { StuSign._geo=null; StuSign.render(); return 1; })()`);
  await mgo('stuSign', 'm-sign-step0.png');
  // 打卡：② 已定位 —— 默认路口只摆「扫面前的二维码」，手输是备选
  await cdp.eval(`(() => { StuSign._geo={lat:34.75,lng:113.62,acc:12}; StuSign.render(); return 1; })()`);
  await sleep(300);
  await shot(cdp, 'm-sign-step1.png');
  // 打卡：②b 扫一扫取景窗（v41 起这是默认那条路）
  await cdp.eval(`(async () => { await StuSign.scan(); await new Promise(r=>setTimeout(r,1400)); return 1; })()`);
  await shot(cdp, 'm-sign-scan.png');
  await cdp.eval(`(() => { StuSign.stopScan(); return 1; })()`);
  await sleep(300);
  // 打卡：②c 手输那条路 —— 点了「手输动态码」才长出 6 位输入框
  await cdp.eval(`(() => { StuSign.manual(true); return 1; })()`);
  await sleep(300);
  await shot(cdp, 'm-sign-manual.png');
  await cdp.eval(`(() => { StuSign.manual(false); return 1; })()`);
  await sleep(200);
  // 打卡：③ 定位失败 —— v47 起定位是硬门槛，这一屏该给的是「要位置密钥」那条路
  // （所以 keyBox 会自己摆出来，裁卡框要把它一起圈进去，见 crop_cards.py 的 m-sign-geofail）
  await cdp.eval(`(() => { StuSign._geo={fail:true}; StuSign.render(); return 1; })()`);
  await sleep(300);
  await shot(cdp, 'm-sign-geofail.png');
  // 打卡：④ 已打卡完成态
  await cdp.eval(`(() => {
    const sid = Auth.studentId();
    Store.upsert('sign:' + Util.today(), { studentId: sid, status:'正常', at: Date.now()-3600e3, way:'code', dist: 36 });
    StuSign._geo=null; StuSign.render(); StuHome.render(); return 1;
  })()`);
  await sleep(300);
  await shot(cdp, 'm-sign-done.png');
  // 打卡：迟到态
  await cdp.eval(`(() => {
    const sid = Auth.studentId();
    Store.upsert('sign:' + Util.today(), { studentId: sid, status:'迟到', lateMin: 6, at: Date.now()-1800e3, way:'geo', dist: 42 });
    StuSign.render(); return 1;
  })()`);
  await sleep(300);
  await shot(cdp, 'm-sign-late.png');
  // 恢复成「正常」方便后面「今日」页好看
  await cdp.eval(`(() => {
    const sid = Auth.studentId();
    Store.upsert('sign:' + Util.today(), { studentId: sid, status:'正常', at: Date.now()-3600e3, way:'code', dist: 36 });
    StuSign.render(); StuHome.render(); return 1;
  })()`);

  // 其余各页
  await mgo('stuSign',   'm-sign.png');
  // 打卡页滚到底：请假表单 + 我请过的假 完整可见
  await cdp.eval(`(async () => { const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=760; window.scrollTo(0,760); await new Promise(r=>setTimeout(r,380)); return 1; })()`);
  await shot(cdp, 'm-sign-scroll.png');
  await mgo('stuNews',   'm-news.png');
  await mgo('stuTable',  'm-table.png');
  await mgo('stuExam',   'm-exam.png');
  await mgo('stuQuant',  'm-quant.png');
  await mgo('stuProfile','m-profile.png');
  await mgo('stuHw',     'm-hw.png');
  await mgo('stuGather', 'm-gather.png');
  // 给老师发消息（v47）：render() 要先去后端要收件人名单，多等一会儿
  await cdp.eval(`(async () => { App.go('stuMsg'); window.scrollTo(0,0); const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=0; await new Promise(r=>setTimeout(r,1100)); return 1; })()`);
  await shot(cdp, 'm-msg.png');
  await mgo('settings',  'm-settings.png');
  // 全部功能抽屉
  await cdp.eval(`(async () => { App.drawer(true); await new Promise(r=>setTimeout(r,520)); return 1; })()`);
  await shot(cdp, 'm-drawer.png');
  await cdp.eval(`(() => { App.drawer(false); return 1; })()`);
  // 设备密钥门
  await cdp.eval(`(() => { StuDev.open({}); return 1; })()`);
  await sleep(400);
  await shot(cdp, 'm-devgate.png');
  await cdp.eval(`(() => { StuDev.close(); return 1; })()`);

  // ── 电脑端逐页（辅）──────────────────────────────────
  console.log('④ 电脑端');
  await view(cdp, DESK);
  await sleep(500);
  const dgo = async (id, name) => {
    await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); const m=document.querySelector('.main,#main,.content'); if(m) m.scrollTop=0; await new Promise(r=>setTimeout(r,420)); return 1; })()`);
    await shot(cdp, name);
  };
  await dgo('stuHome',   'd-home.png');
  await dgo('stuSign',   'd-sign.png');
  await dgo('stuNews',   'd-news.png');
  await dgo('stuTable',  'd-table.png');
  await dgo('stuExam',   'd-exam.png');
  await dgo('stuQuant',  'd-quant.png');
  await dgo('stuProfile','d-profile.png');
  await dgo('stuHw',     'd-hw.png');
  await dgo('stuGather', 'd-gather.png');
  await dgo('settings',  'd-settings.png');

  // ── 班干部视角（李思远 = 班长，v47）──────────────────
  // 班长用学生账号登录，能看到全班的量化加扣分，还能替全班登记今晚的作业。
  // 王梓涵（普通学生）的图不能被这几张污染，所以单开一个账号来拍。
  console.log('⑤ 班干部视角（班长）');
  await view(cdp, MOB);
  {
    const l3 = cdp.once('Page.loadEventFired');
    await cdp.eval(`(async () => { Store.setSecret('token',''); Store.setSecret('acct',''); return 1; })()`);
    await cdp.send('Page.navigate', { url: `${BASE}/` }); await l3; await sleep(2400);
    const r3 = await cdp.eval(`(async () => {
      if (!Auth.mode) await Auth.probe();
      document.getElementById('gUser').value = '李思远';
      document.getElementById('gPass').value = 'liyun2026';
      await Auth.submit(); await new Promise(r => setTimeout(r, 2200));
      return { ok: !document.getElementById('gate').classList.contains('on'),
               title: (typeof StuQuant !== 'undefined' ? StuQuant.myTitle() : '') };
    })()`);
    if (!r3.ok) throw new Error('班长登录失败');
    console.log('   已登录班长：李思远（职务：' + (r3.title || '—') + '）\n');
    await cdp.eval(`(() => { const w = document.getElementById('watermark'); if (w) w.style.display = 'none'; return 1; })()`);
    /* 同一台设备换到第二个学生账号会弹出「换账号要密钥」那道门（这是对的，
       线上就该拦）。教程只要页面本身的样子，把门收掉再拍。 */
    await cdp.eval(`(() => { if (typeof StuDev !== 'undefined') StuDev.close(); return 1; })()`);
    await sleep(400);
    await mgo('stuQuant', 'm-quant-officer.png');
    await cdp.eval(`(() => { if (typeof StuDev !== 'undefined') StuDev.close(); return 1; })()`);
    await mgo('stuHw',    'm-hw-entry.png');
  }

  // ── 登录页（电脑 + 手机）白底干净 ────────────────────
  console.log('⑥ 登录页');
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
  await shot(cdp, 'd-gate.png');
  await view(cdp, MOB);
  await sleep(400);
  await showGate();
  await shot(cdp, 'm-gate.png');

  console.log('\n✅ 学生端教程素材完成 → test/.shots/stutut/');
} catch (e) {
  console.error('\n✗ 采集失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
