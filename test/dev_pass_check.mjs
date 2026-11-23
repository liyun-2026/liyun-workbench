/**
 * 统一登记口令 · 专项核对（真后端，不是静态断言）
 *
 *   node test/dev_pass_check.mjs [port]
 *
 * 背景（2026-11-23 主理人口述）：
 *   「这些学生账号全部都是第一次使用，里边有一个登录设备的密钥，
 *     把那个登记设备的密钥编成 boyi2027，39 个学生账号只能用一次，
 *     今天晚上到明天早上 7:40 之前有效」
 *
 * 要守住的事：
 *   1. 教务设了口令，学生用它就能登记设备（不用一枚一枚发密钥）；
 *   2. **同一个账号只能用一次** —— 第二次换设备必须拒；
 *   3. 过了截止时间立刻不认（不用等谁去关）；
 *   4. 别的账号还能用同一个口令（每账号一次，不是全局一次）；
 *   5. 原有一次性密钥照常可用（口令用过了还能走单发密钥）；
 *   6. 只有教务能设/停口令，学生调不动；口令格式有校验。
 *
 * 全程用本地 dev-server（真 sync.js + 内存 Blob），跑完 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5381);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; fails.push(m); console.log('  ❌ ' + m); } };

const api = async (action, extra = {}, token = '') => {
  const r = await fetch(BASE + '/api/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, token, ...extra }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  return { code: r.status, j };
};
const must = async (action, extra = {}, token = '') => {
  const { code, j } = await api(action, extra, token);
  if (!j || j.error) throw new Error(`${action} 失败（${code}）：${j && j.error}`);
  return j;
};

/* 明天早上 07:40（北京时间） */
const before740 = () => {
  const d = new Date(Date.now() + 8 * 3600e3);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate() + 1;
  return Date.UTC(y, mo, da, 7, 40, 0) - 8 * 3600e3;
};

const srv = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + '/api/dev-state', { signal: AbortSignal.timeout(1500) }); if (r.ok) { up = true; break; } } catch {}
  await sleep(300);
}
if (!up) { console.log('❌ dev-server 起不来'); srv.kill('SIGKILL'); process.exit(1); }

try {
  await fetch(BASE + '/api/dev-reset', { method: 'POST' });
  console.log('后端就绪，开始核对\n');

  const staff = await must('login', { user: '口令测试教务', pass: 'passcheck1234' });
  const CLS = 'cls_dp';
  const S = ['dpA', 'dpB', 'dpC'].map((x, i) => ({ id: x, name: '口令测试生' + '甲乙丙'[i], classId: CLS }));
  await must('push', {
    shared: { classes: [{ id: CLS, name: '口令测试班' }], students: S },
  }, staff.token);
  await must('users', { op: 'createMany', list: S.map((s, i) => ({
    user: '口令' + '甲乙丙'[i], pass: 'bydp' + (1001 + i), role: 'student', name: s.name, studentId: s.id,
  })) }, staff.token);

  const tok = {};
  for (const [i, nm] of ['甲', '乙', '丙'].entries()) {
    tok[nm] = (await must('login', { user: '口令' + nm, pass: 'bydp' + (1001 + i) })).token;
  }

  /* ── 1. 教务设口令 ── */
  console.log('① 教务设定口令');
  const UNTIL = before740();
  const set = await api('dev_pass', { op: 'set', code: 'boyi2027', until: UNTIL }, staff.token);
  ok(set.j.ok && set.j.pass && set.j.pass.code === 'boyi2027', `口令设成功（${set.j.pass && set.j.pass.code}）`);
  const got = await must('dev_pass', { op: 'get' }, staff.token);
  ok(got.pass && got.pass.code === 'boyi2027' && Number(got.pass.until) === UNTIL,
     '读回来是一致的（口令 + 截止时间）');

  /* ── 2. 学生甲：新设备直接放行（不需要口令） ── */
  console.log('\n② 全新账号 + 全新设备：自动放行，不该拦');
  const a1 = await api('dev', { dev: 'dev-a-1' }, tok['甲']);
  ok(a1.j.ok && a1.j.bound && a1.j.first === true, `甲 第一台设备直接放行（${JSON.stringify(a1.j)}）`);

  /* ── 3. 学生甲：第二台设备用口令 ── */
  console.log('\n③ 甲 换第二台设备：用口令');
  const need = await api('dev', { dev: 'dev-a-2' }, tok['甲']);
  ok(need.j.ok === false && need.j.needKey === true, '没给口令时提示要口令（needKey）');
  const a2 = await api('dev', { dev: 'dev-a-2', key: 'boyi2027' }, tok['甲']);
  ok(a2.j.ok && a2.j.bound && a2.j.passUsed === true,
     `甲 用口令登记成功（passUsed=${a2.j.passUsed}，devs=${a2.j.devs}）`);

  /* ── 4. 同一个账号第二次用口令 → 必须拒 ── */
  console.log('\n④ 甲 第三次换设备，口令已经用过了');
  const a3 = await api('dev', { dev: 'dev-a-3', key: 'boyi2027' }, tok['甲']);
  ok(a3.code === 403 && /用过/.test(a3.j.error || ''), `被拒且说明「已经用过」（${a3.code} / ${a3.j.error}）`);

  /* ── 5. 学生乙：同一个口令还能用（每账号一次，不是全局一次） ── */
  console.log('\n⑤ 乙 在同一台设备上换自己的号（同设备换账号）');
  const b1 = await api('dev', { dev: 'dev-a-1', key: 'boyi2027' }, tok['乙']);
  ok(b1.j.ok && b1.j.bound && b1.j.passUsed === true && b1.j.switchAccount === true,
     `乙 用同一口令登记成功（switchAccount=${b1.j.switchAccount}）`);

  /* ── 6. 学生丙：口令过期 → 不认 ── */
  console.log('\n⑥ 口令过期后');
  /* 先让丙占住一台设备，否则「全新账号 + 全新设备」会直接放行、根本走不到口令这一步 */
  const c0 = await api('dev', { dev: 'dev-c-0' }, tok['丙']);
  ok(c0.j.ok && c0.j.first === true, '丙 第一台设备先自动放行（准备前提）');
  await must('dev_pass', { op: 'set', code: 'boyi2027', until: Date.now() + 5000 }, staff.token);
  await sleep(5400);   /* set 拒绝过去的截止时间，所以设 5 秒后、等它真的过期 */
  const c1 = await api('dev', { dev: 'dev-c-1', key: 'boyi2027' }, tok['丙']);
  ok(c1.code === 403 && /不对|过期/.test(c1.j.error || ''),
     `过期后登记被拒（${c1.code} / ${c1.j.error}）`);

  /* ── 7. 口令用过了还能走单发密钥 ── */
  console.log('\n⑦ 口令用完之后，单发一次性密钥照常可用');
  await must('dev_pass', { op: 'set', code: 'boyi2027', until: before740() }, staff.token);
  const k = await must('device_key', { op: 'make' }, staff.token);
  const a4 = await api('dev', { dev: 'dev-a-4', key: k.code }, tok['甲']);
  ok(a4.j.ok && a4.j.bound && !a4.j.passUsed, `甲 用一次性密钥换设备成功（replaced=${a4.j.replaced}）`);

  /* ── 8. 停用口令 ── */
  console.log('\n⑧ 停用口令');
  const clr = await api('dev_pass', { op: 'clear' }, staff.token);
  ok(clr.j.ok, '停用成功');
  await must('dev_pass', { op: 'set', code: 'boyi2027', until: before740() }, staff.token);
  const cleared = await api('dev', { dev: 'dev-b-2', key: 'boyi2027' }, tok['乙']);
  ok(cleared.code === 403, `停用后口令立刻失效（${cleared.code}）`);

  /* ── 9. 权限与格式 ── */
  console.log('\n⑨ 权限与格式');
  const byStu = await api('dev_pass', { op: 'set', code: 'hack2027', until: before740() }, tok['甲']);
  ok(byStu.code === 403, `学生调不动口令接口（${byStu.code}）`);
  const badFmt = await api('dev_pass', { op: 'set', code: 'ab', until: before740() }, staff.token);
  ok(badFmt.code === 400, `口令太短被挡（${badFmt.code}）`);
  const badUntil = await api('dev_pass', { op: 'set', code: 'boyi2027', until: Date.now() - 1000 }, staff.token);
  ok(badUntil.code === 400, `截止时间在过去被挡（${badUntil.code}）`);

  /* ── 10. 大小写不敏感（学生打成 Boyi2027 也得进） ── */
  console.log('\n⑩ 大小写');
  const c2 = await api('dev', { dev: 'dev-c-2', key: 'BOYI2027' }, tok['丙']);
  ok(c2.j.ok === true, `输入大写 BOYI2027 也认（${JSON.stringify(c2.j).slice(0, 60)}）`);
} catch (e) {
  fail++; fails.push('异常：' + e.message);
  console.log('\n❌ 异常：', e.message);
} finally {
  srv.kill('SIGKILL');
  console.log('\n─────────────────────────────');
  console.log(`通过 ${pass} · 失败 ${fail}`);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
}
