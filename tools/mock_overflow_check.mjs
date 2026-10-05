/**
 * 静态样张版面自检：把 HTML 丢给 Chrome，问它每个盒子有没有溢出父容器。
 *   node tools/mock_overflow_check.mjs <file.html> [视口宽]
 * 用 CDP，不装 puppeteer —— 跟工程里其它脚本一样的路子。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const file = path.resolve(process.argv[2]);
const VW = Number(process.argv[3] || 1712);
const PORT = 5377;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });

const profile = await mkdtemp(path.join(tmpdir(), 'mock-chk-'));
const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run','--no-proxy-server','about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await (await jfetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
    if (!target) await sleep(400);
  }
  if (!target) throw new Error('连不上调试端口');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 打不开')); });
  let id = 0; const waiting = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => waiting.set(i, { res, rej })); };
  const evalx = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: 1200, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'file://' + file });
  await sleep(2200);

  const out = await evalx(`(() => {
    const rep = [];
    document.querySelectorAll('.phone').forEach((ph, i) => {
      const pr = ph.getBoundingClientRect();
      const cs = getComputedStyle(ph);
      const inner = { l: pr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
                      r: pr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
      let worst = null;
      ph.querySelectorAll('*').forEach(el => {
        if (!el.offsetParent && el.tagName !== 'BUTTON') return;
        const r = el.getBoundingClientRect();
        const over = Math.max(inner.l - r.left, r.right - inner.r);
        if (over > 0.5 && (!worst || over > worst.over)) {
          worst = { over: +over.toFixed(1), sel: el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.'), txt: (el.textContent||'').trim().slice(0,14) };
        }
      });
      const tag = ph.previousElementSibling ? ph.previousElementSibling.textContent.trim().slice(0, 12) : ('#' + i);
      rep.push({ tag, phoneW: +pr.width.toFixed(1), inner: +(inner.r - inner.l).toFixed(1),
                 contentTop: +(ph.querySelector('.ptitle').getBoundingClientRect().top - inner.l * 0).toFixed(0),
                 worst });
    });
    return rep;
  })()`);

  for (const p of out) {
    const ok = !p.worst;
    console.log(`${ok ? '✅' : '⚠️ '} ${p.tag.padEnd(14)} 面板 ${p.phoneW}px  内容区 ${p.inner}px` +
      (ok ? '  无溢出' : `  溢出 ${p.worst.over}px → ${p.worst.sel} 「${p.worst.txt}」`));
  }
  // 顺带报一下每列的实际高度，方便排版
  const hs = await evalx(`[...document.querySelectorAll('.col')].map(c => Math.round(c.getBoundingClientRect().height))`);
  console.log('列高：', hs.join(' / '));
  // 每个人的行高 —— 用来算「一屏能看多少人」
  const rows = await evalx(`(() => {
    const pick = (sel) => { const a = [...document.querySelectorAll(sel)];
      return a.length ? +(a.reduce((s,e) => s + e.getBoundingClientRect().height, 0) / a.length).toFixed(1) : null; };
    return { '现状 .row.r0': pick('.row.r0'), '方案A .ra': pick('.ra'),
             '方案B .row.rb': pick('.row.rb'), '方案C .row.rc': pick('.row.rc') };
  })()`);
  console.log('每人行高：', JSON.stringify(rows));
  ws.close();
} catch (e) {
  console.error('✗', e.message); process.exitCode = 1;
} finally { chrome.kill(); }
