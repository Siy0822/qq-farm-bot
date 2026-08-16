const http = require('node:http');

const SOCKET_PATH = process.env.NAPCAT_BRIDGE_SOCKET || '/run/qqfarm-napcat-bridge/bridge.sock';

function requestBridge(method, path, body = null, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      socketPath: SOCKET_PATH,
      path,
      method,
      timeout: timeoutMs,
      headers: payload ? {
        'content-type': 'application/json',
        'content-length': payload.length,
      } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { return reject(new Error(`QQ 登录桥接返回非 JSON（HTTP ${res.statusCode}）`)); }
        if (res.statusCode < 200 || res.statusCode >= 300 || !data.ok) {
          return reject(new Error(data.error || `QQ 登录桥接失败（HTTP ${res.statusCode}）`));
        }
        resolve(data.data || {});
      });
    });
    req.on('timeout', () => req.destroy(new Error('QQ 登录桥接请求超时')));
    req.on('error', (error) => reject(new Error(`QQ 登录桥接不可用: ${error.message}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  getNapCatQrCode: () => requestBridge('GET', '/qrcode', null, 25000),
  refreshNapCatQrCode: () => requestBridge('POST', '/refresh', {}, 30000),
  authorizeNapCatFarm: (uin = '') => requestBridge('POST', '/authorize', { uin }, 90000),
  checkNapCatBridge: () => requestBridge('GET', '/health', null, 5000),
};
