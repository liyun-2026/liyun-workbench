/* v85 批次 3a · 打卡四态视觉留证
 *   node test/stu3a_sign_states.mjs [端口]
 * 产出：test/.shots/mobile/stu3a_states/{sign,done,late,off}_500_light.png
 * （写当日 sign/tickets 记录后只调 StuSign.render() 重绘，业务逻辑零改动） */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NO_PROXY = '*';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5351);
const DEBUG_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots', 'mobile', 'stu3a_states');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
async function waitFor(fn){ for (let i = 0; i < 60; i++){ try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error('等不到服务'); }
class Cdp{
  constructor(ws){ this.ws = ws; this.id = 0; this.w = new Map(); }
  static async connect(url){ const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new Cdp(ws); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && c.w.has(m.id)){ const { res, rej } = c.w.get(m.id); c.w.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; return c; }
  send(m, p = {}){ const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((res, rej) => this.w.set(id, { res, rej })); }
  async eval(e){ const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || ''); return r.result.value; }
}

const server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu',`--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${await mkdtemp(path.join(tmpdir(),'s3s-'))}`,'--no-first-run','--no-proxy-server','about:blank'], { stdio: 'ignore' });
try {
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok);
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
  const t = await waitFor(async () => { const l = await (await jfetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); return l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); });
  const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: `${BASE}/` }); await sleep(2400);
  await cdp.eval(`(async () => {
    if (!Auth.mode) await Auth.probe();
    document.getElementById('gUser').value='测试教务'; document.getElementById('gPass').value='s3spass12';
    await Auth.submit(); await new Promise(r=>setTimeout(r,1800));
    const c1=Store.upsert('classes',{name:'砺蕴一班'});
    const s1=Store.upsert('students',{classId:c1.id,name:'王梓涵'});
    try{await Auth.call('users',{op:'create',user:'王梓涵',name:'王梓涵',role:'student',pass:'liyun2026',studentId:s1.id})}catch(e){}
    Store.setSecret('token',''); Auth._me=null; Auth.show();
    document.getElementById('gUser').value='王梓涵'; document.getElementById('gPass').value='liyun2026';
    await Auth.submit(); await new Promise(r=>setTimeout(r,2200));
    return 1;
  })()`);
  await mkdir(OUT, { recursive: true });
  const shot = async name => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 500, height: 900, scale: 2 } });
    await writeFile(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('📸 ' + name);
  };
  await cdp.eval(`(async () => { App.go('stuSign'); await new Promise(r=>setTimeout(r,700)); return 1; })()`);
  await shot('sign_500_light');                                  /* 未打卡（蓝盘 live 秒） */

  await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    Store.upsert('sign:' + d, { id: sid, studentId: sid, status: '正常', at: Date.now() - 3600e3, way: 'geo-ok' });
    StuSign.render(); await new Promise(r=>setTimeout(r,400)); return 1;
  })()`);
  await shot('done_500_light');                                  /* 已打卡（绿盘） */

  await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    Store.softDelete('sign:' + d, (Store.list('sign:' + d)[0] || {}).id);
    Store.upsert('sign:' + d, { id: sid, studentId: sid, status: '迟到', at: Date.now() - 3600e3, way: 'geo-ok' });
    StuSign.render(); await new Promise(r=>setTimeout(r,400)); return 1;
  })()`);
  await shot('late_500_light');                                  /* 迟到（橙盘） */

  await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    Store.softDelete('sign:' + d, (Store.list('sign:' + d)[0] || {}).id);
    Store.upsert('tickets', { type:'学生请假', studentId: sid, kind:'病假', date: d, text:'留证', status:'done', createdAt: Date.now() });
    StuSign.render(); await new Promise(r=>setTimeout(r,400)); return 1;
  })()`);
  await shot('off_500_light');                                   /* 不用打卡（灰盘） */

  /* 断网补传黄条：往队列塞一条再回未打卡态 */
  await cdp.eval(`(async () => {
    const d = Util.today(), sid = Stu.sid();
    Store.softDelete('tickets', (Store.list('tickets').find(t => t.type === '学生请假') || {}).id);
    Store.set('_signQueue', [{ dev:'x', at: Date.now() - 7200e3, code:'123456', offline: true }]);
    StuSign.render(); await new Promise(r=>setTimeout(r,400)); return 1;
  })()`);
  await shot('offline_500_light');
  console.log('✅ 四态 + 断网条 留证完成 → ' + OUT);
} catch (e) {
  console.error('✗ 失败：', e.message); process.exitCode = 1;
} finally { chrome.kill(); server.kill(); }
