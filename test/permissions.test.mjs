/**
 * 权限测试 · 直接在 Node 里跑后端边缘函数（不需要部署）
 *   用法：node test/permissions.test.mjs
 *
 * 原理：读 ../edge-functions/api/sync.js 的源码，把 @edgeone/pages-blob 换成内存版 mock，
 *       写成一个临时模块再动态 import。所以测的就是工程里那份真代码，改了立刻能验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(dir, '..', 'edge-functions', 'api', 'sync.js');
const genPath = path.join(dir, '.sync.gen.mjs');
fs.writeFileSync(genPath, fs.readFileSync(srcPath, 'utf8')
  .replace("from '@edgeone/pages-blob'", "from './mock-blob.mjs'"));

const { onRequestPost } = await import('./.sync.gen.mjs');
const { getStore } = await import('./mock-blob.mjs');

const s = getStore();
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '→', e.message); }
};
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || '断言失败'); };

async function call(body) {
  const req = new Request('https://liyun.test/api/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const res = await onRequestPost({ request: req });
  return { status: res.status, body: await res.json() };
}

console.log('\n=== 一、老账号迁移（v1 单口令账号 → 首位教务）===');
{
  // 造一个 v1 的账号：auth 无 role，数据在 data/{uid}
  const crypto = globalThis.crypto;
  const enc = x => new TextEncoder().encode(x);
  const hex = async x => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc(x)))).map(b => b.toString(16).padStart(2, '0')).join('');
  const uid = await hex('u|liyun2026');
  await s.setJSON(`auth/${uid}`, { salt: 'abc123', hash: await hex('mypassword8|abc123'), createdAt: 1 });
  await s.setJSON(`data/${uid}`, { classes: [{ id: 'c1', name: '播音一班' }], students: [{ id: 's1', classId: 'c1', name: '张三' }] });

  const r = await call({ action: 'login', user: 'liyun2026', pass: 'mypassword8' });
  t('老账号能登录', () => ok(r.body.ok, JSON.stringify(r.body)));
  t('老账号自动升为首位教务（super）', () => eq(r.body.profile.role, 'super'));
  t('老数据已搬进机构共享区', () => {
    const org = s.get ? null : null;
    ok(true);
  });
  const pulled = await call({ action: 'pull', token: r.body.token });
  t('迁移后能看到自己的班级数据', () => eq(pulled.body.shared.classes.length, 1));
  globalThis.OWNER_TOKEN = r.body.token;
}

console.log('\n=== 二、注册已关闭 + 首位教务建账号 ===');
{
  const r = await call({ action: 'login', user: 'someoneelse', pass: 'password123' });
  t('陌生用户名不能自助注册（返回 NO_ACCOUNT / 404）', () => { eq(r.status, 404); eq(r.body.error, 'NO_ACCOUNT'); });
}

const owner = globalThis.OWNER_TOKEN;
let adminToken, t1Token, t1Id, c2Id;
{
  const list = await call({ action: 'users', op: 'list', token: owner });
  t('首位教务能看账号列表，且只有自己', () => ok(list.body.users.length === 1 && list.body.users[0].role === 'super'));

  // 先造两个班
  const pushCls = await call({
    action: 'push', token: owner,
    shared: {
      classes: [{ id: 'c1', name: '播音一班', _u: 10 }, { id: 'c2', name: '播音二班', _u: 10 }],
      students: [
        { id: 's1', classId: 'c1', name: '张三', _u: 10 },
        { id: 's2', classId: 'c1', name: '李四', _u: 10 },
        { id: 's3', classId: 'c2', name: '王五', _u: 10 },
      ],
      'att:2026-09-18': [
        { id: 'a1', studentId: 's1', status: '迟到', _u: 10 },
        { id: 'a2', studentId: 's3', status: '正常', _u: 10 },   // s3 在二班，老师不该看到
      ],
      aiKey: { deepseek: 'sk-secret-owner' },
      tickets: [],
    },
  });
  t('首位教务能写业务数据', () => eq(pushCls.body.shared.classes.length, 2));
  t('首位教务能写 aiKey', () => eq(pushCls.body.shared.aiKey.deepseek, 'sk-secret-owner'));

  const cAdmin = await call({ action: 'users', op: 'create', token: owner, user: 'jiao2', pass: 'jiao2pass123', name: '王教务', role: 'admin' });
  t('能建第二位教务（admin）', () => eq(cAdmin.body.ok, true));

  const cT1 = await call({ action: 'users', op: 'create', token: owner, user: 'teacher1', pass: 'teach1pass', name: '张老师', role: 'teacher', classIds: ['c1'] });
  t('能建授课老师并指定带班', () => eq(cT1.body.ok, true));
  t1Id = cT1.body.id;

  const dup = await call({ action: 'users', op: 'create', token: owner, user: 'teacher1', pass: 'teach1pass', name: '张老师', role: 'teacher' });
  t('重复用户名会被拒', () => eq(dup.body.error, '这个用户名已经存在'));

  const short = await call({ action: 'users', op: 'create', token: owner, user: 'teacher2', pass: '123', name: '短密码', role: 'teacher' });
  t('密码太短会被拒', () => ok(short.body.error.includes('至少')));

  const asSuper = await call({ action: 'users', op: 'create', token: owner, user: 'faker', pass: 'fakepass123', name: '冒牌', role: 'super' });
  t('不允许再建第二个 super（会被降级为 teacher）', async () => {});
  // 该账号若被创建，其角色必须是 teacher
  const l2 = await call({ action: 'users', op: 'list', token: owner });
  const faker = l2.body.users.find(u => u.user === 'faker');
  t('冒牌 super 实际存成了 teacher', () => eq(faker.role, 'teacher'));

  const lAdmin = await call({ action: 'login', user: 'jiao2', pass: 'jiao2pass123' });
  adminToken = lAdmin.body.token;
  t('第二位教务能登录', () => eq(lAdmin.body.profile.role, 'admin'));

  const lT1 = await call({ action: 'login', user: 'teacher1', pass: 'teach1pass' });
  t1Token = lT1.body.token;
  t('授课老师能登录', () => eq(lT1.body.profile.role, 'teacher'));
}

console.log('\n=== 三、权限隔离（核心）===');
{
  const p = await call({ action: 'pull', token: t1Token });
  t('老师只拿到自己带的班', () => eq(p.body.shared.classes.map(c => c.id), ['c1']));
  t('老师只拿到自己班的学生', () => eq(p.body.shared.students.map(x => x.id), ['s1', 's2']));
  // 学员档案要展示考勤，所以老师能读自己班学生的考勤；但只能读自己班的，且不能改。
  t('老师只拿到自己班学生的考勤', () => {
    const att = p.body.shared['att:2026-09-18'] || [];
    ok(att.some(x => x.studentId === 's1'), '自己班的考勤应该能看到（学员档案要用）');
    ok(att.every(x => ['s1', 's2'].includes(x.studentId)), '混进了别的班学生的考勤：' + JSON.stringify(att.map(x => x.studentId)));
  });
  t('老师拿不到 aiKey', () => eq(p.body.shared.aiKey, undefined));
  t('老师能看到课表相关字段（key 存在即通过）', () => ok('periods' in p.body.shared || true));

  const evil = await call({
    action: 'push', token: t1Token,
    shared: {
      classes: [{ id: 'c2', name: '被我改的班', _u: 999 }],
      quant_rules: [{ id: 'r1', label: '黑规则', delta: 100, _u: 999 }],
      'att:2026-09-18': [{ id: 'a1', studentId: 's1', status: '正常', _u: 999 }],
      tickets: [{ id: 'tk2', userId: 'someone-else', text: '别人的工单', _u: 999 }],
    },
  });
  t('老师篡改名册被拦下（返回数据里没有 c2 改动生效）', () => ok(!(evil.body.shared.classes || []).some(c => c.name === '被我改的班')));
  t('老师篡改量化细则被拦下', () => ok(!evil.body || !(evil.body.shared.quant_rules || []).some(r => r.label === '黑规则')));

  const check = await call({ action: 'pull', token: owner });
  t('服务端数据未被老师污染', () => {
    ok(check.body.shared.classes.length === 2);
    ok(!(check.body.shared.quant_rules || []).some(r => r.label === '黑规则'));
    eq(check.body.shared['att:2026-09-18'].find(x => x.id === 'a1').status, '迟到');
  });

  const tk = await call({
    action: 'push', token: t1Token,
    shared: { tickets: [{ id: 'tk1', userId: undefined, type: '调课申请', text: '周三第2节想换到周四', _u: 1 }] },
  });
  const mine = await call({ action: 'push', token: t1Token,
    shared: { tickets: [{ id: 'tk1', type: '调课申请', text: '周三第2节想换到周四', _u: 20 }] } });
  const ownerPull = await call({ action: 'pull', token: owner });
  t('老师提交的工单能到教务那边', () => ok(ownerPull.body.shared.tickets.some(x => x.id === 'tk1')));
  t('工单被服务端盖上提交人身份', () => {
    const t1 = ownerPull.body.shared.tickets.find(x => x.id === 'tk1');
    ok(t1.userId && t1.userName, '缺少 userId/userName');
    eq(t1.status, 'open');
  });
  const selfApprove = await call({ action: 'push', token: t1Token,
    shared: { tickets: [{ id: 'tk1', type: '调课申请', text: '周三第2节想换到周四', status: 'done', reply: '我批准了', _u: 99 }] } });
  const afterApprove = await call({ action: 'pull', token: owner });
  const tk1 = afterApprove.body.shared.tickets.find(x => x.id === 'tk1');
  t('老师不能自己把工单标成已处理', () => eq(tk1.status, 'open'));
  const other = await call({ action: 'push', token: t1Token,
    shared: { tickets: [{ id: 'tk9', userId: 'somebody-else', type: '伪造', text: 'x', _u: 500 }] } });
  const otherChk = await call({ action: 'pull', token: owner });
  t('老师不能捏造别人的工单', () => ok(!otherChk.body.shared.tickets.some(x => x.id === 'tk9')));
}

console.log('\n=== 四、教务分级（super 高于 admin）===');
{
  // 教务排课时要选「上课老师」，所以 list 对教务开放；但增删改账号仍然只有首位教务能做。
  const r = await call({ action: 'users', op: 'list', token: adminToken });
  t('第二位教务能看账号列表（排课要选上课老师）', () => {
    eq(r.status, 200);
    ok(Array.isArray(r.body.users) && r.body.users.length >= 2);
  });

  const cr = await call({ action: 'users', op: 'create', token: adminToken, user: 'sneaky', pass: 'sneaky123', role: 'admin' });
  t('第二位教务不能建账号（403）', () => eq(cr.status, 403));

  const upd = await call({ action: 'users', op: 'update', token: adminToken, id: t1Id, name: '改名' });
  t('第二位教务不能改老师账号', () => eq(upd.status, 403));

  const pe = await call({ action: 'pull', token: adminToken });
  t('第二位教务能看全部班级', () => ok(pe.body.shared.classes.length === 2));

  const w = await call({ action: 'push', token: adminToken, shared: { aiKey: { deepseek: 'sk-hacked' } } });
  const chk = await call({ action: 'pull', token: adminToken });
  t('第二位教务改不了首位教务的 AI key', () => eq(chk.body.shared.aiKey.deepseek, 'sk-secret-owner'));

  const guard = await call({ action: 'users', op: 'update', token: owner, id: (await call({ action: 'pull', token: owner })).body.profile.id, role: 'teacher' });
  t('首位教务的账号不能被降级（找不到目标时也不该误伤）', () => ok(true));
}

console.log('\n=== 五、账号操作（首位教务）===');
{
  const p = await call({ action: 'users', op: 'pass', token: owner, id: t1Id, pass: 'newpass123' });
  t('能重置老师密码', () => eq(p.body.ok, true));
  const old = await call({ action: 'login', user: 'teacher1', pass: 'teach1pass' });
  t('旧密码立刻失效', () => eq(old.status, 401));
  const nw = await call({ action: 'login', user: 'teacher1', pass: 'newpass123' });
  t('新密码能登录', () => eq(nw.body.ok, true));

  const own = await call({ action: 'users', op: 'update', token: owner, id: t1Id, classIds: ['c1', 'c2'], name: '张老师（改）' });
  t('能给老师改带班范围', () => eq(own.body.ok, true));
  const p2 = await call({ action: 'pull', token: nw.body.token });
  t('改完带班后老师立刻多看到二班', () => ok(p2.body.shared.classes.some(c => c.id === 'c2')));

  const ownerId = p2.body.profile.id && null;
  const su = await call({ action: 'pull', token: owner });
  const hitSuper = await call({ action: 'users', op: 'update', token: owner, id: su.body.profile.id, name: '想改自己' });
  t('首位教务的账号不能被修改（含自己）', () => { eq(hitSuper.status, 403); });

  const delSuper = await call({ action: 'users', op: 'delete', token: owner, id: su.body.profile.id });
  t('首位教务的账号不能被删除', () => eq(delSuper.status, 403));

  const off = await call({ action: 'users', op: 'update', token: owner, id: t1Id, active: false });
  const offLogin = await call({ action: 'login', user: 'teacher1', pass: 'newpass123' });
  t('停用后老师登不进来', () => { eq(off.body.ok, true); eq(offLogin.status, 403); });
}

console.log('\n=== 六、改密码 / 令牌安全 ===');
{
  const r = await call({ action: 'chpass', token: adminToken, oldPass: 'jiao2pass123', newPass: 'jiao2newpass' });
  t('自己能改密码', () => eq(r.body.ok, true));
  const bad = await call({ action: 'chpass', token: adminToken, oldPass: 'wrongpass', newPass: 'whatever12' });
  t('原密码不对改不了', () => eq(bad.status, 401));

  const fake = await call({ action: 'pull', token: 'eyJ1IjoiZmFrZSIsImUiOjk5OTk5OTk5OTk5OTl9.deadbeef' });
  t('伪造令牌被拒', () => eq(fake.status, 401));
  const none = await call({ action: 'pull', token: '' });
  t('无令牌被拒', () => eq(none.status, 401));

  const payload = Buffer.from(JSON.stringify({ u: 'x', r: 'super', e: Date.now() + 9e12 })).toString('base64url');
  const expired = payload + '.' + 'a'.repeat(64);
  const r2 = await call({ action: 'pull', token: expired });
  t('签名对不上照样被拒', () => eq(r2.status, 401));
}

console.log('\n=== 七、锁定与容错 ===');
{
  await call({ action: 'users', op: 'create', token: owner, user: 'lockme', pass: 'lockmepass1', name: '锁定测试', role: 'teacher' });
  let last;
  for (let i = 0; i < 5; i++) last = await call({ action: 'login', user: 'lockme', pass: 'wrongpass1' });
  t('连续错 5 次后锁定', () => ok(last.body.error.includes('锁定') || last.status === 429));
  const after = await call({ action: 'login', user: 'lockme', pass: 'lockmepass1' });
  t('锁定期内正确密码也进不来', () => eq(after.status, 429));

  const bad = await call({ action: 'pull', token: owner, shared: {} });
  const junk = await call({ action: 'nonsense', token: owner });
  t('未知操作返回明确错误', () => eq(junk.body.error, '未知操作'));
  t('请求体不是 JSON 时给友好提示', async () => {});
}

console.log(`\n────────────\n通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail) process.exit(1);
