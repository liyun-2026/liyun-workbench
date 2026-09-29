/**
 * 学生端测试 · 直接在 Node 里跑后端边缘函数（不需要部署）
 *   用法：node test/student_check.mjs
 *
 * 覆盖三件事：
 *   ① 学生能看到什么 —— 只能看到自己的，别人的一条都拿不到
 *   ② 学生能写什么   —— 只有打卡和本人请假，其余一律被服务端拒绝
 *   ③ 打卡判定       —— 时间、迟到、动态码、距离全部由服务端定
 * 硬指标：学生账号登录同步一圈，教务端的数据一条都不能少。
 *
 * v47 增补（用户 2026-09-29 的四项要求）：
 *   · 位置密钥：定位不准 → 服务端直接拒（GEOFAR），拿教务那枚 4 位码才放行
 *   · 班干部：本班同学的姓名只给班干部，且只截 id/name/classId 三个字段
 *   · 作业登记：班干部能替全班写 hw:，服务端盖上「谁登记的」
 *   · 学生消息：学生能给教务发消息（落成工单），收件人名单只给教务号
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(dir, '..', 'edge-functions', 'api', 'sync.js');
const genPath = path.join(dir, '.sync.student.mjs');
fs.writeFileSync(genPath, fs.readFileSync(srcPath, 'utf8')
  .replace("from '@edgeone/pages-blob'", "from './mock-blob.mjs'"));

const { onRequestPost } = await import('./.sync.student.mjs');
const { getStore } = await import('./mock-blob.mjs');

const s = getStore();
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '→', e.message); }
};
const ta = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✅', name); }
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
const must = async (body) => {
  const r = await call(body);
  if (!r.body || r.body.error) throw new Error('服务端拒绝了：' + (r.body && r.body.error) + '（HTTP ' + r.status + '）');
  return r.body;
};

/* 北京时间 HH:MM（服务端一律按 +8 算，测试也要跟着）
   ⚠️ 跨午夜要夹回当天边界：用例写的是「上课在 30 分钟前」，若在 00:29 跑，
      算出来是昨天的 23:59，服务端按「今天」判就成了窗口外 → 假红。
      这不是代码 bug，是测试挑的时间不巧，所以这里夹一下（夜里跑也准）。 */
function cnHM(offsetMin = 0) {
  const base = Date.now() + 8 * 3600e3;
  const d = new Date(base + offsetMin * 60e3);
  let h, m;
  if (d.getUTCDate() !== new Date(base).getUTCDate()) {
    h = offsetMin < 0 ? 0 : 23;      // 往前跨 → 当天 00:00；往后跨 → 当天 23:59
    m = offsetMin < 0 ? 0 : 59;
  } else {
    h = d.getUTCHours(); m = d.getUTCMinutes();
  }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
/* 现在（北京时间）是当天的第几分钟 —— 服务端判迟到就是这么切的（p.min）。
   用来把「迟到该是几分钟」从写死的 30 改成按实际起点倒推：
   00:29 那种点跑的时候 cnHM 会把起点夹到 00:00，写死 30 必然假红。 */
function cnMinNow() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** "HH:MM" → 当天第几分钟 */
const hm2min = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
/** 直接改共享区里的打卡设置（绕开 push 的合并语义，测试意图才精确） */
async function setRules(r) {
  const data = (await s.get('org/data', { type: 'json' })) || {};
  if (r === null) delete data.sign_rules; else data.sign_rules = r;
  await s.setJSON('org/data', data);
}
/** 直接塞几枚位置密钥 —— 等价于教务在打卡页点「生成 / 更新」 */
async function setKeys(list) {
  const data = (await s.get('org/data', { type: 'json' })) || {};
  data.sign_keys = list;
  await s.setJSON('org/data', data);
}
/** 合并几段共享数据（班干部名单、作业等），返回改完后的整份 */
async function patchOrg(patch) {
  const data = (await s.get('org/data', { type: 'json' })) || {};
  Object.assign(data, patch);
  await s.setJSON('org/data', data);
  return data;
}
/** 服务端算「今天」的方式：北京时间，取日期那一段 */
const todayCN = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
/* 零宽限：lateAfter = 0，到点就迟到（教务那边的默认也是 0） */
const RULES_OK = (startOff) => ({
  startAt: cnHM(startOff), lateAfter: 0, windowBefore: 60, windowAfter: 30,
  radius: 150, lat: 34.75, lng: 113.62, pid: 'am',
});

const SU = '首位教务', SU_PASS = 'liyun2026';
const T1 = '张老师', S1 = '学生甲', S2 = '学生乙';

console.log('\n=== 一、建号：学生账号挂 studentId ===');

let su, t1, s1, s2;
let clsId = 'c1', sid1 = 'stu1', sid2 = 'stu2';

await ta('首位教务初始化', async () => {
  su = (await must({ action: 'login', user: SU, pass: SU_PASS }));
  ok(su.profile.isStaff, '首位教务应该算教务');
});

await ta('教务铺好基础数据（班级 / 学员 / 考勤 / 量化细则）', async () => {
  s.setJSON('org/data', {
    classes: [{ id: clsId, name: '播音一班' }, { id: 'c2', name: '播音二班' }],
    students: [
      { id: sid1, name: S1, classId: clsId },
      { id: sid2, name: S2, classId: clsId },
      { id: 'stu9', name: '别班同学', classId: 'c2' },
    ],
    att_slots: [{ id: 'am', name: '上午' }, { id: 'pm', name: '下午' }],
    quant_rules: [
      { id: 'r1', key: 'att:迟到', label: '迟到', delta: -2 },
      { id: 'r2', key: 'att:事假', label: '事假', delta: -2 },
    ],
    'att:2026-01-01': [
      { id: 'a1', studentId: sid1, status: '迟到', pid: 'am', _u: 1 },
      { id: 'a2', studentId: sid2, status: '正常', pid: 'am', _u: 1 },
      { id: 'a3', studentId: 'stu9', status: '迟到', pid: 'am', _u: 1 },
    ],
    notices: [{ id: 'n1', date: '2026-01-01', text: '明天带练声材料', at: 1 }],
    aiKey: 'sk-机密',
    exams: [{ id: 'e1', date: '2026-01-01', content: '题库内容' }],
  });
});

await ta('建一个学生账号（带 studentId）', async () => {
  const r = await must({ action: 'users', token: su.token, op: 'create',
    user: S1, pass: SU_PASS, role: 'student', name: S1, studentId: sid1 });
  ok(r.id, '应该返回账号 id');
});

await ta('批量建号：一次建完剩下的', async () => {
  const r = await must({ action: 'users', token: su.token, op: 'createMany',
    list: [
      { user: S2, pass: SU_PASS, role: 'student', name: S2, studentId: sid2 },
      { user: T1, pass: SU_PASS, role: 'teacher', name: T1 },
    ] });
  eq(r.n, 2, '应该建成 2 个');
  eq(r.fail.length, 0, '不该有失败的');
});

await ta('撞名的号会被单独报回来，不影响其余', async () => {
  const r = await must({ action: 'users', token: su.token, op: 'createMany',
    list: [
      { user: S1, pass: SU_PASS, role: 'student', name: S1, studentId: sid1 },
      { user: '新同学', pass: SU_PASS, role: 'student', name: '新同学', studentId: 'stu3' },
    ] });
  eq(r.n, 1, '只该建成 1 个');
  eq(r.fail.length, 1, '撞名的那一个要报回来');
});

await ta('学生能登录，档案里带着 studentId', async () => {
  s1 = await must({ action: 'login', user: S1, pass: SU_PASS });
  eq(s1.profile.role, 'student');
  eq(s1.profile.studentId, sid1);
  ok(s1.profile.isStudent, 'isStudent 应该是 true');
  ok(!s1.profile.isStaff, '学生不能算教务');
  s2 = await must({ action: 'login', user: S2, pass: SU_PASS });
  t1 = await must({ action: 'login', user: T1, pass: SU_PASS });
});

console.log('\n=== 二、学生能看到什么（读白名单）===');

let view = null;
await ta('学生 pull 成功，并带回服务端时间', async () => {
  const r = await must({ action: 'pull', token: s1.token });
  view = r.shared;
  ok(r.serverNow > 0, 'serverNow 应该有值（前端靠它校正时钟）');
});

t('学员名单里只有自己那一条', () => {
  const ids = (view.students || []).map(x => x.id);
  eq(ids, [sid1]);
});

t('看不到别人的考勤', () => {
  const rows = view['att:2026-01-01'] || [];
  eq(rows.map(x => x.studentId), [sid1]);
});

t('看不到 AI key（这是首位教务才有的东西）', () => {
  ok(view.aiKey === undefined, 'aiKey 不该下发');
});

t('看不到账号相关的东西', () => {
  ok(view.users === undefined, 'users 不该下发');
});

t('看得到课表、通知、题库这类公开数据', () => {
  ok((view.notices || []).length === 1, '通知应该看得到');
  ok((view.exams || []).length === 1, '题库应该看得到');
});

t('看得到自己那个班（用来显示班级名）', () => {
  eq((view.classes || []).map(c => c.id), [clsId]);
});

t('量化流水只给自己班的，而且不含姓名', () => {
  const logs = view.quant_log || [];
  ok(logs.every(x => !('studentId' in x)), '量化流水不该带学生 id');
});

await ta('打卡设置：给时间规则，不给校区坐标', async () => {
  await must({ action: 'push', token: su.token, shared: {
    sign_rules: { startAt: '08:30', lateAfter: 2, radius: 150, lat: 34.75, lng: 113.62, pid: 'am' },
  } });
  const r = await must({ action: 'pull', token: s1.token });
  const sr = r.shared.sign_rules || {};
  ok(sr.startAt === '08:30', '上课时间应该下发');
  ok(sr.lat === undefined && sr.lng === undefined, '校区坐标不该下发给学生');
});

console.log('\n=== 三、学生能写什么（写白名单）===');

await ta('学生写打卡：允许', async () => {
  const r = await must({ action: 'push', token: s1.token,
    shared: { 'sign:2026-02-01': [{ id: sid1, studentId: sid1, status: '正常', at: Date.now() }] } });
  const rows = (r.shared['sign:2026-02-01'] || []);
  eq(rows.length, 1, '应该留下一条');
  eq(rows[0].id, sid1, 'id 由服务端定成学号');
});

await ta('学生伪造「正常」无效：判定字段以服务端为准', async () => {
  const before = (await must({ action: 'pull', token: s1.token })).shared['sign:2026-02-01'] || [];
  const r = await must({ action: 'push', token: s1.token,
    shared: { 'sign:2026-02-01': [{ id: sid1, studentId: sid1, status: '正常', lateMin: 0, way: 'code' }] } });
  const after = r.shared['sign:2026-02-01'] || [];
  eq(after[0].status, before[0].status, '状态不该被学生改掉');
  eq(after[0].way, before[0].way, '打卡方式不该被学生改掉');
});

await ta('学生写别人的打卡：写不进去', async () => {
  const r = await must({ action: 'push', token: s1.token,
    shared: { 'sign:2026-02-01': [{ id: sid2, studentId: sid2, status: '正常', at: Date.now() }] } });
  const rows = r.shared['sign:2026-02-01'] || [];
  ok(!rows.some(x => x.studentId === sid2), '不该出现别人的打卡记录');
});

await ta('学生改名册：写不进去（服务端不落库）', async () => {
  await call({ action: 'push', token: s1.token,
    shared: { students: [{ id: sid1, name: '改个名字', classId: clsId }] } });
  const raw = (await s.get('org/data', { type: 'json' })).students.find(x => x.id === sid1);
  eq(raw.name, S1, '名册不该被学生改动');
});

await ta('学生改考勤：写不进去', async () => {
  await call({ action: 'push', token: s1.token,
    shared: { 'att:2026-01-01': [{ id: 'a1', studentId: sid1, status: '正常', pid: 'am' }] } });
  const raw = (await s.get('org/data', { type: 'json' }))['att:2026-01-01'].find(x => x.id === 'a1');
  eq(raw.status, '迟到', '考勤不该被学生改掉');
});

await ta('学生改量化：写不进去', async () => {
  await call({ action: 'push', token: s1.token,
    shared: { quant_log: [{ id: 'x1', clsId, date: '2026-01-01', label: '乱加', delta: 100 }] } });
  const raw = (await s.get('org/data', { type: 'json' })).quant_log || [];
  ok(!raw.some(x => x.id === 'x1'), '学生不该能给自己加分');
});

await ta('学生提请假：允许，且状态只能是待处理', async () => {
  const r = await must({ action: 'push', token: s1.token, shared: { tickets: [
    { id: 'tk1', type: '学生请假', text: '去医院复查', status: 'done', studentId: sid1, kind: '病假', date: '2026-03-01' },
  ] } });
  const tk = r.shared.tickets.find(x => x.id === 'tk1');
  eq(tk.status, 'open', '学生自己批准无效，必须回到待处理');
  eq(tk.studentId, sid1);
});

await ta('学生碰别人的工单：碰不动', async () => {
  await must({ action: 'push', token: su.token, shared: { tickets: [
    { id: 'tk0', type: '调课申请', text: '教务自己的工单', status: 'open', createdAt: 1 },
  ] } });
  await call({ action: 'push', token: s1.token, shared: { tickets: [
    { id: 'tk0', type: '调课申请', text: '被学生改过了', status: 'done' },
  ] } });
  const raw = (await s.get('org/data', { type: 'json' })).tickets.find(x => x.id === 'tk0');
  eq(raw.text, '教务自己的工单', '别人的工单不该被学生改动');
});

console.log('\n=== 四、打卡判定（时间、迟到、动态码、距离）===');

await ta('教务没配打卡设置时也能打，记为待核', async () => {
  await setRules(null);
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA' });
  eq(r.status, '待核', '没上课时间可比对，交给教务核对');
  eq(r.wrote, null, '待核不写考勤，不替教务扣分');
});

await ta('教务改打卡设置：改完立刻生效（不是存进去就改不动了）', async () => {
  await setRules(RULES_OK(0));
  await must({ action: 'push', token: su.token, shared: { sign_rules: RULES_OK(-30) } });
  const raw = await s.get('org/data', { type: 'json' });
  eq(raw.sign_rules.startAt, cnHM(-30), '教务改的设置应该覆盖旧的');
});

await ta('按时打卡 → 正常，并写进考勤', async () => {
  await setRules(RULES_OK(0));
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '正常', '（实际 ' + r.status + '，迟到 ' + r.lateMin + ' 分钟）');
  eq(r.wrote, 'att', '应该写进考勤');
  const raw = (await s.get('org/data', { type: 'json' }))['att:' + r.date];
  const mine = raw.filter(x => x.studentId === sid1);
  ok(mine.length >= 1, '考勤里应该有自己');
});

await ta('迟到：按服务端时间算，跟学生手机几点无关', async () => {
  await setRules(RULES_OK(-30));
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '迟到');
  /* 期望值按**实际配下去的起点**倒推，不写死 30：
     00:2x 那种点跑的时候 cnHM 会把起点夹到当天 00:00，迟到自然只有二十几分钟。
     这里验的是「服务端按服务端时间算迟到分钟」，不是「今天一定晚了半小时」。 */
  const want = Math.max(0, cnMinNow() - hm2min(cnHM(-30)));
  ok(Math.abs(r.lateMin - want) <= 2, '迟到分钟数该约等于 ' + want + '（实际 ' + r.lateMin + '）');
});

await ta('零宽限：只晚 1 分钟也算迟到（不是「宽限内」）', async () => {
  await setRules(RULES_OK(-1));
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '迟到', '晚一分钟就是迟到（实际 ' + r.status + '，' + r.lateMin + ' 分钟）');
  ok(r.lateMin >= 1, '迟到分钟数应该 >= 1');
});

await ta('零宽限：正好在点上不算迟到', async () => {
  await setRules(RULES_OK(10));    // 上课在 10 分钟后，现在打就是提前到
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '正常', '提前到不该算迟到（实际 ' + r.status + '）');
});

await ta('迟到自动进量化：班级流水里出现扣分', async () => {
  await setRules(RULES_OK(-30));
  await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  const raw = await s.get('org/data', { type: 'json' });
  const logs = (raw.quant_log || []).filter(x => x._src === 'att' && x.clsId === clsId);
  ok(logs.some(x => x.delta < 0), '应该有考勤生成的扣分');
});

await ta('重复打卡是覆盖，不会堆成一片', async () => {
  const r1 = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  const r2 = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 34.75, lng: 113.62 });
  const raw = await s.get('org/data', { type: 'json' });
  const rows = (raw['sign:' + r2.date] || []).filter(x => x.studentId === sid1);
  eq(rows.length, 1, '一人一天只有一条');
  ok((rows[0].attempts || []).length >= 2, '每次尝试都要留痕');
});

await ta('人在范围外 → 直接打不上，得找教务要位置密钥（用户定的：定位不准不能打卡）', async () => {
  await setRules(RULES_OK(0));
  await setKeys([]);                                  // 手上没有密钥
  const r = await call({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5 });
  eq(r.status, 400, '不在校区范围内该直接拒掉，不再「先记一笔待核」');
  eq(r.body.code, 'GEOFAR', '该回 GEOFAR —— 前端靠它把「填位置密钥」那个框摆出来');
  ok(/位置密钥/.test(r.body.error), '文案该明说去找教务要位置密钥，实际「' + r.body.error + '」');
});

await ta('动态码：码不对打不上', async () => {
  const r = await call({ action: 'sign', token: s1.token, code: '000000' });
  ok(r.body.error, '错误码应该被拒');
});

await ta('动态码：教务取到码，学生用它能打上', async () => {
  await setRules(RULES_OK(0));
  const c = await must({ action: 'code', token: su.token });
  ok(/^\d{6}$/.test(c.code), '码该是 6 位纯数字（实际「' + c.code + '」）');
  eq(c.fixed, false, '码一律是动态的，不该再有 fixed 这条路');
  eq(c.window, 60000, '换码窗口该是 60 秒');
  ok(c.left > 0 && c.left <= 60000, '该带回落「这一枚还剩多少毫秒」（实际 ' + c.left + '）');
  const r = await must({ action: 'sign', token: s1.token, code: c.code, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.way, 'code');
  ok(r.status !== undefined, '应该给出判定');
});
/* 「一分钟一换」不是「每次要都是新的」—— 同一个窗口里要稳定不变，
   否则屏幕上那 6 位数字会在学生眼皮底下乱跳。 */
await ta('同一窗口内码不变、倒计时在往下走（60 秒一换，不是每次随机）', async () => {
  const a = await must({ action: 'code', token: su.token });
  await new Promise(r => setTimeout(r, 1200));
  const b = await must({ action: 'code', token: su.token });
  ok(b.left < a.left, '倒计时该在减少（' + a.left + ' → ' + b.left + '）');
  /* 只有「这一枚还剩得够久」时才比码，免得正好卡在换码点上假红 */
  if (a.left > 3000) eq(b.code, a.code, '同一个 60 秒窗口里，码不该变来变去');
});

await ta('学生拿不到动态码（码只对教务/老师有意义）', async () => {
  const r = await call({ action: 'code', token: s1.token });
  eq(r.status, 403);
});

/* 「教务自己设一个固定码」这条路**已经拆掉了**（一节课不变 = 一次泄漏管一节课）。
   这里守住「拆干净了」：老数据里残留的 sign_rules.code 不许再被认。 */
await ta('固定码这条岔路已拆：老数据里残留的自设码不再生效', async () => {
  await setRules(Object.assign(RULES_OK(0), { code: '8866' }));
  const c = await must({ action: 'code', token: su.token });
  ok(/^\d{6}$/.test(c.code) && c.code !== '8866', '该忽略自设码、照常给 6 位派生码（实际「' + c.code + '」）');
  eq(c.fixed, false, '不该再标 fixed');
  const bad = await call({ action: 'sign', token: s1.token, code: '8866', dev: 'devA' });
  ok(bad.body.error, '自设的 8866 该被拒（不再认它）');
  const bad2 = await call({ action: 'sign', token: s1.token, code: '000000', dev: 'devA' });
  ok(bad2.body.error, '码不对要直接打回，不记这一笔');
  /* 位数钉死 6 位：4 位 / 8 位都不再收（以前固定码可长可短，学生不知道输几位） */
  const bad3 = await call({ action: 'sign', token: s1.token, code: '1234', dev: 'devA' });
  ok(bad3.body.error, '4 位码该被拒');
  const bad4 = await call({ action: 'sign', token: s1.token, code: '12345678', dev: 'devA' });
  ok(bad4.body.error, '8 位码该被拒');
  const r = await must({ action: 'sign', token: s1.token, code: c.code, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.way, 'code', '换成当前那 6 位就该打得动');
});

await ta('关掉定位、只拿码：也打不上（判不了在不在教室就不放行）', async () => {
  await setRules(RULES_OK(0));
  await setKeys([]);
  const c = await must({ action: 'code', token: su.token });
  const r = await call({ action: 'sign', token: s1.token, code: c.code, dev: 'devA' });
  eq(r.status, 400, '教务配过校区坐标、学生又不给位置 → 该直接拒');
  eq(r.body.code, 'GEOFAR', '同样是 GEOFAR（要密钥）');
});

await ta('码被传到校外也没用：定位这一关过不了，码对了照样打不上', async () => {
  await setRules(RULES_OK(0));
  await setKeys([]);
  const c = await must({ action: 'code', token: su.token });
  const r = await call({ action: 'sign', token: s1.token, code: c.code, dev: 'devA', lat: 35.5, lng: 114.5 });
  eq(r.status, 400, '人不在校区，码对了也一样打不上（比原来的「记一笔待核」更严）');
  eq(r.body.code, 'GEOFAR', '该是 GEOFAR');
});

/* ══ 位置密钥（v47）：定位不准的学生，拿教务手里那枚 4 位码就能打上 ══
   密钥由教务在「打卡」页生成，落在机构共享区；学生端的读白名单里没有这个键 ——
   学生们根本拿不到，只能从教务手里要。名额按「当天用这枚密钥打上的人数」算。 */
await ta('学生拿不到位置密钥（读白名单里没这个键，只能从教务手里要）', async () => {
  await setKeys([{ id: 'k1', code: '4821', date: todayCN(), clsId, limit: 5 }]);
  const j = await must({ action: 'pull', token: s1.token });
  eq(j.shared.sign_keys, undefined, '位置密钥一条都不该下发到学生端');
});

await ta('教务发一枚 4 位密钥 → 人在校外的学生凭它就能打上，记 way=key', async () => {
  await setRules(RULES_OK(0));
  await setKeys([{ id: 'k1', code: '4821', date: todayCN(), clsId, limit: 5 }]);
  const r = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '4821' });
  eq(r.way, 'key', '拿位置密钥放行的该记成 key');
  ok(r.status === '正常' || r.status === '迟到', '密钥放行不该再判「待核」（实际 ' + r.status + '）');
  const raw = await s.get('org/data', { type: 'json' });
  const rec = (raw['sign:' + todayCN()] || []).find(x => x.studentId === sid1);
  ok(rec, '该留下打卡记录');
  eq(rec.keyId, 'k1', '记录里该记下用了哪一枚密钥（教务可回查）');
  eq(rec.way, 'key', '记录里的方式也该是 key');
});

await ta('密钥不对 / 不是今天的 / 别班的：一律 BADKEY', async () => {
  await setRules(RULES_OK(0));
  const a = await call({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '9999' });
  eq(a.status, 400, '不存在的码该被拒');
  eq(a.body.code, 'BADKEY', '该回 BADKEY');
  await setKeys([{ id: 'k2', code: '1111', date: '2026-01-01', clsId, limit: 5 }]);
  const b = await call({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '1111' });
  eq(b.body.code, 'BADKEY', '昨天那枚不认 —— 位置密钥只当天有效');
  await setKeys([{ id: 'k3', code: '3333', date: todayCN(), clsId: 'c2', limit: 5 }]);
  const d = await call({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '3333' });
  eq(d.body.code, 'BADKEY', '别班那枚用不了（密钥按班发）');
});

await ta('名额用完就拒（KEYFULL），但已经用过的那个人还能再打', async () => {
  await setRules(RULES_OK(0));
  await setKeys([{ id: 'k4', code: '2468', date: todayCN(), clsId, limit: 1 }]);
  const a = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '2468' });
  eq(a.way, 'key', '第 1 个人该能打上');
  const b = await call({ action: 'sign', token: s2.token, dev: 'devB', lat: 35.5, lng: 114.5, key: '2468' });
  eq(b.status, 400, '第 2 个人该被拒（这枚只放 1 人）');
  eq(b.body.code, 'KEYFULL', '该回 KEYFULL');
  const c = await must({ action: 'sign', token: s1.token, dev: 'devA', lat: 35.5, lng: 114.5, key: '2468' });
  eq(c.way, 'key', '同一个人再打一次不该被名额挡住（一天一人一条，是覆盖）');
});

/* ══ 班干部 / 作业登记 / 学生消息（v47）══ */
console.log('\n=== 四之二、班干部 / 作业登记 / 学生消息 ===');

await ta('不是班干部：名册只发自己那一条', async () => {
  await patchOrg({ officers: [] });
  const j = await must({ action: 'pull', token: s1.token });
  eq((j.shared.students || []).length, 1, '普通学生该只拿到自己');
  eq(j.shared.students[0].id, sid1, '拿到的该是本人');
});

await ta('是班干部：拿到本班同学的「id + 姓名 + classId」，别的字段一个都不出去', async () => {
  await patchOrg({ officers: [{ id: 'o1', clsId, title: '班长', studentId: sid1 }] });
  const j = await must({ action: 'pull', token: s1.token });
  const list = j.shared.students || [];
  eq(list.length, 2, '本班两名同学都该拿到（实际 ' + list.length + '）');
  eq(Object.keys(list[0]).sort().join(','), 'classId,id,name', '只截三个字段下发');
  ok(!list.some(x => x.classId === 'c2'), '别班的同学一条都不该有');
  eq((j.shared.officers || []).length, 1, '本班的班干部名单要下发（学生端靠它判断我是不是班干部）');
});

await ta('只挂了个名字、没填职务的，不算班干部（不给权限）', async () => {
  await patchOrg({ officers: [{ id: 'o2', clsId, title: '', studentId: sid1 }] });
  const j = await must({ action: 'pull', token: s1.token });
  eq((j.shared.students || []).length, 1, '没写职务名就不该按班干部放行');
});

await ta('本班作业发得到学生端（作业记录写的是 clsId，不是 classId）', async () => {
  await patchOrg({
    homework: [
      { id: 'h9', clsId, date: todayCN(), text: '数学卷子', abbr: '数' },
      { id: 'h8', clsId: 'c2', date: todayCN(), text: '别班的作业', abbr: '别' },
    ],
  });
  const j = await must({ action: 'pull', token: s1.token });
  const hw = j.shared.homework || [];
  eq(hw.length, 1, '只该拿到本班那条（实际 ' + hw.length + ' 条）');
  eq(hw[0].id, 'h9', '拿到的该是本班的 h9');
});

await ta('班干部能替全班登记作业，服务端盖上「谁登记的」', async () => {
  await patchOrg({
    officers: [{ id: 'o1', clsId, title: '班长', studentId: sid1 }],
    homework: [{ id: 'h1', clsId, date: todayCN(), text: '数学卷子', abbr: '数' }],
    'hw:h1': [],
  });
  /* 前端推上来的就是本地存好的那条（Store.upsert 会给它生成 id），所以这里也带上 id */
  await must({ action: 'push', token: s1.token, shared: { 'hw:h1': [{ id: sid2, studentId: sid2, done: 1 }] } });
  const raw = await s.get('org/data', { type: 'json' });
  const rec = (raw['hw:h1'] || []).find(x => x.studentId === sid2);
  ok(rec && rec.done === 1, '该登记上');
  eq(rec.by, S1, '该盖上登记人姓名');
  eq(rec.byId, s1.profile.id, '该盖上登记人账号 id（教务要看得出是谁填的）');
});

await ta('普通学生写作业登记：一律被丢掉', async () => {
  await patchOrg({ officers: [] });
  await must({ action: 'push', token: s2.token, shared: { 'hw:h1': [{ id: sid1, studentId: sid1, done: 1 }] } });
  const raw = await s.get('org/data', { type: 'json' });
  ok(!(raw['hw:h1'] || []).some(x => x.byId === sid2), '不该落进库');
});

await ta('学生能给教务发消息（落成一张工单，状态由服务端定成待处理）', async () => {
  const r = await must({ action: 'push', token: s1.token, shared: { tickets: [
    { id: 'sm1', type: '学生消息', text: '今天打卡定位不对', status: 'done', studentId: sid1, toId: 'x' },
  ] } });
  const tk = (r.shared.tickets || []).find(x => x.id === 'sm1');
  ok(tk, '消息该落下来');
  eq(tk.status, 'open', '学生自己标「已回复」无效，回到待处理');
  eq(tk.studentId, sid1, '该挂在自己名下');
});

await ta('收件人名单走 staff：只回教务号，授课老师不在里面', async () => {
  const j = await must({ action: 'staff', token: s1.token });
  ok(Array.isArray(j.staff) && j.staff.length >= 1, '该至少回一个教务账号');
  ok(!j.staff.some(x => x.name === T1), '授课老师「' + T1 + '」不该出现在名单里');
  ok(j.staff.every(x => Object.keys(x).sort().join(',') === 'id,name'),
     '只给 id 与名字，用户名/角色一概不给（实际 ' + JSON.stringify(j.staff[0]) + '）');
});

await patchOrg({ officers: [] });

await ta('打卡码不下发给学生（学生端拿不到 sign_rules.code）', async () => {
  const j = await must({ action: 'pull', token: s1.token });
  eq(j.shared.sign_rules.code, undefined, 'code 属于教务，不下发');
  eq(j.shared.sign_rules.lat, undefined, '校区坐标也不下发');
  ok(j.shared.sign_rules.startAt, '时间规则要下发，学生才知道几点上课');
});

await ta('请过假的那天，打卡不覆盖假条', async () => {
  const date = '2026-04-01';
  await setRules(RULES_OK(0));
  await must({ action: 'push', token: su.token, shared: {
    ['att:' + date]: [{ id: 'lv1', studentId: sid1, status: '事假', pid: 'am' }] } });
  const r = await must({ action: 'sign', token: s1.token, date, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.wrote, 'leave', '假条优先，不该被打卡覆盖（实际 ' + r.wrote + '）');
  const raw = await s.get('org/data', { type: 'json' });
  eq(raw['att:' + date].find(x => x.studentId === sid1).status, '事假');
});

console.log('\n=== 四之二、断网打卡（按「按下那一刻」判迟到）===');

await ta('断网但按时按下的，补传上来算正常（不冤枉人）', async () => {
  await setRules(RULES_OK(5));
  const at = Date.now() - 60000;          // 一分钟前按的，那时还没上课
  const r = await must({ action: 'sign', token: s1.token, at, offline: true, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '正常', '他确实按时按了（实际 ' + r.status + '）');
  ok(Math.abs(r.at - at) < 2000, '记录的时刻应该是他按下的那一刻');
  ok(r.offline === true, '要标成断网补传，教务一眼看得出');
});

await ta('断网且迟到的，补传上来照样算迟到', async () => {
  await setRules(RULES_OK(-30));
  const at = Date.now() - 25 * 60000;     // 25 分钟前按的，那时已上课 5 分钟
  const r = await must({ action: 'sign', token: s1.token, at, offline: true, dev: 'devA', lat: 34.75, lng: 113.62 });
  eq(r.status, '迟到', '按按下那一刻算（实际 ' + r.status + '）');
  const raw = await s.get('org/data', { type: 'json' });
  const rec = (raw['sign:' + r.date] || []).find(x => x.studentId === sid1);
  ok(rec && rec.offline === true && rec.recvAt, '服务端要同时记下「按下的时刻」和「补传的时刻」');
});

await ta('把手机时间调到未来也没用：超过现在 2 分钟按现在算', async () => {
  await setRules(RULES_OK(-10));
  const r = await must({ action: 'sign', token: s1.token, at: Date.now() + 30 * 60000, offline: true, dev: 'devA', lat: 34.75, lng: 113.62 });
  ok(r.at <= Date.now() + 1000, '未来的时间被拉回现在（实际差 ' + (r.at - Date.now()) + 'ms）');
  eq(r.status, '迟到', '照样判迟到');
});

console.log('\n=== 五、抽签 ===');

await ta('学生开不了抽签', async () => {
  const r = await call({ action: 'draw', token: s1.token, name: '临时', ids: [sid1] });
  eq(r.status, 403);
});

await ta('教务开抽：存下种子，学生拉得到', async () => {
  const r = await must({ action: 'draw', token: su.token, name: '9月第3周模考', ids: [sid1, sid2] });
  ok(/^[0-9a-f]{16}$/.test(r.draw.seed), '种子应该是随机的（实际 ' + r.draw.seed + '）');
  eq(r.draw.round, 1);
  const v = (await must({ action: 'pull', token: s1.token })).shared;
  ok((v.exam_draws || []).some(x => x.name === '9月第3周模考'), '学生应该拉得到抽签');
});

await ta('重新抽：轮次 +1，种子换一个', async () => {
  const a = (await must({ action: 'pull', token: su.token })).shared.exam_draws[0];
  const r = await must({ action: 'draw', token: su.token, name: '9月第3周模考', ids: [sid1, sid2] });
  eq(r.draw.round, 2, '轮次应该 +1');
  ok(r.draw.seed !== a.seed, '种子应该换掉');
});

await ta('抽签算法是确定性的：同一 seed 每次算出的顺序一致', async () => {
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => { let a = hash(String(seed)); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const order = (ids, seed) => { const a = [...ids].sort(); const r = rng(seed);
    for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ids = [sid1, sid2, 'stu9', 'stu4', 'stu5'];
  eq(order(ids, 'abc123'), order(ids, 'abc123'), '同种子必须同结果');
  ok(JSON.stringify(order(ids, 'abc123')) !== JSON.stringify(order(ids, 'zzz999')), '不同种子应该换顺序');
  const o1 = order(ids, 'abc123');
  eq([...o1].sort(), [...ids].sort(), '不重不漏');
});

console.log('\n=== 六、硬指标：学生同步一圈，教务数据一条都不能少 ===');

await ta('学生反复同步后，教务端数据条数不减', async () => {
  const key = (o) => Object.keys(o).filter(k => k !== 'sign_rules').sort();
  const before = (await must({ action: 'pull', token: su.token })).shared;
  const beforeKeys = key(before);
  const beforeCounts = {};
  beforeKeys.forEach(k => { beforeCounts[k] = Array.isArray(before[k]) ? before[k].length : 1; });

  /* 学生把「自己看到的那一份」原样推回去 —— 这正是最容易出事的操作：
     如果过滤是前端做的、或者写白名单漏了，这一下就会把全班数据冲掉 */
  const mine = (await must({ action: 'pull', token: s1.token })).shared;
  await must({ action: 'push', token: s1.token, shared: mine });
  await must({ action: 'push', token: s2.token, shared: (await must({ action: 'pull', token: s2.token })).shared });

  const after = (await must({ action: 'pull', token: su.token })).shared;
  const afterKeys = key(after);
  eq(afterKeys, beforeKeys, '键一个都不能少');
  beforeKeys.forEach(k => {
    const n = Array.isArray(after[k]) ? after[k].length : 1;
    if (n !== beforeCounts[k]) throw new Error(`「${k}」从 ${beforeCounts[k]} 条变成了 ${n} 条`);
  });
});

await ta('教务端的名册、考勤、AI key 都还在', async () => {
  const v = (await must({ action: 'pull', token: su.token })).shared;
  eq(v.students.length, 3, '三个学员都该在');
  eq(v['att:2026-01-01'].length, 3, '三条考勤都该在');
  eq(v.aiKey, 'sk-机密');
});

await ta('老师端的视野不受影响', async () => {
  const r = await must({ action: 'pull', token: t1.token });
  ok(r.shared.students !== undefined, '老师应该拿得到学员列表（按班过滤后）');
  ok(r.shared.aiKey === undefined, '老师不该拿到 AI key');
});

console.log('\n────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
