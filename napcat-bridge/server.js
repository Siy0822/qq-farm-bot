#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  getNapCatLoginProfile,
  getNapCatRuntimeState,
  isTemporaryNapCatServiceActive,
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
// 【重要】2026-08-19 实测 launcher.log 确认：NapCat **自己就会在同一会话内
// 每 ~122 秒原地重写 qrcode.png 轮换二维码**（例：10:27:55 冷启动后，
// 10:29:57 / 10:31:59 / ... / 10:48:14 均无冷启动而自行换码）。
// 所以绝不能在这里自己搞“二维码过期就 stop+start”：
// 一旦阈值小于轮换周期，就会把用户正在扫的会话反复打死（已踩过这个坑）。
// 会话活着就直接读当前文件，让 NapCat 自己负责新鲜度。
let authorizeQueue = Promise.resolve();
// 启动/重启会话必须串行，否则并发请求会互相杀进程。
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

/** 读当前二维码文件状态（无副作用） */
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
 * 等一张 mtime 不早于 notBefore 的二维码。
 * notBefore 仅在“我们刚主动重启过会话”时传，用于避开重启前遗留的文件；
 * 会话本来就活着时 notBefore=0，直接用当前文件（NapCat 自己轮换，不需我们管）。
 */
async function waitForQr(timeoutMs = QR_TIMEOUT_MS, notBefore = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = statQr();
    if (info && info.updatedAt >= notBefore) return readQr(info);
    await sleep(250);
  }
  throw new Error(`QQ 扫码二维码生成超时（${QR_PATH}）`);
}

/**
 * 拿一张可用二维码。
 * - 会话已在跑：直接读当前文件，绝不重启（重启会杀掉用户正在扫的码）
 * - 会话不在（或 force=用户显式点刷新）：stop → 删旧码 → start → 等新码
 */
async function ensureQr({ force = false } = {}) {
  const active = await isTemporaryNapCatServiceActive();
  if (active && !force) {
    const info = statQr();
    if (info) return readQr(info);
    // 会话刚拉起、码还没写出来：等一下就好，不要重启
    return waitForQr();
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
        sessionActive: await isTemporaryNapCatServiceActive(),
      },
    });
  }
  if (req.method === 'GET' && url.pathname === '/image') {
    // 无副作用：只读当前 qrcode.png。NapCat 自己每 ~122s 重写该文件，
    // 前端靠 updatedAt 变化拉这个接口跟随换图，全程不碰进程。
    const info = statQr();
    if (!info) return json(res, 404, { ok: false, error: '当前无二维码' });
    return json(res, 200, { ok: true, data: readQr(info) });
  }
  if (req.method === 'GET' && url.pathname === '/qrcode') {
    try {
      try {
        const profile = await getNapCatLoginProfile();
        if (profile.uin) return json(res, 200, { ok: true, data: { loggedIn: true, profile } });
      } catch {}
      const qr = await enqueueQr(() => ensureQr());
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      return json(res, 502, { ok: false, error: error.message });
    }
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    try {
      const qr = await enqueueQr(() => ensureQr({ force: true }));
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
          // 先看当前活会话。用户刚扫码登录进来的往往就是目标 QQ，此时必须直接复用这个会话。
          // 原先无条件走 ensureTemporaryNapCatForUin()，它会先把刚扫上的会话 stop 掉，
          // 再去 quick-login-profiles 找一份「从未被保存过」的资料 → 死循环报
          // 「该 QQ 尚未保存快速登录资料，请先扫码授权一次」。
          // 而那份资料只在本函数成功后的 stopTemporaryNapCat({cacheUin}) 里才会写入，
          // 于是已存在的 QQ 账号永远无法重新授权（新账号 quickUin 为空反而能过）。
          let profile = null;
          try { profile = await getNapCatLoginProfile(); } catch {}
          const liveUin = profile && profile.uin ? profile.uin : '';

          if (liveUin && quickUin && liveUin !== quickUin) {
            throw new Error(`当前扫码登录的是 QQ ${liveUin}，与目标账号 ${quickUin} 不一致`);
          }
          if (!liveUin) {
            // 无活会话：走保存过的快速登录资料（无人值守刷新 Code 用）
            if (!quickUin) throw new Error('QQ 尚未登录，请先扫码');
            await ensureTemporaryNapCatForUin(quickUin);
            profile = await getNapCatLoginProfile();
          }

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
