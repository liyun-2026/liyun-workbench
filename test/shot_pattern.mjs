// 取教师端侧栏暗纹规则，渲染成小页面并截图，验证暗纹可见但克制
import { readFileSync, writeFileSync } from 'node:fs';
const css = readFileSync('/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/test/patterns_out.css','utf8');

// 抓取教师端 .side 规则
const start = css.indexOf('body.role-teacher .side,');
const after = css.indexOf('}', start);          // 第一个 }（规则结束）
const rule = css.slice(start, after+1);
const decl = rule.slice(rule.indexOf('{')+1, rule.lastIndexOf('}'))
  .replace('var(--rail)', '#5E3328');
const block = `.side{${decl}}`;

// 同时抓手机顶栏（浅底）规则 → .top
const ts = css.indexOf('body.role-teacher .topbar{');
const ta = css.indexOf('}', ts);
const trule = css.slice(ts, ta+1);
const tdecl = trule.slice(trule.indexOf('{')+1, trule.lastIndexOf('}'));
const topblock = `.top{background-color:#efece4;${tdecl}}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--rail:#5E3328}
${block}
${topblock}
body{margin:0;display:flex;flex-direction:column;font-family:sans-serif}
.side{width:96px;height:520px}
.top{height:120px;width:96px}
.lab{position:absolute}
</style></head><body>
<div class="top"></div>
<div class="side"></div>
</body></html>`;
writeFileSync('/tmp/pattern_check.html', html);
console.log('written /tmp/pattern_check.html');
