const {
  getAuthorizedAccountId,
  requireConnectedAccount,
} = require("./admin-activity-route-helpers");

/**
 * 鹊桥寄情（七夕，2026-08-18 ~ 08-22）路由
 * - GET  /api/activity/qixi          活动状态（鹊羽/灵露/香囊/筑桥档位/玩法说明）
 * - POST /api/activity/qixi/spray    喷洒鹊羽灵露（自家或好友农场）
 * - POST /api/activity/qixi/bridge   筑建鹊桥（默认连领所有鹊羽足够的档位）
 * - POST /api/activity/qixi/gift     赠送鹊羽香囊给好友
 */
function registerAdminQixiActivityRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const routeContext = {
    getAccountIdFromRequest,
    canAccessAccount,
  };

  app.get("/api/activity/qixi", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "获取鹊桥寄情失败: 账号未运行")) return;

      const activity = await provider.getQixiActivity(accountId);
      res.json({ ok: true, activity });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/qixi/spray", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "鹊羽灵露喷洒失败: 账号未运行")) return;

      const hostGid = Number(req.body?.hostGid ?? req.body?.gid ?? 0) || 0;
      const count = Number(req.body?.count ?? 1) || 1;
      const result = await provider.sprayQixiLu(accountId, { hostGid, count });
      res.json({ ok: true, ...result });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/qixi/bridge", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "筑建鹊桥失败: 账号未运行")) return;

      const all = req.body?.all !== false;
      const result = await provider.buildQixiBridge(accountId, { all });
      res.json({ ok: true, ...result });
    } catch (err) {
      sendProviderError(res, err);
    }
  });

  app.post("/api/activity/qixi/gift", async (req, res) => {
    const accountId = getAuthorizedAccountId(req, res, routeContext);
    if (!accountId) return;

    try {
      if (!requireConnectedAccount(res, provider, accountId, "赠送鹊羽香囊失败: 账号未运行")) return;

      const hostGid = Number(req.body?.hostGid ?? req.body?.gid ?? 0) || 0;
      if (hostGid <= 0) {
        res.status(400).json({ ok: false, error: "缺少赠送目标好友 gid" });
        return;
      }

      const result = await provider.giftQixiSachet(accountId, hostGid);
      res.json({ ok: true, ...result });
    } catch (err) {
      sendProviderError(res, err);
    }
  });
}

module.exports = { registerAdminQixiActivityRoutes };
