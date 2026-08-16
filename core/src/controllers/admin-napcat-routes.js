const {
  authorizeNapCatFarm,
  checkNapCatBridge,
  getNapCatQrCode,
  refreshNapCatQrCode,
} = require('../services/napcat-bridge-client');

const NAPCAT_FARM_APP_ID = '1112386029';

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'super_admin');
}

function registerAdminNapCatRoutes({
  app,
  provider,
  addOrUpdateAccount,
  getAccountsForUser,
  canAccessAccount,
  userStore,
}) {
  app.get('/api/qr/napcat-login', async (_req, res) => {
    try {
      const data = await getNapCatQrCode();
      res.json({ ok: true, data });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/qr/napcat-refresh', async (_req, res) => {
    try {
      const data = await refreshNapCatQrCode();
      res.json({ ok: true, data });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/qr/napcat-status', async (_req, res) => {
    try {
      await checkNapCatBridge();
      res.json({ ok: true, data: { bridge: 'reachable', appId: NAPCAT_FARM_APP_ID } });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/qr/napcat-farm-code', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const accountId = String(body.accountId || body.id || '').trim();
      const currentUser = req.currentUser;
      const allAccounts = getAccountsForUser();
      const existing = accountId
        ? allAccounts.find(account => String(account.id) === accountId)
        : null;
      if (accountId && !existing) return res.status(404).json({ ok: false, error: '账号不存在' });
      if (existing && !canAccessAccount(req, accountId)) return res.status(403).json({ ok: false, error: '无权访问此账号' });
      if (existing && String(existing.platform || 'qq').toLowerCase() !== 'qq') {
        return res.status(400).json({ ok: false, error: 'QQ 授权不能覆盖微信账号' });
      }
      if (!existing && currentUser && !isAdmin(currentUser)) {
        const count = getAccountsForUser(currentUser.username).length;
        const limit = currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2;
        if (count >= limit) return res.status(403).json({ ok: false, error: `账号数量已达上限（${limit}个）` });
      }

      const data = await authorizeNapCatFarm(existing && (existing.uin || existing.qq) || '');
      const authorization = data.authorization || {};
      const profile = data.profile || {};
      if (!authorization.code) throw new Error('QQ 授权未返回农场 Code');
      const boundOpenId = String(existing && (existing.openID || existing.openid) || '').trim();
      if (existing && boundOpenId && authorization.openID && authorization.openID !== boundOpenId) {
        throw new Error('当前 QQ 与目标农场账号不匹配');
      }

      const payload = {
        ...(existing || {}),
        ...(existing ? { id: accountId } : {}),
        name: existing
          ? String(body.name ?? existing.name ?? '').trim()
          : String(body.name || '').trim(),
        code: authorization.code,
        openID: authorization.openID || boundOpenId,
        openid: authorization.openID || boundOpenId,
        uin: profile.uin || existing?.uin || '',
        qq: profile.uin || existing?.qq || '',
        avatar: profile.avatar || existing?.avatar || '',
        platform: 'qq',
        loginType: 'napcat_open_auth',
        ...(existing ? {} : { username: currentUser?.username || '' }),
      };
      const wasRunning = existing && provider.isAccountRunning
        ? provider.isAccountRunning(accountId)
        : false;
      const saved = addOrUpdateAccount(payload);
      const updated = existing
        ? saved.accounts.find(account => String(account.id) === accountId)
        : saved.accounts.at(-1);
      if (!updated) throw new Error('保存 QQ 农场账号失败');
      if (!existing && provider.startAccount) provider.startAccount(updated.id);
      else if (wasRunning && provider.restartAccount) provider.restartAccount(updated.id);
      if (provider.addAccountLog) {
        provider.addAccountLog(existing ? 'update' : 'add', `通过 QQ 扫码${existing ? '更新' : '添加'}农场授权`, updated.id, updated.name || '');
      }
      res.json({
        ok: true,
        data: {
          success: true,
          account: { id: updated.id, name: updated.name, platform: 'qq', loginType: 'napcat_open_auth' },
          authorization: { appId: NAPCAT_FARM_APP_ID, source: 'NapCat OpenAuth', expiresAt: authorization.expiresAt || null },
        },
      });
    } catch (error) {
      res.status(502).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminNapCatRoutes };
