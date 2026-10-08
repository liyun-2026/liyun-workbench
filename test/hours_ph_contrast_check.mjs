/**
 * 黄底行 placeholder 对比度实测（真实渲染像素，不是读 CSS 声明）
 *
 *   node test/hours_ph_contrast_check.mjs [工程目录] [端口]
 *
 * 为什么要量像素：这台工程有**端口皮肤覆盖设计令牌**的历史坑 —— 读 CSS 声明会得出
 * 「应该没问题」的结论，而实际渲染可能早被 body.role-* 的令牌改掉了。所以这里
 * 「起真浏览器 → 按端口切 body class → 切浅/深色 → 截黄底行的输入框 → 用 Pillow 采样
 * placeholder 文字原色 → 按 WCAG 算对比度」。
 *
 * 覆盖 5 个皮肤类（role-super / role-admin〔office、admin 同一个皮〕/ role-both / role-teacher）
 * × 浅 / 深两套 = 10 个组合；门槛：黄底行 placeholder 相对黄底 ≥ 4.5:1。
 * 同时量一遍**非黄底**行，用来确认这条新规则没有波及它们。
 *
 * 采样交给 test/hours_ph_sample.py（Pillow）；本脚本只负责截图 + 落盘 + 调采样。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.resolve(process.argv[2] || path.join(here, '..'));
const PORT = Number(process.argv[3] || 5398);
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = PORT + 1;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PY = '/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3';
const NODE = process.execPath;

const SUPER = { user: '李老师', pass: 'liyun2026' };
const DSF = 2;
const VW = 1180, VH = 900;

const SKINS = [
  { key: 'super',   cls: 'role-super' },
  { key: 'admin',   cls: 'role-admin' },   // office 与 admin 共用这个皮
  { key: 'both',    cls: 'role-both' },
  { key: 'teacher', cls: 'role-teacher' },
];
const SCHEMES = ['light', 'dark'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}

function staticServer(root, port) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gz': 'application/gzip' };
  return createServer(async (req, res) => {
    const rel = new URL(req.url, 'http://localhost').pathname.replace(/^\/+/, '') || 'index.html';
    const f = path.join(root, rel);
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    } catch { res.writeHead(404).end('404'); }
  }).listen(port);
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
  async eval(expr, timeout = 120000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome, profile, cdp;
try {
  /* 与 test/hours_recognize_check.mjs 一致：优先用仓库的 dev-server（带 /api 后端，才登得进去），
     没有才退回纯静态服务 */
  if (await readFile(path.join(WORK, 'test', 'dev-server.mjs')).then(() => true).catch(() => false)) {
    server = spawn(NODE, [path.join(WORK, 'test', 'dev-server.mjs'), String(PORT)], { cwd: WORK, stdio: 'ignore' });
  } else {
    server = staticServer(WORK, PORT);
  }
  await waitFor(async () => (await fetch(`${BASE}/`)).ok, { what: '页面服务' });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  profile = await mkdtemp(path.join(tmpdir(), 'php-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DSF, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  await sleep(2600);

  const login = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { role: Auth.role(), name: Auth.name() };
  })()`);
  if (login.role !== 'super') throw new Error('登录失败：' + JSON.stringify(login));
  await sleep(900);   // 等开屏 / 登录层的淡出动画走完 —— 否则第一张截图会带一层白纱（实测过）

  /* 注入一小张表：一行普通（非黄底）+ 一行黄底，槽位与真实页一致，placeholder 取真实文案。
     只放输入框、不放其它文字 —— 采样时这一片区域里的非背景色就全是 placeholder。 */
  await cdp.eval(`(() => {
    App.go('hours');
    const cells = ['周一','08:00-09:40','班级','教室','授课内容','老师','','']
      .map(ph => '<td>' + (ph ? ('<input placeholder="' + ph + '">') : '') + '</td>').join('');
    const thead = ['星期','节次 / 时间','班级','教室','授课内容','老师','置信度','']
      .map(t => '<th>' + t + '</th>').join('');
    const body = document.getElementById('hrsBody');
    body.innerHTML = '<div class="hrs-wrap"><table class="hrstbl"><thead><tr>' + thead + '</tr></thead><tbody>'
      + '<tr id="phPlain">' + cells + '</tr>'
      + '<tr id="phLow" class="hrs-low">' + cells + '</tr>'
      + '</tbody></table></div>';
    return true;
  })()`);
  await sleep(500);

  const outDir = path.join(tmpdir(), 'hours_ph_shots');
  await mkdir(outDir, { recursive: true });

  const jobs = [];
  for (const skin of SKINS) {
    for (const scheme of SCHEMES) jobs.push({ skin, scheme });
  }

  const results = [];
  for (const { skin, scheme } of jobs) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    const geo = await cdp.eval(`(() => {
      document.body.classList.remove('role-super','role-admin','role-both','role-teacher','stu');
      document.body.classList.add(${JSON.stringify(skin.cls)});
      const pick = sel => { document.querySelector(sel).scrollIntoView({ block:'center' }); return document.querySelector(sel); };
      const low = pick('#phLow td:nth-child(2) input');
      const plain = pick('#phPlain td:nth-child(2) input');
      const rectOf = el => { const r = el.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height }; };
      const cs = getComputedStyle(document.getElementById('phLow').querySelector('td'));
      return { low: rectOf(low), plain: rectOf(plain), bodyClass: document.body.className,
               lowBg: cs.backgroundColor, ph: getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() };
    })()`);
    await sleep(320);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(outDir, `${skin.key}-${scheme}.png`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    /* 截图后立刻再读一次计算背景色：采样出的像素背景必须与它一致，
       否则说明抓在了动画中途（上一次实测 super/light 就被白纱污染过），采样结果不可信。 */
    const after = await cdp.eval(`(() => {
      const td = document.getElementById('phLow').querySelector('td');
      return { lowBg: getComputedStyle(td).backgroundColor };
    })()`);
    results.push({ skin: skin.key, cls: skin.cls, scheme, file, geo: { ...geo, lowBgAfter: after.lowBg }, dsf: DSF });
  }
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(results, null, 2), 'utf8');

  /* 采样 + 算对比度 */
  const rep = spawnSync(PY, [path.join(WORK, 'test', 'hours_ph_sample.py'), path.join(outDir, 'manifest.json')],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  process.stdout.write(rep.stdout || '');
  if (rep.status !== 0) { console.error(rep.stderr || ''); process.exit(1); }

  try { cdp?.ws.close(); } catch {}
  chrome?.kill('SIGKILL');
  if (server && server.close) server.close(); else if (server) server.kill('SIGKILL');
  chrome = null; server = null;
  await rm(outDir, { recursive: true, force: true }).catch(() => {});
  console.log('\n✅ 黄底 placeholder 对比度检查完成');
} catch (e) {
  console.error('\n💥 中断：' + (e && e.message ? e.message : e));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  if (chrome) chrome.kill('SIGKILL');
  if (server && server.close) server.close(); else if (server && server.kill) server.kill('SIGKILL');
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
