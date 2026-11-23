/**
 * 看板 / 名册 / 统计口径 · 系统与模拟账号不得混入（VoxOS 5.59b）
 *
 *   node test/board_sysacct_filter_check.mjs
 *
 * 用户原话（2026-11-23）：
 *   「巡检学员不算正常的学生……所有类似于巡检的这种账号、模拟的这种账号都不算正常的学生，
 *     你为什么把它算进去？」
 *
 * 背景：巡检探针号挂的学员档案靠 `sysProtected:true` 排除。但合并按 _u 取新，
 * 某台设备本地写过这条记录就压得住云端 —— 标记一丢，档案就冒进看板「未到」名单。
 * 所以加两道兜底：① 名字/ID 命中巡检·探针·演示·内测·样例·测试 一律算系统账号；
 * ② 看板只算「挂在真实班级里」的学员（探针 classId 为空，本来就不属于任何班）。
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
ok(/isSystemStu\(o\)\{/.test(html), 'Util.isSystemStu() 判系统/模拟账号');
ok(/巡检\|探针\|演示\|内测\|样例\|测试/.test(html), '名字兜底覆盖巡检 / 探针 / 演示 / 内测 / 样例 / 测试');
ok(/!this\.isDemoObj\(s\) && !this\.isSystemStu\(s\)/.test(html), 'realStudents 同时排掉演示与系统账号');
ok(/const guarded = all\.filter\(s => Util\.isSystemStu\(s\)\)/.test(html), '名册把这类账号单独收进「系统保护」组');
ok(/const liveCls = new Set\(/.test(html) && /filter\(s => s\.classId && \(liveCls\.size/.test(html),
   '看板只算挂在真实班级里的学员');

console.log('\n【浏览器行为断言】');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(10000) });
const port = 5394;
const server = spawn('node', [path.join(dir, 'test', 'dev-server.mjs'), String(port)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  for (let i = 0; i < 40; i++) { try { const r = await jfetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch {} await sleep(250); }
  const profile = await mkdtemp(path.join(tmpdir(), 'sysacct-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    `--remote-debugging-port=${port + 1}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
    '--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 40; i++) { try { const l = await (await jfetch(`http://127.0.0.1:${port + 1}/json/list`)).json(); target = l.find(x => x.type === 'page' && x.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(Error('cdp')); });
  let id = 0; const waiting = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => waiting.set(i, { res, rej })); };
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/?nosw=1&board=1` }); await sleep(1800);
  await ev(`(() => { App.boot && App.boot(); return true; })()`).catch(() => {});
  await sleep(600);

  const seeded = JSON.parse(await ev(`(() => {
    Store.set('classes', [{ id:'c1', name:'考前05班' }]);
    Store.set('students', [
      { id:'s1', name:'张三', classId:'c1' },
      { id:'s2', name:'李四', classId:'c1' },
      { id:'sys_probe_001', name:'巡检学员', classId:'' },              // 没打标、没分班（掉标记的真实形态）
      { id:'sys_probe_002', name:'巡检学员二号', classId:'c1' },        // 没打标、但被塞进班里
      { id:'s9', name:'演示学员', classId:'c1' },
      { id:'sys_probe_003', name:'探针甲', classId:'', sysProtected:true }
    ]);
    const names = Util.realStudents(Util.byName).map(s => s.name);
    const D = Board.collect(Util.today());
    const miss = D.miss.map(s => s.name);
    const leave = D.leaveNames || [];
    /* 名册页把这类账号单独收进「系统保护」组 */
    Store.set('_rosterCls', 'c1');
    try { Roster.renderStuList(); } catch(e) {}
    const box = document.getElementById('stuList');
    const guardedTxt = box ? box.textContent : '';
    const cut = guardedTxt.indexOf('系统保护');
    const inClass = cut >= 0 ? guardedTxt.slice(0, cut) : guardedTxt;
    const inGuard = cut >= 0 ? guardedTxt.slice(cut) : '';
    return JSON.stringify({ names, total: D.total, should: D.should, miss, leave,
      inClass, inGuard, hasGuardLabel: cut >= 0 });
  })()`));

  ok(!seeded.names.some(n => /巡检|探针|演示/.test(n)), `realStudents 不含系统/演示账号 → ${JSON.stringify(seeded.names)}`);
  ok(seeded.names.length === 2, `真学员只剩 2 人 → ${seeded.names.length}`);
  ok(seeded.total === 2 && seeded.should === 2, `看板应到 2 人（不把巡检/演示算进去）→ total=${seeded.total} should=${seeded.should}`);
  ok(!seeded.miss.some(n => /巡检|探针|演示/.test(n)), `看板未到名单里没有巡检/探针/演示 → ${JSON.stringify(seeded.miss)}`);
  ok(seeded.hasGuardLabel && /巡检学员二号/.test(seeded.inGuard) && !/巡检/.test(seeded.inClass),
     `名册把巡检账号收进「系统保护」组、班级名单里没有 → 班组="${seeded.inClass.trim()}" 保护组="${seeded.inGuard.trim().slice(0, 40)}"`);

  /* 掉标记 + 有班级 的那种也要挡住（名字兜底生效） */
  const nameOnly = JSON.parse(await ev(`(() => {
    Store.set('students', [
      { id:'s1', name:'张三', classId:'c1' },
      { id:'x1', name:'巡检学员', classId:'c1' }
    ]);
    const D2 = Board.collect(Util.today());
    return JSON.stringify({ total: D2.total, miss: D2.miss.map(s => s.name), names: Util.realStudents(Util.byName).map(s=>s.name) });
  })()`));
  ok(nameOnly.total === 1 && !nameOnly.miss.includes('巡检学员'),
     `掉标记但只要名字是「巡检学员」也挡住 → total=${nameOnly.total} names=${JSON.stringify(nameOnly.names)}`);
} catch (e) {
  fail++; console.log('  ✗ 浏览器异常：' + (e && e.message || e));
} finally {
  try { chrome && chrome.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
}

console.log(`\n────────────\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
