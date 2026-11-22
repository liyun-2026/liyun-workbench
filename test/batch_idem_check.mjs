/**
 * 批量建号幂等 + 编号稳定 + 老号补挂（VoxOS 5.47）
 *   node test/batch_idem_check.mjs
 *
 * 背景（开学日真事故）：考前06班 18 名学员，点「给全班建号」只建出 2 个
 * （kq06-21/22），其余 20 个报「这个用户名已经存在」——
 * 名册删档重导后老号的 studentId 指向已删档案，旧逻辑只按 studentId 判，
 * 于是一个个拿同号去建，全撞名。
 *
 * 第一段：后端 relink（老号补挂档案）规则
 * 第二段：dev-server + CDP 真界面四场景
 *   ① 全新班级 18 人 → 一次建满 18（编号 01-18）
 *   ② 同班再点一次 → 0 新建 / 18 已有 / 0 失败，账号名一个不变
 *   ③ 班里有孤儿老号（kq06-01…18 指向已删档案）→ 0 新建 / 18 已有（复用 + 补挂）
 *   ④ 班级新增 2 人 → 只建 2 个，编号接续 19/20
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台';
const PORT = Number(process.argv[2] || 5341);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(dir, 'docs', 'batch-idem-2026-11-22');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(10000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
  async shot(file){ const d = await this.send('Page.captureScreenshot', { format: 'png' }); await writeFile(file, Buffer.from(d.data, 'base64')); }
}

/* ════════ 第一段：后端 relink 规则（真 sync.js + mock-blob）════════ */
console.log('\n【第一段】后端 relink：只补 studentId，不动密码/名字');
{
  const genPath = path.join(dir, 'test', '.sync.batchidem.mjs');
  await writeFile(genPath, readFileSync(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8')
    .replace("from '@edgeone/pages-blob'", "from './mock-blob.mjs'"));
  const { onRequestPost } = await import('./.sync.batchidem.mjs');
  const call = async body => {
    const r = await onRequestPost({ request: new Request('http://x/api/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: r.status, ...(await r.json()) };
  };
  const sup = await call({ action: 'login', user: '陈校', pass: 'admin12345' });
  const T = sup.token;
  ok(sup.profile.role === 'super', '首位教务初始化（super）');

  /* 名册：两个学员 + 两个已删档案的 id */
  await call({ action: 'push', token: T, shared: {
    classes: [{ id: 'c1', name: '补挂测试班' }],
    students: [{ id: 's1', name: '王小一', classId: 'c1', no: 1 },
               { id: 's2', name: '李小二', classId: 'c1', no: 2 }] } });
  let r = await call({ action: 'users', token: T, op: 'createMany', list: [
    { user: 'bh-01', pass: 'by1111', role: 'student', name: '王小一', studentId: 'gone-1' },
    { user: 'bh-02', pass: 'by2222', role: 'student', name: '李小二', studentId: 'gone-2' }] });
  ok(r.n === 2, '两个老号建成（studentId 指向已删档案）');
  const list0 = (await call({ action: 'users', token: T, op: 'list' })).users
    .filter(u => /^bh-0/.test(u.user)).sort((a, b) => a.user.localeCompare(b.user));

  r = await call({ action: 'users', token: T, op: 'relink', list: [
    { id: list0[0].id, studentId: 's1' }, { id: list0[1].id, studentId: 's2' }] });
  ok(r.ok && r.n === 2 && !(r.fail || []).length, '两条老号补挂成功（' + JSON.stringify(r.fail || []) + '）');
  const after = (await call({ action: 'users', token: T, op: 'list' })).users.filter(u => /^bh-0/.test(u.user));
  ok(after.every(u => u.studentId === 's1' || u.studentId === 's2'), 'studentId 已换成现任学员档案');
  const login1 = await call({ action: 'login', user: 'bh-01', pass: 'by1111' });
  ok(login1.ok && login1.profile.studentId === 's1', '老号密码没被动过（by1111 照旧能登录）');

  r = await call({ action: 'users', token: T, op: 'relink', list: [{ id: list0[0].id, studentId: 'no-such-stu' }] });
  ok(r.fail?.[0]?.err === '学员档案不存在', '补挂到不存在的档案 → 拒绝（' + (r.fail?.[0]?.err || '') + '）');
  r = await call({ action: 'users', token: T, op: 'relink', list: [{ id: 'nope', studentId: 's1' }] });
  ok(r.fail?.[0]?.err === '账号不存在或不是学生号', '补挂不存在的账号 → 拒绝');

  await call({ action: 'users', token: T, op: 'create', user: '张老师', pass: 'teapass123', role: 'teacher', name: '张老师' });
  const tea = await call({ action: 'login', user: '张老师', pass: 'teapass123' });
  r = await call({ action: 'users', token: tea.token, op: 'relink', list: [{ id: list0[0].id, studentId: 's1' }] });
  ok(r.status === 403, '授课老师不能补挂（403）');
}

/* ════════ 第二段：CDP 真界面四场景 ════════ */
let server, chrome;
try {
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'bidem-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5383', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const l = await (await jfetch('http://127.0.0.1:5383/json/list')).json(); return l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await sleep(2500);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '陈校';
    document.getElementById('gPass').value = 'admin12345';
    await Auth.submit();
    await new Promise(x => setTimeout(x, 2200));
    window.confirm = () => true;   // 建号确认框自动化
  })()`);

  /* 造班：考前06班 18 人（无学号，第一次建号时自动编） */
  const prep = await cdp.eval(`(async () => {
    const cls = Store.upsert('classes', { name: '考前06班' });
    const names = ['曹钧盈','邓景月','段宇','高薪杰','郭金涵','侯雅茹','黄紫佳','贾明武','贾元基','李潮洋','林玉婷','林紫莹','孟珍辛','王露锦','王一梦','徐显铮','张晗依','张婧奕'];
    names.forEach(n => Store.upsert('students', { classId: cls.id, name: n }));
    await Sync.push();
    App.go('roster');
    await new Promise(x => setTimeout(x, 600));
    const sel = document.getElementById('batchCls');
    sel.value = cls.id; Roster.onBatchCls();
    document.getElementById('clsCodeIn').value = 'kq06';
    return { clsId: cls.id, students: Store.list('students').filter(s => s.classId === cls.id).length };
  })()`);
  ok(prep.students === 18, '造好「考前06班」18 名学员');

  const runBatch = async () => await cdp.eval(`(async () => {
    await Roster.genAccounts();
    await new Promise(x => setTimeout(x, 1200));
    const j = await Auth.call('users', { op: 'list' });
    const stus = (j.users || []).filter(u => u.role === 'student' && u.active !== false);
    return {
      stat: (document.getElementById('rsStat') || {}).textContent || '',
      users: stus.map(u => u.user).sort(),
      count: stus.length,
      cards: (Roster._ok || []).length,
      cardsNoPass: (Roster._ok || []).filter(x => !x.pass).length,
      allNo: Store.list('students').filter(s => s.classId === '${prep.clsId}').map(s => s.no).sort((a, b) => a - b),
      sidsOk: stus.every(u => Store.list('students').some(s => s.id === u.studentId)),
    };
  })()`);

  console.log('\n【场景①】全新班级 18 人 → 一次建满 18…');
  const r1 = await runBatch();
  const set18 = Array.from({ length: 18 }, (_, i) => 'kq06-' + String(i + 1).padStart(2, '0'));
  ok(r1.count === 18, '18 个号全建好（' + r1.count + '）');
  ok(JSON.stringify(r1.users) === JSON.stringify(set18), '编号 01-18 连续，不跳号（' + r1.users.join(' ') + '）');
  ok(/新建 18 个/.test(r1.stat) && /已有 0 个/.test(r1.stat), '结果口径：新建 18 · 已有 0（' + r1.stat.slice(0, 46) + '）');
  ok(r1.sidsOk, '每个号都挂上了现任学员档案');
  ok(JSON.stringify(r1.allNo) === JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)), '学号写回档案 1-18');
  await cdp.shot(path.join(SHOTS, 's1-fresh-18.png'));

  console.log('\n【场景②】同班再点一次 → 0 新建 / 18 已有 / 0 失败…');
  const r2 = await runBatch();
  ok(r2.count === 18, '账号数没变（' + r2.count + '）');
  ok(JSON.stringify(r2.users) === JSON.stringify(r1.users), '账号名一个没变');
  ok(/新建 0 个/.test(r2.stat) && /已有 18 个/.test(r2.stat), '结果口径：新建 0 · 已有 18（' + r2.stat.slice(0, 46) + '）');
  ok(!/失败/.test(r2.stat), '没有一条「已存在」被渲染成失败');
  ok(r2.cards === 18 && r2.cardsNoPass === 18, '发放卡列出 18 张（已有号标「密码见首次发放卡」）');
  await cdp.shot(path.join(SHOTS, 's2-rerun-idempotent.png'));

  console.log('\n【场景③】班级新增 2 人 → 只建 2 个，编号接续…');
  const r3 = await cdp.eval(`(async () => {
    const clsId = '${prep.clsId}';
    Store.upsert('students', { classId: clsId, name: '新来甲' });
    Store.upsert('students', { classId: clsId, name: '新来乙' });
    await Sync.push();
    return Store.list('students').filter(s => s.classId === clsId).length;
  })()`);
  ok(r3 === 20, '班里 20 人');
  const r3b = await runBatch();
  ok(r3b.count === 20, '账号 20 个（' + r3b.count + '）');
  ok(/新建 2 个/.test(r3b.stat) && /已有 18 个/.test(r3b.stat), '只新建 2 个、18 个复用（' + r3b.stat.slice(0, 46) + '）');
  ok(r3b.users.includes('kq06-19') && r3b.users.includes('kq06-20'), '新号接续 19/20（不跳 21/22）');

  /* ══ 场景④：复刻生产事故 —— 老号还在、studentId 指向已删档案 ══ */
  console.log('\n【场景④】孤儿老号（复刻 kq06 事故）→ 全部复用 + 补挂，0 失败…');
  /* 清场用 dev-reset（账号软删会留着用户名，复刻不出「老号占位」的现场）：
     清库 → 清本机缓存 → 重新加载 → 重新登录 */
  await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });
  await cdp.eval('localStorage.clear()');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await sleep(2600);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '陈校';
    document.getElementById('gPass').value = 'admin12345';
    await Auth.submit();
    await new Promise(x => setTimeout(x, 2200));
    window.confirm = () => true;
  })()`);
  const orphanCase = await cdp.eval(`(async () => {
    const cls = Store.upsert('classes', { name: '考前06班' });
    const names = ['曹钧盈','邓景月','段宇','高薪杰','郭金涵','侯雅茹','黄紫佳','贾明武','贾元基','李潮洋','林玉婷','林紫莹','孟珍辛','王露锦','王一梦','徐显铮','张晗依','张婧奕'];
    names.forEach(n => Store.upsert('students', { classId: cls.id, name: n }));
    await Sync.push();
    /* 老号：kq06-01…18 名字对得上，但 studentId 指向已删档案（事故现场） */
    const stus = Store.list('students', Util.byName).filter(s => s.classId === cls.id);
    const list = stus.map((s, i) => ({ user: 'kq06-' + String(i + 1).padStart(2, '0'), pass: 'by' + String(1000 + i), role: 'student', name: s.name, studentId: 'gone-' + (i + 1) }));
    const mk = await Auth.call('users', { op: 'createMany', list });
    App.go('roster');
    await new Promise(x => setTimeout(x, 600));
    document.getElementById('batchCls').value = cls.id; Roster.onBatchCls();
    document.getElementById('clsCodeIn').value = 'kq06';
    return { clsId: cls.id, made: mk.n, failed: (mk.fail || []).length, sids: stus.map(s => s.id) };
  })()`);
  ok(orphanCase.made === 18, '18 个孤儿老号造好（' + orphanCase.made + '）');
  const r4 = await runBatch();
  ok(/新建 0 个/.test(r4.stat) && /已有 18 个/.test(r4.stat), '事故复现：0 新建 / 18 已有（旧版这里是 0 新建 / 18 失败）');
  ok(r4.count === 18 && JSON.stringify(r4.users) === JSON.stringify(set18), '账号名还是 kq06-01…18，一个没多没少');
  ok(r4.sidsOk, '18 个孤儿号全部补挂到现任学员档案（op:relink 生效）');
  await cdp.shot(path.join(SHOTS, 's4-orphan-reuse.png'));

  console.log(`\n═══ batch_idem_check 结果：✅ ${pass} · 🔴 ${fail} ═══`);
} finally {
  if (chrome) try { chrome.kill(); } catch {}
  if (server) try { server.kill(); } catch {}
}
if (fail) process.exit(1);
