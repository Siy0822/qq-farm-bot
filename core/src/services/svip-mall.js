/**
 * SVIP 商城服务（官方商城分页 slot_type=4）
 *
 * 移植自上游 liyangpengs/qq-farm-bot core/src/services/commerce.ts（commit 25dc1e9），
 * 协议位见 docs/autumn-20260924.md：
 * - 普通商城 slot 1，SVIP slot 4；查询请求 field 2 是 is_manual_open；
 * - 商品 field 8 是可用状态，field 12 是商品类型（不是可用性）；
 * - PurchaseResponse field 2 是 success（不是购买数量）。
 *
 * 【为什么不复用 services/mall.js 的 MallGoods】
 * 本地 mallpb 的 MallGoods.price/limit 是裸 bytes + 手工 varint 解析，与官方
 * corepb.Item/PurchaseLimit 结构不同：官方 slot1 回包用本地 MallGoods 解码会在第 2 条
 * 开始抛 invalid wire type，本地面板靠 MALL_GOODS_PRICE_OVERRIDES 常量兜着。
 * 因此这里一律用 MallGoodsV2（并列新增类型）解码，绝不动在跑的化肥购买链路。
 *
 * 安全约束（与上游一致）：非会员可浏览但不能购买；余额不可确认时禁止花费。
 */
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, getServerTimeSec, log } = require('../utils/utils');
const { getItemById, getItemImageById } = require('../config/gameConfig');

const SVIP_SLOT_TYPE = 4;

// 本模块内的购买串行：避免连点造成重复下单。
let purchaseTail = Promise.resolve();

function businessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function positiveInteger(value, code, label) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) throw businessError(code, `${label} 必须是正整数`);
  const result = Number(text);
  if (!Number.isSafeInteger(result)) throw businessError(code, `${label} 超出范围`);
  return result;
}

function itemDto(item, fallbackName = '') {
  const id = Math.max(0, toNum(item && item.id));
  const metadata = id > 0 ? getItemById(id) : null;
  return {
    id,
    count: Math.max(0, toNum(item && item.count)),
    name: String((metadata && metadata.name) || fallbackName || (id > 0 ? `物品 #${id}` : '未知物品')),
    image: id > 0 ? getItemImageById(id) : '',
  };
}

/**
 * 汇总背包里指定货币的余额；拿不到的货币不写入（视为未知，禁止花费）。
 */
async function currencyBalances(ids) {
  const wanted = new Set(ids.filter((id) => id > 0));
  const balances = {};
  if (!wanted.size) return balances;
  try {
    const warehouse = require('./warehouse');
    const reply = await warehouse.getBag();
    for (const item of warehouse.getBagItems(reply)) {
      const id = toNum(item && item.id);
      if (wanted.has(id)) balances[String(id)] = (balances[String(id)] || 0) + Math.max(0, toNum(item && item.count));
    }
    for (const id of wanted) {
      if (!Object.hasOwn(balances, String(id))) balances[String(id)] = 0;
    }
  } catch {
    // 背包不可用时目录仍可展示，但余额视为未知。
  }
  return balances;
}

function limitDto(limit) {
  if (!limit || toNum(limit.limit_type) === 0) return null;
  const bought = Math.max(0, toNum(limit.bought_count));
  const max = Math.max(0, toNum(limit.limit_count));
  return { type: toNum(limit.limit_type), bought, max, remaining: Math.max(0, max - bought) };
}

function availability(goods, limit, isSvip) {
  if (goods && goods.is_owned) return { status: 'owned', reason: '已拥有该商品' };
  if (limit && limit.remaining === 0) {
    return { status: 'sold_out', reason: goods && goods.is_free ? '奖励已领取' : '商品已售罄，已达到限购上限' };
  }
  if (goods && goods.ad_only) return { status: 'ad_required', reason: '请在游戏内观看广告领取' };
  if (goods && goods.share && goods.share.share_only && toNum(goods.share.share_status) !== 2) {
    return { status: 'share_required', reason: '请在游戏内完成分享条件' };
  }
  // SVIP 分页始终要求 field 8 明确可用 + 会员资格。
  if (goods && goods.is_available !== true) return { status: 'unavailable', reason: '商品当前不可购买' };
  if (!isSvip) return { status: 'svip_required', reason: '需要 SVIP 会员身份' };
  return { status: 'available', reason: '' };
}

function goodsDto(goods, balances, isSvip) {
  const price = itemDto(goods && goods.price);
  const originalPrice = price.count;
  const discountPrice = Math.max(0, toNum(goods && goods.discount_price));
  const promotionStart = toNum(goods && goods.promotion_start_time);
  const promotionEnd = toNum(goods && goods.promotion_end_time);
  const now = getServerTimeSec();
  const promotionActive = discountPrice > 0 && promotionStart <= now && promotionEnd > now;
  if (promotionActive) price.count = discountPrice;

  const limit = limitDto(goods && goods.purchase_limit);
  const isFree = goods && goods.is_free === true && price.count === 0;
  const state = availability(goods, limit, isSvip);
  const balance = price.id > 0 && Object.hasOwn(balances, String(price.id)) ? balances[String(price.id)] : null;

  return {
    id: Math.max(0, toNum(goods && goods.goods_id)),
    name: String((goods && goods.name) || ''),
    type: Math.max(0, toNum(goods && goods.goods_type)),
    rewards: (Array.isArray(goods && goods.reward_items) ? goods.reward_items : []).map((item) => itemDto(item)),
    price: { ...price, balance },
    originalPrice: promotionActive ? originalPrice : null,
    isFree,
    limit,
    isLimited: !!limit,
    productType: toNum(goods && goods.product_type),
    purchaseStatus: state.status,
    unavailableReason: state.reason,
    discountText: discountPrice > 0 && !promotionActive ? '' : String((goods && goods.discount_text) || ''),
    isDiscounted: discountPrice > 0 ? promotionActive : !!(goods && goods.is_discounted),
    discountEndTime: Math.max(0, discountPrice > 0 ? promotionEnd : toNum(goods && goods.discount_end_time)) * 1000,
    available: state.status === 'available',
    purchasable: state.status === 'available',
  };
}

async function fetchSvipGoods() {
  const request = types.GetMallListBySlotTypeRequest.encode(
    types.GetMallListBySlotTypeRequest.create({ slot_type: SVIP_SLOT_TYPE, is_manual_open: false })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.mallpb.MallService', 'GetMallListBySlotType', request);
  const reply = types.GetMallListBySlotTypeResponse.decode(body);
  const rawList = Array.isArray(reply && reply.goods_list) ? reply.goods_list : [];
  const goods = [];
  for (const raw of rawList) {
    try {
      goods.push(types.MallGoodsV2.decode(raw));
    } catch {
      // 跳过解码失败的条目
    }
  }
  return { goods, refreshCountdown: Math.max(0, toNum(reply && reply.refresh_countdown)) };
}

async function readMembership() {
  const vip = require('./qqvip');
  try {
    await vip.refreshVipInfo();
  } catch {
    // 刷新失败不阻断读取，用当前状态判断
  }
  const status = await vip.getQQVipRewardsStatus();
  return {
    isSvip: status && status.is_qq_vip === true,
    remainingDays: toNum(status && status.remaining_days),
    mallFreeCanClaim: status && status.mall_free_can_claim === true,
  };
}

/**
 * 读取 SVIP 商城目录（含会员资格与货币余额）
 */
async function getSvipCatalog() {
  const membership = await readMembership();
  const { goods, refreshCountdown } = await fetchSvipGoods();
  const currencyIds = goods.map((entry) => Math.max(0, toNum(entry && entry.price && entry.price.id))).filter(Boolean);
  const balances = await currencyBalances(currencyIds);
  return {
    slotType: SVIP_SLOT_TYPE,
    membership,
    serverTime: getServerTimeSec() * 1000,
    refreshCountdown,
    currencies: Array.from(new Set(currencyIds)).map((id) => ({
      ...itemDto({ id, count: balances[String(id)] || 0 }),
      balanceKnown: Object.hasOwn(balances, String(id)),
    })),
    goods: goods.map((entry) => goodsDto(entry, balances, membership.isSvip)),
  };
}

/**
 * 购买 SVIP 商品：重新校验会员资格、可用状态、限购与余额后才下单。
 * @param {unknown} expectedPrice 可选报价 {id,count}，与最新价不一致则拒绝（防止按过期报价下单）
 */
async function purchaseSvipGoods(goodsIdInput, countInput, expectedPrice) {
  const goodsId = positiveInteger(goodsIdInput, 'INVALID_GOODS_ID', 'goodsId');
  const count = positiveInteger(countInput, 'INVALID_PURCHASE_COUNT', 'count');
  if (count > 9999) throw businessError('INVALID_PURCHASE_COUNT', 'count 不能超过 9999');

  const operation = async () => {
    const before = await getSvipCatalog();
    const goods = before.goods.find((entry) => entry.id === goodsId);
    if (!goods) throw businessError('GOODS_NOT_FOUND', '商品已不在当前商城中，请刷新后重试');
    if (goods.purchaseStatus === 'sold_out') throw businessError('GOODS_SOLD_OUT', goods.unavailableReason);
    if (!goods.purchasable) throw businessError('GOODS_UNAVAILABLE', goods.unavailableReason || '商品当前不可购买');
    if (expectedPrice
      && (Number(expectedPrice.id) !== goods.price.id || Number(expectedPrice.count) !== goods.price.count)) {
      throw businessError('MALL_PRICE_CHANGED', '商品价格已变化，请刷新商城后重新确认');
    }
    if (!goods.isFree && (goods.price.id <= 0 || goods.price.count <= 0 || goods.price.balance === null)) {
      throw businessError('MALL_BALANCE_UNAVAILABLE', '商品价格或余额未确认，请刷新后重试');
    }
    if (goods.limit && goods.limit.remaining < count) {
      throw businessError('PURCHASE_LIMIT_EXCEEDED', '购买数量超过剩余限购数量');
    }
    if (!goods.isFree && goods.price.balance !== null && goods.price.balance < goods.price.count * count) {
      throw businessError('INSUFFICIENT_BALANCE', '货币余额不足，无法完成购买');
    }

    const request = types.PurchaseRequest.encode(
      types.PurchaseRequest.create({ goods_id: goodsId, count })
    ).finish();
    const { body } = await sendMsgAsync('gamepb.mallpb.MallService', 'Purchase', request);
    const reply = types.PurchaseResponseV2.decode(body);
    if (reply.success !== true) throw businessError('PURCHASE_NOT_CONFIRMED', '商城未确认购买成功，请刷新核对');

    let catalog = null;
    try {
      catalog = await getSvipCatalog();
    } catch {
      // 已确认的购买不能因为后续刷新失败而报成失败。
    }
    log('商城', `SVIP 购买成功: goodsId=${goodsId} x${count}`, {
      module: 'task', event: 'svip_mall_purchase', result: 'ok', goodsId, count,
    });
    return {
      purchase: {
        goodsId: Math.max(0, toNum(reply.goods_id)),
        count,
        rewards: (Array.isArray(reply.reward_items) ? reply.reward_items : []).map((item) => itemDto(item)),
        limit: limitDto(reply.purchase_limit),
      },
      catalog,
      refreshRequired: !catalog,
    };
  };

  const result = purchaseTail.then(operation, operation);
  purchaseTail = result.then(() => undefined, () => undefined);
  return result;
}

module.exports = { getSvipCatalog, purchaseSvipGoods };
