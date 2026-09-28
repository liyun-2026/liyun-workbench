/**
 * 量化细则拆页核对（真 Chrome）
 *
 *   node test/rules_page_check.mjs        # 截图落到 test/.shots/rules/
 *
 * 核四件事：
 *   1. 设置页只剩一张入口卡（量一下页高，确认那张长表真的搬走了）
 *   2. 侧栏 / 底栏 / 全部功能抽屉三处都找不到「量化细则」（只能从设置卡进）
 *   3. 点「打开量化细则」能进 page-rules，近 30 条都在，加减分/加一条/删一条都能用
 *   4. 「返回设置」能回来
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 本机 127.0.0.1 一律不走系统代理（机器上装了代理软件会把 fetch 劫持挂死） */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5321);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'rules');
const SUPER = { user: '细则测试教务', pass: 'rulespass123' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(5000) });
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
const pass = [], fail = [];
const t = (name, fn) => {
  try { const v = fn(); pass.push(name); console.log('  ✅ ' + name + (v !== undefined && v !== true ? '  → ' + v : '')); }
  catch (e) { fail.push(name + ' → ' + e.message); console.log('  ❌ ' + name + ' → ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }

async function shot(cdp, name){
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, name);
  await writeFile(f, Buffer.from(r.data, 'base64'));
  shots.push(f);
  console.log('  📸 ' + name);
}

try {
  await mkdir(OUT, { recursive: true });

  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'rules-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5322', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const loaded = cdp.once('Page.loadEventFired');
  /* ⚠️ 必须带 ?nosw=1：新 Chrome 里 sw.js 一注册就会 controllerchange → 整页 reload，
     正好撞在下面登录那段 await 上，CDP 会报 "Inspected target navigated or closed"。 */
  await cdp.send('Page.navigate', { url: `${BASE}/?nosw=1` });
  await loaded;

  const r = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent, mode: Auth.mode };
  })()`);
  if (!r.gateOff) throw new Error('登录失败：' + (r.err || ''));
  console.log('已登录（模式：' + r.mode + '，身份：' + await cdp.eval(`Auth.role()`) + '）');

  /* ══ 1. 设置页 ══ */
  console.log('\n=== 1. 设置页：只剩一张入口卡 ===');
  await cdp.eval(`App.go('settings')`);
  await sleep(900);

  const set = await cdp.eval(`(() => {
    const card = document.getElementById('rulesCard');
    const page = document.getElementById('page-settings');
    return {
      cardShown: card && getComputedStyle(card).display !== 'none',
      cardText: card ? card.textContent.replace(/\\s+/g, ' ').trim() : '',
      btn: card ? card.querySelector('button').textContent.trim() : '',
      hasList: !!document.querySelector('#page-settings #rulesList'),
      hasAddRow: !!document.querySelector('#page-settings #ruleSrc'),
      pageH: page.scrollHeight,
      mainH: document.getElementById('main').clientHeight,
    };
  })()`);
  t('设置页里已经没有那张长表', () => {
    assert(set.cardShown, '入口卡该显示出来（教务端）');
    assert(!set.hasList && !set.hasAddRow, '长表和加减分那行都该搬走');
    assert(set.btn === '打开量化细则', '按钮文案该是「打开量化细则」，实际「' + set.btn + '」');
    assert(/共 \d+ 条计分项/.test(set.cardText), '卡上该报条数：' + set.cardText);
    return '卡上文案「' + set.cardText.replace('打开量化细则', '') + '」';
  });
  console.log('     设置页内容高 %d px（手机视口 %d px）', set.pageH, set.mainH);
  const cards = await cdp.eval(`[...document.querySelectorAll('#page-settings .card')]
    .filter(c => getComputedStyle(c).display !== 'none')
    .map(c => ({ h: Math.round(c.getBoundingClientRect().height), t: (c.querySelector('h2') ? c.querySelector('h2').textContent : c.textContent).replace(/\\s+/g, ' ').trim().slice(0, 14) }))
    .sort((a, b) => b.h - a.h)`);
  console.log('     设置页各卡高度（高→低）：' + cards.map(c => `${c.t} ${c.h}px`).join(' / '));
  await shot(cdp, 'm-settings.png');

  /* ══ 2. 导航里没有它 ══ */
  console.log('\n=== 2. 三处导航都找不到「量化细则」===');
  const nav = await cdp.eval(`(() => {
    const grab = sel => [...document.querySelectorAll(sel)].map(b => b.dataset.id);
    App.drawer(true);
    const out = { nav: grab('#nav button'), tabs: grab('#tabs button'), dgrid: grab('#dgrid button') };
    App.drawer(false);
    return out;
  })()`);
  t('侧栏 / 底栏 / 全部功能抽屉 都没有 rules，也搜不到这四个字', () => {
    ['nav', 'tabs', 'dgrid'].forEach(k => assert(!nav[k].includes('rules'), k + ' 里出现了 rules：' + nav[k].join(',')));
    return 'nav ' + nav.nav.length + ' 项 / tabs ' + nav.tabs.length + ' 项 / drawer ' + nav.dgrid.length + ' 项';
  });
  await shot(cdp, 'm-drawer.png');

  /* ══ 3. 进细则页，加减分能改 ══ */
  console.log('\n=== 3. 打开量化细则：近 30 条都在，能改能加能删 ===');
  await cdp.eval(`App.go('settings')`); await sleep(300);
  await cdp.eval(`document.querySelector('#rulesCard button').click()`); await sleep(900);
  const opened = await cdp.eval(`(() => {
    const on = document.getElementById('page-rules').classList.contains('on');
    const rows = [...document.querySelectorAll('#rulesList .row')];
    return {
      on, rows: rows.length,
      auto: document.querySelectorAll('#rulesList .row').length,
      hasSave: !!document.querySelector('#page-rules button[onclick*="saveRules"]'),
      hasBack: !![...document.querySelectorAll('#page-rules button')].find(b => b.textContent.includes('返回设置')),
      pageH: document.getElementById('page-rules').scrollHeight,
    };
  })()`);
  t('点入口卡能进细则页，条目齐、有保存、有返回', () => {
    assert(opened.on, '该切到 page-rules');
    assert(opened.rows >= 25, '近 30 条该都在，实际 ' + opened.rows);
    assert(opened.hasSave && opened.hasBack, '该有保存细则和返回设置');
    return opened.rows + ' 条 / 页高 ' + opened.pageH + 'px';
  });
  await shot(cdp, 'm-rules.png');

  const edit = await cdp.eval(`(async () => {
    Settings.initRules(); Settings.renderRules();
    const row = document.querySelector('#rulesList .row');
    const rid = row.dataset.rid;
    const old = Store.list('quant_rules').find(x => x.id === rid).delta;
    row.querySelector('.rule-delta').value = String(old + 5);
    Settings.saveRules();
    const after = Store.list('quant_rules').find(x => x.id === rid).delta;
    // 加一条
    const n0 = Store.list('quant_rules').length;
    document.getElementById('ruleSrc').value = 'cls';
    document.getElementById('ruleName').value = '真机测试名目';
    document.getElementById('ruleDelta').value = '-4';
    Settings.addRule();
    const n1 = Store.list('quant_rules').length;
    const made = Store.list('quant_rules').some(x => x.key === 'cls:真机测试名目' && x.delta === -4);
    // 删掉
    Settings.delRule('r_cls:真机测试名目');
    const n2 = Store.list('quant_rules').length;
    return { old, after, n0, n1, n2, made, toast: document.getElementById('toast') ? document.getElementById('toast').textContent : '' };
  })()`);
  t('改分值 → 保存 → 落库；加一条 / 删一条都对', () => {
    assert(edit.after === edit.old + 5, `改分值没生效：${edit.old} → ${edit.after}`);
    assert(edit.n1 === edit.n0 + 1 && edit.made, '加一条没成功');
    assert(edit.n2 === edit.n0, '删一条没成功');
    return `分值 ${edit.old}→${edit.after}，条数 ${edit.n0}→${edit.n1}→${edit.n2}`;
  });

  /* ══ 4. 返回设置 ══ */
  console.log('\n=== 4. 返回设置 ===');
  await cdp.eval(`[...document.querySelectorAll('#page-rules button')].find(b => b.textContent.includes('返回设置')).click()`);
  await sleep(700);
  const backOk = await cdp.eval(`document.getElementById('page-settings').classList.contains('on')`);
  t('能回到设置页', () => {
    assert(backOk, '该切回设置');
    return true;
  });

  /* ══ 5. 电脑端 ══ */
  console.log('\n=== 5. 电脑端（侧栏也不该有量化细则）===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await cdp.eval(`App.go('settings')`); await sleep(700);
  const dnav = await cdp.eval(`[...document.querySelectorAll('#nav button')].map(b => b.dataset.id)`);
  t('电脑侧栏没有 rules', () => { assert(!dnav.includes('rules'), '侧栏出现了 rules：' + dnav.join(',')); return dnav.length + ' 项'; });
  await shot(cdp, 'd-settings.png');
  await cdp.eval(`App.go('rules')`); await sleep(800);
  await shot(cdp, 'd-rules.png');

  console.log('\n' + (fail.length ? '❌ ' + fail.length + ' 项失败' : '✅ 全部通过（' + pass.length + ' 项）'));
} catch (e) {
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
