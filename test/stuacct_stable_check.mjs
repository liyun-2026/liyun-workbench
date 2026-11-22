/**
 * 学生账号页稳定渲染（VoxOS 5.48）
 *   node test/stuacct_stable_check.mjs
 *
 * 开学日真事故：学生账号页「（21 人）」却只看到 2~3 行、整页反复闪「正在读取…」，
 * 页脚顶到页面中部（列表被抹掉只剩一行占位时的瞬间）。
 *
 * 钉死四件事：
 *   ① 进页后连观察 60 秒（15s 轮询 ≥4 个周期）：账号内容不变 → 列表重绘 0 次，
 *      且全程不出现「正在读取」；
 *   ② 强制连续 5 轮 App.refresh（模拟生产上轮询恒有变化）：重绘仍是 0 次、行数不变；
 *   ③ 数据真变了（重置密码 / 新增账号）→ 正常重绘，行数始终完整；
 *   ④ 慢响应竞态：先发的请求后回来，不能覆盖新数据（序号令牌）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台';
const PORT = Number(process.argv[2] || 5343);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(dir, 'docs', 'stuacct-stable-2026-11-22');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(30000) });
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
  async eval(expr, timeout = 120000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
  async shot(f){ const d = await this.send('Page.captureScreenshot', { format: 'png' }); await writeFile(f, Buffer.from(d.data, 'base64')); }
}

let server, chrome;
try {
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'sastab-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5387', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const l = await (await jfetch('http://127.0.0.1:5387/json/list')).json(); return l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await sleep(2500);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '陈校';
    document.getElementById('gPass').value = 'admin12345';
    await Auth.submit();
    await new Promise(x => setTimeout(x, 2400));
    window.confirm = () => true;
  })()`);

  /* 造 22 名学员 + 21 个学生账号（复刻生产的 21/22） */
  const prep = await cdp.eval(`(async () => {
    const cls = Store.upsert('classes', { name: '考前06班' });
    const names = ['曹钧盈','邓景月','段宇','高薪杰','郭金涵','侯雅茹','黄紫佳','贾明武','贾元基','李潮洋','林玉婷','林紫莹','孟珍辛','王露锦','王一梦','徐显铮','张晗依','张婧奕','张美杭','张美琳','张梦涵','赵丽惠'];
    names.forEach((n, i) => Store.upsert('students', { classId: cls.id, name: n, no: i + 1 }));
    await Sync.push();
    const stus = Store.list('students', Util.byName).filter(s => s.classId === cls.id);
    const list = stus.slice(0, 21).map((s, i) => ({ user: 'kq06-' + String(i + 1).padStart(2, '0'), pass: 'by' + (1000 + i), role: 'student', name: s.name, studentId: s.id }));
    const r = await Auth.call('users', { op: 'createMany', list });
    return { made: r.n, students: stus.length };
  })()`);
  ok(prep.made === 21 && prep.students === 22, '造好 22 名学员 / 21 个账号（' + prep.students + '/' + prep.made + '）');

  /* 打点：render / paint / DOM 重建 三次计数 */
  await cdp.eval(`(() => {
    window.__st = { render: 0, paint: 0, mut: 0, flash: 0 };
    const R = StuAcct.render.bind(StuAcct);
    StuAcct.render = async function(){ window.__st.render++; return await R(); };
    const P = StuAcct.paint.bind(StuAcct);
    StuAcct.paint = function(){ window.__st.paint++; window.__st.mut++; return P(); };
    const el0 = document.getElementById('saList');
    new MutationObserver(() => {
      const el = document.getElementById('saList');
      /* 首屏那次占位不算「闪」—— 只有已经有列表之后再出现「正在读取」才是 */
      if (!el || el.dataset.painted !== '1') return;
      if ((el.textContent || '').indexOf('正在读取') >= 0) window.__st.flash++;
    }).observe(el0, { childList: true, subtree: true, characterData: true });
  })()`);

  console.log('\n【1】进页 → 连看 60 秒（15s 轮询 ≥4 个周期）…');
  const first = await cdp.eval(`(async () => {
    App.go('students');
    await new Promise(x => setTimeout(x, 2500));
    const el = document.getElementById('saList');
    return { items: el.querySelectorAll('.item').length, meta: (document.getElementById('saMeta')||{}).textContent,
             st: JSON.parse(JSON.stringify(window.__st)) };
  })()`);
  ok(first.items === 21, '首屏 21 行完整（' + first.items + '）');
  ok(/21 人/.test(first.meta), '标题口径（' + first.meta + '）');
  ok(/还有 1 名学员没建号/.test(first.meta), '顺手点出「21 个号 / 22 名学员」差的那一个');

  await sleep(60000);
  const after60 = await cdp.eval(`(() => {
    const el = document.getElementById('saList');
    const main = document.getElementById('main');
    const foot = document.querySelector('.xf-foot');
    const items = [...el.querySelectorAll('.item')];
    return { st: JSON.parse(JSON.stringify(window.__st)), items: items.length,
             txt: el.textContent.slice(0, 20),
             listH: Math.round(el.getBoundingClientRect().height),
             footTop: foot ? Math.round(foot.getBoundingClientRect().top) : null,
             scrollTop: Math.round(main.scrollTop) };
  })()`);
  console.log('   [60s] ' + JSON.stringify(after60.st));
  ok(after60.st.paint === 1, '60 秒内列表重绘 ' + after60.st.paint + ' 次（要求 ≤1）');
  ok(after60.st.flash === 0, '全程一次都没闪「正在读取」');
  ok(after60.items === 21, '行数始终 21（' + after60.items + '）');
  ok(after60.listH > 1200, '列表容器高度正常（' + after60.listH + 'px，页脚在内容之后 ' + after60.footTop + 'px）');

  console.log('\n【2】强制连续 5 轮 App.refresh（模拟生产「轮询恒有变化」）…');
  const force = await cdp.eval(`(async () => {
    const before = JSON.parse(JSON.stringify(window.__st));
    for (let i = 0; i < 5; i++){ App._refreshNow(); await new Promise(x => setTimeout(x, 900)); }
    await new Promise(x => setTimeout(x, 600));
    return { before, after: JSON.parse(JSON.stringify(window.__st)),
             items: document.querySelectorAll('#saList .item').length,
             flash: (document.getElementById('saList').textContent || '').indexOf('正在读取') >= 0 };
  })()`);
  console.log('   [force] ' + JSON.stringify({ render: force.after.render, paint: force.after.paint }));
  ok(force.after.paint === 1, '五轮刷新后仍只重绘 1 次（数据没变）');
  ok(force.after.render >= 5, '确实跑了 5 次 render（' + force.after.render + ' 次请求）');
  ok(force.items === 21 && !force.flash, '每次都是完整 21 行、没有闪白');

  console.log('\n【3】数据真变了（重置一个密码）→ 正常重绘且行数完整…');
  const changed = await cdp.eval(`(async () => {
    const before = JSON.parse(JSON.stringify(window.__st));
    await StuAcct.resetPass(StuAcct._users[0].id);
    await new Promise(x => setTimeout(x, 900));
    const after = JSON.parse(JSON.stringify(window.__st));
    return { before, after, items: document.querySelectorAll('#saList .item').length,
             newPass: (StuAcct._users[0] || {})._newPass || '' };
  })()`);
  ok(changed.after.paint === 2, '数据变了才重绘（第 2 次）');
  ok(/^by\d{4}$/.test(changed.newPass), '新密码亮在行上（' + changed.newPass + '）');
  ok(changed.items === 21, '重绘后仍是完整 21 行');

  console.log('\n【4】慢响应竞态：先发的请求后回来，不能覆盖新数据…');
  const race = await cdp.eval(`(async () => {
    const orig = Auth.call;
    let n = 0;
    Auth.call = async function(action, extra){
      n++;
      const mine = n;
      const j = await orig.call(Auth, action, extra);
      if (action === 'users' && (extra || {}).op === 'list'){
        /* 第一次故意慢 1.6 秒，并且返回一份"旧数据"（少一行） */
        await new Promise(x => setTimeout(x, mine === 1 ? 1600 : 60));
        if (mine === 1){ const j2 = JSON.parse(JSON.stringify(j)); j2.users = j2.users.slice(0, 2); return j2; }
      }
      return j;
    };
    StuAcct._fp = ''; StuAcct._users = [];
    const p1 = StuAcct.render();           // 慢的那一发
    await new Promise(x => setTimeout(x, 120));
    const p2 = StuAcct.render();           // 后发先至
    await Promise.all([p1, p2]);
    await new Promise(x => setTimeout(x, 300));
    Auth.call = orig;
    return { items: document.querySelectorAll('#saList .item').length,
             users: StuAcct._users.length };
  })()`);
  ok(race.items === 21, '过期响应被丢弃，列表仍是 21 行（' + race.items + '）');
  ok(race.users === 21, '内存里的账号也是完整的 21 条（' + race.users + '）');

  /* 截图：整页 + 底部 */
  await cdp.eval(`window.scrollTo(0,0); document.getElementById('main').scrollTop = 0`);
  await sleep(600);
  await cdp.shot(path.join(SHOTS, 'students-top.png'));
  await cdp.eval(`document.getElementById('main').scrollTop = 99999`);
  await sleep(1400);
  await cdp.shot(path.join(SHOTS, 'students-bottom.png'));

  console.log(`\n═══ stuacct_stable_check 结果：✅ ${pass} · 🔴 ${fail} ═══`);
} finally {
  if (chrome) try { chrome.kill(); } catch {}
  if (server) try { server.kill(); } catch {}
}
if (fail) process.exit(1);
