#!/usr/bin/env python3
"""三张验收图的像素级核对（不依赖读图通道）。"""
import os
import numpy as np
from PIL import Image

D = 'test/.shots/plan-keshitongji/stage1'
YELLOW = (251, 241, 198)   # --hrs-low 浅色：低置信度行底色 #FBF1C6
FILES = ['A_课时统计页_初始态.png', 'B_识别结果_预览表.png', 'C_手机端390.png']


def near(arr, rgb, tol):
    return (np.abs(arr[:, :, 0].astype(int) - rgb[0]) <= tol) & \
           (np.abs(arr[:, :, 1].astype(int) - rgb[1]) <= tol) & \
           (np.abs(arr[:, :, 2].astype(int) - rgb[2]) <= tol)


def ink_ratio(arr):
    # 「有墨」= 明显偏离页面米白底(#FBF8F1 附近)的像素
    lum = arr.mean(axis=2)
    return float((lum < 225).mean())


for f in FILES:
    p = os.path.join(D, f)
    im = Image.open(p).convert('RGB')
    a = np.array(im)
    H, W = a.shape[:2]
    print(f'\n== {f} ==')
    print(f'  尺寸 {W}×{H}  文件 {os.path.getsize(p)/1024:.0f}KB')
    print(f'  墨点占比 {ink_ratio(a):.3%}')
    # 是否整张纯色（空白）
    uniq = len(np.unique(a.reshape(-1, 3), axis=0))
    print(f'  不同颜色数 {uniq}')

    ym = near(a, YELLOW, 6)
    n = int(ym.sum())
    print(f'  黄色(#FBF1C6±6) 像素 {n}')
    if n:
        ys, xs = np.where(ym)
        print(f'  黄色区域 x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}] 占图 {n/(W*H):.2%}')
        rows = np.where(ym.any(axis=1))[0]
        # 数「黄行带」：连续段
        bands = 1
        for i in range(1, len(rows)):
            if rows[i] - rows[i - 1] > 8:
                bands += 1
        print(f'  黄色横向条带数 ≈ {bands}（每条带 ≈ 一行黄底）')
        # 每带高度
        seg, segs = [rows[0]], []
        for i in range(1, len(rows)):
            if rows[i] - seg[-1] <= 8:
                seg.append(rows[i])
            else:
                segs.append((seg[0], seg[-1])); seg = [rows[i]]
        segs.append((seg[0], seg[-1]))
        print('  条带 y 区间：' + ', '.join(f'{a0}-{b0}({b0-a0+1}px)' for a0, b0 in segs))
