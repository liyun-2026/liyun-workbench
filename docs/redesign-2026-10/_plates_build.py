#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴教务系统 · 视觉升级风格稿生成器（一次性工具，不随交付物发布）

产出 4 个自包含 HTML（零外部依赖、双击可开）：
  plates/index.html  对照入口
  plates/A.html      方向 A「素笺 · 精修暖金」
  plates/B.html      方向 B「青灰 · 单点缀」
  plates/C.html      方向 C「册页 · 编辑感」

设计要点：
  * 「今日」页的内容（导航项 / 倒计时 / 速览 / 新闻）三版**完全一致**，
    只有令牌（色 / 字 / 距 / 圆角 / 动效 / 断点）随方向变化 → 保证公平对比。
  * 共享 CSS 只引用 CSS 变量；每个方向只替换「令牌块 + 少量气质块」。
  * 手机/桌面两套形态：JS 用 matchMedia 决定 data-mode，另有「手机预览」强制 390px。
  * 只有 transform / opacity / border-color / background-color 会动；无 transition:all。
"""
import base64
import datetime as dt
import os
from string import Template

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/docs/redesign-2026-10/plates"
FONT_SRC = "/Users/xielihui/Desktop/砺蕴教务系统/砺蕴工作台/assets/liyun-xingshu.woff2"

# ─────────────────────────────────────────────────────────────────────────────
# 真实数据（取自生产系统 index.html 的「今日」页与 NAV_ORDER / TAB_ORDER）
# ─────────────────────────────────────────────────────────────────────────────
NAV = [
    ("target", "今日", True), ("clipboard", "考勤", False), ("pin", "打卡管理", False),
    ("memo", "作业", False), ("users", "名册", False), ("grad", "学生账号", False),
    ("card", "学员档案", False), ("calendar", "课表", False), ("moon", "晚自习", False),
    ("chart", "量化", False), ("mic", "模考", False), ("inbox", "协作", False),
    ("megaphone", "限时征集", False), ("pulse", "巡检", False), ("gear", "设置", False),
]
# 手机底部标签栏（admin 的 TAB_ORDER，真实 5 项）
TABS = [("target", "今日", True), ("clipboard", "考勤", False), ("memo", "作业", False),
        ("users", "名册", False), ("gear", "设置", False)]

OVERVIEW = [
    ("考勤已登记", "42"),
    ("考勤异常（迟到/请假）", "3"),
    ("晚自习过关", "38 / 42"),
    ("今晚作业", "3"),
]

NEWS = [
    ("07:12", "国内多家博物馆推出夜间开放，暑期客流同比增长", "多家一级博物馆延长闭馆时间，夜场预约量较去年同期明显上升。"),
    ("08:30", "教育部发布新学年校园安全提示", "提示围绕消防、食品与心理健康三方面提出具体要求。"),
    ("10:05", "我国科研团队在语音合成领域取得新进展", "相关成果可让合成语音更贴近自然语调，已进入开源测试阶段。"),
    ("12:40", "多地进入汛期，水利部门启动应急响应", "重点流域加强巡查值守，确保主要堤段安全。"),
    ("15:20", "新一轮消费补贴政策落地，覆盖家电与汽车", "补贴将以线上申领、线下核销的方式同步开展。"),
    ("18:45", "全国大学生艺术展演落幕，多所院校获奖", "展演历时一周，涉及声乐、舞蹈、戏剧等门类。"),
]

SPRITE = {
    "bolt": '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    "book": '<path d="M5 5h7v14H5zM12 5h7v14h-7z"/><path d="M5 5a2 2 0 0 0-2 2v10a2 2 0 0 1 2-2M19 5a2 2 0 0 1 2 2v10a2 2 0 0 0-2-2"/>',
    "calendar": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
    "card": '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5 16c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5"/><path d="M14 9h5M14 13h5"/>',
    "chart": '<path d="M4 20h16"/><path d="M7 20v-6M12 20V8M17 20v-9"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7"/>',
    "clipboard": '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h6M9 19h4"/>',
    "clock": '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    "desktop": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4"/>',
    "export": '<path d="M12 3v9m0 0l-4-4m4 4l4-4"/><path d="M4 14h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
    "gear": '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    "grad": '<path d="M12 4l9 4-9 4-9-4z"/><path d="M7 9v5c0 1.7 2.2 3 5 3s5-1.3 5-3V9"/><path d="M21 8v4"/>',
    "inbox": '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    "megaphone": '<path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M20 9a4 4 0 0 1 0 6"/>',
    "memo": '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    "mic": '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3M9 21h6"/>',
    "moon": '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>',
    "news": '<path d="M4 5h13v14H4z"/><path d="M17 9h3v10h-3z"/><path d="M7 8h7M7 11h7M7 14h4"/>',
    "pin": '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "pulse": '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
    "refresh": '<path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 5v6h-6"/>',
    "target": '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    "users": '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 6.4a3 3 0 0 1 0 5.8"/><path d="M21 20c0-2.4-1.2-4-3-4.8"/>',
    "warn": '<path d="M12 3.5l8.5 15H3.5z"/><path d="M12 10v4M12 17h.01"/>',
}


def ic(k):
    return ('<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            '<use href="#ic-%s"></use></svg>' % k)


def sprite_svg():
    parts = ['<svg id="ic-sprite" xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">']
    for k, body in SPRITE.items():
        parts.append('<symbol id="ic-%s" viewBox="0 0 24 24">%s</symbol>' % (k, body))
    parts.append('</svg>')
    return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# 每方向的令牌（逐值来自 PRD §3）
# ─────────────────────────────────────────────────────────────────────────────
A = dict(
    key="A", name="素笺 · 精修暖金",
    pos="不换气质，只把「暖纸 + 墨 + 古铜金」这套已经立住的资产做到像素级精修。",
    who="安静、可信、有手工感 —— 最贴近艺考 / 播音机构既有的调性；对现有 34 页兼容成本最低。",
    changes=[
        "间距从 2 个值扩成 4px 基准 9 档（4/8/12/16/24/32/48/72/112），卡片内边距走 clamp(20→40)。",
        "字号从 4 档扩成 6 档（display 44 / h1 26 / h2 18 / body 16 / small 14 / caption 12），字重收敛到 400·500 两档。",
        "次要文字 #96918a → #6E6A61 加深一档，灰字对比度补到 ≥4.5:1；分割线统一 #E7E3DA。",
        "圆角从 5 个散值收成 3 档（8/12/16）+ pill；桌面一律 1px 细线，不用投影。",
        "动效从单一 .18s 扩成 4 档（120/180/280/420ms）、3 条缓动；transition:all 收窄为具体属性。",
    ],
    note="品牌标用系统内嵌行书子集 LiYunXingShu（≈10KB，base64 内联）绘制「砺蕴」，与生产系统门头一致。",
    light=dict(bg="#F7F5F0", card="#FFFFFF", text="#26241F", dim="#6E6A61", line="#E7E3DA",
               accent="#26241F", accent_fg="#FFFFFF", brand="#C9AB7C", brand_strong="#B08A4F",
               emphasis="#B08A4F", emphasis_fg="#FFFFFF", ok="#3F7D5A", warn="#A8611E", danger="#B23A2E"),
    dark=dict(bg="#14120E", card="#1E1B16", text="#EFE9DF", dim="#A39C8E", line="#322E26",
              accent="#C9AB7C", accent_fg="#14120E", brand="#C9AB7C", brand_strong="#D6BE93",
              emphasis="#D6BE93", emphasis_fg="#14120E", ok="#6FAE88", warn="#D08A45", danger="#D06A5C",),
    font_body='-apple-system,"PingFang SC",system-ui,sans-serif',
    font_display='-apple-system,"PingFang SC",system-ui,sans-serif',
    mono='ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    r=dict(sm="8px", md="12px", lg="16px", bar="999px"),
    sh1="0 1px 2px rgba(60,50,35,.05)", sh2="0 6px 18px rgba(60,50,35,.08)",
    fs=dict(display="44px", h1="26px", h2="18px", body="16px", small="14px", caption="12px"),
    lh_body="1.75", cap_ls=".04em",
    fw=dict(display="500", h1="500", h2="500"),
    spacing=[4, 8, 12, 16, 24, 32, 48, 72, 112],
    pad="clamp(20px,7cqi,40px)", frame="clamp(16px,6cqi,40px)", block="clamp(32px,8cqi,72px)",
    motion=[("quick", "120ms", "cubic-bezier(.4,0,.2,1)", "按钮 / 勾选反馈"),
            ("base", "180ms", "cubic-bezier(.4,0,.2,1)", "悬停、边框色、chip 切换"),
            ("slow", "280ms", "cubic-bezier(0,0,.2,1)", "卡片入场、列表项出现"),
            ("page", "420ms", "cubic-bezier(.22,1,.36,1)", "抽屉 / 切页")],
    d=dict(quick="120ms", base="180ms", slow="280ms", page="420ms"),
    e=dict(quick="cubic-bezier(.4,0,.2,1)", base="cubic-bezier(.4,0,.2,1)",
           slow="cubic-bezier(0,0,.2,1)", page="cubic-bezier(.22,1,.36,1)"),
    bp_mobile=640, bp_two=960, bp_wide=1440, maxw="1400px",
    use_xingshu=True, serif_display=False, mono_numbers=False, hard_edge=False,
)

B = dict(
    key="B", name="青灰 · 单点缀",
    pos="把暖调抽走，换成冷静灰白；全系统只留一个强调色，金色降级为 1px 徽记。",
    who="专业、克制、工程感 —— 最适合教务端大量数据、表格、统计页。",
    changes=[
        "背景 #f6f5f2（微暖）→ #F5F6F7（冷白灰）；卡片、正文、次要文字整体去掉暖调。",
        "端口 6 套 accent 收敛为全站唯一强调色 #3B6EA5（用量 <5%）；品牌金 #C9AB7C 只留作 1px 徽记。",
        "间距刻度偏紧、7 档（到 64）；字号整体收紧到 40/24/17/15/13/11，字重上限 600 且只在 display/h1。",
        "圆角 6/10/14，主体靠 1px hairline 分界，绝不用彩色投影；radius 不超过 16。",
        "动效更快（100/150ms 基准，quint 进入、加速退出）；数字 / 时间 / 学号统一走等宽 mono。",
    ],
    note="金色在此版不再是操作色 —— 只作为「砺蕴」字标旁的一枚 1px 徽记，提醒品牌还在。",
    light=dict(bg="#F5F6F7", card="#FFFFFF", text="#1C1F22", dim="#6B7280", line="#E3E6EA",
               accent="#232A31", accent_fg="#FFFFFF", brand="#C9AB7C", brand_strong="#C9AB7C",
               emphasis="#3B6EA5", emphasis_fg="#FFFFFF", ok="#2F7D5D", warn="#9A6B14", danger="#B23A2E"),
    dark=dict(bg="#101215", card="#181B1F", text="#E6E9ED", dim="#8A93A0", line="#262A30",
              accent="#CFD6DE", accent_fg="#101215", brand="#C9AB7C", brand_strong="#C9AB7C",
              emphasis="#6E9CD6", emphasis_fg="#101215", ok="#5FA981", warn="#C79A3E", danger="#D06A5C"),
    font_body='-apple-system,"PingFang SC",system-ui,sans-serif',
    font_display='-apple-system,"PingFang SC",system-ui,sans-serif',
    mono='ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    r=dict(sm="6px", md="10px", lg="14px", bar="999px"),
    sh1="0 1px 2px rgba(0,0,0,.06)", sh2="0 8px 24px rgba(0,0,0,.12)",
    fs=dict(display="40px", h1="24px", h2="17px", body="15px", small="13px", caption="11px"),
    lh_body="1.55", cap_ls=".06em",
    fw=dict(display="600", h1="600", h2="500"),
    spacing=[4, 8, 12, 16, 24, 32, 48, 64],
    pad="clamp(16px,5cqi,32px)", frame="clamp(14px,4cqi,32px)", block="clamp(24px,6cqi,48px)",
    motion=[("quick", "100ms", "cubic-bezier(.2,0,0,1)", "悬停 / 按下"),
            ("base", "150ms", "cubic-bezier(.2,0,0,1)", "状态切换"),
            ("enter", "220ms", "cubic-bezier(.22,1,.36,1)", "弹窗 / 抽屉进入（quint）"),
            ("exit", "160ms", "cubic-bezier(.4,0,1,1)", "弹窗 / 抽屉退出（加速）")],
    d=dict(quick="100ms", base="150ms", slow="220ms", page="220ms"),
    e=dict(quick="cubic-bezier(.2,0,0,1)", base="cubic-bezier(.2,0,0,1)",
           slow="cubic-bezier(.22,1,.36,1)", page="cubic-bezier(.22,1,.36,1)"),
    bp_mobile=640, bp_two=900, bp_wide=1280, maxw="1360px",
    use_xingshu=False, serif_display=False, mono_numbers=True, hard_edge=False,
)

C = dict(
    key="C", name="册页 · 编辑感",
    pos="把系统做成一本「册页」—— 暖骨白纸底、衬线标题、细分隔线、大留白、慢动效。",
    who="权威、有文化厚度 —— 契合「播音主持 / 艺德卓绝」的机构叙事，但数据页需单独收紧一档。",
    changes=[
        "背景 #F1ECDE 暖骨白（Stripe Press 的 ground），绝不用正白；分割线唯一装饰 #C8BEA4。",
        "display 48 / h1 30 改用衬线（Songti SC / 思源宋体 / STSong），正文仍走系统无衬线。",
        "间距基准改 8px、7 档大留白（8/16/24/40/64/96/144）；卡片内边距 clamp(20→64)。",
        "圆角 sm0 / md2 / lg0 ——「册页不能有圆角」；投影全删，抽屉浮层才给极重阴影。",
        "动效放慢：quick 200 / base 320 / reveal 520 / page 900ms，只做交叉淡入，不做位移炫技。",
    ],
    note="⚠️ 风险如实标注：衬线标题依赖系统宋体栈（Songti SC / Source Han Serif / STSong）；若不能引入思源宋体，Windows 上观感不稳，且随机器字形差异较大。",
    light=dict(bg="#F1ECDE", card="#FFFFFF", text="#1A1A18", dim="#736D5A", line="#C8BEA4",
               accent="#1A1A18", accent_fg="#FFFFFF", brand="#A8873F", brand_strong="#A8873F",
               emphasis="#1B4B5A", emphasis_fg="#FFFFFF", ok="#2F7D5D", warn="#AA7A1E", danger="#B23A2E"),
    dark=dict(bg="#1A1815", card="#232019", text="#EDE7DA", dim="#9C927C", line="#3A352A",
              accent="#EDE7DA", accent_fg="#1A1815", brand="#C9AB7C", brand_strong="#C9AB7C",
              emphasis="#6E9AA8", emphasis_fg="#1A1815", ok="#5FA981", warn="#C79A3E", danger="#D06A5C"),
    font_body='-apple-system,"PingFang SC",system-ui,sans-serif',
    font_display='"Songti SC","Source Han Serif SC","Source Han Serif","STSong",serif',
    mono='ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    r=dict(sm="0px", md="2px", lg="0px", bar="999px"),
    sh1="none", sh2="0 20px 48px rgba(0,0,0,.18)",
    fs=dict(display="48px", h1="30px", h2="20px", body="16px", small="14px", caption="12px"),
    lh_body="1.75", cap_ls=".1em",
    fw=dict(display="400", h1="400", h2="500"),
    spacing=[8, 16, 24, 40, 64, 96, 144],
    pad="clamp(20px,9cqi,64px)", frame="clamp(20px,8cqi,64px)", block="clamp(40px,10cqi,96px)",
    motion=[("quick", "200ms", "cubic-bezier(.25,.1,.25,1)", "悬停"),
            ("base", "320ms", "cubic-bezier(.25,.1,.25,1)", "状态切换"),
            ("reveal", "520ms", "cubic-bezier(.22,1,.36,1)", "内容出现"),
            ("page", "900ms", "cubic-bezier(.22,1,.36,1)", "切页 / 交叉淡入（慢）")],
    d=dict(quick="200ms", base="320ms", slow="520ms", page="900ms"),
    e=dict(quick="cubic-bezier(.25,.1,.25,1)", base="cubic-bezier(.25,.1,.25,1)",
           slow="cubic-bezier(.22,1,.36,1)", page="cubic-bezier(.22,1,.36,1)"),
    bp_mobile=680, bp_two=1100, bp_wide=1100, maxw="1200px",
    use_xingshu=False, serif_display=True, mono_numbers=False, hard_edge=True,
)

DIRS = [A, B, C]

# ─────────────────────────────────────────────────────────────────────────────
# 共享 CSS（只引用 CSS 变量；三版完全相同）
# ─────────────────────────────────────────────────────────────────────────────
SHARED_CSS = r"""
/* ===== 重置 ===== */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;color-scheme:light}
:root{color-scheme:light}
[data-theme="dark"]{color-scheme:dark}
body{
  margin:0;background:var(--bg);color:var(--text);
  font-family:var(--font-body);font-size:var(--fs-body);line-height:var(--lh-body);
  -webkit-font-smoothing:antialiased;
}
h1,h2,h3,p,ul,figure{margin:0}
ul{padding:0;list-style:none}
button{font-family:inherit;color:inherit}
a{color:inherit}

/* 数字：全局等宽，刷新 / 对齐不跳列（学 Geist / Tufte） */
.num,.clock,.news-time,.ov-val,.hero-num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.ic{width:1.15em;height:1.15em;stroke:currentColor;fill:none;stroke-width:1.7;
  stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;vertical-align:-.16em}

/* 焦点环：GOV.UK 式高对比，键盘用户必须看得见 */
:where(a,button,input,summary,[tabindex]):focus-visible{
  outline:3px solid var(--focus);outline-offset:2px;border-radius:var(--r-sm);
}

/* ===== 页面外壳（说明带 / 控件 / 令牌条） ===== */
.stage{max-width:var(--doc-max);margin:0 auto;padding:0 clamp(14px,3vw,20px) 56px}

.doc{border-bottom:1px solid var(--line);padding:26px 0 20px;margin-bottom:20px}
.doc-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.doc-badge{font-family:var(--mono);font-size:var(--fs-caption);letter-spacing:.14em;
  text-transform:uppercase;color:var(--emphasis);border:1px solid var(--line);
  border-radius:var(--r-pill);padding:4px 11px}
.doc-title{font-family:var(--font-display);font-size:clamp(24px,3.2cqi + 14px,34px);
  font-weight:var(--fw-h1);letter-spacing:-.005em;line-height:1.15;text-wrap:balance}
.doc-pos{margin-top:10px;font-size:var(--fs-body);color:var(--text);max-width:60ch;text-wrap:pretty}
.doc-who{margin-top:6px;font-size:var(--fs-small);color:var(--dim);max-width:64ch;text-wrap:pretty}
.doc-list{margin-top:14px;display:grid;gap:7px;max-width:78ch}
.doc-list li{position:relative;padding-left:18px;font-size:var(--fs-small);color:var(--dim);text-wrap:pretty}
.doc-list li::before{content:"";position:absolute;left:2px;top:.62em;width:6px;height:6px;
  border-radius:2px;background:var(--brand)}
.doc-note{margin-top:14px;font-size:var(--fs-caption);color:var(--dim);
  border-left:2px solid var(--brand);padding:2px 0 2px 10px;text-wrap:pretty}

.bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 18px}
.ctl{
  border:1px solid var(--line);background:var(--card);color:var(--text);
  font-size:var(--fs-small);padding:9px 15px;border-radius:var(--r-md);cursor:pointer;
  display:inline-flex;align-items:center;gap:8px;
  transition:border-color var(--dur-quick) var(--ease-quick),background-color var(--dur-quick) var(--ease-quick),color var(--dur-quick) var(--ease-quick);
}
.ctl[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:var(--accent-fg)}
.ctl:active{transform:scale(.98)}
.bar .spacer{flex:1}
.bar .bar-note{font-size:var(--fs-caption);color:var(--dim)}

/* ===== 设备框 ===== */
.device{margin:0 auto;width:100%;transition:width var(--dur-slow) var(--ease-slow)}
.app{
  container-type:inline-size;container-name:app;
  background:var(--bg);border:1px solid var(--line);border-radius:var(--r-lg);
  overflow:hidden;display:flex;height:min(880px,90vh);box-shadow:var(--shadow-1);
}
[data-mode="phone"] .device{width:min(390px,100%);max-width:100%}
[data-mode="phone"] .app{height:min(788px,86vh);border-radius:34px;border-color:var(--line)}
[data-mode="phone"] .device.bare{width:100%}
[data-mode="phone"] .device.bare .app{height:calc(100vh - 150px);min-height:600px;border-radius:var(--r-lg)}

/* 侧栏（桌面） / 顶栏 + 标签栏（手机）—— 形态由 data-mode 决定 */
.side{display:none;width:84px;flex:0 0 auto;background:var(--side-bg);
  border-right:1px solid var(--line);flex-direction:column;
  padding:16px 8px;gap:6px;overflow-y:auto;scrollbar-width:none}
.side::-webkit-scrollbar{display:none}
.brand{display:flex;flex-direction:column;align-items:center;gap:6px;padding:4px 0 12px;
  border-bottom:1px solid var(--line);margin-bottom:6px}
.brand-mark{font-size:24px;line-height:1;color:var(--text)}
.brand-mark.shu{font-family:'LiYunXingShu','Kaiti SC',serif}
.brand-sub{font-size:9px;letter-spacing:.16em;color:var(--dim);text-align:center}
.greet{font-size:var(--fs-caption);color:var(--dim);text-align:center;line-height:1.4;padding:0 2px 8px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav button{
  border:none;background:transparent;color:var(--dim);cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:5px;
  padding:9px 2px;border-radius:var(--r-md);font-size:10.5px;line-height:1.2;
  transition:background-color var(--dur-base) var(--ease-base),color var(--dur-base) var(--ease-base);
}
.nav button .ic{width:20px;height:20px}
.nav button:hover{color:var(--text);background:var(--hover)}
.nav button[aria-current="page"]{background:var(--accent);color:var(--accent-fg)}

.col{flex:1;min-width:0;display:flex;flex-direction:column;height:100%}
.topbar{display:none;align-items:center;gap:10px;flex:0 0 auto;
  padding:12px 16px;border-bottom:1px solid var(--line);
  background:var(--card);position:relative}
.topbar .t-mark{font-size:19px;line-height:1}
.topbar .t-mark.shu{font-family:'LiYunXingShu','Kaiti SC',serif}
.topbar .t-name{flex:1;min-width:0;font-size:var(--fs-small);font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar .t-brandbar{position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--brand);opacity:.5}
.main{flex:1;min-width:0;overflow-y:auto;scrollbar-gutter:stable;
  padding:var(--pad-frame);scroll-behavior:smooth}
.tabbar{display:none;flex:0 0 auto;gap:4px;padding:8px;background:var(--card);
  border-top:1px solid var(--line)}
.tabbar button{border:none;background:transparent;cursor:pointer;color:var(--dim);
  flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;
  font-size:10.5px;line-height:1.2;padding:7px 2px;border-radius:var(--r-md);
  transition:background-color var(--dur-base) var(--ease-base),color var(--dur-base) var(--ease-base)}
.tabbar button .ic{width:22px;height:22px}
.tabbar button[aria-current="page"]{background:var(--accent);color:var(--accent-fg)}

[data-mode="desk"] .side{display:flex}
[data-mode="phone"] .side{display:none}
[data-mode="phone"] .topbar{display:flex}
[data-mode="phone"] .tabbar{display:flex}
[data-mode="phone"] .main{padding-bottom:28px}

/* ===== 页面内容 ===== */
.page-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:var(--block-sp)}
.page-head h1{font-family:var(--font-display);font-size:var(--fs-h1);font-weight:var(--fw-h1);
  letter-spacing:-.01em;line-height:1.2;text-wrap:balance}
.clock{font-family:var(--mono);font-size:var(--fs-small);font-weight:400;color:var(--emphasis)}

.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:var(--pad);box-shadow:var(--shadow-1)}
.card h2{font-size:var(--fs-h2);font-weight:var(--fw-h2);line-height:1.35;
  display:flex;align-items:center;gap:8px;text-wrap:balance}
.card h2 .ic{color:var(--brand-strong)}
.card .meta{font-size:var(--fs-small);color:var(--dim);font-weight:400}

/* hero：全页唯一的「一眼元素」 */
.hero{display:grid;gap:var(--pad);align-items:center;
  grid-template-columns:1fr auto}
.hero-row{display:flex;align-items:flex-end;gap:10px;margin-top:6px}
.hero-num{font-family:var(--font-display);font-size:var(--fs-display);font-weight:var(--fw-display);
  line-height:1;letter-spacing:-.02em;color:var(--text)}
.hero-unit{font-size:var(--fs-h2);color:var(--dim);font-weight:400;margin-bottom:.35em}
.hero-hint{margin-top:12px;font-size:var(--fs-small);color:var(--dim)}
.ring{width:min(140px,26cqi);aspect-ratio:1;display:block}
.ring caption,.ring-label{font-size:var(--fs-caption);color:var(--dim);
  letter-spacing:var(--cap-ls);text-transform:uppercase}
.ring-wrap{display:flex;flex-direction:column;align-items:center;gap:8px}

.edit-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;
  padding-top:16px;border-top:1px solid var(--line)}
input[type="text"],input[type="date"],select{
  font-family:inherit;font-size:var(--fs-body);color:var(--text);
  background:transparent;border:1px solid var(--line);border-radius:var(--r-md);
  padding:10px 12px;min-width:0;
  transition:border-color var(--dur-quick) var(--ease-quick),background-color var(--dur-quick) var(--ease-quick)}
input::placeholder{color:var(--dim)}
.btn{border:1px solid transparent;border-radius:var(--r-md);cursor:pointer;white-space:nowrap;
  font-size:var(--fs-small);font-weight:500;padding:10px 18px;
  background:var(--accent);color:var(--accent-fg);
  transition:background-color var(--dur-base) var(--ease-base),border-color var(--dur-base) var(--ease-base)}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn.ghost:hover{border-color:var(--accent)}
.btn:active{transform:scale(.98)}

/* 两栏：靠容器查询在中/宽档横过来（少一半全局断点） */
.workgrid{display:grid;gap:var(--block-sp);grid-template-columns:1fr;margin-top:var(--block-sp)}
@container app (min-width:__BP_TWO__px){
  .workgrid{grid-template-columns:1.15fr .85fr;align-items:start}
}

/* 今日速览 */
.ov-item{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:13px 0;border-bottom:1px solid var(--line);content-visibility:auto;
  contain-intrinsic-size:auto 48px}
.ov-item:last-child{border-bottom:none}
.ov-lab{font-size:var(--fs-small);color:var(--dim)}
.ov-val{font-size:var(--fs-h2);font-weight:var(--fw-h2);color:var(--text)}

/* 每日新闻 */
.news-list{margin-top:6px;max-height:360px;overflow:auto;scrollbar-gutter:stable}
.news-item{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);
  content-visibility:auto;contain-intrinsic-size:auto 52px}
.news-item:last-child{border-bottom:none}
.news-time{font-family:var(--mono);font-size:var(--fs-small);color:var(--dim);flex:0 0 auto;padding-top:1px}
.news-main{flex:1;min-width:0}
.news-title{font-size:var(--fs-small);line-height:1.5;text-wrap:pretty}
.news-brief{margin-top:4px;font-size:var(--fs-caption);color:var(--dim);line-height:1.55;text-wrap:pretty}
.card-foot{margin-top:12px;font-size:var(--fs-caption);color:var(--dim)}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.nowrap{white-space:nowrap}

/* 入场：只动 transform / opacity，元素默认即终态（reduced-motion 天然兜底） */
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.page > *{animation:rise var(--dur-slow) var(--ease-slow) both}
.page > *:nth-child(2){animation-delay:calc(var(--dur-quick) * .25)}
.page > *:nth-child(3){animation-delay:calc(var(--dur-quick) * .5)}

/* ===== 令牌条 ===== */
.tokens{margin-top:40px;padding-top:28px;border-top:1px solid var(--line)}
.tokens > h2{font-family:var(--font-display);font-size:var(--fs-h2);font-weight:var(--fw-h2)}
.tokens > p{margin-top:6px;font-size:var(--fs-small);color:var(--dim)}
.tk-grid{display:grid;gap:28px;margin-top:22px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.tk h3{font-size:var(--fs-caption);letter-spacing:.1em;text-transform:uppercase;color:var(--dim);
  font-weight:500;margin-bottom:14px}
.sw{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(84px,1fr))}
.sw figure{display:flex;flex-direction:column;gap:6px}
.sw .chip{height:52px;border-radius:var(--r-sm);border:1px solid var(--line)}
.sw figcaption{font-size:10.5px;color:var(--dim);line-height:1.4}
.sw .chip-name{color:var(--text);font-weight:500}
.sw code{font-family:var(--mono);font-size:10px;color:var(--dim);display:block;letter-spacing:-.02em}

.ts{display:grid;gap:12px}
.ts .row-d{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  border-bottom:1px solid var(--line);padding-bottom:10px}
.ts .row-d:last-child{border-bottom:none}
.ts .samp{font-family:var(--font-display);color:var(--text);min-width:0;overflow:hidden;
  white-space:nowrap;text-overflow:ellipsis}
.ts .spec{font-family:var(--mono);font-size:10.5px;color:var(--dim);flex:0 0 auto;text-align:right}

.sp{display:grid;gap:10px}
.sp .row-d{display:flex;align-items:center;gap:12px}
.sp .b{height:14px;background:var(--brand);border-radius:2px;flex:0 0 auto}
.sp .lb{font-family:var(--mono);font-size:11px;color:var(--dim);flex:0 0 auto;width:52px}

.rd{display:flex;gap:14px;flex-wrap:wrap}
.rd figure{display:flex;flex-direction:column;align-items:center;gap:7px}
.rd .box{width:56px;height:56px;border:1px solid var(--line);background:var(--card)}
.rd figcaption{font-family:var(--mono);font-size:10.5px;color:var(--dim)}

.mo{display:grid;gap:10px}
.mo .row-d{display:flex;align-items:baseline;gap:12px;justify-content:space-between;
  border-bottom:1px solid var(--line);padding-bottom:9px;font-size:var(--fs-small)}
.mo .row-d:last-child{border-bottom:none}
.mo .mo-k{font-weight:500}
.mo .mo-v{font-family:var(--mono);font-size:11px;color:var(--dim)}
.mo .mo-s{font-size:var(--fs-caption);color:var(--dim);flex:1;text-align:right}

/* reduced-motion 兜底：动效一律关（不是可选项） */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.01ms !important;animation-delay:0s !important;
    transition-duration:.01ms !important;scroll-behavior:auto !important}
}
"""

# 各方向的气质块（补足令牌无法表达的差异）——三版也各不相同
FLAVOR = {
"A": r"""
.brand-mark.shu{letter-spacing:.02em}
.card{border-radius:var(--r-lg)}
[data-mode="phone"] .card{position:relative}
[data-mode="phone"] .card::before{content:"";position:absolute;top:-1px;left:22px;right:22px;height:2px;
  border-radius:0 0 3px 3px;background:var(--brand);opacity:.55}
[data-mode="phone"] .tabbar{border-top:none;border-radius:var(--r-bar);
  margin:0 12px 14px;box-shadow:var(--shadow-2);border:1px solid var(--line)}
.card:hover{box-shadow:var(--shadow-2)}
.doc-badge{background:color-mix(in oklab,var(--brand) 12%,transparent);border-color:transparent;color:var(--brand-strong)}
""",
"B": r"""
.num,.clock,.news-time,.hero-num,.ov-val{font-family:var(--mono)}
.brand-mark{font-size:22px;letter-spacing:-.02em}
.brand-sub{gap:6px}
.card{border-radius:var(--r-lg)}
.doc-badge{background:color-mix(in srgb,var(--emphasis) 10%,transparent);border-color:transparent;color:var(--emphasis)}
.card h2 .ic{color:var(--dim)}
.news-title a{text-decoration:none}
.brand-badge{display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--brand)}
.hero-num{font-weight:600}
/* 金色在此版只作徽记：文档区的点标 / 侧线改走唯一强调色 */
.doc-list li::before{background:var(--emphasis)}
.doc-note{border-left-color:var(--emphasis)}
""",
"C": r"""
.page-head h1,.hero-num,.doc-title,.tokens > h2,.card h2{letter-spacing:0}
.page-head h1,.hero-num{font-family:var(--font-display);font-weight:400}
.card{box-shadow:none}
.card h2 .ic{color:var(--brand)}
.card-head .btn.ghost{border-radius:0}
.ov-item,.news-item{border-bottom-style:solid}
.hero-hint,.news-brief{font-variant-numeric:tabular-nums}
.doc-badge{background:transparent;border-color:var(--line);color:var(--brand-strong);border-radius:0;letter-spacing:.16em}
.rd .box{border-radius:0}
""",
}


def tokens_css(d):
    L, D = d["light"], d["dark"]
    lines = []
    lines.append(":root{")
    lines.append("  --font-body:%s;" % d["font_body"])
    lines.append("  --font-display:%s;" % d["font_display"])
    lines.append("  --mono:%s;" % d["mono"])
    keys = [("bg", "bg"), ("card", "card"), ("text", "text"), ("dim", "dim"), ("line", "line"),
            ("accent", "accent"), ("accent-fg", "accent_fg"), ("brand", "brand"),
            ("brand-strong", "brand_strong"), ("emphasis", "emphasis"), ("emphasis-fg", "emphasis_fg"),
            ("ok", "ok"), ("warn", "warn"), ("danger", "danger")]
    for cssk, k in keys:
        lines.append("  --%s:%s;" % (cssk, L[k]))
    lines.append("  --focus:%s;" % L["emphasis"])
    lines.append("  --hover:%s;" % ("color-mix(in srgb,var(--text) 6%,transparent)"))
    lines.append("  --side-bg:%s;" % L["card"])
    lines.append("  --r-sm:%s;--r-md:%s;--r-lg:%s;--r-pill:999px;--r-bar:%s;"
                 % (d["r"]["sm"], d["r"]["md"], d["r"]["lg"], d["r"]["bar"]))
    lines.append("  --shadow-1:%s;--shadow-2:%s;" % (d["sh1"], d["sh2"]))
    lines.append("  --fs-display:%s;--fs-h1:%s;--fs-h2:%s;--fs-body:%s;--fs-small:%s;--fs-caption:%s;"
                 % (d["fs"]["display"], d["fs"]["h1"], d["fs"]["h2"], d["fs"]["body"],
                    d["fs"]["small"], d["fs"]["caption"]))
    lines.append("  --fw-display:%s;--fw-h1:%s;--fw-h2:%s;"
                 % (d["fw"]["display"], d["fw"]["h1"], d["fw"]["h2"]))
    lines.append("  --lh-body:%s;--cap-ls:%s;" % (d["lh_body"], d["cap_ls"]))
    lines.append("  --pad:%s;--pad-frame:%s;--block-sp:%s;" % (d["pad"], d["frame"], d["block"]))
    lines.append("  --dur-quick:%s;--dur-base:%s;--dur-slow:%s;--dur-page:%s;"
                 % (d["d"]["quick"], d["d"]["base"], d["d"]["slow"], d["d"]["page"]))
    lines.append("  --ease-quick:%s;--ease-base:%s;--ease-slow:%s;--ease-page:%s;"
                 % (d["e"]["quick"], d["e"]["base"], d["e"]["slow"], d["e"]["page"]))
    lines.append("  --doc-max:%s;" % d["maxw"])
    lines.append("}")
    lines.append('[data-theme="dark"]{')
    for cssk, k in keys:
        if k in D:
            lines.append("  --%s:%s;" % (cssk, D[k]))
    lines.append("  --focus:%s;" % D["emphasis"])
    lines.append("  --hover:%s;" % ("color-mix(in srgb,var(--text) 10%,transparent)"))
    lines.append("  --side-bg:%s;" % D["card"])
    lines.append("}")
    return "\n".join(lines)


def app_html(d):
    nav = "\n".join(
        '<button type="button"%s>%s<span>%s</span></button>'
        % (' aria-current="page"' if on else "", ic(k), name)
        for k, name, on in NAV)
    tabs = "\n".join(
        '<button type="button"%s>%s<span>%s</span></button>'
        % (' aria-current="page"' if on else "", ic(k), name)
        for k, name, on in TABS)
    ov = "\n".join(
        '<li class="ov-item"><span class="ov-lab">%s</span><span class="ov-val">%s</span></li>'
        % (lab, val) for lab, val in OVERVIEW)
    news = "\n".join(
        '<li class="news-item"><span class="news-time">%s</span>'
        '<span class="news-main"><span class="news-title">%s</span>'
        '<span class="news-brief">%s</span></span></li>'
        % (t, tt, b) for t, tt, b in NEWS)

    mark_cls = "brand-mark shu" if d["use_xingshu"] else "brand-mark"
    t_mark_cls = "t-mark shu" if d["use_xingshu"] else "t-mark"
    brand_extra = '<span class="brand-badge" aria-hidden="true"></span>' if d["key"] == "B" else ""
    greet = "李蕴老师，下午好"

    return TEMPLATE_APP.substitute(
        nav=nav, tabs=tabs, ov=ov, news=news,
        mark_cls=mark_cls, t_mark_cls=t_mark_cls, greet=greet,
        brand_extra=brand_extra, days=DAYS, exam=EXAM_ISO, pct=PCT,
        ring_off=RING_OFF, ring_circ=RING_CIRC,
        news_meta="%s · %d 条" % (TODAY_ISO, len(NEWS)),
        card_pad=d["fs"]["caption"],
    )


TEMPLATE_APP = Template(r"""<div class="app">

  <aside class="side" aria-label="主导航">
    <div class="brand">
      <span class="$mark_cls" aria-hidden="true">砺蕴</span>
      <span class="brand-sub">博学宏才 · 艺德卓绝</span>
      $brand_extra
    </div>
    <div class="greet">$greet</div>
    <nav class="nav">
$nav
    </nav>
  </aside>

  <div class="col">

    <header class="topbar">
      <span class="$t_mark_cls" aria-hidden="true">砺蕴</span>
      <span class="t-name">$greet</span>
      <span class="t-brandbar" aria-hidden="true"></span>
    </header>

    <main class="main">
      <section class="page" aria-labelledby="pgTitle">

        <div class="page-head">
          <h1 id="pgTitle">今日 <span class="clock" data-clock>--:--:--</span></h1>
        </div>

        <section class="card" aria-labelledby="cdTitle">
          <h2 id="cdTitle"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ic-target"></use></svg> 统考倒计时</h2>
          <div class="hero">
            <div>
              <div class="hero-row">
                <span class="hero-num">$days</span>
                <span class="hero-unit">天</span>
              </div>
              <p class="hero-hint">统考：$exam</p>
            </div>
            <div class="ring-wrap">
              <svg class="ring" viewBox="0 0 120 120" role="img" aria-label="备考进度 $pct%">
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="8"/>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--emphasis)" stroke-width="8"
                  stroke-linecap="round" transform="rotate(-90 60 60)"
                  stroke-dasharray="$ring_circ" stroke-dashoffset="$ring_off"/>
                <text x="60" y="58" text-anchor="middle" font-size="24" font-weight="500"
                  fill="var(--text)" style="font-family:var(--font-display)">$pct%</text>
                <text x="60" y="76" text-anchor="middle" font-size="10"
                  fill="var(--dim)">备考进度</text>
              </svg>
            </div>
          </div>
          <div class="edit-row">
            <input type="text" value="统考" aria-label="倒计时名目" style="max-width:150px">
            <input type="date" value="$exam" aria-label="目标日期" style="max-width:170px">
            <button class="btn" type="button">保存</button>
          </div>
        </section>

        <div class="workgrid">

          <section class="card" aria-labelledby="ovTitle">
            <h2 id="ovTitle"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ic-pin"></use></svg> 今日速览</h2>
            <ul>
$ov
            </ul>
          </section>

          <section class="card" aria-labelledby="newsTitle">
            <div class="card-head">
              <h2 id="newsTitle"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ic-news"></use></svg> <span class="nowrap">每日新闻</span> <span class="meta">$news_meta</span></h2>
              <button class="btn ghost" type="button">刷新</button>
            </div>
            <ul class="news-list">
$news
            </ul>
            <p class="card-foot">来源：央视新闻 · 出话题评述先看这里</p>
          </section>

        </div>

      </section>
    </main>

    <nav class="tabbar" aria-label="底部标签栏">
$tabs
    </nav>

  </div>
</div>
""")


def token_strip(d):
    L, D = d["light"], d["dark"]
    pal = [("--bg", "背景 bg"), ("--card", "卡片 card"), ("--text", "正文 text"),
           ("--dim", "次要 dim"), ("--accent", "主色 accent"), ("--brand", "品牌金 brand"),
           ("--emphasis", "强调 emphasis"), ("--line", "分割线 line"), ("--ok", "成功 ok"),
           ("--warn", "警示 warn"), ("--danger", "危险 danger")]
    keymap = {"--bg": "bg", "--card": "card", "--text": "text", "--dim": "dim", "--accent": "accent",
              "--brand": "brand", "--emphasis": "emphasis", "--line": "line", "--ok": "ok",
              "--warn": "warn", "--danger": "danger"}
    sw = []
    for cssv, label in pal:
        k = keymap[cssv]
        sw.append('<figure><span class="chip" style="background:var(%s)"></span>'
                  '<figcaption><span class="chip-name">%s</span>'
                  '<code>%s</code><code>%s</code></figcaption></figure>'
                  % (cssv, label, L[k], D[k]))
    sw = "\n".join(sw)

    fs_rows = [("display", d["fs"]["display"], d["fw"]["display"]),
               ("h1", d["fs"]["h1"], d["fw"]["h1"]),
               ("h2", d["fs"]["h2"], d["fw"]["h2"]),
               ("body", d["fs"]["body"], "400"),
               ("small", d["fs"]["small"], "400"),
               ("caption", d["fs"]["caption"], "500")]
    ts = []
    for name, size, weight in fs_rows:
        ts.append('<div class="row-d"><span class="samp" style="font-size:%s;font-weight:%s">'
                  '砺蕴教务 · 今日速览 Aa 123</span>'
                  '<span class="spec">%s / %s / %s</span></div>'
                  % (size, weight, name, size, weight))
    ts = "\n".join(ts)

    sp = []
    for v in d["spacing"]:
        sp.append('<div class="row-d"><span class="lb">%dpx</span>'
                  '<span class="b" style="width:%dpx"></span></div>' % (v, v))
    sp = "\n".join(sp)

    rd = []
    for name, val in [("sm", d["r"]["sm"]), ("md", d["r"]["md"]), ("lg", d["r"]["lg"]), ("pill", "999px")]:
        rd.append('<figure><span class="box" style="border-radius:%s;background:var(--card)"></span>'
                  '<figcaption>%s · %s</figcaption></figure>' % (val, name, val))
    rd = "\n".join(rd)

    mo = []
    for name, dur, ease, scene in d["motion"]:
        mo.append('<div class="row-d"><span class="mo-k">%s</span>'
                  '<span class="mo-v">%s · %s</span>'
                  '<span class="mo-s">%s</span></div>' % (name, dur, ease, scene))
    mo = "\n".join(mo)

    return TEMPLATE_TOKENS.substitute(sw=sw, ts=ts, sp=sp, rd=rd, mo=mo)


TEMPLATE_TOKENS = Template(r"""<section class="tokens" aria-label="本方向设计令牌">
  <h2>令牌条 · Token Strip</h2>
  <p>下面所有色块 / 字号 / 间距 / 圆角都直接读自本方向的 CSS 变量 —— 切换上方「浅色 / 深色」时它们会一起变，用来核对深浅两套 hex 是否都立得住。</p>
  <div class="tk-grid">

    <div class="tk">
      <h3>色板 Palette（浅 / 深）</h3>
      <div class="sw">
$sw
      </div>
    </div>

    <div class="tk">
      <h3>字号阶梯 Type Scale</h3>
      <div class="ts">
$ts
      </div>
    </div>

    <div class="tk">
      <h3>间距刻度 Spacing（基准 __BASE__px）</h3>
      <div class="sp">
$sp
      </div>
    </div>

    <div class="tk">
      <h3>圆角半径 Radius</h3>
      <div class="rd">
$rd
      </div>
    </div>

    <div class="tk">
      <h3>动效令牌 Motion</h3>
      <div class="mo">
$mo
      </div>
    </div>

  </div>
</section>
""")


TEMPLATE_PAGE = Template(r"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light" data-mode="desk" data-dir="$key">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>砺蕴教务系统 · 视觉方向 $key「$name」</title>
<script>
/* 第 0 帧就定色调，避免深色系统闪一下浅色 */
try{document.documentElement.setAttribute('data-theme',
  matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(e){}
</script>
<style>
$tokens_css
$shared_css
$flavor
</style>
</head>
<body>
$sprite

<div class="stage">

  <header class="doc">
    <div class="doc-top">
      <span class="doc-badge">方向 $key</span>
      <p class="doc-title">$name</p>
    </div>
    <p class="doc-pos">$pos</p>
    <p class="doc-who">这版适合谁：$who</p>
    <ul class="doc-list">
$changes
    </ul>
    <p class="doc-note">$note</p>
  </header>

  <div class="bar">
    <button class="ctl" id="phoneBtn" type="button" aria-pressed="false">手机预览</button>
    <button class="ctl" id="themeBtn" type="button" aria-pressed="false">深色模式</button>
    <span class="spacer"></span>
    <span class="bar-note">内容结构取自生产系统「今日」页；课 / 事项 / 新闻为演示数据，三版完全一致。</span>
  </div>

  <div class="device" id="device">
$app
  </div>

$tokens

</div>

<script>
(function(){
  var BP = $bp_mobile;                 /* 本方向「手机 ⇄ 桌面」断点 */
  var root = document.documentElement;
  var mq = window.matchMedia('(max-width:' + (BP - 1) + 'px)');
  var forcePhone = false;

  function sync(){
    var phone = forcePhone || mq.matches;
    root.setAttribute('data-mode', phone ? 'phone' : 'desk');
    /* 真·窄屏（非手动「手机预览」）时不再套手机壳，让它铺满 */
    var dev = document.getElementById('device');
    if (dev) dev.classList.toggle('bare', phone && !forcePhone);
  }
  if (mq.addEventListener) mq.addEventListener('change', sync); else mq.addListener(sync);

  var pb = document.getElementById('phoneBtn');
  if (pb) pb.addEventListener('click', function(){
    forcePhone = !forcePhone;
    pb.setAttribute('aria-pressed', String(forcePhone));
    sync();
  });

  /* 便于自查 / 分享：地址后加 #phone 直接进手机预览，#dark 直接进深色 */
  var hash = (location.hash || '').replace('#', '').split(',');
  if (hash.indexOf('phone') >= 0) { forcePhone = true; if (pb) pb.setAttribute('aria-pressed', 'true'); }

  var tb = document.getElementById('themeBtn');
  var dark = root.getAttribute('data-theme') === 'dark';
  if (hash.indexOf('dark') >= 0) dark = true;
  function applyTheme(){
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (tb) tb.setAttribute('aria-pressed', String(dark));
  }
  if (tb) tb.addEventListener('click', function(){ dark = !dark; applyTheme(); });
  applyTheme();

  sync();

  /* 实时时钟：与生产系统一致（24 时制，逐秒） */
  function p(n){ return String(n).padStart(2, '0'); }
  function tick(){
    var t = new Date();
    var s = p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds());
    var els = document.querySelectorAll('[data-clock]');
    for (var i = 0; i < els.length; i++) if (els[i].textContent !== s) els[i].textContent = s;
  }
  tick();
  setInterval(tick, 1000);
})();
</script>
</body>
</html>
""")


# ─────────────────────────────────────────────────────────────────────────────
# 日期算术（让「倒计时 / 备考进度」自洽）
# ─────────────────────────────────────────────────────────────────────────────
TODAY = dt.date(2026, 10, 4)
EXAM = dt.date(2027, 2, 8)
START = dt.date(2026, 5, 10)
TODAY_ISO = TODAY.isoformat()
EXAM_ISO = EXAM.isoformat()
DAYS = (EXAM - TODAY).days
TOTAL = (EXAM - START).days
PCT = round((TOTAL - DAYS) / TOTAL * 100)
RING_CIRC = round(2 * 3.141592653589793 * 52, 1)
RING_OFF = round(RING_CIRC * (1 - PCT / 100), 1)


def build_plate(d):
    tokens = tokens_css(d)
    shared = SHARED_CSS.replace("__BP_TWO__", str(d["bp_two"]))
    flavor = FLAVOR[d["key"]]
    changes = "\n".join("      <li>%s</li>" % c for c in d["changes"])
    app = app_html(d)
    # 令牌条里的基准标注
    base = 4 if d["key"] != "C" else 8
    tokens_strip = token_strip(d).replace("__BASE__", str(base))
    html = TEMPLATE_PAGE.substitute(
        key=d["key"], name=d["name"], pos=d["pos"], who=d["who"],
        changes=changes, note=d["note"], tokens_css=tokens, shared_css=shared,
        flavor=flavor, sprite=sprite_svg(), app=app, tokens=tokens_strip,
        bp_mobile=d["bp_mobile"],
    )
    return html


# ─────────────────────────────────────────────────────────────────────────────
# index.html —— 对照入口
# ─────────────────────────────────────────────────────────────────────────────
def build_index():
    cards = []
    for d in DIRS:
        sw = []
        for k in ("bg", "card", "text", "accent", "brand", "emphasis", "line"):
            sw.append('<span style="background:%s"></span>' % d["light"][k])
        sw = "".join(sw)
        cards.append(TEMPLATE_CARD.substitute(
            key=d["key"], name=d["name"], pos=d["pos"], who=d["who"],
            sw=sw, r="%s / %s / %s" % (d["r"]["sm"], d["r"]["md"], d["r"]["lg"]),
            motion=d["motion"][1][1], bp="%s" % d["bp_mobile"],
        ))
    cards = "\n".join(cards)
    return TEMPLATE_INDEX.substitute(cards=cards)


TEMPLATE_CARD = Template(r"""    <article class="pcard">
      <div class="pcard-sw" aria-hidden="true">$sw</div>
      <div class="pcard-body">
        <span class="pcard-key">方向 $key</span>
        <h2>$name</h2>
        <p class="pcard-pos">$pos</p>
        <p class="pcard-who">这版适合谁：$who</p>
        <dl class="pcard-spec">
          <div><dt>圆角 sm/md/lg</dt><dd>$r</dd></div>
          <div><dt>动效基准</dt><dd>$motion</dd></div>
          <div><dt>手机断点</dt><dd>&lt; $bp px</dd></div>
        </dl>
        <a class="pcard-go" href="$key.html">打开这一版 <span aria-hidden="true">→</span></a>
      </div>
    </article>""")


TEMPLATE_INDEX = Template(r"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>砺蕴教务系统 · 视觉升级 · 3 版风格稿对照</title>
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#F7F5F0;color:#26241F;
  font-family:-apple-system,"PingFang SC",system-ui,sans-serif;line-height:1.7;
  -webkit-font-smoothing:antialiased}
@media (prefers-color-scheme: dark){
  body{background:#14120E;color:#EFE9DF}
  .card,.pcard{background:#1E1B16 !important;border-color:#322E26 !important}
  .sub,.pcard-who,.pcard dt{color:#A39C8E !important}
  .pcard-go{border-color:#322E26 !important}
}
.wrap{max-width:1180px;margin:0 auto;padding:56px 22px 80px}
h1{font-size:clamp(26px,4vw,38px);font-weight:500;letter-spacing:-.01em;margin:0;line-height:1.2;text-wrap:balance}
.lead{margin-top:14px;max-width:64ch;color:#6E6A61;text-wrap:pretty}
.sub{margin-top:26px;color:#6E6A61;font-size:14px}
.grid{margin-top:30px;display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.pcard{background:#fff;border:1px solid #E7E3DA;border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column;
  transition:box-shadow .22s cubic-bezier(.22,1,.36,1),border-color .22s cubic-bezier(.22,1,.36,1)}
.pcard:hover{box-shadow:0 10px 30px rgba(60,50,35,.10);border-color:#D8D2C4}
.pcard-sw{display:flex;height:64px}
.pcard-sw span{flex:1}
.pcard-body{padding:20px 22px 22px;display:flex;flex-direction:column;gap:9px;flex:1}
.pcard-key{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a8172}
.pcard h2{font-size:22px;font-weight:500;margin:0;letter-spacing:-.01em}
.pcard-pos{margin:0;font-size:14px}
.pcard-who{margin:0;font-size:13px;color:#6E6A61}
.pcard-spec{margin:6px 0 0;display:grid;gap:6px;font-size:12px}
.pcard-spec > div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #E7E3DA;padding-bottom:6px}
.pcard dt{color:#6E6A61}
.pcard dd{margin:0;font-variant-numeric:tabular-nums}
.pcard-go{margin-top:auto;display:inline-flex;align-items:center;gap:8px;justify-content:center;
  text-decoration:none;color:#26241F;font-size:14px;font-weight:500;
  border:1px solid #E7E3DA;border-radius:999px;padding:11px 18px;
  transition:background-color .18s cubic-bezier(.4,0,.2,1),color .18s cubic-bezier(.4,0,.2,1),border-color .18s cubic-bezier(.4,0,.2,1)}
.pcard-go:hover{background:#B08A4F;border-color:#B08A4F;color:#fff}
:where(a,button):focus-visible{outline:3px solid #B08A4F;outline-offset:2px}
footer{margin-top:44px;padding-top:22px;border-top:1px solid #E7E3DA;font-size:13px;color:#6E6A61}
@media (prefers-reduced-motion: reduce){*{transition-duration:.01ms !important}}
</style>
</head>
<body>
<div class="wrap">
  <h1>砺蕴教务系统 · Web 端视觉升级 —— 3 版风格稿对照</h1>
  <p class="lead">三版都渲染了同一个「今日」页，内容（导航项 / 倒计时 / 今日速览 / 每日新闻）完全一致，只有令牌与气质不同 —— 请用眼睛选，不要读表格选。每份稿都带：手机预览开关、浅色 / 深色开关、以及一条把色板 / 字号 / 间距 / 圆角直接画出来的「令牌条」。</p>
  <p class="sub">三版共同的落地原则：单文件、零外部依赖、双击即开；桌面 = 侧栏 + 内容区，手机 = 顶栏 + 底部胶囊标签栏；只动 transform / opacity；已尊重 prefers-reduced-motion；键盘焦点环按 GOV.UK 规范。</p>

  <div class="grid">
$cards
  </div>

  <footer>建议对比路径：先都打开 → 各自点一次「手机预览」看两端是否都成立 → 再切一次「深色」判断深色该不该本轮做 → 最后回到令牌条核对配色与字号是否可接受。</footer>
</div>
</body>
</html>
""")


def main():
    os.makedirs(OUT, exist_ok=True)
    # 行书字体子集（base64 内联；只有 A 版用到，但保持文件自包含）
    with open(FONT_SRC, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    font_css = ("@font-face{font-family:'LiYunXingShu';"
                "src:url(data:font/woff2;base64,%s) format('woff2');font-display:block}" % b64)

    for d in DIRS:
        html = build_plate(d)
        # 只有 A 需要内联字体；B/C 也内联一份以便共用生成逻辑（无害、离线可用）
        html = html.replace("<style>\n", "<style>\n" + font_css + "\n", 1)
        with open(os.path.join(OUT, "%s.html" % d["key"]), "w", encoding="utf-8") as f:
            f.write(html)
        print("wrote %s.html  (%d KB)" % (d["key"], len(html.encode("utf-8")) // 1024))

    idx = build_index()
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(idx)
    print("wrote index.html  (%d KB)" % (len(idx.encode("utf-8")) // 1024))
    print("days=%d pct=%d%% ring_off=%.1f/%.1f" % (DAYS, PCT, RING_OFF, RING_CIRC))


if __name__ == "__main__":
    main()
