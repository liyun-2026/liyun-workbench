/**
 * VoxOS 5.30 验收：①桌面切页动画三角色一致 ②统考日期可视化配置全端同步
 *
 *   node test/exam_anim_check.mjs
 *
 * ① 动画：5.19 曾删掉 .page.on>* 的 rise 级联（用户定稿「页面进场不加动效」），
 *    本版按拍板恢复为桌面（≥1100）专属、三角色同一套（同令牌 var(--ease)，不新造）。
 *    断言 teacher / student 在 1440 宽下切页时 .page.on 直接子元素 computed
 *    animationName === 'rise' 且完全一致；390 宽（手机）下无动画（scroll-snap 轮播不动）。
 * ② 统考：examDate 单一数据源（考试页顶编辑卡，admin+ 可改 / teacher 只读）；
 *    改日期 → 桌面首页倒计时卡 + 手机轮播卡（学生/教师/教务）同步；过期整卡隐藏。
 */
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5711);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'anim-fix');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, t = 40) { for (let i = 0; i < t; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error('timeout: ' + fn); }
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.w = new Map(); }
  static async connect(url){ const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); }); const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && c.w.has(m.id)) { const { res, rej } = c.w.get(m.id); c.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; return c; }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.w.set(id, { res, rej })); }
  async eval(expr){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || '')); return r.result.value; }
  async shot(name){ const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('  📸 ' + name); }
}
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

let server; const chromes = [];
async function browser(tag, width, height) {
  const profile = await mkdtemp(path.join(tmpdir(), 'ea-'));
  /* ==修== 每个 Chrome 实例独占一个调试端口（chromes.length 递增）——
     三实例共用同一个端口时，第二个起不来，json/list 返回的还是第一个实例的
     target，三个 cdp 全连到同一个页面：teacher/student 登录都落在 super 的
     文档上，后续所有断言全错位（本次统考段 7 连挂的根因）。 */
  const dbg = DBG + chromes.length;
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(ch);
  const target = await waitFor(async () => (await (await jfetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(x => x.type === 'page' && x.webSocketDebuggerUrl));
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await new Promise(res => { cdp.send('Page.navigate', { url: BASE + '/?nosw=1' }).then(res); });
  await sleep(2000);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    return true; })()`);
  return cdp;
}
async function login(cdp, user, pass) {
  return cdp.eval(`(async () => {
    document.getElementById('gUser').value = ${JSON.stringify(user)};
    document.getElementById('gPass').value = ${JSON.stringify(pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1600));
    return { off: !document.getElementById('gate').classList.contains('on'), role: Auth.role() }; })()`);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok);
  await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });
  console.log('dev 服务就绪 →', BASE);

  /* 准备：super 首建 + 学员档案 + 学生账号 */
  const supA = await browser('sup', 1440, 900);
  const sup = await login(supA, '李老师', 'liyun2026');
  ok(sup.off && sup.role === 'super', 'super 登录');
  await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'users', token: await supA.eval('Auth.token()'), op: 'createMany', classIds: [],
      list: [{ user: '王梓涵', pass: 'liyun2026', role: 'student', name: '王梓涵', studentId: 'stu_anim1' },
             { user: '张伟', pass: 'liyun2026', role: 'teacher', name: '张伟' }] }) });
  await supA.eval(`(async () => {
    Store.mergeRemote({ classes: [{ id: 'cls_anim1', name: '动画一班' }],
      students: [{ id: 'stu_anim1', name: '王梓涵', classId: 'cls_anim1' }] });
    Sync.push(); await new Promise(r => setTimeout(r, 1000)); return true; })()`);

  console.log('\n=== ① 桌面 1440 切页动画：三角色同一套 ===');
  /* super：切页 → 直接子元素 computed animationName 应全为 rise */
  await supA.eval(`App.go('att')`);
  await sleep(120);
  const supAnim = await supA.eval(`(() => {
    const page = document.querySelector('.page.on');
    return [...page.children].map(el => { const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration, s.animationDelay, s.animationTimingFunction]; }); })()`);
  ok(supAnim.length > 0 && supAnim.every(a => a[0] === 'rise'), `教务端切页 rise 级联在（${supAnim.filter(a => a[0] === 'rise').length}/${supAnim.length} 个直接子元素）`);
  await supA.shot('anim-admin-desktop.png');

  /* teacher 1440 */
  const teaB = await browser('tea', 1440, 900);
  const tea = await login(teaB, '张伟', 'liyun2026');
  ok(tea.off && tea.role === 'teacher', 'teacher 登录');
  await teaB.eval(`App.go('today')`); await sleep(900);
  await teaB.eval(`App.go('att')`);
  await sleep(120);
  const teaAnim = await teaB.eval(`(() => {
    const page = document.querySelector('.page.on');
    return [...page.children].map(el => { const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration, s.animationDelay, s.animationTimingFunction]; }); })()`);
  ok(teaAnim.length > 0 && teaAnim.every(a => a[0] === 'rise'), `授课老师端切页 rise 级联在（${teaAnim.filter(a => a[0] === 'rise').length}/${teaAnim.length}）`);
  await teaB.shot('anim-teacher-desktop.png');

  /* student 1440 */
  const stuC = await browser('stu', 1440, 900);
  const stu = await login(stuC, '王梓涵', 'liyun2026');
  ok(stu.off && stu.role === 'student', 'student 登录');
  await stuC.eval(`App.go('news')`);
  await sleep(120);
  const stuAnim = await stuC.eval(`(() => {
    const page = document.querySelector('.page.on');
    return [...page.children].map(el => { const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration, s.animationDelay, s.animationTimingFunction]; }); })()`);
  ok(stuAnim.length > 0 && stuAnim.every(a => a[0] === 'rise'), `学生端切页 rise 级联在（${stuAnim.filter(a => a[0] === 'rise').length}/${stuAnim.length}）`);
  /* 「与老师端完全一致」= 同一套动画令牌，不是子元素个数（各角色首页内容本就不同）：
     ① 名字全 rise ② 时长全 0.26s ③ timing-function 同一个（var(--ease) 的 computed 值）
     ④ 前三个子元素的 delay 节拍逐位相同（0/.03/.06 —— 同一条 nth-child 级联） */
  const beat = a => a.slice(0, 3).map(x => x[2]).join(',');
  const names = new Set([...supAnim, ...teaAnim, ...stuAnim].map(x => x[0]));
  const durs  = new Set([...supAnim, ...teaAnim, ...stuAnim].map(x => x[1]));
  const easings = new Set([...supAnim, ...teaAnim, ...stuAnim].map(x => x[3]));
  const same = names.size === 1 && names.has('rise')
    && durs.size === 1 && easings.size === 1
    && beat(supAnim) === beat(teaAnim) && beat(supAnim) === beat(stuAnim)
    && (stuAnim[4] ? stuAnim[4][2] === '0.12s' : true);
  ok(same, '三角色同一套 rise 令牌：名字/时长/缓动/延迟节拍完全一致');
  await stuC.shot('anim-student-desktop.png');

  /* 390 手机：无动画（手机 scroll-snap 轮播不动） */
  const stuM = await browser('stuM', 390, 844);
  await login(stuM, '王梓涵', 'liyun2026');
  await stuM.eval(`App.go('news')`);
  await sleep(120);
  const mAnim = await stuM.eval(`(() => {
    const page = document.querySelector('.page.on');
    return [...page.children].map(el => getComputedStyle(el).animationName)
      .filter(a => a && a !== 'none'); })()`);
  ok(mAnim.length === 0, '手机 390 切页无进场动画（rise 只在桌面 ≥1100）');
  await stuM.shot('anim-student-m390.png');

  console.log('\n=== ② 统考日期可视化配置：改一处全端同步 ===');
  /* exam 页编辑卡：默认值 = 常量兜底 2027-01-09 */
  await supA.eval(`App.go('exam')`);
  await sleep(1200);
  const def = await supA.eval(`(() => ({
    cardOn: document.getElementById('examDateCard').style.display !== 'none',
    val: document.getElementById('examDateIn').value,
    now: document.getElementById('examDateNow').textContent.slice(0, 40) }))()`);
  ok(def.cardOn && def.val === '2027-01-09', '编辑卡在，默认值 = 常量兜底 ' + def.val);

  /* 改日期 → 桌面首页卡同步 */
  await supA.eval(`(() => { document.getElementById('examDateIn').value = '2027-03-01'; Exam.saveDate(); return true; })()`);
  await sleep(900);
  await supA.eval(`App.go('home')`);
  await sleep(1000);
  const home1 = await supA.eval(`({ d: document.getElementById('cdDate').textContent, n: document.getElementById('cdDays').textContent })`);
  ok(home1.d === '2027-03-01', `桌面首页倒计时卡同步（目标日 ${home1.d} · 剩 ${home1.n} 天）`);
  await supA.shot('exam-desktop-home-card.png');

  /* teacher 只读（teacher 一直开着没动，等一轮轮询/手动拉一次，云端值到位才看得到） */
  await teaB.eval(`App.go('exam')`);
  await sleep(600);
  await teaB.eval(`Sync.pull(true)`);
  await sleep(1200);
  const tRead = await teaB.eval(`(() => ({
    editOff: document.getElementById('examDateEdit').style.display === 'none',
    now: document.getElementById('examDateNow').textContent.slice(0, 40) }))()`);
  ok(tRead.editOff && /2027-03-01/.test(tRead.now), `teacher 只读显示当前值（${tRead.now}）`);

  /* 学生手机 390：轮播卡同步（切页 + 数据拉回都算数，这里直接拉） */
  await stuM.eval(`App.go('stuHome')`);
  await sleep(900);
  await stuM.eval(`Sync.pull(true)`);
  await sleep(1200);
  const stuCard1 = await stuM.eval(`(() => {
    const card = document.getElementById('v1CdCardStu');
    return { on: card && card.style.display !== 'none',
      days: (document.getElementById('v1CdDaysStu') || {}).textContent,
      date: (document.getElementById('v1CdDateStu') || {}).textContent,
      dots: [...(card ? card.closest('.v1-carousel').querySelectorAll('.v1-dots i') : [])].filter(d => d.style.display !== 'none').length }; })()`);
  ok(stuCard1.on && stuCard1.date === '目标日 2027.03.01', `学生手机轮播卡同步（${stuCard1.date} · 剩 ${stuCard1.days} 天）`);
  await stuM.shot('exam-stu-m390-card.png');

  /* 实时性：再改一次 → 学生端不重启、不切页就更新（等 15s 轮询或手动拉一次后的 computed） */
  await supA.eval(`(() => { document.getElementById('examDateIn').value = '2027-04-15'; Exam.saveDate(); return true; })()`);
  await sleep(900);
  await stuM.eval(`Sync.pull(true)`);
  await sleep(1200);
  const stuCard2 = await stuM.eval(`(() => ({
    date: (document.getElementById('v1CdDateStu') || {}).textContent,
    days: (document.getElementById('v1CdDaysStu') || {}).textContent }))()`);
  ok(stuCard2.date === '目标日 2027.04.15', `改完不用重启，学生端轮询回来就地更新（${stuCard2.date} · 剩 ${stuCard2.days} 天）`);

  /* 过期 → 整卡隐藏 + 圆点收 1 枚 */
  await supA.eval(`(() => { document.getElementById('examDateIn').value = '2026-01-01'; Exam.saveDate(); return true; })()`);
  await sleep(900);
  await stuM.eval(`Sync.pull(true)`);
  await sleep(1200);
  const expired = await stuM.eval(`(() => {
    const card = document.getElementById('v1CdCardStu');
    return { hidden: card && card.style.display === 'none',
      dots: [...card.closest('.v1-carousel').querySelectorAll('.v1-dots i')].filter(d => d.style.display !== 'none').length }; })()`);
  ok(expired.hidden && expired.dots === 1, `过期整卡隐藏、圆点收 1 枚（规矩不变）`);
  await stuM.shot('exam-stu-m390-expired.png');

  /* 学生改不动（服务端 OVERWRITE 白名单 + 前端 gate 双保险） */
  const stuTok = await stuM.eval('Auth.token()');
  const stuPush = await (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'push', token: stuTok, shared: { examDate: '2030-12-31' } }) })).json();
  const chk = await (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'pull', token: stuTok }) })).json();
  const examOnServer = chk.shared.examDate;
  ok(!stuPush.ok || examOnServer !== '2030-12-31', `学生推 examDate 被服务端丢弃（云端仍是 ${examOnServer}）`);

  console.log('\n────');
  console.log(`通过 ${pass} / ${pass + fail} 项`);
} catch (e) {
  console.log('❌ 脚本异常：' + e.message); fail++;
} finally {
  for (const c of chromes) { try { c.kill(); } catch {} }
  try { server && server.kill(); } catch {}
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
}
process.exit(fail ? 1 : 0);
