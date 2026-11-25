/**
 * ==5.70== 看板「班级量化」加减分两栏 · 回归
 *   node test/board_quant_check.mjs [端口]
 * 守的是主理人 2026-11-25 那句：「既要显示它的扣分，也要显示它的加分项，不能全都显示扣分项」。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5461);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'board');

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

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome; const R = [];
const t = (n, ok, ex) => R.push({ n, ok: !!ok, ex });
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'bqc-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5462', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5462/json/list')).json();
    return list.find(t2 => t2.type === 'page' && t2.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2200);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) { s.style.opacity='0'; s.style.display='none'; } })()`);

  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { ok: !document.getElementById('gate').classList.contains('on') };
  })()`);
  if (!lg.ok) throw new Error('登录失败');

  /* 造两个班：加分项和扣分项都齐，全部同日（同名项要能合并） */
  await cdp.eval(`(async () => {
    const c1 = Store.upsert('classes', { name: '考前05班' });
    const c2 = Store.upsert('classes', { name: '考前06班' });
    ['刘艺霖','王一涵','张婧奕','许适尧','马诗蕊'].forEach(n => Store.upsert('students', { classId: c1.id, name: n }));
    ['谢一鸣','徐显锋','李思远','张予诺','王子涵'].forEach(n => Store.upsert('students', { classId: c2.id, name: n }));
    const today = Util.today();
    let u = Date.now();
    const add = (cls, label, delta, d) => Store.upsert('quant_log',
      { id: Util.uid(), clsId: cls.id, date: d || today, label, delta, _u: (u += 1000) });
    add(c1, '全勤', 30, '2026-11-20'); add(c1, '教室卫生与安全排查 合格', 10, '2026-11-22');
    add(c1, '晚自习过关', 6); add(c1, '迟到（10 分钟内 2 分/分钟）', -2);
    add(c1, '作业未交', -2); add(c1, '课堂违纪', -3);
    add(c2, '全勤', 30, '2026-11-18'); add(c2, '全勤', 30, '2026-11-23');
    add(c2, '教室卫生与安全排查 合格', 10); add(c2, '晚自习过关', 6);
    add(c2, '上课玩手机或做与学习无关的事', -5); add(c2, '迟到（10 分钟内 2 分/分钟）', -2);
    Store.upsert('notices', { text: '本周六上午 9 点统考模拟，全体学员务必到场', date: today });
    Board.setMode('dash'); Board.enter();
    await new Promise(r => setTimeout(r, 1200));
    Board.paintQuant();
    await new Promise(r => setTimeout(r, 300));
  })()`);

  const d = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#bdQuant .bd-q')];
    return rows.map(r => {
      const cols = [...r.querySelectorAll('.bd-q-why .bd-q-col')];
      return {
        name: r.querySelector('.bd-q-n').textContent.trim(),
        v: r.querySelector('.bd-q-v').textContent.trim(),
        heads: cols.map(c => c.querySelector('.bd-q-ch').textContent.trim()),
        p: [...r.querySelectorAll('.bd-q-why b.p')].map(b => b.textContent.trim()),
        m: [...r.querySelectorAll('.bd-q-why b.m')].map(b => b.textContent.trim()),
        pColor: cols[0] ? getComputedStyle(cols[0].querySelector('b.p') || cols[0]).color : '',
        mColor: cols[1] ? getComputedStyle(cols[1].querySelector('b.m') || cols[1]).color : '',
        h: Math.round(r.getBoundingClientRect().height),
        over: r.scrollHeight > r.clientHeight + 1,
      };
    });
  })()`);

  const q6 = d.find(x => x.name === '考前06班') || {};
  const q5 = d.find(x => x.name === '考前05班') || {};

  t('两栏抬头是「加分 | 扣分」，左加右扣', JSON.stringify(q6.heads) === '["加分","扣分"]', JSON.stringify(q6.heads));
  t('每题行里加分、扣分都有（不再只显示扣分）', (q6.p || []).length >= 1 && (q6.m || []).length >= 1, JSON.stringify([q6.p, q6.m]));
  t('加分项排到了第一位（大分在前）', (q6.p || [])[0] === '全勤 ×2 +60', JSON.stringify(q6.p));
  t('同名加分项合并成一条（×2）', (q6.p || []).filter(x => x.indexOf('全勤') === 0).length === 1, JSON.stringify(q6.p));
  t('扣分项都带负号（−）', (q6.m || []).every(x => x.indexOf('−') > 0), JSON.stringify(q6.m));
  t('长名目压短了（卫生那句不带「与安全排查」）', !(q6.p || []).join('').includes('与安全排查'), JSON.stringify(q6.p));
  t('加分金色 / 扣分朱红（两栏不同色）', q6.pColor && q6.mColor && q6.pColor !== q6.mColor, q6.pColor + ' vs ' + q6.mColor);
  t('分数没被这次改版动过（06班 169 / 05班 139）', q6.v === '169' && q5.v === '139', q6.v + ' / ' + q5.v);
  t('行没有被撑爆（无溢出）', d.every(x => !x.over), JSON.stringify(d.map(x => x.h)));

  /* 2 个班 / 1600×900 的成品图（生产就是这个规模） */
  const snap = async (name) => {
    await cdp.eval(`(() => { Board.paintQuant(); })()`);
    await sleep(300);
    const r2 = await cdp.eval(`(() => {
      const p = document.getElementById('bdQuant').closest('.bd-pnl').getBoundingClientRect();
      return { x: p.x + window.scrollX, y: p.y + window.scrollY, w: p.width, h: p.height };
    })()`);
    const res2 = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: Math.max(0, r2.x - 10), y: Math.max(0, r2.y - 10), width: r2.w + 20, height: r2.h + 20, scale: 1 } });
    await writeFile(path.join(OUT, name), Buffer.from(res2.data, 'base64'));
    console.log('  📸 ' + name);
  };
  await snap('qp_prod.png');

  /* 空数据：两栏都出「—」，不能空白 */
  const empty = await cdp.eval(`(async () => {
    const c3 = Store.upsert('classes', { name: '空班测试' });
    Store.upsert('quant_log', { id: 'tmp_x', clsId: c3.id, date: Util.today(), label: 'x', delta: 0, _u: Date.now() });
    Board.paintQuant();
    await new Promise(r => setTimeout(r, 200));
    const r = [...document.querySelectorAll('#bdQuant .bd-q')].find(e => e.querySelector('.bd-q-n').textContent.trim() === '空班测试');
    const out = r ? { p: r.querySelectorAll('.bd-q-why b.p').length, m: r.querySelectorAll('.bd-q-why b.m').length,
                     heads: [...r.querySelectorAll('.bd-q-ch')].map(x => x.textContent.trim()) } : null;
    c3 && Store.softDelete && Store.softDelete('classes', c3.id);
    return out;
  })()`);
  t('没有加减分的班两栏各出「—」不空白', empty && empty.p === 1 && empty.m === 1, JSON.stringify(empty));

  /* 班多时（前 5 名满档）在小屏 1366×768 也不能撑爆 —— 密度靠 data-n 分档，行高得吃得下 */
  const many = await cdp.eval(`(async () => {
    for (let i = 3; i <= 5; i++){
      const c = Store.upsert('classes', { name: '压测0' + i + '班' });
      let u = Date.now() + i * 100;
      const add = (label, delta) => Store.upsert('quant_log', { id: Util.uid(), clsId: c.id, date: Util.today(), label, delta, _u: (u += 1000) });
      add('全勤', 30); add('教室卫生与安全排查 合格', 10);
      add('迟到（10 分钟内 2 分/分钟）', -2); add('作业未交', -2);
    }
    Board.paintQuant();
    await new Promise(r => setTimeout(r, 250));
    document.getElementById('bdQuant').dataset.n;
    return document.getElementById('bdQuant').dataset.n;
  })()`);
  t('前 5 名满档（data-n=5）', many === '5', String(many));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await cdp.eval(`(() => { Board.paintQuant(); })()`);
  await sleep(300);
  const compact = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#bdQuant .bd-q')];
    const box = document.getElementById('bdQuant');
    return {
      n: rows.length,
      over: rows.filter(r => r.scrollHeight > r.clientHeight + 1).length,
      rowH: rows.map(r => Math.round(r.getBoundingClientRect().height)),
      boxOver: box.scrollHeight > box.clientHeight + 2,
      heads: rows[0] ? [...rows[0].querySelectorAll('.bd-q-ch')].map(x => x.textContent.trim()) : [],
      headVis: rows[0] ? getComputedStyle(rows[0].querySelector('.bd-q-ch')).display : '',
    };
  })()`);
  t('1366×768 五个班：行不溢出、块不溢出、紧凑档藏掉抬头省高度',
    compact.n === 5 && compact.over === 0 && !compact.boxOver && compact.headVis === 'none',
    JSON.stringify(compact));

  /* 截一张真图存档 */
  await cdp.eval(`(() => { Board.paintQuant(); })()`);
  await sleep(300);
  const r = await cdp.eval(`(() => {
    const p = document.getElementById('bdQuant').closest('.bd-pnl').getBoundingClientRect();
    return { x: p.x + window.scrollX, y: p.y + window.scrollY, w: p.width, h: p.height };
  })()`);
  const res = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
    clip: { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.w + 20, height: r.h + 20, scale: 1 } });
  await writeFile(path.join(OUT, 'qp_prod_5cls.png'), Buffer.from(res.data, 'base64'));
  console.log('  📸 qp_prod_5cls.png');
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}
const bad = R.filter(x => !x.ok);
R.forEach(x => console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.n + (x.ok || !x.ex ? '' : '   → ' + x.ex)));
console.log('\n' + (bad.length ? `❌ ${bad.length} / ${R.length}` : `✅ 全部通过（${R.length} 项）`));
if (bad.length) process.exitCode = 1;
