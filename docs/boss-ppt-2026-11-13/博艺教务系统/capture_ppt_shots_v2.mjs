/**
 * PPT 素材修正重拍 v2：quant 拼卡 / homework 数字 done / backup+news 去邻居侵入
 *   node docs/boss-ppt-2026-11-13/博艺教务系统/capture_ppt_shots_v2.mjs
 * dev 种子沿用（只覆盖 hwchk 数字）。sign_code、att 两张 v1 已合格不重拍。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(DIR, '..', '..', '..');
const PORT = 5362, CPORT = 5365;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(DIR, 'assets');
const SIZES = JSON.parse(await readFile(path.join(OUT, '_sizes.json'), 'utf8').catch(() => '{}'));

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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf, mobile: !!o.mobile });
const DESK = { width: 1440, height: 900, dsf: 2, mobile: false };

async function login(cdp, acc, what){
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(acc.user)};
    document.getElementById('gPass').value = ${JSON.stringify(acc.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error(what + '登录失败');
  console.log('已登录：' + acc.user + '（' + lg.role + '）');
}

async function shotRegion(cdp, jsFind, name, pad = 14){
  const okScroll = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return 0;
    el.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()`);
  if (!okScroll){ throw new Error('找不到元素：' + name); }
  await sleep(320);
  const b = await cdp.eval(`(() => { const el = (${jsFind}); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight }; })()`);
  if (!b || b.w < 4 || b.h < 4){ throw new Error('元素没尺寸：' + name); }
  let w = b.w + pad * 2, h = b.h + pad * 2;
  if (w > b.vw || h > b.vh){
    const k = Math.min(b.vw / w, b.vh / h);
    w *= k; h *= k;
    console.log(`  ⚠ ${name} 比视口大，缩到 ${Math.round(w)}×${Math.round(h)}`);
  }
  const x = Math.max(0, Math.min(b.x + b.w / 2 - w / 2, b.vw - w));
  const y = Math.max(0, Math.min(b.y + b.h / 2 - h / 2, b.vh - h));
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), scale: 2 },
  });
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  SIZES[name] = [Math.round(w) * 2, Math.round(h) * 2];
  console.log(`  ✂ ${name}  ${Math.round(w)}×${Math.round(h)} (比例 ${(w / h).toFixed(2)}) @2x`);
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'ppt-shots2-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=' + CPORT,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${CPORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, DESK);
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);

  await login(cdp, { user: '李老师', pass: 'liyun2026' }, '李老师');

  /* 完整种子（v1 被 SIGTERM 杀掉时 dev-server 内存数据丢失）+ hwchk 数字 done */
  await cdp.eval(`(async () => {
    const today = Util.today();
    const d = new Date(today); d.setDate(d.getDate() - 1);
    const yest = Util.dateOf(d);
    const c1 = Store.upsert('classes', { name: '博艺一班' });
    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    s1.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    Store.upsert('att:' + today, { studentId: s1[2].id, status: '迟到' });
    Store.upsert('att:' + today, { studentId: s1[4].id, status: '事假' });
    Store.upsert('att:' + today, { studentId: s1[5].id, status: '病假' });
    Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    Quant.syncAtt(c1.id, today);
    const add = (clsId, date, label, delta) => Store.upsert('quant_log', { clsId, date, label, delta });
    add(c1.id, today, '课堂表现良好', 2);
    add(c1.id, today, '作业全交', 2);
    add(c1.id, yest, '晚自习过关率第一', 3);
    Store.set('_qCls', c1.id);
    Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    Store.set('_hkCls', c1.id); Store.set('_hkDate', today);
    s1.slice(0, 5).forEach(s => Store.upsert('hwchk:' + today, { studentId: s.id, classId: c1.id, date: today, done: 1 }));
    Store.upsert('hwchk:' + today, { studentId: s1[5].id, classId: c1.id, date: today, done: 0 });
    Store.set('_lastBackup', Date.now() - 3600e3);
    return 1;
  })()`);
  console.log('种子已灌（hwchk 数字）');
  console.log('hwchk 已覆盖为数字');

  const go = async id => { await cdp.eval(`(async () => { App.go(${JSON.stringify(id)}); window.scrollTo(0,0); await new Promise(r=>setTimeout(r,120)); return 1; })()`); await sleep(700); };

  console.log('\n── 重拍 quant（快捷加减分卡单卡） ──');
  await go('quant');
  await shotRegion(cdp, "document.getElementById('qBtns').closest('.card')", 'ppt_quant.png');

  console.log('── 重拍 homework ──');
  await go('homework');
  await shotRegion(cdp, "document.getElementById('hkBody').closest('.hw-card')", 'ppt_homework.png');

  console.log('── 重拍 backup（pad 0 去邻居侵入） ──');
  await go('settings');
  await shotRegion(cdp, "document.getElementById('backupCard')", 'ppt_backup.png', 0);

  /* ── 老师端 news：pad 6 + 隐藏滚动区被拦腰截断的最后一条 ── */
  console.log('\n── 重拍 news（老师端） ──');
  await cdp.eval(`(async () => { Store.setSecret('token', ''); Store.setSecret('me', ''); location.reload(); return 1; })()`);
  await sleep(2600);
  await login(cdp, { user: '张伟', pass: 'liyun2026' }, '张伟');
  await go('news');
  const src = await cdp.eval(`(async () => {
    Store.set('news_cache', null);
    News.fetch();
    await new Promise(r => setTimeout(r, 9000));
    const c = Store.get('news_cache');
    return { real: !!(c && c.items && c.items.length) };
  })()`);
  console.log('新闻数据：' + (src.real ? '真实拉取央视接口成功' : '兜底'));
  await cdp.eval(`(() => {
    const body = document.getElementById('nNewsBody');
    if (body) {
      body.style.maxHeight = '620px';
      /* 容器高度收到条目整边界，底部不出现拦腰截断的行 */
      let acc = 0;
      for (const it of body.children) {
        const h = it.offsetHeight;
        if (acc + h > 620) break;
        acc += h;
      }
      body.style.maxHeight = acc + 'px';
    }
    return 1;
  })()`);
  await sleep(300);
  await shotRegion(cdp, "document.getElementById('nNewsBody').closest('.card')", 'ppt_news.png', 6);

  await writeFile(path.join(OUT, '_sizes.json'), JSON.stringify(SIZES, null, 2));
  console.log('\n✅ v2 重拍完成');
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
