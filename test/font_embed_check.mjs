/**
 * 端到端验收：开屏「砺蕴」直接用设定好的行书字体显示，不再先出楷体再换字
 *   node test/font_embed_check.mjs              # 打本地（自起 dev-server）
 *   node test/font_embed_check.mjs https://liyun2026.top   # 直接打线上
 *
 * 判定标准（三条硬指标）：
 *   ① 页面完全不发 assets/liyun-xingshu.woff2 的网络请求（字体已随 CSS 内嵌）
 *   ② 一进页面还没等网络，LiYunXingShu 就已就绪（document.fonts.check 为真）
 *   ③ 「砺蕴」画到画布上的像素指纹 ≠ 楷体/serif 兜底（证明真的用上了这个字体，不是回退）
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2] || '';
const LIVE = /^https?:\/\//.test(arg);                       // 传网址 = 直接验收线上
const BASE = LIVE ? arg.replace(/\/$/, '') : `http://127.0.0.1:${arg || 5321}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(dir, 'test', '.shots');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(6000) });
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
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; }
}
async function shot(cdp, name){ const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('  📸 ' + name); }

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

try {
  await mkdir(OUT, { recursive: true });
  let server = null;
  if (!LIVE){
    server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(arg || 5321)], { cwd: dir, stdio: 'ignore' });
    await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: '预览服务', tries: 40 });
  }
  console.log('验收目标 →', BASE, LIVE ? '（线上）' : '（本机预览）', '\n');

  const profile = await mkdtemp(path.join(tmpdir(), 'font-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=5322', `--user-data-dir=${profile}`, '--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','about:blank'], { stdio: 'ignore' });
  const target = await waitFor(async () => { const list = await (await jfetch('http://127.0.0.1:5322/json/list')).json(); return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); }, { what: 'Chrome 调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });

  // 冷缓存 + 300ms 限速，模拟手机上第一次打开（最容易看到「先楷体再换字」的场景）
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024 });

  /* ⚠️ 开屏层的取样必须在「它还在的那一刻」抓下来，不能等后面的检查再查。
     原因：启动流程改成「先摆界面、后探活」之后开屏收得更早了，
     等 s2 去 querySelector 时元素常常已经没了 —— 那是竞态，不是字体有问题。
     （试过「覆盖 Auth._splashOff 把开屏钉住」，结构上做不到：
       覆盖发生在定时器已经排上之后，而 App.init() 是同步调用的，
       页内定时器根本没有插进去的机会。）
     做法：DOMContentLoaded + 一帧之后取样（那时开屏一定已经渲染出来），
     把文字/字体/是否可见存到 window 上，后面直接读这份快照。 */
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => {
      const sp = document.getElementById('splash');
      if (!sp) return;
      window.__splashHTML = sp.outerHTML;
      const el = sp.querySelector('.s-name');
      if (!el) return;
      const r = el.getBoundingClientRect();
      window.__splashProbe = {
        text: el.textContent.trim(),
        font: getComputedStyle(el).fontFamily,
        visible: r.width > 0 && r.height > 0,
        top: Math.round(r.top),
      };
    }));`,
  });

  const reqs = [];
  cdp.events.set('Network.requestWillBeSent', new Set([p => reqs.push(p.request.url)]));

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: `${BASE}/` });
  await loaded;

  const fontReqs = reqs.filter(u => u.includes('liyun-xingshu'));
  console.log('① 字体走不走网络');
  ok(fontReqs.length === 0, `没有任何字体文件请求（已内嵌，实测请求数 ${fontReqs.length}）`);

  const s1 = await cdp.eval(`(() => {
    const ready = document.fonts.check("64px LiYunXingShu");
    // 汉字各家字体宽度都是 2em，量宽度分辨不出来 —— 直接画到画布上比对像素
    const px = fam => {
      const cv = document.createElement('canvas'); cv.width = 220; cv.height = 110;
      const c = cv.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, 220, 110);
      c.fillStyle = '#000'; c.font = '64px ' + fam; c.textBaseline = 'top';
      c.fillText('砺蕴', 8, 8);
      const d = c.getImageData(0, 0, 220, 110).data;
      let h = 0, ink = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i] < 128) ink++; h = (h * 31 + d[i]) | 0; }
      return { h, ink };
    };
    return { ready, font: px('LiYunXingShu'), kai: px('"Kaiti SC", serif'), serif: px('serif'),
             fam: (document.querySelector('#splash .s-name')
                    ? getComputedStyle(document.querySelector('#splash .s-name')).fontFamily
                    : ((window.__splashProbe || {}).font || '')),
             display: [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
                        .filter(r => r.constructor.name === 'CSSFontFaceRule')
                        .map(r => r.style.fontDisplay)[0] };
  })()`);
  console.log('   像素指纹：行书 %s(墨点%s) ｜ 楷体 %s ｜ serif %s',
    s1.font.h, s1.font.ink, s1.kai.h, s1.serif.h);

  console.log('\n② 字体一上来就就绪（不用等网络，也就没有先画楷体再换的机会）');
  ok(s1.ready === true, 'document.fonts.check 立即为真');
  ok(s1.display === 'block', 'font-display 已是 block（兜底也不闪楷体）');
  ok(s1.font.ink > 0, '行书字体确实画出了「砺蕴」');
  ok(s1.font.h !== s1.kai.h && s1.font.h !== s1.serif.h, '「砺蕴」笔画与楷体/serif 不同 → 行书真的在生效，不是回退字形');

  const s2 = await cdp.eval(`(async () => {
    await document.fonts.ready;
    const p = window.__splashProbe;
    if (p) return p;
    /* 万一样没取到（线上极慢等），退回读当前 DOM */
    const el = document.querySelector('#splash .s-name');
    if (!el) return { text: '(开屏已收走，也没取到样)', visible: false };
    const r  = el.getBoundingClientRect();
    return { text: el.textContent.trim(), visible: r.width > 0 && r.height > 0, top: Math.round(r.top) };
  })()`);
  ok(s2.text === '砺蕴', `开屏主字是「砺蕴」（实测「${s2.text}」，取的是开屏刚出现那一刻）`);
  ok(s2.visible === true, '开屏主字确实占了可见面积（不是 0×0 的隐藏元素）');
  ok(/LiYunXingShu/.test(s1.fam || s2.font || ''),
    `开屏主字用的就是行书字体，不是回退字体（${(s1.fam || s2.font || '').split(',')[0]}）`);

  /* 截图：这时开屏可能已经收走了，用取样时存下的结构还原一份再截，图才有意义 */
  await cdp.eval(`(() => {
    if (document.getElementById('splash')) return;
    const box = document.createElement('div');
    box.innerHTML = window.__splashHTML || '';
    const el = box.firstElementChild;
    if (el) document.body.appendChild(el);
  })()`);
  await shot(cdp, LIVE ? 'font-splash-live.png' : 'font-splash.png');
  await cdp.eval(`(() => { const el = document.getElementById('splash'); if (el) el.remove(); })()`);

  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  chrome.kill(); if (server) server.kill();
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('\n✗ 出错：', e.message);
  process.exit(1);
}
