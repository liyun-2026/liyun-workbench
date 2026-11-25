/**
 * ==5.71== 体重同步到学生端 · 回归
 *   node test/stu_weight_check.mjs [端口]
 * 守两件事：
 *   ① 服务端只把**本人**的体重发给学生（别人的一条都不能出去）
 *   ② 学生端「我的档案」能看（最近一次 + 曲线 + 历史），而且**只读**（没有录入框、没有删除键）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5471);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'stu');
const ACC = { user: '体重测试员', pass: 'weight12345' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
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

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
const chromes = []; const R = [];
const t = (n, ok, ex) => R.push({ n, ok: !!ok, ex });

async function launch(debugPort, w, h, mobile){
  const profile = await mkdtemp(path.join(tmpdir(), 'wt-chrome-'));
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  chromes.push(ch);
  const tgt = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口 ' + debugPort, tries: 40 });
  const cdp = await Cdp.connect(tgt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });
  if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}
async function go(cdp, url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url }); await loaded;
  await sleep(2300);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s){ s.style.opacity='0'; s.style.display='none'; } })()`);
}
async function login(cdp, user, pass){
  return cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(user)};
    document.getElementById('gPass').value = ${JSON.stringify(pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1900));
    return { gateOff: !document.getElementById('gate').classList.contains('on'),
             err: (document.getElementById('gErr') || {}).textContent || '',
             page: (document.querySelector('.page.on') || {}).id || '' };
  })()`);
}

try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  /* ── ① 教务：造班级 / 两个学员 / 两套体重 / 学生账号 ── */
  const staff = await launch(PORT + 1, 1600, 900, false);
  await go(staff, `${BASE}/?nosw=1`);
  const lg = await login(staff, '李老师', 'liyun2026');
  if (!lg.gateOff) throw new Error('教务登录失败：' + lg.err);

  const seed = await staff.eval(`(async () => {
    const cls = Store.upsert('classes', { name: '体重测试班' });
    const me  = Store.upsert('students', { classId: cls.id, name: '体重测试员' });
    const oth = Store.upsert('students', { classId: cls.id, name: '隔壁同学' });
    const add = (sid, date, value) => Store.upsert('weights', { studentId: sid, date, value });
    add(me.id, '2026-11-10', 54.2); add(me.id, '2026-11-14', 53.6);
    add(me.id, '2026-11-19', 53.1); add(me.id, '2026-11-24', 52.7);
    add(oth.id, '2026-11-24', 61.5);
    await Sync.push();
    const acc = await Auth.call('users', { op: 'create', user: ${JSON.stringify(ACC.user)},
      name: ${JSON.stringify(ACC.user)}, role: 'student', pass: ${JSON.stringify(ACC.pass)}, studentId: me.id });
    return { cls: cls.id, sid: me.id, oth: oth.id, push: 'ok', acc: JSON.stringify(acc).slice(0, 100) };
  })()`);
  t('教务这边体重记好了（4 条 + 别人的 1 条）', !!seed.sid, JSON.stringify(seed));

  /* 教务端仍可编辑（同一份 blockBody，canEdit=true 才有录入框和删除键） */
  const staffSide = await staff.eval(`(() => {
    const html = Weight.blockBody(${JSON.stringify(seed.sid)}, true);
    const ro = Weight.blockBody(${JSON.stringify(seed.sid)}, false);
    return { edit: html.indexOf('id="wVal"') >= 0 && html.indexOf('Weight.del(') >= 0,
             ro: ro.indexOf('id="wVal"') < 0 && ro.indexOf('Weight.del(') < 0 };
  })()`);
  t('教务端还是可编辑的（录入框 + 删除键都在）', staffSide.edit, JSON.stringify(staffSide));
  t('只读版确实没有任何写入口', staffSide.ro, JSON.stringify(staffSide));

  /* ── ② 学生：真登录、真拉数据 ── */
  const stu = await launch(PORT + 2, 390, 844, true);
  await go(stu, `${BASE}/?nosw=1`);
  const sl = await login(stu, ACC.user, ACC.pass);
  t('学生账号登得进去', sl.gateOff, sl.err || sl.page);
  t('落在「今日」页', sl.page === 'page-stuHome', sl.page);

  const pulled = await stu.eval(`(async () => {
    try { await Sync.pull(); } catch(e) {}
    const all = Store.list('weights');
    return { n: all.length, mine: all.filter(x => x.studentId === ${JSON.stringify(seed.sid)}).length,
             others: all.filter(x => x.studentId !== ${JSON.stringify(seed.sid)}).length,
             vals: all.map(x => x.value) };
  })()`);
  t('服务端只发了本人的体重（4 条，别人的 1 条没下来）',
    pulled.n === 4 && pulled.mine === 4 && pulled.others === 0, JSON.stringify(pulled));

  /* ── ③ 我的档案页：体重卡 ── */
  const view = await stu.eval(`(async () => {
    App.go('stuProfile');
    await new Promise(r => setTimeout(r, 900));
    StuProfile.render();
    await new Promise(r => setTimeout(r, 500));
    const box = document.getElementById('stuPfBody');
    const cards = [...box.querySelectorAll('.card')];
    const card = cards.find(c => (c.querySelector('h2') || {}).textContent && c.querySelector('h2').textContent.indexOf('体重') >= 0);
    if (!card) return { found: false, titles: cards.map(c => ((c.querySelector('h2') || {}).textContent || '').trim()) };
    return {
      found: true,
      hero: (card.querySelector('.hero') || {}).textContent || '',
      rows: card.querySelectorAll('.item').length,
      curve: !!card.querySelector('polyline'),
      hasInput: !!card.querySelector('#wVal'),
      hasDel: card.querySelectorAll('.del').length,
      inputs: card.querySelectorAll('input').length,
      h: Math.round(card.getBoundingClientRect().height),
    };
  })()`);
  t('我的档案里有「体重」卡', view.found, JSON.stringify(view.titles || ''));
  t('最近一次体重显示 52.7 kg', /52\.7/.test(view.hero || ''), view.hero);
  t('曲线画出来了（4 个点连成线）', view.curve, String(view.curve));
  t('历史列表 4 条', view.rows === 4, String(view.rows));
  t('学生端只读：没有录入框、没有删除键', !view.hasInput && view.hasDel === 0 && view.inputs === 0,
    JSON.stringify({ hasInput: view.hasInput, del: view.hasDel, inputs: view.inputs }));

  /* ── 截图：体重卡 ── */
  await stu.eval(`(() => {
    const main = document.getElementById('main');
    const el = document.getElementById('stuPfBody');
    if (main) main.scrollTop = 0;
    const cards = [...el.querySelectorAll('.card')];
    const c = cards.find(x => (x.querySelector('h2') || {}).textContent && x.querySelector('h2').textContent.indexOf('体重') >= 0);
    if (c) c.scrollIntoView({ block: 'start' });
  })()`);
  await sleep(600);
  const rect = await stu.eval(`(() => {
    const el = document.getElementById('stuPfBody');
    const cards = [...el.querySelectorAll('.card')];
    const c = cards.find(x => (x.querySelector('h2') || {}).textContent && x.querySelector('h2').textContent.indexOf('体重') >= 0);
    const b = c.getBoundingClientRect();
    return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height };
  })()`);
  const res = await stu.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: Math.max(0, rect.x - 8), y: Math.max(0, rect.y - 8), width: rect.w + 16, height: rect.h + 16, scale: 1 } });
  await writeFile(path.join(OUT, 'stu_weight_card.png'), Buffer.from(res.data, 'base64'));
  console.log('  📸 stu_weight_card.png');
} finally {
  for (const c of chromes) { try { c.kill('SIGKILL'); } catch {} }
  try { server.kill('SIGKILL'); } catch {}
}
const bad = R.filter(x => !x.ok);
R.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok || !x.ex ? '' : '   → ' + x.ex)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length}` : `✅ 全部通过（${R.length} 项）`));
if (bad.length) process.exitCode = 1;
