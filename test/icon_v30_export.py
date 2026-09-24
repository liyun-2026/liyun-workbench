#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v30 定稿：出 512 正式单图 + 总览页用的 base64 内嵌。"""
import sys, os, base64, io
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REVIEW = os.path.join(ROOT, '预览')
sys.path.insert(0, HERE)

from icon_v30 import A, B, C, render, SHAPES

PICKS = [('A', 'B', '博艺蓝', '徽章的同一个蓝 —— 一套视觉'),
         ('A', 'D', '深空蓝', '近黑的蓝，屏幕感最强'),
         ('C', 'B', '博艺蓝', '中轴贯穿 ＋ 长撇'),
         ('B', 'B', '博艺蓝', '框底穿出（徽章那一招）')]


def main():
    emb = {}
    for i, (si, tag, name, note) in enumerate(PICKS):
        fn = dict((n.split()[0], f) for n, f in SHAPES)[si]
        for s in (512, 180, 120):
            im = render(s, fn, tag)
            p = os.path.join(REVIEW, 'v30_%s_%s_%d.png' % (si, tag, s))
            im.save(p)
        buf = io.BytesIO()
        render(300, fn, tag).save(buf, 'PNG')
        emb[i] = base64.b64encode(buf.getvalue()).decode()
        print('出图 %s · %s' % (si, name))
    with open(os.path.join(REVIEW, '.v30_emb.py'), 'w') as f:
        f.write('EMB = ' + repr(emb) + '\n')
    print('base64 已存')


if __name__ == '__main__':
    main()
