/**
 * 把一张 HTML 长图渲染成 PNG（真 Chrome，整页截图）。
 *   node test/make_longposter.mjs <html路径> <输出png路径> [宽度]
 *
 * 用途：培训材料里的「使用教程长图」由 长图.html 描述版式，
 * 本脚本负责用真实 Chrome 渲染并整页截图，保证中文字体与图片都按预期呈现。
 *
 * 实现要点（为什么这样写）：
 * 1. Chrome headless 的 `--screenshot` 只截「窗口大小」，不会自动截整页；
 *    所以先用 `--dump-dom` 跑一遍探针，把 scrollHeight 写进 <title> 读出来，
 *    再用这个高度作为 `--window-size` 的高度，才拿得到完整长图。
 * 2. 走命令行而不是 CDP：本机环境下 CDP 的 WebSocket 会卡在 Page.enable 不返回，
 *    命令行方式反而稳定，且无需维护连接与端口。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const exec = promisify(execFile);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const HTML = process.argv[2];
const OUT = process.argv[3];
const WIDTH = Number(process.argv[4] || 1080);
if (!HTML || !OUT) { console.error('用法：node test/make_longposter.mjs <html> <out.png> [宽度]'); process.exit(1); }

const absHtml = path.resolve(HTML);
const dir = path.dirname(absHtml);
const probeFile = path.join(dir, '_longposter_probe.html');
const urlOf = p => 'file://' + encodeURI(p);
const BASE_ARGS = [
  '--headless=old', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
];

/** 统一的 Chrome 调用（headless 的 crash 日志会走 stderr，这里不视为失败） */
async function chrome(args, profile) {
  return exec(CHROME, [...BASE_ARGS, `--user-data-dir=${profile}`, ...args], {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180000,
  }).catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || '' }));
}

let height = 0;
try {
  // ── 第一步：探高度 ──────────────────────────────
  const src = await readFile(absHtml, 'utf8');
  const probeScript = `<script>
(function(){
  function report(){
    var imgs = Array.from(document.images);
    var ready = imgs.every(function(im){ return im.complete && im.naturalWidth > 0; });
    document.title = 'H=' + Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) + '|IMG=' + imgs.length + '|READY=' + ready;
  }
  window.addEventListener('load', function(){ report(); setTimeout(report, 1200); setTimeout(report, 3000); });
})();
</script>
</body>`;
  await writeFile(probeFile, src.includes('</body>') ? src.replace('</body>', probeScript) : src + probeScript, 'utf8');

  const { stdout } = await chrome(
    ['--virtual-time-budget=15000', '--dump-dom', urlOf(probeFile)],
    '/tmp/ly-longposter-probe'
  );
  const m = String(stdout).match(/H=(\d+)\|IMG=(\d+)\|READY=(\w+)/);
  if (!m) throw new Error('探针未读到页面高度');
  height = Number(m[1]);
  console.log(`页面内容高度：${height}px，宽度：${WIDTH}px，图片 ${m[2]} 张，加载完成：${m[3]}`);
  if (m[3] !== 'true') console.warn('⚠️ 有图片可能未加载完，仍继续渲染');
} finally {
  await unlink(probeFile).catch(() => {});
}

if (!height) { console.error('❌ 未能取得页面高度'); process.exit(1); }

// ── 第二步：按实际高度出图 ────────────────────────
await chrome(
  [
    `--window-size=${WIDTH},${height}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=15000',
    `--screenshot=${path.resolve(OUT)}`,
    urlOf(absHtml),
  ],
  '/tmp/ly-longposter-shot'
);

console.log('✅ 已输出', OUT, `（${WIDTH} × ${height}）`);
