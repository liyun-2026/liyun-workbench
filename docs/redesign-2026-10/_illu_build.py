# -*- coding: utf-8 -*-
"""砺蕴教务系统 · 空态线描插图集生成器。

单一数据源：ILL 列表（每张图的 viewBox + 语义 title + 正文 body）。
  · 产出 9 个独立 .svg（带 xmlns/width/height，可单独打开）
  · 产出 1 张自包含预览页 empty-states.html（内联 SVG，去掉 xmlns → grep 'http' = 0）

风格硬规则（每张都遵守）：
  · viewBox 480×360（ring 120×120 / divider 480×24）
  · 全部 fill="none"；描边 1.5，linecap/linejoin=round
  · 主体线 var(--il-line, var(--line, #D9D4C8))；仅一处金 var(--il-gold, var(--gold, #C9AB7C))
  · role="img" + <title>（有语义）；aria-hidden（纯装饰）
"""
import os

ROOT = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/docs/redesign-2026-10"
OUT_SVG = os.path.join(ROOT, "illustrations")
OUT_HTML = os.path.join(ROOT, "illustrations", "empty-states.html")

LINE = "var(--il-line, var(--line, #D9D4C8))"
GOLD = "var(--il-gold, var(--gold, #C9AB7C))"
TEXT = "var(--il-text, var(--text, #1E1C18))"
MUTED = "var(--il-muted, var(--text-dim, #8C857A))"

# ─────────────────────────────────────────────────────────────────────────────
# 1. 无班级 —— 打开的古籍册页（空名册）+ 一枚书签绦带
# ─────────────────────────────────────────────────────────────────────────────
B_class = """<path d="M240,130 C204,120 156,116 116,122 L116,262 C156,256 204,260 240,270 Z"/>
<path d="M240,130 C276,120 324,116 364,122 L364,262 C324,256 276,260 240,270 Z"/>
<path d="M240,130 L240,270"/>
<path d="M132,166 C168,161 208,163 232,168"/>
<path d="M132,204 C168,199 208,201 232,206"/>
<path d="M132,242 C168,237 208,239 232,244"/>
<path d="M248,168 C272,163 312,161 348,166"/>
<path d="M248,206 C272,201 312,199 348,204"/>
<path d="M248,244 C272,239 312,237 348,242"/>"""
G_class = """<path d="M235,126 L235,90 L245,90 L245,126 L240,119 Z"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 2. 无学生 —— 空座位（一把空椅子）+ 一枚空白姓名牌
# ─────────────────────────────────────────────────────────────────────────────
B_student = """<path d="M178,200 L178,120 Q178,104 194,104 L286,104 Q302,104 302,120 L302,200"/>
<path d="M214,104 L214,200"/>
<path d="M266,104 L266,200"/>
<path d="M166,202 L314,202 Q322,202 322,210 Q322,218 314,218 L166,218 Q158,218 158,210 Q158,202 166,202 Z"/>
<path d="M168,218 L162,296"/>
<path d="M312,218 L318,296"/>
<path d="M204,218 L206,278"/>
<path d="M276,218 L274,278"/>"""
G_student = """<path d="M290,104 L290,94"/>
<path d="M276,78 L304,78 L304,94 L276,94 Z"/>
<circle cx="290" cy="86" r="1.8"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 3. 无作业 —— 摊开的作业本 + 田字格（一格留金）
# ─────────────────────────────────────────────────────────────────────────────
B_homework = """<rect x="120" y="100" width="240" height="168" rx="4"/>
<path d="M240,100 L240,268"/>
<path d="M140,150 L224,150"/>
<path d="M140,190 L224,190"/>
<path d="M140,230 L224,230"/>
<path d="M312,132 L360,132 L360,180 L312,180 Z"/>
<path d="M336,132 L336,180"/>
<path d="M312,156 L360,156"/>
<path d="M258,186 L306,186 L306,234 L258,234 Z"/>
<path d="M282,186 L282,234"/>
<path d="M258,210 L306,210"/>
<path d="M312,186 L360,186 L360,234 L312,234 Z"/>
<path d="M336,186 L336,234"/>
<path d="M312,210 L360,210"/>"""
G_homework = """<path d="M258,132 L306,132 L306,180 L258,180 Z"/>
<path d="M282,132 L282,180"/>
<path d="M258,156 L306,156"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 4. 无考勤记录 —— 日晷 / 时辰刻度 + 一排空记录圈（太阳留金）
# ─────────────────────────────────────────────────────────────────────────────
B_attend = """<path d="M104,258 L376,258"/>
<path d="M124,258 A116,116 0 0 1 356,258"/>
<path d="M156,258 A84,84 0 0 1 324,258"/>
<path d="M124,258 L156,258"/>
<path d="M139.5,200 L167.3,216"/>
<path d="M182,157.5 L198,185.3"/>
<path d="M298,157.5 L282,185.3"/>
<path d="M340.5,200 L312.7,216"/>
<path d="M356,258 L324,258"/>
<path d="M240,150 L240,258"/>
<circle cx="104" cy="294" r="7"/>
<circle cx="136" cy="294" r="7"/>
<circle cx="168" cy="294" r="7"/>
<circle cx="200" cy="294" r="7"/>"""
G_attend = """<circle cx="240" cy="120" r="7" fill="{GOLD}" stroke="none"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 5. 无新闻 —— 简牍（竹简）+ 两道编绳（正中一片留金）
# ─────────────────────────────────────────────────────────────────────────────
B_news = """<rect x="130" y="92" width="30" height="176" rx="3"/>
<rect x="172" y="92" width="30" height="176" rx="3"/>
<rect x="256" y="92" width="30" height="176" rx="3"/>
<rect x="298" y="92" width="30" height="176" rx="3"/>
<rect x="340" y="92" width="30" height="176" rx="3"/>
<path d="M124,148 L376,148"/>
<path d="M124,224 L376,224"/>"""
G_news = """<rect x="214" y="92" width="30" height="176" rx="3"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 6. 无数据 —— 空坐标系 + 留白折线（末端一点留金）
# ─────────────────────────────────────────────────────────────────────────────
B_data = """<path d="M112,84 L112,268"/>
<path d="M112,268 L392,268"/>
<path d="M112,140 L392,140" stroke-dasharray="2 7" opacity=".55"/>
<path d="M112,190 L392,190" stroke-dasharray="2 7" opacity=".55"/>
<path d="M112,240 L392,240" stroke-dasharray="2 7" opacity=".55"/>
<path d="M182,84 L182,268" stroke-dasharray="2 7" opacity=".55"/>
<path d="M252,84 L252,268" stroke-dasharray="2 7" opacity=".55"/>
<path d="M322,84 L322,268" stroke-dasharray="2 7" opacity=".55"/>
<path d="M132,250 L184,242 L236,247 L288,238 L340,244 L372,237" stroke-dasharray="5 6"/>"""
G_data = """<circle cx="380" cy="236" r="5"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 7. 无权限 —— 关着的门 + 一枚金锁
# ─────────────────────────────────────────────────────────────────────────────
B_perm = """<path d="M148,102 L332,102 L332,118 L148,118 Z"/>
<path d="M164,118 L164,272 L316,272 L316,118"/>
<path d="M240,118 L240,272"/>
<path d="M182,140 L182,254 L230,254 L230,140 Z"/>
<path d="M250,140 L250,254 L298,254 L298,140 Z"/>
<path d="M152,272 L328,272"/>
<path d="M160,286 L320,286"/>"""
G_perm = """<path d="M232,182 L248,182 L248,196 L232,196 Z"/>
<path d="M235.5,182 A6.5,6.5 0 0 1 244.5,182"/>
<circle cx="240" cy="189" r="1.6"/>"""

# ─────────────────────────────────────────────────────────────────────────────
# 8. 倒计时进度环 —— UI 组件级（不是插画）
# ─────────────────────────────────────────────────────────────────────────────
B_ring = """<circle cx="60" cy="60" r="50" stroke="{LINE}" stroke-width="6" fill="none"/>
<circle cx="60" cy="60" r="50" stroke="{GOLD}" stroke-width="6" fill="none"
        stroke-linecap="round" stroke-dasharray="169.6 314.2" transform="rotate(-90 60 60)"/>
<text x="60" y="60" text-anchor="middle" font-size="27" fill="{TEXT}"
      font-family="-apple-system,'PingFang SC',system-ui,sans-serif">127</text>
<text x="60" y="80" text-anchor="middle" font-size="11" fill="{MUTED}"
      font-family="-apple-system,'PingFang SC',system-ui,sans-serif">天</text>"""

# ─────────────────────────────────────────────────────────────────────────────
# 9. 章节分隔图形 —— 一条金线 + 一个册页折角
# ─────────────────────────────────────────────────────────────────────────────
B_div = """<path d="M0,12 L214,12"/>
<path d="M266,12 L480,12"/>"""
G_div = """<path d="M228,4 L240,4 L252,16 L252,20 L228,20 Z"/>
<path d="M240,4 L240,16 L252,16 Z"/>"""

# ── 全部条目 ────────────────────────────────────────────────────────────────
ILL = [
    dict(key="empty-class",      name="无班级",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无班级：打开的空名册",            use="名册页 · 左栏空态",
         body=B_class,   gold=G_class),
    dict(key="empty-student",    name="无学生",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无学生：空座位与空白姓名牌",      use="名册页 · 右栏空态",
         body=B_student, gold=G_student),
    dict(key="empty-homework",   name="无作业",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无作业：摊开的作业本与空白田字格",use="作业页 · 列表空态",
         body=B_homework,gold=G_homework),
    dict(key="empty-attendance", name="无考勤记录",  view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无考勤记录：日晷与空的记录圈",    use="考勤页 · 该日无记录",
         body=B_attend,  gold=G_attend),
    dict(key="empty-news",       name="无新闻",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无新闻：一卷简牍",                use="今日页 · 新闻区空态",
         body=B_news,    gold=G_news),
    dict(key="empty-data",       name="无数据",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无数据：空坐标系与留白折线",      use="通用 · 图表区",
         body=B_data,    gold=G_data),
    dict(key="empty-permission", name="无权限",      view="0 0 480 360", fit=1.28, w=480, h=360,
         title="无权限：关着的门与金锁",          use="通用 · 无权限拦截",
         body=B_perm,    gold=G_perm),
    dict(key="ring-countdown",   name="倒计时进度环", view="0 0 120 120", w=120, h=120,
         title="倒计时进度环：已过 54%",          use="今日 hero 卡右侧（UI 组件）",
         body=B_ring,    gold="", aria=True),
    dict(key="divider-chapter",  name="章节分隔图形", view="0 0 480 24", w=480, h=24,
         title="章节分隔：册页折角",              use="大段之间的呼吸位（纯装饰）",
         body=B_div,     gold=G_div, aria=True),
]


def body_of(it):
    b = it["body"].format(LINE=LINE, GOLD=GOLD, TEXT=TEXT, MUTED=MUTED)
    g = it["gold"].format(LINE=LINE, GOLD=GOLD, TEXT=TEXT, MUTED=MUTED) if it["gold"] else ""
    return b, g


def group_open(ns):
    return ('<g fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" '
            'stroke-linejoin="round">' % LINE)


def render(it, inline):
    """inline=False → 独立 .svg（带 xmlns 与 width/height）；inline=True → 贴 HTML 用。"""
    b, g = body_of(it)
    if it.get("aria"):
        head = ('<svg viewBox="%s" aria-hidden="true" focusable="false" class="il">' % it["view"])
    else:
        head = ('<svg viewBox="%s" role="img" class="il">' % it["view"])
    if not inline:
        head = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
                'viewBox="%s"%s class="il">'
                % (it["w"], it["h"], it["view"],
                   ' aria-hidden="true" focusable="false"' if it.get("aria") else ' role="img"'))
    title = "" if it.get("aria") else ("<title>%s</title>" % it["title"])
    # 把画面归中放大，令主体填满 viewBox（原稿只占约 52%）
    fit = it.get("fit")
    tfa = (' transform="translate(240,180) scale(%s) translate(-240,-180)"' % fit) if fit else ""
    # ring：描边在其内部指定，包一个不带 stroke 的组
    if it["key"] == "ring-countdown":
        inner = b
    else:
        inner = ('<g fill="none" stroke="%s" stroke-width="1.5" stroke-linecap="round" '
                 'stroke-linejoin="round"%s>' % (LINE, tfa)) + b + "</g>"
    if g:
        # 若金色是「实心点缀」（fill=GOLD），包裹组不再上金色描边，避免出现第二处金色
        gs = "none" if 'fill="{GOLD}"' in it["gold"] else GOLD
        inner += ('<g class="gl" fill="none" stroke="%s" stroke-width="1.5" '
                  'stroke-linecap="round" stroke-linejoin="round"%s>%s</g>' % (gs, tfa, g))
    return head + title + inner + "</svg>"


# ── 写 9 个独立 svg ─────────────────────────────────────────────────────────
os.makedirs(OUT_SVG, exist_ok=True)
manifest = []
for it in ILL:
    p = os.path.join(OUT_SVG, it["key"] + ".svg")
    with open(p, "w", encoding="utf-8") as f:
        f.write(render(it, inline=False) + "\n")
    manifest.append((it["key"] + ".svg", os.path.getsize(p)))
    print("svg", it["key"] + ".svg", os.path.getsize(p))

# ── 预览页 ──────────────────────────────────────────────────────────────────
def demo_html(it):
    return ('<figure class="demo"><div class="art">%s</div>'
            '<figcaption><b>%s</b><span>%s</span></figcaption></figure>'
            % (render(it, inline=True), it["name"], it["use"]))


demos = "\n".join(demo_html(it) for it in ILL)

# 真实卡片效果：名册空态 / 作业空态 / 新闻空态 / hero 环
def find(k):
    return next(x for x in ILL if x["key"] == k)

cards = []
cards.append('<div class="ecard">%s<h3>这一班还没有学生</h3>'
             '<p>导入名单或手动添加，学生就会出现在这里。</p>'
             '<button class="cbtn" type="button">添加学生</button></div>'
             % render(find("empty-student"), inline=True))
cards.append('<div class="ecard">%s<h3>今天还没有布置作业</h3>'
             '<p>布置后学生端会同步收到提醒。</p>'
             '<button class="cbtn" type="button">布置作业</button></div>'
             % render(find("empty-homework"), inline=True))
cards.append('<div class="ecard">%s<h3>今天暂无新闻</h3>'
             '<p>新闻源每日 07:00 自动抓取，稍后再来。</p>'
             '<button class="cbtn ghost" type="button">手动刷新</button></div>'
             % render(find("empty-news"), inline=True))
cards.append('<div class="ecard heroc">%s<div><h3>距统考 127 天</h3>'
             '<p>目标统考日 2027-02-08 · 播音主持</p></div></div>'
             % render(find("ring-countdown"), inline=True))
cards_html = "\n".join(cards)

div_html = render(find("divider-chapter"), inline=True)

HTML = """<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>砺蕴教务系统 · 空态线描插图集</title>
<style>
:root{
  --paper:#F6F5F2; --card:#FFFFFF; --ink:#1E1C18; --body:#2E2B26; --muted:#8C857A;
  --hair:#E7E3DA; --gold:#C9AB7C; --deep-gold:#8A6F45; --cinna:#B23A2E;
  --il-line:#D9D4C8; --il-gold:#C9AB7C; --il-text:#1E1C18; --il-muted:#8C857A;
}
html[data-theme="dark"]{ --paper:#1E1C18; --card:#26231D; --ink:#EDE7DA; --body:#D8D2C6;
  --muted:#9C927C; --hair:#3A3730; --gold:#C9AB7C;
  --il-line:#3A3730; --il-gold:#C9AB7C; --il-text:#EDE7DA; --il-muted:#9C927C; }
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--body);
  font-family:-apple-system,"PingFang SC",system-ui,sans-serif;
  font-size:15px;line-height:1.7;-webkit-font-smoothing:antialiased;padding:34px 30px 54px}
.serif{font-family:'Songti SC',"Source Han Serif SC",serif}
.hd{border-bottom:1px solid var(--hair);padding-bottom:20px;margin-bottom:24px}
.hd h1{font-family:'Songti SC',"Source Han Serif SC",serif;font-size:32px;font-weight:400;color:var(--ink);line-height:1.15}
.hd .lead{margin-top:10px;max-width:78ch;color:var(--muted);text-wrap:pretty}
.hd .meta{margin-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.06em;color:var(--muted)}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
.pane{border:1px solid var(--hair);padding:18px 18px 22px}
.pane.light{--il-line:#D9D4C8;--il-gold:#C9AB7C;--il-text:#1E1C18;--il-muted:#8C857A;
  background:#F6F5F2;color:#2E2B26}
.pane.dark{--il-line:#3A3730;--il-gold:#C9AB7C;--il-text:#EDE7DA;--il-muted:#9C927C;
  background:#1E1C18;color:#D8D2C6;border-color:#3A3730}
.ptitle{font-family:'Songti SC',"Source Han Serif SC",serif;font-size:19px;font-weight:400;margin-bottom:4px}
.pane.light .ptitle{color:#1E1C18} .pane.dark .ptitle{color:#EDE7DA}
.pnote{font-size:12.5px;margin-bottom:14px;opacity:.75}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.demo{margin:0;border:1px solid rgba(140,133,122,.28);padding:12px 12px 10px;display:flex;flex-direction:column;gap:8px}
.art{display:flex;align-items:center;justify-content:center;min-height:140px}
.art svg.il{display:block;width:100%;height:auto;max-width:300px}
.demo figcaption{display:flex;flex-direction:column;gap:2px}
.demo figcaption b{font-size:15px;font-weight:600}
.demo figcaption span{font-size:14px;opacity:.72}
.effects{margin-top:34px;border-top:1px solid var(--hair);padding-top:22px}
.effects h2{font-family:'Songti SC',"Source Han Serif SC",serif;font-size:24px;font-weight:400;color:var(--ink)}
.effects .sub{margin-top:6px;color:var(--muted);font-size:13.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:20px}
.ecard{background:var(--card);border:1px solid var(--hair);border-radius:14px;padding:20px;text-align:center;
  display:flex;flex-direction:column;align-items:center;gap:8px}
.ecard .art{min-height:150px}
.ecard svg.il{width:100%;height:auto;max-width:250px;display:block}
.ecard h3{font-size:16px;color:var(--ink);font-weight:600;margin-top:4px}
.ecard p{font-size:13.5px;color:var(--muted);max-width:34ch}
.cbtn{margin-top:8px;font:inherit;font-size:13.5px;padding:8px 18px;border-radius:999px;cursor:pointer;
  border:1px solid transparent;background:var(--ink);color:var(--paper)}
.cbtn.ghost{background:transparent;border-color:var(--hair);color:var(--ink)}
.ecard.heroc{flex-direction:row;text-align:left;gap:18px;justify-content:flex-start}
.ecard.heroc .art{min-height:0;flex:0 0 118px}
.ecard.heroc svg.il{width:118px}
.ecard.heroc h3{margin-top:0;font-family:'Songti SC',"Source Han Serif SC",serif;font-size:20px;font-weight:400}
.cap{margin-top:26px;font-size:13px;color:var(--muted)}
.cap code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:rgba(140,133,122,.14);padding:1px 5px}
.divwrap{margin-top:26px;padding-top:26px;border-top:1px solid var(--hair)}
.divwrap .lbl{font-size:13.5px;color:var(--muted);margin-bottom:14px}
.divwrap svg.il{width:100%;height:auto;max-width:640px;display:block}
@media (prefers-reduced-motion: reduce){*{transition-duration:.01ms !important}}
</style>
</head>
<body>
<header class="hd">
  <h1>空态线描插图集</h1>
  <p class="lead">与侧栏竹石 / 兰花 / 松鹤同一语言（中国传统白描），但收束为更现代、更简的单线。只在「空态」与「品牌识别」两处用图；数据页与表单页一律不配装饰图。同一份源码，浅深两态由 CSS 变量驱动。</p>
  <p class="meta">7 空态 + 1 进度环(UI) + 1 章节分隔　·　单线 1.5px　·　fill=none　·　每张仅一处金 #C9AB7C　·　透明底　·　无渐变/无 3D　·　按 <code>#dark</code> 切深色</p>
</header>

<section class="duo">
  <div class="pane light">
    <div class="ptitle">浅色态</div>
    <div class="pnote">主体线 #D9D4C8 · 金 #C9AB7C</div>
    <div class="grid">
__DEMOS_LIGHT__
    </div>
  </div>
  <div class="pane dark">
    <div class="ptitle">深色态</div>
    <div class="pnote">主体线 #3A3730 · 金 #C9AB7C</div>
    <div class="grid">
__DEMOS_DARK__
    </div>
  </div>
</section>

<section class="effects">
  <h2>放在卡片里的真实效果</h2>
  <p class="sub">空态 = 插图 + 一句解释 + 一个动作，三者齐备才算完整空态。</p>
  <div class="cards">
__CARDS__
  </div>
  <div class="divwrap">
    <div class="lbl">章节分隔图形（大段之间）</div>
__DIV__
  </div>
</section>

<p class="cap">说明：装饰性图形（进度环 / 章节分隔）标注 <code>aria-hidden="true"</code>；有语义的空态插图标注 <code>role="img"</code> 并带 <code>&lt;title&gt;</code>。本页零外部依赖，双击即可打开。</p>

<script>
try{
  var d = /(^|[#&])dark/.test(location.hash);
  document.documentElement.setAttribute("data-theme", d ? "dark" : "light");
}catch(e){}
</script>
</body>
</html>
"""

HTML = (HTML.replace("__DEMOS_LIGHT__", demos)
            .replace("__DEMOS_DARK__", demos)
            .replace("__CARDS__", cards_html)
            .replace("__DIV__", div_html))
with open(OUT_HTML, "w", encoding="utf-8") as f:
    f.write(HTML)
print("html", OUT_HTML, os.path.getsize(OUT_HTML))
print("http count in html:", HTML.count("http"))
