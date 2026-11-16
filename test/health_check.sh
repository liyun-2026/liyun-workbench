#!/usr/bin/env bash
# 砺蕴教务系统 健康巡检脚本
# 用法: bash test/health_check.sh
# 退出码: 0=OVERALL OK, 1=OVERALL FAIL
#
# ==5.38== 巡检关注点重塑（主理人 2026-11-15 拍板）——
#   ① 全部「提示化」，永不过红：域名到期、首页慢（CDN 已知因素）、后端慢一律
#      [正常]/[提示]。唯一例外 = SSL 剩 ≤10 天（自动续期失败的兜底）与「服务不可用」。
#   ② 删「当日打卡人数/无打卡」检查（==5.28== 那套退役）：集训期主理人自己每天看，
#      巡检不报这个，连提示都去掉。
#   ③ 新增「打卡通道探针」（本轮核心）：监控高峰期会不会卡顿/打不上卡。
#      手段 = 预期拒绝探测 —— 用巡检学生账号提交一枚必然错误的动态码，
#      服务端在写任何数据之前就把它拒掉（sync.js doSignInner：codeCheck →
#      BADCODE 400 直接 return，org/data 零写入）。拿到结构化拒绝 =
#      打卡通道活着、逻辑正常、耗时可信，且**绝不污染真实打卡数据**（绝不真打卡）。
#   ④ OVERALL 语义（最终口径）：FAIL 只有三条 ——
#      服务不可用（首页非200/hello异常/标题或解析异常）/ 打卡高峰探针失败 / SSL 剩≤10天。
#      探针在非高峰期的任何问题（慢、失败、超时）一律只 [提示]。
#   ⑤ 高峰窗口：配置文件 ~/Desktop/砺蕴教务系统/.health-config.json（可选），
#      格式 {"peakWindows": ["11:30-13:30","17:30-19:00"]}；当前时刻落在窗口内时
#      探针措辞加「高峰期」前缀，探针失败（含凭据失效导致探针跑不成）→ [严重]+FAIL+ALERT。
#      凭据：.health-credentials.json 可选键 stu_user / stu_pass（专用巡检学生账号：
#      在名册给「巡检学员」档案单独建一个学生号，别用真人学员的号）。
#      未配置 → 探针 [跳过]（汇报里说明配置方法）。
#   ⑥ 延迟趋势留痕：每轮把 首页/后端/探针 耗时追加到
#      ~/Desktop/砺蕴教务系统/.health-history.jsonl（一行一个 JSON：t/homeMs/helloMs/
#      probeMs/peak），超过 5000 行自动裁掉最旧的，供简报做趋势对比。
#   DOMAIN 可用 LIYUN_HEALTH_DOMAIN 覆盖（dev 演练 / 故障注入测试用）。
#   automation 消费口径不变：grep 'ALERT' 抓报警行，行内带「类型=」与「原因=」。
set -u

DOMAIN="${LIYUN_HEALTH_DOMAIN:-https://liyun2026.top}"
# ⚠️ BSD sed 不认 \?（GNU 语法），用 bash 参数展开剥协议与路径 —— 之前 sed 方案把 HOST 截成了 "https"
HOST="${DOMAIN#*//}"; HOST="${HOST%%[:/]*}"
DATA_DIR="$HOME/Desktop/砺蕴教务系统"
CRED_FILE="$DATA_DIR/.health-credentials.json"
CONFIG_FILE="$DATA_DIR/.health-config.json"
HIST_FILE="$DATA_DIR/.health-history.jsonl"
ok=1
out=()

# ── 高峰窗口判定：读可选配置，当前北京时间落在任一窗口内 → PEAK=1 ──
PEAK=0; PEAK_WIN=""
if [ -f "$CONFIG_FILE" ]; then
  PEAK_RES=$(HC_CONFIG="$CONFIG_FILE" python3 -c '
import json, os
try:
    wins = json.load(open(os.environ["HC_CONFIG"])).get("peakWindows") or []
    import datetime
    now = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%H:%M")
    for w in wins:
        a, b = str(w).split("-")
        if a <= now <= b or (a > b and (now >= a or now <= b)):   # 支持跨零点窗口
            print(w); break
except Exception:
    pass' 2>/dev/null)
  if [ -n "$PEAK_RES" ]; then PEAK=1; PEAK_WIN="$PEAK_RES"; fi
fi
peak_tag=""; [ "$PEAK" = "1" ] && peak_tag="高峰期 · "

# 首页: HTTP 状态 + 响应耗时（200 即判活；慢=已知 CDN 因素，只提示，永不影响 OVERALL）
read -r code home_elapsed <<<"$(curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 "$DOMAIN")"
if [ "$code" = "200" ]; then
  if awk "BEGIN{exit !($home_elapsed > 10)}"; then
    out+=("[提示] 首页 HTTP=200 但响应耗时 ${home_elapsed}s（>10s，已知 CDN 出口带宽因素，服务正常）")
  elif awk "BEGIN{exit !($home_elapsed > 3)}"; then
    out+=("[正常] 首页 HTTP=200 耗时 ${home_elapsed}s（>3s 为已知 CDN 因素，不影响判活）")
  else
    out+=("[正常] 首页 HTTP=200 耗时 ${home_elapsed}s")
  fi
else
  ok=0
  out+=("[严重] 首页 HTTP=$code (期望 200)——服务不可用")
fi

hello=$(curl -s --max-time 20 -w '\n%{time_total}' -X POST "$DOMAIN/api/sync" \
  -H 'content-type: application/json' -d '{"action":"hello"}')
hello_body="${hello%$'\n'*}"
hello_time="${hello##*$'\n'}"
if printf '%s' "$hello_body" | grep -q '"ok":true'; then
  if awk "BEGIN{exit !($hello_time > 3)}"; then
    out+=("[提示] 后端探活 hello 正常但耗时 ${hello_time}s（>3s，服务正常）")
  else
    out+=("[正常] 后端探活 hello 正常 耗时 ${hello_time}s")
  fi
else
  ok=0
  out+=("[严重] 后端探活 hello 异常: ${hello_body}——服务不可用")
fi

# SSL 证书剩余天数：EdgeOne 免费证书到期前 15 天自动续期；剩 ≤10 天还没换新才报警
# （唯一一处「业务项可以过红」：自动续期失败的人工兜底）
cert_days=$(echo | openssl s_client -connect "${HOST}:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 | xargs -I{} sh -c 'echo $(( ( $(date -j -f "%b %d %H:%M:%S %Y %Z" "{}" "+%s" 2>/dev/null || date -d "{}" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))')
if [ -n "$cert_days" ] && [ "$cert_days" != "0" ]; then
  if [ "$cert_days" -le 10 ]; then
    ok=0
    out+=("[严重] SSL 证书仅剩 ${cert_days} 天到期且平台未自动续期——请按 docs/ssl-renew-guide.md 手动申请免费证书")
  elif [ "$cert_days" -le 20 ]; then
    out+=("[提示] SSL 证书剩 ${cert_days} 天（平台应在此期间自动续期，若越过 10 天线将报警）")
  else
    out+=("[正常] SSL 证书剩 ${cert_days} 天")
  fi
else
  out+=("[提示] SSL 证书有效期探测失败（不影响判活）")
fi

title=$(curl -s --max-time 20 "$DOMAIN" | grep -o '<title>[^<]*</title>')
if printf '%s' "$title" | grep -q '砺蕴2026'; then
  out+=("[正常] 标题标记存在")
else
  ok=0
  out+=("[严重] 标题标记异常: ${title}——服务不可用")
fi

# CNAME：IP 字面量（dev 演练直连）没有 DNS 可查，跳过
if printf '%s' "$HOST" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  out+=("[跳过] CNAME 解析检查（IP 直连演练模式）")
else
  cname=$(dig +short "$HOST" 2>/dev/null)
  if [ -n "$cname" ]; then
    out+=("[正常] CNAME 解析存在")
  else
    ok=0
    out+=("[严重] CNAME 解析失败——服务不可用")
  fi
fi

# ── 打卡通道探针（==5.38== 本轮核心，零数据写入的预期拒绝探测）──
# 流程：stu_user/stu_pass login 换令牌 → action=sign 提交 code=000000（必然错）
#   → 服务端应回 BADCODE 结构化拒绝（400）且 org/data 零写入。
#   登录 + 提交两步总耗时 = 探针耗时。
# 判定（OVERALL 只认「打卡高峰探针失败」这一条新指标）：
#   BADCODE/EXPIRED     = 探针成功；≤2s [正常]、2~5s [提示]、>5s 视同失败；
#   凭据登录失败(AUTH)  = 巡检账号过期 → 非高峰 [提示]，高峰 [严重] FAIL+ALERT（巡检瞎了）；
#   请求失败/超时/异常  → 非高峰 [提示]，高峰 [严重] FAIL+ALERT。
PROBE_RES=$(HC_DOMAIN="$DOMAIN" HC_CRED="$CRED_FILE" python3 -c '
import json, os, time, urllib.request, urllib.error

def post(body, timeout=15):
    t0 = time.time()
    req = urllib.request.Request(os.environ["HC_DOMAIN"] + "/api/sync",
                                 data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, json.loads(r.read().decode() or "{}"), (time.time() - t0) * 1000
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode() or "{}")
        except Exception: body = {}
        return e.code, body, (time.time() - t0) * 1000
    except Exception as e:
        return 0, {"error": str(e)}, (time.time() - t0) * 1000

out = {"ok": False, "auth": False, "ms": 0, "code": "", "err": ""}
try:
    d = json.load(open(os.environ["HC_CRED"]))
    su, sp = d.get("stu_user"), d.get("stu_pass")
    if not su or not sp:
        out["err"] = "NO_STU_CRED"
        print(json.dumps(out)); raise SystemExit
except Exception:
    out["err"] = "NO_STU_CRED"
    print(json.dumps(out)); raise SystemExit

s1, j1, t1 = post({"action": "login", "user": su, "pass": sp})
tok = (j1 or {}).get("token", "")
if not tok:
    # 网络层失败（连不上/超时）≠ 凭据失效 —— 标 net 走「探针失败」路径，别让高峰期误判成运维问题
    if s1 == 0:
        out["net"] = True; out["err"] = (j1 or {}).get("error", "连接失败"); out["ms"] = round(t1)
        print(json.dumps(out)); raise SystemExit
    out["auth"] = True; out["err"] = (j1 or {}).get("error", f"HTTP {s1}"); out["ms"] = round(t1)
    print(json.dumps(out)); raise SystemExit
# 凭据防呆：stu_user 必须是学生号（有 studentId）——配错成教务号的话，
# sign 会 403「不是学生」，那是凭据问题不是通道问题，别让高峰期误报服务故障
p1 = (j1 or {}).get("profile") or {}
if p1.get("role") != "student" or not p1.get("studentId"):
    out["auth"] = True; out["err"] = "stu_user 不是学生号（凭据配错了，改回学生号）"; out["ms"] = round(t1)
    print(json.dumps(out)); raise SystemExit

s2, j2, t2 = post({"action": "sign", "token": tok, "code": "000000",
                   "dev": "health-probe", "lat": 0.0, "lng": 0.0})
out["ms"] = round(t1 + t2)
out["code"] = (j2 or {}).get("code", "")
out["err"] = (j2 or {}).get("error", f"HTTP {s2}")
out["ok"] = out["code"] in ("BADCODE", "EXPIRED")   # 结构化拒绝 = 通道活着且零写入
print(json.dumps(out))' 2>/dev/null)

PROBE_KIND=""; PROBE_MS=""; PROBE_NOTE=""
if [ -n "$PROBE_RES" ]; then
  PROBE_KIND=$(printf '%s' "$PROBE_RES" | HC_PR="$PROBE_RES" python3 -c '
import sys, json, os
d = json.loads(os.environ["HC_PR"])
if d.get("err") == "NO_STU_CRED": print("skip")
elif d.get("net"): print("fail")
elif d.get("auth"): print("auth")
elif d.get("ok"): print("ok")
else: print("fail")' 2>/dev/null)
  PROBE_MS=$(printf '%s' "$PROBE_RES" | HC_PR="$PROBE_RES" python3 -c 'import sys,os,json;print(json.loads(os.environ["HC_PR"]).get("ms",0))' 2>/dev/null)
  PROBE_NOTE=$(printf '%s' "$PROBE_RES" | HC_PR="$PROBE_RES" python3 -c 'import sys,os,json;print(json.loads(os.environ["HC_PR"]).get("err","") or "")' 2>/dev/null)
fi

case "$PROBE_KIND" in
  skip)
    PROBE_MS=""    # 探针没跑，history 里 probeMs 记 null
    out+=("[跳过] 打卡通道探针 原因=凭据文件没有 stu_user/stu_pass（专用巡检学生账号）——配法：名册给「巡检学员」档案单独建一个学生号，再把账号密码写进 ${CRED_FILE} 的 stu_user/stu_pass 两个键")
    ;;
  ok)
    if awk "BEGIN{exit !($PROBE_MS > 5000)}"; then
      if [ "$PEAK" = "1" ]; then ok=0
        out+=("[严重] ${peak_tag}打卡通道探针耗时 ${PROBE_MS}ms（>5s）——高峰期打不上卡，立即处理")
        out+=("ALERT 类型=打卡高峰探针失败 原因=探针耗时 ${PROBE_MS}ms 超过 5 秒（高峰窗口 ${PEAK_WIN}）")
      else
        out+=("[提示] 打卡通道探针耗时 ${PROBE_MS}ms（>5s，通道通但慢）")
      fi
    elif awk "BEGIN{exit !($PROBE_MS > 2000)}"; then
      out+=("[提示] ${peak_tag}打卡通道探针耗时 ${PROBE_MS}ms（2~5s，偏慢）")
    else
      out+=("[正常] ${peak_tag}打卡通道探针 ${PROBE_MS}ms（错误码预期拒绝，零数据写入）")
    fi
    ;;
  auth)
    if [ "$PEAK" = "1" ]; then ok=0
      out+=("[严重] ${peak_tag}打卡通道探针失败：巡检学生账号登录过期（${PROBE_NOTE}）——高峰期巡检是瞎的，立即更新 ${CRED_FILE}")
      out+=("ALERT 类型=打卡高峰探针失败 原因=巡检学生账号凭据失效，高峰期（${PEAK_WIN}）无法探测打卡通道")
    else
      out+=("[提示] 打卡通道探针跳过：巡检学生账号登录过期（${PROBE_NOTE}）——更新 ${CRED_FILE} 里的 stu_pass")
    fi
    ;;
  fail)
    if [ "$PEAK" = "1" ]; then ok=0
      out+=("[严重] ${peak_tag}打卡通道探针失败（${PROBE_NOTE:-无响应}，${PROBE_MS}ms）——高峰期打卡可能打不上，立即处理")
      out+=("ALERT 类型=打卡高峰探针失败 原因=探针请求失败/超时（高峰窗口 ${PEAK_WIN}，${PROBE_MS}ms）")
    else
      out+=("[提示] 打卡通道探针失败（${PROBE_NOTE:-无响应}，${PROBE_MS}ms，非高峰期只提示）")
    fi
    ;;
  *)
    out+=("[提示] 打卡通道探针输出异常（不影响判活）")
    ;;
esac

# ── 延迟趋势留痕：一行一个 JSON，>5000 行裁掉最旧的 ──
HC_HIST="$HIST_FILE" HC_HOME="$home_elapsed" HC_HELLO="$hello_time" \
HC_PROBE="$PROBE_MS" HC_PEAK="$PEAK" python3 -c '
import json, os
try:
    rec = {"t": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
           "homeMs": round(float(os.environ["HC_HOME"]) * 1000),
           "helloMs": round(float(os.environ["HC_HELLO"]) * 1000),
           "probeMs": int(os.environ["HC_PROBE"]) if os.environ["HC_PROBE"] else None,
           "peak": os.environ["HC_PEAK"] == "1"}
    p = os.environ["HC_HIST"]
    lines = []
    if os.path.exists(p):
        with open(p) as f: lines = [l for l in f.read().splitlines() if l.strip()]
    lines.append(json.dumps(rec, ensure_ascii=False))
    if len(lines) > 5000: lines = lines[-5000:]
    with open(p, "w") as f: f.write("\n".join(lines) + "\n")
except Exception:
    pass' 2>/dev/null

printf '%s\n' "${out[@]}"
if [ "$ok" -eq 1 ]; then
  echo "OVERALL=OK"
  exit 0
else
  echo "OVERALL=FAIL"
  exit 1
fi
