const { toNum, log, sleep } = require('../utils/utils');
const { getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { sendMsgAsync } = require('../utils/network');
const { toLong } = require('../utils/utils');

// ===== Operation limits state =====
const operationLimits = new Map();
let lastResetDate = '';
let canGetHelpExp = true;
let helpAutoDisabledByLimit = false;

// ===== Operation type names =====
const OP_NAMES = {
  '10001': 'friend water',
  '10002': 'friend weed out',
  '10003': 'friend insecticide',
  '10004': 'friend steal',
  '10005': 'put weeds',
  '10006': 'put insects',
  '10007': 'friend revive',
  '10008': 'friend help water',
};

// ===== Daily reset =====

/**
 * Check if a new day has started (China timezone UTC+8) and reset limits.
 */
function checkDailyReset() {
  const { getServerTimeSec } = require('../utils/utils');
  const serverSec = getServerTimeSec();
  const serverMs = serverSec > 0
    ? serverSec * 1000
    : Date.now();

  // UTC+8 timezone offset: 8 hours in milliseconds
  const UTC_PLUS_8_OFFSET_MS = 8 * 3600 * 1000;
  const chinaDate = new Date(serverMs + UTC_PLUS_8_OFFSET_MS);
  const year = chinaDate.getUTCFullYear();
  const month = String(chinaDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaDate.getUTCDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;

  if (lastResetDate !== today) {
    if (lastResetDate !== '') {
      log('??', '?????????????');
    }
    operationLimits.clear();
    canGetHelpExp = true;

    if (helpAutoDisabledByLimit) {
      helpAutoDisabledByLimit = false;
      log('濂藉弸', '鏂扮殑涓€澶╁凡寮€濮嬶紝鑷姩鎭㈠甯繖鎿嶄綔鍔熻兘', {
        module: 'friend',
        event: '濂藉弸宸℃煡寰幆',
        result: 'ok',
      });
    }

    lastResetDate = today;
  }
}

/**
 * Disable help when daily experience limit is reached.
 * After this, only guard-dog (鎶や富鐘? friends will still be helped.
 */
function autoDisableHelpByExpLimit() {
  if (!canGetHelpExp) return;
  canGetHelpExp = false;
  helpAutoDisabledByLimit = true;
  log('??', '??????????????????????????????', {
    module: 'friend',
    event: '濂藉弸宸℃煡寰幆',
    result: 'ok',
  });
}

// ===== Operation limits =====

/**
 * Update operation limits from server response (after each RPC call).
 */
function updateOperationLimits(limits) {
  if (!limits || limits.length === 0) return;
  checkDailyReset();
  for (const limit of limits) {
    const id = toNum(limit.id);
    if (id > 0) {
      operationLimits.set(id, {
        dayTimes: toNum(limit.day_times),
        dayTimesLimit: toNum(limit.day_times_lt),
        dayExpTimes: toNum(limit.day_exp_times),
        dayExpTimesLimit: toNum(limit.day_ex_times_lt),
      });
    }
  }
}

/**
 * Check if we can still gain experience from a specific operation.
 */
function canGetExp(operationId) {
  const limit = operationLimits.get(operationId);
  if (!limit) return false;
  // No experience limit set 鈫?can get exp
  if (limit.dayExpTimesLimit <= 0) return true;
  return limit.dayExpTimes < limit.dayExpTimesLimit;
}

/**
 * Check if we can gain experience from any of the given operation candidates.
 */
function canGetExpByCandidates(expIds = []) {
  const ids = Array.isArray(expIds) ? expIds : [expIds];
  for (const id of ids) {
    if (canGetExp(toNum(id))) return true;
  }
  return false;
}

/**
 * Check if an operation can still be performed (by operation count limit).
 */
function canOperate(operationId) {
  const limit = operationLimits.get(operationId);
  if (!limit) return true; // No limit known 鈫?assume allowed
  if (limit.dayTimesLimit <= 0) return true; // No limit set
  return limit.dayTimes < limit.dayTimesLimit;
}

/**
 * Get remaining times for an operation. Returns 999 if unlimited.
 */
function getRemainingTimes(operationId) {
  const limit = operationLimits.get(operationId);
  if (!limit || limit.dayTimesLimit <= 0) return 999;
  return Math.max(0, limit.dayTimesLimit - limit.dayTimes);
}

/**
 * Get all operation limits as a key-value map with names.
 */
function getOperationLimits() {
  const result = {};
  const allIds = [10001, 10002, 10003, 10004, 10005, 10006, 10007, 10008];
  for (const id of allIds) {
    const limit = operationLimits.get(id);
    if (limit) {
      result[id] = {
        name: OP_NAMES[id] || `#${id}`,
        ...limit,
        remaining: getRemainingTimes(id),
      };
    }
  }
  return result;
}

// ===== Help exp limit state =====

function getCanGetHelpExp() {
  return canGetHelpExp;
}

function setCanGetHelpExp(value) {
  canGetHelpExp = !!value;
}

function getHelpAutoDisabledByLimit() {
  return helpAutoDisabledByLimit;
}

// ===== Friend operation RPC calls =====

/**
      const msg = (err && err.message) ? err.message : '????';
 * If `checkExpLimit` is true, sleeps 200ms after the call and checks if exp increased
 * to determine if the help exp limit is reached.
 */
async function helpWater(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.WaterLandRequest.encode(
    types.WaterLandRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'WaterLand',
    payload
  );
  const reply = types.WaterLandReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    await sleep(200);
    const expAfter = toNum((getUserState() || {}).exp);
    if (expAfter <= expBefore) autoDisableHelpByExpLimit();
  }

  return reply;
}

/**
      const msg = (err && err.message) ? err.message : '????';
 */
async function helpWeed(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.WeedOutRequest.encode(
    types.WeedOutRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'WeedOut',
    payload
  );
  const reply = types.WeedOutReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    await sleep(200);
    const expAfter = toNum((getUserState() || {}).exp);
    if (expAfter <= expBefore) autoDisableHelpByExpLimit();
  }

  return reply;
}

/**
      const msg = (err && err.message) ? err.message : '????';
 */
async function helpInsecticide(gid, landIds, checkExpLimit = false) {
  const expBefore = toNum((getUserState() || {}).exp);
  const payload = types.InsecticideRequest.encode(
    types.InsecticideRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'Insecticide',
    payload
  );
  const reply = types.InsecticideReply.decode(body);
  updateOperationLimits(reply.operation_limits);

  if (checkExpLimit) {
    await sleep(200);
    const expAfter = toNum((getUserState() || {}).exp);
    if (expAfter <= expBefore) autoDisableHelpByExpLimit();
  }

  return reply;
}

/**
      const msg = (err && err.message) ? err.message : '????';
 */
async function stealHarvest(gid, landIds) {
  const payload = types.HarvestRequest.encode(
    types.HarvestRequest.create({
      land_ids: landIds,
      host_gid: toLong(gid),
      is_all: true,
    })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.plantpb.PlantService',
    'Harvest',
    payload
  );
  const reply = types.HarvestReply.decode(body);
  updateOperationLimits(reply.operation_limits);
  return reply;
}

/**
      const msg = (err && err.message) ? err.message : '????';
 * Returns the number of successful operations.
 */
async function putPlantItems(gid, landIds, RequestType, ReplyType, rpcMethod) {
  let ok = 0;
  const ids = Array.isArray(landIds) ? landIds : [];

  for (const landId of ids) {
    try {
      const payload = RequestType.encode(
        RequestType.create({
          land_ids: [toLong(landId)],
          host_gid: toLong(gid),
        })
      ).finish();
      const { body } = await sendMsgAsync(
        'gamepb.plantpb.PlantService',
        rpcMethod,
        payload
      );
      const reply = ReplyType.decode(body);
      updateOperationLimits(reply.operation_limits);
      ok++;
    } catch (err) {
      const msg = (err && err.message) ? err.message : '鏈煡閿欒';
      if (msg.includes('1001046')) {
        // Already done 鈥?silently skip
      } else {
        log('濂藉弸', `鏀捐櫕/鏀捐崏澶辫触: landId=${landId}, 閿欒: ${msg}`, {
          module: 'friend',
          event: '鏀捐櫕鏀捐崏澶辫触',
          landId,
          error: msg,
        });
      }
      await require('../utils/utils').randomDelay(500, 1500);
    }

    if (ok > 0) {
      await require('../utils/utils').randomDelay(500, 1000);
    }
  }

  return ok;
}

/**
 * Detailed version of putPlantItems that returns failure details.
 * Returns: { ok: number, failed: [{landId, reason}] }
 */
async function putPlantItemsDetailed(gid, landIds, RequestType, ReplyType, rpcMethod) {
  let ok = 0;
  const failed = [];
  const ids = Array.isArray(landIds) ? landIds : [];

  for (const landId of ids) {
    try {
      const payload = RequestType.encode(
        RequestType.create({
          land_ids: [toLong(landId)],
          host_gid: toLong(gid),
        })
      ).finish();
      const { body } = await sendMsgAsync(
        'gamepb.plantpb.PlantService',
        rpcMethod,
        payload
      );
      const reply = ReplyType.decode(body);
      updateOperationLimits(reply.operation_limits);
      ok++;
    } catch (err) {
      const msg = (err && err.message) ? err.message : 'unknown error';
      failed.push({
        landId,
        reason: msg,
      });
      if (!msg.includes('1001046')) {
        log('friend', `put weeds/insects failed: landId=${landId}, error: ${msg}`, {
          module: 'friend',
          event: 'put_weeds_insects_failed',
          landId,
          error: msg,
          detailed: true,
        });
      }
    }
    if (ok > 0) {
      await require('../utils/utils').randomDelay(500, 1000);
    }
  }

  return { ok, failed };
}

// ===== Specific put operations =====

async function putInsects(gid, landIds) {
  return putPlantItems(gid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
}

async function putWeeds(gid, landIds) {
  return putPlantItems(gid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
}

async function putInsectsDetailed(gid, landIds) {
  return putPlantItemsDetailed(gid, landIds, types.PutInsectsRequest, types.PutInsectsReply, 'PutInsects');
}

async function putWeedsDetailed(gid, landIds) {
  return putPlantItemsDetailed(gid, landIds, types.PutWeedsRequest, types.PutWeedsReply, 'PutWeeds');
}

// ===== Exports =====
module.exports = {
  OP_NAMES,
  checkDailyReset,
  autoDisableHelpByExpLimit,
  updateOperationLimits,
  canGetExp,
  canGetExpByCandidates,
  canOperate,
  getRemainingTimes,
  getOperationLimits,
  getCanGetHelpExp,
  setCanGetHelpExp,
  getHelpAutoDisabledByLimit,
  helpWater,
  helpWeed,
  helpInsecticide,
  stealHarvest,
  putPlantItems,
  putPlantItemsDetailed,
  putInsects,
  putWeeds,
  putInsectsDetailed,
  putWeedsDetailed,
};
