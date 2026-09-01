const { getAuthorizedAccountId, requireConnectedAccount } = require('./admin-activity-route-helpers');

function registerAdminHonghuaActivityRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const context = { getAccountIdFromRequest, canAccessAccount };
  const guard = (req, res, label) => {
    const accountId = getAuthorizedAccountId(req, res, context);
    if (!accountId) return null;
    if (!requireConnectedAccount(res, provider, accountId, `${label}: 账号未运行`)) return null;
    return accountId;
  };

  app.get('/api/activity/honghua', async (req, res) => {
    const accountId = guard(req, res, '获取公益小红花失败');
    if (!accountId) return;
    try { res.json({ ok: true, activity: await provider.getHonghuaActivity(accountId) }); }
    catch (error) { sendProviderError(res, error); }
  });

  app.post('/api/activity/honghua/love', async (req, res) => {
    const accountId = guard(req, res, '送出爱心值失败');
    if (!accountId) return;
    try { res.json({ ok: true, data: await provider.sendHonghuaLove(accountId) }); }
    catch (error) { sendProviderError(res, error); }
  });

  app.post('/api/activity/honghua/fund', async (req, res) => {
    const accountId = guard(req, res, '送出公益金失败');
    if (!accountId) return;
    if (req.body?.confirmed !== true) {
      res.status(400).json({ ok: false, error: '该操作涉及真实 1 元公益金，必须明确确认', confirmationRequired: true });
      return;
    }
    try { res.json({ ok: true, data: await provider.sendHonghuaFund(accountId) }); }
    catch (error) { sendProviderError(res, error); }
  });

  app.post('/api/activity/honghua/claim', async (req, res) => {
    const accountId = guard(req, res, '领取公益小红花奖励失败');
    if (!accountId) return;
    const kind = String(req.body?.kind || '');
    if (!['share', 'tier'].includes(kind)) {
      res.status(400).json({ ok: false, error: '仅支持领取 share 或 tier 奖励' });
      return;
    }
    try { res.json({ ok: true, data: await provider.claimHonghuaReward(accountId, kind, req.body?.tier) }); }
    catch (error) { sendProviderError(res, error); }
  });
}

module.exports = { registerAdminHonghuaActivityRoutes };
