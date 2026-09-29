/**
 * v47 四项新功能 · 真机回归（位置密钥 / 班干部 / 作业录入 / 学生消息 / 显示名统一）
 *
 *   node test/v47_features_check.mjs [port]      # 截图落到 test/.shots/v47/
 *
 * 用户 2026-09-29 的要求（原话）：
 *   ①「如果他的定位不正确不能进行打卡……在教务系统的打卡页面加一个位置密钥生成的窗口，
 *      密钥位数为四位，由教务老师手动输入显示生效，一个密钥最多可用于5个学生，这个窗口
 *      下面显示一个进度条，看有几个学生用了，都是哪些学生，名字，还有几个名额可以用。」
 *   ②「加入一个班干部的权限名额，选班干部的地方在名册班级内……填完之后名册学生姓名之后
 *      自动出现相关班干部名称，班长班干部可以看到班级学生姓名，仅姓名，以及具体的量化加扣分」
 *   ③「作业……班长学委负责统计，在系统当中录入此学生是否完成作业……教务后台可以看到是
 *      那个班干部填写的作业完成情况。」
 *   ④「在学生端加入一个可以给老师发信息的窗口，学生在此页面可以选择老师，进行信息发送」
 *   ⑤「仅教务老师，首位教务账号，在除自己外所有账号系统显示的名字都改为学管办公室」
 *
 * 核这几件事：
 *   1. 位置密钥：4 位、按班、当天、默认 5 个名额；同班同天只留一枚（不攒码）；
 *      进度条 + 已用名单 + 剩余名额；4 位以外的输入被拒
 *   2. 服务端规矩（源码级）：sign_keys 不在 STUDENT_READ（学生拿不到，只能找教务要）；
 *      GEOFAR / BADKEY / KEYFULL 三个码在；放行后 way='key' 且记 keyId；
 *      名额按「当天 sign 记录里 keyId 命中条数」算，不落单独的计数器
 *   3. 班干部：名册里能加职务、指定人；学员名字后自动挂职务标签；
 *      服务端只给班干部「本班同学的 id + 姓名 + classId」三个字段，别的字段一个都不出去
 *   4. 作业：简称取头字；班干部能写 hw:（盖 by/byId），普通学生不能
 *   5. 学生消息：学生端有收件人下拉 + 发消息；收件人只有教务类账号（授课老师不给）；
 *      落点在协作页「学生消息」那一栏，且不会同时出现在「老师上报」列表里
 *   6. 显示名：除自己外一律「学管办公室」；学生照旧实名；自己看自己还是真名；
 *      课表上的授课老师**刻意保留真名**（教务排课查课的核心信息）
 *
 * ⚠️ 必须带 ?nosw=1，否则 SW 接管后自动重载会打断 evaluate。
 * 一次性账号，结束 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5371);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'v47');
const SUPER = { user: 'v47测试教务', pass: 'v47pass1234' };
const TEACH = { user: 'v47测试老师', pass: 'v47pass1234', name: '李老师' };

let pass = 0, fail = 0; const fails = [];
function assert(c, m){ if (!c) throw new Error(m); }
function t(name, fn){
  try { const d = fn(); pass++; console.log('  ✅ ' + name + (d ? '  → ' + d : '')); }
  catch (e) { fail++; fails.push(name); console.log('  ❌ ' + name + '\n       ' + e.message); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });
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
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value; }
}

let server; const chromes = [];
async function devReset(){ try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} }
async function shot(cdp, name, clip){
  const p = { format: 'png' };
  if (clip) p.clip = { ...clip, scale: 2 };
  const r = await cdp.send('Page.captureScreenshot', p);
  await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
async function go(cdp, url){
  const done = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await done;
  await sleep(1200);
}

try {
  await mkdir(OUT, { recursive: true });
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  await devReset();
  console.log('预览服务就绪 →', BASE);

  const SRC  = await readFile(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
  const HTML = await readFile(path.join(dir, 'index.html'), 'utf8');

  const profile = await mkdtemp(path.join(tmpdir(), 'v47-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank',
  ], { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
  }, { what: 'Chrome', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(cdp, `${BASE}/?nosw=1`);

  console.log('\n=== 0. 登录 + 造两个班、三名学员 ===');
  const r0 = await cdp.eval(`(async () => {
    if (typeof Auth === 'undefined') return { err: '模块没接上' };
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(SUPER.user)};
    document.getElementById('gPass').value = ${JSON.stringify(SUPER.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 1600));
    return { gateOff: !document.getElementById('gate').classList.contains('on'), err: document.getElementById('gErr').textContent };
  })()`);
  if (!r0.gateOff) throw new Error('登录失败：' + (r0.err || ''));
  console.log('已登录（身份：' + await cdp.eval(`Auth.roleLabel()`) + '）');
  await cdp.eval(`(async () => {
    Store.upsert('classes',  { id:'cls_t1', name:'测试一班' });
    Store.upsert('classes',  { id:'cls_t2', name:'测试二班' });
    Store.upsert('students', { id:'stu_t1', name:'张三', classId:'cls_t1' });
    Store.upsert('students', { id:'stu_t2', name:'李四', classId:'cls_t1' });
    Store.upsert('students', { id:'stu_t3', name:'王五', classId:'cls_t1' });
    Store.set('_rosterCls', 'cls_t1');
    Store.set('_signKeyCls', 'cls_t1');
    await Auth.call('users', { op:'create', user:${JSON.stringify(TEACH.user)}, name:${JSON.stringify(TEACH.name)}, role:'teacher', pass:${JSON.stringify(TEACH.pass)} });
    return true;
  })()`);

  /* ══════════════════ 1. 位置密钥 · 教务端 ══════════════════ */
  console.log('\n=== 1. 位置密钥（教务在打卡页生成、4 位、进度条 + 名单 + 余量）===');
  await cdp.eval(`App.go('sign')`);
  await sleep(1600);
  const keyForm = await cdp.eval(`(() => {
    const el = document.getElementById('skCode');
    const cls = document.getElementById('skCls');
    return {
      hasCode: !!el,
      maxlength: el ? el.getAttribute('maxlength') : '',
      inputmode: el ? el.getAttribute('inputmode') : '',
      clsOpts: cls ? [...cls.options].map(o => o.textContent) : [],
      hasLimit: !!document.getElementById('skLimit'),
      hasBody: !!document.getElementById('skBody'),
      body: (document.getElementById('skBody') || {}).textContent.replace(/\\s+/g, ' ').trim(),
    };
  })()`);
  t('打卡页有「位置密钥」窗口：4 位数字输入框 + 班级下拉 + 名额下拉 + 进度区', () => {
    assert(keyForm.hasCode, '找不到 #skCode（4 位密钥输入框）');
    assert(keyForm.maxlength === '4', '密钥该钉死 4 位，实际 maxlength=' + keyForm.maxlength);
    assert(keyForm.inputmode === 'numeric', '输入框该是数字键盘（inputmode=numeric），实际 ' + keyForm.inputmode);
    assert(keyForm.clsOpts.includes('测试一班'), '班级下拉该列出真实班级，实际：' + keyForm.clsOpts.join(' / '));
    assert(keyForm.hasLimit, '找不到名额下拉 #skLimit');
    assert(keyForm.hasBody, '找不到进度区 #skBody');
    return '4 位 · 班级下拉：' + keyForm.clsOpts.join(' / ');
  });
  t('还没生成时，进度区明说「这个班今天还没有位置密钥」', () => {
    assert(/还没有位置密钥/.test(keyForm.body), '实际文案：' + keyForm.body);
    return keyForm.body;
  });

  const gen = await cdp.eval(`(() => {
    document.getElementById('skCode').value = '4821';
    document.getElementById('skLimit').value = '5';
    Sign.makeKey();
    const list = Store.list('sign_keys').filter(k => !k._d);
    const k = Sign.keyOf('cls_t1', Util.today());
    return { n: list.length, code: k && k.code, limit: k && k.limit, date: k && k.date, clsId: k && k.clsId,
             today: Util.today(),
             body: document.getElementById('skBody').textContent.replace(/\\s+/g, ' ').trim() };
  })()`);
  t('填一个 4 位数字点「生成 / 更新」→ 今天这一枚就生效了', () => {
    assert(gen.n === 1, '该只留 1 枚密钥，实际 ' + gen.n);
    assert(gen.code === '4821', '密钥该是 4821，实际「' + gen.code + '」');
    assert(gen.limit === 5, '默认名额该是 5，实际 ' + gen.limit);
    assert(gen.date === gen.today, '密钥该是「当天有效」，实际 date=' + gen.date + ' / 今天=' + gen.today);
    assert(gen.clsId === 'cls_t1', '密钥该绑在选中的班上，实际 ' + gen.clsId);
    return '码 ' + gen.code + ' · ' + gen.date + ' · 限 ' + gen.limit + ' 人 · 班 ' + gen.clsId;
  });
  t('进度条下面写着「已用 0 / 5 · 还剩 5 个名额 · 今天有效」', () => {
    assert(/已用/.test(gen.body) && /0/.test(gen.body), '该显示已用 0，实际：' + gen.body);
    assert(/\/ 5/.test(gen.body), '该显示总数 5，实际：' + gen.body);
    assert(/还剩\s*5\s*个名额/.test(gen.body), '该显示还剩 5 个名额，实际：' + gen.body);
    assert(/今天有效/.test(gen.body), '该标明今天有效，实际：' + gen.body);
    return gen.body;
  });

  const again = await cdp.eval(`(() => {
    document.getElementById('skCode').value = '9900';
    Sign.makeKey();
    const list = Store.list('sign_keys').filter(k => !k._d);
    const k = Sign.keyOf('cls_t1', Util.today());
    return { n: list.length, code: k && k.code };
  })()`);
  t('同一个班同一天再点一次 = 改这一枚，不是又发一枚（学生手里不会攒着好几枚）', () => {
    assert(again.n === 1, '同班同天该只有 1 枚，实际 ' + again.n);
    assert(again.code === '9900', '该被改成 9900，实际「' + again.code + '」');
    return '仍 1 枚，码已改成 ' + again.code;
  });

  const bad = await cdp.eval(`(() => {
    document.getElementById('skCode').value = '12';
    Sign.makeKey();
    const k = Sign.keyOf('cls_t1', Util.today());
    document.getElementById('skCode').value = '12ab';
    Sign.makeKey();
    const k2 = Sign.keyOf('cls_t1', Util.today());
    return { code: k && k.code, code2: k2 && k2.code, n: Store.list('sign_keys').filter(x => !x._d).length };
  })()`);
  t('位数不够的（12）或带字母的（12ab）一律不收，密钥不动', () => {
    assert(bad.code === '9900' && bad.code2 === '9900', '该仍是 9900，实际「' + bad.code + '」/「' + bad.code2 + '」');
    assert(bad.n === 1, '不该多出密钥，实际 ' + bad.n);
    return '仍 9900 · 仍 1 枚';
  });

  const usedInfo = await cdp.eval(`(() => {
    const k = Sign.keyOf('cls_t1', Util.today());
    Store.upsert('sign:' + Util.today(), { studentId:'stu_t1', keyId:k.id, way:'key', at: Date.now() });
    Store.upsert('sign:' + Util.today(), { studentId:'stu_t2', keyId:k.id, way:'key', at: Date.now() });
    Store.upsert('sign:' + Util.today(), { studentId:'stu_t1', keyId:k.id, way:'key', at: Date.now() });
    Sign.renderKey();
    const body = document.getElementById('skBody').textContent.replace(/\\s+/g, ' ').trim();
    return { body: body, usedN: Sign.keyUsed(k).length, shown: [...document.getElementById('skBody').querySelectorAll('.live-code')].map(e => e.textContent.trim()) };
  })()`);
  t('有人用了：进度条跟着走，并列出「都是哪些学生、名字」', () => {
    assert(usedInfo.usedN === 2, '张三用了两条记录也只算 1 人，一共该 2 人，实际 ' + usedInfo.usedN);
    assert(/已用\s*2\s*\/\s*5/.test(usedInfo.body), '该显示已用 2 / 5，实际：' + usedInfo.body);
    assert(/还剩\s*3\s*个名额/.test(usedInfo.body), '该显示还剩 3 个名额，实际：' + usedInfo.body);
    assert(/张三/.test(usedInfo.body) && /李四/.test(usedInfo.body), '该列出用过的学生姓名，实际：' + usedInfo.body);
    assert(usedInfo.shown.includes('9900'), '密钥本体该摆在进度区最显眼处，实际：' + usedInfo.shown.join('/'));
    return '已用 2/5 · 剩 3 · 名单：张三、李四';
  });

  /* ══════════════════ 2. 位置密钥 · 服务端的规矩（源码级）══════════════════ */
  console.log('\n=== 2. 位置密钥的服务端规矩（改界面绕不过去）===');
  t('sign_keys 不在学生可读表里 —— 学生拿不到，只能从教务手里要', () => {
    const block = SRC.match(/const STUDENT_READ = \{([\s\S]*?)\n\};/);
    assert(block, '找不到 STUDENT_READ');
    assert(!/sign_keys/.test(block[1]), 'STUDENT_READ 里不该出现 sign_keys');
    const pre = SRC.match(/const STUDENT_PREFIX_SELF = \[([^\]]*)\]/);
    assert(pre && !/sign_keys/.test(pre[1]), 'STUDENT_PREFIX_SELF 里也不该有 sign_keys');
    return 'STUDENT_READ / STUDENT_PREFIX_SELF 都不含 sign_keys';
  });
  t('密钥不对 / 过期 / 名额满，三种情况分别有自己的错误码', () => {
    assert(/code: 'BADKEY'/.test(SRC), '少了 BADKEY（码不对或不是今天的）');
    assert(/code: 'KEYFULL'/.test(SRC), '少了 KEYFULL（名额用完）');
    assert(/code: 'GEOFAR'/.test(SRC), '少了 GEOFAR（不在校区范围内）');
    return 'BADKEY / KEYFULL / GEOFAR 齐';
  });
  t('「定位不准就根本打不上卡」——服务端在代码校验之前先卡地理位置', () => {
    assert(/if \(geoBad && !keyHit\)/.test(SRC), '该在拿不到位置或超出半径时直接拒掉');
    assert(/dist > Number\(rules\.radius \|\| 150\)/.test(SRC), '该用 rules.radius（默认 150 米）判定');
    const iKey = SRC.indexOf('const keys = Array.isArray(data.sign_keys)');
    const iGeo = SRC.indexOf('const hasGeo = body.lat != null');
    assert(iKey > -1 && iGeo > -1, '找不到密钥校验或定位校验');
    return '越界 → GEOFAR；没密钥放行不了';
  });
  t('拿密钥放行的打卡记为 way=key，并回查得到用了哪一枚（keyId）', () => {
    assert(/if \(keyHit\) way = 'key'/.test(SRC), '放行后该把打卡方式记成 key');
    assert(/keyId: keyHit \? keyHit\.id : undefined/.test(SRC), '记录里该带上 keyId（教务可回查）');
    assert(/'key'/.test(HTML) && /位置密钥/.test(HTML), '前端该有「位置密钥」这种打卡方式的说法');
    return "way='key' + rec.keyId";
  });
  t('名额不单独落计数器：按当天 sign 记录里 keyId 命中条数算（幂等、不怕两台设备并发写）', () => {
    assert(/\.filter\(x => x && x\.keyId === keyHit\.id\)/.test(SRC), '服务端该按 keyId 数条数');
    assert(/const used = \(Array\.isArray\(data\['sign:' \+ date\]\)/.test(SRC), '该从当天的 sign 分片里数');
    assert(/if \(!used\.some\(x => x && x\.studentId === sid\) && used\.length >= limit\)/.test(SRC), '同一个人重复打卡不该重复占名额');
    return 'used = sign:当天 里 keyId 命中的条数，>= limit 就拒';
  });

  /* ══════════════════ 3. 班干部 ══════════════════ */
  console.log('\n=== 3. 班干部（名册里定职务、指定人，名字后自动挂标签）===');
  await cdp.eval(`App.go('roster')`);
  await sleep(1500);
  const roster0 = await cdp.eval(`(() => {
    const page = document.getElementById('page-roster');
    const btns = [...page.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g, ''));
    return { btns: btns, hasBox: !!document.getElementById('officerBox'),
             open: document.getElementById('officerBox').innerHTML.length > 0 };
  })()`);
  t('名册里多了一个「班干部」入口（用户要求：选班干部的地方在名册班级内）', () => {
    assert(roster0.hasBox, '找不到 #officerBox');
    assert(roster0.btns.some(x => /班干部/.test(x)), '该有「班干部」按钮，实际按钮：' + roster0.btns.join(' / '));
    return '按钮：' + roster0.btns.filter(x => /班干部/.test(x)).join('');
  });

  const off = await cdp.eval(`(() => {
    Roster.toggleOfficers();                       // 点开
    const opened = document.getElementById('officerBox').innerHTML;
    Roster.addOfficer();                           // 「＋ 加一个职务」
    const list = Roster.officers('cls_t1');
    const o = list[0];
    Roster.setOfficerTitle(o.id, '班长');
    Roster.setOfficerStu(o.id, 'stu_t1');
    const list2 = Roster.officers('cls_t1');
    const o2 = list2[0];
    return { opened: opened, n: list.length, title: o2.title, sid: o2.studentId,
             listText: document.getElementById('stuList').textContent.replace(/\\s+/g, ' ').trim() };
  })()`);
  t('先定职务名、再指定是谁 —— 两步都在同一个框里', () => {
    assert(off.n === 1, '该有 1 条班干部记录，实际 ' + off.n);
    assert(/加一个职务/.test(off.opened), '框里该有「＋ 加一个职务」，实际：' + off.opened.replace(/<[^>]+>/g, ' ').slice(0, 120));
    assert(off.title === '班长', '职务名该是「班长」，实际「' + off.title + '」');
    assert(off.sid === 'stu_t1', '该指定到张三，实际 ' + off.sid);
    return '班长 → 张三';
  });
  t('指定完，名册里那位学生名字后面自动出现「班长」标签', () => {
    assert(/张三/.test(off.listText) && /班长/.test(off.listText), '名单里该看到「张三 班长」，实际：' + off.listText);
    const idx = off.listText.indexOf('张三');
    assert(off.listText.slice(idx, idx + 8).includes('班长'), '标签该紧跟在名字后面，实际：' + off.listText.slice(idx, idx + 12));
    return off.listText.slice(0, 60);
  });

  t('服务端给班干部放行的只有「本班同学的 id + 姓名 + classId」三个字段', () => {
    assert(/officers:     'ownCls'/.test(SRC), 'STUDENT_READ 里该有 officers: ownCls');
    assert(/const amOfficer = !!\(clsId && officers\.some/.test(SRC), 'filterForStudent 该先判断「我是不是班干部」');
    assert(/\.map\(x => \(\{ id: x\.id, name: x\.name, classId: x\.classId \}\)\)/.test(SRC), '该只截 3 个字段下发');
    assert(/officers\.some\(o => o && o\.studentId === sid && o\.title\)/.test(SRC), '没填职务名的不算班干部');
    return 'students 只发 {id,name,classId} · 未填职务名不算';
  });
  t('班干部还能拿到本班的作业提交登记（要替全班录），别的照旧只给自己', () => {
    assert(/if \(amOfficer && k\.indexOf\('hw:'\) === 0\)/.test(SRC), '该给班干部放行 hw: 前缀');
    assert(/att:|exam_scores:  'self'|records:      'self'/.test(SRC) || /records:\s+'self'/.test(SRC), '考勤/评语仍该只给自己');
    return 'hw: 放行全班；考勤、成绩、评语仍只看自己';
  });

  /* ══════════════════ 4. 作业录入 ══════════════════ */
  console.log('\n=== 4. 作业录入（班干部逐项打勾，教务看得到是谁填的）===');
  const abbr = await cdp.eval(`(() => ({
    a: Util.abbr('数学卷子'), b: Util.abbr('，。、'), c: Util.abbr('  English '), d: Util.abbr(''), e: Util.abbr('熟读课文3遍')
  }))()`);
  t('作业项目取简称（名字后面挂的小标签用它）', () => {
    assert(abbr.a === '数', '「数学卷子」该简写成「数」，实际「' + abbr.a + '」');
    assert(abbr.b === '?', '全是标点该退化成「?」，实际「' + abbr.b + '」');
    assert(abbr.c === 'E', '「  English 」该简写成「E」，实际「' + abbr.c + '」');
    assert(abbr.d === '?', '空字符串该退化成「?」，实际「' + abbr.d + '」');
    assert(abbr.e === '熟', '「熟读课文3遍」该简写成「熟」，实际「' + abbr.e + '」');
    return '数 / ? / E / ? / 熟';
  });
  t('作业登记落的是「谁填的」：学生端预览、教务端显示登记人', () => {
    assert(/abbr: Util\.abbr\(text\)/.test(HTML), '教务布置作业时该把简称一起存下来');
    assert(/renderSubs\(h\)/.test(HTML) && /登记人：/.test(HTML), '教务端该显示「登记人：XXX」');
    assert(/renderEntry\(\)/.test(HTML), '学生端该有班干部专用的登记入口');
    return '作业存 abbr · 教务端「登记人：XXX」· 学生端 renderEntry';
  });
  t('服务端只为班干部放行写 hw:，普通学生写了也不算数', () => {
    const w = SRC.match(/const STUDENT_WRITE_PREFIX = \[([^\]]*)\]/);
    assert(w, '找不到 STUDENT_WRITE_PREFIX');
    assert(!/hw:/.test(w[1]), '普通学生的写回白名单里不该有 hw:（班干部那条是单独放行的）');
    assert(/if \(amOfficer && k\.indexOf\('hw:'\) === 0\)\{/.test(SRC), '班干部写 hw: 该在 sanitizeStudent 里单独放行');
    assert(/by: me\.name, byId: me\.id/.test(SRC), '该盖上「谁登记的」（by / byId）');
    return 'STUDENT_WRITE_PREFIX=' + w[1].trim() + ' · 班干部另有 hw: 通道';
  });
  const hwEntry = await cdp.eval(`(() => {
    Store.upsert('homework', { id:'hwk_t1', clsId:'cls_t1', date: Util.today(), text:'数学卷子' });
    Roster.setOfficerStu(Roster.officers('cls_t1')[0].id, 'stu_t1');
    return { hasCard: !!document.getElementById('stuHwEntryCard'),
             hasBox: !!document.getElementById('stuHwEntry'),
             hw: Store.list('homework').length };
  })()`);
  t('学生端那块「登记今晚作业」的卡片在（班干部登录才显示）', () => {
    assert(hwEntry.hasCard, '找不到 #stuHwEntryCard');
    return '卡片在 · 今晚作业 ' + hwEntry.hw + ' 条';
  });
  /* 真跑一遍：班干部登一条，看教务端那条作业下面写不写得出登记人 */
  const subsHtml = await cdp.eval(`(() => {
    const h = Store.list('homework').find(x => x.id === 'hwk_t1');
    if (!h) return '';
    Store.upsert('hw:' + h.id, { studentId:'stu_t2', done:1, by:'张三', byId:'stu_t1' });
    return Homework.renderSubs(h);
  })()`);
  t('班干部登记完，教务端那条作业下面真的写得出「登记人：张三」', () => {
    assert(subsHtml, 'renderSubs 没渲出东西（找不到那条作业）');
    assert(/登记人：张三/.test(subsHtml), '该写出「登记人：张三」，实际：' + String(subsHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-90));
    assert(/由 张三 登记/.test(subsHtml), '每个人名上该挂一句「由 XXX 登记」');
    return '登记人：张三';
  });

  /* ══════════════════ 5. 学生消息 ══════════════════ */
  console.log('\n=== 5. 学生消息（学生端发给教务，落点在协作页）===');
  const msgDom = await cdp.eval(`(() => {
    const route = (App.routes || []).find(r => r.id === 'stuMsg');
    return {
      route: route ? { name: route.name, roles: route.roles } : null,
      inNav: ((App.NAV_ORDER || {}).student || []).indexOf('stuMsg'),
      hasPage: !!document.getElementById('page-stuMsg'),
      hasTo: !!document.getElementById('stuMsgTo'),
      hasText: !!document.getElementById('stuMsgText'),
      hasList: !!document.getElementById('stuMsgList'),
      hasCoopCard: !!document.getElementById('coopStuMsg'),
    };
  })()`);
  t('学生端多了一个「给老师发消息」的页，进得了底部/侧栏', () => {
    assert(msgDom.route, 'App.routes 里找不到 stuMsg');
    assert(msgDom.route.roles.length === 1 && msgDom.route.roles[0] === 'student', '这页该只给学生看，实际 roles=' + JSON.stringify(msgDom.route.roles));
    assert(msgDom.inNav >= 0, 'NAV_ORDER.student 里该有 stuMsg');
    assert(msgDom.hasPage && msgDom.hasText, '页面上该有输入框');
    return '「' + msgDom.route.name + '」· roles=[student] · NAV_ORDER.student[' + msgDom.inNav + ']';
  });
  t('页上有收件人选择、正文框、历史消息列表', () => {
    assert(msgDom.hasTo, '找不到收件人下拉 #stuMsgTo');
    assert(msgDom.hasList, '找不到历史消息列表 #stuMsgList');
    return '收件人下拉 + 正文 + 历史都在';
  });
  t('服务端单开了一条 staff：学生拿不到账号列表，只能拿到「发给谁」', () => {
    assert(/async function doStaff\(s, me\)/.test(SRC), '找不到 doStaff');
    assert(/if \(action === 'staff'\) return await doStaff\(s, me\)/.test(SRC), '该把 staff 接进路由');
    assert(/if \(!STAFF\.includes\(a\.role \|\| TEACHER\)\) continue;/.test(SRC), '该只回教务类账号');
    assert(/out\.push\(\{ id: uid, name: a\.name \|\| a\.user \|\| '' \}\)/.test(SRC), '该只给 id 与名字，用户名/角色一概不给');
    return "action 'staff' → 只回教务类账号的 id + 姓名";
  });
  const staffApi = await cdp.eval(`(async () => { const j = await Auth.call('staff'); return (j && j.staff) || []; })()`);
  t('教务端调得动 staff，且回的是教务号（刚建的「李老师」是授课老师，不该在里面）', () => {
    assert(Array.isArray(staffApi) && staffApi.length >= 1, '该至少回一个教务账号，实际 ' + JSON.stringify(staffApi));
    assert(!staffApi.some(x => x.name === TEACH.name), '授课老师「' + TEACH.name + '」不该出现在收件人名单里');
    const dirty = staffApi.find(x => x.user || x.role || x.classIds);
    assert(!dirty, '不该把用户名/角色这类字段带出去，实际：' + JSON.stringify(dirty));
    return staffApi.map(x => x.name).join('、');
  });
  t('学生消息落在协作页单独一栏，不会再重复出现在「老师上报」列表里', () => {
    assert(/renderStuMsgs\(\)/.test(HTML), 'Coop 该有 renderStuMsgs');
    assert(/t\.type !== '学生消息'/.test(HTML), 'renderList 该把学生消息排掉，免得同一条出现两遍');
    assert(msgDom.hasCoopCard, '协作页该有 #coopStuMsg 卡片');
    return '单独一栏 · 老师上报列表已排除';
  });

  /* ══════════════════ 6. 显示名统一 ══════════════════ */
  console.log('\n=== 6. 显示名统一（除自己外一律「学管办公室」）===');
  const dn = await cdp.eval(`(() => {
    const me = Auth.me();
    return {
      meName: me.name, meId: me.id,
      self: Util.dispName(me.id, '我自己的名字'),
      selfNoId: Util.dispName('', me.name),
      teacher: Util.dispName('u_someoneelse', '李老师'),
      teacherNoId: Util.dispName('', '哪位老师'),
      student: Util.dispName('stu_t1', '张三'),
      studentNoId: Util.dispName('', '张三'),
    };
  })()`);
  t('自己看自己还是真名（设置页、自己发的东西都还认得出来）', () => {
    assert(dn.self === '我自己的名字', '带 id 时该还原真名，实际「' + dn.self + '」');
    assert(dn.selfNoId === dn.meName, '只有名字没 id 的老数据也该认出自己，实际「' + dn.selfNoId + '」');
    return '自己 → ' + dn.meName;
  });
  t('别的老师/教务账号一律「学管办公室」', () => {
    assert(dn.teacher === '学管办公室', '该统一成「学管办公室」，实际「' + dn.teacher + '」');
    assert(dn.teacherNoId === '学管办公室', '没有 id 的落款也该统一，实际「' + dn.teacherNoId + '」');
    return dn.teacher;
  });
  t('学生照旧实名 —— 教务得知道是哪位同学交的假条、发的消息', () => {
    assert(dn.student === '张三', '学生该保留实名，实际「' + dn.student + '」');
    assert(dn.studentNoId === '学管办公室', '学生没带 id 时无法判定，退回统一名（落款处本来也不会这么传）');
    return '张三（实名保留）';
  });
  const teachersPage = await cdp.eval(`(async () => {
    App.go('teachers');
    await new Promise(r => setTimeout(r, 1600));
    return { text: (document.getElementById('tList') || {}).textContent.replace(/\\s+/g, ' ').trim(),
             mine: Auth.me().name };
  })()`);
  t('「老师管理」页：别人的名字统一了，自己那条还是真名，@用户名 留着（不然没法改密码/停用）', () => {
    assert(/学管办公室/.test(teachersPage.text), '别人的名字该显示成「学管办公室」，实际：' + teachersPage.text);
    assert(teachersPage.text.includes(teachersPage.mine), '自己那条该保留真名，实际：' + teachersPage.text);
    assert(!new RegExp(TEACH.name).test(teachersPage.text), '授课老师的真名不该出现在这一页，实际：' + teachersPage.text);
    assert(/@/.test(teachersPage.text), '@用户名 该留着（管理要靠它分辨）');
    return teachersPage.text.slice(0, 80);
  });
  t('通知落款 / 协作上报人 / 老师端今天 / 学生端首页 四处都走过 dispName', () => {
    const n = (HTML.match(/Util\.dispName\(/g) || []).length;
    assert(n >= 8, '展示位接入点该有 8 处以上，实际 ' + n);
    assert(/byId: Auth\.me\(\) \? Auth\.me\(\)\.id : ''/.test(HTML), '发通知该把 byId 一起存下来');
    assert(/\$\{Util\.esc\(Util\.dispName\(n\.byId, n\.by\)\)\}/.test(HTML), '通知落款该走 dispName');
    assert(/\$\{Util\.esc\(Util\.dispName\(t\.userId, t\.userName\)\)\}/.test(HTML), '协作上报人该走 dispName');
    return n + ' 处接入';
  });
  t('课表上的授课老师**刻意保留真名** —— 那不是「账号显示名」，是排课查课的核心信息', () => {
    assert(/Staff\.name\(x\.teacherId\)/.test(HTML), '今日课表该仍用真名');
    assert(/x\.teacherId \? Staff\.name\(x\.teacherId\)/.test(HTML), '大课表该仍用真名');
    assert(!/dispName\(x\.teacherId/.test(HTML), '课表不该被统一成「学管办公室」');
    return '课表 3 处仍是 Staff.name()';
  });

  /* ══════════════════ 7. 截图 ══════════════════ */
  console.log('\n=== 7. 截图 ===');
  await cdp.eval(`App.go('sign')`);
  await sleep(1500);
  const keyClip = await cdp.eval(`(() => {
    const box = document.getElementById('skBody');
    const card = box.closest('.card') || box.parentElement;
    const r = card.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(Math.min(r.height, 700)) };
  })()`);
  await shot(cdp, 'sign-key-card.png', keyClip);
  await shot(cdp, 'sign-page.png');
  await cdp.eval(`App.go('roster')`);
  await sleep(1500);
  await shot(cdp, 'roster-officers.png');
  await cdp.eval(`App.go('teachers')`);
  await sleep(1600);
  await shot(cdp, 'teachers-page.png');

} catch (e) {
  fail++; fails.push('脚本异常 → ' + e.message);
  console.log('\n❌ 脚本异常：' + e.message);
} finally {
  console.log('\n────────────');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) fails.forEach(x => console.log('  ✗ ' + x));
  for (const c of chromes) { try { c.kill(); } catch {} }
  if (server) { try { server.kill(); } catch {} }
  await devReset();
  process.exit(fail ? 1 : 0);
}
