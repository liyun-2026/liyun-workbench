/**
 * VoxOS 5.32 · 三款上手卡设计稿生成器（学生/教务/老师 × 方案A/B/C = 9 张）
 *   node gen_cards.mjs            → 写 9 个 HTML
 *   node gen_cards.mjs --render   → 再调 test/html2png.mjs 渲 9 张 PNG + 3 张对照图
 * 设计稿目录：docs/cards-2026-11/（不碰 index.html，不部署）
 * A5 竖版 148×210mm → 595×842 CSS px，@2x 渲染 = 1190×1684
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');                    // 砺蕴工作台
const SEAL_LIGHT = '/Users/xielihui/Desktop/砺蕴教务系统/品牌运营/assets/appicon_seal_light/icon-512.png';
const SEAL_DARK  = '/Users/xielihui/Desktop/砺蕴教务系统/品牌运营/assets/appicon_seal_dark/icon-512.png';

/* ── 三款卡的真实内容（照系统实际功能，不编） ── */
const DATA = {
  student: {
    file: '学生', title: '学生上手卡', tagline: '五步上手 · 打卡、课表、作业、请假都在系统里',
    steps: [
      ['用浏览器打开 liyun2026.top，输入学校发的账号密码登录', '首次换设备要输入教务给的「设备密钥」'],
      ['上课打卡：扫码或输 6 位数字码', '「打卡」页 · 码每 30 秒一换，要站在教室位置打'],
      ['看课表与作业完成情况', '「今日 / 我的课表」看安排 ·「作业」页看内容和交没交'],
      ['请假 / 调课申请提交后等批准', '「上报与申请」页 · 批准后课表自动更新'],
      ['忘了密码不用慌', '找教务老师重置'],
    ],
    footer: '代打卡没用——码 30 秒一换，还要位置校验。',
  },
  office: {
    file: '教务', title: '教务上手卡', tagline: '六步上手 · 点名、布置、审批、备份一条线',
    steps: [
      ['登录教务账号', '浏览器打开 liyun2026.top'],
      ['点名、点章，误记直接改章', '「考勤」页 · 改完自动保存'],
      ['布置作业、检查上交；发通知选好范围', '「作业」页 ·「通知」页发布前可编辑'],
      ['批假、批工单', '「协作」页 · 批完考勤自动联动'],
      ['改统考 / 模考倒计时日期', '「考试 / 模考」页'],
      ['一键导出全量数据备份', '「设置」→「云端备份」'],
    ],
    footer: '系统每 3 小时自动体检，异常会推手机提醒。',
  },
  teacher: {
    file: '老师', title: '老师上手卡', tagline: '五步看全 · 只读视角，看得全、改不了',
    steps: [
      ['登录授课老师账号', '浏览器打开 liyun2026.top'],
      ['教务板块都能看：考勤 / 作业 / 课表 / 量化 / 打卡记录', '左侧栏各页直接翻'],
      ['只能看、不能改——点章 / 布置 / 审批都没有', '这些由教务老师操作'],
      ['你能写的只有两处：录入今日、上报与申请', '「今日」页 ·「上报与申请」页'],
      ['有问题提工单，等教务处理', '「上报与申请」页'],
    ],
    footer: '授课老师 = 只读视角，看得全、改不了，求改动走工单。',
  },
};

const SERIF = `'Songti SC','STSong','Source Han Serif SC','Noto Serif CJK SC',serif`;
const SANS  = `'PingFang SC','Helvetica Neue',sans-serif`;

const shell = (css, body) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>砺蕴上手卡</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e8e6e1}
.page{width:595px;height:842px;overflow:hidden;position:relative;margin:0 auto}
${css}
</style></head><body>${body}</body></html>`;

/* ══════════ 方案 A 素笺极简：暖纸底 + 细金线 + 小圆金圈 + 大量留白，无卡片框 ══════════ */
const designA = d => shell(`
.page{background:#f6f5f2;font-family:${SANS};color:#2a2a2a;padding:64px 58px 0;display:flex;flex-direction:column}
.brand{font-family:${SERIF};font-size:12px;letter-spacing:.62em;color:#a8895a;text-align:center}
.hd{margin-top:26px;text-align:center}
.hd h1{font-family:${SERIF};font-size:37px;font-weight:700;letter-spacing:.14em;white-space:nowrap;color:#2a2a2a}
.hd .sub{margin-top:12px;font-size:12.5px;color:#8d877b;letter-spacing:.12em}
.hd .line{width:44px;height:1px;background:#c9ab7c;margin:20px auto 0}
.steps{margin-top:34px;flex:1}
.step{display:flex;gap:16px;padding:15px 2px;border-bottom:1px solid rgba(201,171,124,.32);align-items:flex-start}
.step:last-child{border-bottom:0}
.num{flex:none;width:27px;height:27px;border:1px solid #c9ab7c;border-radius:50%;color:#a8895a;
  font-family:${SERIF};font-size:14px;display:flex;align-items:center;justify-content:center;margin-top:1px}
.act{font-size:15px;line-height:1.55;font-weight:600;color:#2a2a2a}
.where{margin-top:4px;font-size:12.5px;line-height:1.5;color:#8d877b}
.ft{border-top:1px solid #c9ab7c;margin:0 -58px;padding:16px 58px 26px;text-align:center}
.ft p{font-size:12px;color:#a8895a;letter-spacing:.06em;line-height:1.5}
`, `<div class="page">
  <div class="brand">砺 蕴 教 务 系 统</div>
  <div class="hd"><h1>${d.title}</h1><div class="sub">${d.tagline}</div><div class="line"></div></div>
  <ol class="steps">${d.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${d.footer}</p></div>
</div>`);

/* ══════════ 方案 B 暖金衬线册页：宋体大标题 + 金线框卡 + 页首金印落章 + 微金晕 ══════════ */
const designB = d => shell(`
.page{background:#f6f5f2;font-family:${SANS};color:#2a2a2a;padding:40px 44px 0;display:flex;flex-direction:column}
.page::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(340px 300px at 82% -4%,rgba(201,171,124,.16),transparent 70%),
             radial-gradient(300px 260px at 8% 104%,rgba(201,171,124,.13),transparent 70%)}
.hd{position:relative;text-align:center}
.seal{width:66px;height:66px;border-radius:50%;overflow:hidden;margin:0 auto;
  box-shadow:0 3px 14px rgba(24,33,30,.28)}
.seal img{width:100%;height:100%;object-fit:cover;display:block}
.hd h1{margin-top:14px;font-family:${SERIF};font-size:34px;font-weight:700;letter-spacing:.16em;white-space:nowrap;color:#2a2a2a}
.hd .brand{margin-top:10px;font-size:11px;letter-spacing:.5em;color:#a8895a}
.hd .sub{margin-top:8px;font-size:12.5px;color:#8d877b;letter-spacing:.08em}
.dbl{margin:18px auto 0;width:200px;height:7px;
  border-top:1px solid #c9ab7c;border-bottom:1px solid rgba(201,171,124,.55)}
.steps{margin-top:20px;flex:1;display:flex;flex-direction:column;gap:9px;position:relative}
.card{border:1px solid rgba(201,171,124,.55);background:rgba(255,255,255,.55);border-radius:10px;
  padding:11px 16px 11px 14px;display:flex;gap:13px;align-items:flex-start}
.cn{flex:none;font-family:${SERIF};font-size:19px;color:#a8895a;line-height:1.35;min-width:22px;text-align:center}
.act{font-size:14.5px;line-height:1.5;font-weight:600;color:#2a2a2a}
.where{margin-top:3px;font-size:12px;line-height:1.5;color:#8d877b}
.ft{border:1px solid rgba(201,171,124,.55);border-radius:10px;background:rgba(255,255,255,.55);
  margin:14px 0 26px;padding:11px;text-align:center;position:relative}
.ft p{font-size:12px;color:#a8895a;letter-spacing:.05em;line-height:1.5}
`, `<div class="page">
  <div class="hd">
    <div class="seal"><img src="file://${SEAL_LIGHT}" alt=""></div>
    <h1>${d.title}</h1>
    <div class="brand">砺 蕴 教 务 系 统</div>
    <div class="sub">${d.tagline}</div>
    <div class="dbl"></div>
  </div>
  <ol class="steps">${d.steps.map((s,i)=>`
    <li class="card"><span class="cn">${'一二三四五六'[i]}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${d.footer}</p></div>
</div>`);

/* ══════════ 方案 C 高对比速览：深色底 + 金字 + 大数字 + 紧凑一行流，黑白打印也清楚 ══════════ */
const designC = d => shell(`
.page{background:#18211E;font-family:${SANS};color:#f3eedd;padding:56px 50px 0;display:flex;flex-direction:column}
.mark{position:absolute;top:40px;right:44px;width:52px;height:52px;border-radius:50%;overflow:hidden;opacity:.9}
.mark img{width:100%;height:100%;object-fit:cover;display:block}
.brand{font-family:${SERIF};font-size:12px;letter-spacing:.6em;color:#D9BE86}
.hd h1{margin-top:16px;font-family:${SERIF};font-size:36px;font-weight:700;letter-spacing:.14em;white-space:nowrap;color:#D9BE86}
.hd .sub{margin-top:10px;font-size:12.5px;color:#b9b19a;letter-spacing:.1em}
.hd .line{margin-top:18px;height:1px;background:rgba(217,190,134,.65)}
.steps{margin-top:8px;flex:1}
.step{display:flex;gap:18px;padding:13px 0;border-bottom:1px solid rgba(217,190,134,.16);align-items:flex-start}
.step:last-child{border-bottom:0}
.num{flex:none;width:50px;font-family:${SERIF};font-size:36px;line-height:1.05;font-weight:700;color:#D9BE86;text-align:right}
.act{font-size:15px;line-height:1.5;font-weight:600;color:#f3eedd}
.where{margin-top:4px;font-size:12.5px;line-height:1.5;color:#b9b19a}
.where b{color:#D9BE86;font-weight:600}
.ft{border-top:1px solid #D9BE86;margin:0 -50px;padding:16px 50px 26px;text-align:center}
.ft p{font-size:12px;color:#D9BE86;letter-spacing:.06em;line-height:1.5}
`, `<div class="page">
  <div class="mark"><img src="file://${SEAL_DARK}" alt=""></div>
  <div class="hd">
    <div class="brand">砺 蕴 教 务 系 统</div>
    <h1>${d.title}</h1>
    <div class="sub">${d.tagline}</div>
    <div class="line"></div>
  </div>
  <ol class="steps">${d.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where"><b>→</b> ${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${d.footer}</p></div>
</div>`);

const DESIGNS = [['A', designA], ['B', designB], ['C', designC]];

/* ══════════ 对照图：三格并排，格上角标签（与主理人问句逐字一致） ══════════ */
const LABELS = { A: '方案 A 素笺极简', B: '方案 B 暖金册页', C: '方案 C 深色速览' };
const compareSheet = (roleKey, d) => shell(`
body{padding:0}
.wrap{width:1508px;height:831px;overflow:hidden;background:#eceae5;padding:34px 34px 0;font-family:${SANS}}
h1{font-family:${SERIF};font-size:26px;color:#2a2a2a;letter-spacing:.1em;white-space:nowrap;margin:2px 0 6px}
.tip{font-size:13px;color:#8d877b;margin-bottom:22px}
.row{display:flex;gap:22px;align-items:flex-start}
.cell{position:relative;width:480px}
.cell img{width:480px;display:block;box-shadow:0 4px 18px rgba(0,0,0,.14)}
.tag{position:absolute;top:10px;left:10px;background:rgba(24,33,30,.82);color:#f3eedd;
  font-size:13px;letter-spacing:.08em;padding:6px 13px;border-radius:999px;white-space:nowrap}
`, `<div class="wrap">
  <h1>${d.title} · 三方案对照</h1>
  <div class="tip">A5 竖版 148×210mm 设计稿 · 挑中哪款告诉主理人编号即可</div>
  <div class="row">${['A','B','C'].map(k=>`
    <div class="cell"><span class="tag">${LABELS[k]}</span><img src="${d.file}-${k}.png" alt=""></div>`).join('')}
  </div>
</div>`);

/* ══════════ 画廊 ══════════ */
const gallery = () => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>砺蕴上手卡 · 设计稿画廊</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f6f5f2;font-family:'PingFang SC',sans-serif;color:#2a2a2a;padding:44px 48px 64px}
h1{font-family:'Songti SC',serif;font-size:30px;letter-spacing:.12em;white-space:nowrap}
.sub{color:#8d877b;font-size:13px;margin:8px 0 30px;letter-spacing:.06em}
h2{font-family:'Songti SC',serif;font-size:20px;letter-spacing:.1em;margin:34px 0 14px;color:#a8895a;
  border-top:1px solid #c9ab7c;padding-top:22px}
.grid{display:flex;gap:20px;flex-wrap:wrap}
figure{width:300px}
figure a{display:block}
figure img{width:300px;display:block;box-shadow:0 3px 14px rgba(0,0,0,.13);border-radius:4px}
figcaption{margin-top:9px;font-size:13px;color:#5c574d;text-align:center;letter-spacing:.05em}
</style></head><body>
<h1>砺蕴教务系统 · 上手卡设计稿</h1>
<div class="sub">三款卡 × 三方案 = 9 张 · A5 竖版 148×210mm · @2x 渲染 1190×1684 · 点图看全尺寸</div>
${Object.entries(DATA).map(([key, d]) => `
<h2>${d.title}</h2>
<div class="grid">${['A','B','C'].map(k => `
<figure><a href="${d.file}-${k}.png" target="_blank"><img src="${d.file}-${k}.png" alt=""></a>
<figcaption>${LABELS[k]}</figcaption></figure>`).join('')}
</div>`).join('')}
</body></html>`;

/* ══════════ 写文件 + 渲染 ══════════ */
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', c => c === 0 ? res() : rej(new Error(`${cmd} 退出码 ${c}`)));
});

const writeAll = async () => {
  await mkdir(DIR, { recursive: true });
  for (const [key, d] of Object.entries(DATA))
    for (const [k, fn] of DESIGNS)
      await writeFile(path.join(DIR, `${d.file}-${k}.html`), fn(d));
  for (const d of Object.values(DATA))
    await writeFile(path.join(DIR, `${d.file}-对照.html`), compareSheet(d.file, d));
  await writeFile(path.join(DIR, 'index.html'), gallery());
  console.log('✅ HTML 写完（9 卡 + 3 对照 + 画廊）');
};

const renderAll = async () => {
  for (const [key, d] of Object.entries(DATA))
    for (const [k] of DESIGNS)
      await run('node', ['test/html2png.mjs', `docs/cards-2026-11/${d.file}-${k}.html`, `docs/cards-2026-11/${d.file}-${k}.png`, '595', '2', '842']);
  /* 对照图三格并排：CSS 宽 1508、wrap 定高 831，@1x 足够挑款 */
  for (const d of Object.values(DATA))
    await run('node', ['test/html2png.mjs', `docs/cards-2026-11/${d.file}-对照.html`, `docs/cards-2026-11/${d.file}款-对照.png`, '1508', '1', '831']);
  console.log('✅ PNG 渲完（9 卡 + 3 对照）');
};

if (process.argv.includes('--render')) { await writeAll(); await renderAll(); }
else await writeAll();
