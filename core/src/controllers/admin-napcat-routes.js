const {
  authorizeNapCatFarm,
  checkNapCatBridge,
  getNapCatLoginStatus,
  getNapCatQrCode,
  getNapCatQrImage,
  reclaimNapCatScanLease,
  refreshNapCatQrCode,
  releaseNapCatScanLease,
} = require('../services/napcat-bridge-client');

const NAPCAT_FARM_APP_ID = '1112386029';

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'super_admin');
}

// NapCat 扫码是全局单例，桥接侧按 owner 做租约归属校验。
// owner 必须稳定且能区分不同人：用面板用户名，拿不到时退回 token 前缀。
// 没有归属标识就无法保护，宁可拒绝也不要发一张别人的二维码。
function scanOwner(req) {
  const username = String(req.currentUser?.username || '').trim();
  if (username) return `user:${username}`;
  const token = String(req.adminToken || '').trim();
  return token ? `token:${token.slice(0, 12)}` : '';
}

// 租约冲突（409）不是故障，要原样把等待提示透给前端，别糊成 502。
function sendBridgeError(res, error) {
  if (error && error.busy) {
    return res.status(409).json({
      ok: false,
      error: error.message,
      busy: true,
      retryAfterMs: error.retryAfterMs || 0,
    });
  }
  return res.status(502).json({ ok: false, error: error.message });
}

function registerAdminNapCatRoutes({
  app,
  provider,
  addOrUpdateAccount,
  getAccountsForUser,
  canAccessAccount,
  userStore,
}) {
  app.get('/api/qr/napcat-login', async (req, res) => {
    try {
      const data = await getNapCatQrCode(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.post('/api/qr/napcat-refresh', async (req, res) => {
    try {
      const data = await refreshNapCatQrCode(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  // 前端 2s 轮询“扫没扫”走这个无副作用接口，不能用 /napcat-login：
  // 后者会在二维码过期时重启 QQ，把用户正在扫的会话反复打死。
  // 传 owner 还负责给持有者续租，并避免非持有者看到别人的登录态。
  app.get('/api/qr/napcat-poll', async (req, res) => {
    try {
      const data = await getNapCatLoginStatus(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  // 无副作用：只读当前 qrcode.png。NapCat 自己每 ~122s 重写该文件轮换二维码，
  // 前端靠 /napcat-poll 的 updatedAt 变化拉这个接口跟随换图，全程不碰进程。
  app.get('/api/qr/napcat-image', async (req, res) => {
    try {
      const data = await getNapCatQrImage(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
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

  // 关弹窗/关页面时主动交回扫码租约，不用等空闲超时，下一个人立刻能扫。
  // 走 fetch keepalive 时前端不看响应，所以这里永远回 200，失败也只是退化成等超时。
  app.post('/api/qr/napcat-release', async (req, res) => {
    try {
      const data = await releaseNapCatScanLease(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      res.json({ ok: true, data: { released: false, reason: error.message } });
    }
  });

  // 页面从后台恢复时软重新占用（不换码、不重启会话）。
  // 被别人抢走时要如实回 409，前端据此切成排队提示，而不是让用户对着一张已失效的码干扫。
  app.post('/api/qr/napcat-reclaim', async (req, res) => {
    try {
      const data = await reclaimNapCatScanLease(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
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

      const data = await authorizeNapCatFarm(existing && (existing.uin || existing.qq) || '', scanOwner(req));
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
      // 扫码链路刚把全新 Code 写进 store，用 skipLoginRefresh 避免 startWorker
      // 再向 NapCat 授权一次（重复授权既慢又可能撞上限流）。
      let startAction = 'none';
      if (wasRunning && provider.restartAccount) {
        provider.restartAccount(updated.id);
        startAction = 'restart';
      } else if (provider.startAccount) {
        // 关键：已存在但当前停止的账号也要拉起。
        // Code 过期把账号停掉恰恰是用户来扫码的最常见原因，
        // 原逻辑只在 wasRunning 时重启，导致扫完码账号仍是停止状态。
        provider.startAccount(updated.id, { skipLoginRefresh: true });
        startAction = 'start';
      }
      if (provider.addAccountLog) {
        const startNote = startAction === 'restart'
          ? '，已重启账号'
          : (startAction === 'start' ? '，已自动启动账号' : '');
        provider.addAccountLog(existing ? 'update' : 'add', `通过 QQ 扫码${existing ? '更新' : '添加'}农场授权${startNote}`, updated.id, updated.name || '');
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
      sendBridgeError(res, error);
    }
  });
}

module.exports = { registerAdminNapCatRoutes };
