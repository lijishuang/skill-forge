#!/bin/bash
# 双击启动 Skill 工坊 · 本地执行器（macOS）
cd "$(dirname "$0")"
python3 skill-forge-host.py
read -p "执行器已停止，按回车关闭窗口…"
