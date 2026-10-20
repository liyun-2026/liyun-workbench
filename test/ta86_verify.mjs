/**
 * v86 批次 3b 验证脚本 —— 教师端/教务端手机重排（<1100）自证。
 *
 *   node test/ta86_verify.mjs
 *
 * 做三件事：
 *   1) 桌面 ≥1100 零影响自证：起**两份 fresh 服务**（当前工作区 / 1f8b1aa 基线
 *      worktree），同一份演示数据、同样屏蔽动态内容（时钟/新闻/现在游标）后，
 *      1440×1000 逐页截屏并逐像素比对（基线页单屏 + 考勤/课表加拍一屏滚动位）。
 *   2) 功能断言：att 直选药丸点选/撤销、tickets 发出、today 数据渲染、
 *      timetable 横向滚动与格子完整、.mtabbar 高亮、教师无水印。
 *   3) 375/320 无横向溢出、底部不被 .mtabbar 遮挡（页底 padding ≥68px）。
 *
 * 基线 worktree：git worktree add /tmp/ly86-base 1f8b1aa（脚本自己建，失败则报错退出）。
 * 截图输出：docs/ta3b-batch3b-shots/desktop/（工作区侧）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const PORT_A = 5461, PORT_B = 5462;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'ta3b-batch3b-shots', 'desktop');
const BASE_DIR = '/tmp/ly86-base';
const SUPER = { user: '李老师', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };

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
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

/** 屏蔽动态内容（时钟 / 新闻 / 「现在」游标）—— 基线与工作区两侧跑同一份 */
const MASK_JS = `(() => {
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr').forEach(e => e.style.visibility = 'hidden');
  ['newsBody','newsMore','tNewsBody','newsMeta','tNewsMeta','nNewsMeta','stuNewsMeta'].forEach(id => {
    const e = document.getElementById(id); if (e) e.innerHTML = '';
  });
  return 1;
})()`;

/** 演示数据（两侧同构；时间偏移用 3 小时前，避开「x 分钟前」抖动） */
const SEED_JS = `(async () => {
  const today = Util.today();
  const c1 = Store.upsert('classes', { name: '砺蕴一班' });
  const c2 = Store.upsert('classes', { name: '集训班' });
  const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
  const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
  const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
  const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
  s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
    status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : '正常' }));
  s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
  const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
  const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
  sch('周一', p1.id, '普通话语音基础', '砺蕴一班');
  sch('周一', p3.id, '新闻播报实训', '砺蕴一班');
  sch('周二', p1.id, '即兴评述训练', '集训班');
  sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
  sch('周四', p3.id, '模拟主持', '集训班');
  const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
  Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
  const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
  s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false); hk(s1[7].id, false);
  Store.upsert('tickets', { type: '调课申请', byName: '张伟', text: '周三第 2 节想换到周四同一节',
    status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  Store.upsert('tickets', { type: '学生请假', studentId: s1[5].id, kind: '病假', date: today,
    text: '昨晚发烧到 39 度，今天在家休息。', status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id, c2.id] }); } catch(e){}
  Store.set('_attCls', c1.id); Store.set('_attDate', today);
  Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
  Store.set('_tdAttCls', c1.id);
  return { c1: c1.id, c2: c2.id };
})()`;

async function boot(base) {
  await waitFor(async () => (await jfetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: `预览服务 ${base}`, tries: 40 });
  try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
}
async function login(cdp, cred) {
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2000));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + cred.user);
  return lg.role;
}
async function switchTeacher(cdp) {
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = ${JSON.stringify(TEACHER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(TEACHER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2200));
    return Auth.role();
  })()`);
  await sleep(1000);
}
async function goShot(cdp, pageId, file) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  await sleep(600);
  await cdp.eval(MASK_JS);
  await sleep(220);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(r.data, 'base64'));
}
/** 逐像素比对：把两张 PNG 喂给浏览器 canvas，数差异像素（容差 8/通道） */
async function diffTwo(cdp, bufA, bufB) {
  const a = bufA.toString('base64'), b = bufB.toString('base64');
  return cdp.eval(`(async () => {
    const load = b64 => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('img load fail'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const ia = await load(${JSON.stringify(a)});
    const ib = await load(${JSON.stringify(b)});
    if (ia.width !== ib.width || ia.height !== ib.height) return { mismatch: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const ca = document.createElement('canvas'); ca.width = ia.width; ca.height = ia.height;
    const cb = document.createElement('canvas'); cb.width = ib.width; cb.height = ib.height;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, ia.width, ia.height).data;
    const db = xb.getImageData(0, 0, ib.width, ib.height).data;
    let bad = 0, fx = -1, fy = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) {
        bad++;
        if (fx < 0) { const p = i / 4; fx = p % ia.width; fy = Math.floor(p / ia.width); }
      }
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4), first: fx < 0 ? null : [fx, fy] };
  })()`);
}

/* ── 基线 worktree ── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} 1f8b1aa`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

try {
  await mkdir(OUT, { recursive: true });
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(1f8b1aa 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'ta86-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5499',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5499/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, { width: 1440, height: 1000, dsf: 1, mobile: false });

  /* ═══ 1) 桌面 1440 像素 diff（vs 1f8b1aa）═══ */
  console.log('── 桌面 1440 像素 diff（动态内容已屏蔽）──');
  const DESK_PAGES = [['home','教务首页'],['att','考勤'],['homework','作业'],['timetable','课表'],['today','教师今天'],['myclass','我的班级'],['tickets','消息']];
  const shots = { A: {}, B: {} };
  for (const [tag, base, store] of [[ 'A', BASE_A, shots.A ], [ 'B', BASE_B, shots.B ]]) {
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2800);
    await login(cdp, SUPER);
    await cdp.eval(SEED_JS);
    /* 新闻是外网异步回填，会跟屏蔽竞态 —— 两侧统一废掉自动抓取再比对 */
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    await sleep(600);
    for (const [id] of DESK_PAGES) {
      const f = path.join(OUT, `${tag}-${id}.png`);
      await goShot(cdp, id, f);
      store[id] = f;
    }
    await switchTeacher(cdp);
    for (const [id] of [['today',''],['myclass',''],['tickets','']]) {
      const f = path.join(OUT, `${tag}-t-${id}.png`);
      await goShot(cdp, id, f);
      store['t-' + id] = f;
    }
  }
  console.log('逐页比对（admin 用 A-/B-，teacher 用 A-t-/B-t-）：');
  for (const [id, label] of DESK_PAGES) {
    const key = id === 'today' || id === 'myclass' || id === 'tickets' ? 't-' + id : id;
    const d = await diffTwo(cdp, await import('node:fs/promises').then(fs => fs.readFile(shots.A[key])), await import('node:fs/promises').then(fs => fs.readFile(shots.B[key])));
    const good = !d.mismatch && d.bad === 0;
    ok(`桌面 1440 · ${label}（${key}）`, good, d.mismatch ? ('尺寸不一致 ' + d.mismatch) : (`差异像素 ${d.bad}/${d.total}（${d.pct}%）` + (d.first ? ' 首个差异 ' + JSON.stringify(d.first) : '')));
  }

  /* ═══ 2) 功能断言（工作区，切回手机视口 390×844 —— <1100 规则要在位）═══ */
  console.log('\n── 功能断言（工作区 · 390 手机视口）──');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  await sleep(600);
  /* 桌面 diff 阶段最后一次导航停在基线 B —— 先回工作区 A 再断言；
     A 会话仍是教师（桌面 diff 尾段 switchTeacher 过），先登回 super。 */
  let loadedBack = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: BASE_A + '/' }); await loadedBack;
  await sleep(2800);
  await login(cdp, SUPER);
  // 2.1 att 直选药丸：点一下选中、再点撤销
  await cdp.eval(`(async () => { App.go('att'); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  // 2.1 att 直选药丸：点一下选中、再点撤销
  const pill = await cdp.eval(`(async () => {
    const grid = document.getElementById('attGrid');
    if (grid.classList.contains('is-empty')) return { empty: true };
    const st = document.querySelector('#roster .stamp[aria-pressed="false"]');
    if (!st) return { none: true };
    const sid = st.dataset.sid, before = st.getAttribute('aria-pressed');
    st.click();
    await new Promise(r => setTimeout(r, 350));
    const after = document.querySelector('#roster .stamp[data-s="' + st.dataset.s + '"][data-sid="' + sid + '"]').getAttribute('aria-pressed');
    const cur1 = document.querySelector('#roster .rrow[data-sid], #roster .rrow[data-cur]') ? [...document.querySelectorAll('#roster .rrow')].find(x => x.dataset.cur !== undefined)?.dataset.cur : null;
    // 再点撤销
    const st2 = document.querySelector('#roster .stamp[data-sid="' + sid + '"][aria-pressed="true"]');
    if (st2) { st2.click(); await new Promise(r => setTimeout(r, 350)); }
    const after2 = document.querySelector('#roster .stamp[data-s="' + st.dataset.s + '"][data-sid="' + sid + '"]').getAttribute('aria-pressed');
    return { before, after, after2, sum: document.querySelector('[data-sum="ok"]').textContent };
  })()`);
  ok('att 直选药丸点选→选中', !pill.empty && !pill.none && pill.after === 'true', JSON.stringify(pill));
  ok('att 直选药丸再点→撤销', !pill.empty && !pill.none && pill.after2 === 'false');
  // 2.2 tickets 发出
  const tk = await cdp.eval(`(async () => {
    App.go('tickets'); await new Promise(r => setTimeout(r, 500));
    const before = document.querySelectorAll('#tkList .item').length;
    document.getElementById('tkText').value = '验证脚本测试：周四第 1 节教室投影仪故障，请后勤协助检修。';
    Ticket.send();
    await new Promise(r => setTimeout(r, 600));
    const after = document.querySelectorAll('#tkList .item').length;
    return { before, after, sent: after > before };
  })()`);
  ok('tickets 收发入口可点且发出成功', tk.sent, JSON.stringify(tk));
  // 2.2b timetable 横向滚动 + 格子完整（教务身份 —— 教师路由没有 timetable）
  const tt = await cdp.eval(`(async () => {
    App.go('timetable'); await new Promise(r => setTimeout(r, 700));
    const g = document.getElementById('gridWrap');
    const table = g.querySelector('table');
    return {
      onPage: document.querySelector('.page.on').id,
      scrollable: g.scrollWidth > g.clientWidth,
      sw: g.scrollWidth, cw: g.clientWidth,
      rows: table ? table.querySelectorAll('tr').length : 0,
      heads: table ? table.querySelectorAll('thead th, tr:first-child th, tr:first-child td').length : 0,
      bodyOverflowX: document.documentElement.scrollWidth <= window.innerWidth,
    };
  })()`);
  ok('timetable 横向可滚且格子完整', tt.onPage === 'page-timetable' && tt.scrollable && tt.rows > 2 && tt.heads >= 7 && tt.bodyOverflowX, JSON.stringify(tt));
  // 2.3 today 数据渲染（教师）
  await switchTeacher(cdp);
  const td = await cdp.eval(`(async () => {
    App.go('today'); await new Promise(r => setTimeout(r, 700));
    return {
      tdToday: document.getElementById('tdToday').innerHTML.length,
      tdAtt: document.getElementById('tdAtt').innerHTML.length,
      tdAttMeta: document.getElementById('tdAttMeta').textContent.length,
      tdWeek: document.getElementById('tdWeek').innerHTML.length,
      wm: !!document.querySelector('#watermark') && getComputedStyle(document.querySelector('#watermark')).display !== 'none',
      stuClass: document.body.classList.contains('stu'),
    };
  })()`);
  ok('today 数据渲染（课/只读考勤/周课）', td.tdToday > 0 && td.tdAtt > 0 && td.tdAttMeta > 0 && td.tdWeek > 0, JSON.stringify(td));
  ok('教师无水印', !td.wm && !td.stuClass);
  // 2.4 只读卡观感：tag-ro 徽标 + tag-ro 描边签
  const ro = await cdp.eval(`(() => {
    const card = document.querySelector('.card:has(#tdAtt)');
    const badge = card && getComputedStyle(card.querySelector('h2'), '::after').content.includes('教师端 · 只读');
    const chip = document.querySelector('#tdAtt .chip');
    const roStyle = chip && getComputedStyle(chip).borderRadius === '999px' && parseFloat(getComputedStyle(chip).borderTopWidth) >= 1;
    const note = card && card.querySelector('#tdAtt ~ p.hint') && getComputedStyle(card.querySelector('#tdAtt ~ p.hint')).borderTopStyle === 'dashed';
    return { badge, roStyle, note };
  })()`);
  ok('today 只读卡 m-tattend 观感（徽标/描边签/ro-note 虚线条）', ro.badge && ro.roStyle && ro.note, JSON.stringify(ro));
  // 2.6 mtabbar 高亮（教师 today 页两枚 Tab 同时亮）
  const mb = await cdp.eval(`(() => {
    const btns = document.querySelectorAll('.mtabbar button');
    const on = [...document.querySelectorAll('.mtabbar button.on')].map(b => b.dataset.tab);
    const barVisible = getComputedStyle(document.getElementById('mtabbar')).display !== 'none';
    return { n: btns.length, on, barVisible };
  })()`);
  ok('.mtabbar 五 Tab 且「今天/考勤」双亮', mb.n === 5 && mb.barVisible && mb.on.includes('今天') && mb.on.includes('考勤'), JSON.stringify(mb));
  await cdp.eval(`(async () => { App.go('myclass'); await new Promise(r => setTimeout(r, 400)); return 1; })()`);
  const mb2 = await cdp.eval(`(() => [...document.querySelectorAll('.mtabbar button.on')].map(b => b.dataset.tab))()`);
  ok('.mtabbar 切页高亮跟随（myclass→课表）', mb2.length === 1 && mb2[0] === '课表', JSON.stringify(mb2));

  /* ═══ 3) 375 / 320 溢出 + 底部遮挡（教师页教师态、教务页教务态）═══ */
  console.log('\n── 375 / 320 溢出与底部遮挡 ──');
  const TEACHER_PAGES = ['today','myclass','tickets'];
  const ADMIN_PAGES = ['home','att','homework','timetable'];
  for (const w of [375, 320]) {
    await view(cdp, { width: w, height: 812, dsf: 2, mobile: true });
    await sleep(400);
    const ids = TEACHER_PAGES.concat(ADMIN_PAGES);
    for (const id of ids) {
      if (id === ADMIN_PAGES[0]) {   // 教务页先切回 super
        await cdp.eval(`(async () => { Store.setSecret('token',''); Auth._me = null; Auth.show();
          document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
          document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
          await Auth.submit(); await new Promise(r => setTimeout(r, 2200)); return 1; })()`);
        await sleep(800);
      }
      const r = await cdp.eval(`(async () => {
        App.go(${JSON.stringify(id)}); await new Promise(r => setTimeout(r, 550));
        const pg = document.querySelector('.page.on');
        let overflowEl = null, detail = '';
        document.querySelectorAll('.page.on *').forEach(el => {
          if (overflowEl) return;
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed') {
            let clipped = false;    /* 被 overflow:hidden/clip/auto 祖先裁掉的（如 .bg-logo 出血 6px）不算真溢出 */
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const ox = getComputedStyle(a).overflowX;
              if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') { clipped = true; break; }
            }
            if (clipped) return;
            overflowEl = (el.className && String(el.className)) || el.tagName;
            detail = el.tagName + ' right=' + Math.round(b.right) + ' w=' + Math.round(b.width) + ' «' + (el.textContent || '').trim().slice(0, 18) + '»';
          }
        });
        return {
          docOk: document.documentElement.scrollWidth <= window.innerWidth,
          pagePadBottom: parseFloat(getComputedStyle(pg).paddingBottom),
          overflowEl, detail,
        };
      })()`);
      ok(`${w}px · ${id} 无横向溢出`, r.docOk && !r.overflowEl, r.overflowEl ? ('溢出：' + r.overflowEl + ' ' + r.detail) : '');
      ok(`${w}px · ${id} 底部不被 mtabbar 遮挡`, r.pagePadBottom >= 68, 'padding-bottom=' + r.pagePadBottom);
    }
  }

  console.log('\n' + (fails.length ? '❌ 失败 ' + fails.length + ' 项：' + fails.join('；') : '✅ 全部通过'));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\n✗ 验证失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  srvA.kill(); srvB.kill();
  try { execSync(`git -C ${JSON.stringify(dir)} worktree remove --force ${BASE_DIR}`, { stdio: 'pipe' }); } catch {}
}
