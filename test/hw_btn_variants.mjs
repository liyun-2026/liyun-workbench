/**
 * ==5.79== 出图：教务端「已布置 → 登记」一行一个学生，三种按钮版式对照
 *   node test/hw_btn_variants.mjs [端口]
 * 产出 test/.shots/hwmerge/variant-A.png / -B.png / -C.png
 * 只用页面里真实的 class（chip / hwgrp / hw-subs），所以看到的就是真机上会长成的样子。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5499);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'hwmerge');
const ADMIN = { user: '版式对照教务', pass: 'shotpass123' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch { /* 等 */ } await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('超时')), 5000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('连不上')); }; });
    const c = new Cdp(ws);
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach((f) => f(m.params)); };
    return c;
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise((res) => { const set = this.events.get(method) || new Set(); const fn = (p) => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome;
try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: 'server' });
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const DBG = 9488;
  const profile = await mkdtemp(path.join(tmpdir(), 'hwvar-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'chrome' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded; await sleep(600);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(ADMIN.user)};
    document.getElementById('gPass').value = ${JSON.stringify(ADMIN.pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1500));
  })()`);

  /* 铺 8 个人 + 一条作业，6 人已提交 / 2 人未交 */
  await cdp.eval(`(() => {
    const d = Util.today();
    const cls = Store.upsert('classes', { id: null, name: '05班' });
    const names = ['林清和','周予安','陈书言','许亦然','赵嘉禾','孙望舒','刘知远','郭曼青'];
    const s = names.map((n, i) => Store.upsert('students', { id: null, name: n, classId: cls.id, ord: i + 1 }));
    const hw = Store.upsert('homework', { clsId: cls.id, date: d, text: '普通话声母辨正 20 分钟 + 气息练习', abbr: '普通' });
    s.forEach((x, i) => { if (i < 6) Store.upsert('hw:' + hw.id, { id: 'r' + i, studentId: x.id, done: 1, by: '陈书言' }); });
    Store.upsert('hw:' + hw.id, { id: 'r6', studentId: s[6].id, done: 0, by: '陈书言' });
    Store.set('_hkCls', cls.id); Store.set('_hkDate', d);
    App.go('homework');
    return { cls: cls.id, hw: hw.id };
  })()`);
  await sleep(600);

  /* 三种版式：都用人 8 个，只把中间那块换成不同排版 */
  const VARIANTS = {
    A: `students.map(s => \`<span class="hwgrp">
          <span class="hw-name">\${Util.esc(s.name)}</span>
          <button class="chip \${st(s)}">已提交</button>
          <button class="chip">质量完成</button>
        </span>\`).join('')`,
    B: `students.map(s => \`<span class="hwgrp">
          <button class="chip \${st(s)}">\${Util.esc(s.name)} 已提交</button>
          <button class="chip">质量完成</button>
        </span>\`).join('')`,
    C: `students.map(s => \`<div class="hwv-row">
          <span class="hwv-name">\${Util.esc(s.name)}</span>
          <span class="hwv-btns">
            <button class="chip \${st(s)}">已提交</button>
            <button class="chip">质量完成</button>
          </span>
        </div>\`).join('')`,
  };

  for (const [key, tpl] of Object.entries(VARIANTS)) {
    const r = await cdp.eval(`(() => {
      const hwId = Store.list('homework')[0].id;
      const students = Store.list('students', Util.byName).filter(x => x.classId === Store.list('classes')[0].id);
      const recs = Store.list('hw:' + hwId);
      const st = s => { const r = recs.find(x => x && x.studentId === s.id); return r && r.done === 1 ? 'chip-on' : (r && r.done === 0 ? 'chip-no' : ''); };
      /* 造一个干净的示波区：标题 + 一种版式 */
      const host = document.getElementById('__varbox') || (() => {
        const d = document.createElement('div'); d.id = '__varbox';
        d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:var(--bg,#f6f5f2);padding:34px 40px';
        document.body.appendChild(d); return d;
      })();
      if (!document.getElementById('__varcss')) {
        const st2 = document.createElement('style'); st2.id = '__varcss';
        st2.textContent = '.hwv-row{display:flex;align-items:center;gap:14px;margin:0 0 10px;width:100%}'
          + '.hwv-name{width:88px;flex:0 0 88px;font-size:14px;color:var(--text)}'
          + '.hwv-btns{display:inline-flex;gap:6px}'
          + '.hwv-title{font-family:"Songti SC",Georgia,serif;font-size:19px;margin:0 0 4px}'
          + '.hwv-sub{font-size:13px;color:var(--text-dim);margin:0 0 18px}';
        document.head.appendChild(st2);
      }
      host.innerHTML = \`<p class="hwv-title">排版 \${${JSON.stringify(key)}}</p>
        <p class="hwv-sub">8 人，前 6 人已提交、后 2 人未交 —— 看两件事：一眼认不认得出是谁，两个按钮读起来顺不顺。</p>
        <div class="hw-subs" style="max-width:760px">\${${tpl}}</div>\`;
      return host.getBoundingClientRect().height;
    })()`);
    await sleep(350);
    const rect = await cdp.eval(`(() => { const r = document.getElementById('__varbox').getBoundingClientRect();
      return { x: 0, y: 0, width: 900, height: Math.min(Math.max(r.height, 220), 900) }; })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...rect, scale: 2 } });
    await writeFile(path.join(OUT, `variant-${key}.png`), Buffer.from(shot.data, 'base64'));
    console.log('📸 ' + path.join(OUT, `variant-${key}.png`) + ' · 高 ' + Math.round(r));
  }
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { chrome && chrome.kill('SIGKILL'); } catch { /* 已退 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}
