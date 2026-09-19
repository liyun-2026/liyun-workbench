#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""元素抽检：在渲染图的指定坐标采样颜色，验证 logo / 文字是否真的渲染出来。
用法：python3 test/probe.py <渲染目录>
"""
import sys, os
import numpy as np
from PIL import Image

d = sys.argv[1]
S = 1.5   # 渲染倍率（1280x720 -> 1920x1080）

# (页, 画布x, 画布y, 半径, 期望, 说明)
CHECKS = [
    ("p01", 158, 146, 26, "亮",  "封面·博艺徽章中心（应见白色圆盘）"),
    ("p01", 226, 343, 30, "金",  "封面·砺蕴行书字标（应为金色）"),
    ("p01", 272, 440, 60, "亮",  "封面·主标题「砺蕴工作系统」（应为米白）"),
    ("p01", 110, 648, 12, "金",  "封面·砺蕴圆盘页脚（应为金色）"),
    ("p02", 1049, 509, 60, "淡金", "目录·圆盘水印（应有极淡金色）"),
    ("p02",  230, 84, 18, "金",  "目录·标题旁圆盘（应为金色）"),
    ("p03", 500, 430, 150, "杂",  "P03·主截图区域（应有界面内容）"),
    ("p06",  140, 200, 40, "金",  "扉页I·编号 Ⅰ（应为金色大字）"),
    ("p22", 163, 320, 40, "杂",   "P22·第一张手机截图（应有界面内容）"),
    ("p24", 128, 92, 26, "亮",   "宣传页·博艺徽章（应为白色圆盘）"),
    ("p25", 166, 166, 30, "亮",  "结语·大徽章（应为白色圆盘）"),
    ("p25", 180, 361, 30, "金",  "结语·砺蕴字标（应为金色）"),
    ("p25", 342, 442, 70, "亮",  "结语·大字「把课上好…」（应为米白）"),
]


def sample(a, x, y, r):
    h, w = a.shape[:2]
    X, Y, R = int(x * S), int(y * S), int(r * S)
    blk = a[max(0, Y - R):Y + R, max(0, X - R):X + R]
    if blk.size == 0:
        return None
    flat = blk.reshape(-1, 3).astype(int)
    # 取最亮和最暗两类像素，便于判断
    lum = 0.299 * flat[:, 0] + 0.587 * flat[:, 1] + 0.114 * flat[:, 2]
    bright = flat[lum > np.percentile(lum, 92)]
    mean = flat.mean(axis=0).round(0).astype(int)
    return mean, bright.mean(axis=0).round(0).astype(int), flat.std(axis=0).mean()


print("%-5s %-30s %-18s %s" % ("页", "检查点", "均值RGB / 亮部RGB", "判定"))
print("-" * 96)
for page, x, y, r, want, label in CHECKS:
    p = os.path.join(d, page + ".png")
    if not os.path.exists(p):
        print("%-5s %-30s 缺文件" % (page, label))
        continue
    a = np.array(Image.open(p).convert("RGB"))
    res = sample(a, x, y, r)
    if res is None:
        print("%-5s %-30s 采样越界" % (page, label))
        continue
    mean, bright, sd = res
    m, b = mean.tolist(), bright.tolist()
    r_, g_, bl_ = b
    verdict = "?"
    if want == "亮":
        verdict = "✅ 有高亮" if r_ > 180 and g_ > 180 else "⚠️ 未见高亮"
    elif want == "金":
        verdict = "✅ 金色" if r_ > 110 and r_ - bl_ > 20 else "⚠️ 非金色 · 检查配色"
    elif want == "淡金":
        verdict = "✅ 淡金水印" if (r_ - bl_) > 6 else "⚠️ 水印不可见"
    elif want == "杂":
        verdict = "✅ 有内容" if sd > 12 else "⚠️ 区域过平"
    print("%-5s %-30s %-18s %s" % (page, label, "%s / %s" % (m, b), verdict))
