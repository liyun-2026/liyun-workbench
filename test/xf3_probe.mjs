/* ==XF3== 探针：today / news 深排截图 + 结构断言（布局迭代用，不入正式验证链） */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5490, BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SUPER = { user: '李老师', pass: 'liyun2026' };
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

const MASK_JS = `(() => {
  document.querySelectorAll('.clock').forEach(e => e.style.visibility = 'hidden');
  return 1;
})()`;

const SEED_JS = `(async () => {
  const today = Util.today();
  const c1 = Store.upsert('classes', { name: '砺蕴一班' });
  const N1 = ['王梓涵','李思远','张予诺','陈可儿','刘浩然','赵一诺','孙嘉禾','周若溪','吴俊熙','郑雨桐'];
  const s1 = N1.map(n => Store.upsert('students', { classId: c1.id, name: n }));
  s1.forEach((s, i) => Store.upsert('att:' + today, { studentId: s.id,
    status: i === 2 ? '迟到' : i === 4 ? '事假' : i === 5 ? '病假' : '正常' }));
  const p1 = Store.upsert('periods', { name: '第1节', start: '08:30', end: '10:00' });
  const p2 = Store.upsert('periods', { name: '第2节', start: '10:15', end: '11:45' });
  const sch = (day, periodId, title, cls) => Store.upsert('schedule', { kind: 'big', day, periodId, title, cls, stu: '' });
  sch('周一', p1.id, '普通话语音基础', '砺蕴一班');
  sch('周三', p2.id, '文学作品朗读', '砺蕴一班');
  sch('周四', p1.id, '即兴评述训练', '砺蕴一班');
  Store.upsert('notices', { text: '第三次模拟考试今天 15:30 开考，请带课老师提前 10 分钟把学生带到综合考场。', date: today, by: '教务处', at: Date.now() - 3600e3 });
  Store.upsert('notices', { text: '十月家长开放日安排：开放日定于本月最后一个周六，各班课表将提前两日同步至家长端。', date: '2026-10-17', by: '教务处', at: Date.now() - 3 * 86400e3 });
  Store.upsert('notices', { text: '关于调整表演课教室的通知：自本周起，二班表演课由 BY05 调整至 BY06 教室。', date: '2026-10-15', by: '教务处', at: Date.now() - 5 * 86400e3 });
  Store.set('_tdAttCls', c1.id);
  try { await Auth.call('users', { op: 'create', user: '张伟', name: '张伟', role: 'teacher', pass: 'liyun2026', classIds: [c1.id] }); } catch(e){}
  return 1;
})()`;

const srv = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const profile = await mkdtemp(path.join(tmpdir(), 'xf3-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5497',
    `--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5497/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await view(cdp, { width: 1440, height: 2400, dsf: 1, mobile: false });
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(4500);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value = '李老师';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return !document.getElementById('gate').classList.contains('on');
  })()`);
  await cdp.eval(SEED_JS);
  await sleep(600);
  /* 切教师身份（today/news 是教师路由） */
  await cdp.eval(`(async () => {
    Store.setSecret('token',''); Auth._me = null; Auth.show();
    document.getElementById('gUser').value = '张伟';
    document.getElementById('gPass').value = 'liyun2026';
    await Auth.submit();
    await new Promise(r => setTimeout(r, 2400));
    return Auth.role();
  })()`);
  await sleep(800);

  /* 先切页再断言 */
  await cdp.eval(`(async () => { App.go('today'); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
  await sleep(400);

  /* 结构断言 */
  const a = await cdp.eval(`(() => {
    const pg = document.getElementById('page-today');
    const cs = getComputedStyle(pg);
    const les = pg.querySelector('.xf-les'), wk = pg.querySelector('.xf-wk');
    const nd = document.getElementById('tdNotice');
    return {
      grid: cs.display === 'grid' ? cs.gridTemplateColumns : 'not-grid',
      lesCol: les ? Math.round(les.getBoundingClientRect().left) : -1,
      wkCol: wk ? Math.round(wk.getBoundingClientRect().left) : -1,
      wkRight: wk ? Math.round(wk.getBoundingClientRect().right) : -1,
      lesRight: les ? Math.round(les.getBoundingClientRect().right) : -1,
      noticePainted: nd ? nd.querySelectorAll('.ndate').length : -1,
      noticeRaw: nd ? nd.querySelectorAll('.grow').length : -1,
      h2Font: getComputedStyle(pg.querySelector('.card > h2')).fontFamily,
      cardBorder: getComputedStyle(pg.querySelector('.card')).borderRadius,
    };
  })()`);
  console.log('today 断言:', JSON.stringify(a, null, 1));

  await cdp.eval(MASK_JS); await sleep(250);
  let r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('/tmp/xf3-today.png', Buffer.from(r.data, 'base64'));

  await cdp.eval(`(async () => { App.go('news'); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
  await cdp.eval(MASK_JS); await sleep(250);
  r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('/tmp/xf3-news.png', Buffer.from(r.data, 'base64'));
  console.log('截图完成：/tmp/xf3-today.png /tmp/xf3-news.png');
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { srv && srv.kill('SIGKILL'); } catch {}
}
