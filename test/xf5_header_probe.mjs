/* ==XF5== 页眉三层化探针（本地验证，不入部署链） */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
const dir = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台';
const PORT = 5493, BASE = `http://127.0.0.1:${PORT}`;
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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
const srv = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
const ok = (n, c, d = '') => console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' —— ' + d : ''));
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'xf5-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5492',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5492/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(4500);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return 1;
  })()`);
  await cdp.eval(`(async () => {
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    ['王梓涵','李思远','张予诺'].forEach(n => Store.upsert('students', { classId: c1.id, name: n }));
    try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id] }); } catch(e){ return String(e && e.message || e); }
    return 1;
  })()`);
  await sleep(600);

  /* ── home：四层保留 ── */
  const h = await cdp.eval(`(() => {
    const u = document.querySelector('.xf-util');
    return { util: !!u && getComputedStyle(u).display !== 'none',
      ports: document.getElementById('xfPorts').textContent.trim(),
      term: document.querySelector('.xf-term-in').textContent.trim(),
      who: document.getElementById('xfWho').textContent.trim() };
  })()`);
  ok('home 门户条保留（四层不动）', h.util);
  ok('home 端口标签=教师（禁字清零）', h.ports === '教师', h.ports);
  ok('home 白条=学年|教学周|校名（原样）', h.term.includes('学年') && h.term.includes('教学周') && h.term.includes('南阳博艺教育'), h.term);
  ok('home 用户卡带身份「教师」', h.who.includes('教师'), h.who);

  /* ── att：三层 ── */
  await cdp.eval(`(async () => { App.go('att'); await new Promise(r => setTimeout(r, 600)); return 1; })()`);
  const a = await cdp.eval(`(() => {
    const u = document.querySelector('.xf-util');
    const nav = document.getElementById('xfNav');
    const navA = [...nav.querySelectorAll(':scope > a')];
    const more = document.getElementById('xfMore');
    const term = document.querySelector('.xf-term-in').textContent.trim();
    return { util: !!u && getComputedStyle(u).display !== 'none',
      mainN: navA.length, mainIds: navA.map(x => x.dataset.id),
      moreN: more ? more.querySelectorAll('.xf-more-panel a').length : -1,
      moreIds: more ? [...more.querySelectorAll('.xf-more-panel a')].map(x => x.dataset.id) : [],
      hasBtn: !!document.getElementById('xfMoreBtn'),
      aria: (document.getElementById('xfMoreBtn')||{}).getAttribute && document.getElementById('xfMoreBtn').getAttribute('aria-haspopup'),
      term, pt: getComputedStyle(document.querySelector('.page.on')).paddingTop,
      curIn: more ? more.classList.contains('cur-in') : null };
  })()`);
  ok('非 home 门户条退场', !a.util);
  ok('主排 8 项（今日/考勤/打卡/作业/名册/档案/课表/设置）', a.mainN === 8 && a.mainIds.join(',') === 'home,att,sign,homework,roster,profile,timetable,settings', a.mainIds.join(','));
  ok('下拉收纳 9 项（学生账号/课时/晚自习/量化/模考/协作/征集/老师/巡检）',
     a.moreN === 9 && a.moreIds.join(',') === 'students,hours,night,quant,exam,coop,gather,teachers,health', a.moreIds.join(','));
  ok('其他功能按钮 aria-haspopup', a.hasBtn && a.aria === 'true');
  ok('白条=学年|日期（无教学周/校名）', a.term.includes('学年') && a.term.includes('年') && a.term.includes('星期') && !a.term.includes('教学周') && !a.term.includes('南阳'), a.term);
  ok('内容区顶部 22px', a.pt === '22px', a.pt);

  /* 下拉交互：开 → 点外关 → 开 → Esc 关 → 点收纳项跳转+cur-in */
  await cdp.eval(`document.getElementById('xfMoreBtn').click()`);
  await sleep(150);
  let st = await cdp.eval(`(() => { const m = document.getElementById('xfMore');
    return { open: m.classList.contains('open'), aria: document.getElementById('xfMoreBtn').getAttribute('aria-expanded'),
      panelShown: getComputedStyle(m.querySelector('.xf-more-panel')).display !== 'none' }; })()`);
  ok('下拉点击展开 + aria-expanded', st.open && st.aria === 'true' && st.panelShown);
  await cdp.eval(`document.body.click()`);
  await sleep(150);
  st = await cdp.eval(`(() => document.getElementById('xfMore').classList.contains('open'))()`);
  ok('点击外部关闭', !st);
  await cdp.eval(`document.getElementById('xfMoreBtn').click()`);
  await sleep(120);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(150);
  st = await cdp.eval(`(() => document.getElementById('xfMore').classList.contains('open'))()`);
  ok('Esc 关闭', !st);
  await cdp.eval(`(async () => { App.go('students'); await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  st = await cdp.eval(`(() => { const m = document.getElementById('xfMore');
    return { curIn: m.classList.contains('cur-in'),
      itemOn: !!m.querySelector('.xf-more-panel a.on'),
      pageOn: document.querySelector('.page.on').id }; })()`);
  ok('当前页在收纳项：钮金线 + 面板项高亮 + 页面不丢', st.curIn && st.itemOn && st.pageOn === 'page-students', JSON.stringify(st));

  /* 教师/学生导航差异 */
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '张伟';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return 1;
  })()`);
  await sleep(800);
  const t = await cdp.eval(`(() => {
    const nav = document.getElementById('xfNav');
    const more = document.getElementById('xfMore');
    return { main: [...nav.querySelectorAll(':scope > a')].map(x => x.dataset.id).join(','),
      more: more ? 'has' : 'none', who: document.getElementById('xfWho').textContent.trim() };
  })()`);
  ok('教师端主排 7 项无下拉（NAV_ORDER 全量）', t.main === 'today,news,record,myclass,profile,tickets,settings' && t.more === 'none', t.main);

  /* 1100 宽不折行 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const w = await cdp.eval(`(() => {
    const in1 = document.querySelector('.xf-navstrip-in');
    const a0 = in1.querySelector('a');
    return { rowH: Math.round(in1.getBoundingClientRect().height),
      itemH: Math.round(a0.getBoundingClientRect().height),
      scrollW: in1.scrollWidth, clientW: in1.clientWidth };
  })()`);
  ok('1100 宽导航单行不折行', w.rowH <= w.itemH + 2 && w.scrollW <= w.clientW, JSON.stringify(w));
  console.log('done');
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { srv && srv.kill('SIGKILL'); } catch {}
}
