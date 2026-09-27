/**
 * 端口配色体检：逐端口（改 body 类名）实测每个界面的**真实背景色**，
 * 找出「顶栏跟了端口色、底色还是老颜色」这类没跟上的面。
 *   node test/diag_ports.mjs [port]
 * 产出：stdout 表格（不写文件）
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5361);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUPER = { user: '体检教务', pass: 'diagpass123' };

const PORTS = [
  ['teacher', 'role-teacher'],
  ['admin',   'role-admin'],
  ['both',    'role-both'],
  ['student', 'stu'],
  ['super',   'role-super'],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
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
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };

/* 要体检的面：选择器 + 说明。挑的都是「应该跟着端口走」的界面。
   ⚠️ 必须用 .main 打头限定，否则会匹配到登录门里的 .card/.btn ——
   登录门是**故意不跟端口**的（那时人还没登录），会得出错误结论。 */
const PROBE = [
  ['body',              '整页底'],
  ['.main',             '内容区'],
  ['.side',             '电脑侧栏'],
  ['.topbar',           '手机顶栏'],
  ['.tabbar',           '手机底栏'],
  ['.main .card',       '卡片'],
  ['.main .btn',        '主按钮'],
  ['.main .chip',       '小按钮'],
  ['.nav button.on',    '侧栏选中'],
  ['.tabbar button.on', '底栏选中'],
];

try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'diag-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded;
  await sleep(600);

  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2000));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));

  const PROBE_JS = JSON.stringify(PROBE.map(p => p[0]));
  const PORTS_JS = JSON.stringify(PORTS);

  /* 先弄清每个选择器到底匹配到了谁 —— 上次「五端同一个色」的假象就是匹配错元素造成的 */
  const who = await cdp.eval(`(() => {
    const out = {};
    for (const s of ${PROBE_JS}) {
      const el = document.querySelector(s);
      out[s] = el ? { tag: el.tagName, cls: el.className,
        vis: el.getClientRects().length > 0,
        inline: (el.getAttribute('style') || '').slice(0, 60),
        html: el.outerHTML.slice(0, 70) } : null;
    }
    return { role: (window.Auth && Auth.role && Auth.role()) || null, page: (document.querySelector('.page.on') || {}).id, out };
  })()`);
  console.log('当前角色=' + who.role + ' 当前页=' + who.page);
  for (const [sel, info] of Object.entries(who.out)) {
    if (!info) { console.log('  ' + sel.padEnd(22) + ' → 没匹配到'); continue; }
    console.log('  ' + sel.padEnd(22) + ' → <' + info.tag + ' class="' + info.cls + '"> 可见=' + info.vis +
      (info.inline ? ' 内联style=' + JSON.stringify(info.inline) : ''));
  }

  /* ⚠️ 关键：index.html 里有一行
       .nav button,.btn,.card,.chip{transition:all .18s}
     切端口类名之后**同一帧内**读 getComputedStyle，读到的是过渡的起始值（上一个端口），
     于是出现「五端按钮/卡片/选中项都是同一个色」的假象 —— 那是测量假象，不是 bug。
     这里先注一段禁用过渡的样式，读到的才是目标值。 */
  await cdp.eval(`(() => {
    if (document.getElementById('__diagkill')) return 'ok';
    const s = document.createElement('style'); s.id = '__diagkill';
    s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(s); return 'ok';
  })()`);

  for (const mode of ['light', 'dark']) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await sleep(300);
    console.log(`\n══════════ ${mode === 'light' ? '浅色模式' : '深色模式'} ══════════`);
    const data = await cdp.eval(`(() => {
      const sels = ${PROBE_JS};
      const out = {};
      for (const [label, cls] of ${PORTS_JS}) {
        document.body.className = cls;
        const cs = getComputedStyle(document.body);
        const vars = ['--bg','--tint','--rail','--card','--accent','--line'].map(v => cs.getPropertyValue(v).trim());
        const faces = {};
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) { faces[s] = null; continue; }
          const c = getComputedStyle(el);
          faces[s] = [c.backgroundColor, c.color];
        }
        out[label] = { vars, faces };
      }
      return out;
    })()`);

    const VARNAME = ['--bg','--tint','--rail','--card','--accent','--line'];
    console.log('\n── 变量 ──');
    console.log('端口'.padEnd(10) + VARNAME.map(v => v.padEnd(10)).join(''));
    for (const [label] of PORTS) {
      const v = data[label].vars;
      console.log(label.padEnd(12 - (label.length > 6 ? 2 : 0)) + v.map(x => x.padEnd(10)).join(''));
    }
    console.log('\n── 各面背景色 ──');
    for (const [sel, label] of PROBE) {
      const row = PORTS.map(([p]) => {
        const f = data[p].faces[sel];
        if (!f) return '—';
        const bg = f[0];
        if (bg === 'rgba(0, 0, 0, 0)') return '透明';
        const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return bg;
        const h = [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
        return '#' + h;
      });
      console.log((sel + ' ' + label).padEnd(26) + row.map(x => x.padEnd(12)).join(''));
    }
  }

  console.log('\n端口顺序：' + PORTS.map(p => p[0]).join('  '));
} catch (e) {
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
} finally {
  await devReset().catch(()=>{});
  if (chrome) chrome.kill();
  if (server) server.kill();
  await sleep(300); process.exit(process.exitCode || 0);
}
