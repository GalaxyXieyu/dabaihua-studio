#!/bin/bash
# 公众号采集登录态看门狗（每 30 分钟由 launchd 触发）
# 逻辑：登录有效且距过期>24h → 静默退出；否则把二维码推到清流阅读网页横幅
#       （管理员登录后自动弹出），飞书只发一条文字提醒不发图。
#       等扫码确认后自动完成续期。每天最多发起 5 轮防轰炸。
export MOORE_WECHAT_EXPORTER_SCRIPT=$HOME/wechat-collector/moore/scripts/wechat_exporter.py
export MOORE_WECHAT_EXPORTER_DISABLE_KEYCHAIN=1
W=$HOME/wechat-collector/app/scripts/wechat-exporter-browser.py
LARK=$HOME/bin/lark-cli
TARGET=ou_e259415b8f68b3007c23920aa2f80ca2
STATE=$HOME/wechat-collector/.qr-push-state
CLOUD=http://127.0.0.1:3210   # ssh 隧道 → Aries，走 localhost 免鉴权
WEB_URL=https://topic.aigalaxy.top:8443

qr_publish() { # $1=二维码文件 $2=login_id $3=expires_at
  python3 - "$1" "$2" "$3" <<'PY' | curl -s -m 10 -X POST "$CLOUD/api/wechat-login" -H "content-type: application/json" -d @- > /dev/null 2>&1
import base64, datetime as dt, json, sys
qr, lid, exp = sys.argv[1], sys.argv[2], sys.argv[3]
if not exp:
    exp = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10)).isoformat()
print(json.dumps({"action": "publish", "loginId": lid, "qrBase64": base64.b64encode(open(qr, "rb").read()).decode(), "expiresAt": exp}))
PY
}

qr_clear() {
  curl -s -m 10 -X POST "$CLOUD/api/wechat-login" -H "content-type: application/json" -d '{"action":"clear"}' > /dev/null 2>&1
}
TS() { date "+%F %T"; }

jget() { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1',''))
except: print('')"; }

CHECK=$(python3 "$W" exporter-auth-check 2>/dev/null)
STATUS=$(echo "$CHECK" | jget status)
EXPIRES=$(echo "$CHECK" | jget expires_at)

# auth-check 走远端网络（curl 30s 超时），抖动时返回 status=error/空。
# 只有明确 valid/expired 才可信；检查失败 ≠ 登录过期，重试一次仍失败就静默退出，
# 避免半夜因为一次网络抖动误推二维码（2026-07-17 05:40 就是这么来的）。
if [ "$STATUS" != "valid" ] && [ "$STATUS" != "expired" ] && [ "$1" != "--force" ]; then
  echo "[$(TS)] auth-check 异常（status=${STATUS:-空}），60 秒后重试"
  sleep 60
  CHECK=$(python3 "$W" exporter-auth-check 2>/dev/null)
  STATUS=$(echo "$CHECK" | jget status)
  EXPIRES=$(echo "$CHECK" | jget expires_at)
  if [ "$STATUS" != "valid" ] && [ "$STATUS" != "expired" ]; then
    echo "[$(TS)] auth-check 连续失败，跳过本轮不推码: $(echo "$CHECK" | tr -d '\n' | head -c 200)"
    exit 0
  fi
fi

# 分级告警：>48h 静默 · 24-48h 飞书温柔提醒 · <24h 网页横幅+飞书 · 已过期不限推送
LEFT=0
if [ "$STATUS" = "valid" ]; then
  LEFT=$(python3 -c "
import datetime as dt
try:
    e = dt.datetime.fromisoformat('$EXPIRES'.replace('Z','+00:00'))
    print(int((e - dt.datetime.now(dt.timezone.utc)).total_seconds()))
except Exception: print(0)")
fi

if [ "$STATUS" = "valid" ] && [ "${LEFT:-0}" -gt 172800 ] && [ "$1" != "--force" ]; then
  echo "[$(TS)] 登录有效，剩 $((LEFT/3600)) 小时，无需操作"
  exit 0
fi

# 24-48h：飞书温柔提醒，不推码
if [ "$STATUS" = "valid" ] && [ "${LEFT:-0}" -gt 86400 ] && [ "${LEFT:-0}" -le 172800 ] && [ "$1" != "--force" ]; then
  TODAY=$(date +%F)
  GENTLE_FLAG="$STATE.gentle"
  LAST_GENTLE=$(head -1 "$GENTLE_FLAG" 2>/dev/null)
  if [ "$LAST_GENTLE" != "$TODAY" ]; then
    echo "$TODAY" > "$GENTLE_FLAG"
    "$LARK" im +messages-send --user-id "$TARGET" --as bot \
      --text "📅 公众号采集登录将在 $((LEFT/3600)) 小时后过期（${EXPIRES:0:16}）。当前仍正常采集，无需操作。" > /dev/null 2>&1
  fi
  echo "[$(TS)] 登录 $((LEFT/3600))h 后过期，已发温柔提醒"
  exit 0
fi

TODAY=$(date +%F)
COUNT=$(grep -c "^$TODAY" "$STATE" 2>/dev/null || echo 0)
# 登录有效但即将过期：每天最多 5 轮；已过期：每小时一条不设上限
MAX_PUSH=5
if [ "$STATUS" = "expired" ]; then
  MAX_PUSH=24
fi
if [ "${COUNT:-0}" -ge "$MAX_PUSH" ]; then
  echo "[$(TS)] 今日推送已达 ${MAX_PUSH} 次上限，跳过"
  exit 0
fi

START=$(python3 "$W" exporter-login-qr-start --no-open 2>/dev/null)
QR=$(echo "$START" | jget qrcode_path)
LID=$(echo "$START" | jget login_id)
QEXP=$(echo "$START" | jget expires_at)
if [ -z "$QR" ] || [ ! -f "$QR" ]; then
  echo "[$(TS)] 二维码生成失败"
  exit 1
fi
echo "$TODAY $(date +%T) $LID" >> "$STATE"

qr_publish "$QR" "$LID" "$QEXP"
if [ "${COUNT:-0}" = "0" ]; then
  # 文字提醒每天首轮发一条；已过期用更强措辞
  if [ "$STATUS" = "expired" ]; then
    "$LARK" im +messages-send --user-id "$TARGET" --as bot \
      --text "🚨 公众号采集登录已过期！采集已停止。请立即打开 $WEB_URL 扫码续期，过期后我会每小时重推一次二维码。" > /dev/null 2>&1
  else
    "$LARK" im +messages-send --user-id "$TARGET" --as bot \
      --text "⚠️ 公众号采集登录即将过期（${LEFT:-0}秒后），打开 $WEB_URL 网页扫码续期即可。" > /dev/null 2>&1
  fi
fi
echo "[$(TS)] 二维码已推送到网页横幅 login_id=$LID，等待扫码…"

ST=""
for i in $(seq 1 50); do
  ST=$(python3 "$W" exporter-login-qr-status "$LID" 2>/dev/null | jget status)
  [ "$ST" = "confirmed" ] && break
  case "$ST" in expired|failed) break ;; esac
  sleep 12
done

if [ "$ST" = "confirmed" ]; then
  OUT=$(python3 "$W" exporter-login-qr-complete "$LID" 2>&1)
  OK=$(echo "$OUT" | jget ok)
  # 不论 complete 返回什么，强制从 cookie 提取 auth-key 并明文存入 SQLite
  # launchd 沙箱无 Keychain 权限，依赖 MOORE_WECHAT_EXPORTER_DISABLE_KEYCHAIN=1
  # 但 exporter-login-qr-complete 内部的 upsert_login_profile 不一定用了 plain 方式
  KEY=$(python3 -c "
import configparser, os, sys
cookie = os.path.expanduser('~/.moore/wechat-article-downloader/cookies/default.txt')
try:
    cfg = configparser.ConfigParser()
    cfg.read(cookie)
    for s in cfg.sections():
        for k,v in cfg.items(s):
            if 'auth' in k.lower() and len(v.strip()) >= 32:
                print(v.strip())
                sys.exit(0)
except: pass
" 2>/dev/null)
  if [ -n "$KEY" ]; then
    python3 "$W" exporter-config --auth-key "$KEY" --allow-plain-auth-key > /dev/null 2>&1
    echo "[$(TS)] auth-key 已强制明文保存"
  elif [ "$OK" != "True" ]; then
    # cookie 提取失败时，回退到从错误输出中匹配 32 位 hex
    KEY=$(echo "$OUT" | grep -oE "[0-9a-f]{32}" | head -1)
    [ -n "$KEY" ] && python3 "$W" exporter-config --auth-key "$KEY" --allow-plain-auth-key > /dev/null 2>&1
  fi
  qr_clear
  NEW=$(python3 "$W" exporter-auth-check 2>/dev/null)
  NEWSTATUS=$(echo "$NEW" | jget status)
  NEWEXP=$(echo "$NEW" | jget expires_at)
  if [ "$NEWSTATUS" = "valid" ]; then
    "$LARK" im +messages-send --user-id "$TARGET" --as bot \
      --text "✅ 公众号采集登录已续期成功，有效期至 ${NEWEXP:0:16}（UTC）。" > /dev/null 2>&1
    echo "[$(TS)] 续期成功 → $NEWEXP"
  else
    echo "[$(TS)] complete 后校验失败，下个周期重试"
  fi
else
  qr_clear
  echo "[$(TS)] 未扫码，状态: ${ST:-超时}（网页横幅已撤下，下个周期换新码）"
fi
