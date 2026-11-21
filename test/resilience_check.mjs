/**
 * VoxOS 5.40 平台劣化韧性验收 —— 重试链 / 缓存兜底 / 云端暂忙友好态
 *   node test/resilience_check.mjs
 *
 * dev-server + CDP 网络条件模拟（Network.emulateNetworkConditions / Fetch 拦截）：
 *   【1】重试链：前两次 504、第三次放行 → Auth.call 自动重试成功，
 *        「连接中…（第 n 次）」细条亮过、成败都撤
 *   【2】业务错误不重试：错密码 401 立即返回，细条全程不亮
 *   【3】缓存兜底：断网 → pull 失败 → 底部金条「云端同步暂缓 · 显示 HH:MM 的本地数据」，
 *        名册/今日/看板照常渲染（绝不白屏），其他功能照常可点
 *   【4】恢复自动续传：网络恢复 → 15s 轮询或手动 pull → 金条自动撤
 *   【5】系统工作号区块：断网下读列表 → 「云端暂忙 · 点击重试」按钮；恢复后点击 → 正常
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5377);
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
}
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }

let server, chrome;
try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  const profile = await mkdtemp(path.join(tmpdir(), 'resil-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5378', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5378/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(1200);

  console.log('\n【0】super 登录 + 种子（缓存兜底要有本地数据可用）…');
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '测试教务';
    document.getElementById('gPass').value = 'shotpass123';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    const c = Store.upsert('classes', { name: '砺蕴一班' });
    ['王小明','李思远'].forEach(n => Store.upsert('students', { classId: c.id, name: n }));
    try { await Sync.pull(true); } catch(e){}
    try { await Sync.push(); } catch(e){}
    await Sync.pull(true);
    App.go('roster');
    await new Promise(r => setTimeout(r, 500));
    return { role: Auth.role(), stu: Store.list('students').length };
  })()`).then(s => {
    ok(s.role === 'super', '首位教务就位');
    ok(s.stu === 2, '本地有 2 名学员（缓存渲染的底料）');
  });

  console.log('\n【1】重试链：前两次 504、第三次放行 → 自动重试成功…');
  /* 页面内 monkey-patch fetch（比 CDP Fetch 拦截可靠）：只拦 action=me，前两次回 504 */
  const r1 = await cdp.eval(`(async () => {
    const orig = window.fetch;
    let n = 0;
    window.fetch = (url, opt) => {
      if (String((opt && opt.body) || '').includes('"me"') && n++ < 2)
        return Promise.resolve(new Response('Origin request timed out', { status: 504 }));
      return orig(url, opt);
    };
    let nubSeen = 0;
    const t = setInterval(() => {
      const el = document.getElementById('netNub');
      if (el && el.classList.contains('on')) nubSeen++;
    }, 100);
    const t0 = Date.now();
    let res = null, err = '';
    try { res = await Auth.call('me'); } catch(e){ err = e.message; }
    clearInterval(t);
    window.fetch = orig;
    return { ok: !!(res && res.ok), err, nubSeen, tries: n,
             nubOff: !(document.getElementById('netNub') || {classList:{contains:()=>false}}).classList.contains('on'),
             ms: Date.now() - t0 };
  })()`);
  ok(r1.ok && r1.tries === 3, '前两次 504 被自动重试吃掉，第三次成功（3 次尝试，耗时 ' + r1.ms + 'ms ≈ 1s+3s 退避）');
  ok(r1.nubSeen >= 2, '重试期间「连接中…（第 n 次）」细条亮过（观测 ' + r1.nubSeen + ' 个百毫秒拍点）');
  ok(r1.nubOff, '成功后细条自动撤掉');

  console.log('\n【2】业务错误不重试：5xx 照常重试但 401 一枪就走…');
  const r2 = await cdp.eval(`(async () => {
    const orig = window.fetch;
    let hits = 0;
    window.fetch = (url, opt) => {
      if (String((opt && opt.body) || '').includes('"login"')){ hits++; return Promise.resolve(new Response('{"error":"密码不对，还能试 3 次"}', { status: 401, headers: {'content-type':'application/json'} })); }
      return orig(url, opt);
    };
    let nubSeen = 0;
    const t = setInterval(() => { const el = document.getElementById('netNub'); if (el && el.classList.contains('on')) nubSeen++; }, 50);
    const t0 = Date.now();
    let err = '';
    try { await Auth.call('login', { user: '测试教务', pass: 'wrongpass99' }); } catch(e){ err = e.message; }
    clearInterval(t);
    window.fetch = orig;
    return { hits, ms: Date.now() - t0, err: err.slice(0, 20), nubSeen };
  })()`);
  ok(r2.hits === 1, '401 业务错误只打了一次（' + r2.hits + ' 次），不盲目重试');
  ok(r2.ms < 500, '401 立即返回（' + r2.ms + 'ms，无退避等待）');
  ok(/密码不对/.test(r2.err) && r2.nubSeen === 0, '细条全程不亮，错误原样抛给登录门（' + r2.err + '）');

  console.log('\n【3】缓存兜底：断网 → pull 失败 → 金条 + 页面照常渲染…');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const r3 = await cdp.eval(`(async () => {
    await Sync.pull(true);                       // 重试链吃不满（断网），最终失败 → 金条
    const bar = document.getElementById('staleBar');
    const barOn = !!(bar && bar.classList.contains('on'));
    const barTxt = bar ? bar.textContent : '';
    App.go('roster'); await new Promise(r => setTimeout(r, 400));
    const stuN = document.querySelectorAll('#stuList .item').length;
    App.go('att'); await new Promise(r => setTimeout(r, 400));
    const attOn = document.getElementById('page-att').classList.contains('on');
    /* 不锁死：断网状态下还能点别的页面 */
    App.go('settings'); await new Promise(r => setTimeout(r, 300));
    const settingsOn = document.getElementById('page-settings').classList.contains('on');
    return { barOn, barTxt, stuN, attOn, settingsOn };
  })()`);
  ok(r3.barOn, 'pull 失败后底部金条亮起');
  ok(/云端同步暂缓 · 显示 .*的本地数据/.test(r3.barTxt), '金条文案带数据时点（「' + r3.barTxt + '」）');
  ok(r3.stuN === 2, '名册用本地缓存渲染（2 名学员都在，绝不白屏）');
  ok(r3.attOn && r3.settingsOn, '断网下考勤页/设置页照常切换（不锁死）');

  console.log('\n【4】恢复自动续传：网络回来 → pull 成功 → 金条自动撤…');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(600);                              // 浏览器网络条件切换有一拍传播延迟
  const r4 = await cdp.eval(`(async () => {
    let barOff = false;
    for (let i = 0; i < 10 && !barOff; i++){     // 手动 pull + 轮询确认（恢复后自动续上的口径）
      await Sync.pull(true);
      const bar = document.getElementById('staleBar');
      barOff = !(bar && bar.classList.contains('on'));
      if (!barOff) await new Promise(r => setTimeout(r, 300));
    }
    return { barOff, syncAt: !!Store.get('_syncAt') };
  })()`);
  ok(r4.barOff, '恢复 pull 成功 → 金条自动撤');
  ok(r4.syncAt, '_syncAt 已刷新');

  console.log('\n【5】系统工作号区块：断网 → 「云端暂忙 · 点击重试」；恢复后点击 → 正常…');
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const r5a = await cdp.eval(`(async () => {
    App.go('settings'); await new Promise(r => setTimeout(r, 400));
    await Settings.renderSysAccts();
    const box = document.getElementById('sysAcctList');
    return { hasRetry: !!box.querySelector('button'),
             txt: box.textContent.slice(0, 30) };
  })()`);
  ok(r5a.hasRetry, '断网下 sys 区块摆出「点击重试」按钮（' + r5a.txt + '…）');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const r5b = await cdp.eval(`(async () => {
    await Settings.renderSysAccts();             // 恢复后点重试 = 重新走一遍（含自动重试链）
    const box = document.getElementById('sysAcctList');
    return { ok: !box.querySelector('button'), txt: box.textContent.slice(0, 24) };
  })()`);
  ok(r5b.ok, '恢复后重试成功，回到正常列表态（' + r5b.txt + '）');
} catch(e){
  fail++; console.log('  ✗ 验收异常：' + e.message);
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}

console.log('\n═══ resilience_check 结果：✅ ' + pass + ' · 🔴 ' + fail + ' ═══');
process.exit(fail ? 1 : 0);
