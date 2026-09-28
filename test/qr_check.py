#!/usr/bin/env python3
"""二维码自检 —— 验的是 index.html 里**真正上线的那份**编码器（从标记区里抠出来跑）。

两重取证，缺一不可：
  ① 逐格比对：Python `qrcode` 库（主流参考实现）在 8 种掩码下逐格一致。
  ② 真解码：把矩阵渲染成图，交给 OpenCV 的 QRCodeDetector 读 —— 必须读回原文。
     自己画的矩阵「看着像二维码」不算数，得真解码器认。

跑法：/Users/xielihui/.workbuddy/binaries/python/envs/default/bin/python3 test/qr_check.py
（脚本会自己找带 OpenCV / qrcode 的解释器，直接 python3 跑也行）
"""
import json
import os
import re
import subprocess
import sys

# 依赖（cv2 / qrcode）在托管 venv 里；用别的解释器跑就自己换成 venv 的
try:
    import cv2
    import numpy as np
    import qrcode as _qr
    import qrcode.util as _qru
except ImportError:
    VENV = os.path.expanduser("~/.workbuddy/binaries/python/envs/default/bin/python3")
    if os.path.exists(VENV) and sys.executable != VENV:
        os.execv(VENV, [VENV, os.path.abspath(__file__)] + sys.argv[1:])
    sys.exit("缺 cv2 / qrcode —— 先 pip install opencv-python-headless qrcode")

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "..", "index.html")
NODE = os.path.expanduser("~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node")

START, END = "/* QR-ENCODER-START */", "/* QR-ENCODER-END */"

CASES = [
    "https://liyun2026.top/?code=379220",                # 真身：版本 3
    "https://liyun2026.top/?code=000000",
    "https://liyun2026.top/?code=999999",
    "A",                                                  # 版本 1
    "https://a.cn/?code=123456",                          # 版本 2
    "https://liyun2026.top/?code=123456&v=123456789",     # 版本 4
]

pass_n = fail_n = 0


def ok(msg):
    global pass_n
    pass_n += 1
    print(f"  \033[32m✓\033[0m {msg}")


def bad(msg):
    global fail_n
    fail_n += 1
    print(f"  \033[31m✗\033[0m {msg}")


# ── 从 index.html 抠出编码器（验的就是这份上线代码，不是另抄一份） ──
src = open(INDEX, encoding="utf-8").read()
i, j = src.find(START), src.find(END)
if i < 0 or j < 0:
    sys.exit(f"index.html 里找不到 {START} / {END} 标记 —— 编码器得放在标记区内")
block = src[i + len(START):j]
print(f"从 index.html 抠出编码器 {len(block)} 字节\n")

driver = (
    block
    + "\nconst CASES = " + json.dumps(CASES) + ";\n"
    + "const out = CASES.map(t => { const perMask = {};"
      " for (let m = 0; m < 8; m++) perMask[m] = QRLib.encode(t, m).modules;"
      " const b = QRLib.encode(t);"
      " return { text: t, version: b.version, autoMask: b.mask, size: b.size, perMask }; });\n"
    + "console.log(JSON.stringify(out));\n"
)
tmp = "/tmp/_qrdump.js"
open(tmp, "w", encoding="utf-8").write(driver)
cases = json.loads(subprocess.run([NODE, tmp], capture_output=True, text=True, check=True).stdout)


def to_img(modules, scale=8, quiet=4):
    n = len(modules)
    dim = (n + quiet * 2) * scale
    img = np.full((dim, dim), 255, np.uint8)
    for y in range(n):
        for x in range(n):
            if modules[y][x]:
                img[(y + quiet) * scale:(y + quiet + 1) * scale,
                    (x + quiet) * scale:(x + quiet + 1) * scale] = 0
    return img


print("=== ① 逐格比对 Python qrcode 库（8 种掩码 × 6 个用例）===")
for c in cases:
    text, ver, size = c["text"], c["version"], c["size"]
    bad_masks = []
    for mk in range(8):
        q = _qr.QRCode(version=ver, error_correction=_qr.constants.ERROR_CORRECT_M,
                       mask_pattern=mk, border=0)
        q.add_data(_qru.QRData(text.encode(), mode=_qru.MODE_8BIT_BYTE))
        q.make(fit=False)
        ref = np.array([[1 if v else 0 for v in row] for row in q.modules], dtype=np.uint8)
        mine = np.array(c["perMask"][str(mk)], dtype=np.uint8)
        if mine.shape != ref.shape:
            bad_masks.append(f"mask{mk}:尺寸 {mine.shape}≠{ref.shape}")
        elif not np.array_equal(mine, ref):
            bad_masks.append(f"mask{mk}:{int((mine != ref).sum())} 格不一致")
    if bad_masks:
        bad(f"「{text[:40]}」v{ver} — " + "；".join(bad_masks[:3]))
    else:
        ok(f"「{text[:40]}」v{ver}（{size}×{size}）8 种掩码逐格一致")

print("\n=== ② OpenCV 真解码（自动选掩码，就是手机上扫的那条路）===")
for c in cases:
    img = to_img(c["perMask"][str(c["autoMask"])])
    got, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    if got == c["text"]:
        ok(f"读回原文（掩码 {c['autoMask']}）：{got[:44]}")
    else:
        bad(f"读出来是「{got}」，期望「{c['text']}」")

print("\n=== ③ 缩放与静默区鲁棒性（看板上是等比缩放的）===")
c = cases[0]
for scale, quiet, why in ((3, 4, "小屏缩到很小时"), (6, 4, ""), (12, 4, "高清大屏"),
                          (8, 0, "⚠️没有静默区"), (8, 2, "静默区偏窄")):
    img = to_img(c["perMask"][str(c["autoMask"])], scale=scale, quiet=quiet)
    got, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    if got == c["text"]:
        ok(f"scale={scale} quiet={quiet} → 读到原文 {why}")
    elif quiet < 4:
        print(f"  \033[33m·\033[0m scale={scale} quiet={quiet} → 读不到（静默区不足 4 格会失效，"
              f"所以 SVG 必须自带 4 格白边）")
    else:
        bad(f"scale={scale} quiet={quiet} → 读不到")

print("\n" + "=" * 52)
print(f"通过 {pass_n} / 失败 {fail_n}")
sys.exit(1 if fail_n else 0)
