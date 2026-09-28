/**
 * 二维码解码器（QRDec）自测 —— 学生端「扫一扫」能不能真读出屏上那块码。
 *
 * 为什么要这么测：真机扫码没法在自动化里跑（要摄像头、要人手），
 * 但「解码器读不读得出我们自己的编码器画出来的码」是可以用像素算出来的 ——
 * 这条路走通，剩下的就只是对焦和手稳不稳的问题。
 *
 * 抠的是 index.html 里**真正上线**的那两段代码（QR-ENCODER / QR-DECODER 标记区），
 * 不另抄一份，免得测的和跑的不是同一个东西。
 *
 * 场景按「手机对着门口的屏扫」来造：码在画面里只占一块、光线一边亮一边暗、
 * 轻微失焦、轻微倾斜、有零星噪点。
 *
 * 跑法：node test/qr_dec_check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');

function pick(startMark, endMark) {
  const a = html.indexOf(startMark);
  const b = html.indexOf(endMark);
  if (a < 0 || b < 0) throw new Error('找不到标记区：' + startMark);
  return html.slice(a + startMark.length, b);
}

const enc = pick('/* QR-ENCODER-START */', '/* QR-ENCODER-END */');
const dec = pick('/* QR-DECODER-START */', '/* QR-DECODER-END */');

const QRLib = new Function(enc + '\nreturn QRLib;')();
const QRDec = new Function('QRLib', dec + '\nreturn QRDec;')(QRLib);

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
};

/* ── 把模块矩阵渲染成一张 RGBA 图。scale = 每格几像素 ── */
function render(mod, scale, quiet = 4, canvasW = 0, canvasH = 0) {
  const n = mod.length, dim = (n + quiet * 2) * scale;
  const w = canvasW || dim, h = canvasH || dim;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const j = i * 4; px[j] = px[j + 1] = px[j + 2] = 235; px[j + 3] = 255; }
  const ox = Math.round((w - dim) / 2), oy = Math.round((h - dim) / 2);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet;
    const dark = (mx >= 0 && mx < n && my >= 0 && my < n) && mod[my][mx];
    const gx = ox + x, gy = oy + y;
    if (gx < 0 || gx >= w || gy < 0 || gy >= h) continue;
    const i = (gy * w + gx) * 4, v = dark ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  return { px, w, h };
}

/* 旋转（最近邻重采样） */
function rotate(src, deg) {
  const rad = deg * Math.PI / 180, w = src.w, h = src.h;
  const nw = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
  const nh = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
  const out = new Uint8ClampedArray(nw * nh * 4).fill(235);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const cos = Math.cos(-rad), sin = Math.sin(-rad);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const dx = x - nw / 2, dy = y - nh / 2;
    const sx = Math.round(dx * cos - dy * sin + w / 2), sy = Math.round(dx * sin + dy * cos + h / 2);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
    const i = (y * nw + x) * 4, j = (sy * w + sx) * 4;
    out[i] = src.px[j]; out[i + 1] = src.px[j + 1]; out[i + 2] = src.px[j + 2];
  }
  return { px: out, w: nw, h: nh };
}

/* 椒盐噪点：按比例把像素翻成纯黑/纯白 */
function noise(src, p, seed = 7) {
  const out = src.px.slice();
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < src.w * src.h; i++) {
    if (rnd() < p) { const v = rnd() < 0.5 ? 0 : 255, j = i * 4; out[j] = out[j + 1] = out[j + 2] = v; }
  }
  return { px: out, w: src.w, h: src.h };
}

/* 均值模糊（轻微失焦） */
function blur(src, k = 1) {
  const { px, w, h } = src;
  const out = px.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -k; dy <= k; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -k; dx <= k; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      }
    }
    const i = (y * w + x) * 4; out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n;
  }
  return { px: out, w, h };
}

/* 明暗渐变（屏幕上一边亮一边暗 / 一侧反光） */
function shade(src, lo = 70, hi = 255) {
  const out = src.px.slice();
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const k = (lo + (hi - lo) * (x / src.w)) / 255, i = (y * src.w + x) * 4;
    out[i] *= k; out[i + 1] *= k; out[i + 2] *= k;
  }
  return { px: out, w: src.w, h: src.h };
}

/* 压低对比度（屏幕反光、隔着玻璃拍） */
function flat(src, dark = 80, light = 190) {
  const out = src.px.slice();
  for (let i = 0; i < src.px.length; i += 4) {
    const v = src.px[i] < 128 ? dark : light;
    out[i] = out[i + 1] = out[i + 2] = v;
  }
  return { px: out, w: src.w, h: src.h };
}

/* 把解码器的内部分步也导出来 —— 好单独验证 RS 纠错这条路
   （只测端到端的话，样本没误差时纠错代码根本不会被跑到） */
const decDbg = dec.replace('return { decode: decode };',
  'return { decode: decode, _d: { toGray, binarize, denoise, findFinders, cluster, pick3, orient,'
  + ' sample, readFormat, readCodewords, deinterleave, rsFix, affine } };');
const D = new Function('QRLib', decDbg + '\nreturn QRDec;')(QRLib)._d;

console.log('\n〇、RS 纠错（码被拍下来总会错几个码字，纠不回来就得让学生重扫）');
{
  const r = QRLib.encode('314159');
  const img = render(r.modules, 4);
  const b = D.denoise(D.binarize(D.toGray(img.px, img.w, img.h), img.w, img.h), img.w, img.h);
  const t = D.pick3(D.cluster(D.findFinders(b, img.w, img.h)), 1)[0];
  const o = D.orient(t);
  const m = D.sample(b, img.w, img.h, D.affine(o.lt, o.rt, o.lb, 21), 21);
  const parts = D.deinterleave(D.readCodewords(m, 21, 1, D.readFormat(m, 21)), 1);
  const block = parts[0].d.concat(parts[0].e), ec = parts[0].e.length;

  ok(D.rsFix(block, ec) !== null, `干净码字直接通过（${block.length} 码字，${ec} 个纠错）`);
  for (const k of [1, 2, 4]) {
    const bad = block.slice();
    for (let i = 0; i < k; i++) bad[(i * 5 + 3) % bad.length] ^= 0x5a;
    const fixed = D.rsFix(bad, ec);
    ok(!!fixed && fixed.slice(0, parts[0].d.length).join(',') === parts[0].d.join(','),
       `错 ${k} 个码字 → 纠回原样`);
  }
  const bomb = block.slice();
  for (let i = 0; i < 8; i++) bomb[(i * 3) % bomb.length] ^= 0x5a;
  ok(D.rsFix(bomb, ec) === null, '错 8 个码字（超出纠错能力）→ 返回 null，不硬猜');
}

const cases = ['123456', '222222', '000001', '999999', '314159'];

console.log('\n一、自编自解（看板上的码就是这套编码器画的）');
for (const text of cases) {
  const r = QRLib.encode(text);
  const img = render(r.modules, 4);
  const got = QRDec.decode(img.px, img.w, img.h);
  ok(got === text, `「${text}」→ 读出「${got}」（版本 ${r.version}，${r.size} 格）`);
}

console.log('\n二、不同缩放（站得远一点、码在画面里更小）');
{
  const text = '428571';
  const r = QRLib.encode(text);
  for (const s of [3, 4, 6, 10]) {
    const img = render(r.modules, s);
    const got = QRDec.decode(img.px, img.w, img.h);
    ok(got === text, `每格 ${s}px（整图 ${img.w}×${img.h}）→ 「${got}」`);
  }
}

console.log('\n三、码只占画面一角（真实取景就是这样：640×480 里码只占一小块）');
{
  const text = '246813';
  const r = QRLib.encode(text);
  const img = render(r.modules, 5, 4, 640, 480);
  const got = QRDec.decode(img.px, img.w, img.h);
  ok(got === text, `640×480 画面、码 145px → 「${got}」`);
  const img2 = render(r.modules, 3, 4, 480, 360);
  ok(QRDec.decode(img2.px, img2.w, img2.h) === text, `480×360 画面、码 87px → 「${text}」`);
}

console.log('\n四、光线与画质');
{
  const text = '777888';
  const r = QRLib.encode(text);
  for (const p of [0.01, 0.03]) {
    const got = QRDec.decode(...(() => { const i = noise(render(r.modules, 5, 4, 480, 360), p); return [i.px, i.w, i.h]; })());
    ok(got === text, `${(p * 100).toFixed(0)}% 像素乱翻 → 「${got}」`);
  }
  const withShade = shade(render(r.modules, 5, 4, 480, 360), 70, 255);
  ok(QRDec.decode(withShade.px, withShade.w, withShade.h) === text, `左暗右亮（70→255）→ 「${text}」`);
  const withFlat = flat(render(r.modules, 5, 4, 480, 360), 80, 190);
  ok(QRDec.decode(withFlat.px, withFlat.w, withFlat.h) === text, `对比度压到 80–190（隔玻璃拍）→ 「${text}」`);
  const withBlur = blur(render(r.modules, 6, 4, 480, 360), 2);
  ok(QRDec.decode(withBlur.px, withBlur.w, withBlur.h) === text, `轻微失焦模糊 → 「${text}」`);
}

console.log('\n五、倾斜（手机不会每次都正对屏幕）');
{
  const text = '963258';
  const r = QRLib.encode(text);
  const base = render(r.modules, 6, 8);
  for (const deg of [8, -12, 20]) {
    const img = rotate(base, deg);
    const got = QRDec.decode(img.px, img.w, img.h);
    ok(got === text, `旋转 ${deg}° → 「${got}」`);
  }
}

console.log('\n六、读不出就返回空，绝不瞎猜一个错的');
{
  const blank = { px: new Uint8ClampedArray(200 * 200 * 4).fill(255), w: 200, h: 200 };
  ok(QRDec.decode(blank.px, blank.w, blank.h) === '', '纯白画面 → 空');
  const r = QRLib.encode('123456');
  const img = render(r.modules, 4);
  for (let i = 0; i < img.px.length; i += 4) { const v = (i / 4) % 2 ? 0 : 255; img.px[i] = img.px[i + 1] = img.px[i + 2] = v; }
  ok(QRDec.decode(img.px, img.w, img.h) === '', '打成黑白噪点 → 空');
  /* 关键：读不出的必须是空，不能是一个「看着像但不等于原文」的串 */
  const buf = new Uint8ClampedArray(480 * 360 * 4);
  let s = 9;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 480 * 360; i++) { const v = rnd() * 255 | 0, j = i * 4; buf[j] = buf[j + 1] = buf[j + 2] = v; buf[j + 3] = 255; }
  const rand = QRDec.decode(buf, 480, 360);
  ok(rand === '', `随机噪声画面 → 「${rand}」（应为空）`);
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
