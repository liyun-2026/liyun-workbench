/**
 * 打卡时段自动跟作息走 · 专项核对（真后端，不是静态断言）
 *
 *   node test/sign_slot_auto_check.mjs [port]
 *
 * 背景（2026-11-23 主理人口述）：
 *   「打卡的时间段按照作息时间的早上 7:50，下午 14:50 打卡签到，
 *     再有一个自定义的时间就行。」
 *
 * 要守住的事：
 *   1. 上午打卡（07:55）记进「上午」那条考勤，不是下午；
 *   2. 下午打卡（14:55）记进「下午」那条考勤 —— 教务中午没去改任何设置；
 *   3. 自定义时间（customStart=07:45）时，07:50 打 = 迟到 5 分钟，
 *      说明用的是自定义那个点，不是作息里的 07:50；
 *   4. 服务端只有一处口径：effSign() 同时给「迟到判定 / 写考勤 / 待核结算 / 跨日核销」用；
 *   5. 前端打卡设置只剩「跟随作息 / 自定义时间」两项，存档写的是 auto/custom。
 *
 * 全程用本地 dev-server（真 sync.js + 内存 Blob），跑完 dev-reset 清场。
 */
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '*';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5371);
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

/* 北京时间今天 + 指定时分 → 时间戳 */
const cnAt = (hh, mm) => {
  const d = new Date(Date.now() + 8 * 3600e3);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate();
  return Date.UTC(y, mo, da, hh, mm, 0) - 8 * 3600e3;
};
const cnDate = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const srv = spawn(process.execPath, [path.join(dir, 'test', 'dev-server.mjs'), String(PORT)], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(BASE + '/api/dev-state', { signal: AbortSignal.timeout(1500) }); if (r.ok) { up = true; break; } } catch {}
  await sleep(300);
}
if (!up) { console.log('❌ dev-server 起不来'); srv.kill('SIGKILL'); process.exit(1); }

try {
  /* ── 0. 清场 ── */
  await fetch(BASE + '/api/dev-reset', { method: 'POST' });
  const staff = await must('login', { user: '打卡时段测试教务', pass: 'slotpass1234' });

  const SID = 'stu_slot_1', CLS = 'cls_slot_1';
  await must('push', {
    shared: {
      classes: [{ id: CLS, name: '打卡时段测试班' }],
      students: [{ id: SID, name: '时段测试生', classId: CLS }],
      /* 生产同款作息：上午 07:50 上课，下午 14:50 上课，13:00 是看板切段点 */
      att_slots: [
        { id: 'am', name: '上午', start: '07:50', boardFrom: '00:00', boardTo: '13:00' },
        { id: 'pm', name: '下午', start: '14:50', boardFrom: '13:00', boardTo: '24:00' },
      ],
      sign_rules: { startAt: '07:50', lateAfter: 0, windowBefore: 60, windowAfter: 30, radius: 150, pid: 'auto' },
    },
  }, staff.token);
  await must('users', { op: 'createMany', list: [
    { user: '时段测试生', pass: 'byslot12345', role: 'student', name: '时段测试生', studentId: SID },
  ] }, staff.token);
  const stu = await must('login', { user: '时段测试生', pass: 'byslot12345' });

  const code = async () => (await must('code', {}, staff.token)).code;
  const signAt = async (hh, mm) => {
    const j = await must('sign', { code: await code(), at: cnAt(hh, mm), offline: true, dev: 'slot-test' }, stu.token);
    return j;
  };
  const attOf = async () => {
    const p = await must('pull', {}, staff.token);
    const d = p.shared || {};
    return { date: cnDate(), rows: (d['att:' + cnDate()] || []).filter(x => x && x.studentId === SID && !x._d) };
  };

  /* ── 1. 上午打卡 → 上午考勤 ── */
  const rAm = await signAt(7, 55);
  ok(rAm.status === '迟到' && Number(rAm.lateMin) === 5,
     `上午 07:55 打卡：按第一节 07:50 判迟到 5 分钟（实际 ${rAm.status} / ${rAm.lateMin} 分）`);
  ok(rAm.wrote === 'att', `上午打卡写进了考勤（wrote=${rAm.wrote}）`);
  const attAm = await attOf();
  ok(attAm.rows.length === 1 && attAm.rows[0].pid === 'am',
     `上午这条落在「上午」时段（实际 ${JSON.stringify(attAm.rows.map(x => x.pid))}）`);

  /* ── 2. 下午打卡 → 下午考勤（教务中午什么都没动） ── */
  const rPm = await signAt(14, 55);
  ok(rPm.status === '迟到' && Number(rPm.lateMin) === 5,
     `下午 14:55 打卡：按下午第一节 14:50 判迟到 5 分钟（实际 ${rPm.status} / ${rPm.lateMin} 分）`);
  ok(rPm.wrote === 'att', `下午打卡也写进了考勤（wrote=${rPm.wrote}）`);

  const att1 = await attOf();
  const pids = att1.rows.map(x => x.pid).sort();
  ok(pids.length === 2 && pids[0] === 'am' && pids[1] === 'pm',
     `云端同一天两条考勤：上午 + 下午（实际 ${JSON.stringify(pids)}）`);

  /* ── 3. 自定义时间：用 customStart 判迟到，时段仍按钟点归 ── */
  await must('push', { shared: { sign_rules: { startAt: '07:45', lateAfter: 0, windowBefore: 60, windowAfter: 30,
    radius: 150, pid: 'custom', mode: 'custom', customStart: '07:45' } } }, staff.token);
  const rCustom = await signAt(7, 50);
  ok(rCustom.status === '迟到' && Number(rCustom.lateMin) === 5,
     `自定义 07:45 时 07:50 打 = 迟到 5 分钟（不是作息 07:50 的 0 分钟）→ ${rCustom.status} / ${rCustom.lateMin}`);
  const att2 = await attOf();
  ok(att2.rows.every(x => x.pid === 'am' || x.pid === 'pm'),
     `自定义时间也按时段归类，不产生「custom」这种假时段（实际 ${JSON.stringify(att2.rows.map(x => x.pid))}）`);

  /* ── 4. 静态：口径唯一 + 前端只剩两项 ── */
  const sync = await readFile(path.join(dir, 'edge-functions', 'api', 'sync.js'), 'utf8');
  const html = await readFile(path.join(dir, 'index.html'), 'utf8');
  ok(/function effSign\(rules, slots, min\)/.test(sync), '服务端有唯一的 effSign() 时段解析');
  ok((sync.match(/effSign\(/g) || []).length >= 4, `迟到判定 / 写考勤 / 待核结算 / 跨日核销都走它（${(sync.match(/effSign\(/g) || []).length} 处）`);
  ok(!/const pid = \(rules && rules\.pid\)/.test(sync), '没有「直接拿 sign_rules.pid 当考勤时段」的老写法了');
  ok(/id:'auto',\s+name:'跟随作息/.test(html) && /id:'custom', name:'自定义时间'/.test(html),
     '打卡设置只剩「跟随作息 / 自定义时间」两项');
  ok(/out\.pid = pid;/.test(html) && /out\.mode = mode;/.test(html), '前端 rules() 返回真实时段 + 口径');
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message || e));
} finally {
  try { await fetch(BASE + '/api/dev-reset', { method: 'POST' }); } catch {}
  srv.kill('SIGKILL');
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
