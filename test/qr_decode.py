#!/usr/bin/env python3
"""把一张图里的二维码读出来（OpenCV 真解码器）。

给 test/board_check.mjs 用：把看板上那块二维码**按屏幕上的实际像素**截下来，
交给真解码器读，读到的必须正是这一秒显示的那条链接 —— 自己画的矩阵
「看着像二维码」不算数。

用法：qr_decode.py <png>
  成功 → stdout 输出读到的文本，退出码 0
  读不到 → stdout 空，退出码 1
"""
import os
import sys

try:
    import cv2
except ImportError:                      # 依赖装在托管 venv 里，别的解释器自己换过去
    VENV = os.path.expanduser("~/.workbuddy/binaries/python/envs/default/bin/python3")
    if os.path.exists(VENV) and sys.executable != VENV:
        os.execv(VENV, [VENV, os.path.abspath(__file__)] + sys.argv[1:])
    sys.exit("缺 opencv —— pip install opencv-python-headless")

img = cv2.imread(sys.argv[1])
if img is None:
    sys.exit("读不到图：" + sys.argv[1])

det = cv2.QRCodeDetector()
text = ""
# 先按原图读（最忠实于屏幕像素），读不到再放大三倍试一次（检测器对小图挑食）
for cand in (img, cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)):
    text, _, _ = det.detectAndDecode(cand)
    if text:
        break

sys.stdout.write(text)
sys.exit(0 if text else 1)
