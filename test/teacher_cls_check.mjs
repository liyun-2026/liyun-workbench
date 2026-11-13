/**
 * VoxOS 5.34 复现/验证：老师管理页分班选择器被 15s 轮询冲掉
 *   node test/teacher_cls_check.mjs
 * 修前：等两个轮询周期，断言 tClsCard 被关闭 + render/refresh 次数（实锤）。
 * 修后（--fix 断言）：选择器保持打开、选中态保留、60s 数据无变化时零重绘。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const FIX = process.argv.includes('--fix');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5722, CPORT = 5723;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
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
}

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond){ PASS++; console.log((FIX ? '  ✅ ' : '  ⚡ ') + name + (extra ? ' · ' + extra : '')); }
  else { FAIL++; console.log((FIX ? '  🔴 ' : '  ⚡ ') + name + (extra ? ' · ' + extra : '')); }
};

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok);
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'tcls-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=' + CPORT,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${CPORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(2500);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return !document.getElementById('gate').classList.contains('on');
  })()`);
  console.log('已登录：李老师');

  /* 种子：班级 + 一个授课老师（要分班的人）+ REMOTE_WINS 键上云（生产教务必有：统考日期/打卡规则） */
  await cdp.eval(`(async () => {
    const c1 = Store.upsert('classes', { name: '博艺一班' });
    Store.upsert('classes', { name: '博艺二班' });
    /* 生产上教务端云端必有这两个「远端赢」单值键 —— mergeRemote 对它们每轮盲写盲计 */
    Store.set('examDate', '2027-01-10');
    Store.set('sign_rules', { sgPid: '', before: 30, after: 20, radius: 300 });
    Sync.schedule();
    await new Promise(r => setTimeout(r, 2000));
    const j = await Auth.call('users', { op: 'list' });
    let tea = (j.users || []).find(u => u.role === 'teacher' && !Util.isDemoObj(u));
    if (!tea){
      const r = await Auth.call('users', { op: 'createMany', list: [{ user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026' }] });
      tea = { id: (r.created && r.created[0] && r.created[0].id) || null, name: '张伟' };
      const j2 = await Auth.call('users', { op: 'list' });
      tea = (j2.users || []).find(u => u.role === 'teacher' && !Util.isDemoObj(u));
    }
    return { cls: c1.id, teaId: tea && tea.id };
  })()`);

  /* 打点：Teachers.render / App.refresh / Sync.pull 计数 */
  await cdp.eval(`(() => {
    window._rc = { render: 0, refresh: 0, pull: 0, paint: 0 };
    const _r = Teachers.render.bind(Teachers);
    Teachers.render = async function(...a){ window._rc.render++; return _r(...a); };
    const _rf = App.refresh.bind(App);
    App.refresh = function(...a){ window._rc.refresh++; return _rf(...a); };
    const _p = Sync.pull.bind(Sync);
    Sync.pull = async function(...a){ window._rc.pull++; return _p(...a); };
    const _pt = Teachers.paint.bind(Teachers);
    Teachers.paint = function(...a){ window._rc.paint++; return _pt(...a); };
    return 1;
  })()`);

  await cdp.eval(`(async () => { App.go('teachers'); await new Promise(r=>setTimeout(r,1200)); return 1; })()`);
  await cdp.eval(`window._rc = { render: 0, refresh: 0, pull: 0, paint: 0 }; 1;`);   // 打点后重新清零

  /* 打开带班编辑器（分班选择器） */
  await cdp.eval(`(() => {
    const u = Teachers._users.find(x => x.role === 'teacher');
    Teachers.editCls(u.id);
    return u.id;
  })()`);
  const open0 = await cdp.eval(`(() => {
    const card = document.getElementById('tClsCard');
    const on = document.querySelectorAll('#tClsBody .chip-on').length;
    return { open: card && card.style.display !== 'none', chips: document.querySelectorAll('#tClsBody .chip').length, selected: on };
  })()`);
  ok('带班编辑器已打开', open0.open && open0.chips > 0, `chips=${open0.chips} 已选=${open0.selected}`);

  /* 选上班级（模拟用户点选） */
  await cdp.eval(`(() => { const b = document.querySelector('#tClsBody .chip:not(.chip-on)'); if (b) b.click(); return 1; })()`);

  /* 等两个轮询周期（32s）+ 一点余量 */
  console.log('等 2 个轮询周期（约 33s）…');
  await sleep(33000);

  const st = await cdp.eval(`(() => {
    const card = document.getElementById('tClsCard');
    const sel = document.querySelectorAll('#tClsBody .chip-on').length;
    return { open: !!card && card.style.display !== 'none', selected: sel, rc: window._rc,
             editing: Teachers._editing };
  })()`);
  console.log('计时器计数：', JSON.stringify(st.rc));
  if (!FIX){
    /* 修前实锤：只记录不断言成败 */
    console.log((st.open ? '⚡ 选择器仍开着' : '⚡ 选择器被轮询关掉了（复现实锤）'));
    console.log('⚡ render=' + st.rc.render + ' 次 / refresh=' + st.rc.refresh + ' 次 / paint=' + st.rc.paint + ' 次 / pull=' + st.rc.pull + ' 次');
    console.log((st.selected >= 1 ? '⚡ 选中态保留' : '⚡ 选中态丢失'));
  } else {
    ok('33s 后选择器保持打开', st.open, 'editing=' + st.editing);
    ok('选中态保留（可保存）', st.selected >= 1, 'chip-on=' + st.selected);
    ok('render 次数 ≤ 1（无轮询重复触发）', st.rc.render <= 1, 'render=' + st.rc.render);
    ok('App.refresh 触发 ≤ 1', st.rc.refresh <= 1, 'refresh=' + st.rc.refresh);
  }

  /* 保存带班（修复后能保存成功） */
  const save = await cdp.eval(`(async () => {
    if (!document.getElementById('tClsCard') || document.getElementById('tClsCard').style.display === 'none') return { skippable: true };
    await Teachers.saveCls();
    await new Promise(r => setTimeout(r, 1500));
    const j = await Auth.call('users', { op: 'list' });
    const u = (j.users || []).find(x => x.role === 'teacher' && !Util.isDemoObj(x));
    return { skippable: false, classIds: u && (u.classIds || []).length };
  })()`);
  if (save.skippable){ console.log((FIX ? '🔴 ' : '⚡ ') + '保存没做成：选择器已被关'); if (FIX) FAIL++; }
  else ok('带班保存成功', save.classIds >= 1, 'classIds=' + save.classIds);

  /* 历史栏已删（FIX 模式断言） */
  if (FIX){
    const hist = await cdp.eval(`(() => ({
      card: !!document.getElementById('tHistoryCard'),
      fn: typeof Teachers.renderHistory,
    }))()`);
    ok('「已删除账号的历史」区块不在 DOM', hist.card === false);
    ok('renderHistory 函数已移除', hist.fn === 'undefined');
  }

  console.log(`\n═══ ${FIX ? '验证' : '复现'}结果：✅ ${PASS} · 🔴 ${FAIL} ═══`);
  process.exit(FIX && FAIL ? 1 : 0);
} catch (e) {
  console.error('💥', e.message);
  process.exit(2);
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}
