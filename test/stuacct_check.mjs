/**
 * 方案A「一人一密发放卡」全链路验收（VoxOS 5.37）
 *   node test/stuacct_check.mjs
 *
 * 第一段：直接调真 sync.js（mock-blob 内存版）—— 后端规则逐条钉死
 *   ① 学生密码下限 6 位（by+4 位数字），教职仍 8 位（建号/改密/自改密三处）
 *   ② device_key：一键生成 8 位随机码（去 0O1I）、留痕（生成人/时间）、
 *      一次性核销、10 分钟过期、教务可作废
 *   ③ reset_password：服务端出新密码、旧密码当场作废、只准重置学生号
 *   ④ 权限：office/admin/super 可调，teacher/student 403
 *
 * 第二段：dev-server + CDP 真界面 —— 教务视角走一遍全链路
 *   选班 → 班级码映射确认 → 批量建号（账号=班级码-学号、一人一密）
 *   → 打印发放卡（A4 拼版 8 张/页）→ 单独建号 → 一键生成密钥 → 一键重置
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5337);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
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
  async shot(file, full = false){
    const data = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    await writeFile(file, Buffer.from(data.data, 'base64'));
  }
}
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }

/* ════════ 第一段：后端规则（真 sync.js + mock-blob）════════ */
console.log('\n【第一段】后端规则：密码下限 / device_key / reset_password / 权限');
{
  const genPath = path.join(dir, 'test', '.sync.stuacct.mjs');
  const { readFileSync, writeFileSync } = await import('node:fs');
  writeFileSync(genPath, readFileSync(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8')
    .replace("from '@edgeone/pages-blob'", "from './mock-blob.mjs'"));
  const { onRequestPost } = await import('./.sync.stuacct.mjs');
  const { raw } = await import('./mock-blob.mjs');
  const call = async body => {
    const r = await onRequestPost({ request: new Request('http://x/api/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: r.status, ...(await r.json()) };
  };

  const sup = await call({ action: 'login', user: '陈校', pass: 'admin12345' });
  ok(sup.ok && sup.profile.role === 'super', '首位教务初始化（super）');
  const T = sup.token;

  /* ① 学生密码 6 位起 */
  let r = await call({ action: 'users', token: T, op: 'createMany', list: [
    { user: 'stu1', pass: 'by1234', role: 'student', name: '王小明', studentId: 's1' },
    { user: 'stu2', pass: 'by5678', role: 'student', name: '李思远', studentId: 's2' },
    { user: 'stu3', pass: 'by9024', role: 'student', name: '陈书航', studentId: 's3' }] });
  ok(r.n === 3 && !(r.fail || []).length, '学生号 6 位密码批量建号 3 个全过');
  r = await call({ action: 'users', token: T, op: 'createMany',
    list: [{ user: 'stu4', pass: 'by123', role: 'student', name: '吴雨桐' }] });
  ok(r.fail?.[0]?.err?.includes('至少 6 位'), '学生 5 位密码被拒（' + (r.fail?.[0]?.err || '') + '）');
  r = await call({ action: 'users', token: T, op: 'create', user: '张老师', pass: 'by1234', role: 'teacher', name: '张老师' });
  ok(r.error?.includes('至少 8 位'), '教职 6 位密码被拒（仍要 8 位）');
  r = await call({ action: 'users', token: T, op: 'create', user: '张老师', pass: 'teapass123', role: 'teacher', name: '张老师' });
  ok(r.ok, '教职 8 位密码照常建号');

  const stu = await call({ action: 'login', user: 'stu1', pass: 'by1234' });
  ok(stu.ok && stu.profile.isStudent, '学生用 6 位密码能登录（入口兜底降到 6）');
  r = await call({ action: 'chpass', token: stu.token, oldPass: 'by1234', newPass: 'by2468' });
  ok(r.ok, '学生自改密码 6 位过（' + JSON.stringify(r).slice(0, 40) + '）');
  r = await call({ action: 'chpass', token: stu.token, oldPass: 'by2468', newPass: 'by246' });
  ok(r.error?.includes('至少 6 位'), '学生自改 5 位密码被拒');

  /* ② device_key */
  r = await call({ action: 'device_key', token: T, op: 'make' });
  const k1 = r.code || '';
  ok(r.ok && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(k1), '一键生成 8 位码（' + k1 + '）');
  ok(!/[0O1lI]/.test(k1), '码里没有易混字符 0O1lI');
  ok(r.ttl === 10 * 60 * 1000, 'TTL=10 分钟');
  const d0 = raw().get('org/data');
  ok(d0?.dev_keys?.[0]?.madeBy === '陈校', '留痕记了生成人（madeBy=' + d0?.dev_keys?.[0]?.madeBy + '）');

  const d1 = await call({ action: 'dev', token: stu.token, dev: 'dev-A' });
  ok(d1.bound, '第一台设备直接登记');
  const d2 = await call({ action: 'dev', token: stu.token, dev: 'dev-B' });
  ok(d2.needKey === true, '第二台被挡，要求密钥');
  let e = await call({ action: 'dev', token: stu.token, dev: 'dev-B', key: 'ZZZZ-9999' });
  ok(e.status === 403, '错的密钥挡住（403）');
  e = await call({ action: 'dev', token: stu.token, dev: 'dev-B', key: k1 });
  ok(e.bound, '正确密钥登记上（' + k1 + '）');
  e = await call({ action: 'dev', token: stu.token, dev: 'dev-C', key: k1 });
  ok(e.status === 403, '同一枚密钥第二次用就废');

  /* 过期：把刚生成那枚的 madeAt 拨老 11 分钟 */
  const k2r = await call({ action: 'device_key', token: T, op: 'make' });
  const k2 = k2r.code;
  const d = raw().get('org/data');
  d.dev_keys.find(x => x.code === k2).madeAt = Date.now() - 11 * 60 * 1000;
  raw().set('org/data', d);
  e = await call({ action: 'dev', token: stu.token, dev: 'dev-C', key: k2 });
  ok(e.status === 403 && /过期/.test(e.error || ''), '过期密钥被挡（' + (e.error || '') + '）');

  const k3r = await call({ action: 'device_key', token: T, op: 'make' });
  const k3id = raw().get('org/data').dev_keys.find(x => x.code === k3r.code).id;
  r = await call({ action: 'device_key', token: T, op: 'revoke', id: k3id });
  ok(r.ok, '教务作废密钥');
  e = await call({ action: 'dev', token: stu.token, dev: 'dev-C', key: k3r.code });
  ok(e.status === 403, '作废后的密钥登录被挡');

  /* ③ reset_password */
  r = await call({ action: 'reset_password', token: T, id: sup.profile.id });
  ok(r.status === 403, '一键重置只准用于学生号（教职号 403）');
  const list = await call({ action: 'users', token: T, op: 'list' });
  const stu1 = (list.users || []).find(u => u.user === 'stu1');
  r = await call({ action: 'reset_password', token: T, id: stu1.id });
  ok(r.ok && /^by\d{4}$/.test(r.pass || ''), '一键重置出了新密码（' + r.pass + '）');
  e = await call({ action: 'login', user: 'stu1', pass: 'by2468' });
  ok(e.status === 401 || e.error, '旧密码当场作废');
  e = await call({ action: 'login', user: 'stu1', pass: r.pass });
  ok(e.ok, '新密码能登录');
  r = await call({ action: 'reset_password', token: T, id: 'no-such-id' });
  ok(r.status === 404, '重置不存在的账号 404');

  /* ④ 权限 */
  r = await call({ action: 'users', token: T, op: 'create', user: '王教务', pass: 'admpass123', role: 'admin', name: '王教务' });
  ok(r.ok, '建出教务老师（admin）');
  const adm = await call({ action: 'login', user: '王教务', pass: 'admpass123' });
  r = await call({ action: 'device_key', token: adm.token, op: 'make' });
  ok(r.ok, 'admin 能一键生成密钥（主理人 11-15 定的三档口径）');
  r = await call({ action: 'reset_password', token: adm.token, id: stu1.id });
  ok(r.ok && /^by\d{4}$/.test(r.pass || ''), 'admin 能一键重置学生密码（' + r.pass + '）');
  const tea = await call({ action: 'login', user: '张老师', pass: 'teapass123' });
  r = await call({ action: 'device_key', token: tea.token, op: 'make' });
  ok(r.status === 403, '授课老师调 device_key 被 403');
  r = await call({ action: 'reset_password', token: tea.token, id: stu1.id });
  ok(r.status === 403, '授课老师调 reset_password 被 403');
  r = await call({ action: 'device_key', token: stu.token, op: 'make' });
  ok(r.status === 403, '学生调 device_key 被 403');
}

/* ════════ 第二段：CDP 真界面全链路 ════════ */
console.log('\n【第二段】CDP 真界面：选班 → 建号 → 发放卡 → 密钥 → 重置');
let server, chrome;
const SHOTS = path.join(dir, 'docs', 'stuacct-shots-2026-11-15');
try {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  const profile = await mkdtemp(path.join(tmpdir(), 'stuacct-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5338', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5338/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  console.log('\n【U1】教务登录 + 种子班级学员…');
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '测试教务';
    document.getElementById('gPass').value = 'shotpass123';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    window.confirm = () => true;              // headless 弹窗自动放行
    const c = Store.upsert('classes', { name: '砺蕴二班' });
    ['王小明','李思远','陈书航','吴雨桐'].forEach(n => Store.upsert('students', { classId: c.id, name: n }));
    try { await Sync.push(); } catch(e){}
    App.go('roster');
    await new Promise(r => setTimeout(r, 400));
    return { role: Auth.role(), cls: document.getElementById('batchCls')?.options?.length };
  })()`).then(s => {
    ok(s.role === 'super', '登录的是首位教务');
    ok(s.cls >= 1, '班级下拉有班（' + s.cls + ' 个）');
  });

  console.log('\n【U2】选班 → 班级码映射确认区…');
  const u2 = await cdp.eval(`(async () => {
    const sel = document.getElementById('batchCls');
    sel.value = Store.list('classes')[0].id;
    Roster.onBatchCls();
    await new Promise(r => setTimeout(r, 100));
    const row = document.getElementById('clsCodeRow');
    return { shown: row && row.style.display !== 'none',
             code: document.getElementById('clsCodeIn')?.value,
             hint: document.getElementById('clsCodeHint')?.textContent || '' };
  })()`);
  ok(u2.shown, '班级码确认区出现');
  ok(u2.code === '2b', '「砺蕴二班」自动映射成 2b（实际 ' + u2.code + '）');
  ok(u2.hint.includes('砺蕴二班'), '映射来源显示在提示里（' + u2.hint + '）');

  console.log('\n【U3】给全班建号：账号=2b-学号、一人一密…');
  const u3 = await cdp.eval(`(async () => {
    await Roster.genAccounts();
    await new Promise(r => setTimeout(r, 800));
    const j = await Auth.call('users', { op: 'list' });
    const stus = (j.users || []).filter(u => u.role === 'student');
    const box = document.getElementById('rosterMsgBox');
    const okList = Roster._ok || [];
    const passes = okList.map(x => x.pass || '');
    return { n: stus.length, users: stus.map(u => u.user),
             okN: okList.length,
             passOk: passes.every(p => /^by\\d{4}$/.test(p)),
             uniq: new Set(passes).size === passes.length && passes.length === stus.length,
             boxShown: box && box.style.display !== 'none',
             stat: document.getElementById('rsStat')?.textContent?.slice(0, 40) || '',
             nos: Store.list('students').filter(s => s.name && s.no).map(s => s.name + ':' + s.no) };
  })()`);
  ok(u3.n === 4, '四个学员号全建好（' + u3.n + ' 个）');
  ok(u3.users.every(x => /^2b-\d{2}$/.test(x)), '账号全是 班级码-学号 形态（' + u3.users.join(' ') + '）');
  ok(u3.okN === 4 && u3.passOk, '四枚密码都是 by+4 位');
  ok(u3.uniq, '四枚密码互不重复');
  ok(u3.boxShown, '建号完成区出现（发放卡 / 复制按钮）');
  ok(u3.nos.length === 4, '学号写进学员档案（' + u3.nos.join(' ') + '）');

  console.log('\n【U4】发放卡打印：A4 拼版内容捕获…');
  const u4 = await cdp.eval(`(async () => {
    const cap = [];
    const origOpen = window.open;
    window.open = () => ({ document: { write: h => cap.push(h), close(){} }, focus(){}, print(){} });
    try { Roster.printCards(); } catch(e){ cap.push('ERR:' + e.message); }
    window.open = origOpen;
    const ta = document.getElementById('rsMsg');
    return { html: cap.join(''), welcome: ta ? ta.value : '' };
  })()`);
  const minis = (u4.html.match(/class="mini"/g) || []).length;
  ok(/学生账号发放卡 · A4 拼版/.test(u4.html), '打印页是 A4 拼版头');
  ok(minis === 4, '四张迷你卡都排进去了（' + minis + ' 张）');
  ok(/2b-\d{2}/.test(u4.html) && /by\d{4}/.test(u4.html), '卡上有账号和密码');
  ok(/学号\s*\d{2}/.test(u4.html), '卡上学号也印上了');
  ok(!u4.welcome.includes('密码　'), '欢迎语不再统一发密码（旧文案已退场）');
  ok(u4.welcome.includes('发放卡'), '欢迎语引导看发放卡');
  await writeFile(path.join(SHOTS, 'cards-print.html'), u4.html, 'utf8');

  console.log('\n【U5】单独建号沿用班级码、学号顺延…');
  const u5 = await cdp.eval(`(async () => {
    document.getElementById('singleCls').value = Store.list('classes')[0].id;
    document.getElementById('singleName').value = '赵新来';
    await Roster.createSingle();
    await new Promise(r => setTimeout(r, 800));
    const j = await Auth.call('users', { op: 'list' });
    const z = (j.users || []).find(u => u.name === '赵新来');
    return { user: z && z.user, stat: document.getElementById('singleStat')?.textContent || '' };
  })()`);
  ok(u5.user === '2b-05', '单独建号 = 2b-05（学号顺延，实际 ' + u5.user + '）');
  ok(u5.stat.includes('by') && /\d{4}/.test(u5.stat), '完成区直接亮出密码');

  console.log('\n【U6】设置页一键生成密钥…');
  const u6 = await cdp.eval(`(async () => {
    App.go('settings');
    await new Promise(r => setTimeout(r, 400));
    const vis = document.getElementById('devKeyCard') && document.getElementById('devKeyCard').style.display !== 'none';
    await Settings.devKeyGen();
    await new Promise(r => setTimeout(r, 900));
    const txt = document.getElementById('devKeyList')?.textContent || '';
    return { vis, txt: txt.replace(/\\s+/g, ' ').slice(0, 90),
             code: (Settings.devKeys()[0] || {}).code, madeBy: (Settings.devKeys()[0] || {}).madeBy };
  })()`);
  ok(u6.vis, '设置页出现「学生换设备密钥」卡');
  ok(/有效中/.test(u6.txt) && /10 分钟|剩约/.test(u6.txt), '列表显示有效状态与倒计时（' + u6.txt + '）');
  ok(u6.madeBy === '测试教务', '留痕显示生成人（' + u6.madeBy + '）');
  await cdp.eval(`document.getElementById('devKeyCard').scrollIntoView({block:'center'})`);
  await sleep(300);
  await cdp.shot(path.join(SHOTS, 'devkey-card.png'));

  console.log('\n【U7】学生账号页一键重置 + 单卡重打…');
  const u7 = await cdp.eval(`(async () => {
    App.go('students');
    await new Promise(r => setTimeout(r, 600));
    const rows = () => [...document.querySelectorAll('#saList .item')];
    const firstBtn = rows()[0]?.querySelector('button');
    const btnTxt = firstBtn?.textContent || '';
    const user0 = StuAcct._users[0].user;
    const cap = [];
    const origOpen = window.open;
    window.open = () => ({ document: { write: h => cap.push(h), close(){} }, focus(){}, print(){} });
    await StuAcct.resetPass(StuAcct._users[0].id);
    await new Promise(r => setTimeout(r, 800));
    try { StuAcct.printOne(StuAcct._users[0].id); } catch(e){ cap.push('ERR:' + e.message); }
    window.open = origOpen;
    /* 被重置的不一定是列表第一行（行按姓名排序，_users 是服务端顺序）—— 按账号找行 */
    const row0 = rows().find(r => (r.textContent || '').includes('@' + user0)) || rows()[0];
    const txt = row0?.textContent || '';
    const np = (txt.match(/by\\d{4}/) || [])[0] || '';
    let login = '';
    try { const j = await Auth.call('login', { user: user0, pass: np }); login = j.ok ? 'ok' : 'fail'; } catch(e){ login = e.message; }
    return { btnTxt, user0, confirmAlive: typeof window.confirm === 'function' && window.confirm.toString().includes('true'),
             toast: (document.getElementById('toast') || {}).textContent || '',
             txt: txt.replace(/\\s+/g, ' ').slice(0, 120), np, login, card: cap.join('') };
  })()`);
  console.log('  [U7 诊断]', JSON.stringify(u7).slice(0, 300));
  ok(u7.btnTxt === '重置密码', '行按钮是「重置密码」（' + u7.btnTxt + '）');
  ok(/^by\d{4}$/.test(u7.np), '行上亮出新密码（' + u7.np + '）');
  ok(/旧密码已作废/.test(u7.txt), '行上写明旧密码已作废');
  ok(u7.login === 'ok', '新密码真的能登录（' + u7.user0 + ' / ' + u7.np + '）');
  ok(/class="mini"/.test(u7.card) && u7.card.includes(u7.np), '单卡重打带新密码');
  await cdp.eval(`document.getElementById('saList').scrollIntoView({block:'center'})`);
  await sleep(300);
  await cdp.shot(path.join(SHOTS, 'stuacct-reset.png'));

  console.log('\n【U8】建号页截图…');
  await cdp.eval(`(async () => {
    App.go('roster');
    await new Promise(r => setTimeout(r, 500));
    const el = document.getElementById('batchAcctCard');
    if (el) el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await sleep(400);
  await cdp.shot(path.join(SHOTS, 'roster-batch.png'));

  console.log('\n【收尾】清场…');
  await devReset();
} catch (e) {
  console.error('\n崩了：', e && (e.stack || e.message));
  fail++;
} finally {
  try { server && server.kill(); } catch {}
  try { chrome && chrome.kill(); } catch {}
}

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
