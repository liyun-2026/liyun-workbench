/**
 * 看板端排版方案预览：班级量化放大 + 扣分原因 + 今日考勤加请假/迟到名单
 *   node test/board_layout_preview.mjs [端口]
 * 输出：test/.shots/board/{plan1,plan2,now}.png（1920×1080）
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

/* ── 方案样式 ──────────────────────────────────────────────
   两块共用的基础：量化行改「名次 | 班名+扣分原因 | 分数」三段，
   分数 .bd-q-v 一个字号都不动（用户明确要求），只在中列下方多一行小字。 */
const BASE_CSS = `
#planStyle{display:none}
.bd-q-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
/* 名次 / 分数 都要和班名同一行顶部对齐 —— 块被拉高时 align-items:center 会让它们掉到中间去 */
.bd-q{align-items:flex-start}
.bd-q-k,.bd-q-v{padding-top:.16em}
.bd-q-mid .bd-q-n{flex:none;width:auto}
.bd-q-why{font-size:clamp(9.5px,.62vw,12px);line-height:1.4;color:var(--dim);
  letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.bd-q-why i{font-style:normal;opacity:.5;margin:0 .45em}
.bd-q-why b{font-weight:400;color:var(--red);opacity:.92}
.bd-q-why b.up{color:var(--green)}
.bd-grp[data-k="leave"] .bd-row::before{background:var(--blue)}
.bd-grp[data-k="late"] .bd-row::before{background:var(--amber)}
`;

/* 方案 1：紧凑 —— 扣分原因压成一行，量化:通知 = 2.6:0.9，中栏三名单紧凑纵排 */
const PLAN1_CSS = BASE_CSS + `
body.pv1 #bdQuant{flex:2.6!important}
/* 只有 1~2 个班时量化区会被撑得很高：让卡片自己撑满，班名行贴顶、扣分原因沉到底，
   中间留白才像「一张卡」，而不是两块小方块浮在大片空里 */
body.pv1 .bd-quant[data-n="1"] .bd-q,body.pv1 .bd-quant[data-n="2"] .bd-q{flex:1 1 0;min-height:0}
body.pv1 .bd-q-mid{height:100%;justify-content:space-between}
body.pv1 .bd-news{flex:.9!important}
body.pv1 .bd-num4 .n{padding:clamp(10px,1.6vh,18px) 6px clamp(8px,1.4vh,14px)}
body.pv1 .bd-num4 b{font-size:clamp(30px,2.9vw,54px)}
body.pv1 .bd-num4 span{margin-top:clamp(3px,.6vh,7px);font-size:clamp(9px,.6vw,11px);letter-spacing:.18em}
body.pv1 .bd-grp{gap:clamp(5px,.9vh,10px)}
body.pv1 .bd-rows{gap:clamp(4px,.4vw,8px)}
body.pv1 .bd-row{padding:2px 8px;font-size:clamp(10px,.72vw,13px)}
body.pv1 .bd-pnl.mid{gap:clamp(6px,1vh,12px)}
`;

/* 方案 2：舒展 —— 扣分原因最多两条、每条一行，量化:通知 = 3.4:0.7，中栏请假/迟到并排 */
const PLAN2_CSS = BASE_CSS + `
body.pv2 #bdQuant{flex:3.4!important}
body.pv2 .bd-quant[data-n="1"] .bd-q,body.pv2 .bd-quant[data-n="2"] .bd-q{flex:1 1 0;min-height:0}
body.pv2 .bd-news{flex:.7!important}
body.pv2 .bd-q-why{white-space:normal;font-size:clamp(12px,.86vw,16px);line-height:1.72;letter-spacing:.03em}
body.pv2 .bd-q-why b{display:inline-block}
body.pv2 .bd-q-mid{gap:5px}
body.pv2 .bd-q-n{font-size:clamp(15px,1.15vw,19px)!important}
body.pv2 .bd-q{padding-left:clamp(12px,1vw,20px)!important;padding-right:clamp(12px,1vw,20px)!important}
body.pv2 .bd-num4 .n{padding:clamp(12px,2vh,22px) 6px clamp(9px,1.6vh,16px)}
body.pv2 .bd-num4 b{font-size:clamp(32px,3.1vw,58px)}
body.pv2 .bd-pnl.mid{gap:clamp(6px,1vh,12px)}
body.pv2 .pv2-duo{display:grid;grid-template-columns:1fr 1fr;gap:clamp(8px,.8vw,16px);min-height:0}
body.pv2 .bd-row{padding:2px 9px;font-size:clamp(10px,.72vw,13px)}
`;

const PLAN_A_CSS = BASE_CSS + `
body.pvA #bdQuant{flex:3.2!important}
body.pvA .bd-news{flex:.7!important}
body.pvA .bd-q-why{white-space:normal;font-size:clamp(12px,.86vw,16px);line-height:1.78;letter-spacing:.03em}
/* 两个班时卡片被拉得很高 → 班名贴顶、原因撑满剩余高度均匀铺开，不留一大块空洞 */
body.pvA .bd-q-mid{gap:5px;height:100%}
body.pvA .bd-q-why{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 0 2px}
body.pvA .bd-q-why br{display:none}
body.pvA .bd-q-n{font-size:clamp(15px,1.15vw,19px)!important}
body.pvA .bd-quant[data-n="1"] .bd-q,body.pvA .bd-quant[data-n="2"] .bd-q{flex:1 1 0;min-height:0}
body.pvA .bd-num4 .n{padding:clamp(10px,1.6vh,18px) 6px clamp(8px,1.4vh,14px)}
body.pvA .bd-num4 b{font-size:clamp(30px,2.9vw,54px)}
body.pvA .bd-num4 span{margin-top:clamp(3px,.6vh,7px);font-size:clamp(9px,.6vw,11px);letter-spacing:.18em}
body.pvA .bd-grp{gap:clamp(5px,.9vh,10px)}
body.pvA .bd-rows{gap:clamp(6px,.7vw,12px)}
/* 名单要「站远了也读得出」→ 名字条放大，别用小字堆在角落 */
body.pvA .bd-row{padding:5px 12px;font-size:clamp(12px,.92vw,17px)}
body.pvA .bd-h{font-size:clamp(13px,1.02vw,18px)}
body.pvA .bd-pnl.mid{gap:clamp(6px,1vh,12px)}
`;

const PLAN_B_CSS = BASE_CSS + `
body.pvB #bdQuant{flex:2.4!important}
body.pvB .bd-news{flex:.9!important}
body.pvB .bd-quant[data-n="1"] .bd-q,body.pvB .bd-quant[data-n="2"] .bd-q{flex:1 1 0;min-height:0}
body.pvB .bd-q-mid{height:100%;justify-content:space-between}
body.pvB .bd-pnl.mid{gap:clamp(6px,1vh,12px)}
body.pvB .pv-duo{display:grid;grid-template-columns:1fr 1fr;gap:clamp(8px,.8vw,16px);min-height:0}
body.pvB .bd-row{padding:2px 9px;font-size:clamp(10px,.72vw,13px)}
`;

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'bd-chrome-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--remote-debugging-port=5372', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server',
    '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => {
    const list = await (await jfetch('http://127.0.0.1:5372/json/list')).json();
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

  /* 停掉自动重绘，免得注入的结构被 paint 冲掉 */
  await cdp.eval(`(() => { clearInterval(Board._pull); clearInterval(Board._sec); document.body.classList.add('board-mode'); })()`);

  const injectStyle = async (css, bodyCls) => {
    await cdp.eval(`(() => {
      document.body.className = document.body.className.replace(/pv[AB12]/g, '').trim();
      document.body.classList.add('board-mode', ${JSON.stringify(bodyCls)});
      let st = document.getElementById('planStyle');
      if (!st){ st = document.createElement('style'); st.id = 'planStyle'; document.head.appendChild(st); }
      st.textContent = ${JSON.stringify(css)};
    })()`);
  };

  /* 量化行（三段式：名次 | 班名+原因 | 分数） */
  const quantJS = (maxWhy, sep, multi) => `(() => {
    const box = document.getElementById('bdQuant');
    const rows = Util.realClasses().map(c => {
      const v = Quant.score(c.id);
      const whys = Store.list('quant_log')
        .filter(x => x && !x._d && x.clsId === c.id && Number(x.delta) < 0)
        .sort((a, b) => (String(b.date || '') + String(b._u || '')).localeCompare(String(a.date || '') + String(a._u || '')))
        .slice(0, ${maxWhy});
      return { name: c.name || '', v, whys };
    }).sort((a, b) => b.v - a.v).slice(0, 5);
    const whyHtml = w => w.length
      ? w.map(x => '<b>' + Util.esc(String(x.label || '扣分').replace(/\\s*\\d+\\s*分钟$/, '')) + ' ' + Number(x.delta) + '</b>').join('${multi ? "<br>" : "<i>" + sep + "</i>"}')
      : '<b class="up">本周没有扣分</b>';
    box.dataset.n = String(rows.length);
    box.innerHTML = rows.map((r, i) =>
      '<div class="bd-q ' + (r.v > 100 ? 'up' : r.v < 100 ? 'down' : '') + '">'
      + '<span class="bd-q-k">' + String(i + 1).padStart(2, '0') + '</span>'
      + '<span class="bd-q-mid"><span class="bd-q-n">' + Util.esc(r.name) + '</span>'
      + '<span class="bd-q-why">' + whyHtml(r.whys) + '</span></span>'
      + '<b class="bd-q-v">' + r.v + '</b></div>').join('');
    const q = document.getElementById('bdQuant');
    return { n: rows.length, html: q.innerHTML.length };
  })()`;

  /* 中栏：方案 1 三组纵排（DOM 插入，别切字符串 —— 四宫格本身就在第一个 .bd-grp 里） */
  const midJS1 = `(() => {
    const Dp = Board.collect(Board.serverDate(), Board._slotPid || Board.autoSlotPid());
    const grp = document.querySelector('.bd-pnl.mid');
    grp.querySelectorAll('[data-pv]').forEach(e => e.remove());
    const kids = [...grp.children];
    const miss = kids.find(e => (e.textContent || '').indexOf('还没到') >= 0);
    const leaves = Dp.leaveNames || [], lates = window.__lateNames || [];
    const mk = (k, title, names) => {
      const d = document.createElement('div');
      d.className = 'bd-grp'; d.dataset.pv = '1'; d.dataset.k = k;
      d.innerHTML = '<h3 class="bd-h">' + title + ' <span class="bd-tag">' + names.length + ' 人</span></h3>'
        + '<div class="bd-miss" style="flex:none"><div class="bd-rows">'
        + (names.length ? names.map(n => '<div class="bd-row">' + Util.esc(n) + '</div>').join('')
                        : '<div class="bd-row calm">' + (k === 'leave' ? '没人请假' : '没人迟到') + '</div>')
        + '</div></div>';
      return d;
    };
    const a = mk('leave', '请假', leaves), b = mk('late', '迟到', lates);
    if (miss){ grp.insertBefore(a, miss); grp.insertBefore(b, miss); }
    else { grp.appendChild(a); grp.appendChild(b); }
    return { leaves: leaves.length, lates: lates.length };
  })()`;

  /* 中栏：方案 2 请假/迟到并排 */
  const midJS2 = `(() => {
    const Dp = Board.collect(Board.serverDate(), Board._slotPid || Board.autoSlotPid());
    const grp = document.querySelector('.bd-pnl.mid');
    grp.querySelectorAll('[data-pv]').forEach(e => e.remove());
    const kids = [...grp.children];
    const miss = kids.find(e => (e.textContent || '').indexOf('还没到') >= 0);
    const leaves = Dp.leaveNames || [], lates = window.__lateNames || [];
    const cell = (k, title, names) => '<div class="bd-grp" data-k="' + k + '">'
      + '<h3 class="bd-h">' + title + ' <span class="bd-tag">' + names.length + '</span></h3>'
      + '<div class="bd-miss" style="flex:none"><div class="bd-rows">'
      + (names.length ? names.map(n => '<div class="bd-row">' + Util.esc(n) + '</div>').join('')
                      : '<div class="bd-row calm">无</div>')
      + '</div></div></div>';
    const duo = document.createElement('div');
    duo.className = 'pv-duo'; duo.dataset.pv = '2';
    duo.innerHTML = cell('leave', '请假', leaves) + cell('late', '迟到', lates);
    if (miss) grp.insertBefore(duo, miss); else grp.appendChild(duo);
    return { leaves: leaves.length, lates: lates.length };
  })()`;

  /* 迟到名单：collect 目前不返回，先在页面里按同一判据现算（上线时会在 collect 里加 lateNames） */
  await cdp.eval(`(() => {
    const today = Board.serverDate(), pid = Board._slotPid || Board.autoSlotPid();
    const pidOf = r => (Att.pidOf ? Att.pidOf(r) : (r && r.pid) || 'am');
    const names = [];
    Util.realStudents(Util.byName).forEach(st => {
      if (!st.classId) return;
      const r = Store.list('att:' + today).filter(x => x && x.studentId === st.id && (pid === '*' || pidOf(x) === pid))
        .sort((a, b) => (b._u || 0) - (a._u || 0))[0];
      if (r && r.status === '迟到') names.push(st.name);
    });
    window.__lateNames = names;
  })()`);

  const shot = async name => {
    await sleep(500);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name);
  };

  /* 现状（对照用） */
  await shot('now.png');

  /* 方案 A：量化放大 + 扣分原因每条一行（最多 3 条）+ 中栏 请假/迟到/还没到 纵排 */
  await injectStyle(PLAN_A_CSS, 'pvA');
  console.log('A 量化：', JSON.stringify(await cdp.eval(quantJS(3, '', true))));
  console.log('A 中栏：', JSON.stringify(await cdp.eval(midJS1)));
  await shot('planA.png');

  /* 方案 B：量化中 + 扣分原因压一行（最多 2 条）+ 中栏 请假/迟到 并排 */
  await injectStyle(PLAN_B_CSS, 'pvB');
  console.log('B 量化：', JSON.stringify(await cdp.eval(quantJS(2, '·', false))));
  console.log('B 中栏：', JSON.stringify(await cdp.eval(midJS2)));
  await shot('planB.png');

  console.log('✅ 完成，图在 test/.shots/board/');
} catch (e) {
  console.error('❌ ' + e.message);
  process.exitCode = 1;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server.kill(); } catch {}
}
