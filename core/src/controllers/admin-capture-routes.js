const crypto = require("node:crypto");
const fetch = require("node-fetch");

const CAPTURE_REQUEST_TIMEOUT_MS = 15_000;
const CAPTURE_FLOW_TTL_MS = 15 * 60 * 1000;
const captureFlows = new Map();

function isAdminUser(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function normalizeApiBase(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 500) throw new Error("抓包服务地址无效");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("抓包服务地址格式无效");
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("抓包服务地址仅支持不含账号密码的 http(s) 地址");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

function resolveCaptureConfig(store, override = {}) {
  const saved = store.getCaptureConfig();
  return {
    ...saved,
    ...override,
    apiBase: normalizeApiBase(override.apiBase || saved.apiBase),
    apiToken: String(override.apiToken || saved.apiToken || "").trim(),
  };
}

async function captureRequest(config, path, options = {}) {
  if (!config.apiToken) throw new Error("抓包服务 API Token 未配置");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || CAPTURE_REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.sessionId) headers["x-capture-session-id"] = options.sessionId;
    const response = await fetch(`${config.apiBase}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`抓包服务返回了无效响应（HTTP ${response.status}）`);
    }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `抓包服务请求失败（HTTP ${response.status}）`);
    }
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("抓包服务请求超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getFlowOwner(user) {
  return String(user?.username || "").trim();
}

function findOwnedFlow(flowId, user) {
  const flow = captureFlows.get(String(flowId || ""));
  if (!flow || flow.owner !== getFlowOwner(user)) return null;
  return flow;
}

function isCertificateTokenValid(flow, token) {
  const expected = Buffer.from(String(flow?.certificateToken || ""), "utf8");
  const supplied = Buffer.from(String(token || ""), "utf8");
  return expected.length > 0
    && expected.length === supplied.length
    && crypto.timingSafeEqual(expected, supplied);
}

function mergeKnownFriendGids(existingGids, capturedGids, accountGid) {
  const ownGid = Number(accountGid);
  return [...new Set([
    ...(Array.isArray(existingGids) ? existingGids : []).map(Number),
    ...capturedGids,
  ])].filter(
    (gid) => Number.isSafeInteger(gid) && gid > 0 && gid !== ownGid,
  );
}

function addCapturedValues(flow, snapshot) {
  const data = snapshot?.data || snapshot?.state || snapshot;
  if (!data || typeof data !== "object") return;
  const channel = data.channels?.[flow.platform];
  const entries = Array.isArray(channel?.codes) ? channel.codes : [];
  const codeEntry = entries.find((item) => String(item?.code || "").trim());
  const gidEntry = entries.find((item) => String(item?.gid || "").trim());
  const openIdEntry = entries.find((item) => String(item?.openid || item?.open_id || "").trim());
  if (!flow.code && codeEntry) flow.code = String(codeEntry.code).trim();
  if (!flow.accountGid && gidEntry) flow.accountGid = String(gidEntry.gid).trim();
  if (!flow.openId && openIdEntry) {
    flow.openId = String(openIdEntry.openid || openIdEntry.open_id).trim();
  }

  const friends = Array.isArray(data.friends?.items) ? data.friends.items : [];
  for (const friend of friends) {
    const gid = Number(friend?.gid);
    if (Number.isSafeInteger(gid) && gid > 0) flow.friendGids.add(gid);
  }

  flow.publicInfo = data.publicInfo || flow.publicInfo;
  flow.proxy = data.proxy || flow.proxy;
  flow.captureStatus = channel?.status || flow.captureStatus;
  flow.updatedAt = Date.now();
}

async function refreshFlow(store, flow) {
  const config = resolveCaptureConfig(store);
  const snapshot = await captureRequest(
    config,
    `/api/sessions/${encodeURIComponent(flow.remoteSessionId)}/state`,
    { sessionId: flow.remoteSessionId },
  );
  addCapturedValues(flow, snapshot);
  return flow;
}

function serializeFlow(flow) {
  const autoStopSec = Number(flow.publicInfo?.mitmProxyAutoStopSec) || 0;
  const startedAt = Date.parse(flow.proxy?.startedAt || "");
  const elapsedSec = Number.isFinite(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  return {
    id: flow.id,
    platform: flow.platform,
    codeCaptured: !!flow.code,
    accountGid: flow.accountGid,
    friendCount: flow.friendGids.size,
    captureStatus: flow.captureStatus,
    proxy: {
      running: flow.proxy?.running === true,
      status: String(flow.proxy?.status || ""),
      error: String(flow.proxy?.error || ""),
    },
    publicInfo: {
      host: String(flow.publicInfo?.host || ""),
      mitmPort: Number(flow.publicInfo?.mitmPort) || 0,
      mitmProxyAutoStopSec: autoStopSec,
      remainingSec: autoStopSec ? Math.max(0, autoStopSec - elapsedSec) : 0,
      certificateUrl: `/api/public/capture-certificate/${encodeURIComponent(flow.id)}/${encodeURIComponent(flow.certificateToken)}`,
    },
    completed: flow.completed === true,
    result: flow.result || null,
  };
}

async function stopRemoteFlow(store, flow) {
  try {
    const config = resolveCaptureConfig(store);
    await captureRequest(config, "/api/capture/stop", {
      method: "POST",
      sessionId: flow.remoteSessionId,
      body: {},
    });
  } catch {}
}

function scheduleRemoteStop(store, flow, delayMs = 5000) {
  const timer = setTimeout(() => stopRemoteFlow(store, flow), delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

async function removeExistingOwnerFlows(store, owner) {
  const existing = [...captureFlows.values()].filter(
    (flow) => flow.owner === owner && !flow.completed,
  );
  for (const flow of existing) {
    await stopRemoteFlow(store, flow);
    captureFlows.delete(flow.id);
  }
}

async function cleanupExpiredFlows(store) {
  const cutoff = Date.now() - CAPTURE_FLOW_TTL_MS;
  const expired = [...captureFlows.values()].filter((flow) => flow.updatedAt < cutoff);
  for (const flow of expired) {
    if (!flow.completed) await stopRemoteFlow(store, flow);
    captureFlows.delete(flow.id);
  }
}

function registerAdminCaptureRoutes({
  app,
  store,
  provider,
  userStore,
  logger,
  requireAdminRole,
  requireDangerConfirmation,
  canAccessAccount,
  resolveAccountReference,
}) {
  const cleanupTimer = setInterval(() => cleanupExpiredFlows(store), 60_000);
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

  app.get("/api/admin/capture-config", requireAdminRole, (req, res) => {
    try {
      const config = store.getCaptureConfig();
      res.json({
        ok: true,
        data: {
          enabled: config.enabled === true,
          apiBase: config.apiBase,
          apiToken: "",
          tokenConfigured: !!config.apiToken,
          autoImportQqGids: config.autoImportQqGids !== false,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/capture-config/test", requireAdminRole, async (req, res) => {
    try {
      const config = resolveCaptureConfig(store, req.body || {});
      const health = await captureRequest(config, "/api/health");
      res.json({
        ok: true,
        data: {
          uptime: Number(health.uptime) || 0,
          sessions: Number(health.sessions) || 0,
          portPoolSize: Array.isArray(health.portPool) ? health.portPool.length : 0,
        },
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/capture-config", requireAdminRole, (req, res) => {
    try {
      if (!requireDangerConfirmation(req, res, "UPDATE_CAPTURE_CONFIG")) return;
      const input = req.body || {};
      const apiBase = normalizeApiBase(input.apiBase || store.DEFAULT_CAPTURE_CONFIG.apiBase);
      const current = store.getCaptureConfig();
      const apiToken = String(input.apiToken || current.apiToken || "").trim();
      if (input.enabled === true && !apiToken) {
        return res.status(400).json({ ok: false, error: "启用前请填写 API Token" });
      }
      const data = store.setCaptureConfig({ ...input, apiBase, apiToken });
      logger.warn("更新 Code/GID 抓取服务配置", {
        admin: req.currentUser?.username || "",
        enabled: data.enabled === true,
        apiBase: data.apiBase,
        autoImportQqGids: data.autoImportQqGids !== false,
        confirmation: "UPDATE_CAPTURE_CONFIG",
      });
      res.json({
        ok: true,
        data: {
          enabled: data.enabled,
          apiBase: data.apiBase,
          apiToken: "",
          tokenConfigured: !!data.apiToken,
          autoImportQqGids: data.autoImportQqGids,
        },
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/capture/config", (req, res) => {
    const config = store.getCaptureConfig();
    res.json({
      ok: true,
      data: {
        enabled: config.enabled === true && !!config.apiBase && !!config.apiToken,
      },
    });
  });

  app.post("/api/capture/sessions", async (req, res) => {
    const owner = getFlowOwner(req.currentUser);
    const platform = req.body?.platform === "wx" ? "wx" : "qq";
    try {
      if (!owner) return res.status(401).json({ ok: false, error: "未登录" });
      const accountRef = String(req.body?.accountId || "").trim();
      const accountId = accountRef
        ? resolveAccountReference(accountRef) || accountRef
        : "";
      if (accountId && !canAccessAccount(req, accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }
      if (accountId) {
        const existing = store.getAccounts().accounts.find(
          (account) => String(account.id) === accountId,
        );
        if (!existing) {
          return res.status(404).json({ ok: false, error: "目标账号不存在" });
        }
      }
      const config = resolveCaptureConfig(store);
      if (!config.enabled) {
        return res.status(403).json({ ok: false, error: "代理抓取添加账号未启用" });
      }
      await removeExistingOwnerFlows(store, owner);

      const flowId = crypto.randomBytes(18).toString("base64url");
      const remoteSessionId = crypto.randomBytes(18).toString("base64url");
      const session = await captureRequest(config, "/api/sessions", {
        method: "POST",
        sessionId: remoteSessionId,
        body: { sessionId: remoteSessionId },
      });
      const flow = {
        id: flowId,
        remoteSessionId,
        certificateToken: crypto.randomBytes(24).toString("base64url"),
        owner,
        accountId,
        platform,
        code: "",
        accountGid: "",
        openId: "",
        friendGids: new Set(),
        publicInfo: {},
        proxy: {},
        captureStatus: "idle",
        completed: false,
        result: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      addCapturedValues(flow, session);
      captureFlows.set(flowId, flow);
      try {
        const started = await captureRequest(config, "/api/capture/start", {
          method: "POST",
          sessionId: remoteSessionId,
          body: { mode: platform },
          timeout: 30_000,
        });
        addCapturedValues(flow, started);
      } catch (error) {
        captureFlows.delete(flowId);
        await stopRemoteFlow(store, flow);
        throw error;
      }
      res.json({ ok: true, data: serializeFlow(flow) });
    } catch (error) {
      logger.warn("启动代理抓取失败", { owner, platform, error: error.message });
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/capture/sessions/:flowId", async (req, res) => {
    const flow = findOwnedFlow(req.params.flowId, req.currentUser);
    if (!flow) return res.status(404).json({ ok: false, error: "抓取任务不存在或已过期" });
    try {
      if (!flow.completed) await refreshFlow(store, flow);
      res.json({ ok: true, data: serializeFlow(flow) });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message, data: serializeFlow(flow) });
    }
  });

  app.get("/api/public/capture-certificate/:flowId/:token", async (req, res) => {
    const flow = captureFlows.get(String(req.params.flowId || ""));
    if (!flow || !isCertificateTokenValid(flow, req.params.token)) {
      return res.status(404).json({ ok: false, error: "证书链接不存在或已过期" });
    }
    try {
      const config = resolveCaptureConfig(store);
      const certPath = String(flow.publicInfo?.certUrl || "/cert/mitmproxy-ca-cert.cer");
      if (!certPath.startsWith("/") || certPath.startsWith("//")) {
        throw new Error("抓包服务证书地址无效");
      }
      const response = await fetch(`${config.apiBase}${certPath}`, { timeout: CAPTURE_REQUEST_TIMEOUT_MS });
      if (!response.ok) throw new Error(`证书下载失败（HTTP ${response.status}）`);
      const buffer = await response.buffer();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/x-x509-ca-cert");
      res.setHeader("Content-Disposition", 'inline; filename="mitmproxy-ca-cert.cer"');
      res.send(buffer);
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/capture/sessions/:flowId/complete", async (req, res) => {
    const flow = findOwnedFlow(req.params.flowId, req.currentUser);
    if (!flow) return res.status(404).json({ ok: false, error: "抓取任务不存在或已过期" });
    if (flow.completed) return res.json({ ok: true, data: flow.result });
    if (flow.completing) return res.status(409).json({ ok: false, error: "账号正在添加中" });
    flow.completing = true;
    try {
      try {
        await refreshFlow(store, flow);
      } catch (error) {
        if (!flow.code) throw error;
      }
      if (!flow.code) return res.status(400).json({ ok: false, error: "尚未获取到 Code" });

      const currentUser = req.currentUser;
      const isUpdate = !!flow.accountId;
      if (!isUpdate && !isAdminUser(currentUser)) {
        const accountCount = store.getAccountsByUser(currentUser.username).accounts.length;
        const accountLimit = currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (accountCount >= accountLimit) {
          return res.status(403).json({
            ok: false,
            error: `账号数量已达上限（${accountLimit}个），请购买额度卡密增加额度`,
          });
        }
      }

      const name = String(req.body?.name || "").trim();
      const existing = isUpdate
        ? store.getAccounts().accounts.find(
            (account) => String(account.id) === flow.accountId,
          )
        : null;
      if (isUpdate && !existing) throw new Error("目标账号不存在");
      if (isUpdate && !canAccessAccount(req, flow.accountId)) {
        return res.status(403).json({ ok: false, error: "无权访问此账号" });
      }
      const wasRunning = isUpdate && provider.isAccountRunning
        ? provider.isAccountRunning(flow.accountId)
        : false;
      const accountPayload = {
        ...(isUpdate ? { id: flow.accountId } : { username: currentUser.username }),
        name: name || existing?.name || "",
        code: flow.code,
        platform: flow.platform,
        loginType: "capture",
        ...(flow.accountGid ? { gid: flow.accountGid } : {}),
        ...(flow.openId ? { openId: flow.openId } : {}),
      };
      const accounts = store.addOrUpdateAccount(accountPayload);
      const created = isUpdate
        ? accounts.accounts.find((account) => String(account.id) === flow.accountId)
        : accounts.accounts.at(-1);
      if (!created) throw new Error("账号保存失败");

      flow.completed = true;
      flow.result = {
        accountId: created.id,
        name: created.name,
        platform: flow.platform,
        importedFriendCount: 0,
        startError: "",
      };

      const config = store.getCaptureConfig();
      let importedFriendCount = 0;
      try {
        if (flow.platform === "qq" && config.autoImportQqGids !== false) {
          const accountGid = Number(flow.accountGid);
          const knownGids = isUpdate ? store.getKnownFriendGids(created.id) : [];
          const gids = mergeKnownFriendGids(knownGids, flow.friendGids, accountGid);
          store.setKnownFriendGids(created.id, gids);
          const previousGids = new Set(knownGids.map(Number));
          importedFriendCount = gids.filter((gid) => !previousGids.has(gid)).length;
        }
      } catch (error) {
        logger.warn("代理抓取账号已添加，但好友 GID 导入失败", {
          owner: flow.owner,
          accountId: created.id,
          error: error.message,
        });
      }

      try {
        if (provider.addAccountLog) {
          provider.addAccountLog(
            isUpdate ? "update" : "add",
            `代理抓取${isUpdate ? "更新" : "添加"}账号: ${created.name || created.id}`,
            created.id,
            created.name || "",
            { platform: flow.platform, importedFriendCount },
          );
        }
      } catch {}

      let startError = "";
      try {
        if (isUpdate) {
          if (wasRunning) provider.restartAccount(created.id);
        } else {
          provider.startAccount(created.id);
        }
      } catch (error) {
        startError = error.message || "账号启动失败";
        logger.warn("代理抓取账号已添加，但启动失败", {
          owner: flow.owner,
          accountId: created.id,
          error: startError,
        });
      }
      flow.result = {
        accountId: created.id,
        name: created.name,
        platform: flow.platform,
        importedFriendCount,
        startError,
        updated: isUpdate,
      };
      flow.updatedAt = Date.now();
      res.json({ ok: true, data: flow.result });
      scheduleRemoteStop(store, flow);
    } catch (error) {
      logger.warn("代理抓取添加账号失败", {
        owner: flow.owner,
        platform: flow.platform,
        error: error.message,
      });
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      flow.completing = false;
    }
  });

  app.delete("/api/capture/sessions/:flowId", async (req, res) => {
    const flow = findOwnedFlow(req.params.flowId, req.currentUser);
    if (!flow) return res.json({ ok: true });
    captureFlows.delete(flow.id);
    res.json({ ok: true });
    scheduleRemoteStop(store, flow);
  });
}

module.exports = {
  addCapturedValues,
  isCertificateTokenValid,
  mergeKnownFriendGids,
  normalizeApiBase,
  registerAdminCaptureRoutes,
};
