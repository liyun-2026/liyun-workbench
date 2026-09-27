# -*- coding: utf-8 -*-
"""生成「云淡」五端配色 CSS 区块，并替换 index.html 里的旧五端皮肤区。

用法： python3 test/gen_port_theme.py            # 预览生成的 CSS（不写文件）
       python3 test/gen_port_theme.py --write    # 写回 index.html（自动备份）

替换范围：从「学生端：整套换一张皮」注释起，到「学生端：整页水印」注释前止
（含五端变量块 + 五端补充规则 + 桌面侧栏白描块）。
"""
import os, re, sys, shutil, colorsys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDX = os.path.join(ROOT, 'index.html')
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


def rgb(x):
    r, g, b = unpack(x)
    return '%d,%d,%d' % (round(r * 255), round(g * 255), round(b * 255))


# 端口定义：key, 中文名, 注释名, 基准强调色, 白描素材, 选中字深比, 按钮字深比
PORTS = [
    ('stu',     '学生',   '学生端',   '#6AC8A1', 'lanhua_lite.png', .51, .66),
    ('teacher', '授课',   '授课端',   '#C8806A', 'zhushi_lite.png', .44, .77),
    ('admin',   '教务',   '教务端',   '#6A96C8', 'lanhua_lite.png', .44, .76),
    ('super',   '首位教务', '首位教务', '#C8AC6A', 'songhe_lite.png', .50, .67),
    ('both',    '兼岗',   '兼岗端',   '#5F9C92', 'zhushi_lite.png', .44, .77),
]

BLOCK_ORDER = ['teacher', 'admin', 'super', 'both', 'stu']  # 顺序沿用原文件


def light(acc, ts, tb):
    return dict(
        bg=mix(acc, W, .952), tint=mix(acc, W, .905), rail=mix(acc, W, .775),
        rail_text=mix(acc, '#222222', .52),
        rail_on=mix(acc, W, .62), rail_on_text=mix(acc, '#141414', ts),
        rail_art=mix(acc, '#1A1A1A', .46),
        sidebar_active=mix(acc, W, .86), card=W,
        text=mix(acc, '#1C1C1C', .84), text_dim=mix(acc, '#8A8A8A', .55),
        accent=mix(acc, W, .05), btn_text=mix(acc, '#101010', tb),
        line=mix(acc, W, .84),
        shadow='0 2px 8px rgba(%s,.09)' % rgb(mix(acc, '#333333', .25)),
        shadow_lg='0 10px 28px rgba(%s,.15)' % rgb(mix(acc, '#333333', .25)),
    )


def dark(acc):
    return dict(
        bg=mix(acc, '#0F0F0F', .90), tint=mix(acc, '#141414', .88),
        rail=mix(acc, '#0D0D0D', .70),
        rail_text=mix(acc, W, .80),
        rail_on='rgba(255,255,255,.16)', rail_on_text=W,
        rail_art=mix(acc, W, .78),
        sidebar_active=mix(acc, '#1A1A1A', .82), card=mix(acc, '#161616', .86),
        text=mix(acc, '#F2F2F2', .90), text_dim=mix(acc, '#9A9A9A', .55),
        accent=mix(acc, W, .40), btn_text='#141414',
        line=mix(acc, '#2A2A2A', .80),
        shadow='0 0 0 1px rgba(255,255,255,.05)',
        shadow_lg='0 10px 30px rgba(0,0,0,.45)',
    )


def var_lines(v, indent='  '):
    order = ['bg', 'tint', 'rail', 'rail_text', 'rail_on', 'rail_on_text', 'rail_art',
             'sidebar_active', 'card', 'text', 'text_dim', 'accent', 'btn_text', 'line']
    out = []
    for k in order:
        out.append('%s--%s:%s;' % (indent, k.replace('_', '-'), v[k]))
    out.append('%s--shadow:%s;' % (indent, v['shadow']))
    out.append('%s--shadow-lg:%s;' % (indent, v['shadow_lg']))
    return '\n'.join(out)


MARK_S = '/* ==PORT-THEME-START=='
MARK_E = '/* ==PORT-THEME-END== */'
# 首次迁移用（老文件里的锚点，迁移一次后就用 MARK_S/MARK_E 了）
LEGACY_S = '/* ════════ 学生端：整套换一张皮'
LEGACY_S2 = '/* ════════════════════════════════════════════════════════════════\n   五端皮肤'
LEGACY_E = '/* ════════ 学生端：整页水印'

HEAD = MARK_S + '  ↓↓↓ 本区块由 test/gen_port_theme.py 生成，改配色请改脚本后重跑，别手改 ↓↓↓ */\n' + '''/* ════════════════════════════════════════════════════════════════
   五端皮肤 ·「云淡」版
   ────────────────────────────────────────────────────────────────
   为什么改：旧版把「侧栏 / 底栏」做成了端口的**深色面**（师 #5E3328、教 #2C4A6E…），
   深色面积太大，整块压在页面上很沉；而且整页底 --bg 五端只差两三个色阶，
   肉眼等于没换 —— 于是「顶栏是端口色、整页底还是老颜色」。
   现在换成：
     · --rail      端口的**浅色面**（同色相、明度 ~88%），上面压深端口色字
     · --rail-on   选中胶囊：比栏面再深一档的端口色，字用深端口色
     · --bg        看得出来的浅端口色（不再是"几乎和白一样"）
     · --accent    端口色（略柔化），按钮/选中/图标统一走它
     · --rail-art  桌面侧栏白描的**线条颜色**（浅栏上必须是深色才看得见）
   品牌金 --gold 依旧不动：字标、门头金线、卡片金线还是金的。
   登录门与开屏不受影响（那时人还没登录，走的仍是 :root 默认）。
   ⚠️ 深浅两套都要给 --rail-art，否则深色模式下白描会变成深线糊在深栏上。
*/
'''

TAIL_ART = '''
/* ════════ 五端 · 桌面侧栏白描画 ════════
   ≥700px 时侧栏沉底一枚花鸟白描小品。
   ⚠️ 素材是**纯白线条 on 透明**（assets/sideart/*_lite.png，见 test/make_side_art.py）。
      以前侧栏是深色面，白线直接当 background-image 就看得见；
      现在侧栏是浅色面，白线会彻底消失 —— 所以改成用 CSS mask：
      拿素材的 alpha 当镂空模版，填 --rail-art（深端口色），线条就跟着端口走。
      mask 必须是独立图层且压在内容之下，故用 ::before + z-index:-1，
      并把 .side 提升为层叠上下文（z-index:0 + isolation:isolate），
      否则 z-index:-1 会掉到侧栏底色背后，整幅画看不见。 */
@media (min-width:700px){
  .side{position:relative;z-index:0;isolation:isolate}
  .side::before{
    content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;
    background-color:var(--rail-art);
    /* 「白描浓淡」的唯一旋钮就是这里的 opacity。
       注意素材 assets/sideart/*_lite.png 本身已经是「lite 档」——
       alpha 峰值只有 62~66/255（≈25%），是 make_side_art.py 用 strength .26 抽的线。
       所以这里保持 1（不再二次削减）：线色 = 栏色×74% + 墨色×26%，
       在浅色栏上是「凑近看得见、不抢字」的若隐若现。
       想更淡就调小（.6/.4），想更清楚就调大，不必动素材。 */
    opacity:1;
    -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
    -webkit-mask-position:center bottom;mask-position:center bottom;
    -webkit-mask-size:82% auto;mask-size:82% auto;
  }
  body.role-teacher .side::before,
  body.role-both .side::before{
    -webkit-mask-image:url("assets/sideart/zhushi_lite.png");
            mask-image:url("assets/sideart/zhushi_lite.png");
  }
  body.role-admin .side::before,
  body.stu .side::before{
    -webkit-mask-image:url("assets/sideart/lanhua_lite.png");
            mask-image:url("assets/sideart/lanhua_lite.png");
  }
  body.role-super .side::before{
    -webkit-mask-image:url("assets/sideart/songhe_lite.png");
            mask-image:url("assets/sideart/songhe_lite.png");
  }
}

/* ════════ 手机底栏胶囊：阴影跟着浅色栏一起变轻 ════════ */
@media (max-width:699px){
  .tabbar{box-shadow:var(--shadow-lg)}
}

/* ════════ 侧栏门头浅牌：浅色侧栏上不再需要重投影 ════════ */
.side .brand{box-shadow:0 2px 10px rgba(0,0,0,.07)}
'''


def build_css():
    parts = [HEAD]
    for key in BLOCK_ORDER:
        k, zh, label, acc, art, ts, tb = next(p for p in PORTS if p[0] == key)
        L, D = light(acc, ts, tb), dark(acc)
        sel = 'body.stu' if key == 'stu' else 'body.role-%s' % key
        extra = '（学生端一整套皮：更亮、更松、圆角更大，一眼看出这是自己的系统）' if key == 'stu' else ''
        # 卡片圆角沿用旧行为：学生端手机 16px / 电脑 14px；其余交给全局规则，不在此处写死
        card = ''
        if key == 'stu':
            card = ('%s .card{border-radius:16px}\n'
                    '@media (min-width:700px){\n'
                    '  %s .card{border-radius:14px;border-color:var(--line);box-shadow:var(--shadow)}\n'
                    '}\n' % (sel, sel))
        parts.append('''
/* ── %s%s ── */
%s{
%s
}
@media (prefers-color-scheme: dark){
  %s{
%s
  }
}
%s .clock{color:var(--accent)}
%s .nav button.on{background:var(--rail-on);color:var(--rail-on-text)}
%s .topbar::after{opacity:.72}
%s''' % (label, extra, sel, var_lines(L), sel, var_lines(D, '    '),
            sel, sel, sel, card))
    parts.append(TAIL_ART)
    parts.append('\n' + MARK_E + '\n')
    return ''.join(parts)


def main():
    css = build_css()
    if '--write' not in sys.argv:
        print(css)
        return
    src = open(IDX, encoding='utf-8').read()
    if MARK_S in src:
        a = src.index(MARK_S)
        b = src.index(MARK_E) + len(MARK_E)
    else:
        # 一次性迁移：老文件里没有标记，用旧锚点定位
        start = src.index(LEGACY_S) if LEGACY_S in src else src.index(LEGACY_S2)
        end = src.index(LEGACY_E)
        a, b = start, end
    new = src[:a] + css.strip() + '\n\n' + src[b:].lstrip('\n')
    if not os.path.exists(IDX + '.bak-porttheme'):
        shutil.copy(IDX, IDX + '.bak-porttheme')
    open(IDX, 'w', encoding='utf-8').write(new)
    print('已写回 index.html（备份 index.html.bak-porttheme）')
    print('替换区间 %d..%d，新长度 %d（原 %d）' % (a, b, len(new), len(src)))


if __name__ == '__main__':
    main()
