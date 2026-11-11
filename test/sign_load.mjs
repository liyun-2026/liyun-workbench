/**
 * 全班并发打卡压测（==5.28== 上线前整改 · dev only，绝不指向生产）
 *
 *   node test/sign_load.mjs [人数=30] [轮数=1]
 *
 * 场景：dev 库建一个 30 人压测班，30 个学生账号**同一瞬间**并发打卡，
 *       双码通道（扫现码 scan / 手输 manual）各半 —— 服务端两条路本就是同一枚动态码，
 *       差别只在客户端取码方式，API 层面完全一致。
 * 测什么：
 *   · 成功率（ok:true 且状态正常/迟到）
 *   · p95 延迟
 *   · 无丢写（sign:{今天} 必须恰好 30 条、id 唯一、30 个学员一个不少）
 *   · 无重复写（一人一条，重复打卡是覆盖不堆叠）
 *   · 考勤汇总正确（att:{今天} 30 条、全正常）
 * 退出码：0 = 全过，1 = 有失败。
 */
for (const k of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SIGN_LOAD_PORT || 5621);
const BASE = `http://127.0.0.1:${PORT}`;
const N = Number(process.argv[2] || 30);
const ROUNDS = Number(process.argv[3] || 1);
const PASS = 'liyun2026';

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jfetch = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(15000) });
async function waitFor(fn, { tries = 60, gap = 500, what = '目标' } = {}) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(gap); }
  throw new Error('等不到' + what);
}
async function api(body) {
  const t0 = Date.now();
  const r = await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  return { j, ms: Date.now() - t0 };
}
function pct(arr, p) { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.ceil(a.length * p) - 1)]; }

let server;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { cwd: dir, stdio: 'ignore' });
  await waitFor(async () => (await jfetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' })).ok, { what: 'dev 服务' });
  await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' });
  console.log(`dev 服务就绪 → ${BASE} · ${N} 人 × ${ROUNDS} 轮\n`);

  console.log('=== 准备：super 建班 + 30 学员 + 30 账号 + 打卡规则 ===');
  const sup = await api({ action: 'login', user: '李老师', pass: PASS });
  ok(sup.j.ok && sup.j.profile.role === 'super', 'super 首建登录');
  const sTok = sup.j.token;
  const students = Array.from({ length: N }, (_, i) => ({
    id: 'stu_l' + String(i + 1).padStart(2, '0'),
    name: '压测学生' + String(i + 1).padStart(2, '0'),
    classId: 'cls_load',
  }));
  const push1 = await api({ action: 'push', token: sTok, shared: {
    classes: [{ id: 'cls_load', name: '砺蕴压测班' }], students } });
  ok(push1.j.ok, `班级 + ${N} 学员档案已推`);
  const mk = await api({ action: 'users', token: sTok, op: 'createMany', classIds: [],
    list: students.map(st => ({ user: st.name, pass: PASS, role: 'student', name: st.name, studentId: st.id })) });
  ok(mk.j.ok && mk.j.n === N && (mk.j.fail || []).length === 0, `${N} 个学生账号已建（失败 ${JSON.stringify(mk.j.fail || [])}）`);
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const startAt = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const rules = await api({ action: 'push', token: sTok, shared: {
    sign_rules: { startAt, lateAfter: 5, windowBefore: 120, windowAfter: 60, mode: 'code', pid: 'am', lat: 31.0, lng: 121.0, radius: 150 } } });
  ok(rules.j.ok, '打卡规则已推（startAt=' + startAt + ' · 校区坐标半径 150m）');

  console.log('\n=== 学生并发登录 ===');
  const t0 = Date.now();
  const logins = await Promise.all(students.map(st => api({ action: 'login', user: st.name, pass: PASS })));
  const loginMs = Date.now() - t0;
  ok(logins.every(x => x.j.ok && x.j.profile.role === 'student'), `30 个学生登录全过（耗时 ${loginMs}ms）`);
  const tokens = logins.map(x => x.j.token);

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n=== 第 ${round} 轮：30 人双通道同时打卡 ===`);
    const code = await api({ action: 'code', token: sTok });
    ok(code.j.ok && /^\d{6}$/.test(code.j.code), '取到当前动态码 ' + code.j.code + '（剩 ' + code.j.left + 'ms）');

    const t1 = Date.now();
    const results = await Promise.all(students.map((st, i) => api({
      action: 'sign', token: tokens[i],
      code: code.j.code,                      // 扫现码 / 手输 —— 同一枚码
      lat: 31.0 + (i % 5) * 0.00001, lng: 121.0, acc: 20,
      dev: i < N / 2 ? 'scan-' + st.id : 'manual-' + st.id,   // 双通道标记
    })));
    const wall = Date.now() - t1;
    const lat = results.map(x => x.ms);
    const bad = results.filter(x => !(x.j.ok && (x.j.status === '正常' || x.j.status === '迟到')));
    const okN = results.length - bad.length;
    ok(okN === N, `成功率 ${okN}/${N}`);
    if (bad.length) bad.slice(0, 5).forEach(b => console.log('    失败详情：' + JSON.stringify(b.j).slice(0, 120)));
    console.log(`    延迟 p50=${pct(lat, 0.5)}ms · p95=${pct(lat, 0.95)}ms · max=${Math.max(...lat)}ms · 整轮墙钟 ${wall}ms`);

    const pull = await api({ action: 'pull', token: sTok });
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const signs = pull.j.shared['sign:' + today] || [];
    const atts = pull.j.shared['att:' + today] || [];
    const uniqIds = new Set(signs.map(x => x.id));
    ok(signs.length === N, `服务端无丢写：sign:${today} 恰好 ${N} 条（实际 ${signs.length}）`);
    ok(uniqIds.size === N, `无重复写：${N} 个学员 id 唯一（去重后 ${uniqIds.size}）`);
    ok(students.every(st => uniqIds.has(st.id)), '30 个学员一个不少');
    ok(atts.length === N && atts.every(a => a.status === '正常'), `考勤汇总正确：att:${today} ${atts.length} 条全「正常」`);
    const scanN = signs.filter(x => (x.dev || '').startsWith('scan-')).length;
    const manN = signs.filter(x => (x.dev || '').startsWith('manual-')).length;
    ok(scanN === N / 2 && manN === N / 2, `双通道都落账：扫码 ${scanN} + 手输 ${manN}`);
  }

  console.log('\n────');
  console.log(`通过 ${pass} / ${pass + fail} 项`);
} catch (e) {
  console.log('❌ 脚本异常：' + e.message); fail++;
} finally {
  try { server && server.kill(); } catch {}
  try { await jfetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch {}
}
process.exit(fail ? 1 : 0);
