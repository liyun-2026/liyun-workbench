/**
 * 每日新闻真浏览器验收
 *
 *   node test/news_browser_test.mjs [端口]
 *   NEWS_TARGET=https://liyun2026.top node test/news_browser_test.mjs
 *                                                            # 打线上（不建号，只看登录页不可行——
 *                                                              新闻在登录后的首页，所以打线上时请自备
 *                                                              NEWS_USER / NEWS_PASS 环境变量）
 *
 * 为什么非要开真浏览器：新闻走 <script> 标签拉央视 JSONP，
 * jsdom 连 script 远程加载都不可靠，模拟出来的「通过」是假的。
 *
 * 流程：
 *   1. 起本地预览服务（真 sync.js），先 dev-reset 保证干净
 *   2. 真 Chrome（无头）打开页面
 *   3. 用一次性账号 __selftest__ 登录（首个账号=首位教务）
 *   4. 等首页新闻卡片真正渲染出条目（央视接口回调名写死为 news，
 *      曾经因为注册了随机名回调而永远转圈——本脚本就是钉死这个回归）
 *   5. 判定 + dev-reset 清场
 *
 * 通过标准：新闻卡片出现 ≥1 条新闻，meta 里有今天日期。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5210);
const TARGET = (process.env.NEWS_TARGET || '').replace(/\/$/, '');
const BASE = TARGET || `http://127.0.0.1:${PORT}`;
const CDP = 9335;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER = process.env.NEWS_USER || '__selftest__';
const PASS = process.env.NEWS_PASS || 'selftest-pass-123';
const TODAY = new Date();
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

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
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面里报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let server, chrome, profile, cdp, failed = 0;
const ok = (c, m) => { console.log((c ? '  ✅ ' : '  ❌ ') + m); if (!c) failed++; };

/** 本地模式：dev-reset 清场（打线上时跳过，绝不动生产数据） */
async function devReset() {
  if (TARGET) return;
  try { await fetch(`http://127.0.0.1:${PORT}/api/dev-reset`, { method: 'POST' }); } catch {}
}

try {
  console.log('\n【1/5】起本地预览服务（真 sync.js）…');
  if (TARGET) {
    console.log('  打线上，跳过本地服务');
  } else {
    server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
    await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
    await devReset();
    console.log(`  服务就绪 → http://127.0.0.1:${PORT}（已重置为干净状态）`);
  }

  console.log('\n【2/5】起真 Chrome（无头）…');
  profile = await mkdtemp(path.join(tmpdir(), 'news-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  console.log('  页面已打开');

  console.log('\n【3/5】登录（一次性账号）…');
  const login = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined' || typeof Store === 'undefined') return { err: '页面核心模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(USER)};
    document.getElementById('gPass').value = ${JSON.stringify(PASS)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1200));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), mode: Auth.mode, err: document.getElementById('gErr').textContent };
  })()`);
  if (login.err) { ok(false, login.err); throw new Error('无法继续'); }
  ok(login.gateOff, `登录成功进入工作台（模式：${login.mode}）${login.err ? '，提示：' + login.err : ''}`);

  console.log('\n【4/5】等首页新闻卡片真渲染出来（最多 25 秒）…');
  const news = await cdp.eval(`(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      const meta = (document.getElementById('newsMeta') || {}).textContent || '';
      const n = document.querySelectorAll('#newsBody .item').length;
      if (n > 0) {
        const titles = [...document.querySelectorAll('#newsBody .item a, #newsBody .item .grow')].slice(0, 3)
          .map(e => e.textContent.trim().slice(0, 24));
        return { n, meta, titles, ms: Math.round(performance.now() - t0), body: (document.getElementById('newsBody') || {}).textContent || '' };
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return { n: 0, meta: (document.getElementById('newsMeta') || {}).textContent || '',
             body: ((document.getElementById('newsBody') || {}).textContent || '').trim() };
  })()`);

  console.log('\n【5/5】判定 …');
  if (news.n > 0) {
    console.log(`  用时 ${(news.ms / 1000).toFixed(1)} 秒；meta：${news.meta}`);
    console.log(`  前几条：${JSON.stringify(news.titles)}`);
  } else {
    console.log(`  卡片内容：${JSON.stringify(news.body.slice(0, 120))}`);
  }
  ok(news.n > 0, `新闻渲染出 ${news.n} 条（曾因 JSONP 回调名不匹配永远转圈）`);
  ok((news.meta || '').includes(today), `meta 含今天日期（${today}）`);
  ok(news.n === 0 || !/没拉到|网络问题/.test(news.body), '没有落进失败提示');

  console.log(failed ? `\n❌ 有 ${failed} 项没过\n` : '\n✅ 每日新闻全流程通过\n');
} catch (e) {
  console.error('\n💥 测试中断：' + (e && e.message) + '\n');
  failed++;
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.kill('SIGKILL');
  server?.kill('SIGKILL');
  if (!TARGET) await devReset();   // 清掉一次性账号
  if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
