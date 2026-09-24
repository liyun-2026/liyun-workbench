#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 v30 总览页（图标 base64 内嵌，保证手机端打开就能看到）。"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, REVIEW)
sys.path.insert(0, HERE)
from icon_v30_export import PICKS
from importlib import import_module
EMB = import_module('.v30_emb', 'v30_emb' if False else None) if False else None
import importlib.util
spec = importlib.util.spec_from_file_location('v30emb', os.path.join(REVIEW, '.v30_emb.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
EMB = m.EMB

CARDS = ''
for i, (si, tag, name, note) in enumerate(PICKS):
    tag_disp = {'A': '字面填满', 'B': '框底穿出', 'C': '中轴＋长撇'}[si]
    CARDS += f'''
    <div class="card">
      <img src="data:image/png;base64,{EMB[i]}" alt="{name}">
      <div class="cn">{name}</div>
      <div class="cd">{tag_disp} · {note}</div>
    </div>'''

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>砺蕴 · 桌面图标 v30</title>
<style>
  :root {{ --gold:#c9ab7c; --blue:#50638E; --blue2:#8AA2D0; --ink:#eef1f7; --dim:#98a2b6; }}
  * {{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }}
  body {{ margin:0; background:#0f1117; color:var(--ink);
    font:16px/1.75 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif; }}
  .wrap {{ max-width:960px; margin:0 auto; padding:48px 22px 90px; }}
  .kicker {{ font-size:13px; letter-spacing:.22em; color:var(--blue2); margin-bottom:14px; }}
  h1 {{ font-size:32px; margin:0 0 10px; letter-spacing:-.01em; }}
  .sub {{ color:var(--dim); font-size:15.5px; margin-bottom:6px; }}
  .lead {{ color:#c6ccd8; font-size:15px; border-left:2px solid var(--blue); padding-left:14px; margin:26px 0 40px; }}
  h2 {{ font-size:19px; margin:52px 0 16px; letter-spacing:.01em; }}
  h2 .n {{ color:var(--blue2); font-weight:600; margin-right:8px; }}
  .cards {{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }}
  @media (max-width:720px) {{ .cards {{ grid-template-columns:repeat(2,1fr); }} }}
  .card {{ background:#161a23; border-radius:18px; padding:18px 12px 14px; text-align:center; }}
  .card img {{ width:100%; max-width:150px; display:block; margin:0 auto 10px;
    filter:drop-shadow(0 10px 22px rgba(0,0,0,.5)); }}
  .cn {{ font-size:14.5px; font-weight:600; }}
  .cd {{ font-size:12px; color:var(--dim); margin-top:3px; line-height:1.5; }}
  ul {{ padding-left:0; list-style:none; margin:0; }}
  li {{ padding:11px 0 11px 26px; position:relative; color:#d3d9e4; font-size:15px;
    border-bottom:1px solid #1d2230; }}
  li:last-child {{ border-bottom:0; }}
  li:before {{ content:''; position:absolute; left:6px; top:20px; width:7px; height:7px;
    border-radius:50%; background:var(--blue2); }}
  li b {{ color:#fff; }}
  .shot {{ width:100%; border-radius:16px; display:block; }}
  .note {{ background:#161a23; border-radius:16px; padding:18px 20px; font-size:14.5px;
    color:#c2cad8; margin-top:18px; }}
  .note b {{ color:#fff; }}
  .pick {{ background:linear-gradient(180deg,#1a2030,#141822); border:1px solid #26304a;
    border-radius:18px; padding:22px; margin-top:18px; }}
  .pick h3 {{ margin:0 0 8px; font-size:17px; }}
  .pick p {{ margin:0; color:#c2cad8; font-size:14.5px; }}
  .tag {{ display:inline-block; font-size:12px; color:#0f1117; background:var(--blue2);
    border-radius:5px; padding:2px 7px; margin-right:6px; vertical-align:2px; font-weight:600; }}
  code {{ background:#222836; padding:2px 6px; border-radius:5px; font-size:13px; color:#bcd0f0; }}
</style></head><body><div class="wrap">

<div class="kicker">砺蕴 · 桌面图标 · 第 31 轮</div>
<h1>「声」不写字，造字</h1>
<div class="sub">按博艺徽章里那枚「博」的同一套规范，把「声」重新画了一遍</div>
<div class="lead">
你说得对 —— 把字体的「声」直接摆上去，那不是 logo，那是打字。<br>
这一轮我先去看了博艺那枚徽章：里面 12 画的「博」被简化到 7 笔，
<b>全部笔画等粗、全部圆头、间距均匀</b>，还有一笔穿出了内圆。<br>
这就是你说的"简化·优化·变形"。所以这一轮把「声」也这么做了一遍。
</div>

<h2><span class="n">01</span>四个候选</h2>
<div class="cards">{CARDS}</div>

<h2><span class="n">02</span>这轮动了什么</h2>
<ul>
  <li><b>不是调粗细，是重设骨架</b> —— 先用形态学量出「声」每一笔的精确坐标，
      再按图标重新分配：笔画 <code>0.118 → 0.145</code>，框加深到孔接近正方，四横重新等距。</li>
  <li><b>笔画全部等粗、全部圆头</b> —— 跟「博」一样。撇不再收成尖，它在这枚字标里是一根"实"的笔画。</li>
  <li><b>撇被拉长了</b> —— 之前太短，「声」的性格出不来。现在它一路甩到左下角。</li>
  <li><b>字面按方标的安全区放大</b> —— 不再按最远半径缩（那是 maskable 才需要的），
      方形这一版让字占到 59%，在桌面上有分量。</li>
  <li><b>色回到徽章那个蓝</b> <code>#50638E</code> —— 顺手把"桌面深咖金 vs 徽章蓝白"这两套视觉合掉。</li>
</ul>

<div class="note">
  <b>一个发现：</b>博艺的「博」下部是<b>「框＋横」</b>（一横分两格），
  砺蕴的「声」下部是<b>「框＋竖」</b>（一竖分两格）—— 两枚标刚好互为镜像。<br>
  这不是我凑的，是两个字的字形本来就长这样。机构徽章在上面、工作系统在下面，说得通。
</div>

<h2><span class="n">03</span>形 × 色 全矩阵</h2>
<img class="shot" src="图标v30_精修矩阵.png" alt="形色矩阵">

<h2><span class="n">04</span>放到真机桌面上</h2>
<img class="shot" src="图标v30_桌面同屏.png" alt="桌面同屏">

<h2><span class="n">05</span>我的建议</h2>
<div class="pick">
  <h3><span class="tag">首推</span>A · 博艺蓝</h3>
  <p>最干净、最"机构"，而且跟徽章同色 —— 学生打开手机，一眼知道这是博艺的东西。
   缺点也在这：<code>#50638E</code> 是低饱和的灰蓝，在深色壁纸上不够跳。</p>
</div>
<div class="pick">
  <h3><span class="tag">最跳</span>A · 深空蓝</h3>
  <p>近黑的蓝底 ＋ 纯白字，桌面上穿透力最强，也最"2026"。要"哇塞"就选它。</p>
</div>
<div class="pick">
  <h3><span class="tag">有性格</span>B · 框底穿出</h3>
  <p>把框底横向右穿出去一点，跟左下的撇形成对角张力 —— 这一招是从「博」穿出内圆那里学的。胆子最大的一版。</p>
</div>

<div class="note" style="margin-top:34px">
  <b>选好之后我要做的：</b>出 512 / 192 / 180 正式资产 →
  升 <code>sw.js</code> 版本号（不然手机上还是旧壳）→ 推到线上 →
  你手上那台<b>得先删掉旧图标，再重新"添加到主屏幕"</b>，才看得到新的。
</div>

</div></body></html>'''

p = os.path.join(REVIEW, '图标v30_总览.html')
open(p, 'w', encoding='utf-8').write(HTML)
print('→', p, os.path.getsize(p) // 1024, 'KB')
