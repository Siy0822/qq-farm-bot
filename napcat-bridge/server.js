#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  getNapCatLoginProfile,
  getNapCatRuntimeState,
  requestNapCatFarmAuthorization,
  startTemporaryNapCat,
  stopTemporaryNapCat,
  ensureTemporaryNapCatForUin,
} = require('../core/src/services/napcat-openauth');

const SOCKET_PATH = process.env.NAPCAT_BRIDGE_SOCKET || '/run/qqfarm-napcat-bridge.sock';
const QR_PATH = process.env.NAPCAT_QR_IMAGE_PATH || '/opt/napcat-docker/cache/qrcode.png';
let authorizeQueue = Promise.resolve();

function enqueueAuthorization(task) {
  const run = authorizeQueue.then(task, task);
  authorizeQueue = run.catch(() => {});
  return run;
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function waitForQr(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(QR_PATH);
      if (stat.size > 0) {
        return {
          qrcode: `data:image/png;base64,${fs.readFileSync(QR_PATH).toString('base64')}`,
          updatedAt: stat.mtimeMs,
        };
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('QQ 扫码二维码生成超时');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/qrcode') {
    try {
      try {
        const profile = await getNapCatLoginProfile();
        if (profile.uin) return json(res, 200, { ok: true, data: { loggedIn: true, profile } });
      } catch {}
      await startTemporaryNapCat();
      const qr = await waitForQr();
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      return json(res, 502, { ok: false, error: error.message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    try {
      await stopTemporaryNapCat();
      await startTemporaryNapCat();
      const qr = await waitForQr();
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      return json(res, 502, { ok: false, error: error.message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/authorize') {
    try {
      const body = await readBody(req);
      const quickUin = String(body.uin || '').trim();
      const data = await enqueueAuthorization(async () => {
        let cacheUin = '';
        try {
          if (quickUin) await ensureTemporaryNapCatForUin(quickUin);
          const profile = await getNapCatLoginProfile();
          cacheUin = profile.uin || quickUin;
          if (quickUin && profile.uin !== quickUin) throw new Error('QQ 快速登录账号不匹配');
          const authorization = await requestNapCatFarmAuthorization();
          return { authorization, profile };
        } finally {
          if (cacheUin) await stopTemporaryNapCat({ cacheUin }).catch(() => {});
        }
      });
      return json(res, 200, { ok: true, data });
    } catch (error) {
      return json(res, 502, { ok: false, error: error.message, stage: getNapCatRuntimeState().lastErrorStage });
    }
  }
  return json(res, 404, { ok: false, error: 'not found' });
}

try { fs.unlinkSync(SOCKET_PATH); } catch (error) { if (error.code !== 'ENOENT') throw error; }
fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });
const server = http.createServer((req, res) => Promise.resolve(handle(req, res)).catch(error => json(res, 500, { ok: false, error: error.message })));
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o666);
  console.log(`NapCat bridge listening on ${SOCKET_PATH}`);
});
function shutdown() { server.close(() => { try { fs.unlinkSync(SOCKET_PATH); } catch {} process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
