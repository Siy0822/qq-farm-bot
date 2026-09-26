/**
 * 自动化任务互斥锁
 *
 * 移植自上游 liyangpengs/qq-farm-bot core/src/services/automation-lock.ts（commit b487b0f）。
 *
 * 背景：同一账号的多个自动化入口（登录启动序列、每日例行、农场巡查、好友巡查、
 * 神秘商店）都可能被定时器或推送同时触发。它们跑在同一 worker 上、共用一条 WebSocket，
 * 叠起来会把网关请求堆满，表现为超时和掉线。
 *
 * 语义：同一时刻只允许一个「自动化任务」在跑；重入（同一调用栈内嵌套）直接放行，
 * 避免任务内部再调另一个受保护任务时自锁。
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();
let tail = Promise.resolve();
let running = false;

/**
 * 串行执行一个自动化任务。
 * @param {string} taskName 任务名（仅用于排错）
 * @param {() => any} taskFn 任务体
 */
function runExclusiveAutomationTask(taskName, taskFn) {
  const store = storage.getStore();
  // 已在受保护任务内部：直接执行，不再排队（防自锁）。
  if (store && store.exclusive) return Promise.resolve(taskFn());

  const run = tail.then(async () => {
    running = true;
    try {
      return await storage.run({ exclusive: true, taskName }, taskFn);
    } finally {
      running = false;
    }
  });
  tail = run.then(() => undefined, () => undefined);
  return run;
}

function isAutomationTaskRunning() {
  return running;
}

module.exports = { runExclusiveAutomationTask, isAutomationTaskRunning };
