/* VoxOS 5.31 排查：切页动画到底有没有跑在可见内容上
 *   node test/anim_timing_probe.mjs
 * 逐帧采样 getAnimations()（rise 且 running）与 .page.on 子元素内容长度，
 * student(1440) 切 stuTable/stuSign/stuHome + teacher(1440) 切 att 对照。
 */
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5719, DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, t = 40) { for (let i = 0; i < t; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error('timeout'); }

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok);
await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });

const chromes = [];
async function browser(tag, w, h) {
  const profile = await mkdtemp(path.join(tmpdir(), 'atp-'));
  const dbg = DBG + chromes.length;
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-proxy-server', `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
  chromes.push(ch);
  const target = await waitFor(async () => (await (await jfetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(x => x.type === 'page' && x.webSocketDebuggerUrl));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const w2 = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && w2.has(m.id)) { const { res, rej } = w2.get(m.id); w2.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => w2.set(i, { res, rej })); };
  const evalp = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/?cb=' + Date.now() });
  await sleep(2200);
  await evalp(`(async()=>{ if(!Auth.mode) await Auth.probe(); return true; })()`);
  return { send, evalp };
}
async function login(c, user, pass) {
  return c.evalp(`(async()=>{
    document.getElementById('gUser').value=${JSON.stringify(user)};
    document.getElementById('gPass').value=${JSON.stringify(pass)};
    await Auth.submit(); await new Promise(r=>setTimeout(r,1800));
    return { role: Auth.role() }; })()`);
}

/* 逐帧采样器：注入后返回 stop()。每帧记录 rise+running 动画的
   数量、targets 的可见性与 class；以及 .page.on 直接子元素的内容长度。 */
const PROBE = `(() => {
  window.__samples = [];
  const page = () => document.querySelector('.page.on');
  const snap = () => {
    const p = page(); if (!p) return;
    const anims = document.getAnimations().filter(a =>
      a.animationName === 'rise' && a.playState === 'running');
    window.__samples.push({
      t: Math.round(performance.now()),
      anims: anims.map(a => {
        const el = a.effect && a.effect.target;
        return el ? { cls: (el.className||'').toString().slice(0,30),
          visible: !!el.offsetParent, h: el.offsetHeight,
          len: (el.innerHTML||'').length } : null; }),
      kids: [...p.children].map(el => ({ cls: (el.className||'').toString().slice(0,26),
        visible: !!el.offsetParent, len: (el.innerHTML||'').length })),
    });
  };
  let on = true;
  const loop = () => { if (!on) return; snap(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__probeStop = () => { on = false; snap(); return window.__samples; };
  return true; })()`;

try {
  /* 准备数据：班级 + 学员 + 今天课表，让学生页有真实内容 */
  const supA = await browser('sup', 1440, 900);
  await login(supA, '李老师', 'liyun2026');
  const tok = await supA.evalp('Auth.token()');
  await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'users', token: tok, op: 'createMany', classIds: [],
      list: [{ user: '王梓涵', pass: 'liyun2026', role: 'student', name: '王梓涵', studentId: 'stu_tp1' },
             { user: '张伟', pass: 'liyun2026', role: 'teacher', name: '张伟' }] }) });
  await supA.evalp(`(async () => {
    const today = Util.today();
    Store.mergeRemote({ classes: [{ id: 'cls_tp1', name: '探针一班' }],
      students: [{ id: 'stu_tp1', name: '王梓涵', classId: 'cls_tp1' }] });
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p1.id, start: '08:30', title: '普通话语音基础', cls: '探针一班' });
    Store.upsert('notices', { text: '本周六模考，请提前到场', date: today });
    Sync.push(); await new Promise(r => setTimeout(r, 800)); return true; })()`);
  await supA.evalp(`App.go('home')`);

  /* ══ student 1440 ══ */
  const stuC = await browser('stu', 1440, 900);
  const stu = await login(stuC, '王梓涵', 'liyun2026');
  console.log('student 登录:', JSON.stringify(stu));
  await stuC.evalp(`App.go('stuTable')`); await sleep(800);   // 先离开首页

  console.log('\n── student 切页 stuTable → stuHome（逐帧采样 500ms）──');
  await stuC.evalp(PROBE);
  await stuC.evalp(`App.go('stuHome')`);
  const s1 = await stuC.evalp(`window.__probeStop()`);
  report('student stuHome', s1);

  console.log('\n── student 切页 stuHome → stuSign ──');
  await stuC.evalp(PROBE);
  await stuC.evalp(`App.go('stuSign')`);
  const s2 = await stuC.evalp(`window.__probeStop()`);
  report('student stuSign', s2);

  console.log('\n── 首次加载场景：刷新落在 stuHome（boot 全流程）──');
  await stuC.evalp(`location.reload(); true`);
  await sleep(3500);
  const bootInfo = await stuC.evalp(`(() => {
    const p = document.querySelector('.page.on');
    const anims = document.getAnimations().filter(a => a.animationName === 'rise');
    return { onPage: p ? p.id : '(none)',
      riseDeclared: anims.length,
      running: anims.filter(a => a.playState === 'running').length,
      finished: anims.filter(a => a.playState === 'finished').length,
      kidCount: p ? p.children.length : 0 }; })()`);
  console.log(JSON.stringify(bootInfo, null, 1));

  /* ══ teacher 1440 对照 ══ */
  const teaC = await browser('tea', 1440, 900);
  await login(teaC, '张伟', 'liyun2026');
  await teaC.evalp(`App.go('today')`); await sleep(800);
  console.log('\n── teacher 切页 today → att（对照）──');
  await teaC.evalp(PROBE);
  await teaC.evalp(`App.go('att')`);
  const t1 = await teaC.evalp(`window.__probeStop()`);
  report('teacher att', t1);

} finally {
  chromes.forEach(c => c.kill()); server.kill();
  process.exit(0);
}

function report(label, samples) {
  const frames = samples.filter(s => s.anims.length || s.kids.some(k => k.visible));
  console.log(label + '：采样 ' + samples.length + ' 帧');
  for (const s of samples.slice(0, 12)) {
    const a = s.anims.map(x => x ? `${x.cls}(vis=${x.visible},h=${x.h},len=${x.len})` : '').filter(Boolean);
    const vis = s.kids.filter(k => k.visible).length;
    console.log(`  t=${s.t}ms rise动画=${s.anims.length} [${a.join(' | ')}] 可见子元素=${vis}/${s.kids.length}`);
  }
  const runningTotal = Math.max(...samples.map(s => s.anims.length));
  console.log(`  → 峰值同时运行的 rise 动画：${runningTotal}`);
}
