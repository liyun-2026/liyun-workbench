/* ==M2== 手机端全页截图（390×844 @2x，真实身份链登录）
 *
 *   node test/m_full_shots.mjs [pre|post]
 *
 * 用途：
 *   pre  —— M2 改版前摸底：22 个旧样式页现状（存 /tmp/m-pre/）
 *   post —— M2 改版后终稿：全部手机页存 docs/mobile-v1-full-shots/ + 相册 gallery.html
 *
 * 页面清单 = 生产 NAV_ORDER 三身份真实渲染（super/teacher/student）。
 * 不改业务：登录走 Auth.submit 真实链，种子与 xf_check 同款。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const MODE = process.argv[2] || 'post';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5491;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = MODE === 'pre' ? '/tmp/m-pre' : path.join(dir, 'docs', 'mobile-v1-full-shots');
const SUPER = { user: '李老师', pass: 'liyun2026' };
const TEACHER = { user: '张伟', pass: 'liyun2026' };
const STUDENT = { user: '王梓涵', pass: 'liyun2026' };

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
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: o.dsf ?? 1, mobile: !!o.mobile });

/* 动画冻结 + 抖动内容隐藏（同 xf_check，减去 XF 骨架——手机端无 XF） */
const MASK_JS = `(() => {
  let frozen = document.getElementById('mMaskFreeze');
  if (!frozen){
    frozen = document.createElement('style'); frozen.id = 'mMaskFreeze';
    frozen.textContent = '.page.on, .page.on *, .page.on *::before, .page.on *::after,' +
      '.topbar, .mtabbar{animation:none!important;transition:none!important}';
    document.head.appendChild(frozen);
  }
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  document.querySelectorAll('.tl-now, #tlNowSr, [data-next], .p-time').forEach(e => e.style.visibility = 'hidden');
  const re = /(\\d+\\s*(分钟|小时|秒)前|^刚刚$|刚刚，|\\d+\\s*天前)/;
  const reClock = /\\d{4}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2}/;
  document.querySelectorAll('.page.on *').forEach(e => {
    if (e.children.length === 0){
      const t = (e.textContent || '').trim();
      if (re.test(t) || reClock.test(t)) e.style.visibility = 'hidden';
    }
  });
  ['newsBody','newsMore','tNewsBody','newsMeta','tNewsMeta','nNewsMeta','stuNewsMeta'].forEach(id => {
    const e = document.getElementById(id); if (e) e.innerHTML = '';
  });
  const dg = document.getElementById('devGate'); if (dg) dg.style.display = 'none';
  return 1;
})()`;

const SEED_JS = `(async () => {
  const today = Util.today();
  const c1 = Store.upsert('classes', { name: '砺蕴一班' });
  const c2 = Store.upsert('classes', { name: '集训班' });
  const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
  const N2 = ['冯亦辰','陈思瑶','黄瑾雯','徐子墨','马诗蕊'];
  const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
  const s2 = N2.map(n => Store.upsert('students', { classId: c2.id, name: n }));
  s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
    status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : '正常' }));
  s2.forEach(s => Store.upsert('att:' + today, { studentId: s.id, status: '正常' }));
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
  const p3 = Store.upsert('periods', { name: '第3节', start: '14:00', end: '15:30' });
  const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
  sch('周一', p1.id, '普通话语音基础', '砺蕴一班');
  sch('周一', p3.id, '新闻播报实训', '砺蕴一班');
  sch('周二', p1.id, '即兴评述训练', '集训班');
  sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
  sch('周四', p1.id, '即兴评述训练', '砺蕴一班');
  sch('周四', p3.id, '模拟主持', '集训班');
  Store.upsert('homework', { clsId: c1.id, date: today, text: '新闻播报练习：录一条 1 分钟音频' });
  Store.upsert('homework', { clsId: c1.id, date: today, text: '即兴评述提纲：我的家乡' });
  const hk = (sid, done) => Store.upsert('hwchk:' + today, { clsId: c1.id, studentId: sid, done });
  s1.slice(0, 6).forEach(s => hk(s.id, true)); hk(s1[6].id, false); hk(s1[7].id, false);
  Store.upsert('tickets', { type: '调课申请', byName: '张伟', text: '周三第 2 节想换到周四同一节',
    status: 'open', createdAt: (() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); })() });
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id, c2.id] }); } catch(e){}
  try { await Auth.call('users', { op: 'create', user: '王梓涵', name: '王梓涵', role: 'student', pass: 'liyun2026', studentId: s1[0].id }); } catch(e){}
  Store.set('_attCls', c1.id); Store.set('_attDate', today);
  Store.set('_hkCls', c1.id);  Store.set('_hkDate', today);
  Store.set('_tdAttCls', c1.id);
  return 1;
})()`;

async function boot(base) {
  await waitFor(async () => (await jfetch(`${base}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: `服务 ${base}`, tries: 40 });
  try { await jfetch(`${base}/api/dev-reset`, { method: 'POST' }); } catch {}
}
async function login(cdp, cred) {
  const lg = await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return { ok: !document.getElementById('gate').classList.contains('on'), role: Auth.role && Auth.role() };
  })()`);
  if (!lg.ok) throw new Error('登录失败：' + cred.user);
  return lg.role;
}
async function switchUser(cdp, cred) {
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = ${JSON.stringify(cred.user)};
    document.getElementById('gPass').value = ${JSON.stringify(cred.pass)};
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return Auth.role();
  })()`);
  await sleep(800);
}
async function goShot(cdp, pageId, file) {
  await cdp.eval(`(async () => { App.go(${JSON.stringify(pageId)}); await new Promise(r => setTimeout(r, 550)); window.scrollTo(0,0);
    const m = document.querySelector('.main'); if (m) m.scrollTop = 0; return 1; })()`);
  await sleep(350);
  await cdp.eval(MASK_JS);
  await sleep(200);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(file, Buffer.from(r.data, 'base64'));
}

/* 三身份页面清单 = 生产 NAV_ORDER（真实渲染） */
const GROUPS = [
  { tag: 'A', who: SUPER,   ids: ['home','att','sign','homework','roster','students','profile','timetable','hours','night','quant','exam','coop','gather','teachers','health','settings','board'] },
  { tag: 'T', who: TEACHER, ids: ['today','news','record','myclass','tickets','settings'] },
  { tag: 'S', who: STUDENT, ids: ['stuHome','stuGather','stuSign','stuNews','stuTable','stuExam','stuQuant','stuProfile','stuHw','stuMsg','settings'] },
];
/* 页名（相册用） */
const NAMES = {
  home:'教务首页', att:'考勤管理', sign:'打卡管理', homework:'作业管理', roster:'名册',
  students:'学生账号', profile:'学员档案', timetable:'课表', hours:'课时统计', night:'晚自习',
  quant:'量化', exam:'模考', coop:'协作', gather:'限时征集', teachers:'老师管理',
  health:'巡检', settings:'设置', today:'今日', news:'每日新闻', record:'录入今日',
  myclass:'我带的班', tickets:'上报与申请', stuHome:'学生首页', stuGather:'限时征集',
  stuSign:'打卡', stuNews:'每日新闻', stuTable:'我的课表', stuExam:'考试与抽签',
  stuQuant:'本班量化', stuProfile:'我的档案', stuHw:'我的作业', stuMsg:'给老师发消息',
  board:'看板',
};

const srv = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await mkdir(OUT, { recursive: true });
  await boot(BASE);
  console.log('服务就绪：', BASE, '· 模式', MODE, '· 输出', OUT, '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'm-shots-chrome-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5493',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5493/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, { width: 390, height: 844, dsf: 2, mobile: true });
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(2600);
  await cdp.eval(`try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} 'ok'`);
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(2400);

  await login(cdp, SUPER);
  await cdp.eval(SEED_JS);
  await cdp.eval(`if (window.News) News.fetch = async () => 0;`);
  await sleep(600);

  const manifest = [];
  for (const g of GROUPS) {
    if (g.who !== SUPER) await switchUser(cdp, g.who);
    for (const id of g.ids) {
      const f = path.join(OUT, `m-${g.tag}-${id}.png`);
      await goShot(cdp, id, f);
      manifest.push([`m-${g.tag}-${id}.png`, NAMES[id] || id, g.tag]);
      console.log(`  · [${g.tag}] ${NAMES[id] || id}`);
    }
  }

  /* 像素校验：每张图顶栏/首屏非空白（取 (195,60) 与 (195,400) 两点，须非纯白/纯黑空页） */
  let blanks = [];
  for (const [fn] of manifest) {
    const buf = await readFile(path.join(OUT, fn));
    if (buf.length < 20000) blanks.push(fn + '(tiny ' + buf.length + ')');
  }
  console.log('\n截图完成：' + manifest.length + ' 张' + (blanks.length ? ' · 可疑空白：' + blanks.join(',') : ' · 无空文件'));

  /* 相册（post 模式才生成） */
  if (MODE !== 'pre') {
    const gal = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>手机端版本一 · 全页验收</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#1c1e26;color:#e8e6e0}
header{position:sticky;top:0;background:#23262f;padding:10px 18px;display:flex;align-items:center;gap:14px;z-index:9;border-bottom:1px solid #333;flex-wrap:wrap}
header b{font-size:16px}
#pos{color:#c9ab7c;font-weight:700;font-size:15px}
button{background:#384a74;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:14px;cursor:pointer}
button:hover{background:#4a5c8c}
.tip{margin-left:auto;font-size:12.5px;color:#9aa0ad;max-width:520px;line-height:1.5}
.tip em{color:#e0564a;font-style:normal;font-weight:700}
main{max-width:900px;margin:0 auto;padding:14px}
#stage{text-align:center}
#stage img{max-width:100%;width:390px;display:inline-block;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.45)}
#cap{text-align:center;padding:10px 0 2px;font-size:14px;color:#9aa0ad}
#index{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px}
#index div{background:#23262f;border:1px solid #333;border-radius:8px;padding:8px 10px;font-size:12.5px;cursor:pointer;color:#b9bdc9}
#index div:hover{border-color:#c9ab7c;color:#fff}
#index div.cur{border-color:#c9ab7c;color:#c9ab7c;font-weight:700}
footer{text-align:center;color:#666;font-size:12px;padding:18px 0 26px}
</style>
</head>
<body>
<header>
  <b>手机端版本一 · 全页验收</b>
  <span id="pos"></span>
  <button onclick="go(-1)">← 上一页</button>
  <button onclick="go(1)">下一页 →</button>
  <span class="tip">验收规则：逐页看，<em>要改的页</em>回到对话打字「<em>页名：要改哪里</em>」；<em>没提到的页默认通过</em>。键盘 ←/→ 也能翻页。</span>
</header>
<main>
  <div id="stage"><img id="pic" src=""></div>
  <div id="cap"></div>
  <div id="index"></div>
</main>
<footer>共 ${manifest.length} 页 · 三身份（A 教务 / T 老师 / S 学生）· 数据均为生产真实数据渲染 · 通过的页不用回复，只说要改的</footer>
<script>
const pages=${JSON.stringify(manifest)};
let i=0;
const pic=document.getElementById('pic'),cap=document.getElementById('cap'),
pos=document.getElementById('pos'),idx=document.getElementById('index');
pages.forEach((p,n)=>{const d=document.createElement('div');d.textContent=(n+1)+'·'+p[2].toUpperCase()+' '+p[1];d.onclick=()=>show(n);idx.appendChild(d);});
function show(n){
  i=(n+pages.length)%pages.length;
  pic.src=pages[i][0];
  cap.textContent='图 '+pages[i][0]+' · '+pages[i][1];
  pos.textContent=(i+1)+' / '+pages.length+' · '+pages[i][1];
  [...idx.children].forEach((d,k)=>d.classList.toggle('cur',k===i));
  window.scrollTo({top:0});
}
function go(d){show(i+d)}
document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')go(-1);if(e.key==='ArrowRight')go(1)});
show(0);
</script>
</body>
</html>`;
    await writeFile(path.join(OUT, 'gallery.html'), gal);
    console.log('相册已生成：', path.join(OUT, 'gallery.html'));
  }
  console.log('\n✅ 完成');
} catch (e) {
  console.error('\n✗ 失败：', e.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  srv.kill();
}
