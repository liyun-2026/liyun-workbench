/**
 * ==5.72== 登录门底图外置后的真机渲染核验
 *   node test/gate_img_shot.mjs [端口]
 * 图片从 base64 内嵌改成 img/*.webp|png 之后，必须确认真的画出来了 ——
 * 这类改动最容易「代码对、图不显示」，所以这里同时读 DOM 与资源加载记录。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5511);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'gate');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.w = new Map(); this.ev = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = e => { const m = JSON.parse(e.data);
      if (m.id && c.w.has(m.id)) { const { r, j } = c.w.get(m.id); c.w.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); }
      else if (m.method && c.ev.has(m.method)) c.ev.get(m.method).forEach(f => f(m.params)); };
    return c;
  }
  send(m, p = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((r, j) => this.w.set(id, { r, j })); }
  once(m){ return new Promise(r => { const s = this.ev.get(m) || new Set(); const f = p => { s.delete(f); r(p); }; s.add(f); this.ev.set(m, s); }); }
  async eval(e, t = 90000){ const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, timeout: t });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome; const R = [];
const t = (n, ok, ex) => R.push({ n, ok: !!ok, ex });
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  const profile = await mkdtemp(path.join(tmpdir(), 'gate-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--remote-debugging-port=5512',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
    '--disable-extensions','--no-proxy-server','--force-device-scale-factor=2','about:blank'], { stdio: 'ignore' });
  const tgt = await waitFor(async () => (await (await jfetch('http://127.0.0.1:5512/json/list')).json()).find(x => x.type === 'page' && x.webSocketDebuggerUrl));
  const cdp = await Cdp.connect(tgt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` }); await loaded;
  await sleep(2600);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s){ s.style.opacity='0'; s.style.display='none'; } })()`);

  /* ── 资源加载记录：三张图必须都是 200 且类型对 ── */
  const res = await cdp.eval(`(() => {
    const list = performance.getEntriesByType('resource')
      .filter(r => r.name.indexOf('/img/') >= 0)
      .map(r => ({ name: r.name.split('/img/')[1], status: r.responseStatus || 0, size: r.transferSize || 0 }));
    const b2 = getComputedStyle(document.querySelector('.gm-s2')).backgroundImage;
    const b4 = getComputedStyle(document.querySelector('.gm-s4')).backgroundImage;
    return { list, b2, b4,
      leftBase64: (document.documentElement.innerHTML.match(/data:image\\/[a-z+]*;base64,/g) || []).length };
  })()`);
  t('登录门两张底图按 webp 路径加载', /gate-2\.webp/.test(res.b2) && /gate-4\.webp/.test(res.b4), res.b2.slice(0, 60) + ' | ' + res.b4.slice(0, 60));
  t('两张底图都真的下下来了（HTTP 200 且有字节）',
    res.list.filter(x => /gate-[24]\.webp/.test(x.name) && x.status === 200 && x.size > 0).length === 2, JSON.stringify(res.list));
  /* 印章图用在桌面门户条与页脚（≥1100 才显示），手机视口下不在 DOM 可视区 —— 直接解码验文件本身 */
  const seal = await cdp.eval(`new Promise(r => { const i = new Image();
    i.onload = () => r({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => r({ ok: false }); i.src = 'img/seal.png'; })`);
  t('印章图 seal.png 能解码（116×116）', seal.ok && seal.w === 116 && seal.h === 116, JSON.stringify(seal));
  t('页面里已经没有 base64 内嵌图残留', res.leftBase64 === 0, String(res.leftBase64));

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name);
  };
  /* 滚到第 2 屏 / 第 4 屏各截一张 */
  for (const [sel, name] of [['.gm-s2', 'gate-2.png'], ['.gm-s4', 'gate-4.png']]) {
    await cdp.eval(`(() => { const el = document.querySelector('${sel}'); if (el) el.scrollIntoView({ block:'start' }); })()`);
    await sleep(700);
    await shot(name);
  }
  await cdp.eval(`(() => { const el = document.getElementById('gate'); if (el) el.scrollTo(0, 0); })()`);
  await sleep(600);
  await shot('gate-1.png');
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}
const bad = R.filter(x => !x.ok);
R.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok || !x.ex ? '' : '   → ' + x.ex)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length}` : `✅ 全部通过（${R.length} 项）`));
if (bad.length) process.exitCode = 1;
