"""
扫一扫取景窗：把浏览器「假摄像头」那块绿屏换成真实的二维码画面。

为什么需要这一步：
  无头 Chrome 没有真的摄像头，getUserMedia 拿到的是 Chrome 内建的假视频源 ——
  一整块深绿 + 一个时间码 + 一个绿三角。直接放进手册很难看，也没信息量。
  真实的取景窗里应该是「学生对着那块屏，框里是屏幕上的二维码」。

做什么：
  ① 按 crop_cards.py 的框裁出取景窗那一块；
  ② 把深绿色像素（video 的内容）整块换成暖米色 —— 相当于「摄像头对着的那面墙/桌面」；
  ③ 在金色取景框内居中贴一枚真实二维码（直接从看板实拍里抠的那枚），
     白托盘一起带过来，看着就是屏幕上显示的样子；
  ④ 金色四角框是 DOM 元素，像素本来就在图上，替换时按颜色排除，原样保留。

  python test/fix_scan_shot.py
输出：test/.shots/stutut/crops/m-sign-scan__取景窗.png
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'test', '.shots', 'stutut')
CROPS = os.path.join(SHOTS, 'crops')

BOX = (26, 888, 814, 1652)          # 与 crop_cards.py 里的手工框保持一致
WALL = (239, 231, 214)              # 取景窗里的「背景」——暖米色，跟看板宣纸同族

src = Image.open(os.path.join(SHOTS, 'm-sign-scan.png')).convert('RGB').crop(BOX)
a = np.array(src).astype(np.int16)
H, W = a.shape[:2]

# ── ① 找金色取景框（#C9AB7C 一系）────────────────────
gold = ((abs(a[:, :, 0] - 201) < 32) & (abs(a[:, :, 1] - 171) < 32)
        & (abs(a[:, :, 2] - 124) < 38))
gold[:60, :] = False                      # 顶部那排按钮里也有相近色，排除掉
gy, gx = np.where(gold)
assert len(gx) > 200, '没找到金色取景框，取景窗布局变了？'
fx0, fx1, fy0, fy1 = gx.min(), gx.max(), gy.min(), gy.max()
print('金色取景框  x %d..%d  y %d..%d' % (fx0, fx1, fy0, fy1))

# ── ② 深绿像素（假摄像头画面）换成米色 ────────────────
green = ((a[:, :, 1] > a[:, :, 0] + 22) & (a[:, :, 1] > a[:, :, 2] + 22)
         & (a[:, :, 1] > 70))
band = np.zeros((H, W), bool)
band[55:, :] = True                       # 上边界以下才算取景区（上面是按钮）
green &= band
green[:, :30] = False
green[:, W - 30:] = False
print('替换深绿像素 %d 个（占全图 %.1f%%）' % (green.sum(), 100.0 * green.sum() / (H * W)))
a[green] = WALL

# ── ③ 框内居中贴一枚真二维码 ──────────────────────────
qr = Image.open(os.path.join(CROPS, 'board__二维码.png')).convert('RGB')
pad = int(min(fx1 - fx0, fy1 - fy0) * 0.10)
bw, bh = (fx1 - fx0) - 2 * pad, (fy1 - fy0) - 2 * pad
k = min(bw / qr.size[0], bh / qr.size[1])
qr2 = qr.resize((max(1, int(qr.size[0] * k)), max(1, int(qr.size[1] * k))), Image.LANCZOS)
qx = fx0 + pad + (bw - qr2.size[0]) // 2
qy = fy0 + pad + (bh - qr2.size[1]) // 2
out = Image.fromarray(a.astype(np.uint8))
out.paste(qr2, (qx, qy))
print('二维码贴到 (%d,%d) 尺寸 %s' % (qx, qy, qr2.size))

stamp = out.save(os.path.join(CROPS, 'm-sign-scan__取景窗.png'))
print('✅ 已重写 m-sign-scan__取景窗.png', out.size)
