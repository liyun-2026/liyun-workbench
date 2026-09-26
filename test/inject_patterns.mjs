// 把生成的暗纹 CSS 注入 index.html 的 <style> 头部（首个「学生端：整页水印」注释之前）
import { readFileSync, writeFileSync } from 'node:fs';

const HTML = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/index.html';
const CSS = '/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/test/patterns_out.css';

let html = readFileSync(HTML, 'utf8');
const css = readFileSync(CSS, 'utf8');

const anchor = '/* ════════ 学生端：整页水印 ════════';
const idx = html.indexOf(anchor);
if (idx < 0) { console.error('anchor not found'); process.exit(1); }

// 防御：若已注入过则跳过
if (html.includes('五端复合暗纹（自动生成')) {
  console.log('暗纹 CSS 已注入，跳过。');
  process.exit(0);
}

const inject = `\n/* ════════ 五端复合暗纹（自动生成，勿手改；源：test/gen_patterns.mjs） ════════ */\n` + css + `\n`;
html = html.slice(0, idx) + inject + html.slice(idx);
writeFileSync(HTML, html);
console.log('已注入暗纹 CSS，文件大小', html.length, 'bytes');
