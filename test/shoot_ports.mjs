/**
 * 四端真实截图（v32 五端口配色）：登录 super → 建演示账号 → 逐端 demoGo 截真实 UI。
 * 产出写进宣传手册 assets/，供 build_promo.mjs 引用。
 *   桌面 1440×900，dsf=1（与 DESIGN.md 1.60 比例、≤1440 宽一致，不花屏）。
 * 导航用「点侧栏/底栏按钮（data-id）」而非 App.go —— 更贴近用户真实路径。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作系统-使用手册';
const OUT = path.join(MANUAL, 'assets');
const PORT = Number(process.argv[2] || 5381);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const DESK = { width: 1440, height: 900, dsf: 1, mobile: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(10000) });
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

let server, chrome;
const shots = [];
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride', { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: o.mobile });
const shot = async (cdp, name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); shots.push(name); console.log('  📸 ' + name); };
const cleanUI = async (cdp) => { await sleep(700);
  await cdp.eval(`(() => { ['splash','drawer'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    const dl = document.getElementById('demoList'); if (dl) dl.style.display = 'none';
    document.querySelectorAll('.demo,.banner,#newsRef').forEach(e => e.style.display = 'none');
    const t = document.querySelector('.toast'); if (t) t.classList.remove('on'); return 'ok'; })()`);
  await sleep(250); };
const bootReady = (cdp) => cdp.eval(`(async () => { for (let i=0;i<50;i++){ if (window.App && App._booted && document.querySelector('.main')) return true; await new Promise(r=>setTimeout(r,200)); } return false; })()`);

/* 触发角色切换（会 reload），等新的 load 事件 + 就绪 */
async function switchRole(cdp, fireExpr){
  const nav = cdp.once('Page.loadEventFired');
  await cdp.eval(`(() => { ${fireExpr}; return 'fired'; })()`).catch(()=>{});
  await Promise.race([nav, sleep(7000)]);
  await sleep(1500);
  await cdp.send('Runtime.enable').catch(()=>{});
  await cdp.send('Page.enable').catch(()=>{});
  return bootReady(cdp);
}

/* 点导航按钮切页；返回诊断 */
async function goPage(cdp, id){
  const r = await cdp.eval(`(() => {
    const btns = [...document.querySelectorAll('#nav button, #tabs button, #dgrid button')];
    const b = btns.find(x => x.dataset.id === ${JSON.stringify(id)});
    if (b) b.click();
    else if (window.App && App.go) { try { App.go(${JSON.stringify(id)}); } catch(e){} }
    return { hasBtn: !!b, navIds: btns.map(x=>x.dataset.id), role: (window.Auth && Auth.role && Auth.role()) || null };
  })()`);
  await sleep(800); await cleanUI(cdp);
  const active = await cdp.eval(`(() => { const p = document.querySelector('.page.on'); return p ? p.id : null; })()`);
  return { ...r, active };
}

try {
  await mkdir(OUT, { recursive: true });
  await devReset();
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 50 });

  const profile = await mkdtemp(path.join(tmpdir(), 'ports-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  await view(cdp, DESK);
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` }); await loaded;
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand')`), { what: '门头装配', tries: 50, gap: 200 });
  await sleep(600);

  // 注册首位教务（第一个账号）
  const reg = await cdp.eval(`(async () => { if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '截图超管';
    document.getElementById('gPass').value = 'jiantu2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: (window.Auth && Auth.role && Auth.role()) || '', err: document.getElementById('gErr') && document.getElementById('gErr').textContent }; })()`);
  if (!reg.ok) throw new Error('注册超管失败：' + JSON.stringify(reg));
  console.log('已注册并登录首位教务，角色：' + JSON.stringify(reg.role));
  await cdp.eval(`App.go('home')`); await cleanUI(cdp);

  // 建四个演示账号
  await cdp.eval(`(async () => { await Settings.demoMake(); await new Promise(r => setTimeout(r, 1200)); return 'ok'; })()`);
  console.log('演示账号已建');

  // 捕获端口
  const PORTS = [
    { key:'super',   demo:null,            pages:[['home','今日'],['att','考勤'],['coop','协作']] },
    { key:'teacher', demo:'演示老师',      pages:[['today','今天'],['record','录入今日'],['news','每日新闻']] },
    { key:'admin',   demo:'演示教务',      pages:[['home','今日'],['att','考勤'],['roster','名册']] },
    { key:'student', demo:'演示学生',      pages:[['stuHome','今日'],['stuSign','打卡'],['stuGather','限时征集']] },
    { key:'both',    demo:'演示教务兼老师',pages:[['home','今日'],['today','今天']] },
  ];

  for (const p of PORTS) {
    if (p.demo) {
      const ok = await switchRole(cdp, `Settings.demoGo(${JSON.stringify(p.demo)})`);
      console.log(`\n▶ ${p.key} (${p.demo}) 就绪=${ok}`);
    } else {
      console.log(`\n▶ ${p.key} (超管本体)`);
    }
    await view(cdp, DESK); await cleanUI(cdp);
    for (const [pid, label] of p.pages) {
      const d = await goPage(cdp, pid);
      console.log(`   ${p.key}/${pid}(${label}) -> 当前页=${d.active} | 有按钮=${d.hasBtn} | 角色=${d.role} | nav=[${d.navIds}]`);
      await shot(cdp, `port_${p.key}_${pid}.png`);
    }
    if (p.demo) { await switchRole(cdp, `Settings.demoBack()`); }
  }

  console.log('\n✅ 共 ' + shots.length + ' 张 -> ' + OUT);
} catch(e) {
  console.error('\n💥 ' + (e && e.message)); process.exitCode = 1;
} finally {
  await devReset().catch(()=>{});
  if (chrome) chrome.kill();
  if (server) server.kill();
  await sleep(300); process.exit(process.exitCode || 0);
}
