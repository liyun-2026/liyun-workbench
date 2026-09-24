/**
 * 端到端验收：三件新东西
 *   ① 教务端设置里能亲手设「学生换设备的一次性密钥」，且只能用一次
 *   ② 学生端设备绑定：最多两台，之外的设备必须拿密钥（判定在服务端）
 *   ③ 演示账号：只有首位教务能看到/能切（老师、教务、教务兼老师、学生）
 *   node test/demo_devkey_check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','HTTPS_PROXY','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5325);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUPER = { user: '测试教务', pass: 'shotpass123' };
const KEY = 'DK-TEST-1';

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
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

try {
  const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'demo-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5326', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5326/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  console.log('\n【1/5】首位教务登录，设置页该出现「密钥」和「演示账号」两张卡…');
  const s1 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    App.go('settings');
    await new Promise(r => setTimeout(r, 300));
    const vis = id => { const e = document.getElementById(id); return !!e && e.style.display !== 'none'; };
    return { role: Auth.role(), isSuper: Auth.isSuper(),
             keyCard: vis('devKeyCard'), demoCard: vis('demoCard'),
             demoRows: document.querySelectorAll('#demoList .item').length };
  })()`);
  ok(s1.role === 'super' && s1.isSuper, '登录的是首位教务（role=' + s1.role + '）');
  ok(s1.keyCard, '设置页出现「学生换设备密钥」卡');
  ok(s1.demoCard && s1.demoRows === 4, '设置页出现「演示账号」卡，四个身份都在（' + s1.demoRows + ' 行）');

  console.log('\n【2/5】亲手设一个密钥…');
  const s2 = await cdp.eval(`(async () => {
    document.getElementById('devKeyNew').value = '${KEY}';
    Settings.devKeyAdd();
    await new Promise(r => setTimeout(r, 200));
    const all = Settings.devKeys();
    return { n: all.length, code: all[0] && all[0].code, used: all[0] && all[0].used,
             txt: (document.getElementById('devKeyList') || {}).textContent || '' };
  })()`);
  ok(s2.n === 1 && s2.code === KEY, '密钥按教务填的那个存下来了（' + s2.code + '）');
  ok(s2.used === false, '新密钥是「还没用」状态');
  ok(/还没用/.test(s2.txt), '列表里写清楚了它还没被用过');

  console.log('\n【3/5】一键建好四个演示账号…');
  const s3 = await cdp.eval(`(async () => {
    await Settings.demoMake();
    await new Promise(r => setTimeout(r, 1200));
    const j = await Auth.call('users', { op: 'list' });
    const u = (j.users || []).map(x => x.user + ':' + x.role);
    return { u, stu: (j.users || []).find(x => x.user === '演示学生') || null };
  })()`);
  ok(s3.u.some(x => x === '演示老师:teacher'), '演示老师建好了');
  ok(s3.u.some(x => x === '演示教务:admin'), '演示教务建好了');
  ok(s3.u.some(x => x === '演示教务兼老师:both'), '演示教务兼老师建好了');
  ok(s3.stu && s3.stu.role === 'student' && s3.stu.studentId, '演示学生建好并挂在学员档案上（studentId=' + (s3.stu && s3.stu.studentId) + '）');

  console.log('\n【4/5】设备绑定：第三台设备必须拿密钥，且密钥只能用一次…');
  const s4 = await cdp.eval(`(async () => {
    /* 换到演示学生：StuDev.check() 会把它自己这台登记成第一台 */
    if (!Store.getSecret('mainToken')) { Store.setSecret('mainToken', Auth.token()); Store.setSecret('mainMe', Auth.me()); }
    const j = await Auth.call('login', { user: '演示学生', pass: Settings.DEMO_PASS });
    const out = { login: !!j.token };
    /* ⚠️ 必须先把令牌换成这个学生本人的 —— 否则下面几声 dev 还是拿教务的身份去问，
       服务端一看不是学生就直接 skip，测试就成了「什么都通过」的假绿。 */
    Store.setSecret('token', j.token);
    Auth._me = j.profile;
    const a = await Auth.call('dev', { dev: 'device-A' });            // 第一台
    out.first = !!(a.bound || a.ok);
    const b = await Auth.call('dev', { dev: 'device-B' });            // 第二台：也要密钥
    out.needKey = b.needKey === true;
    const c = await Auth.call('dev', { dev: 'device-B', key: '${KEY}' });
    out.boundWithKey = !!(c.bound || c.ok);
    let again = '';
    try { await Auth.call('dev', { dev: 'device-C', key: '${KEY}' }); out.reuse = '竟然又通过了'; }
    catch(e){ again = e.message; out.reuse = 'rejected'; }
    out.againMsg = again;
    const k = Settings.devKeys ? null : null;
    return out;
  })()`);
  ok(s4.login, '演示学生账号能登录');
  ok(s4.first, '第一台设备直接登记（它就是认证设备）');
  ok(s4.needKey, '没登记过的设备被挡住，要求密钥');
  ok(s4.boundWithKey, '给了密钥才登记上');
  ok(s4.reuse === 'rejected' && /用过|不对/.test(s4.againMsg), '同一个密钥第二次用就废了（' + s4.againMsg + '）');

  console.log('\n【5/5】密钥核销后教务端看得到「已用」…');
  const s5 = await cdp.eval(`(async () => {
    const back = Store.getSecret('mainToken');
    Store.setSecret('token', back);
    const m = Store.getSecret('mainMe'); if (m) Store.setSecret('me', m);
    location.reload();
    return true;
  })()`).catch(() => true);
  await sleep(2500);
  const s6 = await cdp.eval(`(async () => {
    await new Promise(r => setTimeout(r, 1500));
    await Sync.pull();                 // 核销是服务端做的，拉一次才看得到「已用」
    App.go('settings');
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('devKeyList');
    return { role: Auth.role(), txt: (el || {}).textContent || '' };
  })()`);
  ok(s6.role === 'super', '一键回到主账号（role=' + s6.role + '）');
  ok(/已用/.test(s6.txt), '教务端看得到这个密钥已经被用掉了：' + s6.txt.replace(/\s+/g, ' ').slice(0, 60));

  console.log('\n【6/5】同一台设备切换另一个学生账号，也要密钥（防拿同学手机互相打卡）…');
  const s7 = await cdp.eval(`(async () => {
    /* 回到主账号，建第二条演示学员档案 + 第二个学生账号 */
    const back = Store.getSecret('mainToken'); Store.setSecret('token', back);
    const mm = Store.getSecret('mainMe'); if (mm) Store.setSecret('me', mm);
    Store.upsert('students', { id:'stu_demo2', name:'演示学员2', classId:'cls_demo' });
    try { await Sync.push(); } catch(e){}
    const clsIds = Store.list('classes').map(c => c.id);
    const made = await Auth.call('users', { op:'createMany',
      list:[{ user:'演示学生2', pass:Settings.DEMO_PASS, role:'student', name:'演示学员2', studentId:'stu_demo2' }],
      classIds: clsIds });
    /* 演示学生登过 device-A（step 4 把它记成认证设备）。现在换「演示学生2」登同一台 device-A。 */
    const j2 = await Auth.call('login', { user:'演示学生2', pass:Settings.DEMO_PASS });
    Store.setSecret('token', j2.token); Auth._me = j2.profile;
    const dev1 = await Auth.call('dev', { dev:'device-A' });          // 同设备、不同账号
    let wrongMsg = '';
    try { await Auth.call('dev', { dev:'device-A', key:'THIS-KEY-INVALID' }); dev1.wrongPassed = true; }
    catch(e){ wrongMsg = e.message; dev1.wrongPassed = false; dev1.wrongMsg = e.message; }
    return { made:(made.n||0), needKey: dev1.needKey === true,
             switchFlag: dev1.switchAccount === true, newDevFlag: dev1.newDevice === true,
             wrongPassed: dev1.wrongPassed, wrongMsg };
  })()`);
  ok(s7.made >= 1, '建出了第二个学生账号「演示学生2」（' + s7.made + ' 个）');
  ok(s7.needKey,
     '同设备换另一个学生账号 → 必须输密钥（(设备+账号)这对没绑过就挡，needKey=' + s7.needKey + '，UI 提示 newDev=' + s7.newDevFlag + ' switch=' + s7.switchFlag + '）');
  ok(!s7.wrongPassed && /用过|不对/.test(s7.wrongMsg || ''),
     '随手填个不对的密钥照样挡住（' + (s7.wrongMsg || '但没报错') + '）');

  console.log('\n【收尾】清场…');
  await devReset();
  server.kill(); chrome.kill();
} catch (e) {
  console.error('\n崩了：', e && e.message);
  fail++;
}

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
