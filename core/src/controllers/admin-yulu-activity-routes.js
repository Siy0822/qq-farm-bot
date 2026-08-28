const { getAuthorizedAccountId, requireConnectedAccount } = require('./admin-activity-route-helpers');

function registerAdminYuluActivityRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const context = { getAccountIdFromRequest, canAccessAccount };
  const guard = (req, res, label) => {
    const accountId = getAuthorizedAccountId(req, res, context);
    if (!accountId) return null;
    if (!requireConnectedAccount(res, provider, accountId, `${label}: 账号未运行`)) return null;
    return accountId;
  };
  app.get('/api/activity/yulu', async (req, res) => {
    const id = guard(req, res, '获取雨落成诗失败'); if (!id) return;
    try { res.json({ ok: true, activity: await provider.getYuluActivity(id) }); } catch (err) { sendProviderError(res, err); }
  });
  app.post('/api/activity/yulu/open', async (req, res) => {
    const id = guard(req, res, '使用雨落成诗物品失败'); if (!id) return;
    try { res.json({ ok: true, ...await provider.openYuluItem(id, req.body?.itemId) }); } catch (err) { sendProviderError(res, err); }
  });
  app.post('/api/activity/yulu/mutate', async (req, res) => {
    const id = guard(req, res, '闪电变异失败'); if (!id) return;
    try { res.json({ ok: true, accountId: id, data: await provider.mutateYulu(id) }); } catch (err) { sendProviderError(res, err); }
  });
  app.post('/api/activity/yulu/use', async (req, res) => {
    const id = guard(req, res, '使用雨落成诗物品失败'); if (!id) return;
    try {
      const body = req.body || {};
      res.json({ ok: true, accountId: id, data: await provider.useYulu(id, body.itemId, body.hostGid, body.landIds) });
    } catch (err) { sendProviderError(res, err); }
  });
  app.post('/api/activity/yulu/research', async (req, res) => {
    const id = guard(req, res, '气象研究失败'); if (!id) return;
    try { res.json({ ok: true, ...await provider.researchYulu(id, req.body?.nodeId) }); } catch (err) { sendProviderError(res, err); }
  });
  app.post('/api/activity/yulu/exchange', async (req, res) => {
    const id = guard(req, res, '兑换天气采集瓶失败'); if (!id) return;
    try { res.json({ ok: true, ...await provider.exchangeYulu(id) }); } catch (err) { sendProviderError(res, err); }
  });
}

module.exports = { registerAdminYuluActivityRoutes };
