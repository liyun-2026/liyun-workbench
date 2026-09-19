/**
 * 端到端验收：老师列表中「已停用」的老师出现「删除」选项，且删除后从列表消失
 *   node test/teacher_del_check.mjs
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
  once(method){ return new Promise(res => { const set = this.events.get(method) || new Set(); const fn = p => { set.delete(fn); res(p); }; set.add(fn); this.events.set(method, set); this.events.set(method, set); }); }
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

  const profile = await mkdtemp(path.join(tmpdir(), 'tdel-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await loaded;

  const r = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '${SUPER.user}';
    document.getElementById('gPass').value = '${SUPER.pass}';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1500));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), mode: Auth.mode };
  })()`);
  if (!r.gateOff) throw new Error('登录失败');
  console.log('已登录（模式：' + r.mode + '）\n');

  console.log('① 建两个老师：甲（在职）、乙（已停用）');
  const ids = await cdp.eval(`(async () => {
    await Auth.call('users', { op:'create', user:'teacher_jia', name:'甲老师', role:'teacher', pass:'aaaabbbb1' });
    const b = await Auth.call('users', { op:'create', user:'teacher_yi', name:'乙老师', role:'teacher', pass:'aaaabbbb2' });
    await Auth.call('users', { op:'update', id: b.id, active:false });
    App.go('teachers');
    await new Promise(r => setTimeout(r, 800));
    return { bId: b.id };
  })()`);
  await sleep(300);

  console.log('② 列表里：在职老师没有「删除」，已停用老师有「删除」');
  const check = await cdp.eval(`(() => {
    const items = [...document.querySelectorAll('#tList .item')];
    const row = n => items.find(x => x.textContent.indexOf(n) >= 0);
    const delBtn = n => { const r = row(n); return r ? [...r.querySelectorAll('button')].find(b => b.textContent.trim() === '删除') : null; };
    return {
      jiaHasDel: !!delBtn('甲老师'),
      yiHasDel: !!delBtn('乙老师'),
      yiHasEnable: (() => { const r = row('乙老师'); return r ? [...r.querySelectorAll('button')].some(b => b.textContent.trim() === '启用') : false; })(),
    };
  })()`);
  ok(!check.jiaHasDel, '在职甲老师：不显示「删除」');
  ok(check.yiHasDel, '已停用乙老师：显示「删除」');
  ok(check.yiHasEnable, '已停用乙老师：同时显示「启用」（可恢复）');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 1100, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  await cdp.eval(`(() => { const el = document.getElementById('tList'); if (el) el.scrollIntoView({ block: 'start' }); })()`);
  await sleep(300);
  await shot(cdp, 'teacher-list-with-delete.png');

  console.log('\n③ 点「删除」→ 乙老师从列表消失');
  const after = await cdp.eval(`(async () => {
    window.confirm = () => true;                 // 自动确认删除对话框
    await Teachers.remove('${ids.bId}');
    await new Promise(r => setTimeout(r, 600));
    const items = [...document.querySelectorAll('#tList .item')];
    const gone = !items.some(x => x.textContent.indexOf('乙老师') >= 0);
    const jiaStillThere = items.some(x => x.textContent.indexOf('甲老师') >= 0);
    return { gone, jiaStillThere };
  })()`);
  ok(after.gone, '乙老师已从账号列表移除');
  ok(after.jiaStillThere, '在职甲老师仍在列表');

  await cdp.eval(`(() => { const el = document.getElementById('tList'); if (el) el.scrollIntoView({ block: 'start' }); })()`);
  await sleep(300);
  await shot(cdp, 'teacher-list-after-delete.png');

  console.log('\n④ 服务端拒绝 → 回滚，老师仍在列表（乐观更新不丢数据）');
  const rb = await cdp.eval(`(async () => {
    window.confirm = () => true;
    const target = Teachers._users.find(u => u.name === '甲老师');
    const realCall = Auth.call.bind(Auth);
    Auth.call = async () => { throw new Error('模拟服务端失败'); };   // 让后端调用失败
    await Teachers.remove(target.id);
    Auth.call = realCall;
    await new Promise(r => setTimeout(r, 300));
    return {
      stillInList: Teachers._users.some(u => u.id === target.id),
      rowStillThere: [...document.querySelectorAll('#tList .item')].some(x => x.textContent.indexOf('甲老师') >= 0),
    };
  })()`);
  ok(rb.stillInList, '删除失败时：本地账号列表仍含甲老师（已回滚）');
  ok(rb.rowStillThere, '删除失败时：列表里甲老师那一行还在（已回滚）');

  console.log('\n⑤ 乐观更新：点删除后立刻不在本地列表（不等服务端往返）');
  const opt = await cdp.eval(`(async () => {
    window.confirm = () => true;
    const t = Teachers._users.find(u => u.name === '甲老师');
    Teachers.remove(t.id);                          // 不 await
    const immediatelyGone = !Teachers._users.some(u => u.id === t.id);
    await new Promise(r => setTimeout(r, 400));      // 等服务端返回
    return { immediatelyGone, toast: (document.querySelector('.toast') || {}).textContent || '' };
  })()`);
  ok(opt.immediatelyGone, '点删除后本地立即移除（无需等服务端往返，卡顿感消失）');

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  if (fail) process.exitCode = 1;
  await devReset();
  chrome.kill(); server.kill();
  await sleep(300);
  process.exit(process.exitCode || 0);
} catch(e){
  console.error('\n💥 ' + (e && e.message));
  process.exitCode = 1;
  process.exit(1);
}
