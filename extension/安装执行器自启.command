#!/bin/bash
# 一键启动 Skill 工坊本地执行器，并尝试注册 macOS 开机自启（launchd 守护）
# - 优先注册 launchd：开机自动运行 + 异常退出自动拉起
# - 注册失败（部分受限环境）时自动降级：直接在后台启动执行器，本机立即可用
# - 已在线时不重复启动；卸载请运行「卸载执行器自启.command」
cd "$(dirname "$0")"

HOST_PY="$PWD/skill-forge-host.py"
LABEL="com.skill-forge.host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="/tmp/skill-forge-host.log"
PORT=39217

ping_ok() { curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/ping" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; }

if [ ! -f "$HOST_PY" ]; then
  echo "❌ 未找到 skill-forge-host.py（请把本脚本保留在扩展目录内再运行）"
  read -p "按回车关闭窗口…"
  exit 1
fi

# 0) 已在线：直接完成
if ping_ok; then
  echo "✅ 本地执行器已在线（http://127.0.0.1:$PORT），无需重复启动"
  echo "   页面里的「本地执行器」状态会在 10 秒内自动变绿，无需点「检测」"
  read -p "按回车关闭窗口…"
  exit 0
fi

# 1) 尝试注册 launchd 开机自启（幂等：先卸载旧配置）
PY3=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3 "$(command -v python3)"; do
  [ -x "$c" ] && PY3="$c" && break
done
[ -z "$PY3" ] && PY3=python3

mkdir -p "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
launchctl unload "$PLIST" 2>/dev/null

cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY3</string>
    <string>$HOST_PY</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
XML

REG="no"
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  REG="yes"
else
  launchctl load -w "$PLIST" 2>/dev/null
  launchctl list 2>/dev/null | grep -q "$LABEL" && REG="yes"
fi

# 2) 等待 launchd 拉起；未拉起则降级为后台直接启动（本机立即可用）
sleep 1.5
if ! ping_ok; then
  echo "→ launchd 未生效，改为后台直接启动…"
  nohup "$PY3" "$HOST_PY" >> "$LOG" 2>&1 &
  sleep 1.5
fi

if ping_ok; then
  if [ "$REG" = "yes" ]; then
    echo "✅ 本地执行器已启动，并已注册开机自启（异常退出会自动拉起）"
  else
    echo "✅ 本地执行器已在后台启动（本次开机期间有效）"
    echo "   ⚠️ 开机自启注册未成功：可重新双击本脚本再试，或重启后手动运行一次"
  fi
  echo "   技能目录: ~/.skill-forge/skills   日志: $LOG"
  echo "   页面里的「本地执行器」状态会在 10 秒内自动变绿，无需点「检测」"
else
  echo "❌ 启动失败，请查看日志：$LOG"
fi
read -p "按回车关闭窗口…"
