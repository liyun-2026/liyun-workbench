#!/bin/bash
# 双击我 → 启动砺蕴工作台的本机预览（带后台），并自动打开浏览器。
# 数据存在 test/.preview-data.json，关掉这个窗口、重启电脑都还在。
cd "$(dirname "$0")" || exit 1

# 优先用系统里的 node；没有就用 WorkBuddy 装的那份
NODE_BIN="$(command -v node 2>/dev/null)"
[ -z "$NODE_BIN" ] && NODE_BIN="/Users/xielihui/.workbuddy/binaries/node/versions/22.22.2-3/bin/node"
PORT=5173

# 已经在跑就直接打开浏览器，别重复起（端口会冲突）
if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
  open "http://127.0.0.1:$PORT"
  echo "预览本来就在跑，已帮你打开浏览器。"
  sleep 2
  exit 0
fi

echo "正在启动砺蕴工作台…"
"$NODE_BIN" test/dev-server.mjs "$PORT" &
SERVER_PID=$!

# 等它真的起来再开浏览器（最多 10 秒）——
# 早开一秒就是一个空白页，人只会以为坏了
for _ in $(seq 1 20); do
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/" && break
  sleep 0.5
done
open "http://127.0.0.1:$PORT"
echo ""
echo "已打开浏览器：http://127.0.0.1:$PORT"
echo "· 第一次用：填个用户名（汉字也行）+ 密码（8 位以上），你就是首位教务"
echo "· 忘了密码、或想从头来：登录页底下有「重置本地数据」"
echo "· 数据存在本机，关掉这个窗口、重启电脑都还在"
echo "· 关掉这个黑窗口就是关闭预览"
wait $SERVER_PID
