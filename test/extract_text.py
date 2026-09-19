#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按页提取 pptx 中的所有文字，用于与 DSL 源码对比找出用户改动。
用法：python3 extract_text.py <pptx>
"""
import sys, zipfile, re
from xml.etree import ElementTree as ET

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "p": "http://schemas.openxmlformats.org/presentationml/2006/main"}


def slide_key(name):
    m = re.search(r"slide(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


def para_text(p):
    return "".join(t.text or "" for t in p.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}t"))


def main():
    z = zipfile.ZipFile(sys.argv[1])
    names = [n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)]
    for n in sorted(names, key=slide_key):
        root = ET.fromstring(z.read(n))
        idx = slide_key(n)
        print("=" * 78)
        print("### Slide %02d" % idx)
        print("=" * 78)
        for sp in root.iter("{http://schemas.openxmlformats.org/presentationml/2006/main}sp"):
            lines = [para_text(p) for p in sp.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}p")]
            lines = [l for l in lines if l.strip()]
            if lines:
                for l in lines:
                    print(l)


if __name__ == "__main__":
    main()
