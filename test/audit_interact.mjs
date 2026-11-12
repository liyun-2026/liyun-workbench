/* VoxOS 5.32 全站「页面状态与交互」体检
 *   node test/audit_interact.mjs
 * 四专项：①弹窗遮挡（720 矮窗 + 390）②死点击 ③假板块（onclick 死绑定交叉）
 * ④标题嵌死（1440/1280/1100/980 四档 bbox）
 * 产出：docs/audit-interact-2026-11-12/ 下截图 + 控制台问题清单（🔴🟡）
 */
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5731, DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'docs', 'audit-interact-2026-11-12');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(10000) });
async function waitFor(fn, t = 40) { for (let i = 0; i < t; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error('timeout'); }

class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.w = new Map(); this.errors = []; this.dialogs = 0;
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.method === 'Page.javascriptDialogOpening'){ this.dialogs++; this.ws.send(JSON.stringify({ id: 900000 + (++this.id), method: 'Page.handleJavaScriptDialog', params: { accept: true } })); return; }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 160));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push((m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160));
      if (m.id && this.w.has(m.id)) { const { res, rej } = this.w.get(m.id); this.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; }
  static async connect(url){ const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); }); return new Cdp(ws); }
  send(method, params = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.w.set(id, { res, rej })); }
  async eval(expr){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 200) }; return r.result.value; }
  async shot(name){ const r = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('    📸 ' + name); }
}
let pass = 0;
const P = [];
const flag = (sev, cat, where, detail) => { P.push({ sev, cat, where, detail }); console.log(`  ${sev} [${cat}] ${where} — ${detail}`); };
const fine = m => { pass++; console.log('    ✅ ' + m); };

let server; const chromes = [];
async function browser(tag, width, height) {
  const profile = await mkdtemp(path.join(tmpdir(), 'aud-'));
  const dbg = DBG + chromes.length;
  const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(ch);
  const target = await waitFor(async () => (await (await jfetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(x => x.type === 'page' && x.webSocketDebuggerUrl));
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  cdp._dbg = dbg; cdp._ch = ch;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await new Promise(res => { cdp.send('Page.navigate', { url: BASE + '/?nosw=1' }).then(res); });
  await sleep(2000);
  await cdp.eval(`(async () => { if (!Auth.mode) await Auth.probe(); return true; })()`);
  return cdp;
}
async function login(cdp, user, pass) {
  return cdp.eval(`(async () => {
    document.getElementById('gUser').value = ${JSON.stringify(user)};
    document.getElementById('gPass').value = ${JSON.stringify(pass)};
    await Auth.submit(); await new Promise(r => setTimeout(r, 1600));
    return { role: Auth.role() }; })()`);
}
async function viewport(cdp, w, h) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
  await cdp.eval(`App.refresh ? App.refresh() : true`);
  await sleep(400);
}

/* ═══ 死点击第三阶段：全新会话终审 ═══
   长序列里前面的 confirm 点击会真的改掉数据（自动接受 = 破坏性操作被执行），
   之后无论 reload 多少次状态都回不去 —— 只有全新会话 + 重新播种才算干净复测。
   同一按钮三档时序（长序列 / reload 单点 / 全新会话）都无反馈才定罪 🔴。 */
const SEED_EVAL = `(async () => {
  const today = Util.today();
  Store.mergeRemote({ classes: [{ id: 'cls_a1', name: '砺蕴一班' }, { id: 'cls_a2', name: '砺蕴二班' }],
    students: [{ id: 'stu_a1', name: '王梓涵', classId: 'cls_a1' }, { id: 'stu_a2', name: '陈小美', classId: 'cls_a1' }] });
  Store.upsert('rooms', { name: 'BY08' });
  Store.upsert('notices', { text: '本周六模考，请提前二十分钟到场，带好准考证。', date: today });
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:10', end: '11:40' });
  Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p1.id, start: '08:30', title: '普通话语音基础', cls: '砺蕴一班', room: 'BY08' });
  Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p2.id, start: '10:10', title: '即兴评述', cls: '砺蕴二班', room: 'BY08' });
  Store.upsert('homework', { clsId: 'cls_a1', date: today, text: '即兴评述提纲：我的家乡' });
  Sync.push(); await new Promise(r => setTimeout(r, 900)); return true; })()`;
const ROLE_USER = { super: '李老师', teacher: '张伟', student: '王梓涵' };
async function retestDead(items) {
  for (const d of items) {
    const cdp = await browser('retest', 1440, 900);
    try {
      /* ==修== 服务端在长序列里被 confirm 连带改掉（tombstone 会把 push 回的种子盖掉），
         dev-reset 回到干净种子态再登录 —— 与 _dbg4 验证过的链路一致 */
      await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });
      await login(cdp, ROLE_USER[d.role] || '李老师', 'liyun2026');
      await cdp.eval(SEED_EVAL);
      /* ==修== 登录后立即播种会被迟到的远端同步覆盖（会话 A 长序列污染过服务端数据），
         导航刷新一次、让远端拉到刚 push 的干净种子再点 —— 与 _dbg4 验证过的时序一致 */
      await cdp.send('Page.navigate', { url: BASE + '/?nosw=1&r=' + Math.random() });
      await sleep(2600);
      await cdp.eval(`App.go(${JSON.stringify(d.id)})`);
      await sleep(500);
      const v = await cdp.eval(`(async () => {
        const want = ${JSON.stringify(d.sig)};
        const els = [...document.querySelectorAll('.page.on [onclick], .page.on button, .page.on [role="button"]')]
          .filter(el => el.offsetParent && (
            (el.getAttribute('onclick')||'').startsWith(want) ||
            (!want.includes('(') && (el.tagName + ':' + (el.textContent||'').trim().slice(0,16)) === want)));
        const el = els[0];
        if (!el) return { err: 'gone' };
        const hsh = s2 => { let h = 5381; for (let i = 0; i < s2.length; i++) h = ((h << 5) + h + s2.charCodeAt(i)) >>> 0; return h.toString(36); };
        const fp = () => {
          const vals = [...document.querySelectorAll('.page.on input,.page.on select,.page.on textarea')].map(i => i.value).join('\u0001');
          const pg = document.querySelector('.page.on');
          return hsh(pg ? pg.outerHTML : '') + '|' + hsh(vals)
            + '|' + (document.getElementById('main')||{}).scrollTop
            + '|' + (document.getElementById('toast')||{}).textContent
            + '|' + document.body.outerHTML.length
            + '|' + document.querySelectorAll('.picker.on,.drawer.on').length; };
        const b0 = fp();
        try { el.click(); } catch(e) { return { err: 'click 抛错: ' + e.message.slice(0,60) }; }
        await new Promise(r => setTimeout(r, 1100));
        return { fb: fp() !== b0 }; })()`);
      if (v && v.err === 'gone') {
        const dbg = await cdp.eval(`({ role: Auth.role(), page: (document.querySelector('.page.on')||{}).id,
          classes: Store.list('classes').map(c => c.id + ':' + c.name).join(','),
          chips: [...document.querySelectorAll('.page.on .chip')].map(c => c.getAttribute('onclick')||c.textContent.trim()).join(' | ') })`);
        console.log(`    🔍 gone 现场: ${JSON.stringify(dbg)} · want=${d.sig.slice(0,44)}`);
      }
      if (v && v.fb) fine(`${d.role}/${d.id} 「${d.label}」: 全新会话点击有反馈 —— 长序列状态污染误报，不定罪（🟢）`);
      else if (v && v.err === 'gone') flag('🟡', 'click', `${d.role}/${d.id}`, `「${d.label}」状态依赖按钮（重播种后不存在），需人工复核`);
      else if (v && v.err) flag('🔴', 'click', `${d.role}/${d.id}`, `死点击（复测抛错）：「${d.label}」${v.err}`);
      else flag('🔴', 'click', `${d.role}/${d.id}`, `死点击（三档确认）：「${d.label}」（${d.sig.slice(0,40)}）三种时序下点击均无任何反馈`);
    } finally { if (cdp._ch) cdp._ch.kill(); }
  }
}

/* ── 页面遍历：死点击 + 假绑定 + 空板块 + console + 标题 bbox ── */
async function sweep(cdp, role, tag) {
  const deadItems = [];
  const pages = await cdp.eval(`App.visible().map(r => r.id)`);
  for (const id of pages) {
    await cdp.eval(`App.go(${JSON.stringify(id)})`);
    await sleep(450);
    const errs = cdp.errors.splice(0);
    for (const e of errs) flag('🟡', 'console', `${role}/${id}`, '页面报错: ' + e);

    /* 空板块：卡片既无内容也无 empty 提示。
       ==修== ① 只看视口内（roster 有视口外的空白卡，视觉正常）；
       ② 闭合 <details> 内的卡要跳过 —— Chrome 对未展开 details 的内容跳过渲染，
          innerText 为空但 rect 有效（singleAcctCard 就是这种，视觉正常）。
       记录 #id@y 便于回查截图。 */
    const empties = await cdp.eval(`(() => {
      const out = [];
      document.querySelectorAll('.page.on .card').forEach(c => {
        if (c.closest('details') && !c.closest('details').open) return;
        const t = (c.innerText || '').trim();
        const r = c.getBoundingClientRect();
        const inView = r.width > 40 && r.height > 30 && r.top < innerHeight && r.bottom > 0;
        if (c.offsetParent && inView && t.length < 6) out.push(((c.className||'') + '#' + (c.id||'') + '@' + Math.round(r.y)).slice(0,40)); });
      return out; })()`);
    for (const e of (empties || [])) flag('🟡', 'empty', `${role}/${id}`, '空白无字板块: ' + e);

    /* 死绑定：DOM 里 onclick 引用的函数不存在。
       ==修== 模块都是顶层 const，不挂 window —— 必须用页面内全局 eval 的
       typeof 判（同一全局词法环境才看得到），用 window 解析会全是误报。 */
    const dead = await cdp.eval(`(() => {
      const out = [];
      document.querySelectorAll('.page.on [onclick]').forEach(el => {
        const m = (el.getAttribute('onclick')||'').match(/^([A-Za-z_$][\\w.$]*)\\s*\\(/);
        if (!m) return;
        /* ==修== onclick 属性常以 event.stopPropagation() / this.closest(...) 开头 ——
           这些不是「绑定的函数」，eval 里也没有 event/this 上下文，一律跳过 */
        if (/^(event|this|document|window|Math|JSON|arguments)\\./.test(m[1])) return;
        let ok = false;
        try { ok = eval('typeof ' + m[1]) === 'function'; } catch(e) {}
        if (!ok) out.push(m[1]); });
      return [...new Set(out)]; })()`);
    for (const f of (dead || [])) flag('🔴', 'fake', `${role}/${id}`, 'onclick 绑定的函数不存在: ' + f);

    /* 死点击两阶段：① 遍历点击收集「无反馈候选」（长序列点击会互相污染状态，
       且 prompt/confirm/下载/file-dialog 在 headless 里天然无 DOM 反馈 ——
       这些不能直接定罪）；② 对候选 reload 后单独重测，仍无反馈才算死。 */
    const result = await cdp.eval(`(async () => {
      const sel = '.page.on button:not([disabled]), .page.on a[href], .page.on [onclick], .page.on [role="button"]';
      const els = [...document.querySelectorAll(sel)].filter(el => {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
        if (el.disabled) return false;
        if (el.getAttribute('aria-disabled') === 'true') return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2; });
      const out = [];
      const seen = new Set();
      /* 指纹：用内容哈希而不是长度 —— chip 选中态翻转（chip chip-on 从 A 挪到 B）
         outerHTML 长度不变，只有哈希能抓到；表单值（input.value 不在 HTML 里）
         和主滚动位置一起进来 */
      const hsh = s2 => { let h = 5381; for (let i = 0; i < s2.length; i++) h = ((h << 5) + h + s2.charCodeAt(i)) >>> 0; return h.toString(36); };
      const fp = () => {
        const vals = [...document.querySelectorAll('.page.on input,.page.on select,.page.on textarea')].map(i => i.value).join('\u0001');
        const pg = document.querySelector('.page.on');
        return hsh(pg ? pg.outerHTML : '') + '|' + hsh(vals)
          + '|' + (document.getElementById('main')||{}).scrollTop
          + '|' + (document.getElementById('toast')||{}).textContent;
      };
      for (const el of els.slice(0, 55)) {
        const oc = el.getAttribute('onclick') || '';
        const sig = oc || el.tagName + ':' + (el.textContent || '').trim().slice(0, 16);
        if (seen.has(sig)) continue; seen.add(sig);
        const href = el.getAttribute('href') || '';
        if (/^https?:/.test(href) || /^mailto:/.test(href)) continue;
        /* 破坏性/导航类操作：confirm 本身就是反馈，且点了会清数据/跳转，
           自动接受会炸掉整个会话 —— 不在死点击普查范围，跳过 */
        if (/wipe|logout|switchAccount|demoGo|location\.reload|location\.href/.test(oc)) { out.push({ label: (el.textContent||'').trim().slice(0,12) || el.tagName, sig: sig.slice(0, 44), skip: 'destructive' }); continue; }
        /* file 选择器在 headless 里永远「无反应」，单独标注跳过 */
        if (/getElementById\\('[\\w]*[Ff]ile'\\)\\.click/.test(oc)) { out.push({ label: (el.textContent||'').trim().slice(0,12) || el.tagName, sig: sig.slice(0, 44), skip: 'file' }); continue; }
        /* 网络拉取类：dev 无外网，loading 文案闪一下又回滚 —— 真机有反馈，无法在本地判定 */
        if (/News\.fetch|Health\.run/.test(oc)) { out.push({ label: (el.textContent||'').trim().slice(0,12) || el.tagName, sig: sig.slice(0, 44), skip: 'net' }); continue; }
        /* 清空输入框类：空态下点了当然没东西变（有内容时才清得掉），惯例无害 */
        if (/\\.value=''/.test(oc)) { out.push({ label: (el.textContent||'').trim().slice(0,12) || el.tagName, sig: sig.slice(0, 44), skip: 'clear-input' }); continue; }
        const b0 = { fp: fp(),
          page: (document.querySelector('.page.on')||{}).id,
          modal: document.querySelectorAll('.picker.on,.drawer.on').length,
          win: location.search };
        try { el.click(); } catch(e) { continue; }
        await new Promise(r => setTimeout(r, 520));
        const a0 = { fp: fp(),
          page: (document.querySelector('.page.on')||{}).id,
          modal: document.querySelectorAll('.picker.on,.drawer.on').length,
          win: location.search };
        const fb = a0.fp !== b0.fp || a0.page !== b0.page
          || a0.modal !== b0.modal || a0.win !== b0.win
          || document.activeElement !== document.body;
        const label = ((el.textContent||'').trim().slice(0,14)) || el.id || el.tagName;
        out.push({ label, sig: sig.slice(0, 44), fb });
      }
      return out; })()`);
    if (result && result.__err) { flag('🟡', 'console', `${role}/${id}`, '可点件遍历报错: ' + result.__err); continue; }
    const candidates = (result || []).filter(r => !r.fb && !r.skip);
    for (const r of (result || []).filter(x => x.skip === 'file')) fine(`${role}/${id} 「${r.label}」: 文件选择器（headless 无法验证对话框，功能存在即算过）`);
    for (const r of (result || []).filter(x => x.skip === 'destructive')) fine(`${role}/${id} 「${r.label}」: 破坏性操作（confirm 确认即反馈，不自动点击）`);
    for (const r of (result || []).filter(x => x.skip === 'net')) fine(`${role}/${id} 「${r.label}」: 网络拉取类（本地无外网无法验证，线上有 loading 反馈）`);
    for (const r of (result || []).filter(x => x.skip === 'clear-input')) fine(`${role}/${id} 「${r.label}」: 清空输入框（空态下无变化属正常惯例）`);
    /* ② 二次验证：reload 清掉长序列的状态污染，单点重测（等待 1100ms ——
       覆盖 makeCard 这类「下载后 800ms 才 toast」的异步反馈） */
    let deadN = 0;
    for (const cand of candidates) {
      await cdp.send('Page.navigate', { url: BASE + '/?nosw=1&r=' + Math.random() });
      await sleep(2600);
      await cdp.eval(`App.go(${JSON.stringify(id)})`);
      await sleep(500);
      const d0 = cdp.dialogs;
      const v = await cdp.eval(`(async () => {
        const want = ${JSON.stringify(cand.sig)};
        const els = [...document.querySelectorAll('.page.on [onclick], .page.on button, .page.on [role="button"]')]
          .filter(el => el.offsetParent && (
            (el.getAttribute('onclick')||'').startsWith(want) ||
            (!want.includes('(') && (el.tagName + ':' + (el.textContent||'').trim().slice(0,16)) === want)));
        const el = els[0];
        if (!el) return { err: 'gone' };
        const hsh = s2 => { let h = 5381; for (let i = 0; i < s2.length; i++) h = ((h << 5) + h + s2.charCodeAt(i)) >>> 0; return h.toString(36); };
        const fp = () => {
          const vals = [...document.querySelectorAll('.page.on input,.page.on select,.page.on textarea')].map(i => i.value).join('\u0001');
          const pg = document.querySelector('.page.on');
          /* toast 是反馈；弹窗挂在 body 下不在 .page.on 里 —— body.outerHTML 长度兜底 */
          return hsh(pg ? pg.outerHTML : '') + '|' + hsh(vals)
            + '|' + (document.getElementById('main')||{}).scrollTop
            + '|' + (document.getElementById('toast')||{}).textContent
            + '|' + document.body.outerHTML.length
            + '|' + document.querySelectorAll('.picker.on,.drawer.on').length; };
        const b0 = fp();
        try { el.click(); } catch(e) { return { err: 'click 抛错: ' + e.message.slice(0,60) }; }
        await new Promise(r => setTimeout(r, 1100));
        return { fb: fp() !== b0 }; })()`);
      if (v && v.err === 'gone') { /* 状态依赖按钮（选中某行/某班后才出现），无法自动复测 —— 降级为人工复核项 */ }
      else if (v && v.err) flag('🟡', 'click', `${role}/${id}`, `「${cand.label}」复测异常: ${v.err}（初测无反馈，sig=${cand.sig.slice(0,40)}）`);
      else if (v && v.fb) { /* 初测误报（前面点击污染状态），不算死 */ }
      else if (cdp.dialogs > d0) fine(`${role}/${id} 「${cand.label}」: 弹出输入框/确认框（有反馈）`);
      else { deadN++; deadItems.push({ role, id, label: cand.label, sig: cand.sig });
        console.log(`  ⏳ [click] ${role}/${id} — 「${cand.label}」两种时序均无反馈，待全新会话终审`); }
    }
    if (!deadN) fine(`${role}/${id}: 可点件全部有反馈`);
  }
  return deadItems;
}

/* ── 弹窗检查：矮窗下可见性/遮罩/关闭 ── */
const MODAL_OK = `((b, s) => {
  const vw = innerWidth, vh = innerHeight;
  const r = s.getBoundingClientRect();
  const cs = getComputedStyle(s);
  const scrollable = s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY);
  const fits = r.top >= -2 && r.bottom <= vh + 2 && r.width > 50;
  /* ==修== 遮罩判定：容器 b（.picker.on fixed inset:0）自身就是全屏层；
     r 是 sheet 的 rect，parent（如 #cellMask）可能是无样式 div —— 三者取面积最大 */
  const br = b.getBoundingClientRect();
  const pr = b.parentElement ? b.parentElement.getBoundingClientRect() : { width: 0, height: 0 };
  const cover = Math.max(br.width * br.height, r.width * r.height, pr.width * pr.height) >= vw * vh * 0.9;
  return { fits, scrollable, cover, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vw, vh }; })`;
async function checkModal(cdp, tag, name, openExpr, closeExpr) {
  await cdp.eval(openExpr);
  await sleep(450);
  const st = await cdp.eval(`(() => {
    const box = ${openExpr.includes('devGate') ? `document.getElementById('devGate')` : `document.querySelector('.picker.on,.drawer.on')`};
    if (!box) return { err: '弹层没有出现' };
    const s = box.classList.contains('picker') || box.classList.contains('drawer') ? box.querySelector('.sheet') : box;
    if (!s) return { err: '没有 .sheet' };
    return (${MODAL_OK})(box, s); })()`);
  if (st && st.err) { flag('🔴', 'modal', tag, `${name} 打不开：${st.err}`); await cdp.eval(closeExpr); return; }
  if (st && st.__err) { flag('🟡', 'modal', tag, `${name} 检查报错：${st.__err}`); await cdp.eval(closeExpr); return; }
  await cdp.shot(`modal-${tag}-${name}.png`);
  if (!st.fits && !st.scrollable) flag('🔴', 'modal', tag, `${name} 内容超高且不可滚（top=${st.top} bottom=${st.bottom} vh=${st.vh}）—— 标题或按钮会被裁掉`);
  else if (!st.fits) flag('🟡', 'modal', tag, `${name} 超出视口但内部可滚动（可接受，建议复核）`);
  if (!st.cover) flag('🟡', 'modal', tag, `${name} 遮罩没有罩住全屏（${Math.round(st.vw)}×${Math.round(st.vh)}）`);
  if (st.fits && st.cover) fine(`${tag} ${name}: 完整可见 + 全屏遮罩（h=${st.h}）`);
  await cdp.eval(closeExpr);
  await sleep(300);
  const gone = await cdp.eval(`!document.querySelector('.picker.on,.drawer.on')`);
  if (!gone) flag('🟡', 'modal', tag, `${name} 关闭路径失效（关闭后弹层仍在）`);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok);
  await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });
  console.log('dev 就绪 →', BASE);

  /* ═══ 种子 ═══ */
  const supA = await browser('sup', 1440, 900);
  await login(supA, '李老师', 'liyun2026');
  const tok = await supA.eval('Auth.token()');
  await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'users', token: tok, op: 'createMany', classIds: [],
      list: [{ user: '王梓涵', pass: 'liyun2026', role: 'student', name: '王梓涵', studentId: 'stu_a1' },
             { user: '陈小美', pass: 'liyun2026', role: 'student', name: '陈小美', studentId: 'stu_a2' },
             { user: '张伟', pass: 'liyun2026', role: 'teacher', name: '张伟' }] }) });
  await supA.eval(`(async () => {
    const today = Util.today();
    Store.mergeRemote({ classes: [{ id: 'cls_a1', name: '砺蕴一班' }, { id: 'cls_a2', name: '砺蕴二班' }],
      students: [{ id: 'stu_a1', name: '王梓涵', classId: 'cls_a1' }, { id: 'stu_a2', name: '陈小美', classId: 'cls_a1' }] });
    Store.upsert('rooms', { name: 'BY08' });
    Store.upsert('notices', { text: '本周六模考，请提前二十分钟到场，带好准考证。', date: today });
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:10', end: '11:40' });
    Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p1.id, start: '08:30', title: '普通话语音基础', cls: '砺蕴一班', room: 'BY08' });
    Store.upsert('schedule', { kind: 'big', day: '周一', date: today, periodId: p2.id, start: '10:10', title: '即兴评述', cls: '砺蕴二班', room: 'BY08' });
    Store.upsert('homework', { clsId: 'cls_a1', date: today, text: '即兴评述提纲：我的家乡' });
    Sync.push(); await new Promise(r => setTimeout(r, 900)); return true; })()`);
  console.log('种子就绪\n');

  /* ═══ 会话 A：super 四档 ═══ */
  console.log('=== A. 教务端 super ===');
  console.log('--- A1 1440×900 页面遍历（死点击/假绑定/空板块/console）---');
  const deadA = await sweep(supA, 'super', '1440');
  /* 980 档在 <1100，页面结构变手机版，桌面标题检查只对 ≥1100 有效 */
  console.log('--- A2 四档宽度标题嵌死 ---');
  const TITLES = `(() => {
    const out = [];
    document.querySelectorAll('.page.on .page-title, .page.on .card h2, .page.on .chead .page-title').forEach(el => {
      if (!el.offsetParent) return;
      const r = el.getBoundingClientRect();
      if (r.width < 10) return;
      const cs = getComputedStyle(el);
      out.push({ t: (el.textContent || '').trim().slice(0, 16), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), lh: parseFloat(cs.lineHeight) || 0, fs: parseFloat(cs.fontSize) || 0 }); });
    return out; })()`;
  const titleByW = {};
  for (const w of [1440, 1280, 1100]) {
    await viewport(supA, w, w >= 1280 ? 900 : 720);
    const pages = await supA.eval(`App.visible().map(r => r.id)`);
    for (const id of pages) {
      await supA.eval(`App.go(${JSON.stringify(id)})`);
      await sleep(320);
      const ts = await supA.eval(TITLES);
      if (ts && !ts.__err) (titleByW[w] = titleByW[w] || {})[id] = ts;
    }
  }
  await viewport(supA, 1440, 900);
  /* 折行：同标题在窄档高度增加超过 0.6 行 */
  let wrapped = 0;
  for (const id of Object.keys(titleByW[1440] || {})) {
    for (const t1440 of (titleByW[1440][id] || [])) {
      for (const w of [1280, 1100]) {
        const hit = (titleByW[w][id] || []).find(t => t.t === t1440.t && t.t);
        if (hit && t1440.lh > 0 && hit.h > t1440.h + t1440.lh * 0.6) {
          wrapped++;
          flag('🟡', 'wrap', `super/${id}@${w}`, `标题「${t1440.t}」在 ${w}px 折行（${t1440.h}px→${hit.h}px）—— 页面头/卡头应嵌死`);
        }
        if (hit && hit.w > 0 && t1440.w > 0) {
          /* 折行已单列，宽度对比留给 overlap 段 */
        }
      }
    }
  }
  if (!wrapped) fine('四档宽度标题零折行');
  /* 重叠检测：窄档下标题中心 elementFromPoint */
  for (const w of [1280, 1100]) {
    await viewport(supA, w, w >= 1280 ? 900 : 720);
    const pages = await supA.eval(`App.visible().map(r => r.id)`);
    for (const id of pages) {
      await supA.eval(`App.go(${JSON.stringify(id)})`);
      await sleep(300);
      const ov = await supA.eval(`(() => {
        const out = [];
        document.querySelectorAll('.page.on .page-title, .page.on .card h2').forEach(el => {
          if (!el.offsetParent) return;
          const r = el.getBoundingClientRect();
          if (r.width < 30) return;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
            const inSelf = el.contains(hit) || (hit.closest && hit.closest('.page.on .page-title, .page.on .card h2') === el);
            if (!inSelf) out.push({ t: (el.textContent||'').trim().slice(0,14), by: (hit.textContent||'').trim().slice(0,14) || hit.tagName }); } });
        return out; })()`);
      for (const o of (ov || [])) flag('🟡', 'overlap', `super/${id}@${w}`, `标题「${o.t}」中心被「${o.by}」覆盖`);
    }
  }
  await viewport(supA, 1440, 900);

  console.log('--- A3 弹窗遮挡（super 1280×720 矮窗）---');
  await viewport(supA, 1280, 720);
  await supA.eval(`App.go('home')`); await sleep(400);
  await checkModal(supA, 'super720', 'drawer', `App.drawer(true)`, `App.drawer(false)`);
  await supA.eval(`App.go('teachers')`); await sleep(400);
  await checkModal(supA, 'super720', 'rolePick', `Teachers.openRole()`, `Teachers.closeRole()`);
  await supA.eval(`App.go('timetable')`); await sleep(500);
  const pid = await supA.eval(`(Store.list('periods')[0]||{}).id`);
  if (pid) await checkModal(supA, 'super720', 'perEdit', `Schedule.perEdit(${JSON.stringify(pid)})`, `Schedule.cellClose()`);
  await checkModal(supA, 'super720', 'cellOpen', `Schedule.cellOpen(Util.today(), ${JSON.stringify(pid || '')}, null, '', '')`, `Schedule.cellClose()`);
  await viewport(supA, 1440, 900);

  /* ═══ 会话 B：teacher ═══ */
  console.log('\n=== B. 授课老师端 teacher ===');
  const teaB = await browser('tea', 1440, 900);
  await login(teaB, '张伟', 'liyun2026');
  console.log('--- B1 1440 页面遍历 ---');
  const deadB = await sweep(teaB, 'teacher', '1440');
  console.log('--- B2 弹窗（1280×720 矮窗）---');
  await viewport(teaB, 1280, 720);
  await teaB.eval(`App.go('today')`); await sleep(400);
  await checkModal(teaB, 'tea720', 'drawer', `App.drawer(true)`, `App.drawer(false)`);
  await teaB.eval(`App.go('timetable')`); await sleep(500);
  await checkModal(teaB, 'tea720', 'cellOpen', `Schedule.cellOpen(Util.today(), '', null, '', '')`, `Schedule.cellClose()`);
  await viewport(teaB, 1440, 900);

  /* ═══ 会话 C：student ═══ */
  console.log('\n=== C. 学生端 student ===');
  const stuC = await browser('stu', 1440, 900);
  await login(stuC, '王梓涵', 'liyun2026');
  console.log('--- C1 1440 页面遍历 ---');
  const deadC = await sweep(stuC, 'student', '1440');
  console.log('--- C2 弹窗（390×844 手机）---');
  await stuC.eval(`App.go('stuHome')`);
  await viewport(stuC, 390, 844);
  await checkModal(stuC, 'stu390', 'drawer', `App.drawer(true)`, `App.drawer(false)`);
  await checkModal(stuC, 'stu390', 'devGate', `document.getElementById('devGate').classList.add('on')`, `document.getElementById('devGate').classList.remove('on')`);
  await viewport(stuC, 1440, 900);

  /* ═══ gate 登录门矮窗 ═══ */
  console.log('\n=== D. 登录门 gate（1280×720 矮窗 + 390）===');
  const gC = await browser('gate', 1280, 720);
  await sleep(1200);
  const gst = await gC.eval(`(() => {
    const g = document.getElementById('gate');
    if (!g) return { err: 'gate 不存在' };
    const r = g.getBoundingClientRect();
    const inner = g.scrollHeight, cli = g.clientHeight;
    return { visible: r.width > 300, fits: inner <= cli + 4, scrollable: inner > cli, inner, cli,
      form: !!document.getElementById('gUser') }; })()`);
  if (gst.err) flag('🔴', 'modal', 'gate720', gst.err);
  else if (gst.visible && gst.form) fine(`gate 720 高: 登录表单可见` + (gst.scrollable ? '（内部可滚）' : ''));
  await gC.shot('modal-gate-720.png');
  await viewport(gC, 390, 844);
  const gm = await gC.eval(`(() => {
    const f = document.getElementById('gUser'); if (!f) return { err: '没有表单' };
    const r = f.getBoundingClientRect();
    return { vis: !!f.offsetParent || getComputedStyle(f).display !== 'none', y: Math.round(r.y) }; })()`);
  if (gm.err) flag('🔴', 'modal', 'gate390', gm.err);
  else if (gm.vis) fine(`gate 390: 表单可见（y=${gm.y}）`);
  await gC.shot('modal-gate-390.png');

  /* ═══ 死点击终审放最后：dev-reset 会清掉主种子用户，不能插在 teacher/student 会话之前 ═══ */
  const deadAll = [...deadA, ...deadB, ...deadC];
  if (deadAll.length) { console.log('\n=== E. 死点击全新会话终审（dev-reset + 重播种）==='); await retestDead(deadAll); }

  /* ═══ 汇总 ═══ */
  console.log(`\n${'═'.repeat(60)}`);
  const red = P.filter(p => p.sev === '🔴'), yellow = P.filter(p => p.sev === '🟡');
  console.log(`体检完成：🔴 严重 ${red.length} 项 · 🟡 注意 ${yellow.length} 项 · ✅ 通过检查 ${pass} 项`);
  const byCat = {};
  for (const p of P) (byCat[p.cat] = byCat[p.cat] || []).push(p);
  for (const [cat, list] of Object.entries(byCat)) console.log(`  [${cat}] ${list.length} 项`);
  await writeFile(path.join(OUT, 'problems.json'), JSON.stringify(P, null, 2));
  console.log('清单 → docs/audit-interact-2026-11-12/problems.json');
} finally {
  chromes.forEach(c => c.kill()); server.kill();   /* 不 process.exit —— 让异常正常冒出来看堆栈 */
}
