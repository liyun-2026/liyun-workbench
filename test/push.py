#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验并写入单页：push.py <pptx> <slide文件> [page-index]
lint 不通过则中止并打印诊断，不写入。"""
import subprocess, sys, json, os

pptx, dsl = sys.argv[1], sys.argv[2]
idx = sys.argv[3] if len(sys.argv) > 3 else None
d = os.path.dirname(os.path.abspath(pptx))

r = subprocess.run(["slidep", "lint", os.path.basename(pptx), "--dsl-file", os.path.abspath(dsl)],
                   cwd=d, capture_output=True, text=True)
try:
    j = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    print("LINT 输出异常：", (r.stdout or "")[-400:], (r.stderr or "")[-400:])
    sys.exit(1)

if not j.get("ok"):
    print("❌ LINT 失败  " + os.path.basename(dsl))
    for x in j.get("diagnostics", []):
        msg = x["message"].replace("\n", " ")
        print("   · [%s] %s" % (x["ruleId"], msg[:420]))
    sys.exit(1)

cmd = ["slidep", "upsert-dsl", os.path.basename(pptx), "--dsl-file", os.path.abspath(dsl)]
if idx:
    cmd += ["--page-index", idx]
r = subprocess.run(cmd, cwd=d, capture_output=True, text=True)
try:
    j = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    print("写入输出异常：", (r.stdout or "")[-400:], (r.stderr or "")[-400:])
    sys.exit(1)

if j.get("failures"):
    print("⚠️  写入有失败项：", j["failures"])
    sys.exit(1)
print("✅ %s  →  第 %s 页" % (os.path.basename(dsl), j.get("newPageId", "?")))
