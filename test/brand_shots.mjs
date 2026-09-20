/**
 * 门头出图：把定稿的 A 竖式门头在电脑与手机上、浅色与深色各拍一遍，
 * 供挑选。顺带把设置页页脚署名也拍进来。
 *
 *   node test/brand_shots.mjs            # 落到 test/.shots/brand/
 *   node test/brand_shots.mjs 5341       # 换端口
 *
 * 用一次性账号 __brandtest__，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 本机 127.0.0.1 一律不走系统代理 —— 用户机器上装了代理软件，
   node 的 fetch 会被劫持然后挂死 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5341);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'brand');
const SUPER = { user: '__brandtest__', pass: 'brandshot2026' };
const ALL = ['A'];   // 2026-09-20 定稿：只剩 A 竖式

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
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server; const chromes = []; const shots = [];
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };

async function quiet(cdp){
  /* 「已登录」「排课完成」这类浮动提示会盖在工作台顶部，留在给用户看的图里
     很像出错。等它自己走掉再按快门。（顶部那条「记得备份一下」是真功能，不清。） */
  await waitFor(() => cdp.eval(`(() => { const t = document.getElementById('toast');
    return !t || !t.classList.contains('on'); })()`), { what: '提示消失', tries: 24, gap: 250 });
  await sleep(250);
}

async function shot(cdp, name){
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUT, name);
  await writeFile(file, Buffer.from(r.data, 'base64'));
  shots.push(file);
  console.log('  📸 ' + name);
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: o.mobile });
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };
const MOB  = { width: 390, height: 844, dsf: 2, mobile: true };

/** 打开页面，等门头装配完 */
async function open(cdp, brand){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` });
  await loaded;
  await waitFor(() => cdp.eval(`!!document.getElementById('gBrand') && document.getElementById('gBrand').children.length > 0`),
    { what: '门头装配', tries: 40, gap: 200 });
  /* ⚠️ 开屏层淡出要 300+450ms，这时候截图会把它半透明地叠在页面上，
     看着像一层脏水印。出图前一律直接摘掉，别等它自己走。 */
  await sleep(650);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) s.remove(); return 'ok'; })()`);
  /* ⚠️ 出图用的是一次性账号 __brandtest__，问候语会变成「__brandtest__老师，晚上好」。
     显示名只在内存里改，而每次 open() 都会重新导航、重新按账号名装配 ——
     所以覆盖必须放在这里，每次导航后都补一遍（放在登录之后一次性改是没用的）。 */
  await cdp.eval(`(() => {
    if (typeof Auth === 'undefined' || !Auth._me) return 'skip';
    if (Auth._me.name !== '教务老师'){ Auth._me.name = '教务老师'; }
    if (typeof Greet !== 'undefined') Greet.paint();
    return 'ok';
  })()`);
  await sleep(150);
}

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok,
    { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'brand-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  /* ── ① 手机上，登录页（未登录）─────────────── */
  await view(cdp, MOB);
  console.log('\n① 登录页 · 手机');
  for (const b of ALL){
    await open(cdp, b);
    await sleep(700);
    await shot(cdp, `m-gate-${b}.png`);
  }

  /* ── ② 登录 + 灌一点演示数据 ────────────────── */
  const lg = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { ok: !document.getElementById('gate').classList.contains('on'),
             err: document.getElementById('gErr').textContent, role: Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + (lg.err || ''));
  console.log('\n② 已登录，角色：' + lg.role);

  await cdp.eval(`(async () => {
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });
    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾'];
    const N2 = ['周若溪','吴俊熙','郑雨桐','冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
    s1.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s1[2].id, status: '迟到' });
    Store.upsert('att:' + today, { studentId: s1[4].id, status: '事假' });
    s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s2[1].id, status: '迟到' });
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    Store.upsert('schedule', { kind: 'big', day: '周一', periodId: p1.id, title: '普通话语音基础', cls: '砺蕴一班' });
    Store.upsert('schedule', { kind: 'big', day: '周一', periodId: p3.id, title: '新闻播报实训', cls: '砺蕴一班' });
    Quant.syncAtt(c1.id, today); Quant.syncAtt(c2.id, today);
    return 'ok';
  })()`);
  console.log('   演示数据就位');

  /* ── ③ 手机上，工作台 ───────────────────────── */
  console.log('\n③ 工作台 · 手机');
  for (const b of ALL){
    await open(cdp, b);
    await cdp.eval(`App.go('home')`);
    await sleep(1200);
    await quiet(cdp);
    await shot(cdp, `m-app-${b}.png`);
  }

  /* ── ④ 电脑上：登录页 + 工作台 ──────────────── */
  await view(cdp, DESK);
  await sleep(400);
  console.log('\n④ 电脑 · 登录页');
  for (const b of ALL){
    await open(cdp, b);
    await cdp.eval(`document.getElementById('gate').classList.add('on')`);
    await sleep(600);
    await shot(cdp, `d-gate-${b}.png`);
    await cdp.eval(`document.getElementById('gate').classList.remove('on')`);
    await sleep(300);
  }

  console.log('\n⑤ 电脑 · 工作台');
  for (const b of ALL){
    await open(cdp, b);
    await cdp.eval(`App.go('home')`);
    await sleep(1200);
    await quiet(cdp);
    await shot(cdp, `d-app-${b}.png`);
  }

  /* ── ⑥ 深色模式再来一遍（系统跟随 prefers-color-scheme）── */
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  console.log('\n⑥ 深色模式 · 手机');
  await view(cdp, MOB);
  await sleep(400);
  for (const b of ALL){
    await open(cdp, b);
    await cdp.eval(`document.getElementById('gate').classList.add('on')`);
    await sleep(500);
    await shot(cdp, `m-gate-${b}-dark.png`);
    await cdp.eval(`document.getElementById('gate').classList.remove('on')`);
    await cdp.eval(`App.go('home')`);
    await sleep(1200);
    await quiet(cdp);
    await shot(cdp, `m-app-${b}-dark.png`);
  }
  console.log('\n⑦ 深色模式 · 电脑');
  await view(cdp, DESK);
  await sleep(400);
  for (const b of ALL){
    await open(cdp, b);
    await cdp.eval(`document.getElementById('gate').classList.add('on')`);
    await sleep(600);
    await shot(cdp, `d-gate-${b}-dark.png`);
    await cdp.eval(`document.getElementById('gate').classList.remove('on')`);
    await cdp.eval(`App.go('home')`);
    await sleep(1200);
    await quiet(cdp);
    await shot(cdp, `d-app-${b}-dark.png`);
  }
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  /* ── ⑧ 设置页页脚署名 ───────────────────────── */
  console.log('\n⑥ 设置页署名（以 A 为例）');
  await open(cdp, 'A');
  await cdp.eval(`App.go('settings')`);
  await sleep(1200);
  await cdp.eval(`document.getElementById('footBrand').scrollIntoView({ block: 'center' })`);
  await sleep(500);
  await shot(cdp, 'd-foot-A.png');

  console.log('\n✅ 共 ' + shots.length + ' 张');
} catch(e){
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(300);
  for (const s of shots) console.log('  ' + s);
  process.exit(process.exitCode || 0);
}
