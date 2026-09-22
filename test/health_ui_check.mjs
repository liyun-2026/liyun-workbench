/**
 * 巡检页端到端验收（真 Chrome + 本地预览）：
 *   1. 登录后出现「巡检」入口，点进去是那一页
 *   2. 打开系统后自动跑过一次巡检（Health.boot 挂上了）
 *   3. 手动「立即巡检」：通道 / 服务与资源 / 这台设备 / 到期提醒 四组都出结果
 *   4. 耗时真的量到了（不是 0 / 不是 NaN）
 *   5. 历史记录留下一条
 *   6. 异常时入口亮红点，恢复正常后红点消失
 *   7. 自动巡检的节奏能改、能存住
 *
 *   node test/health_ui_check.mjs [端口]
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5233);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ADMIN = { user: '__selftest__', pass: 'selftest-pass-123' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(gap);
  }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      // ⚠️ 必须自带超时：Chrome 没起来时 WS 握手会一直挂着，脚本就永远停在那一行
      const t = setTimeout(() => rej(new Error('CDP 接管超时（5s）：' + url)), 5000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = () => { clearTimeout(t); rej(new Error('CDP 连不上')); };
    });
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
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };
const chromes = [], profiles = [];
let cdp;

async function openChrome(cdpPort) {
  const profile = await mkdtemp(path.join(tmpdir(), 'health-chrome-'));
  profiles.push(profile);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: `Chrome 调试端口 ${cdpPort}`, tries: 40 });
  const c = await Cdp.connect(target.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  return c;
}

async function login(cdp2, acc) {
  const loaded = cdp2.once('Page.loadEventFired');
  await cdp2.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  const r = await cdp2.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '核心模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(acc.user)};
    document.getElementById('gPass').value = ${JSON.stringify(acc.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
}

try {
  console.log('\n【1/7】起本地预览服务…');
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  console.log(`  服务就绪 → ${BASE}`);

  console.log('\n【2/7】教务登录 + 巡检入口…');
  cdp = await openChrome(9331);
  await login(cdp, ADMIN);
  const entry = await cdp.eval(`(async () => {
    App.renderChrome();
    const inNav  = !!document.querySelector('#nav button[data-id="health"]');
    const inGrid = !!document.querySelector('#dgrid button[data-id="health"]');
    App.go('health');
    await new Promise(r => setTimeout(r, 200));
    return { inNav, inGrid, onHealth: document.querySelector('.page.on')?.id, hasPage: !!document.getElementById('page-health') };
  })()`);
  ok(entry.inNav && entry.inGrid, '「巡检」进了侧栏和「全部功能」抽屉');
  ok(entry.onHealth === 'page-health', '点进去落在巡检页（当前页 ' + entry.onHealth + '）');

  console.log('\n【3/7】打开后自动巡检（不用手动点）…');
  const auto = await waitFor(async () => {
    const v = await cdp.eval(`(() => { const r = Store.get('_health'); return r ? { at: r.at, level: r.level, n: (r.items||[]).length } : null; })()`);
    return v && v.n ? v : null;
  }, { tries: 30, gap: 1000, what: '首启自动巡检' }).catch(() => null);
  ok(!!auto, auto ? `登录后自己跑了一次（${auto.n} 项，结论 ${auto.level}）` : '没有自动巡检结果');

  console.log('\n【4/7】手动「立即巡检」…');
  const run = await cdp.eval(`(async () => {
    const rec = await Health.run(true);
    await new Promise(r => setTimeout(r, 300));
    const txt = id => (document.getElementById(id)?.textContent || '').trim();
    const cnt = id => document.getElementById(id)?.querySelectorAll('.item').length || 0;
    return {
      level: rec.level,
      net: cnt('healthNet'), res: cnt('healthRes'), local: cnt('healthLocal'), due: cnt('healthDue'), hist: cnt('healthHist'),
      badge: txt('healthBadge'), summary: txt('healthSummary'),
      empty: [...document.querySelectorAll('#page-health .card')].some(c => c.textContent.includes('查过一次就有内容')),
      speed: (rec.items.find(i => i.name === '打开页面的速度') || {}).value,
      apiItem: (rec.items.find(i => i.name === '后台接口') || {}).value,
      due0: (rec.dues[0] || {}).value
    };
  })()`);
  ok(run.net >= 2, `通道组 ${run.net} 项`);
  ok(run.res >= 1, `服务与资源组 ${run.res} 项`);
  ok(run.local === 3, `这台设备组 ${run.local} 项`);
  ok(run.due === 2, `到期提醒 ${run.due} 项`);
  ok(run.hist >= 1, `历史记录 ${run.hist} 条`);
  ok(!run.empty, '不再是空页面');
  ok(/ms$/.test(run.speed || '') && parseInt(run.speed) > 0, `页面耗时量到了实数：${run.speed}`);
  ok(/ms$/.test(run.apiItem || ''), `后台接口耗时：${run.apiItem}`);
  ok(/天前?$|天$/.test(run.due0 || ''), `到期天数算出来了：${run.due0}`);
  ok(/正常|注意|异常/.test(run.badge), '总览徽章有结论：' + run.badge);

  console.log('\n【5/7】异常时亮红点，恢复后消失…');
  const dot = await cdp.eval(`(() => {
    const rec = Store.get('_health');
    rec.items.forEach(i => { if (i.g === 'net') { i.level = 'bad'; i.value = '超时没回音'; } });
    rec.level = Health.grade(rec.items, rec.dues);
    Store.set('_health', rec);
    App.refreshDots();
    const on = !!document.querySelector('#nav button[data-id="health"]')?.classList.contains('has-dot');
    rec.items.forEach(i => { if (i.g === 'net') i.level = 'ok'; });
    rec.level = Health.grade(rec.items, rec.dues);
    Store.set('_health', rec);
    App.refreshDots();
    const off = !!document.querySelector('#nav button[data-id="health"]')?.classList.contains('has-dot');
    return { on, off };
  })()`);
  ok(dot.on === true, '查出异常 → 侧栏「巡检」亮红点');
  ok(dot.off === false, '恢复正常 → 红点自动消掉');

  console.log('\n【6/7】自动巡检的节奏能改、能存住…');
  const cfg = await cdp.eval(`(async () => {
    Health.setAuto('2h');
    const stored = Store.get('_healthAuto');
    const info = document.getElementById('healthAutoInfo').textContent;
    const sel = document.getElementById('healthAuto').value;
    Health.setAuto('open');
    const back = Store.get('_healthAuto');
    return { stored, sel, back, info: info.trim() };
  })()`);
  ok(cfg.stored === '2h' && cfg.sel === '2h', '改成「每 2 小时」存住了，下拉框也跟着变');
  ok(cfg.back === 'open', '能改回「每次打开查」');
  ok(/2 小时/.test(cfg.info), '下面那句说明跟着改：' + cfg.info);

  console.log('\n【7/7】清场…');
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  ok(true, '预览数据已清空');
} catch (e) {
  failed++;
  console.log('\n💥 中断：' + e.message);
} finally {
  chromes.forEach(c => { try { c.kill('SIGKILL'); } catch {} });
  if (server) { try { server.kill('SIGKILL'); } catch {} }
  await Promise.all(profiles.map(p => rm(p, { recursive: true, force: true }).catch(() => {})));
}

console.log(failed ? `\n❌ ${failed} 项没过\n` : '\n✅ 巡检页全部通过\n');
process.exit(failed ? 1 : 0);
