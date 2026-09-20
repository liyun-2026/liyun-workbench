#!/usr/bin/env python3
"""把手册用的界面截图从 test/.shots/ppt/ 加工进「使用手册/assets/」。

为什么要有这个脚本
------------------
手册（PPT 27 页 + 长图）里的每一张界面图，都来自 `test/capture_shots.mjs`
拍下的 2 倍图。以前这一步是靠手工裁的，结果就是：
  · 换一次门头，手册里几十张图全成了旧图，却没人知道哪些要重做；
  · 有的图裁错位（曾经出现过内容只占 6.4% 的残次品）。
所以映射关系固化成这张表，重拍之后一条命令就能把手册素材全部刷新。

用法
----
    python3 test/make_ppt_assets.py <手册目录>
    # 例：python3 test/make_ppt_assets.py ~/Desktop/砺蕴教务系统/砺蕴工作系统-使用手册

前置：先跑 `node test/capture_shots.mjs` 与 `node test/paiike_check.mjs`，
      把 .shots/ppt/ 与 .shots/ 下的原图刷新。
"""
import os
import sys

from PIL import Image

SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.shots')

# ══════════════════════════════════════════════════════════════════
# 映射表：源图 → 手册素材名
#   kind = 'page'  整页（2880×1800 @2x）→ 1440×900
#   kind = 'phone' 整页（840×1880 @2x）→ 286×640（长图与 PPT 里的小手机框）
#   kind = 'crop'  按 (x0, y0, x1, y1) 裁（像素坐标，@2x）后再缩到目标尺寸
# ══════════════════════════════════════════════════════════════════
PAGE = [
    ('01-home.png', 'pg_home.png'),
    ('02-att.png', 'pg_att.png'),
    ('03-homework.png', 'pg_homework.png'),
    ('04-roster.png', 'pg_roster.png'),
    ('05-weekend.png', 'pg_weekend.png'),
    ('06-profile.png', 'pg_profile.png'),
    ('07-timetable.png', 'pg_timetable.png'),
    ('08-night.png', 'pg_night.png'),
    ('09-quant.png', 'pg_quant.png'),
    ('10-exam.png', 'pg_exam.png'),
    ('11-coop.png', 'pg_coop.png'),
    ('12-teachers.png', 'pg_teachers.png'),
    ('14-settings.png', 'pg_settings.png'),
    ('t1-today.png', 'tc_today.png'),
    ('t2-record.png', 'tc_record.png'),
    ('t3-myclass.png', 'tc_myclass.png'),
    ('t4-tickets.png', 'tc_tickets.png'),
]

PHONE = [
    ('m1-home.png', 'm_home.png'),
    ('m2-att.png', 'm_att.png'),
    ('m3-quant.png', 'm_quant.png'),
    ('m4-drawer.png', 'm_drawer.png'),
    ('m5-record.png', 'm_record.png'),
]

# 局部裁切。尺寸必须是版式里那个框的真实尺寸 ——
#   sys_login_clean 用在 PPT 第 05 页 700×367 的横幅（也是长图里的登录块）
#   dlg_role_clean  用在 PPT 第 16 页 996,166 处 256×251 的小窗
CROP = [
    # 上下留白要对等：内容在 168~1614（@2x），所以上留 28 / 下留 36，别把门脚切掉
    ('g2-gate.png', 'sys_login_clean.png', (0, 140, 2880, 1650), (1440, 755)),
    # 长图「三步上手 · 01 打开」那张是 422×137 的横幅，而且写着 object-fit:cover ——
    # 拿 1.907 的整页图去填 3.08 的框，cover 会把上下各裁掉近四成，**正好把徽章裁没**，
    # 而徽章正是这一版的主角。所以单独裁一条只含「徽章 → 砺蕴工作系统」的横幅给它。
    ('g2-gate.png', 'sys_login_band.png', (140, 136, 2740, 980), (422, 137)),
    ('13-role-picker.png', 'dlg_role_clean.png', (970, 438, 1910, 1362), (521, 511)),
]

# 排课台两张来自 paiike_check.mjs（不是 capture_shots），单独列
FROM_CHECK = [
    (os.path.join(SHOTS, 'paike_1_panel.png'), 'pg_paike.png'),
    (os.path.join(SHOTS, 'paike_2_grid.png'), 'pg_paike_grid.png'),
]


def main():
    out = os.path.join(sys.argv[1], 'assets') if len(sys.argv) > 1 else 'assets'
    os.makedirs(out, exist_ok=True)
    n = 0

    for src, dst in PAGE:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        assert im.size == (2880, 1800), f'{src} 尺寸不是 2880×1800，采集脚本可能变了：{im.size}'
        im.resize((1440, 900), Image.LANCZOS).save(os.path.join(out, dst))
        print(f'  ✔ {dst:24s} 1440×900   ← {src}')
        n += 1

    for src, dst in PHONE:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        assert im.size == (840, 1880), f'{src} 尺寸不是 840×1880：{im.size}'
        im.resize((286, 640), Image.LANCZOS).save(os.path.join(out, dst))
        print(f'  ✔ {dst:24s}  286×640   ← {src}')
        n += 1

    for src, dst, box, size in CROP:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        w, h = size
        got = (box[2] - box[0], box[3] - box[1])
        assert abs(got[0] / got[1] - w / h) < 0.01, \
            f'{dst} 裁切框比例 {got[0]/got[1]:.3f} 与目标 {w/h:.3f} 不符，会被拉变形'
        im.crop(box).resize((w, h), Image.LANCZOS).save(os.path.join(out, dst))
        print(f'  ✔ {dst:24s} {w}×{h}   ← {src} 裁 {box}')
        n += 1

    for src, dst in FROM_CHECK:
        if not os.path.exists(src):
            print(f'  ⚠ 跳过 {dst}：{src} 不存在，先跑 node test/paiike_check.mjs')
            continue
        im = Image.open(src).convert('RGB')
        assert im.size == (1440, 900), f'{src} 尺寸不是 1440×900：{im.size}'
        im.save(os.path.join(out, dst))
        print(f'  ✔ {dst:24s} 1440×900   ← {os.path.basename(src)}')
        n += 1

    print(f'\n共刷新 {n} 张 → {out}')


if __name__ == '__main__':
    main()
