/**
 * 学生端端到端验收（真 Chrome，两个实例 = 教务一台 + 学生一台）
 *   node test/student_ui_check.mjs [端口]
 *
 * 跑通这条线：
 *   教务建班建学员 → 一键建号 → 学生登录进学生端 → 打卡（动态码）→ 教务看到并改判
 *   → 学生请假 → 教务批准 → 考勤自动写入 → 教务开抽 → 学生看到自己的出场序号
 * 全程一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5233);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ADMIN = { user: '__stusuper__', pass: 'super-pass-123' };
const STU1  = { user: '测试学员甲', pass: 'liyun2026' };
const STU2  = { user: '测试学员乙', pass: 'liyun2026' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(gap);
  }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 接管超时（5s）')), 5000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP 连不上')); };
    });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method) {
    return new Promise(res => {
      const set = this.events.get(method) || new Set();
      const fn = p => { set.delete(fn); res(p); };
      set.add(fn); this.events.set(method, set);
    });
  }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };
const chromes = [], profiles = [];
let A, B;

async function openChrome(cdpPort) {
  const profile = await mkdtemp(path.join(tmpdir(), 'stu-chrome-'));
  profiles.push(profile);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: `Chrome 调试端口 ${cdpPort}`, tries: 40 });
  const c = await Cdp.connect(target.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  return c;
}

async function login(cdp, acc) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '核心模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(acc.user)};
    document.getElementById('gPass').value = ${JSON.stringify(acc.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
}

try {
  console.log('\n【1/6】起本地预览服务（真 sync.js）…');
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log(`  服务就绪 → ${BASE}`);

  console.log('\n【2/6】设备A：教务登录 + 建班建学员 + 打卡设置…');
  A = await openChrome(9351);
  await login(A, ADMIN);

  const setup = await A.eval(`(async () => {
    Store.upsert('classes', { id: 'sc1', name: '播音一班' });
    Store.upsert('students', { id: 'ss1', name: '测试学员甲', classId: 'sc1' });
    Store.upsert('students', { id: 'ss2', name: '测试学员乙', classId: 'sc1' });
    Store.upsert('att_slots', { id: 'am', name: '上午' });
    Store.upsert('periods', { id: 'p1', name: '第1节', start: '08:00', end: '09:40' });
    Store.upsert('schedule', { id: 'sch1', day: '${['周一','周二','周三','周四','周五','周六','周日'][(new Date().getDay()+6)%7]}',
      periodId: 'p1', title: '播音大课', cls: '播音一班', kind: 'big', room: '301' });
    /* 打卡设置：上课时间按「现在」算，零宽限（到点就迟到）—— 学生马上打就是正常。
       校区坐标就采集在 34.75/113.62，学生端 mock 定位到同一个点，距离 0 米。
       打卡码由教务自设（8866），不再每 60 秒换。 */
    const d = new Date(Date.now() + 8 * 3600e3);
    const hm = String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
    Store.set('sign_rules', { startAt: hm, lateAfter: 0, windowBefore: 60, windowAfter: 30,
      radius: 150, pid: 'am', lat: 34.75, lng: 113.62, code: '8866' });
    Store.upsert('notices', { date: Util.today(), text: '明天带练声材料', by: '教务', at: Date.now() });
    await Sync.push();
    return { hm, foot: (document.getElementById('footBrand') || {}).textContent || '' };
  })()`);
  ok(!!setup.hm, '教务登录成功，班级/学员/课表/打卡设置就绪（上课按 ' + setup.hm + ' 算）');
  ok(/砺蕴工作系统/.test(setup.foot || ''), '教务端页脚仍是「砺蕴工作系统」（' + (setup.foot || '空') + '）');

  const gen = await A.eval(`(async () => {
    App.go('roster');
    Store.set('_rosterCls', 'sc1');
    Roster.render();
    document.getElementById('rsPass').value = '${STU1.pass}';
    window.confirm = () => true;
    await Roster.genAccounts();
    await new Promise(r => setTimeout(r, 800));
    return { stat: document.getElementById('rsStat').textContent };
  })()`);
  ok(/建好了 2 个账号/.test(gen.stat || ''), '名册「一键建号」建成 2 个学生账号（' + (gen.stat || '').slice(0, 40) + '）');

  console.log('\n【3/6】设备B：学生登录 → 进的是学生端…');
  B = await openChrome(9352);
  await login(B, STU1);

  const who = await B.eval(`(async () => {
    await Sync.pull();
    await new Promise(r => setTimeout(r, 600));
    const nav = [...document.querySelectorAll('#nav button')].map(b => b.dataset.id);
    const ids = [...document.querySelectorAll('#nav button')].map(b => b.textContent.trim());
    return {
      role: Auth.role(), isStudent: Auth.isStudent(), sid: Auth.studentId(),
      page: (document.querySelector('.page.on') || {}).id,
      nav, ids,
      stuCount: Store.list('students').length,
      clsCount: Store.list('classes').length,
      aiKey: Store.get('aiKey'),
      stuSkin: document.body.classList.contains('stu'),
      wm: (document.getElementById('watermark') || {}).style &&
          ((document.getElementById('watermark').style.maskImage || '') +
           (document.getElementById('watermark').style.webkitMaskImage || '')),
      accent: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
      /* 门头/侧栏/设置页页脚三处都要跟着身份换名，不能停在「砺蕴工作系统」 */
      foot: (document.getElementById('footBrand') || {}).textContent || '',
      side: (document.getElementById('sideBrand') || {}).textContent || '',
      sys: (typeof Brand !== 'undefined' && Brand.sysName) ? Brand.sysName() : '',
    };
  })()`);
  ok(/砺蕴学生系统/.test(who.foot || ''), '设置页页脚写的是「砺蕴学生系统」（' + (who.foot || '空') + '）');
  ok(!/砺蕴工作系统/.test(who.foot || ''), '页脚不再出现「砺蕴工作系统」');
  ok(/砺蕴学生系统/.test(who.side || ''), '电脑侧栏也是「砺蕴学生系统」');
  ok(who.sys === '砺蕴学生系统', 'Brand.sysName() 按当前身份返回学生系统');
  ok(who.stuSkin, '学生端换了另一套皮（body.stu 生效，教务老师端不受影响）');
  ok(/测试学员甲/.test(decodeURIComponent(who.wm || '')), '水印里有本人姓名（截图能查到是谁）');
  ok(!/砺蕴学生系统/.test(decodeURIComponent(who.wm || '')), '水印只写「班级·姓名」，不再堆系统名（不碍观感）');
  ok(/font-size="1[0-3]"/.test(decodeURIComponent(who.wm || '')), '水印字号够小（≤13px）');
  ok(/width="320"/.test(decodeURIComponent(who.wm || '')), '水印铺得疏（一块 320×210 才一行字）');
  ok(who.accent && who.accent !== '#26241f', '学生端主色跟教务端不同（--accent=' + who.accent + '）');
  ok(who.role === 'student', '学生身份正确（role=' + who.role + '）');
  ok(who.sid === 'ss1', '账号挂在正确的学员档案上（studentId=' + who.sid + '）');
  ok(who.page === 'page-stuHome', '首屏落在「今日」（' + who.page + '）');
  ok(who.stuCount === 1, '学员名单里只有自己（' + who.stuCount + ' 条，不是全班）');
  ok(who.clsCount === 1, '只看得到自己那个班（' + who.clsCount + '）');
  ok(!who.nav.some(id => ['home','att','roster','teachers','quant'].includes(id)), '导航里没有教务端入口：' + who.nav.join('/'));
  ok(who.nav.includes('stuSign') && who.nav.includes('stuLeave') && who.nav.includes('stuExam'), '学生端九个入口都在');

  console.log('\n【3.5/6】学生端十个页面逐个打开，一个都不许白屏…');
  const pages = await B.eval(`(async () => {
    const ids = ['stuHome','stuSign','stuLeave','stuNews','stuTable','stuExam','stuQuant','stuProfile','stuHw','settings'];
    const out = [];
    for (const id of ids){
      try {
        App.go(id);
        await new Promise(r => setTimeout(r, 200));
        const el = document.querySelector('.page.on');
        out.push({ id, on: !!el && el.id === 'page-' + id,
                   empty: ((document.getElementById('page-' + id) || {}).textContent || '').trim().length });
      } catch(e){ out.push({ id, err: e.message }); }
    }
    return out;
  })()`);
  const badPages = pages.filter(p => p.err || !p.on || p.empty < 4);
  ok(badPages.length === 0, '十个页面全部渲染出内容' +
    (badPages.length ? ' —— 有问题的是：' + JSON.stringify(badPages) : ''));

  console.log('\n【4/6】打卡：两步（先定位 → 再输教务自设的码）…');
  const code = await A.eval(`(async () => {
    App.go('sign');
    await Sign.refreshCode();
    return { code: Sign._code, fixed: Sign._fixed,
             input: (document.getElementById('sgCode') || {}).value || '' };
  })()`);
  ok(code.code === '8866', '教务端显示的是自己设的那个码（' + code.code + '）');
  ok(code.fixed === true, '标记为固定码，不会自己变');
  ok(code.input === '8866', '打卡码输入框回填了当前码');

  /* 学生端：真走两步 —— 按中间那个圈先定位（这里 mock 成校区坐标），
     定位完下面才出现码输入框，填码再按圈提交。
     ⚠️ 圈本身要同时满足：写着「打卡」、有简笔画、有跳动的时分秒。 */
  const signed = await B.eval(`(async () => {
    navigator.geolocation.getCurrentPosition = (ok) =>
      ok({ coords: { latitude: 34.75, longitude: 113.62, accuracy: 8 } });
    App.go('stuSign');
    await new Promise(r => setTimeout(r, 300));
    const ring = document.querySelector('#stuSignNow .p-ring');
    const ringTxt = (ring || {}).textContent || '';
    const hasIco = !!(ring && ring.querySelector('svg.p-ico'));
    const beforeStep = (document.getElementById('stuSignStep') || {}).textContent || '';
    StuSign.start();
    await new Promise(r => setTimeout(r, 300));
    const hasInput = !!document.getElementById('stuCode');
    document.getElementById('stuCode').value = '${'8866'}';
    await StuSign.confirm();
    await new Promise(r => setTimeout(r, 2000));
    const s = Stu.signOf(Util.today());
    return { ringTxt, hasIco, beforeStep, hasInput, s,
             txt: (document.getElementById('stuSignNow') || {}).textContent || '' };
  })()`);
  ok(/打卡/.test(signed.ringTxt), '圈里写着「打卡」两个字（' + signed.ringTxt.replace(/\s+/g, '') + '）');
  ok(/\d\d:\d\d:\d\d/.test(signed.ringTxt), '时分秒也在圈里（' + (signed.ringTxt.match(/\d\d:\d\d:\d\d/) || [''])[0] + '）');
  ok(signed.hasIco, '圈里是简笔画（svg 线稿，不是 emoji）');
  ok(!signed.beforeStep.trim(), '还没定位时下面干干净净（圈自己就是按钮）');
  ok(signed.hasInput, '定位完成后才出现码输入框（两步，不是一次给全）');
  ok(!!signed.s, '学生打卡成功，本机拿到记录');
  ok(signed.s && signed.s.status === '正常', '判定为「正常」（' + (signed.s && signed.s.status) + '）');
  ok(signed.s && signed.s.way === 'code', '打卡方式是动态码（' + (signed.s && signed.s.way) + '）');
  ok(signed.s && signed.s.dist === 0, '距离算出来了（' + (signed.s && signed.s.dist) + ' 米）');
  ok(/正常/.test(signed.txt), '打卡页把结果显示出来了');

  const bad = await B.eval(`(async () => {
    App.go('stuSign');
    await new Promise(r => setTimeout(r, 300));
    StuSign.again();                       // 打过了要再打一次，得先按「重新打卡」
    await new Promise(r => setTimeout(r, 200));
    StuSign.start();
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('stuCode').value = '000000';
    await StuSign.confirm();
    await new Promise(r => setTimeout(r, 800));
    return { toast: (document.getElementById('toast') || {}).textContent || '' };
  })()`);
  ok(/动态码不对/.test(bad.toast), '错误码打不上：' + bad.toast);

  /* 老师端只看结果：动态码卡已经撤掉 */
  const tdom = await B.eval(`JSON.stringify({
    oldCode: !!document.getElementById('tdCodeBox'),
    att: !!document.getElementById('tdAtt'),
  })`);
  const td = JSON.parse(tdom);
  ok(!td.oldCode, '老师端「今天」页的打卡码卡已撤掉（考勤是教务的事）');
  ok(td.att, '换成只读的「今天谁到了」');

  console.log('\n【5/6】教务看到这一条，并改判…');
  const seen = await A.eval(`(async () => {
    await Sync.pull();
    await new Promise(r => setTimeout(r, 800));
    App.go('sign');
    await new Promise(r => setTimeout(r, 500));
    const box = document.getElementById('signToday');
    return { html: (box || {}).textContent || '', meta: (document.getElementById('signTodayMeta') || {}).textContent || '' };
  })()`);
  ok(/测试学员甲/.test(seen.html), '教务端「今日打卡」看得到这名学生');
  ok(/\d+\/\d+/.test(seen.meta) || /已打卡/.test(seen.meta), '已打卡人数统计出来了（' + seen.meta + '）');

  const fixed = await A.eval(`(async () => {
    Sign.setStatus('ss1', '病假');
    await new Promise(r => setTimeout(r, 500));
    await Sync.push();
    const rows = Store.list('att:' + Util.today()).filter(x => x.studentId === 'ss1');
    return { rows, logs: Store.list('quant_log').filter(x => x._src === 'att') };
  })()`);
  ok(fixed.rows.some(x => x.status === '病假'), '教务改判为病假，写进考勤');
  ok(fixed.logs.length > 0, '量化自动跟着扣分（' + fixed.logs.length + ' 条）');

  console.log('\n【6/6】请假 → 教务批准 → 自动写考勤；抽签 → 学生看到序号…');
  const leave = await B.eval(`(async () => {
    App.go('stuLeave');
    await new Promise(r => setTimeout(r, 300));
    const d = new Date(Date.now() + 86400e3);
    const day = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    document.getElementById('lvDate').value = day;
    document.getElementById('lvKind').value = '事假';
    document.getElementById('lvText').value = '家里有事，请假一天';
    StuLeave.send();
    await Sync.push();
    await new Promise(r => setTimeout(r, 800));
    const t = Store.list('tickets').find(x => x.type === '学生请假');
    return { t, day };
  })()`);
  ok(!!(leave.t && leave.t.status === 'open'), '学生提交请假，状态是待处理');

  const appr = await A.eval(`(async () => {
    await Sync.pull();
    await new Promise(r => setTimeout(r, 800));
    App.go('coop');
    await new Promise(r => setTimeout(r, 400));
    const t = Store.list('tickets').find(x => x.type === '学生请假');
    if (!t) return { err: '教务没拉到学生的请假' };
    Coop.leave(t.id, true);
    await Sync.push();
    await new Promise(r => setTimeout(r, 800));
    const rows = Store.list('att:' + '${leave.day}').filter(x => x.studentId === 'ss1');
    return { rows, status: Store.list('tickets').find(x => x.id === t.id).status };
  })()`);
  ok(!appr.err && appr.status === 'done', '教务批准，工单状态变为已处理');
  ok(appr.rows && appr.rows.some(x => x.status === '事假'), '批准后自动写进考勤（' + JSON.stringify(appr.rows || []) + '）');

  const draw = await A.eval(`(async () => {
    Store.set('_exCls', 'sc1');
    document.getElementById('drName').value = '9月第3周模考';
    await Exam.newDraw();
    await new Promise(r => setTimeout(r, 600));
    await Sync.push();
    return { body: (document.getElementById('drBody') || {}).textContent || '',
             n: (Store.list('exam_draws')[0] || {}).ids };
  })()`);
  ok(/测试学员甲/.test(draw.body), '教务开抽，名单渲染出来了');

  const myNo = await B.eval(`(async () => {
    await Sync.pull();
    await new Promise(r => setTimeout(r, 800));
    App.go('stuExam');
    await new Promise(r => setTimeout(r, 400));
    return { html: (document.getElementById('stuDraw') || {}).textContent || '' };
  })()`);
  ok(/\d/.test(myNo.html) && !/教务还没有开抽/.test(myNo.html), '学生看到自己的出场序号');

  console.log('\n────────────');
  console.log(failed ? `❌ 失败 ${failed} 项\n` : '✅ 全部通过\n');
} catch (e) {
  console.error('\n💥 ' + (e && e.message));
  failed++;
} finally {
  chromes.forEach(c => { try { c.kill(); } catch {} });
  if (server) { try { server.kill(); } catch {} }
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  for (const p of profiles) { try { await rm(p, { recursive: true, force: true }); } catch {} }
  process.exit(failed ? 1 : 0);
}
