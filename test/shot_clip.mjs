/**
 * 按指定区域截取一张长图 PNG 的局部（真 Chrome，命令行方式）。
 *   node test/shot_clip.mjs <源png> <输出png> <y> <height> [width]
 *
 * 用途：核对超长成品图（如使用教程长图）的首尾与关键区段。
 * 思路：本机无图像库（PIL/sharp），改用浏览器出图 ——
 *       把源图放进一个 overflow:hidden 的窗口，用负 top 把目标区段挪进窗口，再截图。
 * 注意：本机 CDP 的 WebSocket 会在 Page.enable 处卡死，故一律走 Chrome 命令行。
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
const CLIP_Y = Number(process.argv[4] || 0);
const CLIP_H = Number(process.argv[5] || 1200);
const WIDTH = Number(process.argv[6] || 1080);
if (!SRC || !OUT) { console.error('用法：node test/shot_clip.mjs <源png> <输出png> <y> <height> [width]'); process.exit(1); }

const absSrc = path.resolve(SRC);
const dir = path.dirname(absSrc);
const tmpHtml = path.join(dir, '_shotclip_tmp.html');
const baseName = path.basename(absSrc);

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; }
html,body { width:${WIDTH}px; height:${CLIP_H}px; overflow:hidden; background:#F6F5F2; }
.win { width:${WIDTH}px; height:${CLIP_H}px; overflow:hidden; position:relative; }
.win img { position:absolute; left:0; top:-${CLIP_Y}px; width:${WIDTH}px; display:block; }
</style></head><body><div class="win"><img src="${encodeURI(baseName)}"></div></body></html>`;

try {
  await writeFile(tmpHtml, html, 'utf8');
  await exec(CHROME, [
    '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--user-data-dir=/tmp/ly-shotclip',
    `--window-size=${WIDTH},${CLIP_H}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=9000',
    `--screenshot=${path.resolve(OUT)}`,
    'file://' + encodeURI(tmpHtml),
  ], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 }).catch(() => {});
  console.log(`✅ 已输出 ${OUT}｜截取 y=${CLIP_Y} 高 ${CLIP_H}px`);
} finally {
  await unlink(tmpHtml).catch(() => {});
}
