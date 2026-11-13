/**
 * D 风格全套补齐 · 主理人已定「方案 D 白卡浮影」（学生-D.png 已定稿不动）
 *   node gen_d_set.mjs --render
 * 产出：教务-D.png（6 步）+ 老师-D.png（5 步）+ D风格-全套对照.png（三格并排）
 * 工艺：A5 竖版 595×842 CSS px @2x = 1190×1684；test/html2png.mjs；真令牌
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');

/* 文案逐字沿用 gen_cards.mjs 的教务款 / 老师款（照系统实际功能） */
const DATA = {
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
<title>砺蕴上手卡 · D 风格</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e8e6e1}
.page{width:595px;height:842px;overflow:hidden;position:relative;margin:0 auto}
${css}
</style></head><body>${body}</body></html>`;

/* ══════════ 方案 D 白卡浮影（与 gen_probes.mjs designD 同一工艺，参数化为任意款） ══════════ */
const designD = d => shell(`
.page{background:radial-gradient(420px 360px at 88% -6%,rgba(201,171,124,.14),transparent 70%),#f6f5f2;
  font-family:${SANS};color:#2a2a2a;padding:40px;display:flex}
.card{flex:1;background:#fff;border:1px solid rgba(201,171,124,.5);border-radius:26px;
  box-shadow:0 2px 6px rgba(42,42,42,.05),0 12px 34px rgba(42,42,42,.10),0 30px 70px rgba(168,137,90,.16);
  padding:44px 46px 0;display:flex;flex-direction:column;overflow:hidden}
.brand{font-family:${SERIF};font-size:11px;letter-spacing:.6em;color:#a8895a;text-align:center}
.hd{text-align:center;margin-top:14px}
.hd h1{font-family:${SERIF};font-size:36px;font-weight:700;letter-spacing:.14em;white-space:nowrap;color:#2a2a2a}
.hd .sub{margin-top:10px;font-size:12.5px;color:#8d877b;letter-spacing:.1em}
.bar{width:64px;height:8px;border-radius:999px;margin:16px auto 0;
  background:linear-gradient(90deg,#c9ab7c,#a8895a);box-shadow:0 2px 6px rgba(168,137,90,.3)}
.steps{margin-top:24px}
.step{display:flex;gap:17px;padding:13px 2px;align-items:flex-start;border-bottom:1px solid rgba(201,171,124,.22)}
.step:last-child{border-bottom:0}
.num{flex:none;width:34px;height:34px;border-radius:50%;color:#fff;
  background:linear-gradient(135deg,#c9ab7c,#a8895a);font-family:${SERIF};font-size:17px;font-weight:700;
  display:flex;align-items:center;justify-content:center;box-shadow:0 3px 9px rgba(168,137,90,.38);margin-top:1px}
.act{font-size:15px;line-height:1.55;font-weight:600;color:#2a2a2a}
.where{margin-top:4px;font-size:12.5px;line-height:1.5;color:#8d877b}
.ft{margin-top:auto;border-top:1px solid rgba(201,171,124,.45);padding:15px 0 24px;text-align:center}
.ft p{font-size:12px;color:#a8895a;letter-spacing:.06em;line-height:1.5}
`, `<div class="page"><div class="card">
  <div class="brand">砺 蕴 教 务 系 统</div>
  <div class="hd"><h1>${d.title}</h1><div class="sub">${d.tagline}</div><div class="bar"></div></div>
  <ol class="steps">${d.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${d.footer}</p></div>
</div></div>`);

/* ══════════ 全套对照：三格并排（学生-D.png 定稿原样嵌入） ══════════ */
const compareSheet = () => shell(`
body{padding:0}
.wrap{width:1508px;height:831px;overflow:hidden;background:#eceae5;padding:34px 34px 0;font-family:${SANS}}
h1{font-family:${SERIF};font-size:26px;color:#2a2a2a;letter-spacing:.1em;white-space:nowrap;margin:2px 0 6px}
.tip{font-size:13px;color:#8d877b;margin-bottom:22px}
.row{display:flex;gap:22px;align-items:flex-start}
.cell{position:relative;width:480px}
.cell img{width:480px;display:block;box-shadow:0 4px 18px rgba(0,0,0,.14)}
.tag{position:absolute;top:10px;left:10px;background:rgba(42,42,42,.78);color:#fff;
  font-size:13px;letter-spacing:.1em;padding:6px 14px;border-radius:999px;white-space:nowrap}
`, `<div class="wrap">
  <h1>D 风格 · 上手卡全套对照</h1>
  <div class="tip">主理人已定「方案 D 白卡浮影」· 三款同风格 · 确认后进入手册环节</div>
  <div class="row">${['学生', '教务', '老师'].map(f=>`
    <div class="cell"><span class="tag">${f}款</span><img src="${f}-D.png" alt=""></div>`).join('')}
  </div>
</div>`);

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', c => c === 0 ? res() : rej(new Error(`${cmd} 退出码 ${c}`)));
});

await mkdir(DIR, { recursive: true });
for (const d of Object.values(DATA))
  await writeFile(path.join(DIR, `${d.file}-D.html`), designD(d));
await writeFile(path.join(DIR, 'D风格-全套对照.html'), compareSheet());

if (process.argv.includes('--render')) {
  for (const d of Object.values(DATA))
    await run('node', ['test/html2png.mjs', `docs/cards-2026-11/${d.file}-D.html`, `docs/cards-2026-11/${d.file}-D.png`, '595', '2', '842']);
  await run('node', ['test/html2png.mjs', 'docs/cards-2026-11/D风格-全套对照.html', 'docs/cards-2026-11/D风格-全套对照.png', '1508', '1', '831']);
  console.log('✅ D 风格全套渲染完成');
}
