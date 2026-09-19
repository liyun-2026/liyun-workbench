/**
 * 端到端验收：建号时可以选身份 —— 授课老师 / 教务老师 / 教务兼授课（两套权限都有）
 *   node test/role_pick_check.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5321);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots');
const SUPER = { user: '测试教务', pass: 'shotpass123' };
const NEW  = { user: '李双岗', name: '李老师', pass: 'shuanggang123' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
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
  async eval(expr, timeout = 60000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name){ const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('  📸 ' + name); }

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

try {
  await mkdir(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const profile = await mkdtemp(path.join(tmpdir(), 'role-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1000, deviceScaleFactor: 2, mobile: true });
  let loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  const r0 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on') };
  })()`);
  if (!r0.gateOff) throw new Error('首位教务登录失败');
  console.log('已登录首位教务\n');

  console.log('① 建号区的「身份」是个窗口，不是小下拉');
  const s1 = await cdp.eval(`(async () => {
    App.go('teachers');
    await new Promise(r => setTimeout(r, 600));
    const btn = document.getElementById('tRoleBtn');
    Teachers.openRole();
    await new Promise(r => setTimeout(r, 300));
    const opts = [...document.querySelectorAll('#roleOpts .role-opt')].map(b => ({
      name: b.querySelector('.r-name').textContent,
      desc: b.querySelector('.r-desc').textContent,
      on: b.classList.contains('on'),
    }));
    return { btn: btn ? btn.textContent.trim() : '', open: document.getElementById('rolePick').classList.contains('on'),
             hasOldSelect: !!document.getElementById('tRole'), opts };
  })()`);
  ok(!!s1.btn && s1.btn.includes('身份'), '建号区是「身份：… ▾」按钮：' + s1.btn);
  ok(!s1.hasOldSelect, '原来那个只有两项的小下拉已移除');
  ok(s1.open, '点一下弹出选身份窗口');
  ok(s1.opts.length === 3, '窗口里 3 个身份可选');
  console.log('   ' + s1.opts.map(o => o.name).join(' / '));
  ok(s1.opts.map(o => o.name).join(',') === '授课老师,教务老师,教务兼授课', '分别是：授课老师 / 教务老师 / 教务兼授课');
  ok(s1.opts.every(o => o.desc.length > 20), '每个身份都写了它能看哪些页面（不是干巴巴一个名字）');

  await shot(cdp, 'role-pick.png');

  console.log('\n② 选「教务兼授课」并用它建号');
  const s2 = await cdp.eval(`(async () => {
    Teachers.pickRole('both');
    await new Promise(r => setTimeout(r, 200));
    const btnText = document.getElementById('tRoleBtn').textContent.trim();
    const checked = [...document.querySelectorAll('#roleOpts .role-opt')].filter(b => b.classList.contains('on'))
                      .map(b => b.querySelector('.r-name').textContent);
    Teachers.closeRole();
    document.getElementById('tUser').value = '${NEW.user}';
    document.getElementById('tName').value = '${NEW.name}';
    document.getElementById('tPass').value = '${NEW.pass}';
    await Teachers.create();
    await new Promise(r => setTimeout(r, 800));
    const u = (Teachers._users || []).find(x => x.user === '${NEW.user}');
    return { btnText, checked, role: u && u.role, closed: !document.getElementById('rolePick').classList.contains('on') };
  })()`);
  ok(s2.btnText.includes('教务兼授课'), '按钮跟着变成：' + s2.btnText);
  ok(s2.checked.join() === '教务兼授课', '窗口里打勾的是「教务兼授课」');
  ok(s2.closed, '选完窗口关掉');
  ok(s2.role === 'both', '账号确实建成 both（教务兼授课），服务端也认');

  const s3 = await cdp.eval(`(async () => {
    await new Promise(r => setTimeout(r, 300));
    const row = [...document.querySelectorAll('#tList .item')].find(x => x.textContent.includes('${NEW.name}'));
    return { text: row ? row.textContent.replace(/\\s+/g, ' ').trim() : '',
             hasRoleBtn: !!row && row.textContent.includes('身份') };
  })()`);
  console.log('   列表那一行：', s3.text);
  ok(s3.text.includes('教务兼授课'), '列表里显示「教务兼授课」');
  ok(s3.hasRoleBtn, '那一行有「身份」按钮，建好后还能改');

  console.log('\n③ 用这个账号登录：教务端和老师端两套都在');
  await cdp.eval(`(() => { Store.setSecret('token',''); Store.setSecret('acct',''); })()`);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  const s4 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${NEW.user}';
    document.getElementById('gPass').value = '${NEW.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1800));
    return { role: Auth.role(), staff: Auth.isStaff(), label: Auth.roleLabel(),
             gateOff: !document.getElementById('gate').classList.contains('on') };
  })()`);
  if (!s4.gateOff) throw new Error('新账号登录失败');
  ok(s4.role === 'both' && s4.staff === true, '登录进来角色是 both，且按教务口径拿数据');
  ok(s4.label === '教务兼授课', '自己那栏显示：' + s4.label);

  const s5 = await cdp.eval(`(async () => {
    App.renderChrome();
    await new Promise(r => setTimeout(r, 300));
    return {
      tabs: [...document.querySelectorAll('#tabs button')].map(b => b.dataset.id),
      pages: App.visible().map(r => r.id),
      teachers: App.can('teachers'),
      home: App.can('home'), today: App.can('today'), record: App.can('record'),
      myclass: App.can('myclass'), tickets: App.can('tickets'),
      quant: App.can('quant'), homework: App.can('homework'), exam: App.can('exam'),
      navDup: (() => { const ids = App.visible().map(r => r.id); return ids.length !== new Set(ids).size; })(),
    };
  })()`);
  console.log('   底部 5 个标签：', s5.tabs.join(' / '));
  ok(s5.tabs.join(',') === 'home,att,record,myclass,settings', '标签栏是：今日 / 考勤 / 录入今日 / 我带的班 / 设置（两个身份的入口都照顾到）');
  ok(!s5.navDup, '功能列表没有重复项');
  ok(s5.home && s5.quant && s5.homework && s5.exam, '教务那摊进得去：今日 / 量化 / 作业 / 模考');
  ok(s5.today && s5.record && s5.myclass && s5.tickets, '老师那摊也进得去：今天 / 录入今日 / 我带的班 / 上报与申请');
  ok(s5.teachers === false, '「老师管理」仍然进不去（只有首位教务能管账号）');

  await shot(cdp, 'role-both-logged-in.png');

  console.log('\n④ 建好之后还能改身份');
  await cdp.eval(`(() => { Store.setSecret('token',''); Store.setSecret('acct',''); })()`);
  loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;
  const s6 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    App.go('teachers');
    await new Promise(r => setTimeout(r, 700));
    const u = (Teachers._users || []).find(x => x.user === '${NEW.user}');
    Teachers.openRole(u.id);
    await new Promise(r => setTimeout(r, 300));
    const title = document.getElementById('rolePickTitle').textContent;
    const cur = [...document.querySelectorAll('#roleOpts .role-opt.on')].map(b => b.querySelector('.r-name').textContent);
    Teachers.pickRole('teacher');
    await new Promise(r => setTimeout(r, 700));
    const after = (Teachers._users || []).find(x => x.user === '${NEW.user}').role;
    const rowText = ([...document.querySelectorAll('#tList .item')].find(x => x.textContent.includes('${NEW.name}')) || {})
                      .textContent?.replace(/\\s+/g, ' ').trim() || '';
    return { title, cur, after, rowText };
  })()`);
  ok(s6.title.includes('李老师'), '窗口标题变成「改「李老师」的身份」：' + s6.title);
  ok(s6.cur.join() === '教务兼授课', '打开时勾在 TA 现在的身份上');
  ok(s6.after === 'teacher', '改成授课老师后，列表立刻变（不用等服务端往返）');
  ok(s6.rowText.includes('授课老师'), '列表显示已改：' + s6.rowText);

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  chrome.kill(); server.kill();
  await devReset();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('\n✗ 出错：', e.message);
  process.exit(1);
}
