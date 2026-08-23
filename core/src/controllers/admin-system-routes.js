const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { getDataFile } = require("../config/runtime-paths");

const LOGIN_ASSETS_DIR = getDataFile("login-assets");
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
]);

fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });

const loginLogoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGIN_ASSETS_DIR,
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${LOGIN_LOGO_EXTENSIONS.get(file.mimetype)}`);
    },
  }),
  limits: { fileSize: LOGIN_LOGO_MAX_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!LOGIN_LOGO_EXTENSIONS.has(file.mimetype)) {
      return callback(new Error("仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片"));
    }
    return callback(null, true);
  },
}).single("file");

function deleteManagedLoginLogo(logoUrl) {
  const prefix = "/login-assets/";
  const value = String(logoUrl || "");
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(value.slice(prefix.length));
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
  } catch {}
}

function registerAdminSystemRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
  requireSuperAdminRole,
  requireDangerConfirmation,
  getDefaultSystemConfig,
  getRuntimeConfig,
  updateRuntimeConfig,
  broadcastConfig,
}) {
  /** 保存/重置系统配置后同步到所有账号 Worker（config_sync 广播，秒级生效） */
  function syncSystemConfigToWorkers() {
    if (typeof broadcastConfig === "function") {
      try {
        broadcastConfig();
      } catch (error) {
        logger.error("广播系统配置失败", { error: error.message });
      }
    }
  }

  // 允许的自定义协议：QQ 加群/会话唤起常用这几种
  const ALLOWED_LINK_SCHEMES = /^(https?|mqqapi|mqq|tencent|weixin|alipays):\/\//i;
  // 形如 qm.qq.com/xxx、www.example.com 的裸域名，自动补 https://
  const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

  /** 归一化用户填写的链接：裸域名补 https://，其余原样返回 */
  const normalizePublicLink = (value) => {
    const link = String(value || "").trim();
    if (!link) return "";
    if (link.startsWith("/") || ALLOWED_LINK_SCHEMES.test(link)) return link;
    if (BARE_DOMAIN.test(link)) return `https://${link}`;
    return link;
  };

  const isAllowedPublicLink = (value) => {
    const link = String(value || "").trim();
    return !link || link.startsWith("/") || ALLOWED_LINK_SCHEMES.test(link);
  };

  const isAllowedImageLink = (value) => {
    const link = String(value || "").trim();
    return (
      !link ||
      link.startsWith("/") ||
      /^https?:\/\//i.test(link) ||
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(link)
    );
  };

  app.get("/api/super-admin-announcement", (req, res) => {
    try {
      res.json({ ok: true, data: store.getSuperAdminAnnouncement() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/super-admin/announcement",
    requireAdminToken,
    requireSuperAdminRole,
    (req, res) => {
      try {
        if (
          !requireDangerConfirmation(
            req,
            res,
            "UPDATE_SUPER_ADMIN_ANNOUNCEMENT",
          )
        ) {
          return;
        }

        const { content, password } = req.body;
        const data = store.setSuperAdminAnnouncement(content, password);
        logger.warn("更新超级管理员公告", {
          admin: req.currentUser?.username || "",
          hasContent: !!String(content || "").trim(),
          hasPassword: !!String(password || "").trim(),
          confirmation: "UPDATE_SUPER_ADMIN_ANNOUNCEMENT",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post("/api/super-admin-announcement/verify", (req, res) => {
    try {
      const { password } = req.body;
      const valid = store.verifySuperAdminAnnouncementPassword(password);
      res.json({ ok: true, valid });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/announcement", requireAdminToken, (req, res) => {
    try {
      const announcement = { ...store.getAnnouncement() };
      announcement.shouldShow = store.shouldShowAnnouncement(
        req.currentUser?.username,
      );
      res.json({ ok: true, data: announcement });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/announcement/read", requireAdminToken, (req, res) => {
    try {
      if (req.currentUser?.username) {
        store.markAnnouncementRead(req.currentUser.username);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/admin/announcement",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_ANNOUNCEMENT")) return;
        const { content, showOnce } = req.body || {};
        const data = store.setAnnouncement(content, showOnce);
        logger.warn("更新系统公告", {
          admin: req.currentUser?.username || "",
          hasContent: !!String(content || "").trim(),
          showOnce: showOnce !== false,
          confirmation: "UPDATE_ANNOUNCEMENT",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get(
    "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({
          ok: true,
          data: {
            saved: store.getSystemConfig(),
            default: getDefaultSystemConfig(),
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/public/login-links", (req, res) => {
    try {
      res.json({ ok: true, data: store.getLoginLinks() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getLoginLinks() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-logo",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      loginLogoUpload(req, res, (uploadError) => {
        if (uploadError) {
          return res.status(400).json({ ok: false, error: uploadError.message });
        }
        if (!req.file) {
          return res.status(400).json({ ok: false, error: "请选择要上传的图片" });
        }

        const logoUrl = `/login-assets/${req.file.filename}`;
        const previous = store.getLoginLinks();
        try {
          const data = store.setLoginLinks({ ...previous, logoUrl });
          if (previous.logoUrl !== logoUrl) deleteManagedLoginLogo(previous.logoUrl);
          logger.warn("上传登录页图标", {
            admin: req.currentUser?.username || "",
            logoUrl,
            size: req.file.size,
          });
          return res.json({ ok: true, data });
        } catch (error) {
          deleteManagedLoginLogo(logoUrl);
          return res.status(500).json({ ok: false, error: error.message });
        }
      });
    },
  );

  app.post(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_LOGIN_LINKS")) return;
        const { title, loginSubtitle, registerSubtitle } = req.body || {};
        const logoUrl = normalizePublicLink((req.body || {}).logoUrl);
        const purchaseUrl = normalizePublicLink((req.body || {}).purchaseUrl);
        const qqGroupUrl = normalizePublicLink((req.body || {}).qqGroupUrl);

        const badLinkField = !isAllowedPublicLink(purchaseUrl)
          ? "购买链接"
          : !isAllowedPublicLink(qqGroupUrl)
            ? "QQ群链接"
            : "";
        if (badLinkField) {
          return res.status(400).json({
            ok: false,
            error: `${badLinkField}格式不支持：请填写 http(s):// 完整地址、站内路径（以 / 开头），或 mqqapi/tencent 等 QQ 唤起协议`,
          });
        }
        if (!isAllowedImageLink(logoUrl)) {
          return res.status(400).json({
            ok: false,
            error:
              "登录图标格式不支持：请填写 http(s):// 图片地址、站内路径（以 / 开头）或 data:image base64，也可直接用「上传本地图片」",
          });
        }
        const titleLen = String(title || "").trim().length;
        const loginLen = String(loginSubtitle || "").trim().length;
        const registerLen = String(registerSubtitle || "").trim().length;
        if (titleLen > 40 || loginLen > 80 || registerLen > 80) {
          const over = [];
          if (titleLen > 40) over.push(`主标题 ${titleLen}/40 字`);
          if (loginLen > 80) over.push(`登录欢迎语 ${loginLen}/80 字`);
          if (registerLen > 80) over.push(`注册提示语 ${registerLen}/80 字`);
          return res.status(400).json({
            ok: false,
            error: `内容超长：${over.join("，")}`,
          });
        }
        const previous = store.getLoginLinks();
        const data = store.setLoginLinks({
          ...(req.body || {}),
          logoUrl,
          purchaseUrl,
          qqGroupUrl,
        });
        if (previous.logoUrl !== data.logoUrl) deleteManagedLoginLogo(previous.logoUrl);
        logger.warn("更新登录页设置", {
          admin: req.currentUser?.username || "",
          hasCustomLogo: !!data.logoUrl,
          title: data.title,
          purchaseUrl: data.purchaseUrl,
          qqGroupUrl: data.qqGroupUrl,
          confirmation: "UPDATE_LOGIN_LINKS",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_LOGIN_LINKS")) return;
        const previous = store.getLoginLinks();
        const data = store.setLoginLinks(store.DEFAULT_LOGIN_LINKS);
        if (previous.logoUrl !== data.logoUrl) deleteManagedLoginLogo(previous.logoUrl);
        logger.warn("恢复登录页默认设置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_LOGIN_LINKS",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_SYSTEM_CONFIG")) return;
        const { serverUrl, clientVersion, platform, os } = req.body || {};
        const saved = store.setSystemConfig({
          serverUrl,
          clientVersion,
          platform,
          os,
        });
        updateRuntimeConfig(saved);
        syncSystemConfigToWorkers();
        logger.warn("更新系统配置", {
          admin: req.currentUser?.username || "",
          serverUrl: saved?.serverUrl || "",
          clientVersion: saved?.clientVersion || "",
          platform: saved?.platform || "",
          os: saved?.os || "",
          confirmation: "UPDATE_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_SYSTEM_CONFIG")) return;
        const saved = getDefaultSystemConfig();
        store.setSystemConfig(saved);
        updateRuntimeConfig(saved);
        syncSystemConfigToWorkers();
        logger.warn("重置系统配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get(
    "/api/admin/wx-config",
    requireAdminToken,
    (req, res) => {
      try {
        const cfg = store.getGlobalWxConfig();
        const isAdmin = req.currentUser?.role === "admin" || req.currentUser?.role === "super_admin";
        // 普通用户不返回 apiKey：扫码等接口由后端代理时自动回退环境变量 YYB_API_KEY，避免泄露容器内 Bearer token
        res.json({ ok: true, data: isAdmin ? cfg : { ...cfg, apiKey: "" } });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/wx-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_WX_CONFIG")) return;
        const data = store.setGlobalWxConfig(req.body || {});
        logger.warn("更新微信配置", {
          admin: req.currentUser?.username || "",
          enabled: data?.enabled === true,
          autoAddAccount: data?.autoAddAccount === true,
          userIsolation: data?.userIsolation === true,
          apiBase: data?.apiBase || "",
          confirmation: "UPDATE_WX_CONFIG",
        });
        res.json({ ok: true, data });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );
}

module.exports = { registerAdminSystemRoutes };
