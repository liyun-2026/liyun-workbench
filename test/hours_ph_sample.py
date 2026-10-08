#!/usr/bin/env python3
"""采样 placeholder 文字原色并算 WCAG 对比度（配合 test/hours_ph_contrast_check.mjs）。

    python3 test/hours_ph_sample.py <manifest.json>

manifest 由 mjs 生成：每条含 {skin, scheme, file, geo:{low,plain,lowBg,...}, dsf}。
对每张截图的「黄底行输入框」与「普通行输入框」区域：
  · 背景色 = 该区域里出现最多的颜色；
  · 文字原色 = 相对背景对比度最高的那个像素色（即字形实心部分，避开抗锯齿边缘）；
  · 输出两行对比度，黄底那行必须 ≥ 4.5:1。
"""
import json
import sys
from collections import Counter

from PIL import Image


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    r, g, b = rgb[:3]
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def hexs(rgb):
    return "#%02X%02X%02X" % (rgb[0], rgb[1], rgb[2])


def sample(img, rect, dsf, inset=1):
    x = int(round(rect["x"] * dsf)) + inset
    y = int(round(rect["y"] * dsf)) + inset
    w = int(round(rect["w"] * dsf)) - inset * 2
    h = int(round(rect["h"] * dsf)) - inset * 2
    w = max(1, w); h = max(1, h)
    crop = img.crop((x, y, x + w, y + h)).convert("RGB")
    data = crop.tobytes()
    px = [ (data[i], data[i+1], data[i+2]) for i in range(0, len(data), 3) ]
    bg = Counter(px).most_common(1)[0][0]
    # 只看明显偏离背景的像素，取其中对比度最高的那个当「文字原色」
    best, best_c = bg, 1.0
    for c in px:
        r = contrast(c, bg)
        if r > best_c:
            best, best_c = c, r
    return bg, best, best_c


def parse_rgb(s):
    s = (s or "").strip()
    if s.startswith("rgb"):
        nums = [int(float(x)) for x in s[s.find("(") + 1:s.find(")")].split(",")[:3]]
        return tuple(nums)
    return None


def main():
    manifest = json.load(open(sys.argv[1], encoding="utf-8"))
    rows = []
    fails = 0
    artifacts = 0
    print("\n%-14s %-7s %-22s %-8s %-22s %-8s" % ("皮肤", "深浅", "黄底 bg / ph", "黄底比值", "普通 bg / ph", "普通比值"))
    print("-" * 96)
    for r in manifest:
        img = Image.open(r["file"])
        dsf = r["dsf"]
        lbg, lfg, lc = sample(img, r["geo"]["low"], dsf)
        pbg, pfg, pc = sample(img, r["geo"]["plain"], dsf)
        calc = parse_rgb(r["geo"].get("lowBgAfter") or r["geo"].get("lowBg"))
        drift = max(abs(lbg[i] - calc[i]) for i in range(3)) if calc else 0
        artifact = drift > 3          # 采样背景与计算背景对不上 → 抓在了动画中途，数字不可信
        ok = lc >= 4.5 and not artifact
        if artifact:
            artifacts += 1
        if not ok:
            fails += 1
        rows.append({"skin": r["skin"], "cls": r["cls"], "scheme": r["scheme"],
                     "low_bg": hexs(lbg), "low_ph": hexs(lfg), "low_ratio": round(lc, 2),
                     "low_bg_declared": hexs(calc) if calc else "", "bg_drift": drift,
                     "plain_bg": hexs(pbg), "plain_ph": hexs(pfg), "plain_ratio": round(pc, 2),
                     "ok": ok, "artifact": artifact, "declared_text_dim": r["geo"].get("ph", "")})
        print("%-14s %-7s %-22s %-8s %-22s %-8s %s" % (
            r["skin"], r["scheme"],
            "%s / %s" % (hexs(lbg), hexs(lfg)), "%.2f:1" % lc,
            "%s / %s" % (hexs(pbg), hexs(pfg)), "%.2f:1" % pc,
            ("⚠️ 抓在动画中途(bg 漂移 %d)" % drift) if artifact else ("✅" if ok else "❌")))
    print("-" * 96)
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    if fails:
        print("\n❌ 有 %d 个组合不合格（其中 %d 个是截图被动画污染，需重跑）" % (fails, artifacts))
        return 1
    print("\n✅ 黄底 placeholder 全部 ≥ 4.5:1（共 %d 个组合）" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
