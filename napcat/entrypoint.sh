#!/bin/bash
# napcat-farm 容器入口：Xvfb + bridge。QQ 客户端由 bridge 按需拉起/回收，
# 不常驻——授权是短时操作，常驻只会白占内存并让多账号串行更难控制。
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/app/napcat-home}"
NAPCAT_WORKDIR="${NAPCAT_WORKDIR:-/app/napcat-data}"
export NAPCAT_WORKDIR

mkdir -p \
  "$HOME/.config/QQ/versions" \
  "$NAPCAT_WORKDIR/config" \
  "$NAPCAT_WORKDIR/cache" \
  "$NAPCAT_WORKDIR/logs" \
  "$NAPCAT_WORKDIR/quick-login-profiles" \
  "$NAPCAT_WORKDIR/session-home"

# 首次启动播种默认配置（已存在的不覆盖，保留扫码后的登录态与 token）
for f in /app/napcat-defaults/config/*; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  [ -e "$NAPCAT_WORKDIR/config/$base" ] || cp -a "$f" "$NAPCAT_WORKDIR/config/$base"
done

# Xvfb：QQ 是 Electron 应用，无 X 显示会直接退出
Xvfb "$DISPLAY" -screen 0 1080x760x16 +extension GLX +render -nolisten tcp > /dev/null 2>&1 &
XVFB_PID=$!

shutdown() {
  kill "${BRIDGE_PID:-}" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap shutdown SIGTERM SIGINT

for _ in $(seq 1 40); do
  [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.25
done

node /app/napcat-bridge/server.js &
BRIDGE_PID=$!
wait "$BRIDGE_PID"
