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
const NAPCAT_CONFIG_DIR = path.join(NAPCAT_WORKDIR, 'config');
const QR_PATH = process.env.NAPCAT_QR_IMAGE_PATH || path.join(NAPCAT_WORKDIR, 'cache', 'qrcode.png');
// 冷启动要先拉起 Electron + 等网络就绪，15s 在慢盘上不够。
const QR_TIMEOUT_MS = Number(process.env.NAPCAT_QR_TIMEOUT_MS) || 45000;

// ===== 二维码解码 URL（用于前端重新生成高清码）=====
// 背景：NapCat 写出的 qrcode.png 只有 147×147，内含 41×41 个模块 → 每模块仅 3px，
// 且白边只有 4 个模块。浏览器把它拉伸到 192 CSS px 显示时插值把模块边缘糊掉，
// 于是「长按识别二维码」这种截图解码路径认不出来（摄像头对着物理屏幕多帧采样反而没事）。
// 结果是用手机开面板的单设备用户无法扫码 —— 他既不能长按识别，也没法用摄像头扫自己屏幕。
// NapCat 的 launcher 日志里同时打印了这张码的原始内容（`二维码解码URL: https://txz.qq.com/p?k=...`），
// 把它透给前端，由浏览器用原始数据重新编码一张模块 10px 的码，属于无损重建，不存在放大失真。
//
// 【安全】这个 URL 等价于登录凭据：谁拿到谁能完成授权。所以它只能跟着
// readQr() 走 /qrcode、/refresh、/image 这三个**已按 owner 校验租约**的出口下发，
// 绝不能出现在无副作用、非持有者也能读的 /status 里。
const QR_LOG_PATH = process.env.NAPCAT_LAUNCHER_LOG_PATH || path.join(NAPCAT_WORKDIR, 'logs', 'napcat-launcher.log');
// 日志会长到几 MB，只读尾部。一轮换码之间的 ASCII art 约 1~2KB，256KB 足够覆盖。
const QR_LOG_TAIL_BYTES = Number(process.env.NAPCAT_QR_LOG_TAIL_BYTES) || 262144;
// 只有当日志里「已保存到 qrcode.png」的时间戳与文件 mtime 足够接近时，才认为这条 URL
// 对应的就是当前这张图。否则宁可不下发（前端自动退回原始 PNG），
// 也绝不能把上一轮的旧 URL 当成当前码发出去 —— 那等于把别人的登录码交给用户。
const QR_URL_MATCH_TOLERANCE_MS = Number(process.env.NAPCAT_QR_URL_TOLERANCE_MS) || 20000;
// 【重要】2026-08-19 实测 launcher.log 确认：NapCat **自己就会在同一会话内
// 每 ~122 秒原地重写 qrcode.png 轮换二维码**（例：10:27:55 冷启动后，
// 10:29:57 / 10:31:59 / ... / 10:48:14 均无冷启动而自行换码）。
// 所以绝不能在这里自己搞“二维码过期就 stop+start”：
// 一旦阈值小于轮换周期，就会把用户正在扫的会话反复打死（已踩过这个坑）。
// 会话活着就直接读当前文件，让 NapCat 自己负责新鲜度。
// 二维码生成、快速登录和 OpenAuth 共用一个串行队列，防止操作同一 QQ 进程时互相 stop/start。
// 扫码归属隔离由下方 lease 负责。
// 启动/重启会话必须串行，否则并发请求会互相杀进程。
let qrQueue = Promise.resolve();

// NapCat 首次登录新 QQ 时可能生成空的 onebot11_<uin>.json；补齐本地 HTTP
// 服务，否则扫码虽然登录成功，bridge 仍识别不到登录态和农场 OpenAuth。
function ensureOneBotHttpConfigs() {
  try {
    for (const name of fs.readdirSync(NAPCAT_CONFIG_DIR)) {
      if (!/^onebot11(?:_\d+)?\.json$/i.test(name)) continue;
      const file = path.join(NAPCAT_CONFIG_DIR, name);
      let config;
      try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      if (!config || typeof config !== 'object') continue;
      if (!config.network || typeof config.network !== 'object') config.network = {};
      const servers = Array.isArray(config.network.httpServers) ? config.network.httpServers : [];
      if (servers.some(item => item && item.enable !== false && Number(item.port) === 3001)) continue;
      config.network.httpServers = [{
        host: '127.0.0.1', port: 3001, enable: true, enableCors: false,
        token: '', messagePostFormat: 'array', name: 'http-server',
        enableWebsocket: false, debug: false,
      }, ...servers.filter(Boolean)];
      try { fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`); } catch {}
    }
  } catch {}
}
ensureOneBotHttpConfigs();
const oneBotConfigWatcher = setInterval(ensureOneBotHttpConfigs, 100);
oneBotConfigWatcher.unref();

function enqueueAuthorization(task) {
  const run = qrQueue.then(task, task);
  qrQueue = run.catch(() => {});
  return run;
}

function enqueueQr(task) {
  const run = qrQueue.then(task, task);
  qrQueue = run.catch(() => {});
  return run;
}

// ===== 扫码会话租约（多人并发保护）=====
// NapCat 是全局单例：一个 qrcode.png、一份 session-home、一个按需启停的 QQ 进程。
// 队列只保证请求串行，不保证隔离。多人同时扫码时曾出现三种互踩：
//   1) B 拿到的是 A 的二维码，扫完登进去的是 A 的 QQ；
//   2) 任何人点“刷新二维码”都会 stop+start，把别人正在扫的会话打死；
//   3) A 授权成功后 finally 里 stopTemporaryNapCat，顺带把 B 的会话关掉。
// 这里用一份租约把单例串成“谁占谁用”，并在被占用时明确告知等待时间，
// 而不是静默发给对方一张别人的码。
// 空闲超时按“最后一次活动”计算：前端 2s 轮询会持续续租，
// 用户关掉页面即停止续租，约 IDLE 后自动释放，避免开着页面不扫堵死所有人。
// 【重要】2026-08-24 从 45s 降到 5s。单独降这个值会引入两个新 bug，
// 必须配套下面三个机制，不能只改 IDLE：
//   1) 取码要 stop+start QQ（最长 QR_TIMEOUT_MS），期间前端没有轮询在续租，
//      5s 空闲会让租约在自己取码途中被别人抢走 → 用 busy 保护长操作。
//   2) 手机长按二维码会切到 QQ，页面转后台后浏览器会冻结定时器，轮询停摆，
//      5s 会把正在扫的人踢掉 → 已发过码的会话给 SCAN_GRACE 宽限。
//   3) 关浏览器的常见情况不该靠超时硬等 → 前端卸载时调 /release 主动交回，瞬时生效。
const LEASE_IDLE_MS = Number(process.env.NAPCAT_LEASE_IDLE_MS) || 5000;
// 已经发出二维码的会话：从最后一次接触算起的扫码宽限（手机切到 QQ 时页面在后台）。
const LEASE_SCAN_GRACE_MS = Number(process.env.NAPCAT_LEASE_SCAN_GRACE_MS) || 10000;
// busy（取码/授权进行中）不受空闲超时约束，但必须有硬上限：
// 否则一次卡死的授权会把全局单例永久锁死（旧版就是无限期，是个死锁风险）。
const LEASE_BUSY_MAX_MS = Number(process.env.NAPCAT_LEASE_BUSY_MAX_MS) || 120000;
// 授权耗时不可预测，给等待者一个固定重试提示，而不是报一个吓人的 120s。
const BUSY_RETRY_HINT_MS = 15000;
// 【防恶意占用】开着页面不扫的人靠 2s 轮询可以无限续租。
// 有人在排队时，单次持有最长到此为止，到点强制收回。没人等就不折腾。
const LEASE_MAX_HOLD_MS = Number(process.env.NAPCAT_LEASE_MAX_HOLD_MS) || 60000;
// 被强制收回后进入冷却，避免同一人立刻抢回来饿死排队者。
const LEASE_COOLDOWN_MS = Number(process.env.NAPCAT_LEASE_COOLDOWN_MS) || 30000;
// 等待者登记的有效期：超过这个时间没再来问，就不算还在排队。
const WAITER_TTL_MS = Number(process.env.NAPCAT_LEASE_WAITER_TTL_MS) || 30000;
const SYSTEM_OWNER_PREFIX = 'system:';
// { owner, claimedAt, renewedAt, expiresAt, busy, busySince, qrIssued, scanUntil }
let lease = null;
const waiters = new Map(); // owner -> 最后一次被 409 拒绝的时间
const cooldowns = new Map(); // owner -> 冷却到期时间戳

function logLease(event, detail) {
  console.log(`[扫码租约] ${event} ${JSON.stringify(detail)}`);
}

function isSystemOwner(owner) {
  return String(owner || '').startsWith(SYSTEM_OWNER_PREFIX);
}

// 后台无人值守任务（system:*）不算排队者：
// 它不能成为把真人扫到一半的会话踢下去的理由。
function noteWaiter(owner) {
  const who = String(owner || '').trim();
  if (who && !isSystemOwner(who)) waiters.set(who, Date.now());
}

function hasOtherWaiter(holder) {
  const now = Date.now();
  let found = false;
  for (const [who, at] of waiters) {
    if (now - at > WAITER_TTL_MS) { waiters.delete(who); continue; }
    if (who !== holder) found = true;
  }
  return found;
}

function cooldownRemainMs(owner) {
  const until = cooldowns.get(owner) || 0;
  const remain = until - Date.now();
  if (remain <= 0) { cooldowns.delete(owner); return 0; }
  return remain;
}

function leaseAlive() {
  if (!lease) return false;
  const now = Date.now();
  if (lease.busy) {
    // busy 不受空闲超时约束，但超过硬上限就当作卡死，自愈释放。
    if (now - lease.busySince > LEASE_BUSY_MAX_MS) {
      logLease('busy 超时自愈释放', { owner: lease.owner, heldMs: now - lease.busySince });
      lease = null;
      return false;
    }
    return true;
  }
  if (now < lease.expiresAt) return true;
  // 已发过码：给扫码宽限，避免手机切到 QQ 时被 5s 空闲踢掉。
  if (lease.scanUntil && now < lease.scanUntil) return true;
  return false;
}

function leaseRemainMs() {
  if (!leaseAlive()) return 0;
  if (lease.busy) return BUSY_RETRY_HINT_MS;
  const until = Math.max(lease.expiresAt, lease.scanUntil || 0);
  return Math.max(0, until - Date.now());
}

function leaseInfo() {
  if (!leaseAlive()) return { held: false };
  return { held: true, owner: lease.owner, busy: !!lease.busy, remainMs: leaseRemainMs() };
}

function releaseLease(reason) {
  if (!lease) return;
  logLease('释放', { owner: lease.owner, reason });
  lease = null;
}

function releaseLeaseIfOwner(owner, reason) {
  const who = String(owner || '').trim();
  if (lease && who && lease.owner === who) releaseLease(reason);
}

function markLeaseBusy(owner, busy) {
  const who = String(owner || '').trim();
  if (lease && who && lease.owner === who) {
    lease.busy = !!busy;
    lease.busySince = busy ? Date.now() : 0;
    if (!busy) lease.expiresAt = Date.now() + LEASE_IDLE_MS;
  }
}

// 标记“本轮租约已经发出过二维码”：
// 一是后续请求不再强制换码，二是开启扫码宽限。
function markQrIssued(owner) {
  const who = String(owner || '').trim();
  if (lease && who && lease.owner === who) {
    lease.qrIssued = true;
    lease.scanUntil = Date.now() + LEASE_SCAN_GRACE_MS;
  }
}

// 持有超时：有人排队时强制收回并让其冷却，避免开着页面把单例焊死。
// 授权进行中（busy）绝不打断：那会把人家成功一半的授权弄坏。
function enforceMaxHold(requester) {
  if (!lease || lease.busy) return;
  const heldMs = Date.now() - lease.claimedAt;
  if (heldMs < LEASE_MAX_HOLD_MS) return;
  const rival = requester && requester !== lease.owner && !isSystemOwner(requester);
  if (!rival && !hasOtherWaiter(lease.owner)) return;
  cooldowns.set(lease.owner, Date.now() + LEASE_COOLDOWN_MS);
  logLease('持有超时强制收回', { owner: lease.owner, heldMs, cooldownMs: LEASE_COOLDOWN_MS });
  releaseLease('max-hold');
}

function busyConflict(owner) {
  // 任何被拒绝的人都算排队者：max-hold 强制收回要靠这个信号，
  // 否则开着页面不扫的人可以靠 2s 轮询无限续租，把单例焊死。
  noteWaiter(owner);
  const remain = leaseRemainMs();
  const seconds = Math.max(1, Math.ceil(remain / 1000));
  logLease('拒绝', { requester: owner, holder: lease && lease.owner, remainSec: seconds });
  return {
    // error 里的秒数是响应那一刻的快照，只给日志/旧版前端兼容用。
    // 新版前端用 busyReason + retryAfterMs 自己渲染实时倒计时，
    // 否则页面上会永远卡着一个不动的秒数。
    error: `另一位用户正在扫码授权 QQ，请约 ${seconds} 秒后重试（同一时刻只能有一人扫码）`,
    busyReason: '另一位用户正在扫码授权 QQ',
    busyNote: '同一时刻只能有一人扫码',
    retryAfterMs: remain,
    busy: true,
  };
}

/**
 * 申请或续租。成功返回 null，冲突返回可直接下发的 409 载荷。
 * - 同一 owner 重复请求视为续租
 * - 租约空闲超时后视为空闲，可被他人抢占
 * - renewOnly=true 用于只读轮询：owner 匹配则续租，空闲则不占用
 */
function claimLease(owner, { renewOnly = false } = {}) {
  const who = String(owner || '').trim();
  if (!who) return { error: '缺少扫码会话归属标识', busy: false };

  enforceMaxHold(who);

  if (leaseAlive() && lease.owner !== who) return busyConflict(who);
  if (!leaseAlive()) {
    if (renewOnly) return null;
    // 刚被强制收回的人在冷却期内不能抢回来，但只在确实有人排队时才拦：
    // 没人等还拦着不让用，那是白白浪费单例。
    const cd = cooldownRemainMs(who);
    if (cd > 0 && hasOtherWaiter(who)) {
      const sec = Math.max(1, Math.ceil(cd / 1000));
      logLease('冷却中拒绝', { requester: who, remainSec: sec });
      return {
        error: `你刚占用过扫码通道，请约 ${sec} 秒后再试（正在给排队的用户让位）`,
        busyReason: '你刚占用过扫码通道',
        busyNote: '正在给排队的用户让位',
        retryAfterMs: cd,
        busy: true,
      };
    }
    if (lease) releaseLease('idle-timeout');
    lease = {
      owner: who,
      claimedAt: Date.now(),
      renewedAt: Date.now(),
      expiresAt: Date.now() + LEASE_IDLE_MS,
      busy: false,
      busySince: 0,
      qrIssued: false,
      scanUntil: 0,
    };
    waiters.delete(who);
    logLease('占用', { owner: who, idleMs: LEASE_IDLE_MS });
    return null;
  }
  lease.renewedAt = Date.now();
  if (!lease.busy) {
    lease.expiresAt = Date.now() + LEASE_IDLE_MS;
    // 持续接触的扫码会话同步往后顶宽限，否则宽限会从发码那一刻就开始倒数。
    if (lease.qrIssued) lease.scanUntil = Date.now() + LEASE_SCAN_GRACE_MS;
  }
  return null;
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

/** 读日志尾部（不整文件加载，日志有几 MB） */
function readLogTail(bytes) {
  let fd;
  try {
    fd = fs.openSync(QR_LOG_PATH, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(bytes, size);
    if (!length) return '';
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, size - length);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

// 日志时间戳没有年份（`08-25 09:59:43`），按当年补齐；
// 跨年时会算出一个「未来」的日期，回退一年。
function parseLogStamp(mm, dd, HH, MM, SS) {
  const now = new Date();
  const build = year => new Date(year, Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS)).getTime();
  let at = build(now.getFullYear());
  if (at - now.getTime() > 86400000) at = build(now.getFullYear() - 1);
  return at;
}

const QR_SAVED_RE = /(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})[^\n]*?二维码已保存到/g;
const QR_URL_RE = /二维码解码URL[:：]\s*(\S+)/g;

/**
 * 取当前 qrcode.png 对应的解码 URL；拿不准就返回空（前端退回原始 PNG）。
 * 日志顺序固定为：`二维码解码URL: ...` → ASCII art → `二维码已保存到 ...qrcode.png`，
 * 所以「最后一个保存标记」之前的「最后一条 URL」就是当前这张图的内容。
 */
function readQrUrl(pngUpdatedAt) {
  const tail = readLogTail(QR_LOG_TAIL_BYTES);
  if (!tail) return '';

  let saved = null;
  QR_SAVED_RE.lastIndex = 0;
  for (let m = QR_SAVED_RE.exec(tail); m; m = QR_SAVED_RE.exec(tail)) {
    saved = { index: m.index, at: parseLogStamp(m[1], m[2], m[3], m[4], m[5]) };
  }
  if (!saved) return '';
  // 时间戳对不上 = 这条日志不是当前这张图，宁可不发。
  if (Math.abs(saved.at - pngUpdatedAt) > QR_URL_MATCH_TOLERANCE_MS) return '';

  let url = '';
  QR_URL_RE.lastIndex = 0;
  for (let m = QR_URL_RE.exec(tail); m; m = QR_URL_RE.exec(tail)) {
    if (m.index > saved.index) break;
    url = m[1];
  }
  // 去掉可能夹带的 ANSI/控制字符，并做一次协议白名单校验。
  url = url.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!/^https?:\/\/\S+$/.test(url)) return '';
  return url;
}

function readQr(info) {
  // qrUrl 只在能与当前 PNG 对上时才带出；拿不到就只回 PNG，前端自动降级。
  const qrUrl = readQrUrl(info.updatedAt);
  return {
    qrcode: `data:image/png;base64,${fs.readFileSync(QR_PATH).toString('base64')}`,
    updatedAt: info.updatedAt,
    ageMs: info.ageMs,
    ...(qrUrl ? { qrUrl } : {}),
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
    // 轮询是只读的，永远返回 200：不占租约，但持有者会因此续租。
    // 非持有者也能看到 scanLease.held，前端据此提示“有人正在扫码”，
    // 而不是把别人的二维码/登录态当成自己的。
    const owner = String(url.searchParams.get('owner') || '').trim();
    const holder = leaseAlive() ? lease.owner : '';
    const isOwner = !!owner && holder === owner;
    if (isOwner) claimLease(owner, { renewOnly: true });
    let loggedIn = false;
    let profile = null;
    try {
      profile = await getNapCatLoginProfile();
      loggedIn = !!profile.uin;
    } catch {}
    const info = statQr();
    // 会话归别人时不外泄对方的登录态与 QQ 资料。
    const visible = !holder || isOwner;
    return json(res, 200, {
      ok: true,
      data: {
        loggedIn: visible ? loggedIn : false,
        profile: visible && loggedIn ? profile : undefined,
        hasQr: visible ? !!info : false,
        ageMs: visible && info ? info.ageMs : null,
        updatedAt: visible && info ? info.updatedAt : null,
        sessionActive: await isTemporaryNapCatServiceActive(),
        scanLease: { ...leaseInfo(), mine: isOwner },
      },
    });
  }
  if (req.method === 'GET' && url.pathname === '/image') {
    // 无副作用：只读当前 qrcode.png。NapCat 自己每 ~122s 重写该文件，
    // 前端靠 updatedAt 变化拉这个接口跟随换图，全程不碰进程。
    // 但必须校验归属：否则会把持有者正在扫的那张码发给别人，
    // 导致对方扫完登进去的是持有者的 QQ。
    const owner = String(url.searchParams.get('owner') || '').trim();
    if (leaseAlive() && lease.owner !== owner) return json(res, 409, { ok: false, ...busyConflict(owner) });
    if (owner) claimLease(owner, { renewOnly: true });
    const info = statQr();
    if (!info) return json(res, 404, { ok: false, error: '当前无二维码' });
    return json(res, 200, { ok: true, data: readQr(info) });
  }
  if (req.method === 'GET' && url.pathname === '/qrcode') {
    const owner = String(url.searchParams.get('owner') || '').trim();
    const conflict = claimLease(owner);
    if (conflict) return json(res, 409, { ok: false, ...conflict });
    // 本轮租约还没发过码 = 新会话（换人，或同一人重开弹窗）。
    // 这种情况必须强制换一张新码，绝不能把上一轮的旧码/残留登录态交出去：
    //   - 旧码可能正是上一个人在扫的那张，对方扫完登进去的是别人的 QQ；
    //   - 残留登录态会让新来的人一点「添加」就把别人的 QQ 挂到自己名下。
    // force 走 stop → 删码 → start，顺带把上一轮的残留会话清干净。
    const freshLease = !!lease && !lease.qrIssued;
    // 取码要 stop+start（最长 QR_TIMEOUT_MS），这期间前端在等响应、没有轮询续租。
    // 不置 busy 的话 5s 空闲会让自己在取码途中被别人抢走。
    markLeaseBusy(owner, true);
    try {
      if (!freshLease) {
        // 续租且本轮已发过码：用户可能刚扫上，复用登录态直接进授权。
        try {
          const profile = await getNapCatLoginProfile();
          if (profile.uin) return json(res, 200, { ok: true, data: { loggedIn: true, profile } });
        } catch {}
      }
      const qr = await enqueueQr(() => ensureQr({ force: freshLease }));
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      // 取码失败就别继续占着单例，让下一个人马上能用。
      releaseLeaseIfOwner(owner, 'qrcode-failed');
      return json(res, 502, { ok: false, error: error.message });
    } finally {
      markLeaseBusy(owner, false);
      markQrIssued(owner);
    }
  }
  if (req.method === 'POST' && url.pathname === '/refresh') {
    // force=true 会 stop+start 全局会话，必须是持有者才能做，
    // 否则任何人点一下刷新就能把别人正在扫的码打死。
    const owner = String(url.searchParams.get('owner') || '').trim();
    const conflict = claimLease(owner);
    if (conflict) return json(res, 409, { ok: false, ...conflict });
    markLeaseBusy(owner, true);
    try {
      const qr = await enqueueQr(() => ensureQr({ force: true }));
      return json(res, 200, { ok: true, data: { loggedIn: false, ...qr } });
    } catch (error) {
      releaseLeaseIfOwner(owner, 'refresh-failed');
      return json(res, 502, { ok: false, error: error.message });
    } finally {
      markLeaseBusy(owner, false);
      markQrIssued(owner);
    }
  }
  // 关页面/切走时主动交回租约：不靠空闲超时硬等，下一个人立刻能扫。
  if (req.method === 'POST' && url.pathname === '/release') {
    const body = await readBody(req).catch(() => ({}));
    const owner = String((body && body.owner) || url.searchParams.get('owner') || '').trim();
    if (!owner) return json(res, 200, { ok: true, data: { released: false, reason: 'no-owner' } });
    if (lease && lease.owner === owner && lease.busy) {
      return json(res, 200, { ok: true, data: { released: false, reason: 'busy' } });
    }
    const held = !!lease && lease.owner === owner;
    releaseLeaseIfOwner(owner, 'client-release');
    waiters.delete(owner);
    return json(res, 200, { ok: true, data: { released: held } });
  }
  // 页面从后台切回时的“软重新占用”：不换码、不重启会话。
  // 必要性：iOS Safari 切到 QQ app 扫码时也可能触发 pagehide，
  // 那会把正在扫码的自己的租约交回去。回前台后靠这个接口拿回来，
  // 屏幕上那张码继续有效；若已被别人抢走则返回 409，前端改成排队提示。
  if (req.method === 'POST' && url.pathname === '/reclaim') {
    const body = await readBody(req).catch(() => ({}));
    const owner = String((body && body.owner) || url.searchParams.get('owner') || '').trim();
    const conflict = claimLease(owner);
    if (conflict) return json(res, 409, { ok: false, ...conflict });
    // 屏幕上已有一张活码，标记 qrIssued 避免后续请求把它强制换掉。
    const info = statQr();
    if (info) markQrIssued(owner);
    return json(res, 200, { ok: true, data: { reclaimed: true, hasQr: !!info } });
  }
  if (req.method === 'POST' && url.pathname === '/authorize') {
    let owner = '';
    try {
      const body = await readBody(req);
      const quickUin = String(body.uin || '').trim();
      owner = String(body.owner || '').trim();
      // 授权内部会 stopTemporaryNapCat({cacheUin})，会把全局会话关掉。
      // 所以必须持有租约才能授权，否则 A 的成功会顺带杀掉 B 正在扫的会话。
      // 后台定时刷 Code（system:*）同样要让路：用户正在扫码时宁可稍后重试，
      // 也不能把人家扫到一半的会话抢走。
      const conflict = claimLease(owner);
      if (conflict) return json(res, 409, { ok: false, ...conflict });
      markLeaseBusy(owner, true);
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
    } finally {
      // 授权是终点：无论成败都立即释放，下一个人马上能扫。
      markLeaseBusy(owner, false);
      releaseLeaseIfOwner(owner, 'authorize-done');
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
