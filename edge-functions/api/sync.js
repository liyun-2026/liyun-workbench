/**
 * 砺蕴工作系统 · 账号与数据服务（v2 · 多角色）
 * 路由：edge-functions/api/sync.js  →  https://你的域名/api/sync
 *
 * ── 相比 v1（单一口令）多了什么 ──
 *   1. 真正的账号：用户名 + 密码（加盐哈希）→ 登录后发一个签名令牌
 *   2. 三种角色：super（首位教务，权限最高）/ admin（教务）/ teacher（授课老师）
 *   3. 数据分两区：
 *        机构共享区 org/data  —— 名册、课表、考勤、作业、过关、量化、模考、体重、今日情况、通知、工单
 *        个人私有区 data/{uid} —— 每个人自己的设置（不共享、不参与机构统计）
 *   4. 服务端按角色过滤：授课老师只拿得到自己带的班、那些班的学员与记录、课表、通知、自己提的工单
 *   5. 账号由教务创建；只有第一位（super）能管理账号，且 super 自己谁也动不了
 *
 * ── 沿用 v1 的老规矩 ──
 *   · 强一致读：电脑改完手机立刻能拉到
 *   · 服务端按 id+时间戳合并，两端同时推也不丢数据
 *   · key 里不放明文用户名（全部 hash 过），控制台只读浏览也看不出谁是谁
 *   · 连续输错密码会锁 5 分钟
 */

import { getStore } from '@edgeone/pages-blob';

const MAX_FAIL = 5;
const LOCK_MS = 5 * 60 * 1000;
const MAX_BYTES = 700 * 1024;          // 受限于边缘函数请求体 1MB
const SESSION_MS = 60 * 24 * 3600 * 1000;   // 登录状态保留 60 天
const MIN_PASS = 8;

const SUPER = 'super';       // 首位教务：什么都能管，包括账号
const ADMIN = 'admin';       // 教务老师：业务全能，不管账号
const TEACHER = 'teacher';   // 授课老师：只看自己带的班
const BOTH = 'both';         // 教务兼授课：教务那摊 + 自己班的授课那摊，两套都在
const STUDENT = 'student';   // 学生：只看自己的，只能打卡和请假
/* 数据口径上「算教务」的角色：能拿到全部数据、能写全部数据。
   both 也算教务（否则 TA 打开考勤/量化会是一片空），只是不能管账号（看 doUsers）。 */
const STAFF = [SUPER, ADMIN, BOTH];
/* 建号 / 改身份时允许的身份。super 只能有一个，不在这里 —— 谁也建不出第二个 */
const ASSIGNABLE = [ADMIN, BOTH, TEACHER, STUDENT];
const normRole = r => (ASSIGNABLE.indexOf(String(r)) >= 0 ? String(r) : TEACHER);

/* ── 用户名规则 ──
   汉字和字母数字都行：教务、老师更习惯打自己名字，记拼音反而容易忘。
   输入法常带出全角字符（ｗａｎｇ、１２３），先按 NFKC 折成半角再存，
   否则「ｗａｎｇ」和「wang」会变成两个账号，人自己都分不清用了哪个。
   前后端共用同一套口径：NFKC → 去空格 → 小写。 */
const USER_MIN = 2, USER_MAX = 32;
const USER_RE = /^[\p{Script=Han}a-z0-9_.@\-\u00b7]+$/u;

function canonUser(v) {
  return String(v == null ? '' : v).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/** 合法返回空串，不合法返回一句人话。 */
function userErr(u) {
  const n = [...u].length;          // 按「字」数，不是 UTF-16 长度（汉字别算成两个）
  if (n < USER_MIN || n > USER_MAX) return `用户名需要 ${USER_MIN}-${USER_MAX} 个字`;
  if (!USER_RE.test(u)) return '用户名只能用汉字、字母、数字，或 . _ - @';
  return '';
}

/* 授课老师能读到哪些共享数据。
   值 = 过滤规则：
     'self'      按班级 id 过滤（只留自己带的班）
     'classId'   按记录上的 classId 过滤
     'studentId' 按记录上的 studentId 过滤（先算出自己班的学员集合）
     'own'       只留自己提交的
     null        整份下发（课表、作息、题库、通知这类没有归属的数据）
   没列在这里的键一律不下发 —— 不是界面藏起来，是根本拿不到。 */
const TEACHER_READ = {
  classes:          'self',
  students:         'classId',
  homework:         'clsId',
  exam_scores:      'classId',
  exam_sheets:      'clsId',
  weights:          'studentId',
  records:          'studentId',
  tickets:          'own',
  periods:          null,
  schedule:         null,
  schedule_archive: null,
  rooms:            null,
  exams:            null,
  quant_rules:      null,
  notices:          null,
};
/* 按天 / 按次分片的键（att:2026-09-18、night:2026-09-18、hw:{作业id}）。
   这些键里只存 studentId 不存班级，所以统一按「自己班的学员」过滤。 */
const TEACHER_PREFIX_READ = ['att:', 'night:', 'hw:'];
/* 授课老师能写回哪些：自己的工单 + 自己录的今日情况 + 作业提交登记（hw: 前缀） */
const TEACHER_WRITE = ['tickets', 'records'];
/* 只有首位教务能改的东西 */
const SUPER_ONLY_WRITE = ['aiKey'];

/* ══ 学生能读到哪些 ══
   学生是「外人」：整个机构的数据里，只有跟他本人有关的那几行能出去。
   不在下面两张表里的键一律不下发 —— 不是界面藏起来，是根本拿不到。
   值含义同 TEACHER_READ：
     'own'     只留「本人」那一条（students 里 id = 自己的 studentId）
     'ownCls'  只留自己那个班的
     'self'    按记录上的 studentId 过滤
     null      整份下发（课表、作息、通知、新闻这类没有归属的数据） */
const STUDENT_READ = {
  /* 班级记录本身没有 classId 字段（它就叫 id），所以这条规则两个字段都认 */
  classes:      'ownCls',      // 只自己那个班（用来显示班级名）
  students:     'own',         // 只自己这一条
  homework:     'ownCls',      // 本班作业
  exam_sheets:  'ownCls',      // 本班模考场次
  exam_scores:  'self',        // 只有自己的成绩
  exam_draws:   null,          // 抽签种子（学生端靠它本地算出自己的序号）
  periods:      null,          // 作息
  schedule:     null,          // 课表
  rooms:        null,
  exams:        null,          // 考试安排（题库是公开的练声材料）
  notices:      null,          // 公告本来就给大家看
  news_cache:   null,          // 每日新闻（教务端拉好，学生只读这一份）
  quant_rules:  null,          // 量化名目（学生端靠它把自己的考勤折成分数）
  /* quant_log 是「班级级」流水：只有 clsId/日期/名目/分值，不含任何姓名，
     所以按班过滤后下发是安全的 —— 学生看得到班级总分，看不到是谁被扣的。 */
  quant_log:    'ownCls',
  records:      'self',        // 老师写给本人的评语与今日情况
  tickets:      'self',        // 只看到自己提交的请假（看得到处理结果，改不了）
};
/* 按天 / 按次分片的键：全部只留本人那几条 */
const STUDENT_PREFIX_SELF = ['att:', 'sign:', 'night:', 'hw:', 'hwchk:'];
/* 学生能写回哪些（服务端强制，前端隐藏不算数）：
     sign:{日期}  —— 打卡，一人一条，服务端盖时间戳与判定
     tickets      —— 只能新增本人的请假工单，且状态只能是 open（批准权在教务） */
const STUDENT_WRITE_PREFIX = ['sign:'];
/* 打卡判定用的配置。坐标（lat/lng）不下发给学生 —— 学生不需要知道校区在哪。 */
const SIGN_RULE_PUBLIC = ['startAt', 'lateAfter', 'windowBefore', 'windowAfter', 'mode', 'pid'];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function store() {
  return getStore({ name: 'dashboard', consistency: 'strong' });
}

const enc = s => new TextEncoder().encode(s);

async function hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', enc(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randHex(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64url(str) {
  const bytes = enc(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ── 与前端 Store.mergeList 同一套规则：按 id 取修改时间更新的那条 ── */
function mergeList(a, b) {
  const m = new Map();
  for (const it of [...(a || []), ...(b || [])]) {
    if (!it || !it.id) continue;
    const prev = m.get(it.id);
    if (!prev || (it._u || 0) > (prev._u || 0)) m.set(it.id, it);
  }
  return Array.from(m.values());
}

/* 配置类单值：客户端传了就以客户端为准。
   打卡设置是教务在「打卡管理」里改的，改完必须立刻生效；
   走「服务端没有才写入」的老规矩的话，第一次存进去之后就再也改不动了。
   ⚠️ 学生的写白名单里没有 sign_rules，所以这条路只有教务走得通。 */
const OVERWRITE_KEYS = ['sign_rules'];

function mergeAll(server, client) {
  const out = Object.assign({}, server || {});
  for (const [k, cv] of Object.entries(client || {})) {
    if (k.startsWith('_')) continue;
    if (OVERWRITE_KEYS.includes(k)) { out[k] = cv; continue; }
    const sv = out[k];
    if (Array.isArray(cv)) out[k] = mergeList(Array.isArray(sv) ? sv : [], cv);
    else if (sv === undefined || sv === null) out[k] = cv;
  }
  return out;
}

async function secret(s) {
  let v = await s.get('sys/secret', { type: 'json' });
  if (!v || !v.k) {
    v = { k: randHex(32) };
    await s.setJSON('sys/secret', v);
  }
  return v.k;
}

async function uidIndex(s) {
  return (await s.get('sys/users', { type: 'json' })) || { ids: [] };
}

async function profileOf(auth, uid, user) {
  return {
    id: uid,
    user,
    name: auth.name || user,
    role: auth.role,
    classIds: Array.isArray(auth.classIds) ? auth.classIds : [],
    /* 学生账号挂在哪个学员档案上。学生端所有「只看自己的」都靠这个字段。 */
    studentId: auth.studentId || '',
    isSuper: auth.role === SUPER,
    isStaff: STAFF.includes(auth.role),
    isStudent: auth.role === STUDENT,
  };
}

async function makeToken(s, p) {
  const payload = b64url(JSON.stringify({ u: p.id, r: p.role, e: Date.now() + SESSION_MS }));
  return payload + '.' + (await hmacHex(await secret(s), payload));
}

/** 校验令牌 → 返回最新 profile（角色/带班以服务端为准，改完立刻生效） */
async function verify(s, token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const good = await hmacHex(await secret(s), payload);
  if (sig !== good) return null;
  let p;
  try { p = JSON.parse(unb64url(payload)); } catch { return null; }
  if (!p || !p.u || !p.e || p.e < Date.now()) return null;
  const auth = await s.get(`auth/${p.u}`, { type: 'json' });
  if (!auth || auth.active === false) return null;
  return profileOf(auth, p.u, auth.user || p.u);
}

/** 自己班的学员 id 集合（老师写回时校验归属用） */
function myStudentIds(shared, me) {
  const ids = new Set(me.classIds || []);
  return new Set((((shared || {}).students) || []).filter(x => ids.has(x.classId)).map(x => x.id));
}

/* ── 学生：只下发「跟本人有关」的那几行 ──
   这是整套学生端最要紧的一处。名册、量化流水、AI key、账号列表一律拿不到；
   别人的考勤、作业、成绩、体重、评语也一律拿不到。 */
function filterForStudent(src, me) {
  const sid = me.studentId || '';
  const stu = ((src.students) || []).find(x => x && x.id === sid);
  const clsId = stu ? stu.classId : '';
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.charAt(0) === '_') continue;
    // 按天/按次分片的键：只留本人
    if (STUDENT_PREFIX_SELF.some(p => k.indexOf(p) === 0)) {
      out[k] = Array.isArray(v) ? v.filter(x => x && x.studentId === sid) : v;
      continue;
    }
    if (k === 'sign_rules') {                 // 打卡设置：给时间规则，不给校区坐标
      const r = v && typeof v === 'object' ? v : {};
      const pub = {};
      for (const f of SIGN_RULE_PUBLIC) if (r[f] !== undefined) pub[f] = r[f];
      out[k] = pub;
      continue;
    }
    if (!(k in STUDENT_READ)) continue;
    const rule = STUDENT_READ[k];
    if (rule === null || !Array.isArray(v)) { out[k] = v; continue; }
    if (rule === 'own')         out[k] = v.filter(x => (x && x.id) === sid);
    else if (rule === 'ownCls') out[k] = clsId ? v.filter(x => x && (x.classId === clsId || x.id === clsId)) : [];
    else if (rule === 'self')   out[k] = v.filter(x => x && x.studentId === sid);
    else                        out[k] = v;
  }
  return out;
}

/* ── 授课老师：只下发自己班的班级/学员/考勤/作业/过关/成绩/体重/评语，加自己提的工单 ── */
function filterShared(shared, me) {
  const src = shared || {};
  if (me.isStaff) return src;
  if (me.role === STUDENT) return filterForStudent(src, me);
  const ids = new Set(me.classIds || []);
  const stuIds = myStudentIds(src, me);
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.charAt(0) === '_') continue;
    // 按天/按次分片的键：只留自己班学员的那些条
    if (TEACHER_PREFIX_READ.some(p => k.indexOf(p) === 0)) {
      out[k] = Array.isArray(v) ? v.filter(x => x && stuIds.has(x.studentId)) : v;
      continue;
    }
    if (!(k in TEACHER_READ)) continue;
    const rule = TEACHER_READ[k];
    if (rule === null || !Array.isArray(v)) { out[k] = v; continue; }
    if (rule === 'self')            out[k] = v.filter(c => ids.has(c.id));
    else if (rule === 'own')        out[k] = v.filter(t => t.userId === me.id);
    else if (rule === 'classId')    out[k] = v.filter(x => ids.has(x.classId));
    else if (rule === 'clsId')      out[k] = v.filter(x => ids.has(x.clsId));
    else if (rule === 'studentId')  out[k] = v.filter(x => stuIds.has(x.studentId));
    else                            out[k] = v;
  }
  return out;
}

/* ── 作业提交登记（hw:{作业id}）──
   老师在「录入今日情况」里点「交了 / 没交」，写的就是这一份，
   量化分才准。只认自己班的学生；取消勾选要带着墓碑一起上传，
   否则另一台设备拉回来会把它复活。 */
function sanitizeHw(src, server, stuIds) {
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.indexOf('hw:') !== 0 || !Array.isArray(v)) continue;
    const srvById = new Map((Array.isArray(server[k]) ? server[k] : []).map(x => [x.id, x]));
    const keep = [];
    for (const item of v) {
      if (!item || !item.id) continue;
      if (item._d){
        const prev = srvById.get(item.id);
        if (prev && stuIds.has(prev.studentId)) keep.push(item);
      } else if (stuIds.has(item.studentId)){
        keep.push(item);
      }
    }
    if (keep.length) out[k] = keep;
  }
  return out;
}

/* ── 学生写回白名单：只有打卡和本人请假两条路 ──
   这是「学生端会不会把教务的数据冲掉」的唯一防线，必须放在最前面：
   学生的 isStaff 是 false，不先拦住就会掉进授课老师那一支，那支是按班级放行的。 */
function sanitizeStudent(src, me, server) {
  const sid = me.studentId || '';
  const out = {};

  /* 打卡：一人一天一条，id 由服务端定成 studentId，
     时间戳与判定也是服务端盖的 —— 前端改本地时间改不动它 */
  for (const [k, v] of Object.entries(src)) {
    if (!STUDENT_WRITE_PREFIX.some(p => k.indexOf(p) === 0)) continue;
    if (!Array.isArray(v)) continue;
    const prev = (Array.isArray(server[k]) ? server[k] : []).find(x => x && x.id === sid);
    const mine = v.filter(x => x && (x.id === sid || !x.id));
    if (!mine.length) continue;
    const it = Object.assign({}, mine[mine.length - 1]);
    it.id = sid;
    it.studentId = sid;
    it.userId = me.id;
    /* 这几个字段只有服务端能定：学生伪造「正常」是无效的 */
    if (prev) {
      for (const f of ['at', 'status', 'lateMin', 'dist', 'way', 'by']) if (prev[f] !== undefined) it[f] = prev[f];
    }
    out[k] = [it];
  }

  /* 请假：只能新增本人的，且状态只能是待处理 —— 批准权在教务手上。
     学生偷偷把 status 改成 done 也一样会被这里按回 open。 */
  const serverTk = new Map((server.tickets || []).map(t => [t.id, t]));
  const mine = [];
  for (const t of (src.tickets || [])) {
    if (!t || !t.id) continue;
    if (t.studentId && t.studentId !== sid) continue;
    const prev = serverTk.get(t.id);
    if (prev && prev.studentId && prev.studentId !== sid) continue;   // 别人的工单碰不得
    const item = Object.assign({}, t, {
      studentId: sid, userId: me.id, userName: me.name,
      createdAt: (prev && prev.createdAt) || t.createdAt || Date.now(),
    });
    if (prev) {                       // 已存在的工单：处理状态一律以教务那边为准
      item.status = prev.status === undefined ? 'open' : prev.status;
      if (prev.reply !== undefined) item.reply = prev.reply;
      if (prev.repliedAt !== undefined) item.repliedAt = prev.repliedAt;
      if (prev.kind !== undefined) item.kind = prev.kind;
    } else {
      item.status = 'open';
    }
    mine.push(item);
  }
  if (mine.length) out.tickets = mine;

  return out;
}

/* ── 写回白名单：老师只能提交自己的工单和自己录的今日情况；次位教务改不了首位教务的东西 ── */
function sanitizePush(shared, me, serverShared) {
  const src = shared || {};
  if (me.role === STUDENT) return sanitizeStudent(src, me, serverShared || {});
  if (me.isStaff) {
    const out = Object.assign({}, src);
    if (me.role !== SUPER) for (const k of SUPER_ONLY_WRITE) delete out[k];   // aiKey 只有首位教务能改（教务老师、教务兼授课都不行）
    return out;
  }

  const server = serverShared || {};
  const stuIds = myStudentIds(server, me);

  /* 工单：只认自己的，别人的一律丢弃；
     提交人身份由服务端盖章（前端伪造没用）；
     工单的处理状态只有教务能改，老师重复提交时保留教务那边的处理结果 */
  const serverTickets = new Map((server.tickets || []).map(t => [t.id, t]));
  const mine = [];
  for (const tk of (src.tickets || [])) {
    if (!tk || !tk.id) continue;
    if (tk.userId && tk.userId !== me.id) continue;
    const prev = serverTickets.get(tk.id);
    const item = Object.assign({}, tk, { userId: me.id, userName: me.name });
    if (prev) {
      item.status = prev.status === undefined ? 'open' : prev.status;
      if (prev.reply !== undefined) item.reply = prev.reply;
      if (prev.repliedAt !== undefined) item.repliedAt = prev.repliedAt;
    } else {
      item.status = 'open';
      item.createdAt = item.createdAt || Date.now();
    }
    mine.push(item);
  }

  /* 今日情况：只能录自己班的学生；提交人由服务端盖章；
     已经由别人录过的那条不能覆盖（免得两位老师互相擦掉对方的记录） */
  const serverRecs = new Map((server.records || []).map(r => [r.id, r]));
  const myRecs = [];
  for (const r of (src.records || [])) {
    if (!r || !r.id) continue;
    if (!stuIds.has(r.studentId)) continue;
    const prev = serverRecs.get(r.id);
    if (prev && prev.byId && prev.byId !== me.id) continue;
    if (r.byId && r.byId !== me.id) continue;
    myRecs.push(Object.assign({}, r, { byId: me.id, byName: me.name }));
  }

  const out = {};
  for (const k of TEACHER_WRITE) {
    if (k === 'tickets') out[k] = mine;
    if (k === 'records') out[k] = myRecs;
  }
  Object.assign(out, sanitizeHw(src, server, stuIds));
  return out;
}

/* ── 登录 / 首次初始化 ── */
async function doLogin(s, body) {
  const user = canonUser(body.user);
  const pass = String(body.pass || '');
  const bad = userErr(user);
  if (bad) return json({ error: bad }, 400);
  if (pass.length < MIN_PASS) return json({ error: `密码至少 ${MIN_PASS} 位` }, 400);

  const uid = await hex('u|' + user);
  const kAuth = `auth/${uid}`;
  const kRate = `rate/${uid}`;

  const rate = (await s.get(kRate, { type: 'json' })) || { n: 0, until: 0 };
  const now = Date.now();
  if (rate.until && now < rate.until) {
    const mins = Math.ceil((rate.until - now) / 60000);
    return json({ error: `密码错误次数过多，请 ${mins} 分钟后再试` }, 429);
  }

  let auth = await s.get(kAuth, { type: 'json' });
  const owner = await s.get('org/owner', { type: 'json' });
  let created = false;

  if (!auth) {
    /* 还没有第一位教务 → 这一枪就是首次初始化，创建超级教务 */
    if (owner) return json({ error: 'NO_ACCOUNT' }, 404);
    const salt = randHex(16);
    auth = {
      salt, hash: await hex(pass + '|' + salt),
      role: SUPER, name: user, classIds: [], active: true,
      user, createdAt: now,
    };
    await s.setJSON(kAuth, auth);
    await s.setJSON('org/owner', { id: uid, user, name: auth.name, createdAt: now });
    const idx = await uidIndex(s);
    if (!idx.ids.includes(uid)) { idx.ids.push(uid); await s.setJSON('sys/users', idx); }
    created = true;
  } else {
    /* 老版本（v1）的账号没有角色 → 迁移成首位教务，并把老数据搬进机构共享区 */
    if (!auth.role) {
      auth.role = SUPER;
      auth.name = auth.name || auth.user || user;
      auth.user = auth.user || user;
      auth.active = auth.active !== false;
      if (!Array.isArray(auth.classIds)) auth.classIds = [];
      await s.setJSON(kAuth, auth);
      if (!(await s.get('org/data', { type: 'json' }))) {
        const legacy = await s.get(`data/${uid}`, { type: 'json' });
        if (legacy) await s.setJSON('org/data', legacy);
      }
    }
    if (!owner) await s.setJSON('org/owner', { id: uid, user: auth.user || user, name: auth.name, createdAt: auth.createdAt || now });

    const h = await hex(pass + '|' + auth.salt);
    if (h !== auth.hash) {
      const n = (rate.n || 0) + 1;
      await s.setJSON(kRate, { n, until: n >= MAX_FAIL ? now + LOCK_MS : 0 });
      const left = MAX_FAIL - n;
      return json({ error: left > 0 ? `密码不对，还能试 ${left} 次` : '密码错误次数过多，已锁定 5 分钟' }, 401);
    }
  }

  if (auth.active === false) return json({ error: '这个账号已被停用，请联系教务' }, 403);
  if (rate.n) await s.setJSON(kRate, { n: 0, until: 0 });

  /* 自愈：老版本迁移过来的账号不在索引里，登录时补上，否则教务看不到它 */
  const idx = await uidIndex(s);
  if (!idx.ids.includes(uid)) {
    idx.ids.push(uid);
    await s.setJSON('sys/users', idx);
  }

  const me = await profileOf(auth, uid, auth.user || user);
  return json({ ok: true, created, token: await makeToken(s, me), profile: me });
}

/* ══ 学生打卡：时间、距离、迟到全部由服务端定 ══
   学生改手机时间、故意断网，在这里都骗不过去 —— 判定用的是服务端的钟。 */

/** 服务端可能在 UTC 时区，一切按北京时间算（教务在中国的机构） */
const CN_OFFSET = 8 * 3600 * 1000;
function cnParts(ts) {
  const d = new Date(ts + CN_OFFSET);
  return {
    date: d.toISOString().slice(0, 10),
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
function hm2min(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
/** 两点直线距离（米）。教务采集的坐标和学生上报的都来自浏览器原生接口，同属 WGS-84，可直接算 */
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* 动态码：每 60 秒换一个 6 位数字，由服务端密钥派生。
   学生端拿不到密钥，也就算不出下一分钟的码 —— 代人打卡这条路堵在这里。
   校验时同时认当前窗口和上一窗口（刚好卡在换码那一秒也算通过）。 */
const CODE_WINDOW_MS = 60000;
async function codeAt(sec, slot) {
  const h = await hmacHex(sec, 'signcode|' + slot);
  return String(parseInt(h.slice(0, 8), 16) % 1000000).padStart(6, '0');
}
async function codeOK(sec, code, ts) {
  const want = String(code || '').trim();
  if (!/^\d{6}$/.test(want)) return false;
  const slot = Math.floor(ts / CODE_WINDOW_MS);
  for (const s of [slot, slot - 1]) if ((await codeAt(sec, s)) === want) return true;
  return false;
}

/** 打卡产生的考勤要不要写进量化：与前端 Quant.syncAtt 同一口径（按当天最重的一次），幂等 */
function syncAttQuant(data, clsId, date) {
  if (!clsId || !date) return;
  const RANK = { '正常': 0, '病假': 1, '迟到': 2, '早退': 2, '事假': 3 };
  const list = Array.isArray(data.quant_log) ? data.quant_log : [];
  data.quant_log = list.filter(x => !(x && !x._d && x._src === 'att' && x.clsId === clsId && x.date === date));
  const rules = Array.isArray(data.quant_rules) ? data.quant_rules : [];
  const worst = {};
  (Array.isArray(data['att:' + date]) ? data['att:' + date] : []).forEach(r => {
    if (!r || !r.studentId) return;
    const prev = worst[r.studentId];
    worst[r.studentId] = prev === undefined ? r.status : ((RANK[r.status] || 0) > (RANK[prev] || 0) ? r.status : prev);
  });
  const stu = (Array.isArray(data.students) ? data.students : []).filter(x => x && x.classId === clsId);
  stu.forEach(s => {
    const st = worst[s.id];
    if (!st || st === '正常') return;
    const r = rules.find(x => x.key === 'att:' + st);
    if (!r || !r.delta) return;
    data.quant_log.push({ id: 'q' + clsId + date + s.id, clsId, date, label: r.label || st, delta: r.delta, _src: 'att', _u: Date.now() });
  });
}

async function doSign(s, me, body) {
  if (me.role !== STUDENT || !me.studentId) return json({ error: '这个账号不是学生，打不了卡' }, 403);
  const data = (await s.get('org/data', { type: 'json' })) || {};
  const rules = data.sign_rules || null;
  const sid = me.studentId;
  const now = Date.now();
  const p = cnParts(now);
  const date = String(body.date || p.date);
  const sec = await secret(s);

  /* 打卡方式：动态码 > 定位 > 都没有就记「待核」 */
  let way = 'self', dist = null;
  if (body.code) {
    if (await codeOK(sec, body.code, now)) way = 'code';
    else return json({ error: '动态码不对，请在老师/教务的屏幕上看看当前的码' }, 400);
  }
  if (body.lat != null && body.lng != null && rules && rules.lat != null) {
    dist = Math.round(distM(rules.lat, rules.lng, Number(body.lat), Number(body.lng)));
    if (way !== 'code') {
      const r = Number(rules.radius || 150);
      way = dist <= r ? 'geo' : 'geo-far';
    }
  }

  /* 迟到：一律按服务端的钟，跟学生手机上是几点无关 */
  let status = '正常', lateMin = 0;
  if (rules && rules.startAt) {
    const start = hm2min(rules.startAt);
    const late = Number(rules.lateAfter === undefined ? 5 : rules.lateAfter);
    const before = Number(rules.windowBefore === undefined ? 60 : rules.windowBefore);
    const after = Number(rules.windowAfter === undefined ? 30 : rules.windowAfter);
    if (start !== null) {
      if (p.min > start - before || p.min < start - before - 720) { /* 正常区间内，或跨天 */ }
      lateMin = Math.max(0, p.min - start);
      status = lateMin > late ? '迟到' : '正常';
      if (p.min > start + after) status = '待核';   // 下课都半小时了才来，交教务核对
      if (p.min < start - before) status = '待核';   // 太早打也说不通，同样交教务
    }
  } else {
    status = '待核';   // 教务还没配打卡设置，先记下来，别让学生白打
  }
  /* 定位方式且人在范围外：本人确实不在校区，交教务核对 */
  if (way === 'geo-far') status = '待核';
  if (way === 'self') status = '待核';

  /* 一天一人一条：重复打卡是覆盖，不会堆成一片，但每次尝试都留痕 */
  const key = 'sign:' + date;
  const arr = Array.isArray(data[key]) ? data[key] : [];
  const prev = arr.find(x => x && x.id === sid);
  const rec = {
    id: sid, studentId: sid, userId: me.id,
    at: now, date, way, status, lateMin,
    dist: dist === null ? undefined : dist,
    acc: body.acc == null ? undefined : Number(body.acc),
    dev: String(body.dev || '').slice(0, 40),
    by: 'self',
    attempts: (prev && Array.isArray(prev.attempts) ? prev.attempts : []).concat(
      [{ at: now, way, dist, status }]).slice(-5),
  };
  data[key] = arr.filter(x => x && x.id !== sid).concat([rec]);

  /* 只有「正常 / 迟到」才写进考勤 —— 考勤是量化的源头，
     「待核」还没定性，不能先替教务扣了分 */
  let wrote = null;
  if (status === '正常' || status === '迟到') {
    const stu = (Array.isArray(data.students) ? data.students : []).find(x => x && x.id === sid);
    const clsId = stu ? stu.classId : '';
    const slots = Array.isArray(data.att_slots) ? data.att_slots : [];
    const pid = (rules && rules.pid) || (slots[0] && slots[0].id) || 'am';
    const akey = 'att:' + date;
    const aarr = Array.isArray(data[akey]) ? data[akey] : [];
    const old = aarr.find(x => x && x.studentId === sid && (x.pid || 'am') === pid);
    /* 请过假的那天不以打卡覆盖 —— 假是教务批的，优先级高于打卡 */
    if (old && (old.status === '病假' || old.status === '事假')) {
      wrote = 'leave';
    } else {
      data[akey] = aarr.filter(x => !(x && x.studentId === sid && (x.pid || 'am') === pid))
                       .concat([{ id: old ? old.id : 'a' + sid + date + pid, studentId: sid, status, pid, _u: now }]);
      if (clsId) syncAttQuant(data, clsId, date);
      wrote = 'att';
    }
  }

  await s.setJSON('org/data', data);
  return json({ ok: true, serverNow: now, date, status, lateMin, dist, way, wrote });
}

/* ══ 考试抽签 ══
   80 人同时点「抽签」如果让服务端逐个随机分配，Blob 没有事务会撞号。
   所以服务端只负责「教务按一下开抽 → 存一个随机种子」，
   序号由各端用同一个确定性算法本地算（先排序再按种子洗牌），
   所有人算出的名单完全一致，且零并发冲突。 */
async function doDraw(s, me, body) {
  if (!me.isStaff) return json({ error: '抽签由教务开' }, 403);
  const data = (await s.get('org/data', { type: 'json' })) || {};
  const name = String(body.name || '').trim();
  if (!name) return json({ error: '给这次抽签起个名字' }, 400);
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return json({ error: '没有要抽签的学员' }, 400);
  const arr = Array.isArray(data.exam_draws) ? data.exam_draws : [];
  const old = arr.find(x => x && x.name === name);
  const item = {
    id: old ? old.id : 'd' + Date.now().toString(36),
    name, seed: randHex(8), ids,
    round: (old ? (old.round || 1) : 0) + 1,
    at: Date.now(), by: me.name || me.user,
  };
  data.exam_draws = arr.filter(x => !(x && x.name === name)).concat([item]);
  await s.setJSON('org/data', data);
  return json({ ok: true, draw: item });
}

/* ── 账号管理 ──
   看列表：两位教务都行（排课时要选「上课老师」，得知道有哪些老师）。
   建号 / 改带班 / 重置密码 / 停用：只有首位教务。 */
async function doUsers(s, me, body) {
  if (!me.isStaff) return json({ error: '只有教务可以管理账号' }, 403);
  const op = String(body.op || 'list');
  if (op !== 'list' && me.role !== SUPER) return json({ error: '账号只有首位教务能改' }, 403);
  const idx = await uidIndex(s);

  if (op === 'list') {
    const out = [];
    for (const uid of idx.ids) {
      const a = await s.get(`auth/${uid}`, { type: 'json' });
      if (!a) continue;
      out.push({
        id: uid, user: a.user || '', name: a.name || a.user || '',
        role: a.role || TEACHER, classIds: a.classIds || [],
        studentId: a.studentId || '',
        active: a.active !== false, createdAt: a.createdAt || 0,
      });
    }
    return json({ ok: true, users: out, ownerId: me.id });
  }

  const normUser = canonUser(body.user);
  const cls = Array.isArray(body.classIds) ? body.classIds.filter(Boolean) : [];

  /* 建一个号。学生号额外挂 studentId —— 学生端「只看自己的」全靠这个字段 */
  const mkUser = async (u, pass, role, name, studentId) => {
    const nu = canonUser(u);
    const bad = userErr(nu);
    if (bad) return { err: bad };
    if (String(pass || '').length < MIN_PASS) return { err: `密码至少 ${MIN_PASS} 位` };
    const uid = await hex('u|' + nu);
    if (await s.get(`auth/${uid}`, { type: 'json' })) return { err: '这个用户名已经存在' };
    const salt = randHex(16);
    const rec = {
      salt, hash: await hex(pass + '|' + salt), role: normRole(role),
      name: String(name || nu).trim().slice(0, 24) || nu,
      classIds: cls, active: true, user: nu, createdAt: Date.now(), createdBy: me.id,
    };
    if (studentId) rec.studentId = String(studentId);
    await s.setJSON(`auth/${uid}`, rec);
    if (!idx.ids.includes(uid)) { idx.ids.push(uid); await s.setJSON('sys/users', idx); }
    return { id: uid, user: nu };
  };

  if (op === 'create') {
    const r = await mkUser(body.user, body.pass, body.role, body.name,
                           body.role === STUDENT ? body.studentId : '');
    if (r.err) return json({ error: r.err }, 400);
    return json({ ok: true, id: r.id });
  }

  /* 批量建号：名册页「一键为学生建账号」，80 个号一次建完。
     单个失败不影响其余的 —— 撞名的那几个单独报回来，教务改一下名字再点。 */
  if (op === 'createMany') {
    const list = Array.isArray(body.list) ? body.list : [];
    if (!list.length) return json({ error: '没有要建的账号' }, 400);
    if (list.length > 300) return json({ error: '一次最多建 300 个' }, 400);
    const ok = [], fail = [];
    for (const it of list) {
      const r = await mkUser(it.user, it.pass, it.role || STUDENT, it.name, it.studentId);
      if (r.err) fail.push({ user: String(it.user || ''), err: r.err });
      else ok.push(r);
    }
    return json({ ok: true, n: ok.length, fail });
  }

  const id = String(body.id || '');
  if (!id) return json({ error: '缺少账号 id' }, 400);
  const target = await s.get(`auth/${id}`, { type: 'json' });
  if (!target) return json({ error: '账号不存在' }, 404);
  if ((target.role || TEACHER) === SUPER) return json({ error: '首位教务的账号不能被修改' }, 403);

  if (op === 'update') {
    if (body.name !== undefined) target.name = String(body.name || '').trim().slice(0, 24) || target.name;
    if (body.classIds !== undefined) target.classIds = cls;
    if (body.active !== undefined) target.active = !!body.active;
    if (body.role !== undefined) target.role = normRole(body.role);
    target.changedAt = Date.now();
    await s.setJSON(`auth/${id}`, target);
    return json({ ok: true });
  }

  if (op === 'pass') {
    const pass = String(body.pass || '');
    if (pass.length < MIN_PASS) return json({ error: `密码至少 ${MIN_PASS} 位` }, 400);
    target.salt = randHex(16);
    target.hash = await hex(pass + '|' + target.salt);
    target.changedAt = Date.now();
    await s.setJSON(`auth/${id}`, target);
    return json({ ok: true });
  }

  if (op === 'delete') {
    target.active = false;
    target.deletedAt = Date.now();
    await s.setJSON(`auth/${id}`, target);
    idx.ids = idx.ids.filter(x => x !== id);
    await s.setJSON('sys/users', idx);
    return json({ ok: true });   // 数据保留，只是不能再登录
  }

  return json({ error: '未知的账号操作' }, 400);
}

export async function onRequestPost(context) {
  const { request } = context;
  const s = store();

  let body;
  try { body = await request.json(); }
  catch { return json({ error: '请求格式不对' }, 400); }

  const action = String(body.action || 'login');

  try {
    /* 探活：前端用它判断「这个地址背后有没有服务端」，据此决定用云端还是本机模式。
       不需要令牌、不碰数据，只是一声「在」。 */
    if (action === 'hello') return json({ ok: true, service: 'liyun-workbench' });

    if (action === 'login' || action === 'register') return await doLogin(s, body);

    const me = await verify(s, body.token);
    if (!me) return json({ error: '登录已过期，请重新登录', code: 'AUTH' }, 401);

    if (action === 'me') return json({ ok: true, profile: me });

    if (action === 'chpass') {
      const oldPass = String(body.oldPass || '');
      const np = String(body.newPass || '');
      if (np.length < MIN_PASS) return json({ error: `新密码至少 ${MIN_PASS} 位` }, 400);
      const auth = await s.get(`auth/${me.id}`, { type: 'json' });
      if (!auth) return json({ error: 'NO_ACCOUNT' }, 404);
      if (await hex(oldPass + '|' + auth.salt) !== auth.hash) return json({ error: '原密码不对' }, 401);
      auth.salt = randHex(16);
      auth.hash = await hex(np + '|' + auth.salt);
      auth.changedAt = Date.now();
      await s.setJSON(`auth/${me.id}`, auth);
      return json({ ok: true, changed: true });
    }

    if (action === 'users') return await doUsers(s, me, body);

    /* 学生打卡：时间、距离、迟到全由服务端定（见 doSign） */
    if (action === 'sign') return await doSign(s, me, body);
    /* 考试抽签：教务开抽存种子，各端本地算序号（见 doDraw） */
    if (action === 'draw') return await doDraw(s, me, body);
    /* 老师/教务屏幕上要显示当前动态码 —— 码必须由服务端现算，前端算不出来 */
    if (action === 'code') {
      if (me.isStudent) return json({ error: '学生端不需要动态码' }, 403);
      const now = Date.now();
      return json({ ok: true, code: await codeAt(await secret(s), Math.floor(now / CODE_WINDOW_MS)),
                    serverNow: now, left: CODE_WINDOW_MS - (now % CODE_WINDOW_MS) });
    }

    if (action === 'pull') {
      const shared = (await s.get('org/data', { type: 'json' })) || {};
      const personal = (await s.get(`data/${me.id}`, { type: 'json' })) || {};
      /* serverNow：客户端拿它校正本地时钟偏差，学生看到的倒计时和办公室的钟是同一个 */
      return json({ ok: true, profile: me, shared: filterShared(shared, me), personal, serverNow: Date.now() });
    }

    if (action === 'push') {
      const raw = JSON.stringify(body.shared || {});
      if (raw.length > MAX_BYTES) {
        return json({ error: '数据太大了（超过 700KB）。图片类内容不要参与同步' }, 413);
      }
      const serverShared = (await s.get('org/data', { type: 'json' })) || {};
      const mine = sanitizePush(body.shared, me, serverShared);
      const mergedShared = mergeAll(serverShared, mine);
      await s.setJSON('org/data', mergedShared);

      const mergedPersonal = mergeAll((await s.get(`data/${me.id}`, { type: 'json' })) || {}, body.personal || {});
      await s.setJSON(`data/${me.id}`, mergedPersonal);

      return json({ ok: true, profile: me, shared: filterShared(mergedShared, me), personal: mergedPersonal });
    }

    return json({ error: '未知操作' }, 400);
  } catch (e) {
    return json({ error: '服务出错：' + (e && e.message ? e.message : '未知原因') }, 500);
  }
}

/** 浏览器预检 */
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
