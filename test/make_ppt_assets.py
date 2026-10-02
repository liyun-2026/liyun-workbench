#!/usr/bin/env python3
"""把手册用的界面截图从 test/.shots/ppt/ 加工进「使用手册/assets/」。

为什么要有这个脚本
------------------
手册里的每一张界面图，都来自 `test/capture_shots.mjs` 拍下的 2 倍图。
以前这一步是靠手工裁的，结果就是：
  · 换一次门头，手册里几十张图全成了旧图，却没人知道哪些要重做；
  · 有的图裁错位（曾经出现过内容只占 6.4% 的残次品）。
所以映射关系固化成这张表，重拍之后一条命令就能把手册素材全部刷新。

v54 起多做一件事
----------------
产出时把**每一张图的真实像素尺寸**写进 `assets/_sizes.json`。
构建脚本（build_three_manuals.mjs）读它来算图片框 —— 版式里不再手写宽高，
也就不可能再出现「框的比例和图的比例不一致 → 图被拉变形」这种毛病。

用法
----
    python3 test/make_ppt_assets.py <手册目录>
    # 例：python3 test/make_ppt_assets.py ~/Desktop/砺蕴教务系统/砺蕴工作系统-使用手册

前置：先跑 `node test/capture_shots.mjs` 与 `node test/paiike_check.mjs`，
      把 .shots/ppt/ 与 .shots/ 下的原图刷新。
"""
import json
import os
import sys

from PIL import Image

SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.shots')

# ══════════════════════════════════════════════════════════════════
# 映射表：源图 → 手册素材名
#   kind = 'page'   整页（2880×1800 @2x）→ 1440×900
#   kind = 'phone'  整页（840×1880 @2x）→ 286×640（长图与 PPT 里的小手机框）
#   kind = 'region' 按元素裁出来的一块（尺寸不定）→ 等比缩到宽 ≤1440
#   kind = 'crop'   按 (x0, y0, x1, y1) 裁（像素坐标，@2x）后再缩到目标尺寸
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
    ('pg_students.png', 'pg_students.png'),
    ('pg_health.png', 'pg_health.png'),
    # 学生端（电脑）
    ('stu_home.png', 'stu_home.png'),
    ('stu_sign.png', 'stu_sign.png'),
    ('stu_sign_pending.png', 'stu_sign_pending.png'),
    ('stu_leave.png', 'stu_leave.png'),
    ('stu_news.png', 'stu_news.png'),
    ('stu_gather.png', 'stu_gather.png'),
    ('stu_table.png', 'stu_table.png'),
    ('stu_exam.png', 'stu_exam.png'),
    ('stu_quant.png', 'stu_quant.png'),
    ('stu_profile.png', 'stu_profile.png'),
    ('stu_hw.png', 'stu_hw.png'),
    ('stu_settings.png', 'stu_settings.png'),
    # 授课老师手册补图
    ('tc_today_news.png', 'tc_today_news.png'),
    # 开屏 / 登录门（手册直接引用）
    ('g1-splash.png', 'g1-splash.png'),
    ('g2-gate.png', 'g2-gate.png'),
    # ── 教务老师端（v54：改用「教务老师」身份单独拍的一整套） ──
    ('jw_home.png',      'jw_home.png'),
    ('jw_att.png',       'jw_att.png'),
    ('jw_sign.png',      'jw_sign.png'),
    ('jw_homework.png',  'jw_homework.png'),
    ('jw_roster.png',    'jw_roster.png'),
    ('jw_students.png',  'jw_students.png'),
    ('jw_profile.png',   'jw_profile.png'),
    ('jw_timetable.png', 'jw_timetable.png'),
    ('jw_night.png',     'jw_night.png'),
    ('jw_quant.png',     'jw_quant.png'),
    ('jw_exam.png',      'jw_exam.png'),
    ('jw_coop.png',      'jw_coop.png'),
    ('jw_gather.png',    'jw_gather.png'),
    ('jw_settings.png',  'jw_settings.png'),
    ('jw_rules.png',     'jw_rules.png'),
    ('jw_board.png',     'jw_board.png'),
]

PHONE = [
    ('m1-home.png', 'm_home.png'),
    ('m2-att.png', 'm_att.png'),
    ('m3-quant.png', 'm_quant.png'),
    ('m4-drawer.png', 'm_drawer.png'),
    ('m5-record.png', 'm_record.png'),
    # 授课老师手机端
    ('js_today.png', 'js_today.png'),
    ('js_record.png', 'js_record.png'),
    ('js_myclass.png', 'js_myclass.png'),
    ('js_tickets.png', 'js_tickets.png'),
    ('js_profile.png', 'js_profile.png'),
    ('js_drawer.png', 'js_drawer.png'),
    # 学生端手机
    ('stum_home.png', 'stum_home.png'),
    ('stum_sign.png', 'stum_sign.png'),
    ('stum_news.png', 'stum_news.png'),
    ('stum_table.png', 'stum_table.png'),
    ('stum_quant.png', 'stum_quant.png'),
]

# 按元素裁出来的一块。尺寸由元素本身决定，这里只规定「最长边压到多少」——
# 桌面图不要超过 1440 宽，再大 slidep 渲染会花屏（老坑）。
REGION_MAX_W = 1440
REGION = [
    ('jw_att_leave.png',      'jw_att_leave.png'),
    ('jw_att_slot.png',       'jw_att_slot.png'),
    ('jw_sign_code.png',      'jw_sign_code.png'),
    ('jw_sign_rules.png',     'jw_sign_rules.png'),
    ('jw_sign_key.png',       'jw_sign_key.png'),
    ('jw_sign_row_far.png',   'jw_sign_row_far.png'),
    ('jw_sign_row_off.png',   'jw_sign_row_off.png'),
    ('jw_hk.png',             'jw_hk.png'),
    ('jw_roster_off.png',     'jw_roster_off.png'),
    ('jw_quant_btns.png',     'jw_quant_btns.png'),
    ('jw_quant_row.png',      'jw_quant_row.png'),
    ('jw_exam_draw.png',      'jw_exam_draw.png'),
    ('jw_exam_ai.png',        'jw_exam_ai.png'),
    ('jw_coop_stumsg.png',    'jw_coop_stumsg.png'),
    ('jw_set_acct.png',       'jw_set_acct.png'),
    ('jw_set_backup.png',     'jw_set_backup.png'),
    ('jw_set_slot.png',       'jw_set_slot.png'),
    ('jw_set_devkey.png',     'jw_set_devkey.png'),
    ('stu_sign_key.png',      'stu_sign_key.png'),
]

# 局部裁切。尺寸必须是版式里那个框的真实尺寸 ——
#   sys_login_clean 用在 PPT 横幅（也是长图里的登录块）
#   dlg_role_clean  用在老师管理页的小窗
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
    sizes = {}   # 产出名 → [宽, 高]，给构建脚本算图片框用

    def save(im, dst):
        nonlocal n
        im.save(os.path.join(out, dst))
        sizes[dst] = [im.width, im.height]
        n += 1

    for src, dst in PAGE:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        assert im.size == (2880, 1800), f'{src} 尺寸不是 2880×1800，采集脚本可能变了：{im.size}'
        im = im.resize((1440, 900), Image.LANCZOS)
        save(im, dst)
        print(f'  ✔ {dst:26s} {im.width}×{im.height}   ← {src}')

    for src, dst in PHONE:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        assert im.size == (840, 1880), f'{src} 尺寸不是 840×1880：{im.size}'
        im = im.resize((286, 640), Image.LANCZOS)
        save(im, dst)
        print(f'  ✔ {dst:26s} {im.width}×{im.height}   ← {src}')

    for src, dst in REGION:
        p = os.path.join(SHOTS, 'ppt', src)
        if not os.path.exists(p):
            print(f'  ⚠ 跳过 {dst}：{src} 不存在，先跑 node test/capture_shots.mjs')
            continue
        im = Image.open(p).convert('RGB')
        if im.width > REGION_MAX_W:
            h = round(im.height * REGION_MAX_W / im.width)
            im = im.resize((REGION_MAX_W, h), Image.LANCZOS)
        save(im, dst)
        print(f'  ✔ {dst:26s} {im.width}×{im.height}   ← {src} (比例 {im.width/im.height:.2f})')

    for src, dst, box, size in CROP:
        p = os.path.join(SHOTS, 'ppt', src)
        im = Image.open(p).convert('RGB')
        w, h = size
        got = (box[2] - box[0], box[3] - box[1])
        assert abs(got[0] / got[1] - w / h) < 0.01, \
            f'{dst} 裁切框比例 {got[0]/got[1]:.3f} 与目标 {w/h:.3f} 不符，会被拉变形'
        im = im.crop(box).resize((w, h), Image.LANCZOS)
        save(im, dst)
        print(f'  ✔ {dst:26s} {w}×{h}   ← {src} 裁 {box}')

    for src, dst in FROM_CHECK:
        if not os.path.exists(src):
            print(f'  ⚠ 跳过 {dst}：{src} 不存在，先跑 node test/paiike_check.mjs')
            continue
        im = Image.open(src).convert('RGB')
        assert im.size == (1440, 900), f'{src} 尺寸不是 1440×900：{im.size}'
        save(im, dst)
        print(f'  ✔ {dst:26s} {im.width}×{im.height}   ← {os.path.basename(src)}')

    # 品牌素材本来就在 assets 里，没经过这里加工 —— 也一并登记，构建脚本才能统一查表
    for f in ('brand_fused.png', 'brand_fused_sq.png'):
        fp = os.path.join(out, f)
        if os.path.exists(fp) and f not in sizes:
            with Image.open(fp) as im:
                sizes[f] = [im.width, im.height]

    with open(os.path.join(out, '_sizes.json'), 'w', encoding='utf-8') as fh:
        json.dump(sizes, fh, ensure_ascii=False, indent=1, sort_keys=True)

    print(f'\n共刷新 {n} 张 → {out}')
    print(f'尺寸表 {len(sizes)} 条 → {os.path.join(out, "_sizes.json")}')


if __name__ == '__main__':
    main()
