# -*- coding: utf-8 -*-
"""生成「五端配色·方向对比」预览页（纯 CSS，无依赖）。
   三个方向 × 五个端口，每端一张手机样机 + 一条桌面侧栏条。
   仅用于选方向，不改系统。
   用法：python3 test/make_port_preview.py
   产物：test/preview_ports.html
"""
import colorsys, os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'preview_ports.html')

W = '#FFFFFF'


def unpack(x):
    x = x.lstrip('#')
    return tuple(int(x[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mix(a, b, t):
    A, B = unpack(a), unpack(b)
    return '#%02X%02X%02X' % tuple(round((A[i] * (1 - t) + B[i] * t) * 255) for i in range(3))


def lum(x):
    def f(c):
        return c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
    r, g, b = unpack(x)
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)


def cr(a, b):
    L1, L2 = lum(a), lum(b)
    if L1 < L2:
        L1, L2 = L2, L1
    return (L1 + .05) / (L2 + .05)


PORTS = [
    ('teacher', '珊瑚', '授课老师', '#C8806A'),
    ('admin',   '霁蓝', '教务',     '#6A96C8'),
    ('both',    '铜绿', '兼岗',     '#5F9C92'),
    ('student', '石绿', '学生',     '#6AC8A1'),
    ('super',   '赤金', '首位教务', '#C8AC6A'),
]

# ── 三个方向 ────────────────────────────────────────────────
# 每个方向返回该端口的整套面颜色
DIRS = []


def d_yundan(acc):
    """一·云淡：栏=浅端口彩面，底色浅彩，字深彩。整体轻但有色。"""
    return dict(
        bg=mix(acc, W, .952), tint=mix(acc, W, .905), rail=mix(acc, W, .775),
        railTx=mix(acc, '#222222', .52), railOn=mix(acc, W, .60), railOnTx=mix(acc, '#222222', .42),
        card=W, line=mix(acc, W, .84), acc=mix(acc, W, .05), btnTx=mix(acc, '#1A1A1A', .62),
    )


def d_sujian(acc):
    """二·素笺：栏近白中性＋细线，端口色只在顶栏/选中/按钮上点缀。最克制。"""
    return dict(
        bg=mix(acc, W, .968), tint=mix(acc, W, .935), rail='#FCFCFB',
        railTx='#54524E', railOn=mix(acc, W, .78), railOnTx=mix(acc, '#222222', .40),
        card=W, line=mix(acc, W, .88), acc=mix(acc, W, .04), btnTx=mix(acc, '#1A1A1A', .62),
    )


def d_qingmo(acc):
    """三·轻墨：保留深色栏（比现在浅一档），底色/强调色整体减重。"""
    return dict(
        bg=mix(acc, W, .94), tint=mix(acc, W, .895), rail=mix(acc, '#111111', .52),
        railTx=mix(acc, W, .86), railOn='rgba(255,255,255,.20)', railOnTx='#FFFFFF',
        card=W, line=mix(acc, W, .84), acc=mix(acc, W, .07), btnTx=mix(acc, '#1A1A1A', .62),
    )


DIRS = [
    ('yundan', '一 ·「云淡」', '侧栏/底栏改成**浅端口彩面**，上面压深端口色字；整页底色是明显的浅端口色。端口一眼可辨，但整体轻。',
     d_yundan, '最贴近你说的「清新淡雅」，同时每个端口还是清楚认得出来。'),
    ('sujian', '二 ·「素笺」', '侧栏/底栏几乎**纯白＋一根细线**；端口色只出现在顶栏、选中项、按钮和小标识上。',
     d_sujian, '最克制、最雅。但端口之间的差别主要靠顶栏和点缀色，深色栏的「分量感」没有了。'),
    ('qingmo', '三 ·「轻墨」', '侧栏/底栏**仍是深色**，但比现在浅一大档；整页底色和强调色一并减重。',
     d_qingmo, '改动最小、最保守。但仍然保留一块深色面。'),
]


def mock_phone(p, d):
    key, hue, role, acc = p
    tabs = ['今天', '录入', '班级', '档案', '设置']
    t = ''.join(
        '<span class="tb%s"><i></i>%s</span>' % (' on' if i == 0 else '', n)
        for i, n in enumerate(tabs))
    return f'''<div class="dev" style="--bg:{d['bg']};--tint:{d['tint']};--rail:{d['rail']};
  --railTx:{d['railTx']};--railOn:{d['railOn']};--railOnTx:{d['railOnTx']};
  --card:{d['card']};--line:{d['line']};--acc:{d['acc']};--btnTx:{d['btnTx']}">
  <div class="dtop"><span class="dname">{role}</span><span class="dmore">全部功能</span></div>
  <div class="dbody">
    <div class="dcard">
      <div class="dttl">今天</div>
      <div class="dsub">03 班 · 第 4 节</div>
      <div class="dchips"><span class="dchip on">状态好</span><span class="dchip">一般</span><span class="dchip">需关注</span></div>
      <button class="dbtn">保存</button>
    </div>
  </div>
  <div class="dtab">{t}</div>
  <div class="dlabel"><b>{hue}</b> · {key}</div>
</div>'''


def mock_desk(p, d):
    key, hue, role, acc = p
    navs = ['今天', '录入', '班级', '档案', '上报', '设置']
    n = ''.join('<span class="sn%s"><i></i>%s</span>' % (' on' if i == 0 else '', x) for i, x in enumerate(navs))
    return f'''<div class="ddev" style="--bg:{d['bg']};--tint:{d['tint']};--rail:{d['rail']};
  --railTx:{d['railTx']};--railOn:{d['railOn']};--railOnTx:{d['railOnTx']};
  --card:{d['card']};--line:{d['line']};--acc:{d['acc']};--btnTx:{d['btnTx']}">
  <div class="dside"><div class="sbrand">砺蕴</div>{n}<div class="sart">白描</div></div>
  <div class="dmain">
    <div class="dcard2"><div class="dttl">今天要上的课</div><div class="dsub">第 4 节 · 播音基础 · 03 班</div>
    <div class="dchips"><span class="dchip on">已到 12</span><span class="dchip">待核 2</span></div>
    <button class="dbtn">录入今日</button></div>
  </div>
  <div class="dlabel2">{hue} · {key}</div>
</div>'''


def md(s):
    """把 **粗体** 转成 <strong>。"""
    import re
    return re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)


def build():
    blocks = []
    for dk, dname, ddesc, fn, dnote in DIRS:
        phones = ''.join(mock_phone(p, fn(p[3])) for p in PORTS)
        desk = mock_desk(PORTS[0], fn(PORTS[0][3])) + mock_desk(PORTS[1], fn(PORTS[1][3]))
        blocks.append(f'''<section class="dir">
  <h2>{dname}</h2>
  <p class="ddesc">{md(ddesc)}</p>
  <p class="dnote">{md(dnote)}</p>
  <div class="prow">{phones}</div>
  <div class="drow">{desk}</div>
</section>''')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>五端配色 · 方向对比</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,"PingFang SC",system-ui,sans-serif;background:#F4F3F0;color:#26241F;
  padding:28px 22px 60px;line-height:1.6}}
h1{{font-size:24px;font-weight:600;letter-spacing:-.01em}}
.lead{{font-size:14px;color:#6E6B65;margin-top:8px;max-width:900px}}
.lead b{{color:#26241F}}
section.dir{{margin-top:38px;background:#fff;border:1px solid #E6E3DD;border-radius:16px;padding:22px}}
h2{{font-size:19px;font-weight:600}}
.ddesc{{font-size:13.5px;color:#4A4741;margin-top:6px}}
.ddesc strong{{background:#FBF3E6;padding:1px 5px;border-radius:4px;font-weight:600}}
.dnote{{font-size:12.5px;color:#8A867E;margin-top:5px;padding-left:9px;border-left:2px solid #E6E3DD}}
.prow{{display:flex;gap:14px;flex-wrap:wrap;margin-top:18px}}
.drow{{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px}}

.dev{{width:206px;background:var(--bg);border-radius:14px;overflow:hidden;
  border:1px solid var(--line);position:relative}}
.dtop{{display:flex;align-items:center;justify-content:space-between;background:var(--tint);
  padding:8px 10px;color:var(--railTx);font-size:11.5px;border-bottom:1px solid var(--line)}}
.dmore{{font-size:10px;opacity:.85}}
.dbody{{padding:10px;min-height:118px}}
.dcard{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}}
.dttl{{font-size:13px;font-weight:600;color:var(--railTx)}}
.dsub{{font-size:10.5px;color:#8A867E;margin-top:2px}}
.dchips{{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}}
.dchip{{font-size:10px;padding:3px 8px;border-radius:99px;border:1px solid var(--line);color:#7A766F}}
.dchip.on{{background:var(--acc);border-color:transparent;color:var(--btnTx)}}
.dbtn{{margin-top:10px;width:100%;border:none;border-radius:8px;padding:8px;font-size:12px;
  background:var(--acc);color:var(--btnTx);font-family:inherit}}
.dtab{{display:flex;background:var(--rail);padding:7px 5px;border-top:1px solid var(--line)}}
.tb{{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:9px;
  color:var(--railTx);border-radius:8px;padding:4px 0}}
.tb i{{width:15px;height:15px;border-radius:4px;border:1.5px solid currentColor;display:block;opacity:.75}}
.tb.on{{background:var(--railOn);color:var(--railOnTx)}}
.tb.on i{{opacity:1}}
.dlabel{{position:absolute;top:0;right:0;background:#26241F;color:#fff;font-size:9.5px;
  padding:3px 8px;border-bottom-left-radius:8px;opacity:.9}}

.ddev{{width:430px;background:var(--tint);border-radius:12px;overflow:hidden;border:1px solid var(--line);
  position:relative;display:flex}}
.dside{{width:86px;background:var(--rail);padding:10px 5px;display:flex;flex-direction:column;gap:4px;
  position:relative;border-right:1px solid var(--line)}}
.sbrand{{font-size:11px;color:var(--railTx);text-align:center;padding:4px 0;font-weight:600}}
.sn{{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:9.5px;color:var(--railTx);
  padding:6px 0;border-radius:9px}}
.sn i{{width:15px;height:15px;border-radius:4px;border:1.5px solid currentColor;display:block;opacity:.75}}
.sn.on{{background:var(--railOn);color:var(--railOnTx)}}
.sn.on i{{opacity:1}}
.sart{{margin-top:auto;font-size:8.5px;color:var(--railTx);opacity:.55;text-align:center;padding:16px 0}}
.dmain{{flex:1;background:var(--bg);padding:16px}}
.dcard2{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}}
.dlabel2{{position:absolute;top:0;right:0;background:#26241F;color:#fff;font-size:10px;
  padding:3px 9px;border-bottom-left-radius:8px;opacity:.9}}
</style></head><body>
<h1>五端配色 · 方向对比</h1>
<p class="lead">左边三块是三个候选方向，每块里是五个端口（老师/教务/兼岗/学生/首位）。上面一排是<b>手机样机</b>
（顶栏＋内容＋底部标签栏），下面一条是<b>电脑侧栏＋画布</b>。<br>
关注三点：① 侧栏/底栏那块「重不重」；② 整页底色是不是一眼能看出端口；③ 顶栏、按钮、选中项的颜色是否协调。</p>
{''.join(blocks)}
</body></html>'''
    open(OUT, 'w', encoding='utf-8').write(html)
    print('写出', OUT)


if __name__ == '__main__':
    build()
