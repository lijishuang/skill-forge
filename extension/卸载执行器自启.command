#!/bin/bash
# 卸载：Skill 工坊本地执行器开机自启（macOS）
LABEL="com.skill-forge.host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "✅ 已卸载开机自启（正在运行的执行器不受影响，下次开机不再自动启动）"
read -p "按回车关闭窗口…"
