/**
 * VoxOS 5.53 · 今日页课表 / 到课口径 / 迟到计分 / 细则导入
 *   node test/fix553_check.mjs [端口=5355]
 *
 * 钉死五块：
 *   A 课表映射：今日时间轴要出现「这节课是什么课」（课程名 + 班级/老师），
 *              没排课的节才写「本节无事项」；只剩 id 的坏作息行不许变成空刻度；
 *   B 到课口径：到课 = 正常 + 迟到（迟到单独计数），缺席只算请假和未到；
 *   C 迟到计分：1/10/11 分钟边界（−2 / −20 / −20），UI 弹窗填分钟 → 落库 →
 *              写进量化（来源「考勤·迟到 N 分钟」），重算不叠加，改分钟只改一条；
 *   D 细则导入：《考前集训量化管理细则》全量条目数与分类，变量项（按分钟 / 区间）语义；
 *   E 全程无 JS 异常。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5355);
const CPORT = PORT + 811;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jf = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(30000) });
const post = async body => (await jf(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();

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
}

let server, chrome;
try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await post({ action: 'hello' })).ok !== undefined, { what: '预览服务' });
  await jf(`${BASE}/api/dev-reset`, { method: 'POST' });

  const profile = await mkdtemp(path.join(tmpdir(), 'fix553-'));
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await sleep(2400);

  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '陈校';
    document.getElementById('gPass').value = 'admin12345';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2200));
    return 1;
  })()`);

  const S = expr => cdp.eval(`(() => { ${expr} })()`);

  /* ── 造数据：一个班 5 人、4 节正常作息 + 1 条坏作息、今天 3 节课 ── */
  const prep = await S(`
    const C = Store.upsert('classes', { name: '考前06班' });
    const names = ['甲同学','乙同学','丙同学','丁同学','戊同学'];
    const stu = names.map(n => Store.upsert('students', { name: n, classId: C.id }));
    const p1 = Store.upsert('periods', { name: '第一节', start: '08:00', end: '08:40', dur: 40, gap: 10, auto: false });
    const p2 = Store.upsert('periods', { name: '第二节', start: '08:50', end: '09:30', dur: 40, gap: 10, auto: false });
    const p3 = Store.upsert('periods', { name: '第三节', start: '09:40', end: '10:20', dur: 40, gap: 10, auto: false });
    const p4 = Store.upsert('periods', { name: '第四节', start: '10:30', end: '11:10', dur: 40, gap: 10, auto: false });
    /* 迁移写坏的作息行：只有 id，没有起止时间 —— 不许变成空刻度 */
    Store.upsert('periods', { name: '' });
    const t = Util.today();
    Store.upsert('schedule', { date: t, day: Schedule.dayOfDate(t), periodId: p1.id, title: '新闻语感晨练', cls: '考前06班', kind: 'big' });
    Store.upsert('schedule', { date: t, day: Schedule.dayOfDate(t), periodId: p2.id, title: '即兴评述', cls: '考前06班', kind: 'big' });
    Store.upsert('schedule', { date: t, day: Schedule.dayOfDate(t), periodId: p3.id, title: '文稿朗诵', cls: '考前06班', kind: 'big' });
    /* 另一天的课：不许串到今天 */
    const y = Util.dateOf ? Util.dateOf(new Date(Date.now() - 864e5)) : t;
    Store.upsert('schedule', { date: y, periodId: p1.id, title: '昨天的课别串过来', cls: '考前06班', kind: 'big' });
    Store.set('_attCls', C.id);
    Store.set('_attDate', t);
    App.go('home');
    return { cls: C.id, t, sids: stu.map(s => s.id), periods: [p1.id, p2.id, p3.id, p4.id] };
  `);
  await sleep(900);
  ok(prep.sids.length === 5, '造好 1 个班 5 人');
  const [S1, S2, S3, S4, S5] = prep.sids;

  /* ═══ A 课表映射 ═══ */
  console.log('\nA 今日页时间轴要显示「这节课是什么课」');
  {
    const s = await S(`
      const ticks = [...document.querySelectorAll('#tlAxis .tl-tick')];
      const nodes = [...document.querySelectorAll('#tlAxis .tl-node .tn-title')].map(x => x.textContent.trim());
      const subs  = [...document.querySelectorAll('#tlAxis .tl-node .tn-sub')].map(x => x.textContent.trim());
      const empt  = [...document.querySelectorAll('#tlAxis .tl-nodes > p.hint')].map(x => x.textContent.trim());
      return { ticks: ticks.length, labels: ticks.map(t => (t.querySelector('.tl-label') || {}).textContent || ''),
               per: ticks.map(t => t.querySelectorAll('.tl-node').length),
               nodes, subs, empt };
    `);
    console.log('    · 每档节点数 =', JSON.stringify(s.per), '· 标签 =', JSON.stringify(s.labels));
    ok(s.ticks === 4, `坏作息行被滤掉：刻度 4 个（实际 ${s.ticks}）`);
    ok(s.nodes.includes('新闻语感晨练') && s.nodes.includes('即兴评述') && s.nodes.includes('文稿朗诵'),
      `三节课都上轴（${s.nodes.join(' / ')}）`);
    ok(!s.nodes.some(x => x.indexOf('昨天') >= 0), '昨天的课没串到今天');
    ok(s.subs.some(x => x.indexOf('考前06班') >= 0), `副标题带班级（${s.subs[0] || ''}）`);
    ok(s.empt.length === 0, `每节都有事可写，没有「本节无事项」（${s.empt.length} 处）`);
    ok(s.per[3] === 1 && s.nodes.includes('晚自习过关'), '第 4 节没有课，落的是晚自习过关（不是空节点）');
    ok(s.labels.every(x => /^\d{2}:\d{2}/.test(x.replace(/\s/g, ''))), '每个刻度都有时间标签，没有空刻度');
  }

  /* ═══ B 到课口径 ═══ */
  console.log('\nB 今日页「到课」口径：迟到算到课');
  {
    await S(`
      const t = '${prep.t}', c = '${prep.cls}';
      Store.upsert('att:' + t, { studentId: '${S1}', status: '正常', pid: 'am' });
      Store.upsert('att:' + t, { studentId: '${S2}', status: '迟到', pid: 'am', lateMin: 3 });
      Store.upsert('att:' + t, { studentId: '${S3}', status: '病假', pid: 'am' });
      Store.upsert('att:' + t, { studentId: '${S4}', status: '未到', pid: 'am' });
      App.go('home'); XF2.stats();
      return 1;`);
    await sleep(1500);   /* 数字是滚动上去的（_count 补间），读太早会读到 0 */
    const s = await S(`
      return { cnt: document.getElementById('xdAttCnt').textContent,
               sub: document.getElementById('xdAttSub').textContent.replace(/\\s+/g, ' '),
               tip: (document.getElementById('xdAttCnt').closest('.xd-stat') || {}).title || '' };`);
    ok(s.cnt === '2', `到课 2 人 = 正常 1 + 迟到 1（实际 ${s.cnt}）`);
    ok(/迟到\s*1/.test(s.sub) && /请假\s*1/.test(s.sub) && /未到\s*1/.test(s.sub) && /未登记\s*1/.test(s.sub),
      `第二行摊开口径：${s.sub}`);
    ok(/到课/.test(s.tip) && /迟到/.test(s.tip), '卡上有口径说明 tooltip');

    const tmeta = await S(`
      Store.set('_tdAttCls', '${prep.cls}'); Today.renderAtt();
      return (document.getElementById('tdAttMeta') || {}).textContent || '';`);
    ok(/^到课 2\/5/.test(tmeta.trim()) && /迟到 1/.test(tmeta), `老师今日页同一口径：${tmeta.trim()}`);
  }

  /* ═══ C 迟到计分 ═══ */
  console.log('\nC 迟到分钟 + 按细则扣分');
  {
    /* 先把 B 段那位「迟到 3 分钟」的乙同学改回正常，C 段只留戊同学一个人迟到 */
    await S(`Att.write('${S2}', '正常'); return 1;`);
    await sleep(300);
    const pts = await S(`return [Att.latePoints(1), Att.latePoints(10), Att.latePoints(11)];`);
    ok(pts[0] === -2 && pts[1] === -20 && pts[2] === -20, `边界 1/10/11 分钟 → ${pts.join(' / ')} 分`);

    /* 走真实 UI：点「迟到」章 → 弹窗 → 填 3 → 确认 */
    await S(`
      Att.render();
      document.querySelector('.stamp[data-sid="${S5}"][data-s="迟到"]').click();
      return 1;`);
    await sleep(250);
    const modal = await S(`
      const m = document.getElementById('lateMask');
      const inp = document.getElementById('lateMin');
      return { has: !!m, val: inp ? inp.value : '', hint: m ? m.textContent.replace(/\\s+/g, ' ').slice(0, 80) : '' };`);
    ok(modal.has, '点「迟到」弹出分钟输入框');
    ok(modal.val === '1', `默认 1 分钟（实际 ${modal.val}）`);
    ok(/10 分钟以内/.test(modal.hint) && /20 分/.test(modal.hint), '弹窗里写着细则口径');

    /* 空值不许确认 */
    await S(`
      document.getElementById('lateMin').value = '';
      Att.lateOk('${S5}');
      return 1;`);
    await sleep(200);
    const blank = await S(`
      const r = Store.list('att:${prep.t}').find(x => x.studentId === '${S5}');
      return { rec: !!r, modal: !!document.getElementById('lateMask') };`);
    ok(!blank.rec && blank.modal, '没填分钟不许确认（记录没写、弹窗还在）');

    await S(`
      const inp = document.getElementById('lateMin');
      inp.value = '3'; inp.dispatchEvent(new Event('input'));
      Att.lateOk('${S5}');
      return 1;`);
    await sleep(350);
    const r3 = await S(`
      const r = Store.list('att:${prep.t}').find(x => x.studentId === '${S5}');
      const q = Store.list('quant_log').filter(x => x.clsId === '${prep.cls}' && x._src === 'att' && !x._d);
      const row = [...document.querySelectorAll('#roster .rrow')].find(x => (x.textContent || '').indexOf('戊同学') >= 0);
      return { st: r && r.status, min: r && r.lateMin,
               logs: q.map(x => x.label + ' ' + x.delta),
               stamp: row ? [...row.querySelectorAll('.stamp')].map(b => b.textContent.trim()).filter(x => x.indexOf('迟到') >= 0)[0] : '' };`);
    ok(r3.st === '迟到' && r3.min === 3, `记录落库：迟到 · ${r3.min} 分钟`);
    ok(r3.logs.length === 2 && r3.logs.some(x => x === '考勤·迟到 3 分钟 -6'),
      `量化记一笔「考勤·迟到 3 分钟 −6」（${r3.logs.join(' / ')}）`);
    ok(/迟到 3′/.test(r3.stamp || ''), `章上回显分钟（${r3.stamp}）`);

    /* 再点一次章 = 改分钟，不是撤销 */
    await S(`document.querySelector('.stamp[data-sid="${S5}"][data-s="迟到"]').click(); return 1;`);
    await sleep(220);
    const again = await S(`const i = document.getElementById('lateMin'); return { open: !!i, val: i && i.value };`);
    ok(again.open && again.val === '3', `再点「迟到」是改分钟（回显 ${again.val}）`);

    await S(`const i = document.getElementById('lateMin'); i.value = '12'; Att.lateOk('${S5}'); return 1;`);
    await sleep(350);
    const r12 = await S(`
      const r = Store.list('att:${prep.t}').find(x => x.studentId === '${S5}');
      const q = Store.list('quant_log').filter(x => x.clsId === '${prep.cls}' && x._src === 'att' && !x._d && x.label.indexOf('迟到') >= 0);
      return { min: r && r.lateMin, logs: q.map(x => x.label + ' ' + x.delta) };`);
    ok(r12.min === 12 && r12.logs.length === 1 && r12.logs[0] === '考勤·迟到 12 分钟 -20',
      `12 分钟 → 只留一条「−20」（${r12.logs.join(' / ')}）`);

    /* 重算不叠加 */
    const before = await S(`return Store.list('quant_log').filter(x => x.clsId === '${prep.cls}' && x._src === 'att' && !x._d).length;`);
    await S(`Quant.syncAtt('${prep.cls}', '${prep.t}'); Quant.syncAtt('${prep.cls}', '${prep.t}'); Quant.syncAllFromAtt ? 1 : 1; return 1;`);
    await sleep(300);
    const after = await S(`
      const q = Store.list('quant_log').filter(x => x.clsId === '${prep.cls}' && x._src === 'att' && !x._d);
      return { n: q.length, sum: q.reduce((s, x) => s + x.delta, 0) };`);
    ok(after.n === before, `按考勤重算本班两次，条数不变（${before} → ${after.n}）`);

    /* 改成「正常」→ 迟到那笔消失 */
    await S(`Att.write('${S5}', '正常'); return 1;`);
    await sleep(350);
    const cleared = await S(`
      const r = Store.list('att:${prep.t}').find(x => x.studentId === '${S5}');
      const q = Store.list('quant_log').filter(x => x.clsId === '${prep.cls}' && x._src === 'att' && !x._d && x.label.indexOf('迟到') >= 0);
      return { st: r && r.status, min: r && r.lateMin, n: q.length };`);
    ok(cleared.st === '正常' && !cleared.min && cleared.n === 0, '改回「正常」→ 迟到的扣分自动撤掉');
  }

  /* ═══ D 细则导入 ═══ */
  console.log('\nD 《考前集训量化管理细则》全量导入');
  {
    const d = await S(`
      Settings.initRules();
      const all = Store.list('quant_rules');
      const cls = all.filter(r => (r.key || '').indexOf('cls:') === 0);
      const by = k => cls.filter(r => r.cat === k);
      const g = key => cls.find(r => r.key === key) || {};
      return {
        total: all.length, clsN: cls.length,
        att: by('att').length, disc: by('disc').length, exam: by('exam').length, env: by('env').length, reward: by('reward').length,
        late: { label: g('cls:late').label, delta: g('cls:late').delta, type: g('cls:late').type, cap: g('cls:late').capMin, capD: g('cls:late').capDelta, scope: g('cls:late').scope },
        full: { d: g('cls:fullAtt').delta, s: g('cls:fullAtt').scope },
        miss: { d: g('cls:examMiss').delta, s: g('cls:examMiss').scope },
        noteBad: g('cls:noteBad').delta, printMiss: g('cls:printMiss').delta, safeMiss: g('cls:safeMiss').delta,
        week: [g('cls:weekTop').delta, g('cls:weekLast').delta],
        interact: g('cls:interact').range, evalPass: g('cls:evalPass').range, evalLazy: g('cls:evalLazy').range,
      };`);
    ok(d.clsN === 25, `班级级细则 25 条（实际 ${d.clsN}）`);
    ok(d.att === 4 && d.disc === 9 && d.exam === 3 && d.env === 7 && d.reward === 2,
      `分类齐全：考勤 ${d.att} / 课堂纪律 ${d.disc} / 模考 ${d.exam} / 学习环境 ${d.env} / 奖惩 ${d.reward}`);
    ok(d.late.type === 'min' && d.late.delta === -2 && d.late.cap === 10 && d.late.capD === -20 && d.late.scope === 'stu',
      `迟到 = 按分钟（2 分/分钟，满 10 分钟 20 分，个人级）：${JSON.stringify(d.late)}`);
    ok(d.full.d === 30 && d.full.s === 'cls', '全勤奖励 30 分（班级级）');
    ok(d.miss.d === -20 && d.miss.s === 'stu', '模考缺考 −20（个人级）');
    ok(d.noteBad === -20 && d.printMiss === -20 && d.safeMiss === -10, '笔记未达标 −20 / 稿件未打印 −20 / 安全遗漏 −10');
    ok(d.week[0] === 0 && d.week[1] === 0, '奖惩两条只做记录、不计分');
    ok(JSON.stringify(d.interact) === '[1,10]' && JSON.stringify(d.evalPass) === '[10,20]' && JSON.stringify(d.evalLazy) === '[-20,-10]',
      `区间项原样保留：互动 ${d.interact} · 集体通关 ${d.evalPass} · 消极 ${d.evalLazy}`);

    /* 规则页按分类分组渲染 */
    await S(`App.go('rules'); return 1;`);
    await sleep(500);
    const html = await S(`
      const el = document.getElementById('rulesList');
      return el ? el.textContent.replace(/\\s+/g, ' ') : '';`);
    ok(/考勤（4 条）/.test(html) && /课堂纪律（9 条）/.test(html) && /模考（3 条）/.test(html)
      && /学习环境（7 条）/.test(html) && /奖惩（2 条）/.test(html), '细则页按五个分类分组显示');
    ok(/每班每周起始 100 分/.test(html), '页头写着总则（每周起始 100 分）');
    ok(/按分钟/.test(html) && /区间 1~10/.test(html), '「按分钟 / 区间」标签渲染出来');
  }

  /* ═══ E JS 异常 ═══ */
  console.log('\nE 页面异常');
  ok(cdp.errs.length === 0, `全程无 JS 异常${cdp.errs.length ? '：' + cdp.errs[0] : ''}`);

  console.log(`\n${fail ? '❌' : '✅'} 结果：通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('💥', e.message);
  process.exitCode = 2;
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { server && server.kill(); } catch {}
}
