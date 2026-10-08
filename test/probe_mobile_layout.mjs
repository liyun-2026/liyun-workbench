/**
 * 手机端版面度量探针 —— 不截图，只报数。
 * 用来搞清楚「整页到底多高、谁在滚、哪个元素超出视口」这类只能问浏览器的问题。
 *
 *   node test/probe_mobile_layout.mjs [端口] [dumpId] [dumpDepth]
 *
 * 位置参数保持原样；下面是可选开关（任意位置）：
 *   --width=390            量哪个宽度（默认 390；≥1100 自动当桌面量，高 900、dsf 1）
 *   --role=super|teacher|student   换账号登进去量（默认 super）
 *   --pages=home,att       只量这几页（默认按角色取全量）
 *   --mobile=0             关掉移动仿真 —— 做「桌面回归」对比时用
 *   --json=/path/out.json  把原始结果落盘，方便跟另一轮逐字段 diff
 *
 * ⚠️ 默认页集：**不带 --pages 时按角色取全量**（super 18 页 / teacher 7 页 / student 11 页）。
 *    早先版本写死 7 页，所以「不传参数＝原行为」这句对现在不成立 —— 要那 7 页请显式传 --pages。
 * 🔴 任何一页量失败（页面抛错、选择器没了）都会在最下面汇总报错并 **exit 1**。
 *    这一条是刻意的：探针最危险的失效方式是「悄悄返回一串 0」，
 *    读的人会以为「没有溢出」——而那正是它该抓的东西。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 位置参数：[端口] [dumpId] [dumpDepth]（保持原样）
   可选开关（任意位置，向后兼容）：--width=390 / --pages=a,b / --role=super|teacher|student / --json=/path/out.json */
const POS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const FLAGS = process.argv.slice(2).filter(a => a.startsWith('--'));
const flag = (name, def) => { const hit = FLAGS.find(a => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : def; };
const WIDTH = Number(flag('width', 390));
const ROLE = String(flag('role', 'super'));
/* --mobile=0 用来做「桌面回归」：关掉移动仿真，按真正的桌面视口量 */
const MOBILE = String(flag('mobile', '1')) !== '0';
const PAGES_FLAG = String(flag('pages', '')).split(',').filter(Boolean);
const JSON_OUT = flag('json', '');
/* 视口高度按宽度配套：≥1100→桌面，390→iPhone 14/15，360→常见安卓，320→iPhone SE 一代 */
const HEIGHT = WIDTH >= 1100 ? 900 : WIDTH >= 390 ? 844 : WIDTH >= 360 ? 800 : 568;
const PORT = Number(POS[0] || 5351);
const DEBUG_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUPER = { user: '李老师', pass: 'liyun2026' };

/* 各角色可见的路由（取自 App.routes 的 roles + NAV_ORDER）。
   super 这里列全教务端的页；rules / board / students / health 不进导航但能 App.go 进去。 */
const ROLE_PAGES = {
  super: [
    'home','att','sign','homework','roster','students','profile','timetable','hours','night',
    'quant','exam','coop','gather','teachers','rules','board','health','settings',
  ],
  teacher: ['today','news','record','myclass','profile','tickets','settings'],
  student: ['stuHome','stuGather','stuSign','stuNews','stuTable','stuExam','stuQuant','stuProfile','stuHw','stuMsg','settings'],
};
const DEFAULT_PAGES = ['home','att','roster','homework','settings','quant','timetable'];
/* 非 super 角色登录用的账号（探针 seed 段已建好：张伟=授课老师带集训班，王梓涵=学生挂砺蕴一班） */
const ROLE_CRED = { teacher: { user: '张伟', pass: 'liyun2026' }, student: { user: '王梓涵', pass: 'liyun2026' } };
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
  async eval(expr, timeout = 90000){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  /* ⚠️ 必须先清空预览数据再登录。
     这个探针靠「第一个注册的账号就是首位教务」，而 test/.preview-data.json 是**会留存的**
     （上一个跑过的脚本建的账号还在）。不清的话「李老师」登不进去，Auth 又记着上一次的身份，
     页面会停在登录门那一屏 —— 高度恒等于视口，探测结果全是空的，而且**不报错**。
     踩过这个坑，别再删这一行。 */
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'probe-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
  const l = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await l; await sleep(2600);
  await cdp.eval(`(async () => { if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师'; document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit(); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);

  /* ⚠️ 必须灌一批演示数据再量。
     空系统的考勤页只有「附 · 导出考勤」那一章，量出来的都是几百像素的空页面，
     完全看不出名单行、方块、小结吸顶条的真实高度（踩过：一度以为考勤页很轻）。
     另外状态要凑齐 5 种，否则方块选中态、汇总分桶都量不到。 */
  const seeded = await cdp.eval(`(async () => {
    const today = Util.today();
    const c1 = Store.upsert('classes', { name: '砺蕴一班' });
    const c2 = Store.upsert('classes', { name: '集训班' });
    const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
    const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
    const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
    const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
    // 五种状态各来几个，行宽差异才看得出来
    s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
      status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : i === 7 ? '未到' : '正常' }));
    s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
    const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
    const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
    const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
    const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind:'big', day, periodId, title, cls, stu:'' });
    sch('周一', p1.id, '普通话语音基础', '砺蕴一班'); sch('周一', p3.id, '新闻播报实训', '砺蕴一班');
    sch('周二', p1.id, '即兴评述训练', '集训班');   sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
    sch('周四', p3.id, '模拟主持', '集训班');
    Quant.syncAtt(c1.id, today); Quant.syncAtt(c2.id, today);
    ['cls:课堂互动:+5','cls:评述集体通关:+15','cls:课堂纪律（当场扣）:-1'].forEach(t => {
      const [k, d] = t.split(':'); const [label, delta] = d.split(':');
      Store.upsert('quant_rules', { id: 'r_cls:' + label, key: 'cls:' + label, label, delta: Number(delta) });
    });
    const h1 = Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
    Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
    const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
    s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false); hk(s1[7].id, false);
    Store.upsert('hw:' + h1.id, { studentId: s1[0].id, done: true });
    Store.upsert('officers', { clsId: c1.id, title: '班长', studentId: s1[0].id });
    Store.upsert('officers', { clsId: c1.id, title: '学习委员', studentId: s1[3].id });
    Store.upsert('tickets', { type:'学生请假', studentId: s1[5].id, kind:'病假', date: today,
      text:'昨晚发烧到 39 度，今天在家休息，明天正常到。', status:'open', createdAt: Date.now() - 5400e3 });
    Store.upsert('tickets', { type:'学生请假', studentId: s2[1].id, kind:'事假', date: today,
      text:'上午回学校办毕业手续，下午到岗。', status:'done', createdAt: Date.now() - 90000e3 });
    try { await Auth.call('users', { op:'create', user:'张伟', name:'张伟', role:'teacher', pass:'liyun2026', classIds:[c2.id] }); } catch(e){}
    try { await Auth.call('users', { op:'create', user:'王敏', name:'王敏', role:'admin', pass:'liyun2026', classIds:[] }); } catch(e){}
    try { await Auth.call('users', { op:'create', user:'王梓涵', name:'王梓涵', role:'student', pass:'liyun2026', studentId: s1[0].id }); } catch(e){}
    Store.set('_attCls', c1.id); Store.set('_attDate', today);
    Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
    Store.set('_qCls', c1.id);   Store.set('_rosterCls', c1.id);
    Store.set('_pfCls', c1.id);  Store.set('_pfStu', s1[0].id);
    return { c1: c1.id, today, n1: N1.length };
  })()`);
  console.log(`已灌演示数据：砺蕴一班 ${seeded.n1} 人 / 集训班 5 人 · 五种状态齐全\n`);

  /* 要测老师端 / 学生端就换个账号登进去（不能走 Auth.logout：它带 confirm()，
     headless 下会弹原生对话框卡住）。直接清令牌 + 清 _me 再 submit 即可。 */
  if (ROLE !== 'super') {
    const cred = ROLE_CRED[ROLE];
    if (!cred) throw new Error('未知角色：' + ROLE);
    const sw = await cdp.eval(`(async () => {
      Store.setSecret('token',''); Auth._me = null; Auth.show();
      document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
      document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
      await Auth.submit();
      await new Promise(r => setTimeout(r, 2200));
      return { role: Auth.role(), name: Auth.name() };
    })()`);
    console.log(`已切换账号 → ${sw.name}（role=${sw.role}）\n`);
    await sleep(1200);
  }

  const pages = PAGES_FLAG.length ? PAGES_FLAG : (ROLE_PAGES[ROLE] || DEFAULT_PAGES);
  // 传了第二个位置参数就只挖那一页的盒子树（看「谁把页面撑这么高」）
  const dumpId = POS[1];
  const dumpDepth = Number(POS[2] || 3);
  if (dumpId) {
    const tree = await cdp.eval(`(() => {
      App.go(${JSON.stringify(dumpId)});
      const main = document.getElementById('main');
      const lines = [];
      const walk = (el, d) => {
        if (d > ${dumpDepth}) return;
        const r = el.getBoundingClientRect();
        if (r.height < 2) return;
        const cs = getComputedStyle(el);
        lines.push('  '.repeat(d) + '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
          + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')
          + '>  h=' + Math.round(r.height) + '  w=' + Math.round(r.width)
          + '  fs=' + cs.fontSize + '  disp=' + cs.display + (cs.gap && cs.gap !== 'normal' ? ' gap=' + cs.gap : '')
          + (cs.margin ? '' : ''));
        [...el.children].forEach(c => walk(c, d + 1));
      };
      walk(main, 1);
      return lines.join('\\n');
    })()`);
    console.log(tree);
  }
  const out = await cdp.eval(`(() => {
    const res = {};
    const probe = (id) => {
      try {
      App.go(id);
      const main = document.getElementById('main');
      const col  = document.querySelector('.col');
      const tb   = document.getElementById('tabbar');
      const top  = document.querySelector('.topbar');
      const cs   = getComputedStyle(main);
      const page = document.querySelector('.page.on');
      // 找出 .main 里比 .main 客户区还宽的元素（横向溢出）
      // ⚠️ 必须跳过「已经被一个不超宽的横滚容器装住」的元素 —— 否则课表这种
      //    故意 min-width:660px + 外套 overflow-x:auto 的做法会被误报成溢出。
      const cw = main.clientWidth;
      const guarded = (el) => {
        for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && p.getBoundingClientRect().width <= cw + 1.5) return true;
        }
        return false;
      };
      const wide = [];
      main.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > cw + 1.5 && el.offsetParent !== null && !guarded(el)) {
          wide.push({ tag: el.tagName.toLowerCase(), cls: (el.className && String(el.className).slice(0,60)) || '', w: Math.round(r.width) });
        }
      });
      // 找出字号 > 17 的可见文本元素（手机端字号偏大的嫌疑）
      const big = [];
      main.querySelectorAll('*').forEach(el => {
        if (!el.offsetParent && el.tagName !== 'BODY') return;
        if (el.children.length) return;
        const t = (el.textContent || '').trim();
        if (!t) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs >= 18) big.push({ cls: (el.className && String(el.className).slice(0,50)) || el.tagName.toLowerCase(), fs, t: t.slice(0,18) });
      });
      // iOS 硬规矩：可见的表单控件一律不准 < 16px（否则聚焦时整页自动放大）
      const smallCtl = [];
      main.querySelectorAll('input,select,textarea').forEach(el => {
        if (el.offsetParent === null) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) smallCtl.push({ tag: el.tagName.toLowerCase(), cls: (el.className && String(el.className).slice(0,40)) || '', fs });
      });
      return {
        docH: document.documentElement.scrollHeight,
        bodyH: document.body.scrollHeight,
        mainClientH: main.clientHeight,
        mainScrollH: main.scrollHeight,
        /* ⚠️ 只看「单个元素比 .main 宽」会漏掉这一类溢出：
           flex 行总宽超了，但行里每个元素单独看都不超宽（量化页那两个长按钮就是这样
           —— 155 + 262 = 425 撑破 328 的内容宽，而两个按钮自己都不到 328）。
           scrollWidth − clientWidth 才是「真的有横向溢出」的判据。 */
        overX: main.scrollWidth - main.clientWidth,
        mainOverflowY: cs.overflowY,
        colH: col.getBoundingClientRect().height,
        topbarH: top ? Math.round(top.getBoundingClientRect().height) : null,
        tabbarH: tb ? Math.round(tb.getBoundingClientRect().height) : null,
        tabbarPos: tb ? getComputedStyle(tb).position : null,
        pageH: page ? Math.round(page.getBoundingClientRect().height) : null,
        wide: wide.slice(0, 20),
        bigText: big.slice(0, 60),
        smallCtl: smallCtl.slice(0, 40),
      };
      } catch(e){ return { error: String((e && e.message) || e), docH:0, bodyH:0, colH:0, mainClientH:0, mainScrollH:0, overX:0, mainOverflowY:'', topbarH:null, tabbarH:null, tabbarPos:null, pageH:null, wide:[], bigText:[], smallCtl:[] }; }
    };
    for (const id of ${JSON.stringify(pages)}) res[id] = probe(id);
    return res;
  })()`);
  console.log(`\n▛▀ 度量：宽 ${WIDTH}px × 高 ${HEIGHT}px · 角色 ${ROLE} · ${pages.length} 页 ▀▜`);
  /* 量失败的页单独记账：它的那一行数字全是 0，跟「真的没有溢出」长得一模一样。
     所以最后必须响亮地失败，不能让它混在成功里过去。 */
  const failed = [];
  for (const [id, v] of Object.entries(out)) {
    console.log('\n══════ ' + id + ' ══════');
    if (v.error) { console.log('  ✗ 度量失败：' + v.error); failed.push(id); continue; }
    console.log(`  文档高 ${v.docH} · body 高 ${v.bodyH} · .col 高 ${v.colH}`);
    console.log(`  .main  客户高 ${v.mainClientH} 滚动高 ${v.mainScrollH} overflowY=${v.mainOverflowY}`);
    if (v.overX > 0) console.log(`  ⚠ 横向超出 ${v.overX}px（.main scrollWidth − clientWidth）`);
    console.log(`  顶栏 ${v.topbarH} · 标签栏 ${v.tabbarH} (position:${v.tabbarPos}) · .page 高 ${v.pageH}`);
    if (v.wide.length) console.log('  ⚠ 横向溢出：' + v.wide.map(w => `${w.tag}.${w.cls}=${w.w}`).join(' | '));
    if (v.bigText.length) console.log('  大字号：' + v.bigText.map(b => `${b.cls}(${b.fs})=${b.t}`).join(' | '));
    if (v.smallCtl.length) console.log('  ⚠ 表单控件 <16px：' + v.smallCtl.map(c => `${c.tag}.${c.cls}(${c.fs})`).join(' | '));
  }
  console.log('');
  if (failed.length) {
    console.error(`✗ ${failed.length} 页没能量出来：${failed.join(', ')}`);
    console.error('  这些页在报告里显示的全是 0，别当成「没有溢出」——先修探针。');
    process.exitCode = 1;
  }
  if (JSON_OUT) {
    await writeFile(JSON_OUT, JSON.stringify({ width: WIDTH, height: HEIGHT, role: ROLE, pages: out }, null, 1));
    console.log('已写出 JSON → ' + JSON_OUT);
  }
} catch (e) {
  console.error('✗ 探针失败：', e.message); process.exitCode = 1;
} finally { if (chrome) chrome.kill(); server.kill(); }
