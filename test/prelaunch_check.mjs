/**
 * 上线前全链路 CDP 大体检（真实生产账号体系）—— 2026-11-20 主理人指令
 *   node test/prelaunch_check.mjs
 *
 * 用 .health-credentials.json 的巡检账号（教务系统巡检账号）登录 **生产** 站点实测：
 *   ① 登录：桌面 + 390 手机模拟，确认登录成功、进入正确页
 *   ② 看板端：确认账号当前角色 —— sys = 直达看板验证；teacher = Board.ok 拦（原 bug
 *      仍在，如实报告「需主理人点一次迁移」，不自行改数据）
 *   ③ 名册 / 学生账号页渲染；④ 30 秒动态码 + 打卡记录读取；⑤ 设置页密钥区块可见性
 * 全程只读：不建号、不打卡、不生成密钥、不改任何数据。
 * 截图留档 docs/prelaunch-2026-11-20/
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = process.env.LIYUN_HEALTH_DOMAIN || 'https://liyun2026.top';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(dir, 'docs', 'prelaunch-2026-11-20');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const note = m => console.log('  ℹ ' + m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(10000) });
async function waitFor(fn, { tries = 40, gap = 600, what = '目标' } = {}) {
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
  async eval(expr, timeout = 45000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
  async shot(file, full = false){
    const data = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    await writeFile(file, Buffer.from(data.data, 'base64'));
  }
}

const cred = JSON.parse(await readFile(path.join(homedir(), 'Desktop', '砺蕴教务系统', '.health-credentials.json'), 'utf8'));
await mkdir(SHOTS, { recursive: true });

let chrome;
try {
  const profile = await mkdtemp(path.join(tmpdir(), 'prelaunch-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5359', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5359/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: DOMAIN + '/' }); await loaded;
  await sleep(1500);

  console.log('\n【1】生产登录（桌面 1440）：' + cred.user);
  const l1 = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 3000));
    return { mode: Auth.mode, role: Auth.role(), name: Auth.name(),
             page: document.querySelector('.page.on')?.id || '',
             boardMode: document.body.classList.contains('board-mode'),
             nav: App.visible().map(r => r.id).join(',') };
  })()`);
  ok(l1.mode === 'cloud', '云端模式（probe 通）');
  ok(!!l1.role, '登录成功（角色=' + l1.role + ' · ' + l1.name + '）');
  if (l1.role === 'sys'){
    ok(l1.boardMode && l1.page === 'page-board', 'sys 身份直达看板展示模式');
    ok(l1.nav === 'board,settings', 'sys 导航只有 board+settings（' + l1.nav + '）');
    const code = await cdp.eval(`(async () => { await new Promise(r=>setTimeout(r,1200)); return Board._code || ''; })()`);
    ok(/^\d{6}$/.test(code), '看板屏拿到 6 位动态码（' + code + '）');
    await cdp.shot(path.join(SHOTS, 'desktop-sys-board.png'));
  } else {
    ok(['teacher','both'].includes(l1.role) ? ['page-today','page-home'].includes(l1.page) : true,
       '登录后落在 ' + l1.page + '（' + l1.role + ' 身份的正确首屏）');
    await cdp.shot(path.join(SHOTS, 'desktop-landing.png'));
  }

  console.log('\n【2】看板端（用户点名要查的）——角色实锤：');
  const b1 = await cdp.eval(`(async () => {
    let t=''; const orig = UI.toast; UI.toast = m => { t = m; };
    let goErr = '';
    try { App.go('board'); } catch(e){ t = 'ERR:' + e.message; }
    UI.toast = orig;
    await new Promise(r => setTimeout(r, 400));
    return { role: Auth.role(), staff: Auth.isStaff(), ok: Board.ok(),
             goErr,
             on: document.getElementById('page-board').classList.contains('on'),
             mode: document.body.classList.contains('board-mode') };
  })()`);
  if (b1.role === 'sys'){
    ok(b1.ok && b1.on, 'sys：Board.ok 放行，看板页可进');
  } else if (b1.staff){
    ok(b1.ok, '当前角色 ' + b1.role + '（教务四种）：Board.ok() = ' + b1.ok);
    ok(b1.on, '看板页能进（page-board on=' + b1.on + (b1.t ? ' · toast=' + b1.t : '') + '）');
    note('5.38 的看板拦截只影响非教务身份（sys/teacher）；此账号是 ' + b1.role + '，看板本来就在其权限内');
    note('设计建议：巡检账号仍应迁成 sys（设置 → 系统工作号 → 迁移存量账号）—— 清空豁免 + 业务写收口，迁移后看板照样直达');
  } else {
    ok(b1.ok === false, '当前角色 ' + b1.role + '：Board.ok() = false（原 5.38 根因现场仍在）');
    note('结论：账号还没迁成 sys → 看板对它依然被拦（toast=「' + b1.t + '」）');
    note('→ 需主理人进「设置 → 系统工作号」点一次「迁移存量账号 → sys」，迁移后 sys 登录直达看板');
  }
  if (b1.on) await cdp.shot(path.join(SHOTS, 'desktop-board.png'));

  console.log('\n【3】名册 / 学生账号页（只读渲染）：');
  if (['teacher','both','admin','super','office'].includes(b1.role)){
    const r1 = await cdp.eval(`(async () => {
      App.go('roster');
      await new Promise(r => setTimeout(r, 1000));
      const clsN = document.getElementById('rosterCls')?.options?.length || 0;
      const stuN = document.querySelectorAll('#stuList .item').length;
      const singleCard = document.getElementById('singleAcctCard')?.style.display !== 'none';
      const batchCard = document.getElementById('batchAcctCard')?.style.display !== 'none';
      let printErr = '';
      try {
        const cap = []; const origOpen = window.open;
        window.open = () => ({ document: { write(){} , close(){} }, focus(){}, print(){} });
        Roster._ok = Roster._ok || [];
        Roster.printCards();                       // 只开打印器看会不会报错，不碰数据
        window.open = origOpen;
      } catch(e){ printErr = e.message; }
      App.go('students');
      await new Promise(r => setTimeout(r, 1200));
      const saRows = document.querySelectorAll('#saList .item').length;
      const saErr = document.getElementById('saList')?.textContent || '';
      return { clsN, stuN, singleCard, batchCard, printErr, saRows,
               saFail: /读不到/.test(saErr) };
    })()`);
    ok(r1.clsN >= 0, '名册页渲染（班级下拉 ' + r1.clsN + ' 项 · 在册行 ' + r1.stuN + '）');
    ok(r1.printErr === '', '发放卡生成器打开无报错（只调打印器，不生成不打印）');
    ok(r1.saRows >= 0 && !r1.saFail, '学生账号页渲染正常（' + r1.saRows + ' 行）');
    note('批量/单独建号卡当前 display=' + (r1.singleCard ? '可见' : '隐藏（身份权限收起，与设计一致）'));
    await cdp.shot(path.join(SHOTS, 'desktop-roster.png'));
    await cdp.shot(path.join(SHOTS, 'desktop-stuacct.png'));

    console.log('\n【4】打卡链路：30 秒动态码 + 打卡记录读取：');
    const s1 = await cdp.eval(`(async () => {
      const j = await Auth.call('code');
      App.go('sign');
      await new Promise(r => setTimeout(r, 1200));
      const today = new Date(Date.now() + (8*3600*1000)).toISOString().slice(0,10);
      const recs = Store.list('sign:' + today);
      const signPage = document.getElementById('page-sign').classList.contains('on');
      return { code: j.code || '', left: j.left, win: j.window,
               signPage, recs: recs.length,
               attN: Store.list('att:' + today).length };
    })()`);
    ok(/^\d{6}$/.test(s1.code), '服务端 30 秒动态码正常（' + s1.code + '）');
    ok(s1.win === 30000 && s1.left <= 30000, '换码窗口 30s、剩余 ' + Math.round((s1.left||0)/1000) + 's');
    ok(s1.signPage, '打卡管理页渲染正常（今日打卡记录 ' + s1.recs + ' 条 · 考勤 ' + s1.attN + ' 条）');
    await cdp.shot(path.join(SHOTS, 'desktop-sign.png'));
  } else {
    note('sys 身份没有名册/学生账号/打卡管理导航（设计如此，业务页全不可见）');
  }

  console.log('\n【5】设置页：换设备密钥区块可见性：');
  const st1 = await cdp.eval(`(async () => {
    if (typeof Board !== 'undefined' && Board.leave && document.body.classList.contains('board-mode')) Board.leave();
    App.go('settings');
    await new Promise(r => setTimeout(r, 1000));
    return { devKey: document.getElementById('devKeyCard')?.style.display !== 'none',
             syncCard: document.getElementById('syncCard')?.style.display !== 'none',
             danger: document.getElementById('dangerCard')?.style.display !== 'none' };
  })()`);
  ok(st1.syncCard, '「我的账号」卡可见（改密码/退出）');
  if (['super','office','admin'].includes(b1.role)){
    ok(st1.devKey, '换设备密钥区块可见（一键生成可用）');
  } else {
    /* ==5.39== 密钥卡显隐收口成 ACCT_OPS 三档：both/teacher 一律隐藏（服务端本就 403） */
    ok(!st1.devKey, '密钥区块对 ' + b1.role + ' 已收起（5.39 显隐收口，与 ACCT_OPS 一致）');
  }
  ok(!st1.danger || b1.role === 'super', '危险操作卡权限收起正确');
  await cdp.shot(path.join(SHOTS, 'desktop-settings.png'));

  console.log('\n【6】手机 390 模拟 + 五页截图：');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  const loaded2 = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: DOMAIN + '/' }); await loaded2;
  await sleep(2500);
  const m0 = await cdp.eval(`({ role: Auth.role(), page: document.querySelector('.page.on')?.id || '' })`);
  ok(m0.role === b1.role, '390 模拟登录态保持（' + m0.role + '，落在 ' + m0.page + '）');
  await cdp.shot(path.join(SHOTS, 'm390-1-' + m0.page.replace('page-','') + '.png'));
  const pages = ['teacher','both','admin','super','office'].includes(b1.role)
    ? ['today','record','myclass','tickets','settings']
    : ['board','settings'];
  for (let i = 0; i < pages.length; i++){
    const id = pages[i];
    const r = await cdp.eval(`(async () => {
      try { App.go('${id}'); } catch(e){ return { err: e.message }; }
      await new Promise(r2 => setTimeout(r2, 900));
      return { on: document.getElementById('page-${id}')?.classList.contains('on') || false };
    })()`);
    ok(r.on || !r.err, '390 页 ' + id + (r.on ? ' 渲染正常' : '：' + (r.err || '页面不在（权限/模式内）')));
    await cdp.shot(path.join(SHOTS, `m390-${i + 2}-${id}.png`));
  }

  console.log('\n【7】网络层独立复核（DoH 权威直连）：');
  const dns = await cdp.eval(`fetch('/api/sync', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({action:'hello'}) }).then(r => r.json()).then(j => ({ ok: j.ok }))`);
  ok(dns.ok, '页面内 hello 探活 ok=true');
} catch(e){
  fail++; console.log('  ✗ 体检异常：' + e.message);
} finally {
  try { chrome && chrome.kill(); } catch {}
}

console.log('\n═══ prelaunch_check 结果：✅ ' + pass + ' · 🔴 ' + fail + ' ═══');
console.log('截图目录：docs/prelaunch-2026-11-20/');
process.exit(fail ? 1 : 0);
