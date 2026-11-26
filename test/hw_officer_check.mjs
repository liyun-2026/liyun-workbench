/**
 * ==5.75== 班委登记作业：端到端链路体检
 *   node test/hw_officer_check.mjs [端口]
 *
 * 用户 2026-11-26 报的两件事：
 *   ① 班委晚上统计完当晚作业，教务端还是空白、没有统计痕迹
 *   ② 有两个班委连「登记今晚作业」的入口都看不到
 *
 * 这个脚本直接打真后端（dev-server 跑的就是 edge-functions/api/sync.js，
 * 只把 Blob 换成内存版），按真实身份链走一遍：
 *   建号 → 教务布置作业 + 指定班干部 → 班委拉取（看入口条件齐不齐）
 *   → 班委登记 → 教务拉取（看有没有落账、有没有盖章）
 *   → 普通学生拉取（看他是不是也能拿到全班的登记 = 越权）
 *
 * 只读断言，不改生产数据；跑完自动 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5477);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0, total = 0;
const ok = (c, m, extra) => {
  total++;
  if (!c) failed++;
  console.log((c ? '  ✅ ' : '  ❌ ') + m + (c || !extra ? '' : '\n        → ' + extra));
};
const section = (t) => console.log('\n' + t);

const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function api(body) {
  const r = await fetch(`${BASE}/api/sync`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function login(user, pass) {
  let r = await api({ action: 'register', user, pass });
  if (r.j && r.j.error) r = await api({ action: 'login', user, pass });
  if (!r.j || !r.j.token) throw new Error(`登录 ${user} 失败：${JSON.stringify(r.j)}`);
  return r.j.token;
}

let server;
try {
  server = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], {
    cwd: dir, stdio: 'ignore', env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"hello"}' }); if (r.ok) break; } catch { /* 等 */ }
    await sleep(300);
  }
  await api({ action: 'dev_reset' }).catch(() => {});
  await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }).catch(() => {});

  /* ── 1. 教务：建班、建学员、布置作业、指定两名班干部 ── */
  section('▶ 1. 教务侧铺数据');
  const admin = await login('检查教务', 'check-pass-1234');
  const students = ['张一', '李二', '王三', '赵四', '钱五'].map((name, i) => ({
    id: 's' + (i + 1), name, classId: 'c1', ord: i + 1,
  }));
  const push1 = await api({
    action: 'push', token: admin,
    shared: {
      classes: [{ id: 'c1', name: '05班' }],
      students,
      homework: [{ id: 'h1', clsId: 'c1', date: TODAY, text: '普通话声母练习 20 分钟', abbr: '普' }],
      /* 两个班委：一个正常挂档（s1），一个**账号没挂到学员档案**（s2 的号不建 studentId） */
      officers: [
        { id: 'o1', clsId: 'c1', title: '学习委员', studentId: 's1' },
        { id: 'o2', clsId: 'c1', title: '班长', studentId: 's2' },
      ],
    },
  });
  ok(push1.status === 200 && push1.j.ok, '教务推送班级 / 学员 / 作业 / 班干部名单', JSON.stringify(push1.j).slice(0, 200));

  /* 账号：s1 正常挂档；s2 的「班长」号故意不挂 studentId（这是现场最可能的成因）；s3 普通学生 */
  const mk = (user, role, studentId) => api({
    action: 'users', token: admin, op: 'create',
    user, pass: 'stu-pass-1234', role: 'student', name: user, studentId,
  });
  const a1 = await mk('班委一', 'student', 's1');
  const a2 = await mk('班委二', 'student', '');
  const a3 = await mk('普通生', 'student', 's3');
  ok(a1.j.ok && a2.j.ok && a3.j.ok, '建 3 个学生号（班委一挂 s1 / 班委二不挂档 / 普通生挂 s3）',
     JSON.stringify([a1.j, a2.j, a3.j]).slice(0, 250));

  /* ── 2. 班委一：拉取后能拿到什么？入口条件齐不齐 ── */
  section('▶ 2. 班委一（已挂档）登录后看到的数据');
  const t1 = await login('班委一', 'stu-pass-1234');
  const p1 = await api({ action: 'pull', token: t1 });
  const sh1 = p1.j.shared || {};
  ok((sh1.officers || []).some((o) => o && o.studentId === 's1' && o.title),
     '拿得到「我是学习委员」这条（入口的第一个条件）',
     'officers = ' + JSON.stringify(sh1.officers || []));
  ok((sh1.students || []).length >= 5, '拿得到本班 5 名同学（登记名单要用）',
     'students = ' + (sh1.students || []).length + ' 条');
  ok((sh1.homework || []).some((h) => h && h.id === 'h1' && h.date === TODAY),
     '拿得到今晚这条作业（入口的第二个条件）',
     'homework = ' + JSON.stringify((sh1.homework || []).map((h) => h.id + '@' + h.date)));

  /* ── 3. 班委二：账号没挂学员档案，会怎样 ── */
  section('▶ 3. 班委二（账号未挂学员档案）登录后看到的数据');
  const t2 = await login('班委二', 'stu-pass-1234');
  const p2 = await api({ action: 'pull', token: t2 });
  const sh2 = p2.j.shared || {};
  ok((sh2.officers || []).length === 0 && (sh2.students || []).length === 0 && (sh2.homework || []).length === 0,
     '服务端确认不了他是谁 → 一份数据都不下发（已知且正确的隔离行为）',
     `officers = ${(sh2.officers || []).length} 条、students = ${(sh2.students || []).length} 条、homework = ${(sh2.homework || []).length} 条`);
  console.log('        ↳ 这就是「看不到入口」的根因。前端已改为明说原因 + 给出补挂办法');
  console.log('          （见 test/hw_merge_check.mjs §4：作业页会显示「还没和名册里的学籍对上」）');

  /* ── 4. 班委一登记作业 ── */
  section('▶ 4. 班委一替全班登记「谁交了」');
  const hwRecs = students.slice(0, 3).map((s) => ({ id: 'r_' + s.id, studentId: s.id, done: 1 }));
  hwRecs.push({ id: 'r_s4', studentId: 's4', done: 0 });
  const push2 = await api({ action: 'push', token: t1, shared: { 'hw:h1': hwRecs } });
  ok(push2.status === 200 && push2.j.ok, '班委一推送成功', JSON.stringify(push2.j).slice(0, 200));

  /* ── 5. 教务拉回来：有没有落账、有没有盖章 ── */
  section('▶ 5. 教务端拉回来（用户说这里是空白）');
  const pa = await api({ action: 'pull', token: admin });
  const got = (pa.j.shared || {})['hw:h1'] || [];
  const byStu = Object.fromEntries(got.map((x) => [x.studentId, x]));
  ok(got.length >= 4, '教务端拿得到班委登记的 4 条', '实际 ' + got.length + ' 条：' + JSON.stringify(got.map((x) => x.studentId + '=' + x.done)));
  ok(byStu.s2 && byStu.s2.done === 1, 's2 的「已交」落账了', JSON.stringify(byStu.s2));
  ok(!!(byStu.s2 && byStu.s2.by), '记录上盖了「登记人」', JSON.stringify(byStu.s2 && byStu.s2.by));
  ok(byStu.s4 && byStu.s4.done === 0, 's4 的「未交」落账了', JSON.stringify(byStu.s4));

  /* ── 6. 班委一自己拉回来：再点一下能不能变成「未交」（三态切换要读得到自己的记录）── */
  const p1b = await api({ action: 'pull', token: t1 });
  const own = (p1b.j.shared || {})['hw:h1'] || [];
  ok(own.length >= 4, '班委一自己拉得回全班的登记（否则第二次点会重复写）', '实际 ' + own.length + ' 条');

  /* ── 7. 越权：普通学生能不能写别人的登记 ── */
  section('▶ 7. 越权检查：普通学生写全班登记');
  const t3 = await login('普通生', 'stu-pass-1234');
  await api({ action: 'push', token: t3, shared: { 'hw:h1': [{ id: 'evil', studentId: 's5', done: 1 }] } });
  const pa2 = await api({ action: 'pull', token: admin });
  const got2 = (pa2.j.shared || {})['hw:h1'] || [];
  ok(!got2.some((x) => x.studentId === 's5'), '普通学生伪造的 s5 记录被服务端拦掉了',
     '实际拿到了：' + JSON.stringify(got2.map((x) => x.studentId)));
  const p3 = await api({ action: 'pull', token: t3 });
  ok(((p3.j.shared || {})['hw:h1'] || []).every((x) => x.studentId === 's3'),
     '普通学生拉取只看到自己那一条（看不到别人交没交）',
     JSON.stringify(((p3.j.shared || {})['hw:h1'] || []).map((x) => x.studentId)));
} catch (e) {
  console.log('\n❌ 脚本中断：' + (e && e.message));
  failed++;
} finally {
  try { await fetch(`${BASE}/api/dev-reset`, { method: 'POST' }); } catch { /* 清场 */ }
  try { server && server.kill('SIGKILL'); } catch { /* 已退 */ }
}

console.log('\n' + '─'.repeat(40));
console.log(failed ? `❌ 失败 ${failed} / ${total} 项` : `✅ 全部通过（${total} 项）`);
if (failed) process.exitCode = 1;
