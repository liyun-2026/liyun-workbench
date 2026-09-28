/**
 * 回归断言：开场动画**任何情况下都只放一遍**。
 *
 *   node test/splash_once_check.mjs
 *
 * 背景（2026-09-28 用户反馈「一进站开场动画跳两三次，感觉像故障」）：
 *   新 SW activate+claim 会派发 controllerchange，页面收到就 location.reload()；
 *   旧版的守门变量 window._swReloading 挺不过 reload，SW 又有 controllerchange
 *   与 shell-updated 两条通知路径，部署窗口里缓存指纹还可能对不上 ——
 *   实测首次访问 2 次文档加载 = 开屏播两遍。
 *
 * 这条脚本把最容易出事的两种情形各跑一遍，只认一个指标：**开屏可见段数 == 1**。
 *   ① 首次访问（原本没有 SW）—— 不该重载，开屏一段
 *   ② 已经装了旧版，这次遇到新版本（真·换版）—— 允许重载一次，但重载那趟跳过开屏，
 *      所以仍然只看得到一段
 *
 * ② 是拿「站点副本」做的：整站拷到临时目录，改副本里的 sw.js VERSION 制造新版本，
 * 不碰仓库里的文件。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, sleep } from './splash_probe.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5393;
const DBG = 5394;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = 0;
const t = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let server;
try {
  /* ── 整站拷到临时目录，之后只动副本 ── */
  const site = await mkdtemp(path.join(tmpdir(), 'splash-site-'));
  cpSync(dir, site, {
    recursive: true,
    filter: (src) => !/[/\\](\.git|node_modules|\.shots|\.preview-data\.json)/.test(src),
  });
  console.log('站点副本：' + site);

  server = spawn(process.execPath, [path.join(site, 'test', 'dev-server.mjs'), String(PORT)], { cwd: site, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}', signal: AbortSignal.timeout(5000) })).ok) break; } catch {}
    await sleep(400);
  }
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  const profile = await mkdtemp(path.join(tmpdir(), 'splash-prof-'));
  const swPath = path.join(site, 'sw.js');

  /* ── ① 首次访问 ── */
  console.log('\n① 首次访问（浏览器里还没有 SW）');
  const r1 = await measure({ url: `${BASE}/`, profile, watchMs: 16000, dbgPort: DBG, quiet: true });
  t('入场动画只播一遍', r1.replays.length === 0, `实际重放 ${r1.replays.length} 次（可见 ${r1.segs.length} 段）`);
  t('没有多余重载（首次安装不该重载）', r1.loads === 1, `文档加载 ${r1.loads} 次`);

  /* ── ② 换版：把副本里的 sw.js 改成新版 ── */
  console.log('\n② 换版（已装旧版，这次遇到新 sw.js）');
  const src = await readFile(swPath, 'utf8');
  const bumped = src.replace(/const VERSION = 'v(\d+)'/, "const VERSION = 'v0-check'");
  if (bumped === src) throw new Error('没找到 VERSION，改不动副本');
  await writeFile(swPath, bumped);
  /* 顺手让 index.html 也变一下，制造真实的「壳子换了」 */
  const idxPath = path.join(site, 'index.html');
  await writeFile(idxPath, (await readFile(idxPath, 'utf8')).replace('</body>', '<!-- splash-check -->\n</body>'));

  const r2 = await measure({ url: `${BASE}/`, profile, watchMs: 18000, dbgPort: DBG, quiet: true });
  t('入场动画只播一遍（重载那趟跳过了开屏）', r2.replays.length === 0,
    `实际重放 ${r2.replays.length} 次，文档加载 ${r2.loads} 次（允许 2 次，但第 2 次必须看不到开屏）`);
  t('换版确实重载了（不然说明本轮没真的换版）', r2.loads >= 2, `文档加载 ${r2.loads} 次`);

  /* ── ③ 再来一次（同会话已刷过 / 无更新）── */
  console.log('\n③ 紧接着再打开一次（无更新）');
  const r3 = await measure({ url: `${BASE}/`, profile, watchMs: 14000, dbgPort: DBG, quiet: true });
  t('入场动画只播一遍', r3.replays.length === 0, `实际重放 ${r3.replays.length} 次，文档加载 ${r3.loads} 次`);

  console.log('\n' + (fail ? `❌ 有 ${fail} 项没过` : '✅ 全过：开场动画任何情况下都只播一遍'));
} catch (e) {
  console.error('\n❌ 跑挂了：' + (e && e.message));
  fail++;
} finally {
  try { server?.kill(); } catch {}
  process.exit(fail ? 1 : 0);
}
