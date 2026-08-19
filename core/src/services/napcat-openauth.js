const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { execFile, spawn } = require('node:child_process');
const fetch = require('node-fetch');

const NAPCAT_FARM_APP_ID = '1112386029';
const NAPCAT_OPEN_AUTH_ACTION = `start_mini_app_${NAPCAT_FARM_APP_ID}`;
const NAPCAT_SYSTEMD_UNIT = 'napcat-shell.service';
// All NapCat state lives under one root so the same code can run against the
// host layout (/opt/napcat-docker) or a container volume (/app/napcat-data).
const NAPCAT_WORKDIR = String(process.env.NAPCAT_WORKDIR || '/opt/napcat-docker');
const NAPCAT_CONFIG_DIR = path.join(NAPCAT_WORKDIR, 'config');
const NAPCAT_QR_IMAGE_PATH = process.env.NAPCAT_QR_IMAGE_PATH || path.join(NAPCAT_WORKDIR, 'cache', 'qrcode.png');
const NAPCAT_PID_FILE = process.env.NAPCAT_PID_FILE || '/run/qqfarm-napcat.pid';
const NAPCAT_SESSION_HOME = path.join(NAPCAT_WORKDIR, 'session-home');
const NAPCAT_QUICK_LOGIN_ROOT = path.join(NAPCAT_WORKDIR, 'quick-login-profiles');
// 'systemd' drives the host user unit (legacy layout). 'process' spawns the
// launcher directly, which is what the container uses since it has no systemd.
const NAPCAT_LAUNCH_MODE = String(process.env.NAPCAT_LAUNCH_MODE || 'systemd').toLowerCase();
const NAPCAT_LAUNCHER = String(process.env.NAPCAT_LAUNCHER || '');
const USER_SYSTEMD_ENV = {
    ...process.env,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/0',
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/run/user/0/bus',
};
const runtimeState = { lastActionAt: 0, lastActionOk: false, lastErrorStage: '' };

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { timeout: 15000, ...options }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

async function runUserSystemctl(args) {
    return runCommand('/bin/systemctl', ['--user', ...args], { env: USER_SYSTEMD_ENV });
}

function readLauncherPid() {
    try {
        const pid = Number(String(fs.readFileSync(NAPCAT_PID_FILE, 'utf8')).trim());
        return Number.isInteger(pid) && pid > 1 ? pid : 0;
    } catch (_) {
        return 0;
    }
}

function isLauncherPidAlive(pid) {
    if (!pid) return false;
    try {
        // Confirm the PID is still our QQ launcher and not a recycled unrelated
        // process before reporting busy or sending any signal to it.
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        return /(^|[\s/])qq(\s|$)/.test(cmdline) || cmdline.includes('launch-qq.sh');
    } catch (_) {
        return false;
    }
}

async function isTemporaryNapCatServiceActive() {
    if (NAPCAT_LAUNCH_MODE === 'process') return isLauncherPidAlive(readLauncherPid());
    try {
        await runUserSystemctl(['is-active', '--quiet', NAPCAT_SYSTEMD_UNIT]);
        return true;
    } catch (_) {
        return false;
    }
}

async function startLauncherProcess() {
    if (!NAPCAT_LAUNCHER) throw new Error('NAPCAT_LAUNCHER is not configured');
    fs.mkdirSync(path.join(NAPCAT_WORKDIR, 'logs'), { recursive: true });
    const logPath = path.join(NAPCAT_WORKDIR, 'logs', 'napcat-launcher.log');
    const logFd = fs.openSync(logPath, 'a');
    try {
        const child = spawn(NAPCAT_LAUNCHER, [], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
            env: { ...process.env, NAPCAT_WORKDIR },
        });
        child.unref();
        if (!child.pid) throw new Error('failed to spawn NapCat launcher');
        fs.mkdirSync(path.dirname(NAPCAT_PID_FILE), { recursive: true });
        fs.writeFileSync(NAPCAT_PID_FILE, String(child.pid));
    } finally {
        fs.closeSync(logFd);
    }
}

async function stopLauncherProcess() {
    const pid = readLauncherPid();
    if (!isLauncherPidAlive(pid)) {
        try { fs.unlinkSync(NAPCAT_PID_FILE); } catch (_) {}
        return;
    }
    // The launcher is spawned detached, so it leads its own process group.
    // Signalling the group reaps the Electron children too.
    try { process.kill(-pid, 'SIGTERM'); } catch (_) {
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (!isLauncherPidAlive(pid)) break;
        await sleep(250);
    }
    if (isLauncherPidAlive(pid)) {
        try { process.kill(-pid, 'SIGKILL'); } catch (_) {
            try { process.kill(pid, 'SIGKILL'); } catch (_) {}
        }
    }
    try { fs.unlinkSync(NAPCAT_PID_FILE); } catch (_) {}
}

function normalizeUin(uin) {
    const value = String(uin || '').trim();
    if (!/^\d{5,20}$/.test(value)) throw new Error('invalid QQ account identifier');
    return value;
}

function quickLoginProfilePath(uin) {
    return path.join(NAPCAT_QUICK_LOGIN_ROOT, normalizeUin(uin));
}

function sessionQQConfigPath() {
    return path.join(NAPCAT_SESSION_HOME, '.config', 'QQ');
}

async function startTemporaryNapCat(options = {}) {
    const quickUin = options.quickUin ? normalizeUin(options.quickUin) : '';
    if (await isTemporaryNapCatServiceActive()) {
        if (quickUin) throw new Error('temporary QQ authorizer is busy');
        return { started: false, starting: true };
    }
    if (quickUin) {
        const profilePath = quickLoginProfilePath(quickUin);
        if (!fs.existsSync(profilePath)) throw new Error('该 QQ 尚未保存快速登录资料，请先扫码授权一次');
        fs.rmSync(NAPCAT_SESSION_HOME, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(sessionQQConfigPath()), { recursive: true });
        fs.cpSync(profilePath, sessionQQConfigPath(), { recursive: true });
    } else {
        try {
            fs.unlinkSync(NAPCAT_QR_IMAGE_PATH);
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
    }
    if (NAPCAT_LAUNCH_MODE === 'process') await startLauncherProcess();
    else await runUserSystemctl(['start', NAPCAT_SYSTEMD_UNIT]);
    return { started: true, starting: true, quickUin: quickUin || undefined };
}

async function stopTemporaryNapCat(options = {}) {
    const cacheUin = options.cacheUin ? normalizeUin(options.cacheUin) : '';
    // Only save a profile after verifying that the temporary authorizer really
    // logged into that same QQ. Never overwrite a saved quick-login profile
    // with an unauthenticated QR session or the wrong QQ's session.
    let canCacheProfile = false;
    if (cacheUin) {
        try {
            const profile = await getNapCatLoginProfile();
            canCacheProfile = profile.uin === cacheUin;
        } catch (_) {}
    }

    // Service-managed sessions stop cleanly. The PID fallback retires the
    // pre-existing detached launcher during this migration only.
    if (NAPCAT_LAUNCH_MODE === 'process') {
        await stopLauncherProcess();
    } else {
        try {
            await runUserSystemctl(['stop', NAPCAT_SYSTEMD_UNIT]);
        } catch (_) {}
    }

    if (cacheUin && canCacheProfile) {
        try {
            const source = sessionQQConfigPath();
            if (fs.existsSync(source)) {
                const target = quickLoginProfilePath(cacheUin);
                fs.rmSync(target, { recursive: true, force: true });
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.cpSync(source, target, { recursive: true });
            }
        } catch (_) {}
    }

    // This directory belongs only to the temporary authorizer. Removing it
    // makes a manual add-account flow show a new QR; saved per-QQ profiles are
    // retained separately above for unattended Code refreshes.
    try { fs.rmSync(NAPCAT_SESSION_HOME, { recursive: true, force: true }); } catch (_) {}

    // Process mode already reaped the launcher and its group above; the legacy
    // host-only PID sweep below must not run against a container PID namespace.
    if (NAPCAT_LAUNCH_MODE === 'process') return { stopped: true, legacySession: false };

    let pid = 0;
    try { pid = Number(fs.readFileSync(NAPCAT_PID_FILE, 'utf8').trim()); } catch (_) {}
    if (!Number.isInteger(pid) || pid <= 1) return { stopped: true, legacySession: false };
    try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
        const isNapCatLauncher = cmdline.includes('/opt/napcat-shell')
            && (cmdline.includes('xvfb-run') || cmdline.includes('/qq '));
        if (!isNapCatLauncher) return { stopped: true, legacySession: false };
        // Never signal the OpenClaw gateway: only the known launcher and direct children.
        try { await runCommand('/usr/bin/pkill', ['-TERM', '-P', String(pid)]); } catch (_) {}
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        try { fs.unlinkSync(NAPCAT_PID_FILE); } catch (_) {}
        return { stopped: true, legacySession: true };
    } catch (_) {
        return { stopped: true, legacySession: false };
    }
}

function getWebUiConfigCandidates() {
    const candidates = [];
    const add = (value) => {
        const file = String(value || '').trim();
        if (file && !candidates.includes(file)) candidates.push(file);
    };
    add(process.env.NAPCAT_WEBUI_CONFIG);
    try {
        for (const entry of fs.readdirSync('/proc')) {
            if (!/^\d+$/.test(entry)) continue;
            try {
                const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ');
                if (!/(^|\s)(\.\/)?qq(\s|$)/.test(cmdline)) continue;
                add(path.join(fs.readlinkSync(`/proc/${entry}/cwd`), 'config', 'webui.json'));
            } catch (_) {}
        }
    } catch (_) {}
    add(path.join(NAPCAT_CONFIG_DIR, 'webui.json'));
    add('/app/napcat/config/webui.json');
    add('/opt/napcat-shell/config/webui.json');
    add('/opt/napcat-shell.bak-20260709093049/config/webui.json');
    add('/opt/napcat-docker/config/webui.json');
    return candidates;
}

async function postJson(url, body, headers = {}, timeout = Number(process.env.NAPCAT_TIMEOUT_MS) || 8000) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {}),
        timeout,
    });
    let json = null;
    try { json = await response.json(); } catch (_) { throw new Error(`NapCat HTTP ${response.status} returned non-JSON`); }
    if (!response.ok) throw new Error(`NapCat HTTP ${response.status}`);
    return json;
}

async function getNapCatRuntimeOneBot() {
    const webUiBase = String(process.env.NAPCAT_WEBUI_BASE_URL || 'http://127.0.0.1:6099').replace(/\/+$/, '');
    let lastError = null;
    for (const configPath of getWebUiConfigCandidates()) {
        try {
            if (!fs.existsSync(configPath)) continue;
            const webUiConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const webUiToken = String(webUiConfig.token || '');
            if (!webUiToken) continue;
            const hash = crypto.createHash('sha256').update(`${webUiToken}.napcat`).digest('hex');
            const login = await postJson(`${webUiBase}/api/auth/login`, { hash });
            const credential = String(login?.data?.Credential || '');
            if (login?.code !== 0 || !credential) throw new Error('WebUI authentication failed');
            const obConfig = await postJson(`${webUiBase}/api/OB11Config/GetConfig`, {}, { Authorization: `Bearer ${credential}` });
            const servers = Array.isArray(obConfig?.data?.network?.httpServers) ? obConfig.data.network.httpServers : [];
            const configuredBase = new URL(String(process.env.NAPCAT_BASE_URL || 'http://127.0.0.1:3000'));
            const configuredPort = Number(configuredBase.port || (configuredBase.protocol === 'https:' ? 443 : 80));
            const httpServer = servers.find(item => item && item.enable !== false && Number(item.port) === configuredPort)
                || servers.find(item => item && item.enable !== false);
            const oneBotToken = String(httpServer?.token || '');
            if (!httpServer) throw new Error('OneBot HTTP server missing');
            return { oneBotBaseUrl: `${configuredBase.protocol}//${configuredBase.hostname}:${httpServer.port}`, oneBotToken };
        } catch (e) { lastError = e; }
    }
    // Fall back to NapCat's local OneBot configuration when its WebUI token
    // rotates. The adapter is loopback-only, and this avoids showing a stale
    // QR code while an already scanned QQ session is actually available.
    try {
        const configuredBase = new URL(String(process.env.NAPCAT_BASE_URL || 'http://127.0.0.1:3001'));
        const configDir = NAPCAT_CONFIG_DIR;
        const files = fs.existsSync(configDir) ? fs.readdirSync(configDir).filter(name => /^onebot11.*\.json$/i.test(name)) : [];
        for (const name of files) {
            try {
                const cfg = JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'));
                const servers = Array.isArray(cfg?.network?.httpServers) ? cfg.network.httpServers : [];
                const server = servers.find(item => item && item.enable !== false && Number(item.port) === Number(configuredBase.port || 3001));
                if (server) {
                    const oneBotBaseUrl = `${configuredBase.protocol}//${configuredBase.hostname}:${server.port}`;
                    const oneBotToken = String(server.token || '');
                    const probeHeaders = oneBotToken ? { Authorization: `Bearer ${oneBotToken}` } : {};
                    const probe = await postJson(`${oneBotBaseUrl}/get_login_info`, {}, probeHeaders);
                    if (Number(probe?.retcode) === 0) return { oneBotBaseUrl, oneBotToken };
                }
            } catch (_) {}
        }
    } catch (_) {
        // Retain the more useful WebUI error below.
    }
    throw new Error(lastError?.message || 'NapCat WebUI runtime authentication unavailable');
}

async function requestNapCatFarmAuthorization() {
    const runtime = await getNapCatRuntimeOneBot();
    try {
        const headers = runtime.oneBotToken ? { Authorization: `Bearer ${runtime.oneBotToken}` } : {};
        const actionUrl = `${runtime.oneBotBaseUrl}/${NAPCAT_OPEN_AUTH_ACTION}`;
        let lastError = null;

        // Restored quick-login sessions can report logged-in before the mini-app
        // authorization bridge is ready. Retry the two supported actions briefly
        // instead of treating the first empty result as a permanent failure.
        for (let attempt = 1; attempt <= 3; attempt++) {
            for (const path of ['__open_code__', '__login_with_appid__']) {
                try {
                    const response = await postJson(actionUrl, { path }, headers);
                    const result = response?.data?.result || {};
                    const accessToken = String(typeof result === 'string'
                        ? result
                        : (result.code || result.openCode || result.authCode || result.accessToken || result.result || ''));
                    const openId = String(typeof result === 'object' && result ? (result.openId || result.openID || '') : '');
                    const resultCode = typeof result === 'object' && result
                        ? Number(result.errorCode ?? result.errCode ?? 0)
                        : 0;
                    if (response?.retcode === 0 && resultCode === 0 && accessToken) {
                        runtimeState.lastActionAt = Date.now();
                        runtimeState.lastActionOk = true;
                        runtimeState.lastErrorStage = '';
                        return {
                            code: accessToken,
                            openID: openId,
                            expiresAt: Number(result.expiresAt || result.expireAt || result.expireTime || 0) || null,
                        };
                    }
                    lastError = new Error(`NapCat ${path} returned no usable Code`);
                } catch (error) {
                    lastError = error;
                }
            }
            if (attempt < 3) await sleep(attempt * 1500);
        }
        throw lastError || new Error('NapCat farm authorization failed');
    } catch (e) {
        runtimeState.lastActionAt = Date.now();
        runtimeState.lastActionOk = false;
        runtimeState.lastErrorStage = 'open_auth_action';
        throw e;
    }
}

async function getNapCatLoginProfile() {
    const runtime = await getNapCatRuntimeOneBot();
    const headers = runtime.oneBotToken ? { Authorization: `Bearer ${runtime.oneBotToken}` } : {};
    const response = await postJson(`${runtime.oneBotBaseUrl}/get_login_info`, {}, headers);
    const data = response?.data || {};
    const uin = String(data.user_id || data.uin || data.qq || '').trim();
    const nickname = String(data.nickname || data.nick || '').trim();
    return {
        uin,
        nickname,
        avatar: uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=640` : '',
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestQuickLogin(uin) {
    const configPath = getWebUiConfigCandidates().find(file => {
        try { return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token; } catch (_) { return false; }
    });
    if (!configPath) throw new Error('NapCat WebUI config not found');
    const webUiConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hash = crypto.createHash('sha256').update(`${webUiConfig.token}.napcat`).digest('hex');
    const base = String(process.env.NAPCAT_WEBUI_BASE_URL || 'http://127.0.0.1:6099').replace(/\/+$/, '');
    const login = await postJson(`${base}/api/auth/login`, { hash }, {}, 3000);
    const credential = String(login?.data?.Credential || '');
    if (login?.code !== 0 || !credential) throw new Error('NapCat WebUI authentication failed');
    const result = await postJson(`${base}/api/QQLogin/SetQuickLogin`, { uin }, { Authorization: `Bearer ${credential}` }, 5000);
    if (result?.code !== 0) throw new Error(result?.message || 'NapCat quick login failed');
}

async function ensureTemporaryNapCatForUin(uin) {
    const targetUin = normalizeUin(uin);
    // The temporary authorizer is single-account. Replace any QR/manual
    // session with this account's saved quick-login profile.
    if (await isTemporaryNapCatServiceActive()) {
        await stopTemporaryNapCat();
    }
    await startTemporaryNapCat({ quickUin: targetUin });

    const deadline = Date.now() + 60000;
    let lastError = null;
    let nextQuickLoginAt = Date.now();
    while (Date.now() < deadline) {
        try {
            const runtime = await getNapCatRuntimeOneBot();
            const profile = await getNapCatLoginProfile();
            if (profile.uin === targetUin) return runtime;
            lastError = new Error(`临时授权器登录 QQ 不匹配（当前 ${profile.uin || '未登录'}，目标 ${targetUin}）`);
        } catch (e) {
            lastError = e;
        }

        // The restored profile is the source of the quick-login parameters.
        // Once NapCat WebUI is ready, actively select this UIN. Retry because
        // WebUI may be listening before its authentication service is ready.
        if (Date.now() >= nextQuickLoginAt) {
            try {
                await requestQuickLogin(targetUin);
                nextQuickLoginAt = Date.now() + 5000;
            } catch (e) {
                lastError = e;
                nextQuickLoginAt = Date.now() + 1500;
            }
        }
        await sleep(1000);
    }
    throw new Error(lastError?.message || 'NapCat 快速登录超时');
}

function getNapCatRuntimeState() {
    return { ...runtimeState };
}

module.exports = {
    NAPCAT_FARM_APP_ID,
    NAPCAT_OPEN_AUTH_ACTION,
    getNapCatRuntimeOneBot,
    requestNapCatFarmAuthorization,
    getNapCatLoginProfile,
    getNapCatRuntimeState,
    startTemporaryNapCat,
    stopTemporaryNapCat,
    ensureTemporaryNapCatForUin,
};
