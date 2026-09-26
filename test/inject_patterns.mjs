// 把生成的暗纹 CSS 注入 / 替换到 index.html（首个「学生端：整页水印」注释之前）
// 幂等：已存在暗纹块 -> 原地替换；不存在 -> 首次注入。
import { readFileSync, writeFileSync } from 'node:fs';

const HTML = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/index.html';
const CSS  = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/test/patterns_out.css';

const HEADER = '/* ════════ 五端复合暗纹（自动生成，勿手改；源：test/gen_patterns.mjs） ════════ */';
const ANCHOR = '/* ════════ 学生端：整页水印 ════════';

let html = readFileSync(HTML, 'utf8');
const css = readFileSync(CSS, 'utf8');
/* ⚠️ patterns_out.css 自身首行就是同一条注释头（gen_patterns.mjs 里写死的），
   这里不能再拼一次，否则注释头会出现两遍。 */
const block = css.endsWith('\n') ? css : css + '\n';

const aIdx = html.indexOf(ANCHOR);
if (aIdx < 0) { console.error('anchor「学生端：整页水印」未找到'); process.exit(1); }

const hIdx = html.indexOf(HEADER);
if (hIdx >= 0) {
  html = html.slice(0, hIdx) + block + '\n' + html.slice(aIdx);
  console.log('已【替换】暗纹块（旧块从 ' + hIdx + ' 到 ' + aIdx + '）');
} else {
  html = html.slice(0, aIdx) + block + '\n' + html.slice(aIdx);
  console.log('已【首次注入】暗纹块');
}

if (html.split(HEADER).length - 1 !== 1) { console.error('⚠️ 注释头出现次数异常'); process.exit(1); }
writeFileSync(HTML, html);
console.log('index.html 大小 ' + html.length + ' bytes');
