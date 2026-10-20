/**
 * 课时统计 · 阶段一 验收截图（A 初始态 / B 识别结果）
 *
 *   node test/shot_hours_stage1.mjs [--port=5413] [--probe=1]
 *
 * 为什么这样写：
 *   · 裸 WebSocket CDP + 无头 Chrome（抄 test/hours_recognize_check.mjs），没有 puppeteer。
 *   · 🔴 本应用 body{height:100%;overflow:hidden} + .main{flex:1;overflow-y:auto}，
 *     滚动容器是 #main，文档永远只有一个视口高 → 整页图必须靠 #main.scrollTop 分段 + 拼接。
 *   · 走真实链路：DataTransfer 塞 File 进 #hrsFile + 派发 change → Hours.onFile → Hours._run。
 *
 * 不改任何工程源码，不 commit。
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(here, '..');
const FLAGS = process.argv.slice(2).filter(a => a.startsWith('--'));
const flag = (n, d) => { const h = FLAGS.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const PORT = Number(flag('port', 5413));
const CDP = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const PROBE_ONLY = String(flag('probe', '0')) === '1';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PY = '/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3';
const NODE = process.execPath;
const FIX = path.join(WORK, 'test', 'fixtures');
const OUT = path.join(WORK, 'test', '.shots', 'plan-keshitongji', 'stage1');
const TILES = path.join(OUT, '_tiles_B');
const SUPER = { user: '李老师', pass: 'liyun2026' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
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
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method) { return new Promise(res => { const set = this.events.get(method) || new Set();
    const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); }); }
  async eval(expr, timeout = 600000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

const PAGE_HELPER = `
window.__mkFile = (b64, name, type) => {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type });
};
window.__feed = (b64, name, type) => {
  const f = window.__mkFile(b64, name, type);
  const input = document.getElementById('hrsFile');
  const dt = new DataTransfer(); dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return f.name;
};
`;

const fsFlags = existsSync(path.join(FIX, 'hours_tt.docx')) ? {} : { missing: true };

let server, chrome, profile, cdp;
const report = { probe: {}, chosen: null, shots: {} };

try {
  if (fsFlags.missing) throw new Error('夹具不存在：' + FIX);
  await mkdir(OUT, { recursive: true });
  await rm(TILES, { recursive: true, force: true });

  const docxB64 = (await readFile(path.join(FIX, 'hours_tt.docx'))).toString('base64');
  const csvB64 = (await readFile(path.join(FIX, 'hours_tt.csv'))).toString('base64');
  const pngB64 = (await readFile(path.join(FIX, 'hours_tt.png'))).toString('base64');
  const FIXTURES = {
    docx: { b64: docxB64, name: 'hours_tt.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    csv:  { b64: csvB64,  name: 'hours_tt.csv',  type: 'text/csv' },
    png:  { b64: pngB64,  name: 'hours_tt.png',  type: 'image/png' },
  };

  console.log('【起】静态服务 + 无头 Chrome …');
  server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务', tries: 50 });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'hours-shot-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  // 桌面 1280 CSS 宽；dsf=1 + clip.scale=2 → 输出正好 2 倍像素
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2800);

  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2600));
    return { role: Auth.role && Auth.role(), name: Auth.name && Auth.name() };
  })()`);
  console.log('登录：' + JSON.stringify(login));
  if (login.role !== 'super') throw new Error('登录角色不对：' + JSON.stringify(login));

  /* ── 图 A：初始态 ─────────────────────────────────────── */
  await cdp.eval(`(async () => { App.go('hours'); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
  const aState = await cdp.eval(`(() => {
    const navBtns = [...document.querySelectorAll('#nav button')];
    const ids = navBtns.map(b => b.dataset.id);
    const hrs = navBtns.find(b => b.dataset.id === 'hours');
    const tt  = navBtns.find(b => b.dataset.id === 'timetable');
    const cls = el => el ? el.className : '';
    return {
      on: document.getElementById('page-hours').classList.contains('on'),
      title: (document.querySelector('#page-hours .page-title') || {}).textContent,
      navIds: ids,
      hoursIdx: ids.indexOf('hours'), ttIdx: ids.indexOf('timetable'),
      hoursCls: cls(hrs), ttCls: cls(tt),
      hoursAria: hrs ? hrs.getAttribute('aria-current') : null,
      hasUpload: !!document.getElementById('hrsFile'),
      stat: (document.getElementById('hrsStat') || {}).textContent,
      bodyEmpty: /还没有识别结果/.test((document.getElementById('hrsBody') || {}).innerHTML || ''),
      innerW: window.innerWidth, innerH: window.innerHeight,
    };
  })()`);
  console.log('A 态：' + JSON.stringify(aState));

  const aShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1280, height: 900, scale: 2 } });
  const aBuf = Buffer.from(aShot.data, 'base64');
  const aPath = path.join(OUT, 'A_课时统计页_初始态.png');
  await writeFile(aPath, aBuf);
  const aSz = pngSize(aBuf);
  console.log(`📸 A → ${aPath}  ${aSz.w}×${aSz.h}`);
  report.shots.A = { path: aPath, ...aSz, state: aState };

  /* ── 探针：三条通路各跑一次真实识别 ───────────────── */
  {
    console.log('\n【探针】三条通路各跑一次真实 Hours.readSource …');
    for (const [key, f] of Object.entries(FIXTURES)) {
      const t0 = Date.now();
      const m = await cdp.eval(`(async () => {
        ${PAGE_HELPER}
        const f = window.__mkFile(${JSON.stringify(f.b64)}, ${JSON.stringify(f.name)}, ${JSON.stringify(f.type)});
        const m = await Hours.readSource(f, () => {});
        return { via: m.via, mode: m.mode, ms: m.ms, days: m.days, n: m.records.length,
          need: m.records.filter(r => r.needCheck).length,
          recs: m.records.map(r => ({ day: r.day, label: r.label, title: r.title, conf: r.conf, need: !!r.needCheck, notes: r.notes })) };
      })()`, 600000);
      report.probe[key] = m;
      console.log(`  · ${key}: via=${m.via} mode=${m.mode} n=${m.n} need=${m.need} ms=${m.ms} (wall ${Date.now()-t0}ms)`);
      console.log(`    需要确认的行：${m.recs.filter(r => r.need).map(r => `${r.day}|${r.title}|${Math.round(r.conf)}%|${(r.notes||[]).join(',')}`).join('  ‖  ') || '（无）'}`);
    }

    /* 选夹具：docx 优先，其次 png，再次 csv */
    const pick = ['docx', 'png', 'csv'].find(k => report.probe[k] && report.probe[k].need > 0);
    report.chosen = pick || null;
    console.log('\n选用夹具：' + (pick || '（三条通路都没有 needCheck —— 无法出黄色高亮）'));

    if (!pick) {
      report.warn = 'no-yellow';
      console.log('⚠️ 三条通路都没有 needCheck 行，无法展示黄色高亮。');
    } else if (PROBE_ONLY) {
      console.log('probe-only，跳过 B');
    } else {
      const f = FIXTURES[pick];
      /* ── 图 B：真实链路识别 → 拍全 #main ─────────────── */
      console.log('\n【B】真实链路：DataTransfer → #hrsFile → change …');
      await cdp.eval(`(() => { Hours.clear(); return 1; })()`);
      await sleep(300);
      const fed = await cdp.eval(`(() => { ${PAGE_HELPER} return window.__feed(${JSON.stringify(f.b64)}, ${JSON.stringify(f.name)}, ${JSON.stringify(f.type)}); })()`);
      console.log('  已投放文件：' + fed);
      await cdp.eval(`(async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 600000) {
          const sum = document.getElementById('hrsSum');
          if (sum) return 1;
          const body = document.getElementById('hrsBody');
          if (body && /识别失败/.test(body.innerHTML)) throw new Error('识别失败：' + body.textContent.slice(0, 200));
          await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('等识别结果超时');
      })()`, 620000);
      await sleep(700);

      const geom = await cdp.eval(`(() => {
        const m = document.getElementById('main');
        const r = m.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, scrollH: m.scrollHeight, scrollTop: m.scrollTop,
          sum: (document.getElementById('hrsSum') || {}).textContent,
          rows: document.querySelectorAll('#hrsBody .hrstbl tr').length,
          lowRows: document.querySelectorAll('#hrsBody tr.hrs-low').length,
          lowBg: getComputedStyle(document.querySelector('#hrsBody tr.hrs-low td') || document.body).backgroundColor };
      })()`);
      console.log('  #main 几何：' + JSON.stringify({ x: geom.x, y: geom.y, w: geom.w, h: geom.h, scrollH: geom.scrollH }));
      console.log('  摘要：' + geom.sum);
      console.log('  表行数：' + geom.rows + ' · 黄行数：' + geom.lowRows + ' · 黄底：' + geom.lowBg);
      report.shots.B_geom = geom;

      const overlap = 64;
      const step = Math.max(200, Math.floor(geom.h - overlap));
      const total = Math.ceil(Math.max(0, geom.scrollH - geom.h) / step) + 1;
      console.log(`  分片：${total} 屏（step=${step}, overlap=${overlap}）`);
      await rm(TILES, { recursive: true, force: true });
      await mkdir(TILES, { recursive: true });
      const tileMeta = [];   // 每片记下「真实」scrollTop（会被 scrollHeight 夹住），拼接时按它算裁切量
      // 平滑滚动会让 scrollTop 立刻读回 0 —— 先关掉动画，再「设置→等待→读回」确认到位
      await cdp.eval(`(() => {
        let st = document.getElementById('__noscroll');
        if (!st) { st = document.createElement('style'); st.id = '__noscroll';
          st.textContent = '*{scroll-behavior:auto !important}'; document.head.appendChild(st); }
        return 1;
      })()`);
      for (let i = 0; i < total; i++) {
        const want = Math.min(i * step, Math.max(0, geom.scrollH - geom.h));
        const y = await cdp.eval(`(async () => {
          const m = document.getElementById('main');
          const set = v => { m.scrollTop = v; };
          set(${want});
          await new Promise(r => setTimeout(r, 360));
          for (let k = 0; k < 8 && Math.abs(m.scrollTop - ${want}) > 2; k++) {
            set(${want}); await new Promise(r => setTimeout(r, 260));
          }
          return m.scrollTop;
        })()`);
        await sleep(300);
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false,
          clip: { x: geom.x, y: geom.y, width: geom.w, height: geom.h, scale: 2 } });
        const fn = String(i + 1).padStart(2, '0') + '.png';
        await writeFile(path.join(TILES, fn), Buffer.from(r.data, 'base64'));
        tileMeta.push({ f: fn, y });
        console.log(`    tile ${i + 1}/${total}  want=${want} 实际 scrollTop=${y}`);
      }
      await writeFile(path.join(TILES, 'meta.json'), JSON.stringify({
        scale: 2, h: geom.h, scrollH: geom.scrollH, w: geom.w, tiles: tileMeta,
      }, null, 2));

      // 拼接：每片 i>0 裁掉顶部 (y_{i-1}+h - y_i) 像素 → 与上一片严丝合缝，不重复、不断行
      const bPath = path.join(OUT, 'B_识别结果_预览表.png');
      const py = spawn(PY, [path.join(WORK, 'test', 'stitch_vert.py'), TILES, bPath], { encoding: 'utf8' });
      let pyOut = '', pyErr = '';
      py.stdout.on('data', d => pyOut += d); py.stderr.on('data', d => pyErr += d);
      const pyCode = await new Promise(res => py.on('close', res));
      console.log('  拼接：' + pyCode + ' ' + (pyOut || '').trim() + (pyErr ? (' | err: ' + pyErr.trim()) : ''));
      const bBuf = await readFile(bPath);
      const bSz = pngSize(bBuf);
      console.log(`📸 B → ${bPath}  ${bSz.w}×${bSz.h}`);
      report.shots.B = { path: bPath, ...bSz, fixture: pick };
    }
  }

  console.log('\n===JSON===\n' + JSON.stringify(report, null, 2));
} catch (e) {
  console.error('\n💥 ' + (e && e.message ? e.message : e));
  console.error(e && e.stack ? String(e.stack).split('\n').slice(0, 8).join('\n') : '');
  console.log('\n===JSON===\n' + JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
