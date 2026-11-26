/**
 * ==5.75== 班委登记 → 教务端「今日检查」看得见（真 Chrome 验页面）
 *   node test/hw_merge_check.mjs [端口]
 *
 * 主理人 2026-11-26：「晚上班委统计完当晚作业，我这边还是空白，没有统计的痕迹」。
 * 根因是同一件事两本账：
 *   教务在「今日检查」逐人点 → hwchk:{日期}
 *   班委在学生端按作业逐人点 → hw:{作业id}
 * 以前「今日检查」只读 hwchk:，班委登记得再全也是空白。
 *
 * 这里在真页面上验三件事：
 *   ① 只有班委那本账时，「今日检查」出数、还标了来源
 *   ② 教务点一下，两本账同时写（作业列表的「已交 N」也跟着动）
 *   ③ 账号没挂学籍的学生，作业页给出可执行的提示，而不是整块消失
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5488);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'hwmerge');
const ADMIN = { user: '作业合并检查教务', pass: 'mergepass123' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch { /* 等 */ } await sleep(gap); }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 接管超时')), 5000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP 连不上')); };
    });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach((f) => f(m.params));
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method) { return new Promise((res) => { const set = this.events.get(method) || new Set(); const fn = (p) => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let failed = 0, total = 0;
const ok = (c, m, extra) => { total++; if (!c) failed++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || !extra ? '' : '\n        → ' + extra)); };
const section = (t) => console.log('\n' + t);

let server, chrome;
const profiles = [];
async function go(cdp, url) { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(500); }

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], {
    cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' },
  });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}',
  })).ok, { what: 'dev-server', tries: 60 });
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const DBG = 9463;
  const profile = await mkdtemp(path.join(tmpdir(), 'hwmerge-'));
  profiles.push(profile);
  chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(cdp, `${BASE}/?nosw=1`);

  section('▶ 0. 登录（首位教务）');
  const r0 = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ADMIN.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ADMIN.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, mode: Auth.mode };
  })()`);
  if (!r0.gateOff) throw new Error('登录失败：' + (r0.err || ''));
  ok(true, '已登录（' + r0.mode + '）');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '' });

  section('▶ 1. 造数据：一个班 5 人 / 今晚一条作业 / 只有班委那本账');
  const seeded = await cdp.eval(`(() => {
    const d = Util.today();
    const cls = Store.upsert('classes', { id: null, name: '合并测试班' });
    const s = [];
    for (let i = 1; i <= 5; i++) s.push(Store.upsert('students', { id: null, name: '学员' + i, classId: cls.id, ord: i }));
    const hw = Store.upsert('homework', { clsId: cls.id, date: d, text: '普通话声母练习', abbr: '普' });
    /* 班委在学生端登记的结果（服务端会盖 by） */
    Store.upsert('hw:' + hw.id, { id: 'r2', studentId: s[1].id, done: 1, by: '学习委员甲' });
    Store.upsert('hw:' + hw.id, { id: 'r3', studentId: s[2].id, done: 0, by: '学习委员甲' });
    /* 教务一个都没点过 —— hwchk: 这一本是空的 */
    return { cls: cls.id, hw: hw.id, date: d, ids: s.map(x => x.id) };
  })()`);
  ok(seeded.ids.length === 5, '5 名学员 / 1 条今晚作业已就位', JSON.stringify(seeded).slice(0, 140));

  section('▶ 2. 教务打开「今日检查」：只有班委登记过，会不会出数');
  const r2 = await cdp.eval(`(() => {
    Store.set('_hkCls', ${JSON.stringify(seeded.cls)});
    Store.set('_hkDate', ${JSON.stringify(seeded.date)});
    App.go('homework');
    Homework.renderChk();
    const box = document.getElementById('hkBody');
    const txt = box ? box.innerText.replace(/\\s+/g, ' ') : '';
    return {
      txt: txt.slice(0, 400),
      pct: document.getElementById('hkPct') ? document.getElementById('hkPct').textContent : '',
      done: document.getElementById('hkDone') ? document.getElementById('hkDone').textContent : '',
      miss: document.getElementById('hkAll') ? document.getElementById('hkAll').textContent : '',
      hasOfficerMark: /班委/.test(txt),
      hasFromNote: /来自班委登记/.test(txt),
    };
  })()`);
  ok(/未交 /.test(r2.txt) && /未登记/.test(r2.txt), '「今日检查」渲染出来了', r2.txt.slice(0, 160));
  ok(r2.txt.includes('未交 1'), '班委记的「未交 1 人」被算进来了（这就是以前空白的地方）', r2.txt);
  ok(r2.done === '1', '已交人数 = 1（教务自己一个都没点过）', '已交 = ' + r2.done);
  ok(r2.hasOfficerMark, '名单上标了「班委」来源', r2.txt.slice(0, 200));
  ok(r2.hasFromNote, '顶部说明了「N 人来自班委登记」', r2.txt.slice(0, 200));

  section('▶ 3. 教务点一下「已交」：两本账要同时写');
  const r3 = await cdp.eval(`(() => {
    const sid = ${JSON.stringify(seeded.ids[3])};
    Homework.markChk(sid, 1);
    const d = ${JSON.stringify(seeded.date)};
    const a = Store.list('hwchk:' + d).find(x => x.studentId === sid);
    const b = Store.list('hw:' + ${JSON.stringify(seeded.hw)}).find(x => x.studentId === sid);
    const listTxt = document.getElementById('hwBody') ? document.getElementById('hwBody').innerText.replace(/\\s+/g, ' ') : '';
    return { a: a ? a.done : null, b: b ? b.done : null, listTxt: listTxt.slice(0, 200) };
  })()`);
  ok(r3.a === 1, 'hwchk: 这本写上了', 'hwchk = ' + r3.a);
  ok(r3.b === 1, 'hw: 这本也写上了（班委端和「已布置」列表靠它）', 'hw: = ' + r3.b);
  ok(/已交 2/.test(r3.listTxt), '「已布置」列表的已交数字跟着动了', r3.listTxt);

  section('▶ 4. 账号没挂学籍的学生：作业页要明说原因，不能整块消失');
  const r4 = await cdp.eval(`(() => {
    const card = document.getElementById('stuHwEntryCard');
    const box = document.getElementById('stuHwEntry');
    const realSid = Auth._me ? Auth._me.studentId : '';
    /* 模拟「账号的 studentId 指向一条已经不存在的档案」 */
    if (Auth._me) Auth._me.studentId = 'gid_已经删掉的旧档案';
    StuHw.renderEntry();
    const t = box ? box.innerText.replace(/\\s+/g, ' ') : '';
    const visible = card ? card.style.display !== 'none' : false;
    if (Auth._me) Auth._me.studentId = realSid;
    return { t: t.slice(0, 300), visible };
  })()`);
  ok(r4.visible, '提示卡是显示出来的（不是 display:none）', JSON.stringify(r4).slice(0, 200));
  ok(/还没和名册里的学籍对上/.test(r4.t), '写清了「账号没跟学籍对上」', r4.t);
  ok(/补挂|一键为学生建账号/.test(r4.t), '给出了可执行的下一步（找教务补挂）', r4.t);
  section('▶ 5. 前两天班委的登记要并进来，教务点过的不能被覆盖');
  const r5 = await cdp.eval(`(() => {
    const dayStr = (off) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-off);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const y = dayStr(2);
    /* 前天的作业 + 班委前天的登记（只有 hw: 那本，没有 hwchk:） */
    const hw = Store.upsert('homework', { clsId: ${JSON.stringify(seeded.cls)}, date: y, text: '前天气息练习', abbr: '气息' });
    Store.upsert('hw:' + hw.id, { id: 'y1', studentId: ${JSON.stringify(seeded.ids[0])}, done: 1, by: '学习委员甲' });
    Store.upsert('hw:' + hw.id, { id: 'y2', studentId: ${JSON.stringify(seeded.ids[1])}, done: 0, by: '学习委员甲' });
    /* 教务昨天自己点过一条 —— 它必须原样留着 */
    const ystr = dayStr(1);
    const hw2 = Store.upsert('homework', { clsId: ${JSON.stringify(seeded.cls)}, date: ystr, text: '昨天绕口令', abbr: '绕口' });
    Store.upsert('hwchk:' + ystr, { id: 'mine', studentId: ${JSON.stringify(seeded.ids[0])}, classId: ${JSON.stringify(seeded.cls)}, date: ystr, done: 1, by: '', src: '' });
    Store.upsert('hw:' + hw2.id, { id: 'z1', studentId: ${JSON.stringify(seeded.ids[0])}, done: 0, by: '学习委员甲' });
    const n = Homework.mergeOfficerIntoChk(7);
    const got = Store.list('hwchk:' + y);
    const mine = Store.list('hwchk:' + ystr).find(x => x.studentId === ${JSON.stringify(seeded.ids[0])});
    return {
      n, y,
      cnt: got.length,
      s1: (got.find(x => x.studentId === ${JSON.stringify(seeded.ids[0])}) || {}),
      s2: (got.find(x => x.studentId === ${JSON.stringify(seeded.ids[1])}) || {}),
      mineDone: mine ? mine.done : null,
      mineBy: mine ? (mine.by || '') : '',
      mineSrc: mine ? (mine.src || '') : '',
    };
  })()`);
  ok(r5.n >= 2, '回填出结果（前天 2 条 + 昨天班委那条）', 'n = ' + r5.n);
  ok(r5.cnt >= 2, '前天的登记已经落进 hwchk:', JSON.stringify(r5).slice(0, 200));
  ok(r5.s1.done === 1 && r5.s1.src === 'officer', '前天「已交」并进来了，且标了来源', JSON.stringify(r5.s1));
  ok(r5.s2.done === 0 && r5.s2.src === 'officer', '前天「未交」并进来了', JSON.stringify(r5.s2));
  ok(r5.mineDone === 1 && r5.mineBy === '' && r5.mineSrc === '',
     '教务昨天自己点的那条**没被班委的「未交」覆盖**', JSON.stringify({ done: r5.mineDone, by: r5.mineBy, src: r5.mineSrc }));

  section('▶ 6. 回填是幂等的：再跑一次不该重复增加');
  const r6 = await cdp.eval(`(() => {
    const before = Store.list('hwchk:' + ${JSON.stringify(r5.y)}).length;
    const n2 = Homework.mergeOfficerIntoChk(7);
    const after = Store.list('hwchk:' + ${JSON.stringify(r5.y)}).length;
    return { before, after, n2 };
  })()`);
  ok(r6.after === r6.before, '重复跑不会把同一个学生记两遍', JSON.stringify(r6));

} catch (e) {
  console.log('\n❌ 脚本中断：' + (e && e.message));
  failed++;
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}

console.log('\n' + '─'.repeat(40));
console.log(failed ? `❌ 失败 ${failed} / ${total} 项` : `✅ 全部通过（${total} 项）`);
if (failed) process.exitCode = 1;
