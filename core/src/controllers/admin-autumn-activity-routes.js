const { getAuthorizedAccountId, requireConnectedAccount } = require('./admin-activity-route-helpers');

const AUTUMN_KEYS = ['wish', 'happy'];
const AUTUMN_ACTIONS = ['draw', 'claim', 'daily', 'milestones', 'share', 'logs'];

function registerAdminAutumnActivityRoutes({ app, provider, getAccountIdFromRequest, canAccessAccount, sendProviderError }) {
  const context = { getAccountIdFromRequest, canAccessAccount };
  const guard = (req, res, label) => {
    const accountId = getAuthorizedAccountId(req, res, context);
    if (!accountId) return null;
    if (!requireConnectedAccount(res, provider, accountId, `${label}: 账号未运行`)) return null;
    return accountId;
  };

  app.get('/api/activity/autumn/:key', async (req, res) => {
    const key = String(req.params.key || '');
    if (!AUTUMN_KEYS.includes(key)) return res.json({ ok: false, error: '未知活动' });
    const id = guard(req, res, '获取秋日活动失败'); if (!id) return;
    try {
      res.json({ ok: true, activity: await provider.getAutumnActivity(id, key) });
    } catch (err) { sendProviderError(res, err); }
  });

  app.post('/api/activity/autumn/:key/:action', async (req, res) => {
    const key = String(req.params.key || '');
    const action = String(req.params.action || '');
    if (!AUTUMN_KEYS.includes(key)) return res.json({ ok: false, error: '未知活动' });
    if (!AUTUMN_ACTIONS.includes(action)) return res.json({ ok: false, error: '未知操作' });
    const id = guard(req, res, '秋日活动操作失败'); if (!id) return;
    try {
      const body = req.body || {};
      const result = await provider.operateAutumnActivity(id, key, action, body);
      res.json({ ok: true, ...result });
    } catch (err) { sendProviderError(res, err); }
  });
}

module.exports = { registerAdminAutumnActivityRoutes };
