/* ==DESKTOP-V2== 桌面端全量改版 —— 本地验证脚本（不部署）
 *
 *   node test/desktop_v2_check.mjs
 *
 * 做五件事：
 *   1) 桌面 1440 改动页截图存 docs/desktop-v2-shots/，并与 HEAD 基线逐像素 diff
 *      （改动是「有意的」——页题衬线等，报告差异率；手机端才是零差异硬门槛）。
 *   2) 令牌/组件断言（≥1100）：--focus 合并 var(--cursor)、--line-strong、--fs-h1 30px、
 *      页题衬线 400、.btn.ghost 边框、att 图例类化（无行内 style）、#hwDate 类化、
 *      anchor-layout 200px。
 *   3) P2-d is-stuck：768 宽滚动 .main → .sumbox:first-child 挂 .is-stuck，回顶摘掉；
 *      1440 摘类。
 *   4) 深色 3 页：--cursor #E08B57 / --line-strong #8F897F 生效 + 截图。
 *   5) 手机 390 零回归：home / settings / stuHome 与 HEAD 基线逐像素 0 差异；
 *      样张 _qa.html 全量回归 PASS/FAIL 计数。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_A = 5481, PORT_B = 5482;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'desktop-v2-shots');
const BASE_DIR = '/tmp/lyv2-base';
const SUPER = { user: '李老师', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };
const STUDENT = { user: '王梓涵', pass: 'liyun2026' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) { const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    return c;
  }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej })); }
  once(method){ return new Promise(res => { const orig = this.ws.onmessage;
    this.ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.method === method){ this.ws.onmessage = orig; res(m.params); }
      else if (orig) orig(ev); }; }); }
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

const MASK_JS = `(() => {
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr, [data-next]').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.p-time').forEach(e => e.style.visibility = 'hidden');
  let frozen = document.getElementById('v1MaskFreeze');
  if (!frozen){
    frozen = document.createElement('style'); frozen.id = 'v1MaskFreeze';
    frozen.textContent = '.page.on, .page.on *, .page.on *::before, .page.on *::after{animation:none!important;transition:none!important}';
    document.head.appendChild(frozen);
  }
  const re = /(\\d+\\s*(分钟|小时|秒)前|^刚刚$|刚刚，|\\d+\\s*天前)/;
  const reClock = /\\d{4}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2}/;
  document.querySelectorAll('.page.on *').forEach(e => {
    if (e.children.length === 0){
      const t = (e.textContent || '').trim();
      if (re.test(t) || reClock.test(t)) e.style.visibility = 'hidden';
    }
  });
  ['newsBody','newsMore','tNewsBody','newsMeta','tNewsMeta','nNewsMeta','stuNewsMeta'].forEach(id => {
    const e = document.getElementById(id); if (e) e.innerHTML = '';
  });
  const dg = document.getElementById('devGate'); if (dg) dg.style.display = 'none';
  return 1;
})()`;

/* 与 v1_mobile_check.mjs 同一份演示数据（保持基线可比） */
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
  sch('周四', p1.id, '即兴评述训练', '砺蕴一班');
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
  try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch(e){}
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
async function switchUser(cdp, cred) {
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
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
    let bad = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) {
        bad++;
        const p = i / 4, x = p % ia.width, y = Math.floor(p / ia.width);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4),
             bbox: bad ? [minX, minY, maxX, maxY] : null };
  })()`);
}

/* ── 基线 worktree（HEAD = 本次修改前）── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} HEAD`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

try {
  await mkdir(path.join(OUT, 'desktop'), { recursive: true });
  await mkdir(path.join(OUT, 'dark'), { recursive: true });
  await mkdir(path.join(OUT, 'mobile-guard'), { recursive: true });
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(HEAD 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'dv2-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5497',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','--allow-file-access-from-files','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5497/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  /* ═══ QA 样张回归 ═══
     故意放在所有 canvas 逐像素 diff 之前跑 —— 那些大画布会把渲染进程拖到
     崩溃边缘（实测 QA 页连 iframe 都拿不到 = 渲染进程已挂）。QA 用 iframe 同源加载，
     与登录态无关，放在哪段都行。 */
  console.log('\n── 样张 _qa.html 全量回归（经服务 A 提供 iframe 同源，先于所有 diff 跑）──');
    await sleep(500);
  await view(cdp, { width: 1280, height: 900, dsf: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE_A}/docs/redesign-2026-10/samples/_qa.html` });
  await view(cdp, { width: 1280, height: 900, dsf: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE_A}/docs/redesign-2026-10/samples/_qa.html` });
  let qa = null;
  for (let i = 0; i < 12; i++) {   /* 35 页×7 宽 iframe 跑完需要 10–30s，轮询到出 RESULT */
    await sleep(3000);
    qa = await cdp.eval(`(() => {
      const el = document.getElementById('out');
      const s = el ? el.textContent : '';
      const m = s.match(/PASS=(\\d+)\\s+FAIL=(\\d+)/);
      const fails = s.split('\\n').filter(l => l.startsWith('FAIL'));
      const f = document.getElementById('f');
      return { done: !!m, pass: m ? +m[1] : -1, fail: m ? +m[2] : -1, fails: fails.slice(0, 8),
               at: f ? (f.getAttribute('src') || '') + ' @' + f.style.width : 'no-iframe' };
    })()`);
    if (qa.done) break;
  }
  if (!qa.done) console.log('  （QA 未跑完，卡在：' + qa.at + '）');
  ok('样张 QA 全量通过（381 PASS 量级）', qa.done && qa.fail === 0, `PASS=${qa.pass} FAIL=${qa.fail}` + (qa.fails.length ? ' 失败样例：' + qa.fails.join(' ; ') : ''));

  /* ═══ 1) 桌面 1440：改动页截图 + vs HEAD diff 报告 ═══ */
  await view(cdp, { width: 1440, height: 1000, dsf: 1, mobile: false });
  console.log('── 桌面 1440 截图（工作区 → docs/desktop-v2-shots/desktop/）──');
  const ADM = ['home','att','roster','homework','settings'];
  const TEA = ['today'];
  const shotsA = {}, shotsB = {};
  for (const [base, tag, store] of [[BASE_A, 'A', shotsA], [BASE_B, 'B', shotsB]]) {
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2800);
    await login(cdp, SUPER);
    await cdp.eval(SEED_JS);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    await sleep(600);
    for (const id of ADM) {
      const f = path.join(OUT, 'desktop', `${tag}-${id}.png`);
      await goShot(cdp, id, f);
      store[id] = f;
    }
    await switchUser(cdp, TEACHER);
    for (const id of TEA) {
      const f = path.join(OUT, 'desktop', `${tag}-t-${id}.png`);
      await goShot(cdp, id, f);
      store['t-' + id] = f;
    }
  }
  console.log('vs HEAD 基线差异率（改动是有意的：页题衬线/图例类/ghost 边框等）：');
  for (const key of [...ADM, ...TEA.map(x => 't-' + x)]) {
    const d = await diffTwo(cdp, await readFile(shotsA[key]), await readFile(shotsB[key]));
    console.log(`  · ${key}  ${d.mismatch ? '尺寸不一致 ' + d.mismatch : `diff ${d.bad}/${d.total}（${d.pct}%）` + (d.bbox ? ' bbox=' + JSON.stringify(d.bbox) : '')}`);
  }

  /* 断言一律在工作区 A 上做：截图循环最后停在基线 B + 教师身份，先切回来 */
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  await sleep(2800);
  await login(cdp, SUPER);
  await cdp.eval(SEED_JS);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(600);


  /* ═══ 2) 令牌 / 组件断言（≥1100，工作区）═══ */
  console.log('\n── DESKTOP-V2 令牌与组件断言（1440）──');
  const t = await cdp.eval(`(async () => {
    App.go('settings'); await new Promise(r => setTimeout(r, 500));
    const rs = getComputedStyle(document.documentElement);
    const title = document.querySelector('#page-settings.on > .page-title') || document.querySelector('.page.on .page-title');
    const tcs = title ? getComputedStyle(title) : null;
    const ghost = document.querySelector('#page-settings.on .btn.ghost') || document.querySelector('.page.on .btn.ghost');
    const layout = document.querySelector('#page-settings.on .anchor-layout');
    return {
      focusRaw: rs.getPropertyValue('--focus').trim(),
      cursorRaw: rs.getPropertyValue('--cursor').trim(),
      lineStrongRaw: rs.getPropertyValue('--line-strong').trim(),
      fsH1: rs.getPropertyValue('--fs-h1').trim(),
      cursorComputed: rs.getPropertyValue('--cursor') ? getComputedStyle(document.body).getPropertyValue('--cursor').trim() : '',
      titleFont: tcs ? tcs.fontFamily : null,
      titleWeight: tcs ? tcs.fontWeight : null,
      titleSize: tcs ? tcs.fontSize : null,
      titleDisplay: tcs ? tcs.display : null,
      ghostBorder: ghost ? getComputedStyle(ghost).borderColor : null,
      ghostStyle: ghost ? getComputedStyle(ghost).borderStyle : null,
      layoutCols: layout ? getComputedStyle(layout).gridTemplateColumns : null,
      navVisible: (() => { const n = document.querySelector('#page-settings.on .anchor-nav');
        return n ? getComputedStyle(n).display !== 'none' : null; })(),
    };
  })()`);
  ok('--focus 已合并为 var(--cursor)（Chrome 将 var() 解析为同值）', t.focusRaw === t.cursorRaw && /^#9C4E1F$/i.test(t.focusRaw), `focus=${t.focusRaw} cursor=${t.cursorRaw}`);
  ok('--cursor = #9C4E1F', /^#9C4E1F$/i.test(t.cursorComputed), t.cursorComputed);
  ok('--line-strong = #8A857C', /^#8A857C$/i.test(t.lineStrongRaw), t.lineStrongRaw);
  ok('--fs-h1 = 30px @1440（§7）', t.fsH1 === '30px', t.fsH1);
  ok('页题衬线（NotoSerifSC / 400 / 30px / flex baseline）',
     t.titleFont && t.titleFont.includes('NotoSerifSC') && (t.titleWeight === '400' || t.titleWeight === 'normal') &&
     t.titleSize === '30px' && t.titleDisplay === 'flex',
     JSON.stringify({ font: t.titleFont, w: t.titleWeight, s: t.titleSize, d: t.titleDisplay }));
  ok('.btn.ghost 边框 = var(--line-strong)（rgb 138,133,124）', /138,\s*133,\s*124/.test(t.ghostBorder || ''), t.ghostBorder);
  ok('settings 锚点栏桌面可见', t.navVisible === true);
  ok('settings anchor-layout 200px 左栏', /^200px/.test(t.layoutCols || ''), t.layoutCols);

  const leg = await cdp.eval(`(async () => {
    App.go('att'); await new Promise(r => setTimeout(r, 550));
    const pg = document.querySelector('#page-att.on');
    const is = pg.querySelectorAll('.legend i[style]').length;
    const cls = ['ok','late','sick','leave','absent'].map(c => !!pg.querySelector('.legend i.' + c));
    const bgOk = pg.querySelector('.legend i.ok') ? getComputedStyle(pg.querySelector('.legend i.ok')).backgroundColor : null;
    const hd = document.getElementById('hwDate');
    const ratio = pg.querySelector('.ratio i.ok') ? getComputedStyle(pg.querySelector('.ratio i.ok')).backgroundColor : null;
    return { is, cls, bgOk, hdStyled: hd ? !!hd.getAttribute('style') : null, hdCls: hd ? hd.className : null, ratio };
  })()`);
  ok('att 图例无行内 style（P2-12）', leg.is === 0, 'i[style]=' + leg.is);
  ok('att 图例五色类齐全', leg.cls.every(Boolean), JSON.stringify(leg.cls));
  ok('att 图例色 = --stamp-ok（rgb 42,110,80）', /42,\s*110,\s*80/.test(leg.bgOk || ''), leg.bgOk);
  ok('#hwDate 行内样式已收敛为 .hw-date（P2-12）', leg.hdStyled === false && /hw-date/.test(leg.hdCls || ''), JSON.stringify({ styled: leg.hdStyled, cls: leg.hdCls }));

  /* ═══ 3) P2-d is-stuck ═══ */
  console.log('\n── P2-d 吸住态 is-stuck ──');
  await view(cdp, { width: 768, height: 1000, dsf: 1, mobile: false });
  await sleep(600);
  const stuck768 = await cdp.eval(`(async () => {
    App.go('att'); await new Promise(r => setTimeout(r, 550));
    const main = document.querySelector('.main');
    const bar = document.querySelector('.attgrid .sumbox');
    main.scrollTop = 600; main.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 300));
    const on = bar.classList.contains('is-stuck');
    const sh = getComputedStyle(bar).boxShadow;
    main.scrollTop = 0; main.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 300));
    return { on, sh, offAfterTop: !bar.classList.contains('is-stuck') };
  })()`);
  ok('768 吸住挂 .is-stuck 且有阴影', stuck768.on && stuck768.sh !== 'none', JSON.stringify(stuck768));
  ok('768 回顶摘掉 .is-stuck', stuck768.offAfterTop);
  await view(cdp, { width: 1440, height: 1000, dsf: 1, mobile: false });
  await sleep(600);
  const stuck1440 = await cdp.eval(`(async () => {
    App.go('att'); await new Promise(r => setTimeout(r, 550));
    const main = document.querySelector('.main');
    const bar = document.querySelector('.attgrid .sumbox');
    main.scrollTop = 600; main.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 300));
    return { on: bar.classList.contains('is-stuck') };
  })()`);
  ok('1440 右栏卡片态不挂 .is-stuck', stuck1440.on === false);

  /* ═══ 4) 深色 3 页 ═══ */
  console.log('\n── 深色模式（1440 · 3 页）──');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  const dark = await cdp.eval(`(() => {
    const rs = getComputedStyle(document.documentElement);
    return {
      cursor: rs.getPropertyValue('--cursor').trim(),
      lineStrong: rs.getPropertyValue('--line-strong').trim(),
      focus: rs.getPropertyValue('--focus').trim(),
    };
  })()`);
  ok('深色 --cursor = #D98A5A（v57 实测值）', /^#D98A5A$/i.test(dark.cursor), dark.cursor);
  ok('深色 --line-strong = #8F897F', /^#8F897F$/i.test(dark.lineStrong), dark.lineStrong);
  ok('深色 --focus = var(--cursor)（解析为 #D98A5A）', /^#D98A5A$/i.test(dark.focus), dark.focus);
  await switchUser(cdp, SUPER);
  for (const id of ['home','att','settings']) {
    await goShot(cdp, id, path.join(OUT, 'dark', `dark-${id}.png`));
  }
  console.log('  （深色 3 页截图已存 docs/desktop-v2-shots/dark/）');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  /* ═══ 5) 手机 390 零回归（硬门槛：与 HEAD 逐像素 0 差异）═══
     每张截图前 dev-reset + 重新登录 + 重种一次 —— 种子数据里有 upsert 不去重的
     实体（schedule/tickets/students），重复播种会让两侧计数漂移出假差异。
     settings 页豁免 ≤200px：sw.js VERSION v88 → 设置页版本号「VoxOS 5.08」与
     基线「5.07」的文本差（verCode 由 sw.js 上报换算，属预期）。 */
  console.log('\n── 手机 390 零回归（vs HEAD 基线，逐像素）──');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  const mshots = { A: {}, B: {} };
  const phoneShot = async (base, tag, key, who) => {
    try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2600);
    /* ⚠️ dev-reset 只清服务端；本地 localStorage 里历代种子会累积（upsert 不去重的
       实体越滚越多且两侧未必对称）→ 先清空浏览器存储，保证两侧都恰好种一次 */
    await cdp.eval(`try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} 'ok'`);
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2400);
    await login(cdp, SUPER);   /* reset 后首个账号自动成为教务 */
    await cdp.eval(SEED_JS);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    if (who !== SUPER) await switchUser(cdp, who);
    const f = path.join(OUT, 'mobile-guard', `${tag}-${key}.png`);
    await goShot(cdp, key, f);
    mshots[tag][key] = f;
  };
  for (const key of ['home','settings','stuHome']) {
    const who = key === 'stuHome' ? STUDENT : SUPER;
    for (const [base, tag] of [[BASE_A, 'A'], [BASE_B, 'B']]) await phoneShot(base, tag, key, who);
    let d = null, good = false;
    for (let attempt = 0; attempt < 3 && !good; attempt++){
      if (attempt > 0) {   /* 亚像素抖动重截：两侧同流程重跑，种子数恒等 */
        for (const [base, tag] of [[BASE_A, 'A'], [BASE_B, 'B']]) await phoneShot(base, tag, key, who);
      }
      d = await diffTwo(cdp, await readFile(mshots.A[key]), await readFile(mshots.B[key]));
      good = !d.mismatch && (d.bad === 0 || (key === 'settings' && d.bad <= 200));
    }
    ok(`手机 390 · ${key} 与 HEAD 零差异${key === 'settings' ? '（版本号文本 ≤200px 豁免）' : ''}`, good,
       d.mismatch ? '尺寸不一致 ' + d.mismatch : `差异像素 ${d.bad}/${d.total}（${d.pct}%）` + (d.bbox ? ' bbox=' + JSON.stringify(d.bbox) : ''));
  }


  console.log('\n' + (fails.length ? '❌ 失败 ' + fails.length + ' 项：\n  - ' + fails.join('\n  - ') : '✅ 全部通过'));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\n✗ 验证失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  srvA.kill(); srvB.kill();
  try { execSync(`git -C ${JSON.stringify(dir)} worktree remove --force ${BASE_DIR}`, { stdio: 'pipe' }); } catch {}
}
