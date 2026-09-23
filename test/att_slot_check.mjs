/**
 * 考勤时段端到端验收（真 Chrome + 本地预览）：
 *   1. 考勤页有「本次是」时段下拉，默认上午 / 下午两项
 *   2. 上午和下午各记各的，互不覆盖
 *   3. 「一键全部正常」下面那句话带日期和时段，数字跟着登记情况变
 *   4. 一键全部正常只动当前时段，别的时段不动
 *   5. 量化按当天最重的一次算，不会一天扣两遍
 *   6. 按日期区间导出：明细 CSV 与汇总 CSV 都对
 *   7. 设置页能加 / 删考勤时段，考勤页下拉跟着变
 *
 *   node test/att_slot_check.mjs [端口]
 *
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5245);
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
  const profile = await mkdtemp(path.join(tmpdir(), 'att-chrome-'));
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

  console.log('\n【2/7】教务登录 + 造一个班两个学员…');
  cdp = await openChrome(9341);
  await login(cdp, ADMIN);
  const seed = await cdp.eval(`(() => {
    Store.upsert('classes',  { id:'c1', name:'测试一班' });
    Store.upsert('students', { id:'s1', name:'张三', classId:'c1' });
    Store.upsert('students', { id:'s2', name:'李四', classId:'c1' });
    if (typeof Settings !== 'undefined' && Settings.initRules) Settings.initRules();
    const d = Util.today();
    Store.set('_attCls', 'c1'); Store.set('_attDate', d); Store.set('_attSlot', 'am');
    App.go('att');
    Att.render();
    const opts = [...document.querySelectorAll('#attSlot option')].map(o => o.value);
    return { slots: Att.SLOTS().map(s => s.name), opts, date: d };
  })()`);
  ok(seed.slots.length === 2 && seed.slots[0] === '上午' && seed.slots[1] === '下午', '默认两个时段：' + seed.slots.join('、'));
  ok(seed.opts.join(',') === 'am,pm,*', '考勤页下拉有上午/下午/全部时段（' + seed.opts.join(',') + '）');

  console.log('\n【3/7】上午、下午各记各的，互不覆盖…');
  const split = await cdp.eval(`(() => {
    const d = Store.get('_attDate');
    Store.set('_attSlot', 'am'); Att.mark('s1', '迟到');
    Store.set('_attSlot', 'pm'); Att.mark('s1', '正常');
    const am = Att.byStu(d, 'am'), pm = Att.byStu(d, 'pm');
    Store.set('_attSlot', 'am'); Att.render();
    const sumAm = document.getElementById('attSum').textContent;
    Store.set('_attSlot', 'pm'); Att.render();
    const sumPm = document.getElementById('attSum').textContent;
    Store.set('_attSlot', '*'); Att.render();
    const sumAll = document.getElementById('attSum').textContent;
    return { amS1: am['s1'], pmS1: pm['s1'], sumAm, sumPm, sumAll, n: Store.list('att:' + d).length };
  })()`);
  ok(split.amS1 === '迟到' && split.pmS1 === '正常', '同一人上午迟到、下午正常，两条都在（没有互相盖掉）');
  ok(split.n === 2, '这一天存了 ' + split.n + ' 条记录');
  ok(split.sumAm.includes('上午考勤') && split.sumAm.includes('迟到 1'), '小字说的是上午这次：' + split.sumAm.slice(0, 40).replace(/\n/g, ' / '));
  ok(split.sumPm.includes('下午考勤') && split.sumPm.includes('正常 1'), '小字跟着时段换成下午：' + split.sumPm.slice(0, 40).replace(/\n/g, ' / '));
  ok(split.sumAll.includes('全部时段'), '选「全部时段」时小字也变了：' + split.sumAll.slice(0, 30).replace(/\n/g, ' / '));

  console.log('\n【4/7】一键全部正常只动当前时段…');
  const oneKey = await cdp.eval(`(() => {
    const d = Store.get('_attDate');
    Store.set('_attSlot', 'pm'); Att.render();
    Att.allNormal();
    const pmS1 = Att.byStu(d, 'pm')['s1'];
    const pmS2 = Att.byStu(d, 'pm')['s2'];
    const amS1 = Att.byStu(d, 'am')['s1'];
    const amS2 = Att.byStu(d, 'am')['s2'];
    Store.set('_attSlot', 'am'); Att.render();
    const sum = document.getElementById('attSum').textContent;
    return { pmS1, pmS2, amS1, amS2, sum };
  })()`);
  ok(oneKey.pmS1 === '正常' && oneKey.pmS2 === '正常', '下午全部标成正常');
  ok(oneKey.amS1 === '迟到', '上午那条「迟到」没被动过');
  ok(oneKey.amS2 === undefined, '上午没登记的仍然留空（没被一键带过去）');
  ok(oneKey.sum.includes('未登记 1'), '小字里的未登记人数跟着变：' + oneKey.sum.slice(0, 46).replace(/\n/g, ' / '));

  console.log('\n【5/7】量化按当天最重的一次算，一天不扣两遍…');
  const quant = await cdp.eval(`(() => {
    const d = Store.get('_attDate');
    // 清掉前面的测试留下来的痕迹，重新摆一个「上午迟到 + 下午正常」
    Store.list('att:' + d).forEach(r => Store.softDelete('att:' + d, r.id));
    Store.set('_attSlot', 'am'); Att.mark('s1', '迟到');
    Store.set('_attSlot', 'pm'); Att.mark('s1', '正常');
    Att.syncQuant(d);
    const logs = Store.list('quant_log').filter(x => x._src === 'att' && x.date === d && !x._d);
    Att.syncQuant(d); Att.syncQuant(d);
    const again = Store.list('quant_log').filter(x => x._src === 'att' && x.date === d && !x._d);
    const worst = Att.worst(d)['s1'];
    return { n: logs.length, delta: (logs[0] || {}).delta, again: again.length, worst };
  })()`);
  ok(quant.worst === '迟到', '上午迟到 + 下午正常 → 当天取最重的一次：' + quant.worst);
  ok(quant.n === 1 && quant.delta === -2, '量化记了一条扣分（' + quant.delta + '），不是两条');
  ok(quant.again === 1, '反复重算也不会重复记（仍然 ' + quant.again + ' 条）');

  console.log('\n【6/7】按日期区间导出…');
  const exp = await cdp.eval(`(() => {
    const d = Store.get('_attDate');
    const orig = Util.download; window.__csv = null;
    Util.download = (name, text) => { window.__csv = { name, text }; };
    document.getElementById('attFrom').value = d;
    document.getElementById('attTo').value = d;
    document.getElementById('attRangeSlot').value = '*';
    Att.exportRange();
    const detail = window.__csv;
    const statDetail = document.getElementById('attExpStat').textContent;
    Att.exportRangeSum();
    const sum = window.__csv;
    Util.download = orig;
    const dl = (detail && detail.text || '').trim().split('\\n');
    const sl = (sum && sum.text || '').trim().split('\\n');
    return {
      dName: detail && detail.name, dHead: dl[0], dRows: dl.length - 1, dSample: dl[1],
      sName: sum && sum.name, sHead: sl[0], sRows: sl.length - 1, sSample: sl[1],
      stat: statDetail
    };
  })()`);
  ok(exp.dHead && exp.dHead.includes('时段') && exp.dHead.includes('班级'), '明细表头：' + exp.dHead);
  ok(exp.dRows === 4, '一天 × 两个时段 × 两名学员 = ' + exp.dRows + ' 行');
  ok((exp.dSample || '').split(',').length === 5, '明细一行五列：' + exp.dSample);
  ok(exp.sHead && exp.sHead.includes('出勤率'), '汇总表头：' + exp.sHead);
  ok(exp.sRows === 2, '汇总一人一行：' + exp.sRows + ' 行');
  ok((exp.sSample || '').includes('%'), '汇总带出勤率：' + exp.sSample);
  ok(/共 4 条/.test(exp.stat || ''), '导出后下面那句统计：' + exp.stat);

  console.log('\n【7/7】设置页加 / 删时段…');
  const mgr = await cdp.eval(`(() => {
    App.go('settings');
    Settings.render();
    const cardShown = document.getElementById('slotCard').style.display !== 'none';
    const before = document.getElementById('slotList').querySelectorAll('.item').length;
    document.getElementById('slotNew').value = '早功';
    Settings.slotAdd();
    const after = document.getElementById('slotList').querySelectorAll('.item').length;
    App.go('att'); Att.render();
    const opts = [...document.querySelectorAll('#attSlot option')].map(o => o.value);
    const labels = [...document.querySelectorAll('#attSlot option')].map(o => o.textContent);
    const d = Store.get('_attDate');
    Store.set('_attSlot', 's_add');
    const pid = Att.SLOTS()[2] && Att.SLOTS()[2].id;
    Store.set('_attSlot', pid); Att.mark('s1', '事假');
    const has = Att.byStu(d, pid)['s1'];
    window.confirm = () => true;
    Settings.slotDel(pid);
    const left = Att.SLOTS().map(s => s.name);
    const fell = Att.pidOf(Store.list('att:' + d).find(r => r.studentId === 's1' && r.status === '事假') || {});
    return { cardShown, before, after, opts, labels, has, left, fell };
  })()`);
  ok(mgr.cardShown, '设置页出现「考勤时段」卡片');
  ok(mgr.before === 2 && mgr.after === 3, '添加「早功」后从 ' + mgr.before + ' 个变 ' + mgr.after + ' 个');
  ok(mgr.opts.length === 4 && mgr.labels.includes('早功'), '考勤页下拉跟着多了一项：' + mgr.labels.join('、'));
  ok(mgr.has === '事假', '新时段里也能正常登记：' + mgr.has);
  ok(mgr.left.length === 2 && !mgr.left.includes('早功'), '删除后剩下：' + mgr.left.join('、'));
  ok(mgr.fell === 'am', '删掉时段后，那条记录归到第一个时段（没丢）');

  console.log('\n【收尾】清场…');
  await cdp.eval(`(() => { try { localStorage.clear(); } catch(e){} })()`).catch(() => {});
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  console.log(failed ? `\n❌ ${failed} 项没过` : '\n✅ 全部通过');
} catch (e) {
  console.log('\n❌ 崩了：' + (e && e.message));
  failed++;
} finally {
  for (const c of chromes) { try { c.kill('SIGKILL'); } catch {} }
  if (server) { try { server.kill('SIGKILL'); } catch {} }
  for (const p of profiles) { try { await rm(p, { recursive: true, force: true }); } catch {} }
  process.exit(failed ? 1 : 0);
}
