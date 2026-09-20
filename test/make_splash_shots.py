#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴工作系统 —— iPhone 系统启动图生成器（含 index.html 头部清单维护）

作用
  「点开桌面图标 → 页面解析出来」中间有一段空白（这个站部署在境外节点，
  光跨境握手就要约一秒）。iOS 允许我们给每个机型分辨率配一张启动图来填这段空白。
  没有匹配到机型的那些 iPhone 会直接显示白屏 —— 这就是「打开要等几秒」的来源之一。

关键设计：**图不要另外画，直接从 index.html 抽**
  脚本从 index.html 里抽出 :root 变量、@font-face、开屏层的 CSS 与 DOM 结构，
  拼成一个临时页面再截图。这样「启动图」和「页面第一帧」必然一致 ——
  改了开屏样式只要重跑本脚本，图和页面对不上这种事故不可能发生。
  同时把 `*{animation-play-state:paused}` 打进去，截到的就是动画第 0 帧，
  也就是页面刚画出来的那一帧，切过去看不出一丝接缝。

  另外因为开屏层用的是「持续运动」（金线滑动 + 暖金晕呼吸）而不是入场动画，
  第 0 帧本来就等于静止形态，所以启动图和页面之间不会有元素突然消失/冒出来。

顺带维护 index.html 里 <!-- ==== 开屏图清单 START/END ==== --> 之间的 link 标签，
所以**加机型只改这个脚本**，不要手改 index.html。

用法
  python3 test/make_splash_shots.py             # 只出图 + 更新清单
  python3 test/make_splash_shots.py --one 390   # 只渲染某一档宽度，快速看效果
"""
import os, re, subprocess, sys, glob, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'splash')
IDX = os.path.join(ROOT, 'index.html')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TPL = os.path.join(ROOT, '.splash-tpl.html')      # 临时文件，放工程根目录才能解析 assets/ 相对路径

# (CSS 宽, CSS 高, 设备像素比) —— 覆盖 iPhone 8/SE 到 16 Pro Max 的常见档位。
# 缺档位 = 那个机型开机白屏，所以宁可多配几档（纯色图很小，不心疼）。
SIZES = [
    (320, 568, 2),    # SE 1 代
    (375, 667, 2),    # 8 / SE 2 / SE 3
    (375, 812, 3),    # X / XS / 11 Pro / 12 mini / 13 mini
    (360, 780, 3),    # 12 mini / 13 mini（另一档）
    (390, 844, 3),    # 12 / 13 / 14 / 16e
    (393, 852, 3),    # 14 Pro / 15 / 15 Pro / 16
    (402, 874, 3),    # 16 Pro
    (414, 736, 3),    # 8 Plus
    (414, 896, 2),    # XR / 11
    (414, 896, 3),    # XS Max / 11 Pro Max
    (420, 912, 3),    # 12 Pro Max 的旧档
    (428, 926, 3),    # 12/13 Pro Max / 14 Plus
    (430, 932, 3),    # 14/15/16 Plus · 15/16 Pro Max
    (440, 956, 3),    # 16 Pro Max
]


def balanced(text, start):
    """从 start（'{' 或 '<!--' 的位置）取到配对的收尾，返回整段。"""
    if text.startswith('<!--', start):
        end = text.index('-->', start) + 3
        return text[start:end]
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    raise ValueError('括号不配对')


def extract():
    html = open(IDX, encoding='utf-8').read()

    def rule(pattern, from_pos=0):
        """取一整条 CSS 规则，**含选择器**。
        ⚠️ 曾经只从 '{' 开始截，结果抽出来的是裸的 `{...}`，选择器丢了 ——
           CSS 整段作废，--bg 变成未定义，截出来的图是纯白底。
           这种错还很隐蔽：图照样生成，只是不对。"""
        m = re.compile(pattern).search(html, from_pos)
        if not m:
            raise SystemExit('index.html 里找不到：' + pattern)
        brace = html.index('{', m.start())
        return html[m.start():brace] + balanced(html, brace)

    light = rule(r':root\s*\{')
    # 深色变量：第一个 @media (prefers-color-scheme: dark) 里的 :root
    dm = re.search(r'@media\s*\(prefers-color-scheme:\s*dark\)\s*\{', html)
    if not dm:
        raise SystemExit('找不到深色主题的 @media 块')
    inner = balanced(html, html.index('{', dm.start()))
    rm = re.search(r':root\s*\{', inner)
    dark = (inner[rm.start():inner.index('{', rm.start())]
            + balanced(inner, inner.index('{', rm.start()))) if rm else None

    faces, pos = [], 0
    while True:
        m = re.compile(r'@font-face\s*\{').search(html, pos)
        if not m:
            break
        brace = html.index('{', m.start())
        faces.append(html[m.start():brace] + balanced(html, brace))
        pos = brace + 1

    def marked(start_mark, end_mark):
        a = html.index(start_mark) + len(start_mark)
        b = html.index(end_mark, a)
        return html[a:b]

    splash_css = marked('/* ==== 开屏层 START ==== */', '/* ==== 开屏层 END ==== */')

    # 开屏的 DOM：从 <div id="splash" 起按 div 配对截取（注意不能用正则，里面是嵌套的）
    seg = marked('<!-- ==== 开屏层 START ==== -->', '<!-- ==== 开屏层 END ==== -->')
    d0 = seg.index('<div id="splash"')
    depth, i, out = 0, d0, None
    while i < len(seg):
        if seg.startswith('<div', i):
            depth += 1
        elif seg.startswith('</div>', i):
            depth -= 1
            if depth == 0:
                out = seg[d0:i + 6]
                break
        i += 1
    if not out:
        raise SystemExit('截不出开屏层的 div')

    return light, dark, faces, splash_css, out


def template(light, dark, faces, splash_css, markup, is_dark):
    """拼临时页面。浅色直接用；深色把深色变量追加在后面覆盖掉浅色。"""
    dark_override = dark if is_dark else ''
    return f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
html,body{{margin:0;padding:0;width:100%;height:100%;overflow:hidden}}
{light}
{chr(10).join(faces)}
{dark_override}
{splash_css}
/* 截的就是动画第 0 帧 —— 页面刚画出来那一帧 */
*{{animation-play-state:paused !important}}
</style></head><body>
{markup}
</body></html>'''


def shoot(w, h, dpr, dark):
    name = f'splash-{w * dpr}x{h * dpr}' + ('-dark' if dark else '') + '.png'
    dst = os.path.join(OUT, name)
    r = subprocess.run([
        CHROME, '--headless=old', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        f'--force-device-scale-factor={dpr}', f'--window-size={w},{h}',
        f'--screenshot={dst}', 'file://' + TPL,
    ], capture_output=True, text=True, timeout=90)
    if not os.path.exists(dst):
        raise SystemExit(f'{name} 没生成：\n{r.stderr[-400:]}')
    # 尺寸自检：Chrome 的 --screenshot 只截窗口大小，对不上说明参数没生效
    try:
        from PIL import Image
        im = Image.open(dst)
        got = im.size
        if got != (w * dpr, h * dpr):
            print(f'  ⚠️ {name} 实际 {got[0]}×{got[1]}，期望 {w * dpr}×{h * dpr}')
        # 瘦身：这张图 90% 面积是暖金晕的平滑渐变，PNG 压不动（单张 200KB 上下）。
        # 颜色本来就不多（米白 + 金 + 徽章的蓝白），降到 192 色体积减半，肉眼无差。
        im.convert('RGB').quantize(colors=192, method=Image.MEDIANCUT).save(dst, 'PNG', optimize=True)
    except ImportError:
        pass
    return name


def patch_head(names):
    """把清单写回 index.html 的标记之间。"""
    html = open(IDX, encoding='utf-8').read()
    a = html.index('<!-- ==== 开屏图清单 START ==== -->') + len('<!-- ==== 开屏图清单 START ==== -->')
    b = html.index('<!-- ==== 开屏图清单 END ==== -->')
    lines = []
    for w, h, dpr in SIZES:
        base = f'(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {dpr})'
        lines.append(f'<link rel="apple-touch-startup-image" media="{base}" href="assets/splash/splash-{w * dpr}x{h * dpr}.png">')
        lines.append(f'<link rel="apple-touch-startup-image" media="{base} and (prefers-color-scheme: dark)" '
                     f'href="assets/splash/splash-{w * dpr}x{h * dpr}-dark.png">')
    new = html[:a] + '\n' + '\n'.join(lines) + '\n' + html[b:]
    open(IDX, 'w', encoding='utf-8').write(new)
    return len(lines)


def main():
    only = None
    if '--one' in sys.argv:
        only = int(sys.argv[sys.argv.index('--one') + 1])

    os.makedirs(OUT, exist_ok=True)
    light, dark, faces, splash_css, markup = extract()

    made, stale = [], []
    for is_dark in (False, True):
        open(TPL, 'w', encoding='utf-8').write(
            template(light, dark, faces, splash_css, markup, is_dark))
        for w, h, dpr in SIZES:
            if only and w != only:
                continue
            n = shoot(w, h, dpr, is_dark)
            made.append(n)
            print(('  深色 ' if is_dark else '  浅色 ') + n)

    # 清掉不再需要的旧图（只在本目录、只匹配 splash-数字x数字 这个形状）。
    # ⚠️ --one 只是快速看效果，绝不能在那种模式下清理 —— 否则会把别的档全删掉。
    stale = []
    if not only:
        keep = set(made)
        for f in glob.glob(os.path.join(OUT, 'splash-*.png')):
            n = os.path.basename(f)
            if n not in keep:
                stale.append(n)
                try:
                    os.remove(f)
                except OSError as e:
                    print('  ⚠️ 删不掉旧图（沙箱可能拦了 unlink）：', n, e)

    if only:
        print(f'\n只渲染了宽度 {only} 这一档：{len(made)} 张')
    else:
        n = patch_head(made)
        print(f'\n共 {len(made)} 张启动图；index.html 清单已更新（{n} 个 link）')
    if stale:
        print('已清理旧图：', '、'.join(stale))
    if os.path.exists(TPL):
        os.remove(TPL)


if __name__ == '__main__':
    main()
