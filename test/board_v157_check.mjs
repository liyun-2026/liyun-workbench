/**
 * ==5.65== 看板端改版核验（量化放大 + 扣分原因 + 请假/迟到/未到 三组名单）
 *   node test/board_v157_check.mjs [端口]
 * 输出：test/.shots/board/v157*.png（1920×1080，真页面真样式，不注入任何 CSS）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5371);
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

  const profile = await mkdtemp(path.join(tmpdir(), 'bd-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5374', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5374/json/list')).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
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

  const seed = await cdp.eval(`(async () => {
    const c1 = Store.upsert('classes', { name: '考前05班' });
    const c2 = Store.upsert('classes', { name: '考前06班' });
    const N1 = ['刘艺霖','王一涵','张婧奕','许适尧','马诗蕊','李子墨','周若溪','吴俊熙','郑雨桐','冯亦辰','陈思瑶','黄瑾雯','徐子墨','赵一诺','孙嘉禾','陈可儿','刘浩然'];
    const N2 = ['谢一鸣','徐显锋','李思远','张予诺','王子涵','林知夏','蒋亦可','沈书瑶','何沐阳','唐佳琪','曹雨桐','邓嘉宁','范子轩','彭一然','董思远','袁梦琪','傅嘉言','罗一晗','钟雨欣','崔子墨','殷若彤'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
    const today = Util.today();
    const att = (s, st, pid) => Store.upsert('att:' + today, { studentId: s.id, status: st, pid: pid || 'am' });

    s1.forEach((s, i) => att(s, i === 1 ? '病假' : i === 3 ? '迟到' : '正常'));
    s2.forEach((s, i) => att(s, i === 2 ? '事假' : (i === 5 || i === 9) ? '迟到' : i === 12 ? '未到' : '正常'));
    /* 再补两个未到，让名单有厚度 */
    att(s1[9], '未到'); att(s1[14], '未到');

    /* 量化流水：正分打底 + 几条扣分，好让「为什么扣分」有内容 */
    const add = (cls, label, delta, d) => Store.upsert('quant_log',
      { id: Util.uid(), clsId: cls.id, date: d || today, label, delta, _u: Date.now() + Math.random() });
    add(c1, '整周全勤', 10); add(c1, '课堂表现', 8); add(c1, '早读到位', 6);
    add(c1, '迟到 3 分钟', -2); add(c1, '迟到 5 分钟', -2);
    add(c1, '作业未交', -1); add(c1, '课堂违纪', -3);
    add(c2, '整周全勤', 12); add(c2, '晚自习过关', 6);
    add(c2, '迟到 2 分钟', -2); add(c2, '作业未交', -1); add(c2, '课堂违纪', -4); add(c2, '迟到 4 分钟', -2);

    /* 课表 + 作息，左栏不至于空着 */
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    const p4 = Store.upsert('periods', { name: '晚课', start: '18:30', end: '20:30' });
    const sch = (pid, title, cls) => Store.upsert('schedule', { kind: 'big', date: today, periodId: pid.id, title, cls, stu: '' });
    sch(p1, '普通话语音基础', '考前05班'); sch(p1, '即兴评述训练', '考前06班');
    sch(p2, '新闻播报实训', '考前05班'); sch(p2, '文稿朗读', '考前06班');
    sch(p3, '模拟主持', '考前06班');
    sch(p4, '统考全真模拟', '考前05班');

    /* 通知 3 条 */
    Store.upsert('notices', { text: '本周六上午 9 点统考模拟，全体学员务必到场', date: today });
    Store.upsert('notices', { text: '下周起晚自习延长至 21:00，家长会通知已发', date: today });
    Store.upsert('notices', { text: '校服补订截止到本周五，找班主任登记', date: today });

    Board.setMode('dash');
    App.go('board');
    await new Promise(r => setTimeout(r, 1400));
    const D = Board.collect(Board.serverDate(), Board._slotPid || Board.autoSlotPid());
    return { ok: !!document.querySelector('.bdv-dash'), cls: 2,
      should: D.should, ok2: D.ok, late: D.late, leave: D.leave,
      miss: D.miss.map(s => s.name), leaveNames: D.leaveNames };
  })()`);
  console.log('数据：', JSON.stringify(seed));
  /* 核验 1：collect 是否带回迟到名单 */
  const chk = await cdp.eval(`(() => {
    const D = Board.collect(Board.serverDate(), Board._slotPid || Board.autoSlotPid());
    return { late: D.late, lateNames: D.lateNames || null, leaveNames: D.leaveNames,
             miss: D.miss.map(s => s.name) };
  })()`);
  console.log('collect：', JSON.stringify(chk));

  /* 核验 2：页面结构 —— 三组标题、两栏并排、量化行带原因 */
  const dom = await cdp.eval(`(() => {
    const mid = document.querySelector('.bd-pnl.mid');
    const heads = [...mid.querySelectorAll('.bd-h')].map(h => h.textContent.trim().split(' ')[0]);
    const duo = mid.querySelector('.bd-duo');
    const q = document.querySelectorAll('#bdQuant .bd-q');
    const first = q[0];
    return {
      heads,
      duoCols: duo ? getComputedStyle(duo).gridTemplateColumns : null,
      quantFlex: getComputedStyle(document.getElementById('bdQuant')).flexGrow,
      newsFlex: getComputedStyle(document.getElementById('bdNews')).flexGrow,
      rows: q.length,
      whyLines: first ? first.querySelectorAll('.bd-q-why b').length : 0,
      whyText: first ? first.querySelector('.bd-q-why').textContent.trim() : '',
      scoreFont: first ? getComputedStyle(first.querySelector('.bd-q-v')).fontSize : '',
      nameFont: first ? getComputedStyle(first.querySelector('.bd-q-n')).fontSize : '',
      leave: [...document.querySelectorAll('#bdLeave .bd-row')].map(e => e.textContent.trim()),
      late: [...document.querySelectorAll('#bdLate .bd-row')].map(e => e.textContent.trim()),
      mis: [...document.querySelectorAll('#bdMiss .bd-row')].map(e => e.textContent.trim()),
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    };
  })()`);
  console.log('结构：', JSON.stringify(dom, null, 0));

  /* 诊断：中列各组高度（名单盒塌了会导致上滚判定出错） */
  const hts = await cdp.eval(`(() => {
    const mid = document.querySelector('.bd-pnl.mid');
    const g = [...mid.children].map(e => ({
      k: e.dataset.k || e.className,
      h: Math.round(e.getBoundingClientRect().height)
    }));
    const miss = mid.querySelector('[data-k="miss"]');
    return { mid: Math.round(mid.getBoundingClientRect().height), g,
             missH: miss ? Math.round(miss.getBoundingClientRect().height) : 0,
             listH: miss ? Math.round(miss.querySelector('.bd-list').clientHeight) : 0,
             rowsH: miss ? Math.round(miss.querySelector('.bd-rows').scrollHeight) : 0 };
  })()`);
  console.log('中列高度：', JSON.stringify(hts));

  /* 停掉自动重绘后再截图，免得 30 秒一轮的 paint 把画面刷到一半 */
  await cdp.eval(`(() => { document.body.classList.add('board-mode'); clearInterval(Board._pull); clearInterval(Board._sec);
    Board.paintQuant && Board.paintQuant(); Board.paintMiss && Board.paintMiss(Board._data || Board.collect(Board.serverDate(), Board._slotPid || Board.autoSlotPid())); })()`);
  await sleep(600);

  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name);
  };
  await shot('v157-dash.png');

  const bad = [];
  if (!chk.lateNames || chk.lateNames.length !== chk.late) bad.push('lateNames 数量对不上');
  if (!dom.heads.includes('请假') || !dom.heads.includes('迟到') || !dom.heads.includes('未到')) bad.push('三组标题不全：' + dom.heads.join('/'));
  if (dom.heads.includes('还没到')) bad.push('「还没到」没改成「未到」');
  if (!dom.duoCols || dom.duoCols.split(' ').length < 2) bad.push('请假/迟到 没并排');
  if (dom.rows !== 2) bad.push('量化行数异常');
  if (dom.whyLines < 1) bad.push('量化行没显示扣分原因');
  console.log(bad.length ? '❌ ' + bad.join('；') : '✅ 全部通过');
  if (bad.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
