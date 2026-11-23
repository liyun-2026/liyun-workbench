/**
 * 看板双班同屏专项（v5.56）—— 方案B：同一节次两班并成一行，行内金色班级标+本班课名
 *   node test/board_dual_check.mjs
 * 用 dev-server + 模拟数据跑；断言 group/row 结构不依赖真实云端。
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
ok(/按「节次」合并/.test(html), 'group 注释：按节次合并（不是节次+课名）');
ok(/const key = x\.periodId \|\|/.test(html), 'group key = periodId（同一节次合并成一个 key）');
ok(/bd-s2-multi/.test(html) && /bd-s2-seg/.test(html) && /bd-s2-cls/.test(html) && /bd-s2-sep/.test(html), '方案B CSS 类齐全（multi/seg/cls/sep）');
ok(/\.bd-s2-cls\{[^}]*color:var\(--gold-deep\)/.test(html), '班级标用金色令牌 --gold-deep');
ok(/replace\(\/\^集训\/, ''\)/.test(html), '班级标去掉「集训」前缀（BY05班 而非 集训BY05班）');
ok(/hit\.titles\.indexOf\(segTitle\) < 0/.test(html), '同班同节次课名去重');
ok(/teacher 时把老师名并进课名/.test(html), '老排课 teacher 并入课名、不套班级标');
ok(!/const key = \(x\.periodId \|\| t\) \+ '\|' \+ \(x\.title \|\| ''\)/.test(html), '旧的「节次+课名」拆分逻辑已移除');

// 浏览器端：注入真实两班数据，验证渲染结果
console.log('\n【浏览器渲染断言】');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(10000) });
const port = 5391;
const server = spawn('node', [path.join(dir, 'test', 'dev-server.mjs'), String(port)], { cwd: dir, stdio: 'ignore' });
let chrome;
try {
  for (let i = 0; i < 40; i++) { try { const r = await jfetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch {} await sleep(250); }
  const profile = await mkdtemp(path.join(tmpdir(), 'bdual-'));
  chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${port+1}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'],{stdio:'ignore'});
  let target;
  for (let i = 0; i < 40; i++) { try { const l = await (await jfetch(`http://127.0.0.1:${port+1}/json/list`)).json(); target = l.find(x=>x.type==='page'&&x.webSocketDebuggerUrl); if (target) break; } catch {} await sleep(250); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(Error('cdp'))});
  let id=0; const waiting=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&waiting.has(m.id)){const{res,rej}=waiting.get(m.id);waiting.delete(m.id);m.error?rej(Error(m.error.message)):res(m.result);}};
  const send=(method,params={})=>{const i=++id;ws.send(JSON.stringify({id:i,method,params}));return new Promise((res,rej)=>waiting.set(i,{res,rej}));};
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const loaded=(async()=>{ /* best effort */ })();
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/`}); await sleep(1800);

  const r = await ev(`(() => {
    // 造两个节次、每节两班不同课名
    const p1={id:'p1',start:'08:40',end:'09:20',name:'08:40-09:20'};
    const p2={id:'p2',start:'14:50',end:'15:30',name:'14:50-15:30'};
    Store.set('periods',[p1,p2]);
    Store.set('schedule',[
      {id:'s1',date:Util.today(),day:'一',periodId:'p1',title:'即兴评述',cls:'集训BY05班'},
      {id:'s2',date:Util.today(),day:'一',periodId:'p1',title:'文稿朗诵',cls:'集训BY06班'},
      {id:'s3',date:Util.today(),day:'一',periodId:'p1',title:'即兴评述',cls:'集训BY06班'},
      {id:'s4',date:Util.today(),day:'一',periodId:'p2',title:'现代文朗诵',cls:'集训BY05班'},
      {id:'s5',date:Util.today(),day:'一',periodId:'p2',title:'即兴评述',cls:'集训BY06班'},
    ]);
    const h = Board.schedHtml();
    const box=document.createElement('div'); box.innerHTML=h; document.body.appendChild(box);
    const rows=[...box.querySelectorAll('.bd-s2')].filter(x=>!x.classList.contains('dim'));
    return JSON.stringify({
      html:h,
      rowCount:rows.length,
      segsPerRow:rows.map(r=>r.querySelectorAll('.bd-s2-seg').length),
      clsLabels:[...box.querySelectorAll('.bd-s2-cls')].map(b=>b.textContent),
      rowTexts:rows.map(r=>r.textContent.replace(/\\s+/g,' ').trim()),
      hasSep:!!box.querySelector('.bd-s2-sep'),
    });
  })()`);
  const d = JSON.parse(r);
  ok(d.rowCount === 2, `两节次各一行（不再拆成 5 行）→ 实际 ${d.rowCount} 行`);
  ok(d.segsPerRow.every(n=>n===2), `每行两个班的分栏 → 实际 ${JSON.stringify(d.segsPerRow)}`);
  ok(d.clsLabels.includes('BY05班') && d.clsLabels.includes('BY06班'), `班级标去掉集训前缀 → ${JSON.stringify([...new Set(d.clsLabels)])}`);
  ok(d.hasSep, '两班之间有分隔 ｜');
  ok(d.rowTexts.some(t=>t.includes('即兴评述')&&t.includes('文稿朗诵')), '08:40 一行同时含 05 即兴评述 / 06 文稿朗诵');
  ok(d.rowTexts.some(t=>t.includes('现代文朗诵')&&t.includes('即兴评述')), '14:50 一行同时含两班不同课');
  // 同班同节次课名去重：08:40 BY06 有两条（文稿朗诵+即兴评述）应合成一段
  const row1 = d.rowTexts.find(t=>t.includes('08:40')) || '';
  ok((row1.match(/文稿朗诵/g)||[]).length===1, '同班课名不重复拼接');
} catch (e) { fail++; console.log('  ✗ 浏览器异常：' + e.message); }
finally { if (chrome) chrome.kill(); server.kill(); }

console.log(`\n────────────\n通过 ${pass} 项，失败 ${fail} 项`);
process.exitCode = fail ? 1 : 0;
