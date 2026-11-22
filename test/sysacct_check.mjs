/**
 * VoxOS 5.38 系统工作号身份 sys 全链路验收
 *   node test/sysacct_check.mjs
 *
 * 第一段：直接调真 sync.js（mock-blob 内存版）—— 后端规则逐条钉死
 *   ① migrate_sys：巡检 teacher 账号 → sys、看板号 → sys（board 标记保留）、
 *      「巡检学员」→ student + sysProtected（学员档案打标 + 清班级）；幂等可重跑
 *   ② sys 登录：profile.isSys / isStaff=false；pull 全量只读；push 拒写（数据原样）
 *   ③ 权限矩阵：sys 对业务写 action 全 403（sign/draw/users/device_key/reset_password/
 *      backupDump/backupRestore/dev:reset/sys_acct/migrate_sys）；code/pull/chpass 放行
 *   ④ doUsers 锁死 sys 与 sysProtected 目标（update/pass/delete 403）；reset_password 拒保护学员
 *   ⑤ sys_acct：super/office 可用，teacher/sys 403；users create role:'sys' 被 normRole 归成 teacher
 *   ⑥ 墓碑防线：sysProtected 学员的删除墓碑在服务端被拦，普通学员照常软删
 *
 * 第二段：dev-server + CDP 真界面
 *   设置页「系统工作号」区块（列表/迁移）→ 名册「系统保护」分组（删不得）
 *   → sys 登录直达看板展示模式（Board.ok 根因修复）→ 退出回设置页 → 截图
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5347);
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
console.log('\n【第一段】后端规则：迁移 / sys 权限矩阵 / 账号锁死 / 墓碑防线');
let superToken = '', sysToken = '', sysId = '', probeStuAuthId = '';
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
  superToken = sup.token;
  const T = superToken;

  /* 种子：巡检 teacher 账号 / 看板号（admin + board）/ 巡检学员（student + 档案挂班级） */
  let r = await call({ action: 'users', token: T, op: 'create', user: '教务系统巡检账号', pass: 'Jwxjzh2026', role: 'teacher', name: '教务系统巡检账号' });
  ok(r.ok, '种子①：巡检账号（teacher）');
  r = await call({ action: 'users', token: T, op: 'create', user: '办公室看板', pass: 'bgskb2026', role: 'admin', name: '看板（办公室那台）', board: true });
  ok(r.ok, '种子②：看板专用号（admin + board 标记）');
  r = await call({ action: 'users', token: T, op: 'create', user: '巡检学员', pass: 'by2026', role: 'student', name: '巡检学员', studentId: 's_probe' });
  ok(r.ok, '种子③：巡检学员（student，挂档案 s_probe）');
  const cls0 = await call({ action: 'pull', token: T });
  const stu0 = (await call({ action: 'pull', token: T })).shared;
  await call({ action: 'push', token: T, shared: { students: [{ id: 's_probe', name: '巡检学员', classId: 'cls_x', no: 1, _u: Date.now() }] } });
  ok((raw().get('org/data').students || []).some(s => s.id === 's_probe' && s.classId === 'cls_x'), '探针学员档案挂进班级（迁移前）');

  /* ① migrate_sys：权限 + 结果 + 幂等 */
  r = await call({ action: 'migrate_sys', token: T });
  ok(r.ok, 'super 能跑迁移');
  const nCh = (r.changed || []).length;
  ok(nCh === 4, '一次迁 4 处（巡检号 sys / 看板号 sys / 学员号 sysProtected / 档案打标清班级），实际 ' + nCh);
  ok((r.changed || []).some(x => x.user === '教务系统巡检账号' && x.to === 'sys'), '巡检账号 teacher → sys');
  ok((r.changed || []).some(x => x.user === '办公室看板' && x.to === 'sys'), '看板号 → sys');
  ok((r.changed || []).some(x => x.user === '巡检学员'), '巡检学员 → student + sysProtected');
  const probe = (raw().get('org/data').students || []).find(s => s.id === 's_probe');
  ok(probe && probe.sysProtected === true && !probe.classId, '档案打标 + 退出班级（清 classId）');
  r = await call({ action: 'migrate_sys', token: T });
  ok(r.ok && (r.changed || []).length === 0, '重跑幂等：changed=0（跳过 ' + (r.skipped || []).length + ' 项）');

  /* ② sys 登录 / pull / push */
  const sys = await call({ action: 'login', user: '教务系统巡检账号', pass: 'Jwxjzh2026' });
  ok(sys.ok && sys.profile.role === 'sys' && sys.profile.isSys === true, '巡检账号以 sys 身份登录（isSys=true）');
  ok(sys.profile.isStaff === false && sys.profile.isStudent === false, 'isStaff=false / isStudent=false');
  sysToken = sys.token; sysId = sys.profile.id;
  const b1 = JSON.stringify(raw().get('org/data'));
  r = await call({ action: 'push', token: sysToken, shared: { students: [], hack: 'x' } });
  ok(r.ok, 'sys push 不报错（静默拒写，看板屏不弹同步失败）');
  ok(JSON.stringify(raw().get('org/data')) === b1, 'push 后服务端数据一个字节没变');
  r = await call({ action: 'pull', token: sysToken });
  ok(r.ok && Array.isArray(r.shared.students) && r.shared.students.some(s => s.id === 's_probe'), 'sys pull 全量只读（拿得到学员名单）');
  ok(r.profile.role === 'sys', 'pull 回的 profile 角色是 sys');

  /* ③ 权限矩阵：业务写全 403，只读放行 */
  const deny = [
    ['sign', { }],
    ['draw', { name: 'x', ids: ['s1'] }],
    ['users', { op: 'list' }],
    ['device_key', { op: 'make' }],
    ['reset_password', { id: 'x' }],
    ['backupDump', { }],
    ['backupRestore', { }],
    ['sys_acct', { op: 'list' }],
    ['migrate_sys', { }],
  ];
  for (const [act, body] of deny){
    r = await call({ action: act, token: sysToken, ...body });
    ok(r.status === 403, 'sys 调 ' + act + ' → 403');
  }
  r = await call({ action: 'dev', token: sysToken, op: 'reset' });
  ok(r.status === 403, 'sys 释放看板设备 → 403');
  r = await call({ action: 'code', token: sysToken });
  ok(r.ok && /^\d{6}$/.test(r.code || ''), 'sys 拿打卡码放行（看板屏本职，' + (r.code || '') + '）');
  r = await call({ action: 'chpass', token: sysToken, oldPass: 'Jwxjzh2026', newPass: 'syspass2026' });
  ok(r.ok, 'sys 改自己密码放行');
  await call({ action: 'chpass', token: sysToken, oldPass: 'syspass2026', newPass: 'Jwxjzh2026' });
  r = await call({ action: 'dev', token: sysToken, dev: 'dev-x' });
  ok(r.ok && r.skip, 'sys 设备绑定走 skip（不是学生也不是看板号）');

  /* ④ doUsers 锁死 sys 与 sysProtected 目标 */
  const ul = await call({ action: 'users', token: T, op: 'list' });
  const sysRow = (ul.users || []).find(u => u.user === '教务系统巡检账号');
  const protRow = (ul.users || []).find(u => u.user === '巡检学员');
  ok(sysRow && sysRow.role === 'sys', '账号列表里有 sys 行');
  ok(protRow && protRow.sysProtected === true, 'list 带出 sysProtected 标记');
  sysId = sysRow.id; probeStuAuthId = protRow.id;
  for (const op of ['update', 'pass', 'delete']){
    r = await call({ action: 'users', token: T, op, id: sysRow.id, name: 'x', pass: 'whatever123', active: false });
    ok(r.status === 403, 'super 对 sys 号 op=' + op + ' → 403');
  }
  for (const op of ['update', 'pass', 'delete']){
    r = await call({ action: 'users', token: T, op, id: protRow.id, name: 'x', pass: 'by9999', active: false });
    ok(r.status === 403, 'super 对系统保护学员 op=' + op + ' → 403');
  }
  r = await call({ action: 'reset_password', token: T, id: protRow.id });
  ok(r.status === 403 && /系统保护/.test(r.error || ''), '一键重置拒系统保护学员');
  const stuOk = (ul.users || []).find(u => u.user === 'stu1');
  if (stuOk){
    r = await call({ action: 'reset_password', token: T, id: stuOk.id });
    ok(r.ok || r.status === 404, '普通学员不受影响（对照）');
  }

  /* ⑤ sys_acct / 建 sys 的唯一入口 */
  r = await call({ action: 'users', token: T, op: 'create', user: '假装sys', pass: 'whatever123', role: 'sys', name: '假装sys' });
  ok(r.ok, 'users create 传 role:sys 不报错（会被归成普通身份）');
  const ul2 = await call({ action: 'users', token: T, op: 'list' });
  ok((ul2.users || []).find(u => u.user === '假装sys')?.role === 'teacher', 'role:sys 被 normRole 归成 teacher（普通建号造不出 sys）');
  r = await call({ action: 'sys_acct', token: T, op: 'create', user: 'sys-new', pass: 'syspass2026', name: '新系统号' });
  ok(r.ok, 'sys_acct create：super 建出真 sys 号');
  const sys2 = await call({ action: 'login', user: 'sys-new', pass: 'syspass2026' });
  ok(sys2.ok && sys2.profile.role === 'sys', '新建 sys 号能登录且身份是 sys');
  r = await call({ action: 'sys_acct', token: T, op: 'list' });
  ok(r.ok && (r.users || []).some(u => u.user === 'sys-new'), 'sys_acct list 列得出');
  r = await call({ action: 'sys_acct', token: sysToken, op: 'list' });
  ok(r.status === 403, 'sys 自己调 sys_acct → 403');
  const sys2id = (r.status === 403 ? (await call({ action: 'sys_acct', token: T, op: 'list' })).users.find(u => u.user === 'sys-new') : null);
  /* ==5.45== sys_acct op:'pass'：super 改密 → 新密码登录 / 幂等 / office 403 / 非 sys 目标 400 */
  r = await call({ action: 'sys_acct', token: T, op: 'pass', id: sys2id?.id || '', pass: 'sysnew2026' });
  ok(r.ok, 'sys_acct pass：super 重置 sys 号密码');
  const sys2c = await call({ action: 'login', user: 'sys-new', pass: 'sysnew2026' });
  ok(sys2c.ok && sys2c.profile.role === 'sys', '新密码登录成功（旧密码作废）');
  const sys2old = await call({ action: 'login', user: 'sys-new', pass: 'syspass2026' });
  ok(!sys2old.ok || sys2old.error, '旧密码登不进');
  r = await call({ action: 'sys_acct', token: T, op: 'pass', id: sys2id?.id || '', pass: 'sysnew2026' });
  ok(r.ok, 'pass 幂等：同密码重设不报错');
  await call({ action: 'users', token: T, op: 'create', user: '办公教务', pass: 'office2026x', role: 'office', name: '办公教务' });
  const off = await call({ action: 'login', user: '办公教务', pass: 'office2026x' });
  r = await call({ action: 'sys_acct', token: off.token, op: 'pass', id: sys2id?.id || '', pass: 'whatever2026' });
  ok(r.status === 403 && /只有首位教务能重置系统号密码/.test(r.error || ''), 'office 调 pass → 403「只有首位教务能重置系统号密码」');
  const ul3 = await call({ action: 'users', token: T, op: 'list' });
  const teaId = (ul3.users || []).find(u => u.user === '假装sys')?.id || '';
  r = await call({ action: 'sys_acct', token: T, op: 'pass', id: teaId, pass: 'whatever2026' });
  ok(r.status === 400, '对非 sys 账号调 pass → 400');
  r = await call({ action: 'sys_acct', token: T, op: 'pass', id: sys2id?.id || '', pass: '短密码' });
  ok(r.status === 400 && /至少 8 位/.test(r.error || ''), 'pass 密码仍要 8 位');
  r = await call({ action: 'sys_acct', token: T, op: 'delete', id: sys2id?.id || '' });
  ok(r.ok, 'sys_acct delete 软删');
  const sys2b = await call({ action: 'login', user: 'sys-new', pass: 'syspass2026' });
  ok(sys2b.status === 403 || sys2b.error, '删掉的 sys 号登不进');
  r = await call({ action: 'sys_acct', token: T, op: 'create', user: 'sys-bad', pass: '短密码', name: 'x' });
  ok(r.error?.includes('至少 8 位'), 'sys 号密码仍要 8 位（不享学生的 6 位）');

  /* ⑥ 墓碑防线 + 看板号 board 标记 */
  const orgNow = raw().get('org/data');
  await call({ action: 'push', token: T, shared: { students: [
    { id: 's_probe', name: '巡检学员', _d: 1, _u: Date.now() },
    { id: 's_other', name: '普通学员', classId: 'cls_x', _d: 1, _u: Date.now() },
  ] } });
  const after = raw().get('org/data').students || [];
  ok(after.some(s => s.id === 's_probe' && !s._d), '系统保护学员的删除墓碑被服务端拦下（档案还活着）');
  ok(after.some(s => s.id === 's_other' && s._d), '普通学员的软删照常生效（对照）');
  const bd = await call({ action: 'login', user: '办公室看板', pass: 'bgskb2026' });
  ok(bd.ok && bd.profile.role === 'sys' && bd.profile.board === true, '看板号迁成 sys 且 board 标记保留');
}

/* ════════ 第二段：CDP 真界面 ════════ */
console.log('\n【第二段】CDP：设置页 sys 区块 → 名册系统保护分组 → sys 登录直达看板');
let server, chrome;
const SHOTS = path.join(dir, 'docs', 'sysacct-shots-2026-11-16');
try {
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  const profile = await mkdtemp(path.join(tmpdir(), 'sysacct-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5348', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5348/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  console.log('\n【U1】super 登录 + 种子（班级/学员/巡检三号）…');
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '测试教务';
    document.getElementById('gPass').value = 'shotpass123';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    window.confirm = () => true; window.prompt = () => 'seed';
    const c = Store.upsert('classes', { name: '砺蕴一班' });
    Store.upsert('students', { classId: c.id, name: '王小明' });
    await Auth.call('users', { op: 'create', user: '教务系统巡检账号', pass: 'Jwxjzh2026', role: 'teacher', name: '教务系统巡检账号' });
    await Auth.call('users', { op: 'create', user: '办公室看板', pass: 'bgskb2026', role: 'admin', name: '看板（办公室那台）', board: true });
    await Auth.call('users', { op: 'create', user: '巡检学员', pass: 'by2026', role: 'student', name: '巡检学员', studentId: 's_probe' });
    await Sync.push();
    Store.upsert('students', { id: 's_probe', name: '巡检学员', classId: c.id });
    await Sync.push();
    return { role: Auth.role() };
  })()`).then(s => ok(s.role === 'super', '首位教务就位，种子三号建齐'));

  console.log('\n【U2】设置页「系统工作号」区块 + 存量迁移…');
  const u2 = await cdp.eval(`(async () => {
    App.go('settings');
    await new Promise(r => setTimeout(r, 600));
    const card = document.getElementById('sysAcctCard');
    const shown = card && card.style.display !== 'none';
    await Settings.sysMigrate();
    await new Promise(r => setTimeout(r, 1200));
    await Sync.pull(true);                     // 迁移改动在服务端：拉回来本地才认「系统保护」
    await new Promise(r => setTimeout(r, 600));
    const tip = document.getElementById('sysMigTip');
    const list = document.getElementById('sysAcctList');
    return { shown,
             tip: tip ? tip.textContent : '',
             listHtml: list ? list.innerHTML : '',
             badgeN: (list?.innerHTML.match(/sys-badge/g) || []).length };
  })()`);
  ok(u2.shown, '「系统工作号」区块对首位教务可见');
  ok(/改动 \d 项/.test(u2.tip) || /迁移完成/.test(u2.tip), '迁移结果写进提示区（' + u2.tip.slice(0, 60) + '…）');
  ok(u2.badgeN >= 1, '列表里 sys 号挂着金框徽章（' + u2.badgeN + ' 枚）');

  console.log('\n【U3】名册「系统保护」分组 + 删不得…');
  const u3 = await cdp.eval(`(async () => {
    App.go('roster');
    await new Promise(r => setTimeout(r, 600));
    const box = document.getElementById('stuList');
    const hasGroup = box.textContent.includes('系统保护');
    const badgeInRoster = (box.innerHTML.match(/sys-badge/g) || []).length;
    const probe = Store.list('students').find(s => s.name === '巡检学员');
    let refused = '';
    try { UI.toast = m => { refused = m; }; Roster.delStu(probe.id); } catch(e){ refused = e.message; }
    const still = !!Store.list('students').find(s => s.id === probe.id);
    return { hasGroup, badgeInRoster, refused, still,
             clsN: Store.list('classes').length };
  })()`);
  ok(u3.hasGroup, '名册出现「系统保护」分组');
  ok(u3.badgeInRoster >= 1, '分组里挂金框徽章');
  ok(u3.refused.includes('系统保护') && u3.still, 'delStu 拒删并提示（' + u3.refused + '）');

  console.log('\n【U4】sys 登录 → 直达看板展示模式（根因修复点）…');
  await cdp.eval(`(async () => {
    Auth.logout();
    await new Promise(r => setTimeout(r, 800));
    document.getElementById('gUser').value = '教务系统巡检账号';
    document.getElementById('gPass').value = 'Jwxjzh2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2000));
  })()`);
  const u4 = await cdp.eval(`({
    role: Auth.role(),
    boardMode: document.body.classList.contains('board-mode'),
    boardOn: document.getElementById('page-board').classList.contains('on'),
    navIds: App.visible().map(r => r.id),
    boardOk: Board.ok(),
    code: (Board._code || '') })`);
  ok(u4.role === 'sys', '登录身份是 sys');
  ok(u4.boardMode && u4.boardOn, '登录后直达看板展示模式（board-mode + page-board）');
  ok(u4.navIds.join() === 'board,settings', '可见导航只有 board + settings（实际 ' + u4.navIds.join() + '）');
  ok(u4.boardOk, 'Board.ok() 放行 sys（原根因：只认 isStaff）');
  ok(/^\d{6}$/.test(u4.code), '看板屏拿到 6 位动态码（' + u4.code + '）');

  console.log('\n【U5】退出看板回设置页：最低配置…');
  const u5 = await cdp.eval(`(async () => {
    Board.leave();
    await new Promise(r => setTimeout(r, 500));
    const on = document.getElementById('page-settings').classList.contains('on');
    const syncCard = document.getElementById('syncCard').style.display !== 'none';
    const danger = document.getElementById('dangerCard').style.display !== 'none';
    const backup = document.getElementById('backupCard').style.display !== 'none';
    const sysCard = document.getElementById('sysAcctCard').style.display !== 'none';
    return { on, syncCard, danger, backup, sysCard, label: Auth.roleLabel() };
  })()`);
  ok(u5.on, 'Esc 退出看板落在设置页（sys 没有 home）');
  ok(u5.syncCard, '「我的账号」卡在（改密码 / 退出都在）');
  ok(u5.label === '系统工作', '角色标签是「系统工作」（实际 ' + u5.label + '）');
  ok(!u5.danger && !u5.backup && !u5.sysCard, '危险操作 / 备份 / sys 管理区块全不可见（业务最低配）');
  await cdp.shot(path.join(SHOTS, 'sys-settings.png'));
  await cdp.eval(`(async () => { document.body.classList.remove('board-mode'); App.go('board'); await new Promise(r => setTimeout(r, 1200)); })()`);
  await cdp.shot(path.join(SHOTS, 'sys-board.png'));
} catch(e){
  fail++; console.log('  ✗ 第二段异常：' + e.message);
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}

console.log('\n═══ sysacct_check 结果：✅ ' + pass + ' · 🔴 ' + fail + ' ═══');
process.exit(fail ? 1 : 0);
