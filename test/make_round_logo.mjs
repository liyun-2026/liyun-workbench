/**
 * 把方形 logo 做成「白底圆盘徽章」PNG（四角透明）。
 *   node test/make_round_logo.mjs <源图> <输出png> [边长，默认 1024]
 *
 * 为什么需要：博艺 logo 是白底方图，直接放到深色封面/章节页上会露出白方块。
 * 做法：白圆直径 = 画布边长，源图按对角线内接缩放（边长 ÷ √2），
 *       源图四角的白底自然融进圆盘 —— 于是不必测量 logo 圆的精确半径，
 *       放进深底是一枚干净的白色徽章，放进浅底也看不出接缝。
 * 实现走 Chrome 命令行（本机 CDP 会在 Page.enable 卡死），透明背景靠
 * `--default-background-color=00000000`。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const exec = promisify(execFile);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SRC = process.argv[2];
const OUT = process.argv[3];
const SIZE = Number(process.argv[4] || 1024);
if (!SRC || !OUT) { console.error('用法：node test/make_round_logo.mjs <源图> <输出png> [边长]'); process.exit(1); }

const absSrc = path.resolve(SRC);
const dir = path.dirname(absSrc);
const tmpHtml = path.join(dir, '_roundlogo_tmp.html');
const inner = Math.round(SIZE / Math.SQRT2);   // 源图内接于圆盘时的边长

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:${SIZE}px; height:${SIZE}px; background:transparent; }
.disc { width:${SIZE}px; height:${SIZE}px; border-radius:${SIZE / 2}px; overflow:hidden; background:#FFFFFF;
        display:flex; align-items:center; justify-content:center; }
.disc img { width:${inner}px; height:${inner}px; display:block; }
</style></head><body>
<div class="disc"><img src="${encodeURI(path.basename(absSrc))}"></div>
</body></html>`;

try {
  await writeFile(tmpHtml, html, 'utf8');
  await exec(CHROME, [
    '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--user-data-dir=/tmp/ly-roundlogo',
    `--window-size=${SIZE},${SIZE}`,
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--virtual-time-budget=9000',
    `--screenshot=${path.resolve(OUT)}`,
    'file://' + encodeURI(tmpHtml),
  ], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 }).catch(() => {});
  console.log(`✅ 已输出 ${OUT}（${SIZE} × ${SIZE}，源图按 ${inner}px 内接）`);
} finally {
  await unlink(tmpHtml).catch(() => {});
}
