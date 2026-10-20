/* v85 批次 3a · 学生端五页重排 —— 功能与红线断言
 *
 *   node test/stu3a_check.mjs [端口]
 *
 * 断言清单（全过 → exit 0，任何一条挂 → exit 1）：
 *   1) 水印铁律：body.stu 时 #watermark 存在、fixed 满屏、opacity .085、mask 320×210
 *   2) .mtabbar 高亮随 App.go 切换（五个 Tab 逐个点）
 *   3) 打卡页四态同心圆：默认打卡（蓝，可点）→ 已打卡 done → 迟到 late → 请假/不用打卡 off
 *      圈内时分秒元素存在；点击圈后步骤区出「扫码/手输」入口（提交链路按钮可用）
 *   4) 作业页：班长登记卡在，StuHw.mark 点一下 → chip 变已交
 *   5) 课表页：按天分组渲染出课目卡
 *   6) bg-logo：stuHome/settings 在 <1100 可见且 pointer-events:none / opacity .32；
 *      ≥1100 桌面 display:none
 *   7) 小屏 375×667 与 320：.main 无横向溢出、页面底部预留 ≥68px（不被 .mtabbar 遮挡）
 *   8) 深色模式：卡片底色变深、正文变浅（令牌翻转生效），hero 头带仍是学府蓝
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5323);
const DEBUG_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
const view = (cdp, w, h, mobile = true) =>
  cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });

let fails = [];
const ok = (cond, name) => { console.log((cond ? '  ✅' : '  ❌') + ' ' + name); if (!cond) fails.push(name); };

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务' });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}

  const profile = await mkdtemp(path.join(tmpdir(), 'stu3a-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const l = await (await jfetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); return l.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口' });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, 500, 900);

  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  await sleep(2400);

  /* 登录首位教务 + 灌最小演示数据（班级/学生/作业/班干部 + 学生账号），再切学生 */
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '测试教务';
    document.getElementById('gPass').value = 'stu3apass1';
    await Auth.submit(); await new Promise(r => setTimeout(r, 1800));
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const s1 = Store.upsert('students', { classId: c1.id, name: '王梓涵' });
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    Store.upsert('schedule', { kind:'big', day:'周一', periodId:p1.id, title:'普通话语音基础', cls:'砺蕴一班', stu:'' });
    Store.upsert('schedule', { kind:'big', day:Stu.DAYS[(new Date().getDay()+6)%7], periodId:p1.id, title:'即兴评述训练', cls:'砺蕴一班', stu:'' });
    Store.upsert('homework', { clsId:c1.id, date:today, text:'新闻播报练习：录一条 1 分钟音频' });
    Store.upsert('officers', { clsId:c1.id, title:'班长', studentId:s1.id });
    try { await Auth.call('users', { op:'create', user:'王梓涵', name:'王梓涵', role:'student', pass:'liyun2026', studentId:s1.id }); } catch(e){}
    return 1;
  })()`);

  const sw = await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '王梓涵';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r => setTimeout(r, 2200));
    return { role: Auth.role(), name: Auth.name() };
  })()`);
  if (sw.role !== 'student') throw new Error('切学生失败：' + JSON.stringify(sw));
  console.log('已登录学生：' + sw.name + '\n');
  await sleep(800);

  /* ── 1) 水印铁律 ── */
  console.log('① 水印');
  const wm = await cdp.eval(`(() => {
    const el = document.getElementById('watermark');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { disp: cs.display, pos: cs.position, op: cs.opacity,
      mask: cs.webkitMaskSize || cs.maskSize,
      inset: el.getBoundingClientRect().width + 'x' + el.getBoundingClientRect().height,
      pe: cs.pointerEvents, z: cs.zIndex };
  })()`);
  ok(wm && wm.disp === 'block' && wm.pos === 'fixed', `#watermark fixed 显示（${JSON.stringify(wm)}）`);
  ok(wm && wm.op === '0.085', 'opacity = .085');
  ok(wm && /320px 210px/.test(wm.mask || ''), 'mask 贴片 320×210');

  /* ── 2) mtabbar 高亮跟随 ── */
  console.log('② mtabbar 高亮');
  for (const [pid, idx] of [['stuHome',0],['stuSign',1],['stuHw',2],['stuTable',3],['settings',4]]){
    const r = await cdp.eval(`(async () => {
      App.go('${pid}'); await new Promise(r => setTimeout(r, 240));
      const btns = [...document.querySelectorAll('#mtabbar button')];
      return { n: btns.length, on: btns.findIndex(b => b.classList.contains('on')), vis: getComputedStyle(document.getElementById('mtabbar')).display };
    })()`);
    ok(r.n === 5 && r.on === idx && r.vis === 'flex', `App.go('${pid}') → 第 ${idx + 1} 个 Tab 高亮（on=${r.on}）`);
  }

  /* ── 3) 打卡四态 ── */
  console.log('③ 打卡四态同心圆');
  await cdp.eval(`(async () => { App.go('stuSign'); await new Promise(r => setTimeout(r, 400)); return 1; })()`);
  const st0 = await cdp.eval(`(() => {
    const ring = document.querySelector('#stuSignNow .p-ring');
    return { cls: ring.className, word: document.querySelector('#stuSignNow .p-word').textContent,
      time: !!document.querySelector('#stuSignNow .p-time'), tap: ring.getAttribute('onclick') || '' };
  })()`);
  ok(/\bp-ring\b/.test(st0.cls) && !/done|late|off/.test(st0.cls), `未打卡态：素圈（${st0.cls}）`);
  ok(st0.word === '打卡' && st0.time && /StuSign\.start/.test(st0.tap), '圈内「打卡」+ 服务端时分秒 + 圈即按钮');

  /* 提交链路入口可用：点圈 → 步骤区出扫码/手输；切手输 → 输入框在 */
  const chain = await cdp.eval(`(async () => {
    document.querySelector('#stuSignNow .p-ring').click();
    await new Promise(r => setTimeout(r, 300));
    const step = document.getElementById('stuSignStep');
    const hasScan = !!step.querySelector('button[onclick="StuSign.scan()"]');
    StuSign.manual(true); await new Promise(r => setTimeout(r, 200));
    const hasInput = !!document.getElementById('stuCode');
    return { hasScan, hasInput, stepText: step.textContent.slice(0, 40) };
  })()`);
  ok(chain.hasScan && chain.hasInput, `提交链路：扫码入口 + 手输输入框可用（${chain.stepText.trim()}）`);
  await cdp.eval(`(async () => { StuSign._stage=''; StuSign.render(); await new Promise(r=>setTimeout(r,200)); return 1; })()`);

  /* 已打卡 / 迟到 / 不用打卡三态：直接写当日 sign 记录再重渲染（只验视觉态映射，不动逻辑） */
  const tri = await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    const put = st => { Store.upsert('sign:' + d, { id: sid, studentId: sid, status: st, at: Date.now(), way: 'geo-ok' }); StuSign.render(); };
    put('正常'); await new Promise(r => setTimeout(r, 200));
    const done = document.querySelector('#stuSignNow .p-ring').className;
    const doneWord = document.querySelector('#stuSignNow .p-word').textContent;
    put('迟到'); await new Promise(r => setTimeout(r, 200));
    const late = document.querySelector('#stuSignNow .p-ring').className;
    const lateWord = document.querySelector('#stuSignNow .p-word').textContent;
    Store.softDelete('sign:' + d, (Store.list('sign:' + d)[0] || {}).id);
    StuSign.render(); await new Promise(r => setTimeout(r, 200));
    return { done, doneWord, late, lateWord };
  })()`);
  ok(/done/.test(tri.done) && tri.doneWord === '已打卡', `已打卡态 → done 圈「已打卡」`);
  ok(/late/.test(tri.late) && tri.lateWord === '迟到', `迟到态 → late 圈「迟到」`);
  const off = await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    Store.upsert('tickets', { type:'学生请假', studentId:sid, kind:'病假', date:d, text:'测试', status:'done', createdAt:Date.now() });
    StuSign.render(); await new Promise(r => setTimeout(r, 200));
    const cls = document.querySelector('#stuSignNow .p-ring').className;
    const w = document.querySelector('#stuSignNow .p-word').textContent;
    Store.softDelete('tickets', (Store.list('tickets').find(t => t.type === '学生请假') || {}).id);
    StuSign.render(); await new Promise(r => setTimeout(r, 150));
    return { cls, w };
  })()`);
  ok(/off/.test(off.cls) && off.w === '不用打卡', `请假日 → off 灰圈「不用打卡」`);

  /* ── 4) 作业四态/登记 ── */
  console.log('④ 作业');
  await cdp.eval(`(async () => { App.go('stuHw'); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  const hw = await cdp.eval(`(async () => {
    const entry = document.getElementById('stuHwEntryCard');
    const entryOn = entry && entry.style.display !== 'none';
    const chip = document.querySelector('#stuHwEntry .chip');
    if (!chip) return { entryOn, marked: false, detail: 'no chip' };
    const oc = chip.getAttribute('onclick') || '';
    const ids = oc.slice(oc.indexOf('(') + 1, oc.lastIndexOf(')'))
      .split(',').map(s => s.trim().replace(/'/g, ''));
    if (ids.length !== 2) return { entryOn, marked: false, detail: 'onclick 不符：' + oc };
    window._hw3aErr = ''; window.addEventListener('error', e => { window._hw3aErr = e.message; });
    chip.click();
    /* 轮询 2s：登记记录落库 + chip 变已交（重绘有先后） */
    let rec = null, cls = '';
    for (let i = 0; i < 20; i++){
      await new Promise(r => setTimeout(r, 100));
      rec = Store.list('hw:' + ids[0]).find(x => x && x.studentId === ids[1]);
      cls = (document.querySelector('#stuHwEntry .chip') || {}).className || '';
      if (rec && rec.done === 1 && cls.indexOf('chip-on') >= 0) break;
    }
    return { entryOn, marked: !!(rec && rec.done === 1 && cls.indexOf('chip-on') >= 0),
      detail: 'rec=' + JSON.stringify(rec) + ' cls=' + cls + (window._hw3aErr ? ' jserr=' + window._hw3aErr : '') };
  })()`);
  ok(hw.entryOn, '班长登记卡显示');
  ok(hw.marked, `StuHw.mark 点一下 → 未交变已交（${hw.detail}）`);

  /* ── 5) 课表渲染 ── */
  console.log('⑤ 课表');
  const tb = await cdp.eval(`(async () => {
    App.go('stuTable'); await new Promise(r => setTimeout(r, 400));
    const days = [...document.querySelectorAll('#stuWeek > p.hint')].map(p => p.textContent.trim());
    const items = document.querySelectorAll('#stuWeek .item').length;
    return { days, items };
  })()`);
  ok(tb.items > 0 && tb.days.length > 0, `按天分组渲染（${tb.days.join('/')}，${tb.items} 节课）`);

  /* ── 6) bg-logo ── */
  console.log('⑥ hero 浮雕');
  await cdp.eval(`(async () => { App.go('stuHome'); await new Promise(r => setTimeout(r, 900)); return 1; })()`);
  const logoHome = await cdp.eval(`(() => {
    const el = document.querySelector('#page-stuHome .bg-logo');
    const cs = getComputedStyle(el);
    return cs.display + '/' + cs.opacity + '/' + cs.pointerEvents + '/' + cs.transform;
  })()`);
  ok(/^block\/0\.32\/none\//.test(logoHome) && /0\.99027|matrix\(0\.99/.test(logoHome), `stuHome 浮雕可见 rotate(-8°) opacity .32（${logoHome}）`);
  await cdp.eval(`(async () => { App.go('settings'); await new Promise(r => setTimeout(r, 900)); return 1; })()`);
  const logoMe = await cdp.eval(`(() => {
    const el = document.querySelector('#page-settings .bg-logo');
    const cs = getComputedStyle(el);
    return cs.display + '/' + cs.opacity + '/' + cs.pointerEvents;
  })()`);
  ok(logoMe === 'block/0.32/none', `settings 浮雕可见 opacity .32（${logoMe}）`);
  await view(cdp, 1440, 900, false);
  const ld = await cdp.eval(`(() => {
    const el = document.querySelector('#page-stuHome .bg-logo');
    return el ? getComputedStyle(el).display : 'missing';
  })()`);
  ok(ld === 'none', '桌面 1440：.bg-logo 不渲染');

  /* ── 7) 小屏溢出 / 底部遮挡 ── */
  console.log('⑦ 小屏');
  for (const [w, h] of [[375, 667], [320, 568]]){
    await view(cdp, w, h);
    for (const pid of ['stuHome','stuSign','stuHw','stuTable','settings']){
      const ov = await cdp.eval(`(async () => {
        App.go('${pid}'); await new Promise(r => setTimeout(r, 260));
        const m = document.getElementById('main');
        const page = document.querySelector('.page.on');
        return { sw: m.scrollWidth, cw: m.clientWidth,
          padB: parseFloat(getComputedStyle(page).paddingBottom),
          bw: document.body.scrollWidth, bvw: window.innerWidth };
      })()`);
      ok(ov.sw <= ov.cw && ov.bw <= ov.bvw, `${w}px ${pid}：无横向溢出（main ${ov.sw}/${ov.cw} body ${ov.bw}/${ov.bvw}）`);
      ok(ov.padB >= 68, `${w}px ${pid}：底部预留 ${ov.padB}px ≥ 68（.mtabbar 不遮内容）`);
    }
  }

  /* ── 8) 深色模式 ── */
  console.log('⑧ 深色模式');
  await view(cdp, 500, 900);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  const dk = await cdp.eval(`(async () => {
    App.go('stuHome'); await new Promise(r => setTimeout(r, 300));
    const page = document.querySelector('#page-stuHome');
    const card = page.querySelector('.card');
    const h2 = page.querySelector('.card h2');
    return {
      bg: getComputedStyle(page).backgroundImage.slice(0, 60),
      cardBg: getComputedStyle(card).backgroundColor,
      cardLine: getComputedStyle(card).borderTopColor,
      text: getComputedStyle(page.querySelector('.page-title')).color,
      h2: getComputedStyle(h2).color,
      bodyBg: getComputedStyle(document.body).backgroundColor };
  })()`);
  const dark = (c) => { const m = c.match(/(\d+), (\d+), (\d+)/); return m ? (+m[1] + +m[2] + +m[3]) / 3 < 80 : false; };
  ok(dark(dk.cardBg), `卡片底色翻深（${dk.cardBg}）`);
  ok(!dark(dk.h2), `章节标题变浅色可读（${dk.h2}）`);
  ok(/rgb\(80, 97, 143\)/.test(dk.bg) && /rgb\(74, 92, 140\)/.test(dk.bg), `hero 头带保持学府蓝（${dk.bg.slice(0, 70)}…）`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  console.log('\n' + (fails.length ? '❌ 未过 ' + fails.length + ' 条：\n- ' + fails.join('\n- ') : '✅ 全部断言通过'));
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error('\n✗ 检查中断：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  server.kill();
}
