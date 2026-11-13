/**
 * PPT 用上手卡重制（博艺品牌 + 老师卡正向措辞）
 *   cd <工作台ROOT> && node docs/boss-ppt-2026-11-13/博艺教务系统/gen_ppt_cards.mjs
 * 产出覆盖 docs/boss-ppt-2026-11-13/博艺教务系统/assets/{card_student,card_office,card_teacher}.png
 * 工艺：与 gen_d_set.mjs designD 同一版式；A5 竖版 595×842 CSS px @2x = 1190×1684
 * cards-2026-11 目录原稿不动。
 */
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..', '..');

const DATA = {
  student: {
    file: 'card_student', title: '学生上手卡', tagline: '五步上手 · 打卡、课表、作业、请假都在系统里',
    steps: [
      ['用浏览器打开 liyun2026.top，输入学校发的账号密码登录', '首次换设备要输入教务给的「设备密钥」'],
      ['上课打卡：扫码或输 6 位数字码', '「打卡」页 · 码每 30 秒一换，要站在教室位置打'],
      ['看课表与作业完成情况', '「今日 / 我的课表」看安排 ·「作业」页看内容和交没交'],
      ['请假 / 调课申请提交后等批准', '「上报与申请」页 · 批准后课表自动更新'],
      ['忘了密码不用慌', '找教务老师重置'],
    ],
    footer: '码 30 秒一换，还要位置校验，打卡真实可靠。',
  },
  office: {
    file: 'card_office', title: '教务上手卡', tagline: '六步上手 · 点名、布置、审批、备份一条线',
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
    file: 'card_teacher', title: '老师上手卡', tagline: '五步上手 · 课表考勤作业一目了然',
    steps: [
      ['登录授课老师账号', '浏览器打开 liyun2026.top'],
      ['课表、考勤、作业一目了然', '左侧栏各页随手翻'],
      ['每日情况随手录入', '「今日」页 · 写完自动保存'],
      ['申请与上报在线提交', '「上报与申请」页 · 一键提交'],
      ['有问题提工单，教务及时跟进', '「上报与申请」页'],
    ],
    footer: '课表考勤作业一目了然，每日录入与申请在线提交。',
  },
};

const SERIF = `'Songti SC','STSong','Source Han Serif SC','Noto Serif CJK SC',serif`;
const SANS  = `'PingFang SC','Helvetica Neue',sans-serif`;

const shell = (css, body) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>博艺上手卡</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e8e6e1}
.page{width:595px;height:842px;overflow:hidden;position:relative;margin:0 auto}
${css}
</style></head><body>${body}</body></html>`;

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
  <div class="brand">博 艺 教 务 系 统</div>
  <div class="hd"><h1>${d.title}</h1><div class="sub">${d.tagline}</div><div class="bar"></div></div>
  <ol class="steps">${d.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${d.footer}</p></div>
</div></div>`);

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', c => c === 0 ? res() : rej(new Error(`${cmd} 退出码 ${c}`)));
});

for (const d of Object.values(DATA))
  await writeFile(path.join(DIR, `${d.file}.html`), designD(d));

for (const d of Object.values(DATA))
  await run('node', ['test/html2png.mjs', `docs/boss-ppt-2026-11-13/博艺教务系统/${d.file}.html`, `docs/boss-ppt-2026-11-13/博艺教务系统/assets/${d.file}.png`, '595', '2', '842']);
console.log('✅ PPT 用三张上手卡渲染完成');
