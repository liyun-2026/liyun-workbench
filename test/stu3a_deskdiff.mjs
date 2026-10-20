/* v85 批次 3a · 桌面 1440 像素回归 diff
 *   node test/stu3a_deskdiff.mjs <A目录> <B目录>
 * A=新版（工作树），B=基线（HEAD worktree）。逐页比 _tiles/desk{A,B}1440_{page}_light/01.png。
 * 输出每页差异像素数与占比（容忍：时钟秒数/同步时间戳等动态内容）。 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NO_PROXY = '*';
const [, , dirA, dirB] = process.argv;
const PAGES = ['home','att','homework','timetable','settings','stuHome','stuSign','stuHw','stuTable'];
const OUT = path.join(dirA, 'test', '.shots', 'mobile', '_tiles');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const png = async p => 'data:image/png;base64,' + (await readFile(p)).toString('base64');

const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-proxy-server',
  '--remote-debugging-port=9333',
  `--user-data-dir=${await mkdtemp(path.join(tmpdir(), 'deskdiff-'))}`,'about:blank'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
// 拿 devtools 目标
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++){
  try { const l = await (await fetch('http://127.0.0.1:9333/json/list')).json(); wsUrl = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await new Promise(r => setTimeout(r, 500));
}
if (!wsUrl){ console.error('Chrome 调试口连不上（需 --remote-debugging-port=9333）'); process.exit(1); }

const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
let id = 0; const waiting = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)){ const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); waiting.set(i, { res, rej }); });
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || ''); return r.result.value; };

let totalDiff = 0, totalPix = 0, worst = 0;
for (const p of PAGES){
  const fa = path.join(OUT, `deskA1440_${p}_light`, '01.png');
  const fb = path.join(dirB, 'test', '.shots', 'mobile', '_tiles', `deskB1440_${p}_light`, '01.png');
  let a, b;
  try { a = await png(fa); b = await png(fb); } catch { console.log(`  ⚠️ ${p}: 缺图，跳过`); continue; }
  const r = await evalJs(`(async () => {
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const [ia, ib] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: ia.width + 'x' + ia.height + ' vs ' + ib.width + 'x' + ib.height };
    const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0); const da = ctx.getImageData(0, 0, cv.width, cv.height).data;
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let diff = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++){
      const i = (y * cv.width + x) * 4;
      if (Math.abs(da[i]-db[i]) > 8 || Math.abs(da[i+1]-db[i+1]) > 8 || Math.abs(da[i+2]-db[i+2]) > 8){
        diff++; if (x<minX)minX=x; if (y<minY)minY=y; if (x>maxX)maxX=x; if (y>maxY)maxY=y;
      }
    }
    return { w: cv.width, h: cv.height, diff, box: diff ? [minX,minY,maxX,maxY].join(',') : '' };
  })()`);
  if (r.size){ console.log(`  ⚠️ ${p}: 尺寸不同 ${r.size}`); totalDiff += 1e9; continue; }
  const pct = (r.diff / (r.w * r.h) * 100).toFixed(3);
  console.log(`  ${p}: diff ${r.diff} px（${pct}%）${r.box ? ' 区域[' + r.box + ']' : ''}`);
  totalDiff += r.diff; totalPix += r.w * r.h;
  worst = Math.max(worst, r.diff);
}
console.log(`\n合计差异 ${totalDiff} px / ${totalPix} px`);
chrome.kill();
process.exit(totalDiff > totalPix * 0.005 ? 1 : 0);   // 0.5% 阈值（动态内容允许），超出即挂
