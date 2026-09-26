// 生成五端复合「暗纹」CSS —— 甲方案终版调色板
// 复用 五端口纹样设计.html 的 patInner / lattice / flower
// 输出到 test/patterns_out.css（浅/深底、rail 面 / topbar 面）
import { writeFileSync } from 'node:fs';

/* ---------- 颜色工具 ---------- */
function hx(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function rh(r){return '#'+r.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');}
function darken(hex,a){const c=hx(hex);return rh(c.map(v=>v*(1-a)));}
function lighten(hex,a){const c=hx(hex);return rh(c.map(v=>v+(255-v)*a));}

/* 花朵（莲 / 牡丹 / 宝相花通用） */
function flower(cx,cy,r,n,color,op){
  let s='';
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2;
    const px=cx+Math.cos(a)*r*0.5, py=cy+Math.sin(a)*r*0.5;
    const deg=(a*180/Math.PI).toFixed(1);
    s+=`<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(r*0.27).toFixed(1)}" ry="${(r*0.12).toFixed(1)}" transform="rotate(${deg} ${px.toFixed(1)} ${py.toFixed(1)})" fill="${color}" fill-opacity="${op}"/>`;
  }
  s+=`<circle cx="${cx}" cy="${cy}" r="${(r*0.2).toFixed(1)}" fill="${color}" fill-opacity="${op}"/>`;
  return s;
}
/* 圆形晶格（锁子/龟背/连钱） */
function lattice(tw,th,stepX,stepY,rowOff,r,ring,color,op){
  let s='';
  const nx=Math.ceil(tw/stepX)+3, ny=Math.ceil(th/stepY)+3;
  for(let j=-1;j<=ny;j++){
    const oy=(j&1)?rowOff:0;
    for(let i=-1;i<=nx;i++){
      const cx=(i*stepX+oy).toFixed(1), cy=(j*stepY).toFixed(1);
      if(ring) s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.4" stroke-opacity="${op}"/>`;
      else     s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${op}"/>`;
    }
  }
  return s;
}
/* 单层 tile */
function patInner(type,color,op){
  let tw=100,th=100,inner='';
  if(type==='water'){ tw=100; th=44;
    inner=`<path d="M0,22 q12.5,-14 25,0 t25,0 t25,0 t25,0" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`;
  } else if(type==='vine'){ tw=th=100;
    inner=`<path d="M0,50 C20,22 30,22 50,50 C70,78 80,78 100,50" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      +`<path d="M25,36 q-9,-7 -3,-16 q10,3 5,16 z" fill="${color}" fill-opacity="${op}"/>`
      +`<path d="M75,64 q9,7 3,16 q-10,-3 -5,-16 z" fill="${color}" fill-opacity="${op}"/>`
      +`<path d="M50,50 a5,5 0 1 1 -5,-5" fill="none" stroke="${color}" stroke-width="2.2" stroke-opacity="${op}"/>`;
  } else if(type==='cloud'){ tw=100; th=50;
    inner=`<path d="M0,28 q10,-18 20,0 t20,0 t20,0 t20,0 t20,0" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      +`<path d="M0,42 h100" fill="none" stroke="${color}" stroke-width="2.2" stroke-opacity="${op}"/>`;
  } else if(type==='lock'){ tw=th=44;
    inner=lattice(44,44,22,22,0,14,false,color,op);
  } else if(type==='tortoise'){ tw=72; th=62;
    inner=lattice(72,62,24,20.78,12,12,false,color,op);
  } else if(type==='coin'){ tw=th=52;
    inner=lattice(52,52,26,26,0,13,true,color,op);
  } else if(type==='knot'){ tw=100; th=44;
    inner=`<path d="M0,22 q12.5,-14 25,0 t25,0 t25,0 t25,0" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      +`<path d="M0,22 q12.5,14 25,0 t25,0 t25,0 t25,0" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`;
  } else if(type==='hui'){ tw=100; th=40;
    inner=`<path d="M0,20 L15,20 L15,8 L30,8 L30,20 L45,20 L45,32 L60,32 L60,20 L75,20 L75,8 L90,8 L90,20 L100,20" fill="none" stroke="${color}" stroke-width="2.6" stroke-opacity="${op}" stroke-linejoin="miter"/>`;
  } else if(type==='fang'){ tw=th=64;
    inner=`<g fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}">`
      +`<path d="M24,6 L46,28 L24,50 L2,28 Z"/>`
      +`<path d="M42,14 L64,36 L42,58 L20,36 Z"/></g>`;
  } else if(type==='lianhua'){ tw=th=100;
    inner=`<path d="M0,50 C20,28 30,28 50,50 C70,72 80,72 100,50" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      +`<path d="M25,36 q-9,-7 -3,-16 q10,3 5,16 z" fill="${color}" fill-opacity="${op}"/>`
      + flower(30,38,13,8,color,op) + flower(72,62,13,8,color,op);
  } else if(type==='peony'){ tw=th=100;
    inner=`<path d="M0,52 C20,30 30,30 50,52 C70,74 80,74 100,52" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      + flower(50,50,17,10,color,op) + flower(50,50,9,10,color,op);
  } else if(type==='baoxiang'){ tw=th=96;
    inner= flower(48,48,30,8,color,op) + flower(48,48,16,8,color,op)
      +`<circle cx="48" cy="48" r="34" fill="none" stroke="${color}" stroke-width="2.4" stroke-opacity="${op}"/>`
      +`<circle cx="48" cy="48" r="6" fill="${color}" fill-opacity="${op}"/>`;
  } else if(type==='tuanku'){ tw=th=96;
    let dots=''; for(let i=0;i<12;i++){const a=i/12*Math.PI*2; const cx=48+Math.cos(a)*31, cy=48+Math.sin(a)*31; dots+=`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.4"/>`;}
    inner=`<g fill="${color}" fill-opacity="${op}">${dots}</g>`
      +`<circle cx="48" cy="48" r="36" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="${op}"/>`
      +`<circle cx="48" cy="48" r="27" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${op}"/>`
      + flower(48,48,11,6,color,op);
  }
  return {tw,th,inner};
}

/* 单 tile 编码成 data-URI */
function tileURI(type,color,op){
  const p=patInner(type,color,op);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.tw}" height="${p.th}" viewBox="0 0 ${p.tw} ${p.th}">${p.inner}</svg>`;
  return { uri:`data:image/svg+xml,${encodeURIComponent(svg)}`, tw:p.tw, th:p.th };
}

/* ---------- 甲方案终版：五端调色板 + 默认复合 ---------- */
const ROLES = [
  { sel:'body.role-teacher', name:'教师端 · 珊瑚',
    accentL:'#C8806A', accentD:'#E6A892', railL:'#5E3328', railD:'#2A1C16',
    comp:{ ground:'lock', vine:'vine', bloom:'lianhua' } },
  { sel:'body.role-admin', name:'教务端 · 霁蓝',
    accentL:'#6A96C8', accentD:'#93B6E6', railL:'#2C4A6E', railD:'#16243A',
    comp:{ ground:'tortoise', vine:'cloud', bloom:'tuanku' } },
  { sel:'body.role-both', name:'兼岗端 · 铜绿',
    accentL:'#5F9C92', accentD:'#86C4BA', railL:'#284A45', railD:'#14302C',
    comp:{ ground:'coin', vine:'knot', bloom:'fang' } },
  { sel:'body.stu', name:'学生端 · 石绿',
    accentL:'#6AC8A1', accentD:'#92E2C6', railL:'#2B5C4C', railD:'#163026',
    comp:{ ground:'lock', vine:'lianhua', bloom:'peony' } },
  { sel:'body.role-super', name:'首位教务 · 赤金',
    accentL:'#C8AC6A', accentD:'#E2CB88', railL:'#5C4622', railD:'#2E240F',
    comp:{ ground:'tortoise', vine:'cloud', bloom:'baoxiang' } },
];

/* rail 面（深色块）：pattern 用比 rail 亮的 tone，明显但克制 */
const RAIL_OP = { ground:0.32, vine:0.55, bloom:0.70 };
/* topbar 面（浅/深底上的薄条）：pattern 用端口色淡化，极克制 */
const TOP_OP  = { ground:0.12, vine:0.18, bloom:0.22 };

function buildRole(r){
  const c=r.comp;
  // rail 面：浅底 tone=lighten(railL,0.24)；深底 tone=lighten(railD,0.20)
  const railToneL = lighten(r.railL,0.24);
  const railToneD = lighten(r.railD,0.20);
  const gL=tileURI(c.ground, railToneL, RAIL_OP.ground);
  const vL=tileURI(c.vine,   railToneL, RAIL_OP.vine);
  const bL=tileURI(c.bloom,  railToneL, RAIL_OP.bloom);
  const gD=tileURI(c.ground, railToneD, RAIL_OP.ground);
  const vD=tileURI(c.vine,   railToneD, RAIL_OP.vine);
  const bD=tileURI(c.bloom,  railToneD, RAIL_OP.bloom);

  // topbar 面：浅底 tone=darken(accentL,0.30)；深底 tone=lighten(accentD,0.32)
  const topToneL = darken(r.accentL,0.30);
  const topToneD = lighten(r.accentD,0.32);
  const tgL=tileURI(c.ground, topToneL, TOP_OP.ground);
  const tvL=tileURI(c.vine,   topToneL, TOP_OP.vine);
  const tbL=tileURI(c.bloom,  topToneL, TOP_OP.bloom);
  const tgD=tileURI(c.ground, topToneD, TOP_OP.ground);
  const tvD=tileURI(c.vine,   topToneD, TOP_OP.vine);
  const tbD=tileURI(c.bloom,  topToneD, TOP_OP.bloom);

  const sizeL = `${gL.tw}px ${gL.th}px, ${vL.tw}px ${vL.th}px, ${bL.tw}px ${bL.th}px`;
  const sizeD = `${gD.tw}px ${gD.th}px, ${vD.tw}px ${vD.th}px, ${bD.tw}px ${bD.th}px`;
  const sizeTL= `${tgL.tw}px ${tgL.th}px, ${tvL.tw}px ${tvL.th}px, ${tbL.tw}px ${tbL.th}px`;
  const sizeTD= `${tgD.tw}px ${tgD.th}px, ${tvD.tw}px ${tvD.th}px, ${tbD.tw}px ${tbD.th}px`;

  return `/* ══ ${r.name} 暗纹（地:${c.ground} 藤:${c.vine} 花:${c.bloom}） ══ */
${r.sel} .side,
${r.sel} .tabbar{
  background-color:var(--rail);
  background-image:url("${gL.uri}"),url("${vL.uri}"),url("${bL.uri}");
  background-size:${sizeL};
  background-repeat:repeat,repeat,repeat;
  background-position:0 0,0 0,0 0;
}
@media (prefers-color-scheme: dark){
  ${r.sel} .side,
  ${r.sel} .tabbar{
    background-image:url("${gD.uri}"),url("${vD.uri}"),url("${bD.uri}");
    background-size:${sizeD};
  }
}
${r.sel} .topbar{
  background-image:url("${tgL.uri}"),url("${tvL.uri}"),url("${tbL.uri}");
  background-size:${sizeTL};
  background-repeat:repeat,repeat,repeat;
  background-position:0 0,0 0,0 0;
}
@media (prefers-color-scheme: dark){
  ${r.sel} .topbar{
    background-image:url("${tgD.uri}"),url("${tvD.uri}"),url("${tbD.uri}");
    background-size:${sizeTD};
  }
}
`;
}

let css = `/* ════════ 五端复合暗纹（自动生成，勿手改；源：test/gen_patterns.mjs） ════════ */\n`;
for(const r of ROLES) css += buildRole(r);

writeFileSync(new URL('./patterns_out.css', import.meta.url), css);
console.log(css.length + ' bytes written to patterns_out.css');
