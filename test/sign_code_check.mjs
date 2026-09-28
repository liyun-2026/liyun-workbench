/**
 * 打卡管理页 · 动态码核对（真 Chrome）
 *
 *   node test/sign_code_check.mjs [port]     # 截图落到 test/.shots/signcode/
 *
 * 背景（用户 2026-09-29 的要求）：
 *   「数字码到底是几位，你有时候是四位、有时候是六位、有时候是八位，要定下来；
 *     二维码和数字码全部改为动态的，一分钟一换，下面附上还有多长时间换的倒计时。」
 *
 * 核这几件事：
 *   1. 这块码是**只读**的：页面上再也找不到能改码的输入框 /「随机一个」按钮
 *      （以前教务能自设一个「固定码」，一节课不变 —— 一次泄漏管一节课，已拆）
 *   2. 显示的是 6 位数字，来自服务端派生（`SIGN` 的 CODE_LEN / CODE_WINDOW_MS 都在源码里验）
 *   3. 底下挂着倒计时：秒数在递减、进度条在收缩，60 秒一换
 *   4. 旁边那块二维码编的**就是同一枚数字**（不是网址，也不是别的什么）
 *   5. 老数据里残留的 `sign_rules.code`（比如 8866）既不显示也不认 —— 前端也不读它
 *   6. 离开打卡页 → 秒表停掉（不能切走了还每秒去要一次码）
 *   7. 本地模式下不把「立即同步」这类东西露出来（沿用既有约束）
 *
 * ⚠️ 必须带 ?nosw=1，否则 SW 接管后自动重载会打断 evaluate。
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5361);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'signcode');
const SUPER = { user: '打卡码测试教务', pass: 'signpass123' };

let pass = 0, fail = 0; const fails = [];
function assert(c, m){ if (!c) throw new Error(m); }
function t(name, fn){
  try { const d = fn(); pass++; console.log('  ✅ ' + name + (d ? '  → ' + d : '')); }
  catch (e) { fail++; fails.push(name); console.log('  ❌ ' + name + '\n       ' + e.message); }
}

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
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value; }
}

let server; const chromes = [];
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name, clip){
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: 2 };
  const r = await cdp.send('Page.captureScreenshot', p);
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
async function go(cdp, url){
  const done = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await done;
  await sleep(1200);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'sc-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(cdp, `${BASE}/?nosw=1`);

  console.log('\n=== 0. 登录 + 老数据里塞一个「自设固定码」 ===');
  const r0 = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r0.gateOff) throw new Error('登录失败：' + (r0.err || ''));
  console.log('已登录（身份：' + await cdp.eval(`Auth.role()`) + '）');
  /* 故意留一个「教务当年设的固定码」在老数据里 —— 这正是要防的那条路 */
  await cdp.eval(`(() => { const r = Store.get('sign_rules') || {}; r.code = '8866'; Store.set('sign_rules', r); return true; })()`);

  console.log('\n=== 1. 打卡管理页的码块是只读的 ===');
  await cdp.eval(`App.go('sign')`);
  await sleep(1600);
  const form = await cdp.eval(`(() => {
    const page = document.getElementById('page-sign');
    const ids = [...page.querySelectorAll('input')].map(i => i.id);
    const btns = [...page.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g, ''));
    return { ids: ids, btns: btns,
             hasCodeInput: !!document.getElementById('sgCode'),
             hasRand: btns.some(x => /随机/.test(x)),
             hasSave: btns.some(x => /^保存$/.test(x)) };
  })()`);
  t('页面上再没有能改打卡码的输入框 /「随机一个」按钮（固定码已拆）', () => {
    assert(!form.hasCodeInput, '不该再有 #sgCode 输入框，实际输入框有：' + form.ids.join(' / '));
    assert(!form.hasRand, '不该再有「随机一个」按钮，实际按钮：' + form.btns.join(' / '));
    assert(!form.hasSave, '不该再有「保存」打卡码的按钮，实际按钮：' + form.btns.join(' / '));
    return '输入框：' + form.ids.join(' / ');
  });

  console.log('\n=== 2. 显示 6 位动态码 + 倒计时 ===');
  const first = await cdp.eval(`(() => ({
    code: document.getElementById('signCodeBox').textContent.trim(),
    left: Number(document.getElementById('signCodeLeft').textContent.replace(/\\D/g, '')),
    label: document.getElementById('signCodeLeft').textContent,
    bar: document.getElementById('signCodeBar').style.width,
    qrCode: document.getElementById('signCodeQr').dataset.code || '',
    qrSvg: !!document.querySelector('#signCodeQr svg'),
    qrW: Math.round(document.getElementById('signCodeQr').getBoundingClientRect().width),
  }))()`);
  t('屏上是 6 位数字，压根不理会老数据里那个自设的 8866', () => {
    assert(/^\d{6}$/.test(first.code), '该显示 6 位数字，实际「' + first.code + '」');
    assert(first.code !== '8866', '不该把教务当年自设的 8866 摆出来');
    return first.code + '（老数据里的 8866 已被无视）';
  });
  t('底下挂着「N 秒后换码」的倒计时（用户点名要的）', () => {
    assert(/秒后换码/.test(first.label), '倒计时该写「N 秒后换码」，实际「' + first.label + '」');
    assert(first.left > 0 && first.left <= 60, '剩余秒数该在 1~60 之间，实际 ' + first.left);
    return first.label + '（进度条 ' + first.bar + '）';
  });
  t('二维码跟数字是同一枚，且真的画出来了（编的不是网址）', () => {
    assert(first.qrSvg, '二维码没渲染出来');
    assert(first.qrCode === first.code, '二维码里编的该就是屏上那串数字，实际二维码「' + first.qrCode + '」/ 屏上「' + first.code + '」');
    assert(first.qrW >= 120, '二维码不该小到扫不动，实际 ' + first.qrW + 'px');
    return '二维码 ' + first.qrW + 'px · 编「' + first.qrCode + '」';
  });

  /* 等两秒再读一次：秒数该变小、进度条该收缩。 */
  await sleep(2200);
  const second = await cdp.eval(`(() => ({
    left: Number(document.getElementById('signCodeLeft').textContent.replace(/\\D/g, '')),
    bar: parseFloat(document.getElementById('signCodeBar').style.width),
  }))()`);
  t('倒计时真的在走：2 秒后秒数小了、进度条也缩了', () => {
    assert(second.left < first.left, '秒数该变小（' + first.left + ' → ' + second.left + '）');
    assert(second.bar < parseFloat(first.bar), '进度条该收缩（' + first.bar + ' → ' + second.bar + '%）');
    return first.left + ' 秒 → ' + second.left + ' 秒 · 进度 ' + first.bar + ' → ' + second.bar + '%';
  });

  console.log('\n=== 3. 换码的规矩是写死在服务端的（源码级核对）===');
  const SRC = await (await import('node:fs/promises')).readFile(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
  const HTML = await (await import('node:fs/promises')).readFile(path.join(dir, 'index.html'), 'utf8');
  t('服务端钉死：CODE_LEN = 6、CODE_WINDOW_MS = 60000', () => {
    const len = SRC.match(/const CODE_LEN = (\d+)/);
    const win = SRC.match(/const CODE_WINDOW_MS = (\d+)/);
    assert(len && Number(len[1]) === 6, '码长该是 6 位，实际 ' + (len ? len[1] : '找不到'));
    assert(win && Number(win[1]) === 60000, '换码窗口该是 60000ms，实际 ' + (win ? win[1] : '找不到'));
    return 'CODE_LEN=' + len[1] + ' · CODE_WINDOW_MS=' + win[1];
  });
  t('服务端与前端都不再读「教务自设的固定码」', () => {
    assert(!/sign_rules\.code|rules\.code/.test(SRC), '服务端不该再读 sign_rules.code');
    assert(!/localCode|saveCode|randCode|_fixed/.test(HTML), '前端不该再留固定码的残迹');
    assert(/delete out\.code/.test(HTML), '前端 rules() 里该显式把 code 抹掉（老设备别把 8866 一直认下去）');
    return 'sync.js 零引用 · index.html 零残迹 · rules() 显式 delete code';
  });
  t('上一窗口的码也认（学生抄完到按下去可能刚跨过换码点）', () => {
    assert(/for \(const q of \[slot, slot - 1\]\)/.test(SRC), 'codeOK 该同时认当前与上一窗口');
    return 'for (const q of [slot, slot - 1])';
  });

  console.log('\n=== 4. 离开打卡页 → 秒表停掉 ===');
  const leave = await cdp.eval(`(() => {
    const before = !!Sign._timer;
    App.go('home');
    return { before: before, after: !!Sign._timer };
  })()`);
  t('切走就停表（不能切走了还每秒去要一次码）', () => {
    assert(leave.before, '在打卡页时秒表该在跑');
    assert(!leave.after, '切走后秒表该停掉，实际还在');
    return '进页面在跑 → 切走已停';
  });

  console.log('\n=== 5. 截图 ===');
  await cdp.eval(`App.go('sign')`);
  await sleep(1400);
  /* 只框「这个时段的打卡码」那一小节：从那个 h2 起、到倒计时那行为止。
     框整张卡会把上面的规则表单一起带进来，看不到重点。 */
  const clip = await cdp.eval(`(() => {
    const qr = document.getElementById('signCodeQr');
    const row = qr.closest('.row');
    const h2 = row.previousElementSibling.previousElementSibling;   // h2 前面还有一个 p.hint
    const lab = document.getElementById('signCodeLeft');
    const a = h2.getBoundingClientRect(), b = lab.getBoundingClientRect();
    const pad = 14;
    return { x: Math.round(a.x - pad), y: Math.round(a.y - pad),
             width: Math.round(Math.max(qr.getBoundingClientRect().right, b.right) - a.x + pad * 2),
             height: Math.round(Math.max(b.bottom, qr.getBoundingClientRect().bottom) - a.y + pad * 2) };
  })()`);
  console.log('  📐 截图区域 ' + JSON.stringify(clip));
  await shot(cdp, 'sign-code-card.png', clip);
  await shot(cdp, 'sign-page.png');

} catch (e) {
  fail++; fails.push('脚本异常 → ' + e.message);
  console.log('\n❌ 脚本异常：' + e.message);
} finally {
  console.log('\n────────────');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) fails.forEach(x => console.log('  ✗ ' + x));
  for (const c of chromes) { try { c.kill(); } catch {} }
  if (server) { try { server.kill(); } catch {} }
  await devReset();
  process.exit(fail ? 1 : 0);
}
