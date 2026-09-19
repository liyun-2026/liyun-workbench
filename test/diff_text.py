#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""对比传入 pptx 的当前文字与 slides/*.slide 源码里的文字，找出用户改动。
用法：python3 diff_text.py <pptx文本> <slides目录>
"""
import sys, re, os


def load_pptx(path):
    pages, cur = {}, None
    for line in open(path, encoding="utf-8"):
        m = re.match(r"### Slide (\d+)", line)
        if m:
            cur = int(m.group(1))
            pages[cur] = []
        elif line.startswith("=") or not line.strip():
            continue
        elif cur:
            pages[cur].append(line.rstrip("\n"))
    return pages


def load_dsl(d):
    pages = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith(".slide"):
            continue
        n = int(re.match(r"(\d+)", f).group(1))
        txt = open(os.path.join(d, f), encoding="utf-8").read()
        items = re.findall(r"<Text[^>]*>([^<]*)</Text>", txt)
        pages[n] = [x for x in items if x.strip()]
    return pages


def main():
    now, src = load_pptx(sys.argv[1]), load_dsl(sys.argv[2])
    total = 0
    for n in sorted(set(now) | set(src)):
        a, b = now.get(n, []), src.get(n, [])
        if a == b:
            continue
        total += 1
        print("=" * 74)
        print("### 第 %02d 页" % n)
        print("=" * 74)
        print("  【PPT 当前】")
        for x in a:
            print("   ", x)
        print("  【源码原版】")
        for x in b:
            print("   ", x)
        # 逐条差异
        sa, sb = set(a), set(b)
        gone = [x for x in b if x not in sa]
        added = [x for x in a if x not in sb]
        if gone:
            print("  ❌ 被删/改：")
            for x in gone:
                print("     ", x)
        if added:
            print("  ✅ 新增/改为：")
            for x in added:
                print("     ", x)
        print()
    print("共 %d 页有差异" % total)


if __name__ == "__main__":
    main()
