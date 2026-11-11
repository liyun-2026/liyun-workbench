#!/usr/bin/env bash
# 砺蕴教务系统 健康巡检脚本
# 用法: bash test/health_check.sh
# 退出码: 0=全部正常, 1=存在异常
#
# ==5.28== 当日打卡异常检查（主理人拍板的上线前整改五件套之一）：
#   规则：周一~周五 且 北京时间已过 12:00，查当日 sign:{日期} 记录数，为 0 则输出
#     ALERT 类型=当日打卡异常 原因=...
#   （简单规则不辨节假日/开学安排，报不报警由看的人自己判断。）
#   凭据：环境变量 LIYUN_HEALTH_TOKEN（教务类账号的登录令牌，action=pull 只读）。
#         未配置则跳过这项检查（输出 [跳过] 行，不告警也不失败）。
#   automation 消费口径：grep 'ALERT' 抓报警行，行内带「类型=」与「原因=」两个字段。
#   ALERT 只做业务提醒，不改变 OVERALL（服务本身活着与否仍由前面几项决定）。
#   DOMAIN 可用 LIYUN_HEALTH_DOMAIN 覆盖（dev 演练用）。
set -u

DOMAIN="${LIYUN_HEALTH_DOMAIN:-https://liyun2026.top}"
ok=1
out=()

# 首页: HTTP 状态 + 响应耗时 (耗时 >3s 警告, >8s 严重)
read -r code elapsed <<<"$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 "$DOMAIN")"
if [ "$code" = "200" ]; then
  if awk "BEGIN{exit !($elapsed > 8)}"; then
    ok=0
    out+=("[严重] 首页 HTTP=200 但响应耗时 ${elapsed}s (>8s, 通道卡顿)")
  elif awk "BEGIN{exit !($elapsed > 3)}"; then
    ok=0
    out+=("[警告] 首页响应耗时 ${elapsed}s (>3s)")
  else
    out+=("[正常] 首页 HTTP=200 耗时 ${elapsed}s")
  fi
else
  ok=0
  out+=("[严重] 首页 HTTP=$code (期望 200)")
fi

hello=$(curl -s --max-time 20 -w '\n%{time_total}' -X POST "$DOMAIN/api/sync" \
  -H 'content-type: application/json' -d '{"action":"hello"}')
hello_body="${hello%$'\n'*}"
hello_time="${hello##*$'\n'}"
if printf '%s' "$hello_body" | grep -q '"ok":true'; then
  out+=("[正常] 后端探活 hello 正常 耗时 ${hello_time}s")
else
  ok=0
  out+=("[严重] 后端探活 hello 异常: $hello_body")
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

# ── 当日打卡异常检查（==5.28==）──
DOW=$(TZ=Asia/Shanghai date +%u)            # 1=周一 … 7=周日
HM=$(TZ=Asia/Shanghai date +%H%M)
TODAY=$(TZ=Asia/Shanghai date +%F)
if [ "${LIYUN_HEALTH_TOKEN:-}" = "" ]; then
  out+=("[跳过] 当日打卡检查 原因=未配置 LIYUN_HEALTH_TOKEN")
elif [ "$DOW" -le 5 ] && [ "$HM" -ge 1200 ]; then
  sign_json=$(curl -s --max-time 20 -X POST "$DOMAIN/api/sync" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"pull\",\"token\":\"${LIYUN_HEALTH_TOKEN}\"}")
  nsign=$(printf '%s' "$sign_json" | TODAY="$TODAY" python3 -c '
import sys, json, os
try:
    d = json.load(sys.stdin)
    print(len((d.get("shared") or {}).get("sign:" + os.environ["TODAY"]) or []))
except Exception:
    print(-1)')
  if [ "$nsign" = "-1" ]; then
    out+=("[警告] 当日打卡检查失败 原因=pull 请求失败或返回异常（凭据可能过期）")
  elif [ "$nsign" = "0" ]; then
    out+=("ALERT 类型=当日打卡异常 原因=工作日已过12:00但当日($TODAY)无任何打卡记录")
  else
    out+=("[正常] 当日打卡 ${nsign} 人")
  fi
else
  out+=("[跳过] 当日打卡检查 原因=非工作日或未到北京时间12:00（周$DOW $HM）")
fi

printf '%s\n' "${out[@]}"
if [ "$ok" -eq 1 ]; then
  echo "OVERALL=OK"
  exit 0
else
  echo "OVERALL=FAIL"
  exit 1
fi
