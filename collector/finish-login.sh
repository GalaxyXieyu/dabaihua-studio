#!/bin/bash
# 等扫码 → 完成登录 → 启动定时采集 → 立刻跑一轮
export MOORE_WECHAT_EXPORTER_SCRIPT=$HOME/wechat-collector/moore/scripts/wechat_exporter.py
W=$HOME/wechat-collector/app/scripts/wechat-exporter-browser.py
LID=$1
for i in $(seq 1 55); do
  ST=$(python3 $W exporter-login-qr-status --login-id $LID 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get(\"status\",\"\"))" 2>/dev/null)
  echo "[$i] $ST"
  [ "$ST" = "confirmed" ] && break
  [ "$ST" = "expired" ] && echo EXPIRED && exit 2
  sleep 12
done
[ "$ST" = "confirmed" ] || { echo TIMEOUT; exit 3; }
python3 $W exporter-login-qr-complete --login-id $LID | tail -2
python3 $W exporter-auth-check | python3 -c "import json,sys;d=json.load(sys.stdin);print(\"auth:\",d.get(\"ok\",d))"
launchctl bootout gui/$(id -u)/com.wechat-collector.sync 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.wechat-collector.sync.plist
echo "定时采集已启动，立即执行首轮..."
cd ~/wechat-collector/app
RSS_AI_ENDPOINT=http://127.0.0.1:3210 MOORE_WECHAT_EXPORTER_SCRIPT=$HOME/wechat-collector/moore/scripts/wechat_exporter.py WECHAT_WIZARD=$HOME/wechat-collector/moore/scripts/wechat_wizard.py WECHAT_DOWNLOADER=$HOME/wechat-collector/moore/scripts/wechat_downloader.py ~/wechat-collector/node/bin/node scripts/wechat-subscription-sync.mjs 2>&1 | tail -15
echo "== 服务器队列状态 =="
curl -s http://127.0.0.1:3210/api/import-queue | python3 -m json.tool | head -25
