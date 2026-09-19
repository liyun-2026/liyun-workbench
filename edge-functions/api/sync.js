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
/* 数据口径上「算教务」的角色：能拿到全部数据、能写全部数据。
   both 也算教务（否则 TA 打开考勤/量化会是一片空），只是不能管账号（看 doUsers）。 */
const STAFF = [SUPER, ADMIN, BOTH];
/* 建号 / 改身份时允许的身份。super 只能有一个，不在这里 —— 谁也建不出第二个 */
const ASSIGNABLE = [ADMIN, BOTH, TEACHER];
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

function mergeAll(server, client) {
  const out = Object.assign({}, server || {});
  for (const [k, cv] of Object.entries(client || {})) {
    if (k.startsWith('_')) continue;
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
    isSuper: auth.role === SUPER,
    isStaff: STAFF.includes(auth.role),
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

/* ── 授课老师：只下发自己班的班级/学员/考勤/作业/过关/成绩/体重/评语，加自己提的工单 ── */
function filterShared(shared, me) {
  const src = shared || {};
  if (me.isStaff) return src;
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

/* ── 写回白名单：老师只能提交自己的工单和自己录的今日情况；次位教务改不了首位教务的东西 ── */
function sanitizePush(shared, me, serverShared) {
  const src = shared || {};
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
        active: a.active !== false, createdAt: a.createdAt || 0,
      });
    }
    return json({ ok: true, users: out, ownerId: me.id });
  }

  const normUser = canonUser(body.user);
  const cls = Array.isArray(body.classIds) ? body.classIds.filter(Boolean) : [];

  if (op === 'create') {
    const bad = userErr(normUser);
    if (bad) return json({ error: bad }, 400);
    const pass = String(body.pass || '');
    if (pass.length < MIN_PASS) return json({ error: `密码至少 ${MIN_PASS} 位` }, 400);
    const uid = await hex('u|' + normUser);
    if (await s.get(`auth/${uid}`, { type: 'json' })) return json({ error: '这个用户名已经存在' }, 400);
    const salt = randHex(16);
    const role = normRole(body.role);   // 不允许再建 super，首位只有一个
    await s.setJSON(`auth/${uid}`, {
      salt, hash: await hex(pass + '|' + salt), role,
      name: String(body.name || normUser).trim().slice(0, 24),
      classIds: cls, active: true, user: normUser, createdAt: Date.now(), createdBy: me.id,
    });
    if (!idx.ids.includes(uid)) { idx.ids.push(uid); await s.setJSON('sys/users', idx); }
    return json({ ok: true, id: uid });
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

    if (action === 'pull') {
      const shared = (await s.get('org/data', { type: 'json' })) || {};
      const personal = (await s.get(`data/${me.id}`, { type: 'json' })) || {};
      return json({ ok: true, profile: me, shared: filterShared(shared, me), personal });
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
