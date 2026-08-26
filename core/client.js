const process = require('node:process');

const {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
} = require('./src/controllers/admin');
const { createRuntimeEngine } = require('./src/runtime/runtime-engine');
const { createModuleLogger } = require('./src/services/logger');
const { verifyAndRun } = require('./src/services/license');

const mainLogger = createModuleLogger('main');
const isWorkerProcess = process.env.FARM_WORKER === '1';

async function bootstrap() {
    if (isWorkerProcess) {
        require('./src/core/worker');
        return;
    }

    const licenseValid = await verifyAndRun();
    if (!licenseValid) {
        console.error('');
        console.error('[Error] License verification failed, exiting.');
        console.error('');
        process.exit(1);
        return;
    }

    const runtimeEngine = createRuntimeEngine({
        processRef: process,
        mainEntryPath: __filename,
        startAdminServer,
        onStatusSync: (accountId, status) => {
            emitRealtimeStatus(accountId, status);
        },
        onLog: (entry, accountId) => {
            if (accountId && entry) {
                entry.accountId = accountId;
            }
            emitRealtimeLog(entry);
        },
        onAccountLog: (entry) => {
            emitRealtimeAccountLog(entry);
        },
    });

    runtimeEngine.start({
        startAdminServer: true,
        // 【2026-08-23】开机自动启动所有账号（原先写死 false，容器每次重建都要手动逐个点「启动」）。
        // 引擎侧 autoStartAllAccountsOnBoot 会先等 yyb-go / NapCat 桥接就绪再启动，并对失败账号分轮重试。
        // 如需回退到手动启动，把环境变量 FARM_AUTOSTART_ACCOUNTS 设为 0/false 即可。
        autoStartAccounts: !/^(0|false|no|off)$/i.test(String(process.env.FARM_AUTOSTART_ACCOUNTS ?? '1').trim()),
    }).catch((err) => {
        mainLogger.error('runtime bootstrap failed', {
            error: err && err.message ? err.message : String(err),
        });
    });
}

bootstrap().catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
});
