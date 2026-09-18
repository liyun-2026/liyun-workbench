#!/bin/bash
# 双击我 → 启动砺蕴工作台的本机预览（带后台），并自动打开浏览器。
# 数据存在内存里，关掉这个黑窗口 = 关掉预览，数据清空。
cd "$(dirname "$0")" || exit 1

# 优先用系统里的 node；没有就用 WorkBuddy 装的那份
NODE_BIN="$(command -v node 2>/dev/null)"
[ -z "$NODE_BIN" ] && NODE_BIN="/Users/xielihui/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"

# 已经在跑就直接打开浏览器，别重复起（端口会冲突）
if curl -s -o /dev/null -m 2 "http://127.0.0.1:5173/"; then
  open "http://127.0.0.1:5173"
  echo "预览本来就在跑，已帮你打开浏览器。"
  sleep 2
  exit 0
fi

echo "正在启动砺蕴工作台（本机预览）…"
"$NODE_BIN" test/dev-server.mjs 5173 &
SERVER_PID=$!
sleep 1.5
open "http://127.0.0.1:5173"
echo ""
echo "已打开浏览器：http://127.0.0.1:5173"
echo "· 登录随便填（汉字用户名也行），第一个账号自动成为「首位教务」"
echo "· 关掉这个窗口就是关闭预览"
wait $SERVER_PID
