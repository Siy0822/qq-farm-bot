/**
 * QQ会员服务 - 每日自动领取VIP礼包 + SVIP 商城免费礼包
 *
 * 协议对齐官方 1.14.2.11_20260922（上游 liyangpengs/qq-farm-bot 25dc1e9）：
 * - GetQQVipRewardsStatusReply field 1 是会员资格位（官方名 is_qq_vip，本地旧名 has_gift）；
 *   field 2 是 can_claim，不是第二种资格。
 * - 礼包档位按 QQVipRewardStatus.is_enable + 分类资格判定：
 *   type=1 看 can_claim，type=2 看 rewards_can_claim，取 reward_type 作为领取参数。
 * - ClaimQQVipRewardsRequest field 1 = reward_types（本地旧名 vip_types，同字段）。
 * - 非会员错误码 1021001，已领取 1021002。
 * - 会员资格成立且 mall_free_can_claim 时，顺带领 SVIP 分页的免费礼包（不花钻石）。
 */
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { log, toNum } = require('../utils/utils');
const { getItemById } = require('../config/gameConfig');

const DAILY_KEY = 'vip_daily_gift';

// 两次检查最小间隔：10分钟
const CHECK_COOLDOWN_MS = 10 * 60 * 1000;

// 网关业务错误码
const NOT_QQ_VIP_ERROR_CODE = 1021001;
const ALREADY_CLAIMED_ERROR_CODE = 1021002;

// 每日状态追踪
let doneDateKey = '';
let lastCheckAt = 0;
let lastClaimAt = 0;
let lastResult = '';
let lastHasGift = null;
let lastCanClaim = null;

// ---- 日期工具 ----

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function markDoneToday() {
  doneDateKey = getDateKey();
}

function isDoneToday() {
  return doneDateKey === getDateKey();
}

// ---- 奖励摘要 ----
// 1001→金币, 1101→种植经验, 1002→点券, 1004→钻石

function getRewardSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const parts = [];
  for (const item of list) {
    const id = toNum(item.id);
    const count = toNum(item.count);
    if (count <= 0) continue;
    if (id === 1 || id === 1001) {
      parts.push(`金币${count}`);
    } else if (id === 2 || id === 1101) {
      parts.push(`经验${count}`);
    } else if (id === 1002) {
      parts.push(`点券${count}`);
    } else {
      const info = getItemById(id);
      const name = info && info.name ? String(info.name) : `物品#${id}`;
      parts.push(`${name}x${count}`);
    }
  }
  return parts.join('/');
}

function hasErrorCode(err, code) {
  if (Number(err && err.code) === code) return true;
  return new RegExp(`\\bcode=${code}\\b`).test(String((err && err.message) || err || ''));
}

/**
 * 判断是否"非QQ会员"
 */
function isNotQQVipError(err) {
  return hasErrorCode(err, NOT_QQ_VIP_ERROR_CODE);
}

/**
 * 判断是否"已领取"错误
 */
function isAlreadyClaimedError(err) {
  return hasErrorCode(err, ALREADY_CLAIMED_ERROR_CODE)
    || String((err && err.message) || '').includes('已领取');
}

// ---- RPC 调用 ----

async function getQQVipRewardsStatus() {
  const request = types.GetQQVipRewardsStatusRequest.encode(
    types.GetQQVipRewardsStatusRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'GetQQVipRewardsStatus', request);
  return types.GetQQVipRewardsStatusReply.decode(body);
}

/** 主动刷新会员信息，让后续状态查询拿到最新资格位 */
async function refreshVipInfo() {
  const request = types.RefreshVipInfoRequest.encode(
    types.RefreshVipInfoRequest.create({})
  ).finish();
  const { body } = await sendMsgAsync('gamepb.qqvippb.QQVipService', 'RefreshVipInfo', request);
  types.RefreshVipInfoReply.decode(body);
}

async function claimQQVipRewards(rewardTypes) {
  const request = types.ClaimQQVipRewardsRequest.encode(
    types.ClaimQQVipRewardsRequest.create({ reward_types: rewardTypes })
  ).finish();
  const { body } = await sendMsgAsync(
    'gamepb.qqvippb.QQVipService',
    'ClaimQQVipRewards',
    request,
    { expectedErrorCodes: [NOT_QQ_VIP_ERROR_CODE, ALREADY_CLAIMED_ERROR_CODE] }
  );
  const reply = types.ClaimQQVipRewardsReply.decode(body);
  // 官方回包在 field 3；本地旧结构在 field 1。取有内容的那个。
  if (Array.isArray(reply.items_v2) && reply.items_v2.length) return { items: reply.items_v2 };
  return { items: Array.isArray(reply.items) ? reply.items : [] };
}

// ---- SVIP 商城免费礼包 ----

/**
 * 领取 SVIP 分页里的免费礼包（绝不花钻石）。
 * 只在会员资格成立且服务端标记可领时才发请求，逐件购买满足免费/可用/限购条件的商品。
 */
async function claimSvipMallFreeGift(status) {
  if (!status || status.is_qq_vip !== true || status.mall_free_can_claim !== true) return false;
  const mall = require('./mall');
  const { goods } = await mall.getMallGoodsListV2(4, false);
  const claimable = goods.filter((item) => item.is_free === true
    && item.is_available === true
    && toNum(item.price && item.price.count) === 0
    && !item.ad_only
    && !(item.share && item.share.share_only)
    && !item.is_owned
    && (!item.purchase_limit
      || toNum(item.purchase_limit.limit_count) <= 0
      || toNum(item.purchase_limit.bought_count) < toNum(item.purchase_limit.limit_count)));
  for (const product of claimable) {
    await mall.purchaseMallGoodsV2(toNum(product.goods_id), 1);
  }
  return claimable.length > 0;
}

// ---- 主逻辑 ----

/**
 * 执行每日VIP礼包领取
 * @param {boolean} force - 强制检查
 */
async function performDailyVipGift(force = false) {
  const now = Date.now();

  if (!force && isDoneToday()) return false;
  if (!force && now - lastCheckAt < CHECK_COOLDOWN_MS) return false;

  lastCheckAt = now;

  try {
    await refreshVipInfo().catch(() => {});
    const status = await getQQVipRewardsStatus();

    const rewardStatuses = Array.isArray(status && status.reward_statuses)
      ? status.reward_statuses
      : [];
    let rewardTypes = rewardStatuses
      .filter((item) => item && item.is_enable === true && status.is_qq_vip === true
        && (toNum(item.type) === 1 ? status.can_claim === true : status.rewards_can_claim === true))
      .map((item) => toNum(item.reward_type))
      .filter((rewardType) => rewardType > 0);

    lastHasGift = rewardStatuses.length
      ? rewardStatuses.some((item) => item && item.is_enable === true && status.is_qq_vip === true)
      : !!(status && status.can_claim);

    // 回退：旧版服务端不返回 reward_statuses 时，沿用历史行为（can_claim + [1,2]）。
    if (!rewardStatuses.length && status && status.can_claim) {
      rewardTypes = [1, 2];
    }
    lastCanClaim = rewardTypes.length > 0;

    const mallClaimed = await claimSvipMallFreeGift(status);
    if (mallClaimed) lastClaimAt = Date.now();

    if (rewardTypes.length === 0) {
      markDoneToday();
      lastResult = mallClaimed ? 'ok' : 'none';
      log('会员', mallClaimed ? 'SVIP 商城免费礼包领取成功' : '今日暂无可领取会员礼包', {
        module: 'task',
        event: DAILY_KEY,
        result: mallClaimed ? 'ok' : 'none',
      });
      return mallClaimed;
    }

    const rep = await claimQQVipRewards(rewardTypes);
    const items = Array.isArray(rep && rep.items) ? rep.items : [];
    const summary = getRewardSummary(items);

    log('会员',
      summary ? `领取成功 → ${summary}` : '领取成功',
      { module: 'task', event: DAILY_KEY, result: 'ok', count: items.length, rewardTypes }
    );

    lastClaimAt = Date.now();
    markDoneToday();
    lastResult = 'ok';
    return true;
  } catch (err) {
    if (isNotQQVipError(err)) {
      markDoneToday();
      lastHasGift = false;
      lastCanClaim = false;
      lastResult = 'none';
      log('会员', '非QQ会员，跳过会员礼包', {
        module: 'task', event: DAILY_KEY, result: 'none', reason: 'not_qq_vip',
      });
      return false;
    }

    // 如果已经领取过，也标记完成
    if (isAlreadyClaimedError(err)) {
      markDoneToday();
      lastClaimAt = Date.now();
      lastResult = 'ok';
      log('会员', '今日会员礼包已领取', { module: 'task', event: DAILY_KEY, result: 'ok' });
      return false;
    }

    lastResult = 'error';
    log('会员', `领取会员礼包失败: ${err.message}`, {
      module: 'task', event: DAILY_KEY, result: 'error',
    });
    return false;
  }
}

module.exports = {
  getQQVipRewardsStatus,
  refreshVipInfo,
  claimSvipMallFreeGift,
  performDailyVipGift,
  getVipDailyState: () => ({
    key: DAILY_KEY,
    doneToday: isDoneToday(),
    lastCheckAt,
    lastClaimAt,
    result: lastResult,
    hasGift: lastHasGift,
    canClaim: lastCanClaim,
  }),
};
