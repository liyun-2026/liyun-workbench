#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全量重建演示文稿：按 slides/*.slide 的文件名顺序清空重建。
用法：rebuild.py <手册目录> <pptx文件名>"""
import subprocess, sys, os, glob, json

d = os.path.abspath(sys.argv[1])
pptx = sys.argv[2]
path = os.path.join(d, pptx)

files = sorted(glob.glob(os.path.join(d, "slides", "*.slide")))
if not files:
    sys.exit("没有找到任何 slide 文件")

if os.path.exists(path):
    os.remove(path)
r = subprocess.run(["slidep", "create", pptx], cwd=d, capture_output=True, text=True)
if not r.stdout.strip().endswith("}"):
    print("create 失败：", r.stdout[-300:], r.stderr[-300:])
    sys.exit(1)

ok, bad = [], []
for f in files:
    name = os.path.basename(f)
    r = subprocess.run(["slidep", "lint", pptx, "--dsl-file", f], cwd=d, capture_output=True, text=True)
    try:
        j = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        bad.append((name, ["lint 输出无法解析"]))
        continue
    if not j.get("ok"):
        bad.append((name, ["[%s] %s" % (x["ruleId"], x["message"].replace("\n", " ")[:300])
                           for x in j.get("diagnostics", [])]))
        continue
    r = subprocess.run(["slidep", "upsert-dsl", pptx, "--dsl-file", f], cwd=d, capture_output=True, text=True)
    try:
        j = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        bad.append((name, ["写入输出无法解析"]))
        continue
    if j.get("failures"):
        bad.append((name, ["写入失败：" + str(j["failures"])]))
        continue
    ok.append(name)

print("✅ 成功 %d 页：%s" % (len(ok), " ".join(x.replace(".slide", "") for x in ok)))
if bad:
    print("\n❌ 失败 %d 页：" % len(bad))
    for name, msgs in bad:
        print("  " + name)
        for m in msgs:
            print("     · " + m)
    sys.exit(2)
print("\n📄 成品：%s（%d 页）" % (path, len(ok)))
