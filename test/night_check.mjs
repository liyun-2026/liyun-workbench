/**
 * 晚自习 · 笔记检查（VoxOS 5.52 · 卡片墙）
 *   node test/night_check.mjs [端口=5344]
 *
 * 钉死八件事：
 *   ① 空白态：note:<日期> 一条都没有、21 张卡、已查 0、进度 0；
 *   ② 勾点联动状态：勾 1 → 待补；勾满 3 → 优；三勾全撤 → 回到未查且记录被删；
 *   ③ 「标未交」→ 未交、三个勾清零；再从「未交」勾一下 → 待补（miss 自动解除）；
 *   ④ 备注落盘：写进 Store、卡片上出现一行、切日期再切回来还在；
 *   ⑤ 切班 / 切日隔离：06班的数据不会跑到 05班、今天的数据不会跑到明天；
 *   ⑥ 一键全标：confirm 拒绝时不动；同意后 21 人全「已交 · 优」，未交归零；
 *   ⑦ 列数：桌面 1440 三列、手机 390 两列，且手机上勾点缩成「页 / 订 / 字」；
 *   ⑧ 权限：只读视角点勾不动数据（前端拦）；授课老师服务端能读 note:、写不进去。
 *
 * 过关（night:<日期>）全程不被碰 —— 每段都顺带断言一次。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5344);
const CPORT = PORT + 811;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = path.join(dir, 'docs', 'nightnote-live-2026-11-22');
const DATE = '2026-11-22';
const NAMES_A = ['张乐然','李思远','王雨桐','赵一鸣','陈子涵','刘昊然','杨若曦','周牧野','吴桐','徐嘉禾',
                 '孙千一','马承宇','朱梓萱','胡杨','郭静姝','何雨薇','高远','林小满','罗京','郑清和','谢云舟'];
const NAMES_B = ['宋佳音','唐果','冯清越','蒋白露','沈知远','韩沐','曹予星','邓然','许知微','傅嘉言',
                 '崔亦可','范书宁','彭程','董雨舒','袁亦然','苏槿','陈默','潘星野'];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jf = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(30000) });
const post = async (body) => (await jf(`${BASE}/api/sync`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})).json();

async function waitFor(fn, { tries = 80, gap = 400, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.errs = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)) {
        const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        c.errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(f) {
    const d = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(f, Buffer.from(d.data, 'base64'));
  }
  async metrics(w, h, mobile) {
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!mobile });
    if (mobile) {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    } else {
      await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'fine' }, { name: 'hover', value: 'hover' }] });
    }
    await sleep(320);
  }
}

let server, chrome;
try {
  await mkdir(SHOTS, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await post({ action: 'hello' })).ok !== undefined, { what: '预览服务' });
  await jf(`${BASE}/api/dev-reset`, { method: 'POST' });

  const profile = await mkdtemp(path.join(tmpdir(), 'nightchk-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CPORT}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'], { stdio: 'ignore' });

  const target = await waitFor(async () => {
    const l = await (await jf(`http://127.0.0.1:${CPORT}/json/list`)).json();
    return l.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: 'Chrome' });

  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.metrics(1440, 1000, false);
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(2400);

  /* ── 登录 + 造两个班 ────────────────────────────────────────────── */
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '陈校';
    document.getElementById('gPass').value = 'admin12345';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2200));
    return 1;
  })()`);

  const prep = await cdp.eval(`(() => {
    const A = Store.upsert('classes', { name: '06班' });
    const B = Store.upsert('classes', { name: '05班' });
    const a = ${JSON.stringify(NAMES_A)}, b = ${JSON.stringify(NAMES_B)};
    const mk = (list, cls) => list.map(n => Store.upsert('students', { name: n, classId: cls.id }));
    const sa = mk(a, A), sb = mk(b, B);
    Store.set('_nightCls', A.id);
    Store.set('_nightDate', '${DATE}');
    App.go('night'); Night.render();
    return { A: A.id, B: B.id, nA: sa.length, nB: sb.length, first: sa[0].id };
  })()`);
  ok(prep.nA === 21 && prep.nB === 18, `两个班建好（06班 ${prep.nA} 人 / 05班 ${prep.nB} 人）`);
  await sleep(600);

  const S = (expr) => cdp.eval(`(() => { ${expr} })()`);

  /* ── ① 空白态 ──────────────────────────────────────────────────── */
  console.log('\n① 空白态');
  {
    const s = await S(`
      return {
        cards: document.querySelectorAll('#noteWall .nt-k').length,
        done: document.getElementById('noteDone').textContent,
        total: document.getElementById('noteTotal').textContent,
        miss: document.getElementById('noteMiss').textContent,
        prog: document.getElementById('noteProg').style.width || '0%',
        recs: Store.list('note:${DATE}').length,
        nightItems: document.querySelectorAll('#nightBody .item').length,
        title: document.querySelector('#noteCard .nt-title').textContent.trim(),
        chips: [...document.querySelectorAll('.nt-chip')].map(x => x.textContent.replace(/\\s+/g, ''))
      };`);
    ok(s.cards === 21, `21 张卡（实际 ${s.cards}）`);
    ok(s.done === '0' && s.total === '/21' && s.miss === '0', `卡头 0/21 · 未交 0（${s.done}${s.total} / ${s.miss}）`);
    ok(s.recs === 0, 'note:<日期> 一条都没有');
    ok(s.nightItems === 21, '过关卡原样在（21 行）');
    ok(s.title.startsWith('笔记检查') && s.title.includes('新增'), '标题「笔记检查」+ 金色「新增」签');
    ok(JSON.stringify(s.chips) === JSON.stringify(['全部21', '未查21', '待补0', '未交0']),
      `四个筛选 chip 与计数正确（${s.chips.join(' · ')}）`);
  }

  /* ── ② 勾点联动状态 ────────────────────────────────────────────── */
  console.log('\n② 勾点联动状态（未查 → 待补 → 优 → 未查）');
  {
    const first = prep.first;
    const step = async (i) => S(`
      document.querySelector('.nt-k[data-sid="${first}"] .nt-ck:nth-child(${i + 1})').click();
      return 1;`);
    await step(0); await sleep(220);
    let s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      const k = document.querySelector('.nt-k[data-sid="${first}"]');
      return { st: r && r.st, ck: r && r.ck, dom: k && k.dataset.st, done: document.getElementById('noteDone').textContent };`);
    ok(s.st === 'fix' && s.dom === 'fix', `勾 1 个 → 待补（记录 ${s.st} / 卡片 ${s.dom}）`);
    ok(s.done === '1', '已查从 0 变 1');

    await step(1); await step(2); await sleep(220);
    s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      return { st: r && r.st, ck: r && r.ck, done: document.getElementById('noteDone').textContent,
               prog: document.getElementById('noteProg').style.width };`);
    ok(s.st === 'ok' && s.ck.every(Boolean), `勾满 3 个 → 优（st=${s.st}）`);
    ok(s.done === '1' && s.prog === '5%', `进度 ${s.prog}（1/21 ≈ 5%）`);

    await step(0); await step(1); await step(2); await sleep(260);
    s = await S(`
      const k = document.querySelector('.nt-k[data-sid="${first}"]');
      return { recs: Store.list('note:${DATE}').length, st: k && k.dataset.st,
               done: document.getElementById('noteDone').textContent };`);
    ok(s.recs === 0, '三勾全撤 → 记录被删（不留空记录，已查不虚高）');
    ok(s.st === 'un' && s.done === '0', `卡片回到「未查」、已查归 0（${s.st} / ${s.done}）`);
  }

  /* ── ③ 标未交 / 解除 ───────────────────────────────────────────── */
  console.log('\n③ 「未交」与解除');
  {
    const first = prep.first;
    await cdp.eval(`Note.markMiss('${first}'); 1`); await sleep(240);
    let s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      return { st: r && r.st, ck: r && r.ck, miss: document.getElementById('noteMiss').textContent };`);
    ok(s.st === 'miss' && s.ck.every(v => !v), `标未交（st=${s.st}，三勾已清零）`);
    ok(s.miss === '1', '卡头「未交」= 1');

    await cdp.eval(`Note.toggle('${first}', 0); 1`); await sleep(240);
    s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      return { st: r && r.st, miss: document.getElementById('noteMiss').textContent };`);
    ok(s.st === 'fix' && s.miss === '0', `从「未交」勾一下 → 待补，未交归 0（${s.st}）`);

    /* 清场：回到未查，后面的用例从干净状态起 */
    await cdp.eval(`Note.toggle('${first}', 0); 1`); await sleep(200);
    const n = await cdp.eval(`Store.list('note:${DATE}').length`);
    ok(n === 0, '清场完成（记录数 0）');
  }

  /* ── ④ 备注落盘 ───────────────────────────────────────────────── */
  console.log('\n④ 备注');
  {
    const first = prep.first;
    await cdp.eval(`Note.card('${first}'); 1`); await sleep(280);
    const hasTa = await cdp.eval(`!!document.querySelector('#noteWall .nt-ta')`);
    ok(hasTa, '点卡展开出备注输入框');

    await cdp.eval(`(() => {
      const ta = document.querySelector('#noteWall .nt-ta');
      ta.value = '缺第 12–14 页，明天补';
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return 1;
    })()`); await sleep(280);
    let s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      return { note: r && r.note, by: r && r.by, at: r && r.at,
               dom: (document.querySelector('.nt-k[data-sid="${first}"] .nt-knote') || {}).textContent || '' };`);
    ok(s.note === '缺第 12–14 页，明天补', `备注写入 Store（${s.note}）`);
    ok(s.by === '陈校' && s.at > 0, `记了登记人 ${s.by} 与时间戳`);
    ok(s.dom.includes('12–14'), '卡片上出现备注一行');

    /* 切日期再切回：备注还在 */
    await cdp.eval(`Night.pickDate('2026-11-23'); 1`); await sleep(400);
    const away = await cdp.eval(`document.querySelectorAll('#noteWall .nt-k').length`);
    await cdp.eval(`Night.pickDate('${DATE}'); 1`); await sleep(420);
    s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${first}');
      return { note: r && r.note, n: document.querySelectorAll('#noteWall .nt-k').length };`);
    ok(away === 21, '切到 11-23 仍是 21 张卡（只是全空）');
    ok(s.note === '缺第 12–14 页，明天补', `切回 11-22 备注还在（${s.note}）`);
  }

  /* ── ⑤ 切班 / 切日隔离 ─────────────────────────────────────────── */
  console.log('\n⑤ 切班 / 切日隔离');
  {
    await cdp.eval(`Night.pickCls('${prep.B}'); 1`); await sleep(500);
    let s = await S(`
      return { cards: document.querySelectorAll('#noteWall .nt-k').length,
               done: document.getElementById('noteDone').textContent,
               sub: document.getElementById('noteSub').textContent };`);
    ok(s.cards === 18, `切到 05班 → 18 张卡（实际 ${s.cards}）`);
    ok(s.done === '0', '05班 自己一条记录都没有（06班 的没过界）');
    ok(s.sub.includes('05班'), `副标题跟着换（${s.sub}）`);

    await cdp.eval(`Night.pickCls('${prep.A}'); 1`); await sleep(500);
    s = await S(`
      const r = Store.list('note:${DATE}').find(x => x.studentId === '${prep.first}');
      return { note: r && r.note, cards: document.querySelectorAll('#noteWall .nt-k').length };`);
    ok(s.cards === 21 && s.note === '缺第 12–14 页，明天补', '切回 06班 → 21 张卡、备注原样');

    await cdp.eval(`Night.pickDate('2026-11-23'); 1`); await sleep(450);
    s = await S(`
      return { recs: Store.list('note:2026-11-23').length, done: document.getElementById('noteDone').textContent,
               sub: document.getElementById('noteSub').textContent };`);
    ok(s.recs === 0 && s.done === '0', '切到 11-23 → 今天的数据不过去');
    await cdp.eval(`Night.pickDate('${DATE}'); 1`); await sleep(450);
  }

  /* ── ⑥ 一键全标 ───────────────────────────────────────────────── */
  console.log('\n⑥ 一键全标已交');
  {
    const before = await cdp.eval(`Store.list('note:${DATE}').length`);
    const r1 = await cdp.eval(`(() => { const o = window.confirm; window.confirm = () => false;
      Note.allOk(); window.confirm = o;
      return { n: Store.list('note:${DATE}').length, done: document.getElementById('noteDone').textContent }; })()`);
    ok(r1.n === before, `confirm 拒绝 → 数据不动（${before} 条）`);

    await cdp.eval(`(() => { const o = window.confirm; window.confirm = () => true;
      Note.allOk(); window.confirm = o; return 1; })()`); await sleep(400);
    const s = await S(`
      const recs = Store.list('note:${DATE}');
      return { n: recs.length, allOk: recs.every(r => r.st === 'ok' && r.ck.every(Boolean)),
               done: document.getElementById('noteDone').textContent, miss: document.getElementById('noteMiss').textContent,
               prog: document.getElementById('noteProg').style.width, okCards: document.querySelectorAll('.nt-k[data-st="ok"]').length };`);
    ok(s.n === 21, `21 人全部落库（${s.n} 条）`);
    ok(s.allOk, '每条都是「三勾全中 · 优」');
    ok(s.done === '21' && s.miss === '0', `卡头 21/21、未交 0（${s.done} / ${s.miss}）`);
    ok(s.prog === '100%' && s.okCards === 21, `进度 100%、21 张卡都是绿色状态边`);

    /* 过关数据全程没被写坏 */
    const nightN = await cdp.eval(`Store.list('night:${DATE}').length`);
    ok(nightN === 0, `过关记录仍为空（笔记检查没往 night: 里写东西，${nightN} 条）`);
  }

  /* ── ⑦ 列数：桌面 3 / 手机 2 ───────────────────────────────────── */
  console.log('\n⑦ 列数（桌面 1440 / 手机 390）');
  {
    const cols = async () => S(`
      const g = getComputedStyle(document.getElementById('noteWall')).gridTemplateColumns.split(/\\s+/).filter(Boolean);
      return { n: g.length, ckText: (getComputedStyle(document.querySelector('.nt-ck .nt-ch')).display),
               tick: (getComputedStyle(document.querySelector('.nt-ck .nt-tick')).display),
               legend: getComputedStyle(document.querySelector('.nt-lg')).display };`);
    await cdp.metrics(1440, 1000, false); await sleep(320);
    let c = await cols();
    ok(c.n === 3, `桌面 1440 → 3 列（实际 ${c.n}）`);
    ok(c.ckText === 'none' && c.tick !== 'none', '桌面勾点是 ✓ + 全称（不显示单字）');
    ok(c.legend === 'none', '桌面不显示图例（标签本身就是全称）');

    await cdp.metrics(390, 900, true); await sleep(420);
    c = await cols();
    ok(c.n === 2, `手机 390 → 2 列（实际 ${c.n}）`);
    ok(c.ckText !== 'none' && c.tick === 'none', '手机勾点缩成「页 / 订 / 字」');
    ok(c.legend !== 'none', '手机显示图例一行');
    await cdp.shot(path.join(SHOTS, 'note-390.png'));
    await cdp.metrics(1440, 1000, false); await sleep(320);
  }

  /* ── ⑧ 权限：只读视角 + 授课老师 ───────────────────────────────── */
  console.log('\n⑧ 权限');
  {
    const first = prep.first;
    const before = await cdp.eval(`JSON.stringify(Store.list('note:${DATE}').find(r => r.studentId === '${first}') || null)`);
    const r = await cdp.eval(`(() => {
      const o = Auth._me;
      Auth._me = Object.assign({}, o, { isStaff: false, role: 'teacher' });
      const okEdit = Auth.canEdit();
      Note.toggle('${first}', 0);            // 只读：应被拦下
      const after = JSON.stringify(Store.list('note:${DATE}').find(x => x.studentId === '${first}') || null);
      const toast = (document.getElementById('toast') || {}).textContent || '';
      Auth._me = o;
      App.renderChrome();                    // 把 no-edit 类还原
      return { okEdit, after, toast };
    })()`);
    ok(r.okEdit === false, 'Auth.canEdit() = false（只读身份）');
    ok(r.after === before, '只读视角点勾：数据一个字节没动');
    ok(/只读视角/.test(r.toast), `点了给提示（${r.toast}）`);

    /* 服务端：建一个带 06班 的授课老师，读得到、写不进去。
       先把教务这边刚写的 note: 推上去（15s 轮询不一定赶上，这里手动推一次）。 */
    await cdp.eval(`(async () => { try { await Sync.push(); } catch(e){} return 1; })()`);
    await sleep(600);
    const pushed = await cdp.eval(`(() => { const raw = Store.list('note:${DATE}'); return raw.length; })()`);
    ok(pushed === 21, `教务本地 note: 共 21 条待同步（${pushed}）`);

    const mk = await cdp.eval(`(async () => {
      const r = await Auth.call('users', { op: 'create', user: 't_note01', pass: 'teacher2026',
        role: 'teacher', name: '张伟', classIds: ['${prep.A}'] });
      return r;
    })()`);
    ok(mk && mk.ok, '建好授课老师号 t_note01（带 06班）');

    const login = await post({ action: 'login', user: 't_note01', pass: 'teacher2026' });
    ok(login && login.token, '授课老师能在服务端登录');
    const tk = login.token;

    const pull = await post({ action: 'pull', token: tk });
    const shared = pull.shared || {};
    const seen = shared['note:' + DATE];
    ok(Array.isArray(seen) && seen.length === 21, `授课老师读得到 note:<日期>（${Array.isArray(seen) ? seen.length : '无'} 条 —— TEACHER_PREFIX_READ 已含 note:）`);
    ok(seen && seen.every(r => r.st === 'ok'), '读到的内容就是教务刚标的状态（只读镜像）');

    const forged = { id: 'forged-1', studentId: prep.first, st: 'miss', ck: [false, false, false], note: '老师偷偷改的', by: '张伟', at: Date.now() };
    const push = await post({ action: 'push', token: tk, shared: { ['note:' + DATE]: [forged] } });
    ok(!!push.ok, 'push 请求本身返回 ok（不弹同步失败）');

    const back = await post({ action: 'pull', token: tk });
    const after = (back.shared || {})['note:' + DATE] || [];
    ok(!after.some(r => r.id === 'forged-1'), '伪造那条被服务端丢弃（写不进去）');
    ok(after.length === 21 && after.every(r => r.st === 'ok'), '服务端 note: 数据保持 21 条全「优」');

    const nightAfter = (back.shared || {})['night:' + DATE];
    ok(nightAfter === undefined, '授课老师读到的 night: 仍是空（没被写）');
  }

  /* ── 收尾：页面错误与截图 ──────────────────────────────────────── */
  console.log('\n⑨ 页面错误 / 桌面截图');
  {
    await cdp.eval(`(() => { const c = document.getElementById('noteCard');
      document.getElementById('main').scrollTop += c.getBoundingClientRect().top - 72; return 1; })()`);
    await sleep(500);
    await cdp.shot(path.join(SHOTS, 'note-1440.png'));
    const real = cdp.errs.filter(e => !/favicon|ResizeObserver/i.test(e));
    ok(real.length === 0, `全程无 JS 异常${real.length ? '（' + real[0].slice(0, 80) + '）' : ''}`);
  }

  console.log(`\n${fail === 0 ? '✅ 全过' : '❌ 有失败'}：${pass} 通过 / ${fail} 失败`);
  console.log('截图：docs/nightnote-live-2026-11-22/note-1440.png、note-390.png');
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('💥 ' + (e && e.stack || e));
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  if (server) server.kill();
  await sleep(300);
}
