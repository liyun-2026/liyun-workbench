/**
 * 门头几何验收（真 Chrome + 像素级核对）
 *
 * 起因：手机上「博艺教育」看着不居中 —— 英文行比中文行宽，中文那行被留在了
 * 盒子左边（实测偏左 19.5px）。量元素的盒子是量不出来的（盒子本来就居中），
 * 所以这里用最硬的口径：**截屏，把图丢进 canvas，数深色像素的外接框**，
 * 再跟页面中轴比。人眼看到的就是这些像素。
 *
 * ⚠️ 不要用 Range.getClientRects() 量「行盒」来替代 —— 它算末尾字距的方式
 *    与像素对不上（实测偏 +3.5~7.2px），会误报。
 *
 *   node test/brand_gate_check.mjs            # 默认端口 5351
 *   node test/brand_gate_check.mjs 5361
 *
 * 不建任何账号（登进去会把用户名占掉），用完 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 本机 127.0.0.1 不走系统代理 */
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5351);
const DBG = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ALL = ['A'];                    // 2026-09-20 定稿：只剩 A 竖式，B 横式 / D 深色已删

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}){
  for (let i = 0; i < tries; i++){ try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
class Cdp {
  constructor(ws){ this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = new Map(); }
  static async connect(url){
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连不上')); });
    const c = new Cdp(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.waiting.has(m.id)){ const { res, rej } = c.waiting.get(m.id); c.waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
      else if (m.method && c.events.has(m.method)) c.events.get(m.method).forEach(f => f(m.params));
    };
    return c;
  }
  send(method, params = {}){
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.waiting.set(id, { res, rej }));
  }
  async eval(expr, timeout = 60000){
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error('页面报错：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

let pass = 0, fail = 0;
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra === undefined ? '' : '   → ' + extra)); }
};
const head = t => console.log('\n' + t);

const MEASURE = `(function(){
  const gate = document.getElementById('gate');
  const brand = document.getElementById('gBrand');
  const axis = innerWidth / 2;
  const off = r => Math.round((r.left + r.width / 2 - axis) * 10) / 10;
  const rect = el => { const r = el.getBoundingClientRect();
    return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, off: off(r), top: r.top, bottom: r.bottom }; };
  const out = { axis: Math.round(axis), vw: innerWidth, vh: innerHeight,
                scrolls: gate.scrollHeight > gate.clientHeight + 1,
                brandMidOff: Math.round((brand.getBoundingClientRect().left +
                  brand.getBoundingClientRect().width / 2 - axis) * 10) / 10,
                wrapW: Math.round(gate.querySelector('.wrap').getBoundingClientRect().width),
                formW: Math.round(gate.querySelector('.g-form').getBoundingClientRect().width),
                kids: [], halo: false, imprint: false, orgBand: null };
  brand.querySelectorAll(':scope > *').forEach(el => {
    const b = rect(el);
    b.cls = el.tagName === 'IMG' ? 'badge' : String(el.className || el.tagName);
    out.kids.push(b);
  });
  const bi = brand.querySelector('.bi'), ly = brand.querySelector('.ly');
  const hrule = brand.querySelector('.b-rule');
  out.badge = bi ? rect(bi) : null;
  out.rule = hrule ? rect(hrule) : null;
  out.ly = ly ? rect(ly) : null;
  /* 「博艺教育」那一行在 y 上的范围：.b-org 的首行占上 55%（下面还跟着英文小字） */
  const org = brand.querySelector('.b-org');
  if (org){
    const r = org.getBoundingClientRect();
    out.orgBand = { top: Math.round(r.top), bottom: Math.round(r.top + r.height * 0.55),
                    text: (org.textContent || '').trim().slice(0, 8) };
  }
  /* ::after 是暖金晕（宽屏才有）；::before 是那枚虚化的机构徽章印记 —— 用户定稿要去掉，
     所以这里两个都量：halo 宽屏必须出现，imprint 任何时候都不许出现。 */
  const af = getComputedStyle(gate, '::after');
  const bf = getComputedStyle(gate, '::before');
  const hasBg = v => !!v && v !== 'none';
  out.halo = out.vw >= 900 && hasBg(af.backgroundImage);
  out.imprint = hasBg(bf.backgroundImage) || hasBg(bf.content) && hasBg(bf.background);
  return out;
})()`;

/* 把截屏丢进 canvas，数「文字灰」像素的外接框 —— 人眼看到的就是这些像素 */
const INK = shotB64 => `(async function(){
  const img = new Image();
  img.src = 'data:image/png;base64,${shotB64}';
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const band = window.__band;
  const d = cx.getImageData(0, Math.max(0, band.top), cv.width,
                            Math.max(1, band.bottom - band.top)).data;
  let x0 = 1e9, x1 = -1, n = 0;
  for (let y = 0; y < (band.bottom - band.top); y++){
    for (let x = 0; x < cv.width; x++){
      const i = (y * cv.width + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 46 && (r + g + b) / 3 < 178){ if (x < x0) x0 = x; if (x > x1) x1 = x; n++; }
    }
  }
  if (x1 < 0) return { none: true, imgW: cv.width };
  return { x0, x1, ink: x1 - x0 + 1, imgW: cv.width,
           off: Math.round(((x0 + x1) / 2 - cv.width / 2) * 10) / 10, n };
})()`;

let server; const chromes = [];
const devReset = async () => { try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {} };
const view = (cdp, o) => cdp.send('Emulation.setDeviceMetricsOverride',
  { width: o.width, height: o.height, deviceScaleFactor: 1, mobile: o.mobile });
const MOB = { width: 390, height: 844, mobile: true };
const DESK = { width: 1440, height: 900, mobile: false };

async function openGate(cdp){
  await cdp.send('Page.navigate', { url: `${BASE}/index.html` });
  await sleep(2200);
  await cdp.eval(`(() => { const s = document.getElementById('splash'); if (s) s.remove();
                          document.getElementById('gate').classList.add('on'); return 'ok'; })()`);
  await sleep(350);
  const m = await cdp.eval(MEASURE);
  await cdp.eval(`window.__band = ${JSON.stringify(m.orgBand)}; 'ok';`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  m.ink = await cdp.eval(INK(shot.data));
  return m;
}

try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok,
    { what: '预览服务', tries: 40 });
  await devReset();

  const profile = await mkdtemp(path.join(tmpdir(), 'gate-check-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--no-proxy-server', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, NO_PROXY: '*' } });
  chromes.push(chrome);
  const target = await waitFor(async () => {
    const list = await (await jfetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  }, { what: '调试端口', tries: 40 });
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  /* ── ① 手机：门头每一块都在中轴上，机构名那四个字的**像素**也在 ── */
  head('① 手机 390×844 · 门头对中');
  await view(cdp, MOB);
  for (const b of ALL){
    const m = await openGate(cdp);
    const badBox = m.kids.filter(x => Math.abs(x.off) > 1);
    ok(m.kids.length === 5, `${b}：门头五块层次齐备 —— 徽章 / 机构名 / 金线 / 字标 / 系统名（${m.kids.length} 块）`);
    ok(m.kids.map(x => x.cls).join('|') === 'badge|b-org|b-rule|ly|b-sys',
       `${b}：自上而下顺序正确（${m.kids.map(x => x.cls).join(' → ')}）`);
    ok(badBox.length === 0, `${b}：每一块都压在中轴上（±1px）`, badBox.map(x => x.cls + ' 偏 ' + x.off).join('，'));
    ok(m.ink && !m.ink.none, `${b}：截屏里量到了「${m.orgBand.text}」的墨迹`);
    ok(m.ink && Math.abs(m.ink.off) <= 1,
      `${b}：「${m.orgBand.text}」四个字正对中轴（像素实测）`,
      m.ink ? '墨迹偏 ' + m.ink.off + 'px，宽 ' + m.ink.ink : '没量到墨迹');
    ok(m.halo === false, `${b}：窄屏不铺背景装饰（省得糊住门头）`);
    ok(m.imprint === false, `${b}：背景没有徽章印记（用户定稿去掉）`);
    ok(!m.scrolls, `${b}：登录门没有多余的可滚高度（多了会顶出滚动条，整块牌子就左偏）`);
    ok(Math.abs(m.brandMidOff) <= 1, `${b}：整块门头正对页中轴`, '偏 ' + m.brandMidOff + 'px');
  }

  /* ── ② 电脑：牌匾要够大，但表单不能被拉宽 ── */
  head('② 电脑 1440×900 · 牌匾尺度');
  await view(cdp, DESK);
  for (const b of ALL){
    const m = await openGate(cdp);
    console.log(`     ${b}  徽章 ${m.badge ? m.badge.w : '-'}  金线 ${m.rule ? m.rule.w : '-'}  字标 ${m.ly ? m.ly.w : '-'}  表单 ${m.formW}`);
    ok(m.badge && m.badge.w >= 110, `${b}：徽章在电脑上放到 ${m.badge ? m.badge.w : '?'}px（≥110）`);
    ok(m.ly && m.ly.w >= 260, `${b}：行书字标放到 ${m.ly ? m.ly.w : '?'}px（≥260）`);
    ok(m.rule && m.rule.w >= 500,
       `${b}：金线拉长到 ${m.rule ? m.rule.w : '?'}px（≥500，气派就靠这一条）`);
    ok(m.formW <= 420 && m.formW >= 300, `${b}：表单仍是 ${m.formW}px 的窄栏（300~420）`);
    const badBox = m.kids.filter(x => Math.abs(x.off) > 1);
    ok(badBox.length === 0, `${b}：每一块都压在中轴上（±1px）`, badBox.map(x => x.cls + ' 偏 ' + x.off).join('，'));
    ok(m.ink && Math.abs(m.ink.off) <= 1,
      `${b}：「${m.orgBand.text}」四个字正对中轴（像素实测）`,
      m.ink ? '墨迹偏 ' + m.ink.off + 'px，宽 ' + m.ink.ink : '没量到墨迹');
    ok(m.halo === true, `${b}：宽屏铺上了暖金晕（背景唯一的装饰）`);
    ok(m.imprint === false, `${b}：背景没有徽章印记（用户定稿去掉）`);
    ok(!m.scrolls, `${b}：登录门没有多余的可滚高度（多了会顶出滚动条，整块牌子就左偏）`);
    ok(Math.abs(m.brandMidOff) <= 1, `${b}：整块门头正对页中轴`, '偏 ' + m.brandMidOff + 'px');
  }

  /* ── ③ 矮屏：牌匾比屏幕高时也不许被顶掉顶部 ── */
  head('③ 矮屏 1280×700 · 内容不许溢出视口顶部');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false });
  await openGate(cdp, 'A');
  const tall = await cdp.eval(`(function(){
    const gate = document.getElementById('gate');
    const r = gate.querySelector('.wrap').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
             scrollable: gate.scrollHeight > gate.clientHeight + 1 };
  })()`);
  console.log(`     牌匾 ${tall.top} ~ ${tall.bottom}（视口高 ${tall.vh}）`);
  ok(tall.top >= 0, '牌匾顶部没被推到视口外（flex 居中 + margin:auto 的老坑）', 'top=' + tall.top);
  ok(tall.bottom <= tall.vh || tall.scrollable, '牌匾放不下时可以滚动看到全部');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
} catch (e){
  fail++;
  console.error('\n💥 ' + (e && e.message));
} finally {
  await devReset();
  for (const c of chromes) c.kill();
  if (server) server.kill();
  await sleep(200);
  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
}
