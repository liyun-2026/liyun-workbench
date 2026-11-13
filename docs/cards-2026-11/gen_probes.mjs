/**
 * 风格探针 · 学生款 3 个全新浅色方向（上轮 A/B/C 全作废，无深色底）
 *   node gen_probes.mjs --render
 * 方案 D 白卡浮影 / 方案 E 金榜题名 / 方案 F 分步彩签
 * 规格：A5 竖版 595×842 CSS px，@2x 渲染 = 1190×1684
 * 产物：学生-D/E/F.png + 风格探针-对照.png（只动学生款，教务/老师等主理人定风格再批量）
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const SEAL_LIGHT = '/Users/xielihui/Desktop/砺蕴教务系统/品牌运营/assets/appicon_seal_light/icon-512.png';

/* 学生款文案（沿用上轮 gen_cards.mjs，照系统实际功能） */
const D = {
  title: '学生上手卡', tagline: '五步上手 · 打卡、课表、作业、请假都在系统里',
  steps: [
    ['用浏览器打开 liyun2026.top，输入学校发的账号密码登录', '首次换设备要输入教务给的「设备密钥」'],
    ['上课打卡：扫码或输 6 位数字码', '「打卡」页 · 码每 30 秒一换，要站在教室位置打'],
    ['看课表与作业完成情况', '「今日 / 我的课表」看安排 ·「作业」页看内容和交没交'],
    ['请假 / 调课申请提交后等批准', '「上报与申请」页 · 批准后课表自动更新'],
    ['忘了密码不用慌', '找教务老师重置'],
  ],
  footer: '代打卡没用——码 30 秒一换，还要位置校验。',
};

const SERIF = `'Songti SC','STSong','Source Han Serif SC','Noto Serif CJK SC',serif`;
const SANS  = `'PingFang SC','Helvetica Neue',sans-serif`;

const shell = (css, body) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>砺蕴上手卡 · 风格探针</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e8e6e1}
.page{width:595px;height:842px;overflow:hidden;position:relative;margin:0 auto}
${css}
</style></head><body>${body}</body></html>`;

/* ══════════ 方案 D 白卡浮影：暖纸底浮大圆角纯白卡 + 金实心圆数字 + 8px 金渐变条 ══════════ */
const designD = () => shell(`
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
  <div class="hd"><h1>${D.title}</h1><div class="sub">${D.tagline}</div><div class="bar"></div></div>
  <ol class="steps">${D.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${D.footer}</p></div>
</div></div>`);

/* ══════════ 方案 E 金榜题名：页首 1/3 古铜金渐变带 + 白底金圈步骤 + 印章式落款 ══════════ */
const designE = () => shell(`
.page{background:#fffdf8;font-family:${SANS};color:#2a2a2a;display:flex;flex-direction:column}
.band{height:268px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#c9ab7c 0%,#b9995f 52%,#a8895a 100%)}
.band::before{content:'';position:absolute;inset:0;
  background:radial-gradient(300px 220px at 18% 8%,rgba(255,253,248,.20),transparent 70%),
             radial-gradient(340px 240px at 88% 96%,rgba(90,64,28,.18),transparent 70%)}
.band::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:rgba(90,64,28,.35)}
.seal{position:relative;width:58px;height:58px;border-radius:50%;overflow:hidden;
  box-shadow:0 3px 12px rgba(90,64,28,.35)}
.seal img{width:100%;height:100%;object-fit:cover;display:block}
.band .brand{position:relative;margin-top:12px;font-family:${SERIF};font-size:11px;letter-spacing:.52em;color:rgba(255,253,248,.85)}
.band h1{position:relative;margin-top:8px;font-family:${SERIF};font-size:35px;font-weight:700;letter-spacing:.16em;white-space:nowrap;color:#fffdf8}
.band .sub{position:relative;margin-top:8px;font-size:12.5px;color:rgba(255,253,248,.9);letter-spacing:.1em}
.body{flex:1;padding:26px 54px 0;position:relative}
.step{display:flex;gap:16px;padding:13px 2px;align-items:flex-start;border-bottom:1px solid rgba(201,171,124,.3)}
.step:last-child{border-bottom:0}
.num{flex:none;width:30px;height:30px;border:1.5px solid #b9995f;border-radius:50%;color:#a8895a;
  font-family:${SERIF};font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}
.act{font-size:15px;line-height:1.55;font-weight:600;color:#2a2a2a}
.where{margin-top:4px;font-size:12.5px;line-height:1.5;color:#8d877b}
.ft{border-top:1px solid rgba(201,171,124,.45);margin:0 54px;padding:14px 0 24px;position:relative}
.ft p{font-size:12px;color:#8d877b;letter-spacing:.05em;line-height:1.5;padding-right:104px}
.stamp{position:absolute;right:16px;bottom:10px;width:84px;height:84px;border-radius:50%;
  border:2.5px solid #b08050;color:#b08050;display:flex;align-items:center;justify-content:center;
  transform:rotate(-12deg);opacity:.6}
.stamp::before{content:'';position:absolute;inset:5px;border:1px solid currentColor;border-radius:50%}
.stamp span{font-family:${SERIF};font-size:17px;font-weight:700;line-height:1.3;letter-spacing:.2em;text-indent:.2em;text-align:center;display:block}
`, `<div class="page">
  <div class="band">
    <div class="seal"><img src="file://${SEAL_LIGHT}" alt=""></div>
    <div class="brand">砺 蕴 教 务 系 统</div>
    <h1>${D.title}</h1>
    <div class="sub">${D.tagline}</div>
  </div>
  <ol class="body">${D.steps.map((s,i)=>`
    <li class="step"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${D.footer}</p></div>
  <div class="stamp"><span>砺蕴<br>教务</span></div>
</div>`);

/* ══════════ 方案 F 分步彩签：暖纸底 + 浅金/浅青/浅赭便签行交替 + 左粗色条大数字 ══════════ */
const designF = () => shell(`
.page{background:radial-gradient(380px 320px at 10% -4%,rgba(201,171,124,.12),transparent 70%),#f6f5f2;
  font-family:${SANS};color:#2a2a2a;padding:50px 46px 0;display:flex;flex-direction:column}
.hd h1{font-family:${SERIF};font-size:35px;font-weight:700;letter-spacing:.14em;white-space:nowrap;color:#2a2a2a}
.hd .brand{margin-top:9px;font-size:11px;letter-spacing:.5em;color:#a8895a}
.hd .sub{margin-top:7px;font-size:12.5px;color:#8d877b;letter-spacing:.08em}
.hd .bar{width:46px;height:5px;border-radius:999px;background:linear-gradient(90deg,#c9ab7c,#a8895a);margin-top:14px}
.notes{margin-top:22px;flex:1;display:flex;flex-direction:column;gap:10px}
.note{display:flex;gap:15px;align-items:flex-start;border-radius:14px;padding:14px 18px 14px 0;margin-left:8px}
.note:nth-child(3n+1){background:#f8f1e3;border-left:7px solid #c9ab7c}
.note:nth-child(3n+2){background:#eaf2ef;border-left:7px solid #86aca4}
.note:nth-child(3n+3){background:#f7ebe1;border-left:7px solid #c08a63}
.note:nth-child(3n+1) .num{color:#a8895a}
.note:nth-child(3n+2) .num{color:#5f8a81}
.note:nth-child(3n+3) .num{color:#a56a3f}
.num{flex:none;width:42px;font-family:${SERIF};font-size:30px;font-weight:700;line-height:1.15;text-align:center}
.act{font-size:15px;line-height:1.5;font-weight:600;color:#2a2a2a}
.where{margin-top:3px;font-size:12.5px;line-height:1.5;color:#6e6857}
.ft{border-top:1px solid rgba(201,171,124,.45);padding:15px 0 24px;text-align:center}
.ft p{font-size:12px;color:#a8895a;letter-spacing:.06em;line-height:1.5}
`, `<div class="page">
  <div class="hd">
    <h1>${D.title}</h1>
    <div class="brand">砺 蕴 教 务 系 统</div>
    <div class="sub">${D.tagline}</div>
    <div class="bar"></div>
  </div>
  <ol class="notes">${D.steps.map((s,i)=>`
    <li class="note"><span class="num">${i+1}</span><div><p class="act">${s[0]}</p><p class="where">${s[1]}</p></div></li>`).join('')}
  </ol>
  <div class="ft"><p>${D.footer}</p></div>
</div>`);

/* ══════════ 对照图 ══════════ */
const LABELS = { D: '方案 D 白卡浮影', E: '方案 E 金榜题名', F: '方案 F 分步彩签' };
const compareSheet = () => shell(`
body{padding:0}
.wrap{width:1508px;height:831px;overflow:hidden;background:#eceae5;padding:34px 34px 0;font-family:${SANS}}
h1{font-family:${SERIF};font-size:26px;color:#2a2a2a;letter-spacing:.1em;white-space:nowrap;margin:2px 0 6px}
.tip{font-size:13px;color:#8d877b;margin-bottom:22px}
.row{display:flex;gap:22px;align-items:flex-start}
.cell{position:relative;width:480px}
.cell img{width:480px;display:block;box-shadow:0 4px 18px rgba(0,0,0,.14)}
.tag{position:absolute;top:10px;left:10px;background:rgba(42,42,42,.78);color:#fff;
  font-size:13px;letter-spacing:.08em;padding:6px 13px;border-radius:999px;white-space:nowrap}
`, `<div class="wrap">
  <h1>学生上手卡 · 风格探针对照</h1>
  <div class="tip">三个全新浅色方向 · 挑中哪个风格告诉主理人编号即可，再批量做教务款 / 老师款</div>
  <div class="row">${['D','E','F'].map(k=>`
    <div class="cell"><span class="tag">${LABELS[k]}</span><img src="学生-${k}.png" alt=""></div>`).join('')}
  </div>
</div>`);

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', c => c === 0 ? res() : rej(new Error(`${cmd} 退出码 ${c}`)));
});

await mkdir(DIR, { recursive: true });
const designs = { D: designD, E: designE, F: designF };
for (const [k, fn] of Object.entries(designs))
  await writeFile(path.join(DIR, `学生-${k}.html`), fn());
await writeFile(path.join(DIR, '风格探针-对照.html'), compareSheet());

if (process.argv.includes('--render')) {
  for (const k of Object.keys(designs))
    await run('node', ['test/html2png.mjs', `docs/cards-2026-11/学生-${k}.html`, `docs/cards-2026-11/学生-${k}.png`, '595', '2', '842']);
  await run('node', ['test/html2png.mjs', 'docs/cards-2026-11/风格探针-对照.html', 'docs/cards-2026-11/风格探针-对照.png', '1508', '1', '831']);
  console.log('✅ 探针渲染完成');
}
