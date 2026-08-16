const fetch = require('node-fetch');
const { authorizeNapCatFarm } = require('../services/napcat-bridge-client');
const { createScheduler } = require('../services/scheduler');

function createAutoCodeRefreshService(deps) {
  const {
    store,
    getAccounts,
    addOrUpdateAccount,
    resolveWorkerControls,
    log,
    addAccountLog,
  } = deps;

  const scheduler = createScheduler('auto_code_refresh');

  function getTaskName(accountId) {
    return `refresh_${  String(accountId || '')}`;
  }

  function findAccount(accountId) {
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    return accounts.find(acc => String(acc.id) === String(accountId));
  }

  function normalizeConfig(accountId) {
    const cfg = store.getAutoCodeRefresh ? store.getAutoCodeRefresh(accountId) : null;
    return {
      enabled: cfg && cfg.enabled === true,
      intervalMinutes: Math.max(1, Math.min(1440, Number(cfg && cfg.intervalMinutes) || 60)),
    };
  }

  function getWxConfig() {
    return store.getGlobalWxConfig ? store.getGlobalWxConfig() : {};
  }

  async function requestFarmCode(account, wxConfig) {
    const wxid = String(account && account.wxid || '').trim();
    if (!wxid) throw new Error('账号缺少 wxid，无法自动刷新 Code');

    const apiKey = String(wxConfig.apiKey || '').trim();
    const appId = String(wxConfig.appId || 'wx5306c5978fdb76e4').trim();

    if (apiKey) {
      const proxyApiUrl = String(wxConfig.proxyApiUrl || 'https://code.z74d.top/api').trim();
      const targetUrl = `${proxyApiUrl  }?api_key=${  encodeURIComponent(apiKey)  }&action=jslogin`;
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wxid, appid: appId }),
      });
      const data = await response.json();
      if (data && data.code === 0 && data.data && data.data.code) return String(data.data.code);
      throw new Error(data && data.msg ? data.msg : '代理获取 Code 失败');
    }

    const apiBase = String(wxConfig.apiBase || 'https://code.z74d.top/api').trim();
    const response = await fetch(`${apiBase  }/Wxapp/JSLogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Wxid: wxid, Appid: appId }),
    });
    const data = await response.json();
    if (data && data.Success && data.Data && data.Data.code) return String(data.Data.code);
    const msg = data && data.Data && data.Data.jsapiBaseresponse && data.Data.jsapiBaseresponse.errmsg
      ? data.Data.jsapiBaseresponse.errmsg
      : data && data.Message ? data.Message : '获取 Code 失败';
    throw new Error(msg);
  }

  async function refreshAccountCode(accountId, reason = 'timer') {
    const account = findAccount(accountId);
    if (!account) return false;

    const platform = String(account.platform || 'qq').toLowerCase();
    if (platform === 'qq' && String(account.loginType || '') === 'napcat_open_auth') {
      try {
        const result = await authorizeNapCatFarm(String(account.uin || account.qq || '').trim());
        const authorization = result.authorization || {};
        const profile = result.profile || {};
        if (!authorization.code) throw new Error('QQ 授权未返回农场 Code');
        const boundOpenId = String(account.openID || account.openid || '').trim();
        if (boundOpenId && authorization.openID && authorization.openID !== boundOpenId) {
          throw new Error('QQ 快速登录账号与农场账号不匹配');
        }
        const nextAccount = {
          ...account,
          code: authorization.code,
          openID: authorization.openID || boundOpenId,
          openid: authorization.openID || boundOpenId,
          uin: profile.uin || account.uin || '',
          qq: profile.uin || account.qq || '',
          avatar: profile.avatar || account.avatar || '',
        };
        addOrUpdateAccount(nextAccount);
        const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
        if (typeof controls.restartWorker === 'function') controls.restartWorker(nextAccount);
        addAccountLog('auto_code_refresh', `QQ Code 自动刷新成功，已重启账号: ${account.name || account.id}`,
          account.id, account.name, { reason });
        log('系统', `QQ Code 自动刷新成功: ${account.name || account.id}`, {
          accountId: String(account.id),
          accountName: account.name || '',
        });
        return true;
      } catch (err) {
        addAccountLog('auto_code_refresh_failed', `QQ Code 自动刷新失败: ${err.message}`,
          account.id, account.name, { reason });
        log('错误', `QQ Code 自动刷新失败: ${account.name || account.id} - ${err.message}`, {
          accountId: String(account.id),
          accountName: account.name || '',
        });
        return false;
      }
    }

    const wxConfig = getWxConfig();
    if (wxConfig.enabled === false) {
      log('系统', '自动刷新 Code 跳过: 微信登录未启用', {
        accountId: String(accountId),
        accountName: account.name,
      });
      return false;
    }

    try {
      const code = await requestFarmCode(account, wxConfig);
      const nextAccount = { ...account, code };
      addOrUpdateAccount(nextAccount);

      const controls = typeof resolveWorkerControls === 'function' ? (resolveWorkerControls() || {}) : {};
      if (typeof controls.restartWorker === 'function') controls.restartWorker(nextAccount);

      addAccountLog('auto_code_refresh', `自动刷新 Code 成功，已重启账号: ${  account.name}`,
        account.id, account.name, { reason });
      log('系统', `自动刷新 Code 成功: ${  account.name}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      return true;
    } catch (err) {
      addAccountLog('auto_code_refresh_failed', `自动刷新 Code 失败: ${  err.message}`,
        account.id, account.name, { reason });
      log('错误', `自动刷新 Code 失败: ${  account.name  } - ${  err.message}`, {
        accountId: String(account.id),
        accountName: account.name,
      });
      return false;
    }
  }

  function scheduleAccount(accountId) {
    const cfg = normalizeConfig(accountId);
    const taskName = getTaskName(accountId);
    scheduler.clear(taskName);
    if (!cfg.enabled) return;

    const account = findAccount(accountId);
    const isNapCatQq = account
      && String(account.platform || 'qq').toLowerCase() === 'qq'
      && String(account.loginType || '') === 'napcat_open_auth'
      && String(account.uin || account.qq || '').trim();
    if (!account || (!isNapCatQq && !String(account.wxid || '').trim())) {
      log('系统', '自动刷新 Code 未启动: 账号缺少可刷新身份', {
        accountId: String(accountId),
        accountName: account && account.name || '',
      });
      return;
    }

    scheduler.setIntervalTask(taskName, cfg.intervalMinutes * 60000, () => {
      refreshAccountCode(accountId, 'timer');
    }, { preventOverlap: true });

    log('系统', `自动刷新 Code 已启用: ${  account.name  }，间隔 ${  cfg.intervalMinutes  } 分钟`, {
      accountId: String(accountId),
      accountName: account.name,
    });
  }

  function rescheduleAll() {
    scheduler.clearAll();
    const data = getAccounts();
    const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
    for (const account of accounts) {
      scheduleAccount(account.id);
    }
  }

  function stopAccount(accountId) {
    scheduler.clear(getTaskName(accountId));
  }

  return {
    refreshAccountCode,
    scheduleAccount,
    rescheduleAll,
    stopAccount,
  };
}

module.exports = { createAutoCodeRefreshService };
