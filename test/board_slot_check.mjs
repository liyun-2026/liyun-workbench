/**
 * 看板考勤按时段自动切专项（VoxOS 5.57）
 *   node test/board_slot_check.mjs
 * 用户原话：「这会儿下午了，为什么在看板上还是上午的考勤」→ 选「按当前时段自动切」。
 * 覆盖：上午/下午分别取数、老 sign 反推时段、12:00 自动切、屏上标注当前时段。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(path.join(dir, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

console.log('【源码静态断言】');
ok(/autoPid\(at\)\{/.test(html), 'Att.autoPid() 按时段配置/12:00 自动判段');
ok(/autoSlotPid\(\)\{/.test(html), 'Board.autoSlotPid() 用服务端校过的钟判段');
ok(/collect\(date, pid\)\{/.test(html), 'Board.collect 支持第二参 pid');
ok(/const want = \(pid === undefined \|\| pid === null\) \? '\*' : pid;/.test(html), '不传 pid = 全天累计（老口径不破）');
ok(/const signPid = s =>\s*\{/.test(html), 'sign 老记录按最近考勤反推时段');
ok((html.match(/data-bd="attSlot"/g) || []).length === 2, 'sign/dash 两套骨架都有当前时段标注槽');
ok(/跨过时段边界/.test(html) && /this\.refresh\(\)\.finally/.test(html), '跨 12:00 立即重取数，不等 30 秒轮询');
ok(/this\._data = this\.collect\(Util\.today\(\), this\._slotPid\);/.test(html), 'refresh 明确传当前时段给 collect');

console.log('\n【浏览器行为断言】');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(10000) });
const port = 5393;
const server = spawn('node', [path.join(dir, 'test', 'dev-server.mjs'), String(port)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  for (let i = 0; i < 40; i++) { try { const r = await jfetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch {} await sleep(250); }
  const profile = await mkdtemp(path.join(tmpdir(), 'bdslot-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${port+1}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'],{stdio:'ignore'});
  let target;
  for (let i = 0; i < 40; i++) { try { const l = await (await jfetch(`http://127.0.0.1:${port+1}/json/list`)).json(); target = l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(Error('cdp'))});
  let id=0; const waiting=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&waiting.has(m.id)){const{res,rej}=waiting.get(m.id);waiting.delete(m.id);m.error?rej(Error(m.error.message)):res(m.result);}};
  const send=(method,params={})=>{const i=++id;ws.send(JSON.stringify({id:i,method,params}));return new Promise((res,rej)=>waiting.set(i,{res,rej}));};
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/?nosw=1&board=1`}); await sleep(1800);

  const seeded = await ev(`(() => {
    const d = Util.today();
    Store.set('classes', [{id:'c1',name:'考前05班'}]);
    Store.set('students', [
      {id:'s1',name:'张三',classId:'c1'},
      {id:'s2',name:'李四',classId:'c1'},
      {id:'s3',name:'王五',classId:'c1'},
    ]);
    Store.set('att_slots', [{id:'am',name:'上午'},{id:'pm',name:'下午'}]);
    Store.set('tickets', []);
    /* s1 上午迟到、下午正常；s2 只有上午；s3 只有下午。
       sign 故意不带 pid（生产就是这样的老结构）。 */
    Store.set('att:'+d, [
      {id:'a1',studentId:'s1',status:'迟到',pid:'am',_u:Date.parse(d+'T09:05:00')},
      {id:'a2',studentId:'s1',status:'正常',pid:'pm',_u:Date.parse(d+'T15:05:00')},
      {id:'a3',studentId:'s2',status:'正常',pid:'am',_u:Date.parse(d+'T09:05:00')},
      {id:'a4',studentId:'s3',status:'正常',pid:'pm',_u:Date.parse(d+'T15:05:00')},
    ]);
    Store.set('sign:'+d, [
      {id:'s1',studentId:'s1',status:'迟到',at:Date.parse(d+'T09:05:00')},
      {id:'s2',studentId:'s2',status:'正常',at:Date.parse(d+'T09:05:00')},
      {id:'s3',studentId:'s3',status:'正常',at:Date.parse(d+'T15:05:00')},
    ]);
    const am = Board.collect(d,'am');
    const pm = Board.collect(d,'pm');
    const all = Board.collect(d);
    return JSON.stringify({am,pm,all});
  })()`);
  const s = JSON.parse(seeded);
  ok(s.am.ok === 1 && s.am.late === 1 && s.am.miss.length === 1,
     `上午只看上午：正常 1 / 迟到 1 / 未到 1 → ${JSON.stringify({ok:s.am.ok,late:s.am.late,miss:s.am.miss.length})}`);
  ok(s.pm.ok === 2 && s.pm.late === 0 && s.pm.miss.length === 1,
     `下午只看下午：正常 2 / 迟到 0 / 未到 1 → ${JSON.stringify({ok:s.pm.ok,late:s.pm.late,miss:s.pm.miss.length})}`);
  ok(s.am.miss.some(x=>x.id==='s3') && s.pm.miss.some(x=>x.id==='s2'),
     '上午没登记的下午生不冒进上午；下午没登记的上午生也不冒进下午');
  ok(s.all.ok === 3 && s.all.slotName === '全天', '不传 pid 仍是全天累计（老口径不破）');
  ok(s.am.slotName === '上午' && s.pm.slotName === '下午', '取数结果带回时段名，供屏上标注');

  const timed = JSON.parse(await ev(`(() => {
    const at = (h,m) => { const d=new Date(); d.setHours(h,m,0,0); return d.getTime(); };
    const off = t => t - Date.now();
    Board._off = off(at(10,0)); const a = Board.autoSlotPid();
    Board._off = off(at(15,0)); const p = Board.autoSlotPid();
    Board._off = off(at(12,0)); const n = Board.autoSlotPid();
    const custom = { start:'13:00', end:'17:00', id:'x', name:'下午班' };
    const old = Att.SLOTS;
    Att.SLOTS = () => [{id:'am',name:'上午',start:'08:00',end:'12:00'}, custom];
    const c1 = Att.autoPid(new Date(at(11,59))), c2 = Att.autoPid(new Date(at(13,30)));
    Att.SLOTS = old;
    Board._off = 0;
    return JSON.stringify({a,p,n,c1,c2});
  })()`));
  ok(timed.a === 'am' && timed.p === 'pm', `按服务端校过的钟自动切：10:00→${timed.a}，15:00→${timed.p}`);
  ok(timed.n === 'pm', `12:00 整点归下午（不出现空档）→ ${timed.n}`);
  ok(timed.c1 === 'am' && timed.c2 === 'x', `时段自带 start/end 时优先用配置边界 → ${timed.c1}/${timed.c2}`);

  const label = JSON.parse(await ev(`(() => {
    Board._data = Board.collect(Util.today(),'pm');
    Board.paint();
    return JSON.stringify([...document.querySelectorAll('[data-bd="attSlot"]')].map(e=>e.textContent));
  })()`));
  ok(label.length === 2 && label.every(t=>t === '下午考勤'), `两套骨架都标出当前口径 → ${JSON.stringify(label)}`);

  const switched = await ev(`(async () => {
    document.body.classList.add('board-mode');
    const d = new Date(); d.setHours(15,0,0,0); Board._off = d.getTime() - Date.now();
    Board._slotPid = 'am'; Board._switching = false;
    Board.tick();
    for (let i=0;i<20 && Board._slotPid!=='pm';i++) await new Promise(r=>setTimeout(r,50));
    return Board._slotPid;
  })()`);
  ok(switched === 'pm', `跨时段边界时 tick 立刻重判，不靠下一轮轮询 → ${switched}`);
} catch (e) { fail++; console.log('  ✗ 浏览器异常：' + e.message); }
finally { if (chrome) chrome.kill(); server.kill(); }

console.log(`\n────────────\n通过 ${pass} 项，失败 ${fail} 项`);
process.exitCode = fail ? 1 : 0;
