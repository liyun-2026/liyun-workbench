#!/usr/bin/env bash
# 砺蕴教务系统 健康巡检脚本
# 用法: bash test/health_check.sh
# 退出码: 0=全部正常, 1=存在异常
set -u

DOMAIN="https://liyun2026.top"
ok=1
out=()

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$DOMAIN")
if [ "$code" = "200" ]; then
  out+=("[正常] 首页 HTTP=200")
else
  ok=0
  out+=("[严重] 首页 HTTP=$code (期望 200)")
fi

hello=$(curl -s --max-time 20 -X POST "$DOMAIN/api/sync" \
  -H 'content-type: application/json' -d '{"action":"hello"}')
if printf '%s' "$hello" | grep -q '"ok":true'; then
  out+=("[正常] 后端探活 hello 正常")
else
  ok=0
  out+=("[严重] 后端探活 hello 异常: $hello")
fi

title=$(curl -s --max-time 20 "$DOMAIN" | grep -o '<title>[^<]*</title>')
if printf '%s' "$title" | grep -q '砺蕴2026'; then
  out+=("[正常] 标题标记存在")
else
  ok=0
  out+=("[警告] 标题标记异常: $title")
fi

cname=$(dig +short liyun2026.top 2>/dev/null)
if [ -n "$cname" ]; then
  out+=("[正常] CNAME 解析存在")
else
  ok=0
  out+=("[严重] CNAME 解析失败")
fi

printf '%s\n' "${out[@]}"
if [ "$ok" -eq 1 ]; then
  echo "OVERALL=OK"
  exit 0
else
  echo "OVERALL=FAIL"
  exit 1
fi
