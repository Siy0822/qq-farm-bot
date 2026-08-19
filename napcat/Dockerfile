# syntax=docker/dockerfile:1
#
# napcat-farm：只为「农场小程序 OpenAuth 取 Code」这一件事服务的精简 NapCat 运行时。
#
# 与官方 mlikiowa/napcat-docker（2.1GB）的区别：
#   - 基底换成 node:20-bookworm-slim（自带 node，bridge 无需再装运行时；glibc 2.36 向下兼容 QQ）
#   - 只装 Electron 跑起来必需的 X/GTK/NSS 库，去掉 ffmpeg、jq、curl、dbus-user-session、gosu 等
#   - 裁掉音视频通话栈（avsdk）、Windows 启动器、版本热更副本、devtools、表情/铃声等纯 UI 资源
#   - napcat.mjs 在构建期由 patches/apply-farm-patch.mjs 注入农场 OpenAuth action（锚点漂移则构建失败）
#
# QQ 客户端与 NapCat.Shell 均取自官方镜像，构建上下文里不需要 1.2G 的宿主机副本。

# ===== 阶段一：从官方镜像取 QQ 客户端并裁剪 =====
# 官方镜像没有 node，所以这一阶段只做文件裁剪，napcat.mjs 的补丁放到下一阶段。
FROM mlikiowa/napcat-docker:latest AS qqsrc

RUN set -eux; \
    # 音视频通话栈：授权流程不碰语音视频
    rm -rf /opt/QQ/resources/app/avsdk; \
    # QQ 自带的版本热更副本（与 resources/app 重复）
    rm -rf /opt/QQ/resources/app/versions; \
    # 开发者工具 / 许可证文本 / 纯 UI 资源
    rm -rf /opt/QQ/resources/app/externals \
           /opt/QQ/LICENSES.chromium.html \
           /opt/QQ/LICENSE.electron.txt \
           /opt/QQ/resources/app/resource/default-emojis \
           /opt/QQ/resources/app/resource/chuo-lottie \
           /opt/QQ/resources/app/resource/msg.wav; \
    # 非 Linux-x64 平台残留：macOS dylib、32 位 IPC 桩
    rm -rf /opt/QQ/resources/app/AudioFoundation.dylib \
           /opt/QQ/resources/app/initIpc_ia32.node; \
    # Electron 语言包：无头授权只需要中英文
    find /opt/QQ/locales -type f -name '*.pak' \
         ! -name 'zh-CN.pak' ! -name 'en-US.pak' -delete

# ===== 阶段二：解开 NapCat.Shell 并注入农场 OpenAuth action =====
FROM node:20-bookworm-slim AS napcatsrc

# deb.debian.org 从本机走只有 ~26KB/s，apt 阶段会拖到一小时以上；镜像源可跑满带宽。
RUN set -eux; \
    sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends unzip; \
    rm -rf /var/lib/apt/lists/*

COPY --from=qqsrc /app/NapCat.Shell.zip /tmp/NapCat.Shell.zip
COPY napcat/patches /patches

RUN set -eux; \
    mkdir -p /napcat; \
    unzip -q /tmp/NapCat.Shell.zip -d /napcat; \
    rm -f /tmp/NapCat.Shell.zip; \
    # Windows 启动器，Linux 无用。注意 conout-*.js 不能删：名字像调试壳，
    # 实际是 napcat.mjs 静态 import 的 chunk，删掉会 ERR_MODULE_NOT_FOUND，
    # NapCat 静默不加载，表象是「二维码生成超时」。
    rm -rf /napcat/*.bat /napcat/NapCatWinBoot*; \
    # 构建期注入农场 OpenAuth action（幂等；锚点匹配不到 1 次直接失败）
    node /patches/apply-farm-patch.mjs /napcat/napcat.mjs; \
    grep -q start_mini_app_1112386029 /napcat/napcat.mjs; \
    # NapCat 把四个平台的原生模块全打进 native/（arm64 + darwin + win32 约 53MB），
    # 容器只跑 linux-x64，其余全是死重量。dpapi 整个目录只有 Windows 版。
    rm -rf /napcat/native/dpapi; \
    find /napcat/native \( -name '*.arm64.node' -o -name '*.win32.x64.node' \
         -o -name '*.dll' -o -name '*.exe' \) -delete; \
    rm -rf /napcat/native/pty/linux.arm64 /napcat/native/pty/win32.x64; \
    # 校验保留的 linux-x64 原生模块仍在（防止 find 规则写错把需要的删掉）
    test -f /napcat/native/napi2native/napi2native.linux.x64.node; \
    test -f /napcat/native/packet/MoeHoo.linux.x64.node; \
    test -f /napcat/native/pty/linux.x64/pty.node

# ===== 阶段二：运行时 =====
FROM node:20-bookworm-slim AS runner

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    DISPLAY=:1 \
    HOME=/app/napcat-home \
    NAPCAT_WORKDIR=/app/napcat-data \
    NAPCAT_LAUNCH_MODE=process \
    NAPCAT_LAUNCHER=/app/napcat/launch-qq.sh \
    NAPCAT_BRIDGE_HTTP_PORT=9700

# Electron 最小运行集：X + GTK + NSS + 中文字体（二维码/登录页需要字形，否则渲染空白）
RUN set -eux; \
    sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g; s|http://deb.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      xvfb \
      libnss3 \
      libnspr4 \
      libgbm1 \
      libasound2 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libatspi2.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgtk-3-0 \
      libnotify4 \
      libsecret-1-0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxss1 \
      libxtst6 \
      libx11-xcb1 \
      libgnutls30 \
      fonts-wqy-zenhei \
      tini \
      procps \
      tzdata; \
    ln -sf /usr/share/zoneinfo/$TZ /etc/localtime; \
    echo "$TZ" > /etc/timezone; \
    apt-get purge -y --auto-remove; \
    # xvfb 硬依赖 libgl1，顺带拖来整条 mesa 软渲染链（libgl1-mesa-dri → libllvm15
    # → libz3-4，装机量约 160MB）。授权只需要一块离屏画布：Xvfb 关掉 GLX 扩展，
    # QQ 用自带的 libvk_swiftshader 做软渲染，这条链一行都用不到。
    # adwaita 图标主题是 gtk3 的硬依赖，但无头容器不渲染图标。
    dpkg --remove --force-depends \
      libgl1-mesa-dri libllvm15 libz3-4 adwaita-icon-theme; \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
           /usr/share/doc /usr/share/man /usr/share/info

COPY --from=qqsrc /opt/QQ /opt/QQ
COPY --from=napcatsrc /napcat /app/napcat

# bridge：复用农场仓库里的同一份源码，避免两处漂移
WORKDIR /app
COPY napcat-bridge /app/napcat-bridge
COPY core/src/services/napcat-openauth.js /app/core/src/services/napcat-openauth.js
COPY napcat/entrypoint.sh /usr/local/bin/napcat-entrypoint.sh
COPY napcat/launch-qq.sh /app/napcat/launch-qq.sh
COPY napcat/defaults /app/napcat-defaults

# bridge 唯一的外部依赖
RUN set -eux; \
    npm install --no-save --no-audit --no-fund node-fetch@2; \
    chmod +x /usr/local/bin/napcat-entrypoint.sh /app/napcat/launch-qq.sh; \
    npm cache clean --force

EXPOSE 9700

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get({socketPath:'/run/qqfarm-napcat-bridge/bridge.sock',path:'/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["tini", "-s", "--"]
CMD ["/usr/local/bin/napcat-entrypoint.sh"]
