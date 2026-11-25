/**
 * 看板「班级量化」加减分展示 · 设计稿真渲染（1600×900，真页面真样式）
 *   node test/board_quant_preview.mjs [端口]
 * 出图：test/.shots/board/qp_current.png / qp_a.png / qp_b.png / qp_c.png
 * 说明：变体只在测试页里注入 HTML + 一小段 pvA/pvB/pvC 作用域样式，生产文件不动。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5451);
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
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'bq-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5452', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5452/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
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

  /* ── 造数据：两个班，正负都铺满（贴近生产：全勤/卫生这种大分 + 迟到/作业扣分） ── */
  await cdp.eval(`(async () => {
    const c1 = Store.upsert('classes', { name: '考前05班' });
    const c2 = Store.upsert('classes', { name: '考前06班' });
    const N1 = ['刘艺霖','王一涵','张婧奕','许适尧','马诗蕊','李子墨','周若溪','吴俊熙','郑雨桐','冯亦辰','陈思瑶','黄瑾雯','徐子墨','赵一诺','孙嘉禾','陈可儿','刘浩然'];
    const N2 = ['谢一鸣','徐显锋','李思远','张予诺','王子涵','林知夏','蒋亦可','沈书瑶','何沐阳','唐佳琪','曹雨桐','邓嘉宁','范子轩','彭一然','董思远','袁梦琪','傅嘉言','罗一晗','钟雨欣','崔子墨','殷若彤'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
    const today = Util.today();
    s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id, status: i === 1 ? '病假' : i === 3 ? '迟到' : '正常', pid: 'am' }));
    s2.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id, status: i === 2 ? '事假' : (i === 5 || i === 9) ? '迟到' : i === 12 ? '未到' : '正常', pid: 'am' }));
    let u = Date.now();
    const add = (cls, label, delta, d) => Store.upsert('quant_log',
      { id: Util.uid(), clsId: cls.id, date: d || today, label, delta, _u: (u += 1000) });
    /* 05 班 */
    add(c1, '全勤', 30, '2026-11-20'); add(c1, '教室卫生与安全排查 合格', 10, '2026-11-22');
    add(c1, '晚自习过关', 6); add(c1, '出勤正常', 1); add(c1, '作业按时提交', 1);
    add(c1, '迟到（10 分钟内 2 分/分钟）', -2); add(c1, '作业未交', -2); add(c1, '课堂违纪', -3);
    /* 06 班 */
    add(c2, '全勤', 30, '2026-11-18'); add(c2, '全勤', 30, '2026-11-23');
    add(c2, '教室卫生与安全排查 合格', 10); add(c2, '晚自习过关', 6); add(c2, '作业按时提交', 1);
    add(c2, '上课玩手机或做与学习无关的事', -5); add(c2, '迟到（10 分钟内 2 分/分钟）', -2); add(c2, '作业未交', -2);
    /* 通知 + 课表，右栏下面不空 */
    Store.upsert('notices', { text: '本周六上午 9 点统考模拟，全体学员务必到场', date: today });
    Store.upsert('notices', { text: '下周起晚自习延长至 21:00，家长会通知已发', date: today });
    Store.upsert('notices', { text: '校服补订截止到本周五，找班主任登记', date: today });
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    Store.upsert('schedule', { kind: 'big', date: today, periodId: p1.id, title: '普通话语音基础', cls: '考前05班', stu: '' });
    Store.upsert('schedule', { kind: 'big', date: today, periodId: p1.id, title: '即兴评述训练', cls: '考前06班', stu: '' });
    Store.upsert('schedule', { kind: 'big', date: today, periodId: p3.id, title: '模拟主持', cls: '考前06班', stu: '' });

    Board.setMode('dash');
    Board.enter();
    await new Promise(r => setTimeout(r, 1400));
  })()`);

  /* 预览专用样式（只活在这个测试页里）：加分金、扣分红 */
  await cdp.eval(`(() => {
    const st = document.createElement('style'); st.id = 'pvStyle';
    st.textContent = \`
    #bdQuant .bd-q-why b.p{color:var(--gold-lite);opacity:1}
    #bdQuant .bd-q-why b.m{color:var(--red);opacity:.92}
    /* A：一行到底，加分在前扣分在后，中间一条细竖线 */
    #bdQuant.pvA .bd-q-why i.pvd{display:inline-block;width:1px;height:.9em;background:rgba(201,171,124,.45);margin:0 .7em;vertical-align:-1px;font-style:normal}
    /* B：左右两栏（加分 | 扣分） */
    #bdQuant.pvB .bd-q-why{display:flex!important;flex-direction:row!important;justify-content:flex-start!important;gap:0;align-items:stretch}
    #bdQuant.pvB .pvc{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}
    #bdQuant.pvB .pvc .pvh{font-size:.82em;letter-spacing:.16em;color:var(--gold);opacity:.75;line-height:1.5}
    #bdQuant.pvB .pvc.m .pvh{color:var(--red);opacity:.72}
    #bdQuant.pvB .pvc b{display:block;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #bdQuant.pvB .pvd{width:1px;align-self:stretch;background:rgba(201,171,124,.3);margin:0 .75em 0 .5em}
    /* C：合计胶囊 + 各一条 */
    #bdQuant.pvC .bd-q-s{display:inline-flex;gap:.45em;margin-right:.7em;vertical-align:-1px}
    #bdQuant.pvC .bd-q-s em{font-style:normal;font-size:.92em;padding:.02em .4em;border-radius:4px;
      border:1px solid rgba(201,171,124,.5);color:var(--gold-lite);letter-spacing:.02em}
    #bdQuant.pvC .bd-q-s em.m{border-color:rgba(224,138,138,.45);color:var(--red)}
    \`;
    document.head.appendChild(st);
  })()`);

  const shotOf = async (name, pad = 10) => {
    const r = await cdp.eval(`(() => {
      const el = document.getElementById('bdQuant');
      const panel = el.closest('.bd-pnl');
      const b = panel.getBoundingClientRect();
      return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height };
    })()`);
    const res = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale: 1 } });
    await writeFile(path.join(OUT, name), Buffer.from(res.data, 'base64'));
    console.log('  📸 ' + name + '  ' + Math.round(r.w) + '×' + Math.round(r.h));
  };

  /* ── 现状（只有扣分） ── */
  await shotOf('qp_current.png');

  /* ── 变体渲染器：同一份真数据，三种排法 ── */
  const variant = async (mode) => {
    await cdp.eval(`(() => {
      const box = document.getElementById('bdQuant');
      box.className = 'bd-quant ${mode}';
      const short = s => String(s || '')
        .replace(/^考勤[·・]/, '')
        .replace(/（[^）]*）/g, '')
        .replace(/或做与学习无关的事/, '')
        .replace(/与安全排查/, '')
        .replace(/\\s+/g, ' ').trim();
      /* 同名项合并成一条：全勤连两天就是「全勤 ×2 +60」，不要列两行一样的 */
      const merge = arr => {
        const m = new Map();
        arr.forEach(x => {
          const k = short(x.label) || '其他';
          const o = m.get(k) || { label: k, n: 0, sum: 0 };
          o.n++; o.sum += Number(x.delta) || 0; m.set(k, o);
        });
        return [...m.values()].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
      };
      const rows = Util.realClasses().map(c => {
        const logs = Store.list('quant_log').filter(x => x && !x._d && x.clsId === c.id);
        const plusAll = merge(logs.filter(x => Number(x.delta) > 0));
        const minusAll = merge(logs.filter(x => Number(x.delta) < 0));
        return { name: c.name || '', v: Quant.score(c.id), plus: plusAll, minus: minusAll,
                 sumP: plusAll.reduce((a, x) => a + x.sum, 0), sumM: minusAll.reduce((a, x) => a + x.sum, 0) };
      }).sort((a, b) => b.v - a.v);
      box.dataset.n = String(rows.length);
      const chip = (x, cls) => '<b class="' + cls + '">' + Util.esc(x.label) +
        (x.n > 1 ? ' ×' + x.n : '') + ' ' + (x.sum > 0 ? '+' : '−') + Math.abs(x.sum) + '</b>';
      const CAP = rows.length <= 2 ? 3 : 2;

      box.innerHTML = rows.map((r, i) => {
        const sc = r.v > 100 ? 'up' : (r.v < 100 ? 'down' : '');
        const P = r.plus.slice(0, CAP).map(x => chip(x, 'p')).join('');
        const M = r.minus.slice(0, CAP).map(x => chip(x, 'm')).join('');
        let why = '';
        if ('${mode}' === 'pvA'){
          why = P + (P && M ? '<i class="pvd"></i>' : '') + M;
        } else if ('${mode}' === 'pvB'){
          why = '<div class="pvc"><span class="pvh">加分</span>' + (P || '<b class="p">—</b>') + '</div>' +
                '<i class="pvd"></i>' +
                '<div class="pvc m"><span class="pvh">扣分</span>' + (M || '<b class="m">—</b>') + '</div>';
        } else {
          why = '<span class="bd-q-s"><em>＋' + r.sumP + '</em><em class="m">−' + Math.abs(r.sumM) + '</em></span>' +
                (r.plus.length ? chip(r.plus[0], 'p') : '') + (r.minus.length ? chip(r.minus[0], 'm') : '');
        }
        return '<div class="bd-q ' + sc + '">' +
          '<span class="bd-q-k">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="bd-q-mid"><span class="bd-q-n">' + Util.esc(r.name) + '</span>' +
          '<span class="bd-q-why">' + why + '</span></span>' +
          '<b class="bd-q-v">' + r.v + '</b></div>';
      }).join('');
    })()`);
    await sleep(340);
  };

  await variant('pvA'); await shotOf('qp_a.png');
  await variant('pvB'); await shotOf('qp_b.png');
  await variant('pvC'); await shotOf('qp_c.png');

  const info = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll('#bdQuant .bd-q')];
    return rows.map(r => ({ n: r.querySelector('.bd-q-n').textContent, v: r.querySelector('.bd-q-v').textContent,
      p: r.querySelectorAll('.bd-q-why b.p').length, m: r.querySelectorAll('.bd-q-why b.m').length,
      h: Math.round(r.getBoundingClientRect().height),
      over: r.scrollHeight > r.clientHeight + 1 }));
  })()`);
  console.log('  行高/条数：' + JSON.stringify(info));
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}
