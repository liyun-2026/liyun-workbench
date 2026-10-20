#!/usr/bin/env python3
"""「课时统计·阶段一」四张验收图的像素级核对（不依赖读图通道）。

    python3 test/check_hours_stage1_v2.py

核对点：
  · 尺寸、文件大小、墨点占比（证明不是空白/半张）；
  · B / C 里的**黄色块**（低置信度 #FBF1C6）数量与坐标范围
    → 用来证明「只有几格是黄的，不是全表黄」；
  · B 里非黄行（白底）也数一遍，进一步说明「部分黄、部分不黄」；
  · D 里同时出现金色(#C9AB7C 系)与朱砂红(#B23A2E 系) → 说明左右栏差异画上了。
"""
import os
import numpy as np
from PIL import Image

D = 'test/.shots/plan-keshitongji/stage1'
B_YELLOW = (251, 241, 198)   # --hrs-low 浅色 #FBF1C6
B_PAPER = (251, 248, 241)    # 页面米白（近似）
GOLD = (201, 171, 124)       # #C9AB7C
RED = (178, 58, 46)          # #B23A2E


def near(arr, rgb, tol):
    return ((np.abs(arr[:, :, 0].astype(int) - rgb[0]) <= tol) &
            (np.abs(arr[:, :, 1].astype(int) - rgb[1]) <= tol) &
            (np.abs(arr[:, :, 2].astype(int) - rgb[2]) <= tol))


def ink_ratio(arr):
    lum = arr.mean(axis=2)
    return float((lum < 225).mean())


def bands_of(mask, axis_gap=8):
    """把 mask 的「有命中行」聚成连续条带，返回 [(y0,y1,px)]。"""
    rows = np.where(mask.any(axis=1))[0]
    if not len(rows):
        return []
    out, seg = [], [rows[0]]
    for r in rows[1:]:
        if r - seg[-1] <= axis_gap:
            seg.append(r)
        else:
            out.append((seg[0], seg[-1])); seg = [r]
    out.append((seg[0], seg[-1]))
    return [(a, b, int(mask[a:b + 1].sum())) for a, b in out]


def report(f, extra=lambda a, W, H: None):
    p = os.path.join(D, f)
    im = Image.open(p).convert('RGB')
    a = np.array(im)
    H, W = a.shape[:2]
    print(f'\n== {f} ==')
    print(f'  尺寸 {W}×{H}   文件 {os.path.getsize(p)/1024:.0f}KB')
    print(f'  墨点占比 {ink_ratio(a):.3%}   不同颜色数 {len(np.unique(a.reshape(-1,3), axis=0))}')
    extra(a, W, H)


def yellow_check(a, W, H):
    ym = near(a, B_YELLOW, 6)
    n = int(ym.sum())
    print(f'  黄色(#FBF1C6±6) 像素 {n}  占图 {n/(W*H):.2%}')
    bs = bands_of(ym)
    print(f'  黄色横向条带 {len(bs)} 条：' + ', '.join(f'y{a0}-{b0}({(b0-a0+1)//2}css,{px}px)' for a0, b0, px in bs))
    # 非黄「内容行」也数一遍：白底上的表格行
    # 判据：某一行里白色像素很多、且不是纸张底 —— 用「接近纯白」近似
    wm = near(a, (255, 255, 255), 3)
    wb = bands_of(wm)
    print(f'  近纯白（表格单元格/卡片）横向条带 {len(wb)} 条')


for f in ['A_课时统计页_初始态.png', 'B_识别结果_预览表.png', 'C_手机端390.png']:
    report(f, yellow_check if f.startswith(('B', 'C')) else (lambda a, W, H: None))


def d_check(a, W, H):
    g = int(near(a, GOLD, 24).sum())
    r = int(near(a, RED, 26).sum())
    print(f'  金色(#C9AB7C±24) {g} px   朱砂红(#B23A2E±26) {r} px')
    print(f'  左右栏各色都出现：{"是" if (g > 500 and r > 200) else "否"}')


report('D_两条识别通路对比.png', d_check)
