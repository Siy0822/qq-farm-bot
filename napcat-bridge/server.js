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
// QR 路径必须跟 napcat-openauth.js 用同一套推导（NAPCAT_WORKDIR/cache/qrcode.png）。
// 曾经这里硬编码宿主布局 /opt/napcat-docker，容器里 NapCat 明明已经把二维码写到
// /app/napcat-data/cache 了，bridge 却一直等一个不存在的文件 → 「二维码生成超时」。
const NAPCAT_WORKDIR = process.env.NAPCAT_WORKDIR || '/opt/napcat-docker';
const QR_PATH = process.env.NAPCAT_QR_IMAGE_PATH || path.join(NAPCAT_WORKDIR, 'cache', 'qrcode.png');
// 冷启动要先拉起 Electron + 等网络就绪，15s 在慢盘上不够。
const QR_TIMEOUT_MS = Number(process.env.NAPCAT_QR_TIMEOUT_MS) || 45000;
// QQ 二维码大约 2 分钟失效，而 NapCat 一个会话只在启动时生成一次、从不自己轮换。
// 再加上 qrcode.png 在持久化卷里（跳容器重启仍在），若只看“文件存在且非空”
// 就会把几分钟、甚至几天前的死码当新码发给前端 → 用户扫一次失败一次。
// 留 30s 余量给用户扫码，超过这个年龄就重拉一张。
const QR_MAX_AGE_MS = Number(process.env.NAPCAT_QR_MAX_AGE_MS) || 90000;
let authorizeQueue = Promise.resolve();
// 二维码轮换会 stop+start QQ，必须串行：前端 2s 轮询并发打进来时，
// 并行重启会互相杀进程、生成一堆没人用的会话。
let qrQueue = Promise.resolve();

function enqueueAuthorization(task) {
  const run = authorizeQueue.then(task, task);
  authorizeQueue = run.catch(() => {});
  return run;
}

function enqueueQr(task) {
  const run = qrQueue.then(task, task);
  qrQueue = run.catch(() => {});
  return run;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 读当前二维码文件状态（不带副作用） */
function statQr() {
  try {
    const stat = fs.statSync(QR_PATH);
    if (!stat.size) return null;
    return { updatedAt: stat.mtimeMs, ageMs: Math.max(0, Date.now() - stat.mtimeMs) };
  } catch {
    return null;
  }
}

function readQr(info) {
  return {
    qrcode: `data:image/png;base64,${fs.readFileSync(QR_PATH).toString('base64')}`,
    updatedAt: info.updatedAt,
    ageMs: info.ageMs,
  };
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

/**
 * 等一张真正新生成的二维码。notBefore 是本轮重启的起始时间，
 * 只接受 mtime 不早于它的文件——否则会把上一个会话遗留的死码当成新码立即返回。
 */
async function waitForQr(timeoutMs = QR_TIMEOUT_MS, notBefore = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = statQr();
    if (info && info.updatedAt >= notBefore && info.ageMs <= QR_MAX_AGE_MS) return readQr(info);
    await sleep(250);
  }
  throw new Error(`QQ 扫码二维码生成超时（${QR_PATH}）`);
}

/**
 * 保证拿到一张未过期的二维码。现有码还新鲜就直接用；
 * 过期（或 force）则 stop → 删旧码 → start，拿一张新的。
 * 注：napcat-openauth.startTemporaryNapCat() 在 QQ 还活着时会直接 early return，
 * 它删旧码那句 unlink 在走不到的 else 分支里，所以轮换必须在这里显式 stop。
 */
async function ensureFreshQr({ force = false } = {}) {
  if (!force) {
    const info = statQr();
    if (info && info.ageMs <= QR_MAX_AGE_MS) return readQr(info);
  }
  const startedAt = Date.now();
  await stopTemporaryNapCat().catch(() => {});
  try { fs.unlinkSync(QR_PATH); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await startTemporaryNapCat();
  return waitForQr(QR_TIMEOUT_MS, startedAt);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true });
  }
  // 无副作用探测：供前端 2s 轮询“扫没扫”。绝不在这里重启 QQ，
  // 否则轮询会把用户正在扫的会话反复打死。
  if (req.method === 'GET' && url.pathname === '/status') {
    let loggedIn = false;
    let profile = null;
    try {
      profile = await getNapCatLoginProfile();
      loggedIn = !!profile.uin;
    } catch {}
    const info = statQr();
    return json(res, 200, {
      ok: true,
      data: {
        loggedIn,
        profile: loggedIn ? profile : undefined,
        hasQr: !!info,
        ageMs: info ? info.ageMs : null,
        updatedAt: info ? info.updatedAt : null,
        // stale=true 时前端应重拉一张，避免用户盯着死码扫
        stale: !info || info.ageMs > QR_MAX_AGE_MS,
        maxAgeMs: QR_MAX_AGE_MS,
      },
    });
  }
  if (req.method === 'GET' && url.pathname === '/qrcode') {
    try {
      try {
        const profile = await getNapCatLoginProfile();
        if (profile.uin) return json(res, 200, { ok: true, data: { loggedIn: true, profile } });
      } catch {}
      const qr = await enqueueQr(() => ensureFreshQr());
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      return json(res, 502, { ok: false, error: error.message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    try {
      const qr = await enqueueQr(() => ensureFreshQr({ force: true }));
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
