/**
 * v84 手机端三端 5-Tab 骨架 · 验证脚本（批次 2）
 *
 *   node test/mtab_check.mjs
 *
 * 覆盖（任务验收四条）：
 *   ① 三种角色（super/teacher/student）500px 宽整页截图：Tab 栏出现、当前项高亮、
 *      5 个 Tab 图标+文案正确；
 *   ② Tab 点击 = 调 App.go 真实切页（CDP 点击后断言目标页容器 .page.on 可见）；
 *   ③ 1440px 桌面回归：.mtabbar display:none、旧 .tabbar 也不显示、核心布局量值正常；
 *   ④ iPhone 小屏 375×667：Tab 栏不遮内容、整页可滚到底。
 *
 * 截图输出：docs/mtab-batch2-shots/
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(dir, 'docs', 'mtab-batch2-shots');
const PORT = 5299;                    // 避开常驻的 5199，脚本自己拉起、自己收
const DEBUG_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUPER = { user: '李老师', pass: 'liyun2026' };
const ROLE_CRED = { teacher: { user: '张伟', pass: 'liyun2026' }, student: { user: '王梓涵', pass: 'liyun2026' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}

/* ── 断言小框架 ── */
let pass = 0; const fails = [];
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label}`); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), `${label}（实际 ${JSON.stringify(a)} / 期望 ${JSON.stringify(b)}）`); }

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
  async shot(file, fullPage = true){
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    await writeFile(path.join(SHOTS, file), Buffer.from(r.data, 'base64'));
    console.log(`  📸 ${file}`);
  }
  async viewport(w, h, mobile = true, dsf = 2){
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile });
  }
}

/* 页面里跑的工具片段 */
const JS = {
  tabs: `(() => { const bar = document.getElementById('mtabbar');
      if (!bar) return null; const cs = getComputedStyle(bar);
      return { display: cs.display, position: cs.position, bottom: cs.bottom, zIndex: cs.zIndex,
        labels: [...bar.querySelectorAll('button')].map(b => b.dataset.tab),
        ids: [...bar.querySelectorAll('button')].map(b => b.dataset.id),
        onIdx: [...bar.querySelectorAll('button')].findIndex(b => b.classList.contains('on')) }; })()`,
  curPage: `(() => { const p = document.querySelector('.page.on'); return p ? p.id : null; })()`,
};

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(SHOTS, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  /* 清空预览数据：第一个注册的账号就是首位教务（踩过留存数据的坑，别删） */
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'mtab-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  /* 登录 super（首位教务），灌一份演示数据（同 probe 的 seed 精简版，页面不空） */
  await cdp.viewport(500, 900, true, 2);
  const l = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await l; await sleep(2600);
  await cdp.eval(`(async () => { if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师'; document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await cdp.eval(`(async () => {
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });
    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id, status: i === 2 ? '迟到' : '正常' }));
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    Store.upsert('schedule', { kind:'big', day:'周一', periodId: p1.id, title:'普通话语音基础', cls:'砺蕴一班', stu:'' });
    Quant.syncAtt(c1.id, today);
    Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    Store.upsert('tickets', { type:'学生请假', studentId: s1[1].id, kind:'病假', date: today, text:'发烧休息。', status:'open', createdAt: Date.now() - 5400e3 });
    try { await Auth.call('users', { op:'create', user:'张伟', name:'张伟', role:'teacher', pass:'liyun2026', classIds:[c2.id] }); } catch(e){}
    try { await Auth.call('users', { op:'create', user:'王梓涵', name:'王梓涵', role:'student', pass:'liyun2026', studentId: s1[0].id }); } catch(e){}
    Store.set('_attCls', c1.id); Store.set('_attDate', today);
    return 1; })()`);

  /* ════ ① 教务端（super）500px ════ */
  console.log('\n── ① 教务端（super）500px ──');
  await sleep(1200);
  const t1 = await cdp.eval(JS.tabs);
  ok(t1 && t1.display === 'flex', `Tab 栏显示（display=${t1?.display}）`);
  ok(t1 && t1.position === 'fixed' && parseFloat(t1.bottom) === 0, `固定底部（position=${t1?.position}, bottom=${t1?.bottom}）`);
  eq(t1?.labels, ['首页','考勤','作业','课表','我的'], '教务端 5 Tab 文案');
  eq(t1?.ids, ['home','att','homework','timetable','settings'], '教务端 5 Tab 指向页面 id');
  ok(t1?.onIdx === 0, `当前项高亮在第 1 个（idx=${t1?.onIdx}）`);
  const gateHidden = await cdp.eval(`(() => { const g = document.getElementById('gate'); return !g || !g.classList.contains('on'); })()`);
  ok(gateHidden, '登录门已收起（Tab 栏未被盖）');
  await cdp.shot('m-admin-home-500.png');

  /* ════ ② Tab 点击真实切页（教务端） ════ */
  console.log('\n── ② Tab 点击切页（教务端） ──');
  const clickTab = async (idx, wantPage) => {
    await cdp.eval(`(() => { document.querySelectorAll('#mtabbar button')[${idx}].click(); return 1; })()`);
    await sleep(700);
    const cur = await cdp.eval(JS.curPage);
    const on = await cdp.eval(`(() => { const b = document.querySelectorAll('#mtabbar button')[${idx}]; return b.classList.contains('on'); })()`);
    ok(cur === wantPage && on, `点「${idx + 1}」→ ${wantPage} 可见 & Tab 高亮（实际 page=${cur}）`);
  };
  await clickTab(1, 'page-att');
  await clickTab(2, 'page-homework');
  await clickTab(3, 'page-timetable');
  await clickTab(4, 'page-settings');
  await clickTab(0, 'page-home');
  await cdp.shot('m-admin-att-500.png');

  /* ════ 教师端（teacher）500px ════ */
  console.log('\n── ③ 教师端（teacher）500px ──');
  const sw = await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '张伟'; document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200));
    return { role: Auth.role(), name: Auth.name() }; })()`);
  await sleep(1200);
  const t2 = await cdp.eval(JS.tabs);
  eq(t2?.labels, ['今天','课表','消息','考勤','我的'], '教师端 5 Tab 文案');
  eq(t2?.ids, ['today','myclass','tickets','today','settings'], '教师端 5 Tab 指向（考勤→today 只读卡所在页，课表→myclass）');
  await cdp.eval(`(() => { document.querySelectorAll('#mtabbar button')[3].click(); return 1; })()`);  // 点「考勤」→ today
  await sleep(700);
  eq(await cdp.eval(JS.curPage), 'page-today', '教师点「考勤」→ page-today 可见');
  const bothOn = await cdp.eval(`(() => [...document.querySelectorAll('#mtabbar button')].filter(b => b.classList.contains('on')).map(b => b.dataset.tab))()`);
  eq(bothOn, ['今天','考勤'], '「今天/考勤」同页双 Tab 都亮（预期行为）');
  await cdp.shot('m-teacher-today-500.png');

  /* ════ 学生端（student）500px ════ */
  console.log('\n── ④ 学生端（student）500px ──');
  const sw2 = await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '王梓涵'; document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200));
    return { role: Auth.role(), name: Auth.name() }; })()`);
  await sleep(1200);
  const t3 = await cdp.eval(JS.tabs);
  eq(t3?.labels, ['今日','打卡','作业','课表','我的'], '学生端 5 Tab 文案');
  eq(t3?.ids, ['stuHome','stuSign','stuHw','stuTable','settings'], '学生端 5 Tab 指向页面 id');
  ok(t3?.onIdx === 0, `落页 stuHome，第 1 个 Tab 高亮（idx=${t3?.onIdx}）`);
  await cdp.eval(`(() => { document.querySelectorAll('#mtabbar button')[2].click(); return 1; })()`);   // 点「作业」
  await sleep(700);
  eq(await cdp.eval(JS.curPage), 'page-stuHw', '学生点「作业」→ page-stuHw 可见');
  await cdp.shot('m-student-500.png');

  /* ════ ⑤ 小屏 375×667：Tab 不遮内容、可滚到底 ════ */
  console.log('\n── ⑤ 小屏 375×667（学生端） ──');
  await cdp.viewport(375, 667, true, 2);
  await sleep(900);
  const small = await cdp.eval(`(async () => {
    App.go('stuHome'); await new Promise(r => setTimeout(r, 800));
    const bar = document.getElementById('mtabbar');
    const br = bar.getBoundingClientRect();
    /* 页面是 .col(height:100%) 骨架，滚动发生在 #main 内部，不是文档级 */
    const main = document.getElementById('main');
    main.scrollTop = main.scrollHeight;
    await new Promise(r => setTimeout(r, 500));
    let lastBottom = 0;
    main.querySelectorAll('.page.on > *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > lastBottom) lastBottom = r.bottom;
    });
    return { barTop: br.top, barH: br.height, vh: innerHeight,
      scrollable: main.scrollHeight > main.clientHeight + 2,
      lastBottom, mainH: main.scrollHeight };
  })()`);
  ok(small.barTop <= small.vh && small.barTop >= small.vh - 70, `Tab 栏贴底（barTop=${Math.round(small.barTop)} / vh=${small.vh}）`);
  ok(!small.scrollable || small.lastBottom <= small.barTop + 2,
    `滚到底后内容不被 Tab 遮住（lastBottom=${Math.round(small.lastBottom)} ≤ barTop=${Math.round(small.barTop)}）`);
  ok(small.scrollable, `#main 可滚到底（mainH=${small.mainH}）`);
  await cdp.shot('m-student-667-bottom.png', false);

  /* ════ ⑥ 桌面回归 1440×900 ════ */
  console.log('\n── ⑥ 桌面回归 1440×900（super） ──');
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '李老师'; document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200)); return 1; })()`);
  await cdp.viewport(1440, 900, false, 1);
  await sleep(1200);
  const desk = await cdp.eval(`(() => {
    const m = getComputedStyle(document.getElementById('mtabbar'));
    const old = document.querySelector('.tabbar') ? getComputedStyle(document.querySelector('.tabbar')) : null;
    const side = document.querySelector('.side') ? getComputedStyle(document.querySelector('.side')) : null;
    const main = document.getElementById('main').getBoundingClientRect();
    const cur = document.querySelector('.page.on');
    return { mtab: m.display, oldTab: old ? old.display : 'absent', side: side ? side.display : 'absent',
      mainW: Math.round(main.width), cur: cur ? cur.id : null }; })()`);
  eq(desk.mtab, 'none', '桌面 .mtabbar display:none');
  ok(desk.oldTab === 'none' || desk.oldTab === 'absent', `桌面旧 .tabbar 也不显示（${desk.oldTab}）`);
  eq(desk.side, 'flex', '桌面侧栏正常显示');
  ok(desk.mainW > 800, `主区宽度正常（${desk.mainW}px）`);
  await cdp.shot('desktop-home-1440.png', false);

  /* ── 汇总 ── */
  console.log(`\n════ 结果：${pass} 项通过，${fails.length} 项失败 ════`);
  if (fails.length){ fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
} catch (e) {
  console.error('验证脚本异常：', e.message || e);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}
