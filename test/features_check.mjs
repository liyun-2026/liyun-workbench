/**
 * 本轮改动端到端验收（真 Chrome，双实例模拟两台设备）：
 *   1. 作业多选班级布置（修：切班失效全变 5 班）
 *   2. 量化班级切换不再卡死
 *   3. 老师管理：建号后出现「复制发给TA」，文案含称呼/地址/用户名/初始密码
 *   4. 教务发通知 → 老师端「今天」红点；老师上报 → 教务端「协作」红点
 *   5. 老师上报说调课 → 弹出本周空闲时段可选，选中后连同通知发出
 *   6. 自动同步：老师端发的工单，教务端开着页面不动，15 秒内自己冒出来
 *
 *   node test/features_check.mjs [端口]
 *
 * 全程一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5211);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ADMIN = { user: '__selftest__', pass: 'selftest-pass-123' };
const TEACH = { user: '__selftea__', pass: 'selftea-pass-456' };
const CLS1 = 'c_test_1', CLS2 = 'c_test_5';
const T_UID_KEY = '__tUid';

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
      // ⚠️ 必须自带超时：Chrome 没起来时 WS 握手会一直挂着，
      //    既不会 open 也不会 error，脚本就永远停在那一行（曾卡 14 分钟无输出）
      const t = setTimeout(() => rej(new Error('CDP 接管超时（5s）：' + url)), 5000);
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
let cdpA, cdpB;

async function openChrome(cdpPort) {
  const profile = await mkdtemp(path.join(tmpdir(), 'feat-chrome-'));
  profiles.push(profile);
  const chrome = spawn(CHROME, [
    // ⚠️ --no-sandbox 不能省：Chrome 自带的沙箱在宿主沙箱里起不来
    //    （"sandbox initialization failed: Operation not permitted"），
    //    进程会秒退，CDP 端口永远等不到 → 脚本静默卡死在登录那一步
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
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
}

async function devReset() {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
}

try {
  console.log('\n【1/7】起本地预览服务（真 sync.js）…');
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  await devReset();
  console.log(`  服务就绪 → ${BASE}`);

  console.log('\n【2/7】设备A：教务登录 + 建基础数据…');
  cdpA = await openChrome(9341);
  await login(cdpA, ADMIN);

  const setup = await cdpA.eval(`(async () => {
    const up = (k, v) => Store.upsert(k, v);
    up('classes', { id: '${CLS1}', name: '1班' });
    up('classes', { id: '${CLS2}', name: '5班' });
    [['p1','早功','06:30','07:30'],['p2','第1节','08:00','09:40'],['p3','第2节','10:00','11:40'],['p4','第3节','14:00','15:40']]
      .forEach(([id, name, start, end]) => up('periods', { id, name, start, end }));
    // 建老师账号（真走服务端），并按 Teachers.create 的真实行为存好欢迎文案
    const j = await Auth.call('users', { op: 'create', user: '${TEACH.user}', name: '测试老师', role: 'teacher', pass: '${TEACH.pass}' });
    Store.setSecret('${T_UID_KEY}', j.id);
    Store.setSecret('greet:' + j.id, Teachers.greet('测试老师', '${TEACH.user}', '${TEACH.pass}'));
    await Auth.call('users', { op: 'update', id: j.id, classIds: ['${CLS1}', '${CLS2}'] });
    // 课表：老师周三第1节、周四第2节有课，其余时段空闲
    up('schedule', { id: 's1', day: '周三', periodId: 'p2', title: '播音大课', cls: '1班', kind: 'big', teacherId: j.id });
    up('schedule', { id: 's2', day: '周四', periodId: 'p3', title: '小课', cls: '5班', kind: 'small', teacherId: j.id });
    return { tUid: j.id };
  })()`);
  ok(!!setup.tUid, '教务登录成功，班级/节次/课表/老师账号就绪（老师 id 已拿到）');

  console.log('\n【3/7】作业多选班级布置…');
  const hw = await cdpA.eval(`(async () => {
    App.go('homework');
    await new Promise(r => setTimeout(r, 300));
    const chips = [...document.querySelectorAll('#hwClsPick .chip')];
    if (chips.length < 3) return { err: '班级 chips 没渲染出来：' + chips.length };
    // 每次点击都重新查节点（pick 后 chips 会重建，拿旧节点点不上）
    const clickCls = t => [...document.querySelectorAll('#hwClsPick .chip')]
      .find(c => c.textContent.trim() === t).click();
    clickCls('5班');                        // 默认全选 → 取消 5班
    await new Promise(r => setTimeout(r, 100));
    clickCls('5班');                        // 再勾回来 → 两个班都选中
    await new Promise(r => setTimeout(r, 100));
    document.getElementById('hwText').value = '即兴评述练习《AI与主持》';
    Homework.add();
    await new Promise(r => setTimeout(r, 300));
    const all = Store.list('homework');
    const mine = all.filter(h => h.text.includes('即兴评述'));
    return { count: mine.length, clsIds: mine.map(h => h.clsId).sort(),
             bodyHas: document.getElementById('hwBody').textContent.includes('即兴评述') };
  })()`);
  if (hw.err) ok(false, hw.err); else {
    ok(hw.count === 2, `一次布置落到 2 个班（实际 ${hw.count} 条）`);
    ok(hw.clsIds.join(',') === [CLS1, CLS2].sort().join(','), '两个班的作业内容一致、班级 id 正确');
    ok(hw.bodyHas, '作业列表渲染出了新作业');
  }

  console.log('\n【4/7】量化班级切换…');
  const qt = await cdpA.eval(`(async () => {
    App.go('quant');
    await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('qCls');
    const before = sel.value;
    sel.value = '${CLS2}';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 300));
    const sel2 = document.getElementById('qCls');
    return { before, after: sel2.value, mem: Store.get('_qCls'),
             card: (document.getElementById('qScoreCard').textContent || '').includes('5班') };
  })()`);
  ok(qt.before !== qt.after, `切班真的切过去了（${qt.before?.slice(0,6)}… → ${qt.after?.slice(0,6)}…）`);
  ok(qt.mem === CLS2, '选择被记住（不再弹回）');
  ok(qt.card, '总分卡显示的是切换后的班（5班）');

  console.log('\n【5/7】老师管理：复制文案…');
  const tg = await cdpA.eval(`(async () => {
    App.go('teachers');
    await new Promise(r => setTimeout(r, 1200));
    const btn = document.querySelector('#tList .chip-on');
    const t = (Teachers._users || []).find(u => u.user === '${TEACH.user}');
    const greet = t ? Store.getSecret('greet:' + t.id) : '';
    return { hasBtn: !!btn, btnText: btn ? btn.textContent.trim() : '',
             greet: greet || '' };
  })()`);
  ok(tg.hasBtn, `账号列表出现「${tg.btnText}」按钮`);
  ok(/尊敬的/.test(tg.greet) && tg.greet.includes(TEACH.user) && tg.greet.includes(TEACH.pass) && tg.greet.includes('liyun2026.top'),
    '文案含「尊敬的…老师」+ 登录地址 + 用户名 + 初始密码');

  console.log('\n【6/7】教务发通知；设备B：老师登录验收红点与调课…');
  await cdpA.eval(`(async () => {
    App.go('coop');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('noticeText').value = '明天早功提前到 6 点，大家准时';
    Coop.addNotice();
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);
  ok(true, '教务发出一条通知');

  cdpB = await openChrome(9342);
  await login(cdpB, TEACH);
  await waitFor(async () => {
    // 教务端推送有 4 秒防抖，这里主动拉几次对齐（自动轮询本身在第 7 步单独验）
    return cdpB.eval(`(async () => { await Sync.pull(); return Store.list('notices').length; })()`);
  }, { what: '老师端拉到通知', tries: 20 });

  const dotT = await cdpB.eval(`(async () => {
    Store.set('_noticeReadAt', 1);          // 模拟「还没看过」
    App.refreshDots();
    await new Promise(r => setTimeout(r, 100));
    const on = document.querySelector('#nav button[data-id="today"]').classList.contains('has-dot')
           || document.querySelector('#tabs button[data-id="today"]')?.classList.contains('has-dot');
    App.go('today');
    await new Promise(r => setTimeout(r, 300));
    const off = !document.querySelector('#nav button[data-id="today"]').classList.contains('has-dot');
    const noticeShown = document.getElementById('tdNotice').textContent.includes('早功');
    return { on, off, noticeShown };
  })()`);
  ok(dotT.on, '有新通知 → 老师端「今天」入口亮红点');
  ok(dotT.off, '看完「今天」→ 红点灭');
  ok(dotT.noticeShown, '通知内容在「今天」页展示');

  const tk = await cdpB.eval(`(async () => {
    App.go('tickets');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('tkText').value = '周三第1节想调课，另一位老师时间冲突';
    Ticket.send();                            // 第一次点：应该先弹时段选择，不直接发
    await new Promise(r => setTimeout(r, 300));
    const panelOn = document.getElementById('tkSlots').style.display !== 'none';
    const nChips = document.querySelectorAll('#tkSlotChips .chip').length;
    const chipTexts = [...document.querySelectorAll('#tkSlotChips .chip')].map(c => c.textContent.trim());
    const before = Store.list('tickets').length;
    const first = document.querySelector('#tkSlotChips .chip');
    first.click();
    Ticket.send(true);                        // 带上时段发出
    await new Promise(r => setTimeout(r, 300));
    const list = Store.list('tickets');
    const sent = list.find(t => (t.text || '').includes('希望调到'));
    return { panelOn, nChips, sample: chipTexts.slice(0, 3), before, after: list.length,
             picked: sent ? (sent.text.match(/希望调到：([^）]+)/) || [])[1] : '',
             busyLeak: chipTexts.some(t => t.includes('周三') && t.includes('第1节')) };
  })()`);
  ok(tk.panelOn, '检测到「调课」→ 弹出空闲时段面板（没有直接发出）');
  ok(tk.nChips > 0 && !tk.busyLeak, `推荐的都是没课时段（${tk.nChips} 个，如「${(tk.sample[0] || '').slice(0, 18)}」），已占用时段不出现`);
  ok(tk.after === tk.before + 1, '带上时段发出，工单只发了一条');
  ok(!!tk.picked, `通知里带上所选时段：「希望调到：${tk.picked}」`);

  await cdpB.eval(`(async () => {
    // 老师再发一条普通上报；随后模拟教务回复 → 「上报与申请」应亮红点，看完灭
    document.getElementById('tkType').value = '请假上报';
    document.getElementById('tkText').value = '2班李同学明天请假';
    Ticket.send();
    await new Promise(r => setTimeout(r, 200));
    const t = Store.list('tickets').find(x => (x.text || '').includes('请假'));
    Store.upsert('tickets', Object.assign({}, t, { status: 'done', reply: '知道了，已记录', repliedAt: Date.now() }));
    Store.set('_tkReadAt', 1);
    App.refreshDots();
    await new Promise(r => setTimeout(r, 100));
    window.__dotOn = document.querySelector('#nav button[data-id="tickets"]').classList.contains('has-dot')
      || document.querySelector('#tabs button[data-id="tickets"]')?.classList.contains('has-dot');
    App.go('tickets');   // 真实流程：用户点进「上报与申请」→ 看过即消点
    await new Promise(r => setTimeout(r, 100));
    window.__dotOff = !document.querySelector('#nav button[data-id="tickets"]').classList.contains('has-dot');
  })()`);
  const dotTk = await cdpB.eval(`({ on: window.__dotOn, off: window.__dotOff })`);
  ok(dotTk.on, '教务回复了 → 老师端「上报与申请」亮红点');
  ok(dotTk.off, '老师看过回复 → 红点灭');
  await cdpB.eval(`Sync.push()`);   // 工单是 4 秒防抖推送，关浏览器前确保推上去
  await sleep(1500);
  cdpB.ws.close(); cdpB = null;
  chromes[1].kill('SIGKILL');

  console.log('\n【7/7】自动同步：教务端开着不动，老师的工单自己冒出来…');
  const got = await waitFor(async () => {
    const r = await cdpA.eval(`({
      n: Store.list('tickets').length,
      dot: document.querySelector('#nav button[data-id="coop"]')?.classList.contains('has-dot')
        || document.querySelector('#tabs button[data-id="coop"]')?.classList.contains('has-dot') || false,
      count: (document.getElementById('coopCount') || {}).textContent || ''
    })`);
    return r.n >= 2 ? r : null;
  }, { tries: 50, gap: 1000, what: '教务端 15 秒轮询拉到老师工单' });
  ok(got.n >= 2, `教务端没刷新页面，工单自己同步进来了（共 ${got.n} 条）`);
  ok(got.dot, `「协作」入口亮红点${got.count ? '（' + got.count.trim() + '）' : ''}`);
  ok(got.count.includes('2'), '协作页头部显示「2 条待处理」');

  console.log(failed ? `\n❌ 有 ${failed} 项没过\n` : '\n✅ 本轮八项改动全部通过\n');
} catch (e) {
  console.error('\n💥 测试中断：' + (e && e.stack || e) + '\n');
  failed++;
} finally {
  try { cdpA?.ws.close(); } catch {}
  try { cdpB?.ws.close(); } catch {}
  chromes.forEach(c => c.kill('SIGKILL'));
  server?.kill('SIGKILL');
  await devReset();   // 清掉一次性账号
  for (const p of profiles) await rm(p, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
