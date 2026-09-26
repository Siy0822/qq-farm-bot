/**
 * SVIP 商城面板路由（官方商城分页 slot_type=4）
 *
 * 与 /api/shop/mall 并列，不改动原有普通商城入口。
 * 非会员可浏览目录，但购买会被后端拒绝（商品 purchasable=false）。
 */
const SVIP_ERROR_MESSAGES = {
  INVALID_GOODS_ID: '商品信息无效，请刷新商城后重试',
  INVALID_PURCHASE_COUNT: '购买数量必须是有效的正整数',
  GOODS_NOT_FOUND: '商品已不在当前商城中，请刷新后重试',
  GOODS_SOLD_OUT: '商品已售罄，已达到限购上限',
  GOODS_UNAVAILABLE: '商品当前不可购买',
  PURCHASE_LIMIT_EXCEEDED: '购买数量超过剩余限购数量',
  INSUFFICIENT_BALANCE: '货币余额不足，无法完成购买',
  MALL_BALANCE_UNAVAILABLE: '商品价格或余额未确认，请刷新后重试',
  MALL_PRICE_CHANGED: '商品价格已变化，请刷新商城后重新确认',
  PURCHASE_NOT_CONFIRMED: '购买结果未确认，请刷新后查看',
};

function friendlyError(err) {
  const raw = String((err && err.message) || err || '操作失败');
  const code = String((err && err.code) || '');
  if (SVIP_ERROR_MESSAGES[code]) return { code, message: SVIP_ERROR_MESSAGES[code] };
  return { code: code || 'SVIP_OPERATION_FAILED', message: raw || '操作失败，请刷新后重试' };
}

function registerAdminSvipMallRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
}) {
  const resolveAccount = (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) {
      res.status(400).json({ ok: false, error: 'Missing x-account-id' });
      return null;
    }
    if (!canAccessAccount(req, accountId)) {
      res.status(403).json({ ok: false, error: '无权访问此账号' });
      return null;
    }
    const status = provider.getStatus(accountId);
    if (!status || !status.connection || !status.connection.connected) {
      res.json({ ok: false, error: '账号未运行' });
      return null;
    }
    return accountId;
  };

  app.get('/api/shop/svip', async (req, res) => {
    const accountId = resolveAccount(req, res);
    if (!accountId) return;
    try {
      res.json({ ok: true, data: await provider.getSvipCatalog(accountId) });
    } catch (err) {
      const friendly = friendlyError(err);
      res.json({ ok: false, error: friendly.message, errorCode: friendly.code });
    }
  });

  app.post('/api/shop/svip/buy', async (req, res) => {
    const accountId = resolveAccount(req, res);
    if (!accountId) return;
    try {
      const body = req.body || {};
      const result = await provider.purchaseSvipGoods(accountId, body.goodsId, body.count, body.expectedPrice);
      res.json({ ok: true, data: result });
    } catch (err) {
      const friendly = friendlyError(err);
      res.json({ ok: false, error: friendly.message, errorCode: friendly.code });
    }
  });
}

module.exports = { registerAdminSvipMallRoutes };
