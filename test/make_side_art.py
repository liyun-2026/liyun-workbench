#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砺蕴 · 桌面侧栏「花鸟白描」素材生成器
────────────────────────────────────────────
把用户提供的花鸟/水墨图，转成「单色蒙版 PNG」（白 RGB + alpha），
CSS 侧作为 background-image 叠在端口深色栏面上，一张图五端通用。

两种提取方式：
  tone  —— 明度映射：纸底=0、浓墨=1。得到「淡墨水印」，体量感强但易糊成雾。
  line  —— 白描线：取「比局部平均更暗」的像素（高反差提取），
           只留画中的轮廓线（竹叶/羽毛/松针），大块墨色的内部被抹平 —— 这才是白描。
  mix   —— 线为主 + 少量暗部，兼顾线感与体量。

用法： python3 test/make_side_art.py
输出： test/.shots/sideart/*.png（预览用；定稿后再拷进 assets/ 并接入 index.html）
"""
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = "/Users/xielihui/Desktop"
OUT = os.path.join(ROOT, "test", ".shots", "sideart")
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("截屏2026-09-27 00.09.55.png", None, "zhushi"),   # 竹石花鸟 398x808
    ("截屏2026-09-27 00.09.39.png", None, "songhe"),    # 松鹤     330x818
    ("截屏2026-09-27 00.08.50.png", None, "lanhua"),    # 兰花     708x678
]

RAILS = {"teacher": "#5E3328", "admin": "#2C4A6E", "both": "#284A45",
         "student": "#2B5C4C", "super": "#5C4622"}


def _gray(im, med=3):
    g = im.convert("L")
    return g.filter(ImageFilter.MedianFilter(size=med)) if med else g


def tone_alpha(im, base_pct=95.0, gamma=1.45, floor=0.10, med=3):
    """明度映射：纸底=0，浓墨=1"""
    a = np.asarray(_gray(im, med)).astype(np.float32)
    base = float(np.percentile(a, base_pct))
    ink = float(np.percentile(a, 1.0))
    al = np.clip((base - a) / max(base - ink, 1.0), 0, 1) ** gamma
    al[al < floor] = 0.0
    return al


def line_alpha(im, radius=5, gain=1.9, mix=0.30, gamma=1.05, floor=0.10, med=3):
    """白描线：局部高反差 -> 只留线条；mix = 掺入暗部的比例"""
    a = np.asarray(_gray(im, med)).astype(np.float32)
    b = np.asarray(_gray(im, med).filter(ImageFilter.GaussianBlur(radius))).astype(np.float32)
    line = np.clip((b - a) * gain, 0, 255.0) / 255.0          # 比周围暗 -> 线
    if mix > 0:
        tone = np.clip((np.percentile(b, 93.0) - a) / 255.0 * 1.25, 0, 1)
        al = (1.0 - mix) * line + mix * tone
    else:
        al = line
    al = np.clip(al, 0, 1) ** gamma
    al[al < floor] = 0.0
    return al


def max_w(im, limit=460):
    if im.width <= limit:
        return im
    return im.resize((limit, int(round(im.height * limit / im.width))), Image.LANCZOS)


def save_mask(al, name, strength=0.8):
    a = np.clip(al * strength, 0, 1)
    h, w = a.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[..., 0:3] = 255
    out[..., 3] = np.clip(a * 255.0, 0, 255).astype(np.uint8)
    p = os.path.join(OUT, f"{name}.png")
    Image.fromarray(out, "RGBA").save(p, optimize=True)
    print(f"  {name:<16} {w}x{h}  {os.path.getsize(p)/1024:6.1f}KB  实心占比 {(a>0.35).mean()*100:5.1f}%")
    return p


def composite(al, rail_hex, w_css=236, h_css=900, bottom=True):
    """合成到端口底色上，模拟侧栏真实观感（供像素/肉眼核对）"""
    rr, gg, bb = (int(rail_hex[i:i + 2], 16) for i in (1, 3, 5))
    h, w = al.shape
    scale = w_css / w
    nh, nw = max(1, int(round(h * scale))), w_css
    m = Image.fromarray((np.clip(al, 0, 1) * 255).astype(np.uint8), "L").resize((nw, nh), Image.LANCZOS)
    wt = np.asarray(m).astype(np.float32)[..., None] / 255.0
    canvas = np.zeros((h_css, w_css, 3), np.float32)
    canvas[..., 0], canvas[..., 1], canvas[..., 2] = rr, gg, bb
    y0 = max(0, min(h_css - nh if bottom else (h_css - nh) // 2, h_css - nh))
    canvas[y0:y0 + nh] = canvas[y0:y0 + nh] * (1 - wt) + 255.0 * wt
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")


if __name__ == "__main__":
    print("== 花鸟白描素材 ==")
    for fn, crop, nm in JOBS:
        im = Image.open(os.path.join(SRC, fn)).convert("RGB")
        if crop:
            im = im.crop(crop)
        im = max_w(im)

        t = tone_alpha(im)
        l = line_alpha(im, radius=5, gain=1.9, mix=0.30)
        l2 = line_alpha(im, radius=7, gain=2.4, mix=0.15)   # 更纯的线

        save_mask(t,  f"{nm}_tone", strength=0.45)
        save_mask(l,  f"{nm}_line", strength=0.45)
        save_mask(l2, f"{nm}_pure", strength=0.50)
        save_mask(l2, f"{nm}_lite", strength=0.26)   # 更淡一档：几乎只剩气韵

        composite(l, RAILS["teacher"]).save(os.path.join(OUT, f"prev2_{nm}.png"))
    print("预览 ->", OUT)
