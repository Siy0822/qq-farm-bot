const { fork } = require('node:child_process');
const path = require('node:path');
const process = require('node:process');
const { Worker } = require('node:worker_threads');
const store = require('../models/store');
const { updateRuntimeConfig } = require('../config/config');
const { sleep } = require('../utils/utils');
const { sendPushooMessage, sendSmtpEmail } = require('../services/push');
const { MiniProgramLoginSession } = require('../services/qrlogin');
const { createAutoCodeRefreshService } = require('./auto-code-refresh');
const { createDataProvider } = require('./data-provider');
const { createReloginReminderService } = require('./relogin-reminder');
const { createRuntimeState } = require('./runtime-state');
const { createWorkerManager } = require('./worker-manager');

/** 操作类型键列表 */
const OPERATION_KEYS = [
    'harvest', 'water', 'weed', 'bug', 'farming', 'fertilize', 'plant',
    'steal', 'helpWater', 'helpWeed', 'helpBug',
    'taskClaim', 'sell', 'upgrade', 'tongQiGift'
];

/**
 * 创建运行时引擎
 * @param {object} options
 * @param {object} options.processRef - process 引用
 * @param {string} options.mainEntryPath - 主入口文件路径
 * @param {string} options.workerScriptPath - Worker 脚本路径
 * @param {string} options.runtimeMode - 运行模式 'thread' | 'fork'
 * @param {Function} options.onStatusSync - 状态同步回调
 * @param {Function} options.onLog - 日志回调
 * @param {Function} options.onAccountLog - 账号日志回调
 * @param {Function} options.startAdminServer - 启动管理服务器回调
 */
function createRuntimeEngine(options = {}) {
    const processRef = options.processRef || process;
    const mainEntryPath = options.mainEntryPath || path.join(__dirname, '../../client.js');
    const workerScriptPath = options.workerScriptPath || path.join(__dirname, '../core/worker.js');
    const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase();
    const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null;
    const onLog = typeof options.onLog === 'function' ? options.onLog : null;
    const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null;
    const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null;

    // Worker 启动/重启的引用占位
    const engine = { startWorker: null, restartWorker: null };

    // 创建运行时状态
    const runtimeState = createRuntimeState({
        store,
        operationKeys: OPERATION_KEYS
    });

    const {
        workers,
        globalLogs,
        accountLogs,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs
    } = runtimeState;

    // 创建重登提醒服务
    const reloginReminder = createReloginReminderService({
        store,
        miniProgramLoginSession: MiniProgramLoginSession,
        sendPushooMessage,
        sendSmtpEmail,
        log,
        addAccountLog,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        resolveWorkerControls: () => engine
    });
    const { getOfflineAutoDeleteMs, triggerOfflineReminder } = reloginReminder;

    const autoCodeRefresh = createAutoCodeRefreshService({
        store,
        getAccounts: store.getAccounts,
        addOrUpdateAccount: store.addOrUpdateAccount,
        resolveWorkerControls: () => engine,
        log,
        addAccountLog
    });

    // 创建 Worker 管理器
    const {
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi
    } = createWorkerManager({
        fork,
        WorkerThread: Worker,
        runtimeMode,
        processRef,
        mainEntryPath,
        workerScriptPath,
        workers,
        globalLogs,
        store,
        log,
        addAccountLog,
        normalizeStatusForPanel,
        buildConfigSnapshotForAccount,
        getOfflineAutoDeleteMs,
        triggerOfflineReminder,
        addOrUpdateAccount: store.addOrUpdateAccount,
        deleteAccount: store.deleteAccount,
        onStatusSync: (accountId, status, accountName) => {
            runtimeEvents.emit('status', { accountId, status, accountName });
            if (onStatusSync) onStatusSync(accountId, status, accountName);
        },
        onWorkerLog: (entry, accountId, accountName) => {
            runtimeEvents.emit('worker_log', { entry, accountId, accountName });
            if (onLog) onLog(entry, accountId, accountName);
        }
    });

    engine.startWorker = startWorker;
    engine.restartWorker = restartWorker;

    // 创建数据提供器
    const dataProviderDeps = {
        workers,
        globalLogs,
        accountLogs,
        store,
        getAccounts: store.getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        scheduleAutoCodeRefresh: autoCodeRefresh.scheduleAccount,
        refreshAccountCode: autoCodeRefresh.refreshAccountCode
    };
    const dataProvider = createDataProvider(dataProviderDeps);

    // 绑定全局日志事件
    runtimeEvents.on('log', (entry) => {
        if (onLog) {
            onLog(
                entry,
                entry && entry.accountId ? entry.accountId : '',
                entry && entry.accountName ? entry.accountName : ''
            );
        }
    });

    runtimeEvents.on('account_log', (entry) => {
        if (onAccountLog) onAccountLog(entry);
    });

    /** 广播配置到所有/指定 Worker */
    function broadcastConfigToWorkers(accountId = '') {
        const targetId = String(accountId || '').trim();
        for (const [id, worker] of Object.entries(workers)) {
            if (targetId && String(id) !== targetId) continue;
            const config = buildConfigSnapshotForAccount(id);
            try {
                worker.process.send({ type: 'config_sync', config });
            } catch { }
        }
    }

    /** 启动所有账号（手动调用：不做依赖等待与重试） */
    async function startAllAccounts() {
        const accounts = store.getAccounts().accounts || [];
        if (accounts.length > 0) {
            log('系统', `发现 ${  accounts.length  } 个账号，正在启动...`);
            for (const acc of accounts) {
                await startWorker(acc);
            }
        } else {
            log('系统', '未发现账号，请访问管理面板添加账号');
        }
    }

    // ==================== 开机自动启动 ====================
    // 【2026-08-23】容器重启后账号需手动逐个点「启动」，这里补上开机自启。
    //
    // 不能简单地循环 startWorker：容器冷启动时两个前置依赖还没就绪 ——
    //   · yyb-go（wx/yyb 账号换 code）：start.sh 后台拉起后立刻 exec node，可能还没 listen
    //   · NapCat 桥接（qq 账号换 code）：由另一个容器提供，共享 Unix Socket，启动更慢
    // 而 startWorker 内部 refreshNapcatCodeIfNeeded 失败会直接 throw → 返回 false 且**不重试**，
    // 结果就是「重启后 QQ 账号静默全灭」。所以先探测依赖就绪，再启动，失败的还要轮次重试。

    const AUTO_START_DEP_TIMEOUT_MS = Math.max(0, Number(processRef.env.FARM_AUTOSTART_DEP_TIMEOUT_MS) || 90000);
    const AUTO_START_DEP_INTERVAL_MS = Math.max(500, Number(processRef.env.FARM_AUTOSTART_DEP_INTERVAL_MS) || 2000);
    const AUTO_START_MAX_ROUNDS = Math.max(1, Number(processRef.env.FARM_AUTOSTART_MAX_ROUNDS) || 3);
    const AUTO_START_RETRY_DELAY_MS = Math.max(1000, Number(processRef.env.FARM_AUTOSTART_RETRY_DELAY_MS) || 15000);
    const AUTO_START_STAGGER_MS = Math.max(0, Number(processRef.env.FARM_AUTOSTART_STAGGER_MS) || 1500);

    /** 轮询探测某个依赖直到就绪；超时只记日志不抛错（后续靠账号重试兜底） */
    async function waitForDependency(name, probe) {
        const deadline = Date.now() + AUTO_START_DEP_TIMEOUT_MS;
        let attempt = 0;
        let lastError = '';
        while (Date.now() < deadline) {
            attempt++;
            try {
                await probe();
                log('系统', `自动启动：${name} 已就绪${attempt > 1 ? `（第 ${attempt} 次探测）` : ''}`);
                return true;
            } catch (err) {
                lastError = err && err.message ? err.message : String(err);
            }
            await sleep(AUTO_START_DEP_INTERVAL_MS);
        }
        log('系统', `自动启动：${name} 等待超时（${Math.round(AUTO_START_DEP_TIMEOUT_MS / 1000)}s，${lastError}），仍继续启动并依赖重试`);
        return false;
    }

    /** 探测容器内 yyb-go 是否已 listen */
    async function probeYybGo() {
        const cfg = store.getGlobalWxConfig ? store.getGlobalWxConfig() : null;
        const rawBase = cfg && cfg.apiBase ? String(cfg.apiBase).trim().replace(/\/+$/, '') : '';
        const base = rawBase
            .replace(/\/wxapp\/getCode$/i, '')
            .replace(/\/wxapp$/i, '')
            .replace(/\/accounts$/i, '');
        if (!base) throw new Error('应用宝接口未配置');
        const res = await fetch(base, { signal: AbortSignal.timeout(3000) });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        return true;
    }

    /** 探测 NapCat 桥接 Socket 是否可用 */
    function probeNapcatBridge() {
        const { checkNapCatBridge } = require('../services/napcat-bridge-client');
        return checkNapCatBridge();
    }

    /** 开机自动启动全部账号：先等依赖就绪，再逐个启动，失败的分轮重试 */
    async function autoStartAllAccountsOnBoot() {
        const accounts = store.getAccounts().accounts || [];
        if (accounts.length === 0) {
            log('系统', '未发现账号，请访问管理面板添加账号');
            return;
        }

        log('系统', `自动启动：发现 ${accounts.length} 个账号，正在等待依赖就绪...`);

        const needYyb = accounts.some(acc => acc
            && String(acc.loginType || '') === 'yyb'
            && acc.yybOpenid
            && acc.provider !== 'thirdparty');
        const needNapcat = accounts.some(acc => acc
            && String(acc.platform || 'qq').toLowerCase() === 'qq');

        if (needYyb) await waitForDependency('应用宝 yyb-go', probeYybGo);
        if (needNapcat) await waitForDependency('NapCat 登录桥接', probeNapcatBridge);

        let pending = accounts.map(acc => String(acc.id));

        for (let round = 1; round <= AUTO_START_MAX_ROUNDS && pending.length > 0; round++) {
            const failed = [];

            for (const accountId of pending) {
                // 每轮都重新取最新账号快照：上一轮可能已刷新过 code
                const latest = (store.getAccounts().accounts || [])
                    .find(acc => String(acc.id) === accountId);
                if (!latest) continue;              // 账号已被删除
                if (workers[latest.id]) continue;   // 已在运行（含手动启动）

                let started = false;
                try {
                    started = await startWorker(latest);
                } catch (err) {
                    log('系统', `自动启动：账号 ${latest.name || latest.id} 启动异常: ${err && err.message ? err.message : String(err)}`, {
                        accountId: String(latest.id),
                    });
                }

                if (!started && !workers[latest.id]) failed.push(accountId);
                if (AUTO_START_STAGGER_MS > 0) await sleep(AUTO_START_STAGGER_MS);
            }

            pending = failed;
            if (pending.length === 0) break;

            if (round < AUTO_START_MAX_ROUNDS) {
                log('系统', `自动启动：${pending.length} 个账号启动失败，${Math.round(AUTO_START_RETRY_DELAY_MS / 1000)}s 后重试（第 ${round + 1}/${AUTO_START_MAX_ROUNDS} 轮）`);
                await sleep(AUTO_START_RETRY_DELAY_MS);
            }
        }

        const runningCount = accounts.filter(acc => workers[acc.id]).length;
        if (pending.length > 0) {
            log('系统', `自动启动完成：${runningCount}/${accounts.length} 个账号已启动，${pending.length} 个仍失败（账号 ${pending.join(', ')}），可在面板手动启动`);
        } else {
            log('系统', `自动启动完成：${runningCount}/${accounts.length} 个账号已启动`);
        }
    }

    /** 引擎启动入口 */
    async function start(startOpts = {}) {
        const shouldStartAdmin = startOpts.startAdminServer !== false;
        const shouldAutoStart = startOpts.autoStartAccounts !== false;

        // 加载系统配置
        const sysConfig = store.getSystemConfig();
        if (sysConfig) {
            updateRuntimeConfig(sysConfig);
            log('系统', `已加载系统配置: serverUrl=${  sysConfig.serverUrl
                 }, clientVersion=${  sysConfig.clientVersion
                 }, platform=${  sysConfig.platform}`);
        }

        if (shouldStartAdmin && startAdminServer) {
            startAdminServer(dataProvider);
        }

        if (shouldAutoStart) {
            // 不 await：让管理面板先可用，账号在后台按依赖就绪节奏拉起
            autoStartAllAccountsOnBoot().catch((err) => {
                log('系统', `自动启动账号失败: ${err && err.message ? err.message : String(err)}`);
            });
        }
        autoCodeRefresh.rescheduleAll();
    }

    /** 停止所有账号 */
    function stopAllAccounts() {
        for (const id of Object.keys(workers)) {
            stopWorker(id);
        }
    }

    return {
        store,
        runtimeEvents,
        workers,
        dataProvider,
        start,
        startAllAccounts,
        autoStartAllAccountsOnBoot,
        stopAllAccounts,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        callWorkerApi,
        log,
        addAccountLog
    };
}

module.exports = { createRuntimeEngine };
