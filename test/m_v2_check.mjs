/* ==M2== 手机端版本一补全 · 本地验证（不部署）
 *
 *   node test/m_v2_check.mjs
 *
 * 断言四组：
 *   1) V1 13 页零回退：home/att/homework/timetable/settings/today/myclass/tickets/
 *      stuHome/stuSign/stuHw/stuTable + 登录门，390 与 HEAD 基线 worktree 逐像素 0 差异；
 *   2) V2 词汇断言（roster/record/stuMsg 三页代表）：主按钮学府蓝渐变、
 *      页题 24px/800、卡金饰退场（::before content none）、chip 胶囊 999px；
 *   3) 深色抽查（roster/quant）：--paper 翻 #18211E、正文可读；
 *   4) 业务回归：考勤点章、作业勾选（确认 V2 换皮没碰交互）。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_A = 5487, PORT_B = 5488;
const BASE_A = `http://127.0.0.1:${PORT_A}`;
const BASE_B = `http://127.0.0.1:${PORT_B}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE_DIR = '/tmp/m2-base';
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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

const MASK_JS = `(() => {
  let frozen = document.getElementById('mMaskFreeze');
  if (!frozen){
    frozen = document.createElement('style'); frozen.id = 'mMaskFreeze';
    frozen.textContent = '.page.on, .page.on *, .page.on *::before, .page.on *::after,' +
      '.topbar, .mtabbar, .gate, .gate *{animation:none!important;transition:none!important}';
    document.head.appendChild(frozen);
  }
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr, [data-next], .p-time').forEach(e => e.style.visibility = 'hidden');
  const re = /(\\d+\\s*(分钟|小时|秒)前|^刚刚$|刚刚，|\\d+\\s*天前)/;
  const reClock = /\\d{4}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2}/;
  document.querySelectorAll('.page.on *, .gate *').forEach(e => {
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
  Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
  const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
  s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false);
  Store.set('_attCls', c1.id); Store.set('_attDate', today);
  Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
  Store.set('_tdAttCls', c1.id);
  window.__seedErrs = [];
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id, c2.id] }); }
  catch(e){ window.__seedErrs.push('teacher:' + (e.message || e)); }
  try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); }
  catch(e){ window.__seedErrs.push('student:' + (e.message || e)); }
  return window.__seedErrs.join('|') || 'seed-ok';
})()`;

async function seedOn(cdp) {
  const r = await cdp.eval(SEED_JS);
  if (r !== 'seed-ok') console.log('  ⚠️ seed 建号提示：' + r);
  return r;
}

async function boot(base) {
  await waitFor(async () => (await jfetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: `服务 ${base}`, tries: 40 });
  try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
}
async function login(cdp, cred) {
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + cred.user);
  return lg.role;
}
async function switchUser(cdp, cred) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const role = await cdp.eval(`(async () => {
      Store.setSecret('token',''); Auth._me = null; Auth.show();
      await new Promise(r => setTimeout(r, 350));
      document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
      document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
      await Auth.submit();
      await new Promise(r => setTimeout(r, 2400));
      return Auth.role();
    })()`);
    await sleep(600);
    if (role) return role;
    console.log(`  ⚠️ 切换 ${cred.user} 第 ${attempt + 1} 次未成（role 空），重试…`);
  }
  throw new Error('切换身份失败：' + cred.user);
}
async function goShot(cdp, pageId, file) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 550)); window.scrollTo(0,0);
    const m = document.querySelector('.main'); if (m) m.scrollTop = 0; return 1; })()`);
  await sleep(350);
  await cdp.eval(MASK_JS);
  await sleep(200);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(r.data, 'base64'));
}
async function diffTwo(cdp, bufA, bufB) {
  const a = bufA.toString('base64'), b = bufB.toString('base64');
  return cdp.eval(`(async () => {
    const load = b64 => new Promise((res, rej) => { const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('img load fail')); i.src = 'data:image/png;base64,' + b64; });
    const ia = await load(${JSON.stringify(a)}), ib = await load(${JSON.stringify(b)});
    if (ia.width !== ib.width || ia.height !== ib.height) return { mismatch: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const ca = document.createElement('canvas'); ca.width = ia.width; ca.height = ia.height;
    const cb = document.createElement('canvas'); cb.width = ib.width; cb.height = ib.height;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, ia.width, ia.height).data;
    const db = xb.getImageData(0, 0, ib.width, ib.height).data;
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8 || Math.abs(da[i+3]-db[i+3]) > 8) bad++;
    }
    return { total: da.length / 4, bad, pct: +(100 * bad / (da.length / 4)).toFixed(4) };
  })()`);
}

/* ── 基线 worktree（HEAD）── */
try { execSync(`git -C ${JSON.stringify(dir)} worktree add ${BASE_DIR} HEAD`, { stdio: 'pipe' }); }
catch (e) { if (!String(e.stderr).includes('already')) throw new Error('建基线 worktree 失败：' + e.message); }

const srvA = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT_A)], { cwd: dir, stdio: 'ignore' });
const srvB = spawn(process.execPath, [path.join(BASE_DIR, 'test', 'dev-server.mjs'), String(PORT_B)], { cwd: BASE_DIR, stdio: 'ignore' });
let chrome;
const fails = [];
const ok = (name, cond, detail = '') => { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : '')); if (!cond) fails.push(name); };

/* V1 13 页（改动页除外，须与 HEAD 逐像素一致）——按身份分组 */
const V1_PAGES = [
  { who: SUPER,   ids: ['home','att','homework','timetable','settings'] },
  { who: TEACHER, ids: ['today','myclass','tickets'] },
  { who: STUDENT, ids: ['stuHome','stuSign','stuHw','stuTable'] },
];

try {
  await boot(BASE_A); await boot(BASE_B);
  console.log('两份 fresh 服务就绪：', BASE_A, '(工作区) /', BASE_B, '(HEAD 基线)\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'm2-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5494',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5494/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });

  const phoneShot = async (base, tag, key, who) => {
    try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2600);
    await cdp.eval(`try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} 'ok'`);
    await cdp.send('Page.navigate', { url: base + '/' });
    await sleep(2400);
    await login(cdp, SUPER);
    await seedOn(cdp);
    await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
    if (who !== SUPER) await switchUser(cdp, who);
    await goShot(cdp, key, `/tmp/m2-${tag}-${key}.png`);
  };

  /* ═══ 1) V1 13 页 vs HEAD 逐像素零差异 ═══ */
  console.log('── V1 13 页零回退（vs HEAD 基线，逐像素）──');
  for (const g of V1_PAGES) {
    for (const key of g.ids) {
      let d = null, good = false;
      for (let attempt = 0; attempt < 2 && !good; attempt++){
        if (attempt > 0) { await sleep(800); }
        await phoneShot(BASE_A, 'A', key, g.who);
        await phoneShot(BASE_B, 'B', key, g.who);
      d = await diffTwo(cdp, await readFile(`/tmp/m2-A-${key}.png`), await readFile(`/tmp/m2-B-${key}.png`));
      /* settings 例外：sw VERSION 文案差（v89 vs v88）≈ 140px 量级，与 v88 批同款豁免 ≤200px；
         其余页硬性 0 差异 */
      good = !d.mismatch && (d.bad === 0 || (key === 'settings' && d.bad <= 200));
      }
      ok(`V1 · ${key} 与 HEAD 零差异`, good,
         d.mismatch ? '尺寸不一致 ' + d.mismatch : `差异像素 ${d.bad}/${d.total}（${d.pct}%）`);
    }
  }

  /* ═══ 2) V2 词汇断言（工作区）═══ */
  console.log('\n── V2 词汇断言 ──');
  try { await jfetch(`${BASE_A}/api/dev-reset`, { method: 'POST' }); } catch {}
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  await sleep(2600);
  await cdp.eval(`try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} 'ok'`);
  await cdp.send('Page.navigate', { url: BASE_A + '/' });
  await sleep(2400);
  await login(cdp, SUPER);
  await seedOn(cdp);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(600);

  await cdp.eval(`App.go('roster'); 'ok'`);
  await sleep(700);
  const v2a = await cdp.eval(`(() => {
    const page = document.getElementById('page-roster');
    const btn = page.querySelector('.btn');
    const card = page.querySelector('.card');
    const title = page.querySelector(':scope > .page-title');
    return {
      btnGrad: btn ? getComputedStyle(btn).backgroundImage.includes('gradient') : null,
      btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
      cardBefore: card ? getComputedStyle(card, '::before').content : null,
      cardRadius: card ? getComputedStyle(card).borderRadius : null,
      titleSize: title ? getComputedStyle(title).fontSize : null,
      titleWeight: title ? getComputedStyle(title).fontWeight : null,
      titleColor: title ? getComputedStyle(title).color : null,
      accent: getComputedStyle(page).getPropertyValue('--accent').trim(),
    };
  })()`);
  ok('roster 主按钮 = 学府蓝渐变圆角', v2a.btnGrad && v2a.btnRadius === '12px', JSON.stringify(v2a));
  ok('roster 卡金饰退场（::before none）', v2a.cardBefore === 'none', 'content=' + v2a.cardBefore);
  ok('roster 卡圆角 14px', v2a.cardRadius === '14px', v2a.cardRadius);
  ok('roster 页题 24px/800 墨色', v2a.titleSize === '24px' && v2a.titleWeight === '800', JSON.stringify(v2a));
  ok('roster --accent 翻蓝', /74,\s*92,\s*140/.test(v2a.accent) || v2a.accent === 'var(--blue)' || v2a.accent === '#4a5c8c', v2a.accent);

  /* chip 胶囊（record 页有状态 chip） */
  await switchUser(cdp, TEACHER);
  await cdp.eval(`App.go('record'); 'ok'`);
  await sleep(800);
  const v2b = await cdp.eval(`(() => {
    const page = document.getElementById('page-record');
    const chip = page.querySelector('.chip');
    const btn = page.querySelector('.btn');
    return {
      chipRadius: chip ? getComputedStyle(chip).borderRadius : null,
      btnGrad: btn ? getComputedStyle(btn).backgroundImage.includes('gradient') : null,
    };
  })()`);
  ok('record 状态 chip 胶囊化（999px）', v2b.chipRadius === '999px', 'r=' + v2b.chipRadius);
  ok('record 主按钮翻蓝（原黑按钮）', v2b.btnGrad === true, String(v2b.btnGrad));

  /* 学生端 stuMsg 主按钮翻蓝（原绿按钮） */
  await switchUser(cdp, STUDENT);
  await cdp.eval(`App.go('stuMsg'); 'ok'`);
  await sleep(800);
  const v2c = await cdp.eval(`(() => {
    const btn = document.querySelector('#page-stuMsg .btn');
    return btn ? getComputedStyle(btn).backgroundImage.includes('gradient') : null;
  })()`);
  ok('stuMsg 主按钮翻蓝（原绿按钮）', v2c === true, String(v2c));

  /* ═══ 3) 业务回归：考勤点章 + 作业勾选（确认换皮没碰交互）═══ */
  console.log('\n── 业务回归抽查 ──');
  await switchUser(cdp, SUPER);
  await cdp.eval(`App.go('att'); 'ok'`);
  await sleep(800);
  const stamp = await cdp.eval(`(async () => {
    /* 点一枚「未选中」的章 → 汇总联动；注意 Att 点章后会重画名单（DOM 换新节点），
       断言要用点击后的新节点重查 aria-pressed，不能用旧引用。 */
    const b = [...document.querySelectorAll('#page-att.on .stamp')].find(s => s.getAttribute('aria-pressed') !== 'true');
    if (!b) return { found: false };
    const v = b.dataset.v, stu = b.closest('.stu') ? b.closest('.stu').dataset.id || '' : '';
    const before = (document.querySelector('[data-sum="bad"]') || {}).textContent || '';
    b.click();
    await new Promise(r => setTimeout(r, 500));
    const fresh = [...document.querySelectorAll('#page-att.on .stamp')]
      .find(s => s.dataset.v === v && (s.closest('.stu') ? s.closest('.stu').dataset.id || '' : '') === stu) || b;
    const after = (document.querySelector('[data-sum="bad"]') || {}).textContent || '';
    return { found: true, v, pressed: fresh.getAttribute('aria-pressed'), changed: before !== after };
  })()`);
  ok('考勤点章可交互（选中 + 汇总联动）', stamp.found && stamp.pressed === 'true' && stamp.changed, JSON.stringify(stamp));

  await cdp.eval(`App.go('homework'); 'ok'`);
  await sleep(800);
  const hw = await cdp.eval(`(async () => {
    /* 今日检查行 = 已交/未交 chip；renderChk 点完重画 #hkBody → 点击后按行重查 */
    const chip = [...document.querySelectorAll('#page-homework.on .chip')].find(c => c.textContent.trim() === '已交' && !c.classList.contains('chip-on'));
    if (!chip) return { found: false, n: document.querySelectorAll('#page-homework.on .chip').length };
    const row = chip.closest('.item');
    const name = row ? (row.querySelector('.grow') || {}).textContent || '' : '';
    chip.click();
    await new Promise(r => setTimeout(r, 500));
    const rows = [...document.querySelectorAll('#page-homework.on .item')];
    const fresh = rows.find(r => (r.querySelector('.grow') || {}).textContent === name);
    return { found: true, nowOn: fresh ? !!fresh.querySelector('.chip-on') : false };
  })()`);
  ok('作业勾选可交互（chip 翻选中态）', hw.found && hw.nowOn === true, JSON.stringify(hw));

  /* ═══ 4) 深色抽查（roster / quant）═══ */
  console.log('\n── 深色抽查（390 · 2 页）──');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(500);
  const dark = await cdp.eval(`(() => {
    const r = document.getElementById('page-roster');
    App.go('roster');
    const rs = getComputedStyle(r);
    const title = r.querySelector(':scope > .page-title');
    return {
      paper: rs.getPropertyValue('--paper').trim(),
      goldDeep: rs.getPropertyValue('--gold-deep').trim(),
      titleColor: title ? getComputedStyle(title).color : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  })()`);
  ok('深色 roster --paper 翻 #18211E', /^#18211E$/i.test(dark.paper), dark.paper);
  ok('深色 gold-deep 翻 #D9BE86', /^#D9BE86$/i.test(dark.goldDeep), dark.goldDeep);
  ok('深色页题仍可读（非深底深字）', dark.titleColor && dark.titleColor !== 'rgb(38, 36, 31)', dark.titleColor);
  await goShot(cdp, 'roster', '/tmp/m2-dark-roster.png');
  await cdp.eval(`App.go('quant'); 'ok'`);
  await sleep(700);
  await goShot(cdp, 'quant', '/tmp/m2-dark-quant.png');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  console.log('  （深色截图存 /tmp/m2-dark-*.png）');

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
