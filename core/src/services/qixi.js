/**
 * 七夕活动「鹊桥寄情」（2026-08-18 ~ 2026-08-22）
 *
 * 玩法（服务端 payload tips 实锤）：
 * - 每日任务/商城可领「鹊羽灵露」(301103)，在自己或好友土地上使用可主动触发鹊羽效果并收获「鹊羽」(1024)
 * - 种植 3 品及以上/稀有/珍品/天工作物有概率被动触发鹊羽效果，收获时额外掉落鹊羽（每日最多 3 次）
 * - 消耗鹊羽可「筑建鹊桥」，按档位获得化肥/点券/鹊羽香囊(1025)/鹊桥寄情铭牌
 * - 活动期间可把鹊羽香囊赠送给好友
 *
 * 协议说明：
 * - 活动树：ActivityService.GetGroup{id=2026081800}
 *   └ 2026081801 (type=15) 主玩法节点：payload 带 tips，节点级字段 112 带筑桥档位状态
 *   └ 2026081802 (type=16) 香囊/赠送相关节点
 * - 喷洒灵露：ItemService.Use，请求体 {1: corepb.Item{item_id, count, uid}, 2: {1: host_gid, 2: 9}}
 *   （本地 itempb.UseRequest 的平铺结构对该玩法无效，故此处手工编码，避免改动既有物品使用链路）
 * - 筑建鹊桥：ActivityService.Operate{id=2026081801, cmd=25}
 * - 赠送香囊：VisitService.Enter(好友) → ActivityService.Operate{id=2026081801, cmd=26, 125:{1: 好友gid}} → Leave
 */
const protobuf = require('protobufjs/minimal');
const { sendMsgAsync, isConnected, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum } = require('../utils/utils');
const { getItemImageById, getItemById } = require('../config/gameConfig');
const { createModuleLogger } = require('./logger');
const { getBag, getBagItems } = require('./warehouse');
const { enterFriendFarm, leaveFriendFarm } = require('./friend-api');

const qixiLogger = createModuleLogger('qixi');

// ---- 活动常量 ----
const QIXI_ACTIVITY_UID = 'QiXiActivity';
const QIXI_ROOT_ACTIVITY_ID = 2026081800;   // 活动组根节点
const QIXI_MAIN_ACTIVITY_ID = 2026081801;   // 主玩法节点（tips + 筑桥档位）
const QIXI_SIDE_ACTIVITY_ID = 2026081802;   // 香囊节点

const QIXI_BRIDGE_CMD = 25;                 // 筑建鹊桥
const QIXI_GIFT_CMD = 26;                   // 赠送鹊羽香囊
const QIXI_GIFT_EXT_FIELD = 125;            // Operate 扩展字段：赠送目标

const QIXI_FEATHER_ITEM_ID = 1024;          // 鹊羽
const QIXI_SACHET_ITEM_ID = 1025;           // 鹊羽香囊
const QIXI_LU_ITEM_ID = 301103;             // 鹊羽灵露
const QIXI_SPRAY_SOURCE = 9;                // 喷洒场景标记

const QIXI_BRIDGE_NODE_FIELD = 112;         // ActivityNode 上筑桥档位数据字段
const QIXI_REWARD_REPLY_FIELD = 126;        // Operate 回包发放奖励字段

const QIXI_ALREADY_CLAIMED_HINTS = ['已领取', '已经领取', '重复领取', 'already'];

/** 活动新增物品在本地 ItemInfo.json 里没有条目，这里做兜底命名 */
const QIXI_ITEM_META = {
  1024: { name: '鹊羽' },
  1025: { name: '鹊羽香囊' },
  301103: { name: '鹊羽灵露' },
  101325: { name: '鹊桥寄情礼包一' },
  101326: { name: '鹊桥寄情礼包二' },
  401004: { name: '鹊桥寄情铭牌' },
};

function assertQixiConnection(action) {
  if (!isConnected()) {
    throw new Error(`${action || '鹊桥寄情操作'}失败: 连接已断开，请等待自动重连后重试`);
  }
}

function resolveItemName(itemId) {
  const id = toNum(itemId);
  const local = getItemById(id);
  if (local?.name) return local.name;
  if (QIXI_ITEM_META[id]?.name) return QIXI_ITEM_META[id].name;
  return id ? `物品#${id}` : '';
}

function normalizeItem(itemId, count) {
  const id = toNum(itemId);
  const num = toNum(count);
  return {
    itemId: id,
    itemCount: num,
    count: num,
    itemName: resolveItemName(id),
    image: getItemImageById(id) || '',
  };
}

function mergeItems(items) {
  const merged = new Map();
  for (const item of items || []) {
    if (!item || !item.itemId) continue;
    const prev = merged.get(item.itemId);
    if (prev) {
      prev.count += item.count;
      prev.itemCount = prev.count;
      continue;
    }
    merged.set(item.itemId, { ...item });
  }
  return [...merged.values()];
}

// ---- 极简 protobuf 读写（活动节点含本地 proto 未声明的字段，只能按原始字节走）----

function readFields(rawBytes) {
  const reader = protobuf.Reader.create(Buffer.from(rawBytes || []));
  const out = [];
  while (reader.pos < reader.len) {
    let tag = 0;
    try {
      tag = reader.uint32();
    } catch {
      break;
    }
    const field = tag >>> 3;
    const wire = tag & 0x7;
    try {
      if (wire === 0) out.push({ field, wire, value: toNum(reader.uint64()) });
      else if (wire === 2) out.push({ field, wire, value: Buffer.from(reader.bytes()) });
      else if (wire === 5) out.push({ field, wire, value: reader.uint32() });
      else if (wire === 1) out.push({ field, wire, value: toNum(reader.fixed64()) });
      else reader.skipType(wire);
    } catch {
      break;
    }
  }
  return out;
}

function fieldNum(entries, field, fallback = 0) {
  const hit = (entries || []).find(e => e.field === field && e.wire === 0);
  return hit ? toNum(hit.value) : fallback;
}

function fieldBytes(entries, field) {
  const hit = (entries || []).find(e => e.field === field && e.wire === 2);
  return hit ? Buffer.from(hit.value || []) : null;
}

function fieldBytesAll(entries, field) {
  return (entries || [])
    .filter(e => e.field === field && e.wire === 2)
    .map(e => Buffer.from(e.value || []));
}

function writeVarintField(writer, field, value) {
  writer.uint32((field << 3) | 0).uint64(Number(value) || 0);
  return writer;
}

function writeMessageField(writer, field, bytes) {
  writer.uint32((field << 3) | 2).bytes(Buffer.from(bytes || []));
  return writer;
}

/** corepb.Item 子消息（id / count / uid） */
function encodeCoreItem(itemId, count, uid = 0) {
  const w = protobuf.Writer.create();
  writeVarintField(w, 1, itemId);
  writeVarintField(w, 2, count);
  if (toNum(uid) > 0) writeVarintField(w, 6, uid);
  return w.finish();
}

/** 从 Operate/Use 回包里取奖励物品（field126 → field2 repeated item） */
function parseRewardItems(rawBody, targetField = QIXI_REWARD_REPLY_FIELD) {
  const rewards = [];
  const visit = (bytes, depth) => {
    if (!bytes || depth > 4) return;
    const entries = readFields(bytes);
    for (const entry of entries) {
      if (entry.wire !== 2) continue;
      if (entry.field === targetField) {
        for (const itemBytes of fieldBytesAll(readFields(entry.value), 2)) {
          const itemEntries = readFields(itemBytes);
          const id = fieldNum(itemEntries, 1);
          const count = fieldNum(itemEntries, 2);
          if (id > 0) rewards.push(normalizeItem(id, count || 1));
        }
        continue;
      }
      visit(entry.value, depth + 1);
    }
  };
  visit(Buffer.from(rawBody || []), 0);
  return mergeItems(rewards);
}

// ---- RPC ----

async function getQixiGroupRaw(activityId = QIXI_ROOT_ACTIVITY_ID) {
  const request = types.ActivityGetGroupRequest.encode(
    types.ActivityGetGroupRequest.create({
      id: Number(activityId) || QIXI_ROOT_ACTIVITY_ID,
      uid: QIXI_ACTIVITY_UID,
    })
  ).finish();
  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'GetGroup', request);
  return Buffer.from(body || []);
}

/** Operate（可选携带赠送目标扩展字段） */
async function operateQixi(cmd, options = {}) {
  assertQixiConnection('鹊桥寄情操作');

  const activityId = Number(options.activityId) || QIXI_MAIN_ACTIVITY_ID;
  const writer = protobuf.Writer.create();
  writeVarintField(writer, 1, activityId);
  writeVarintField(writer, 2, Number(cmd) || 0);
  if (toNum(options.targetGid) > 0) {
    const ext = protobuf.Writer.create();
    writeVarintField(ext, 1, toNum(options.targetGid));
    writeMessageField(writer, QIXI_GIFT_EXT_FIELD, ext.finish());
  }

  qixiLogger.info('鹊桥寄情活动操作', {
    event: 'qixi_operate',
    activityId,
    cmd: Number(cmd) || 0,
    targetGid: toNum(options.targetGid) || undefined,
  });

  const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', writer.finish());
  return Buffer.from(body || []);
}

/** 使用鹊羽灵露（自家 host_gid=0，好友传对方 gid） */
async function useQixiLu(hostGid = 0, uid = 0) {
  assertQixiConnection('鹊羽灵露喷洒');

  const writer = protobuf.Writer.create();
  writeMessageField(writer, 1, encodeCoreItem(QIXI_LU_ITEM_ID, 1, uid));
  const scene = protobuf.Writer.create();
  writeVarintField(scene, 1, toNum(hostGid));
  writeVarintField(scene, 2, QIXI_SPRAY_SOURCE);
  writeMessageField(writer, 2, scene.finish());

  const { body } = await sendMsgAsync('gamepb.itempb.ItemService', 'Use', writer.finish());
  return Buffer.from(body || []);
}

// ---- 数据解析 ----

function parsePayload(rawPayload) {
  if (!rawPayload) return null;
  if (typeof rawPayload === 'object') return rawPayload;
  try {
    return JSON.parse(String(rawPayload));
  } catch {
    return null;
  }
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]+>/g, '');
}

/** payload.tips 按【标题】分段，<br/> 拆条，供面板展示玩法说明 */
function parseTips(payload) {
  const tips = payload?.tips;
  if (!tips || !Array.isArray(tips.txt)) return null;
  const sections = [];
  let current = null;
  for (const line of tips.txt) {
    const text = stripTags(line).trim();
    if (!text) continue;
    if (/^【[^】]+】$/.test(text)) {
      current = { title: text.replace(/^【|】$/g, ''), items: [] };
      sections.push(current);
      continue;
    }
    const parts = String(line).split(/<br\s*\/?>/i);
    for (const part of parts) {
      const item = stripTags(part).trim();
      if (!item) continue;
      if (current) current.items.push(item);
      else sections.push({ title: item, items: [] });
    }
  }
  return { title: tips.title || '活动说明', sections };
}

/**
 * 定位活动树中的节点。
 * ActivityNode: {1: ActivityInfo, 2: repeated ActivityNode, 112: 筑桥档位}
 */
function findActivityNodes(rawBody) {
  const nodes = [];
  const walk = (nodeBytes, depth) => {
    if (!nodeBytes || depth > 5) return;
    const entries = readFields(nodeBytes);
    const infoBytes = fieldBytes(entries, 1);
    if (infoBytes) {
      const infoEntries = readFields(infoBytes);
      const id = fieldNum(infoEntries, 1);
      if (id > 0) {
        nodes.push({
          id,
          parentId: fieldNum(infoEntries, 2),
          type: fieldNum(infoEntries, 3),
          title: (fieldBytes(infoEntries, 4) || Buffer.alloc(0)).toString('utf8'),
          payload: parsePayload((fieldBytes(infoEntries, 5) || Buffer.alloc(0)).toString('utf8')),
          startTime: fieldNum(infoEntries, 6),
          endTime: fieldNum(infoEntries, 7),
          status: fieldNum(infoEntries, 21),
          nodeEntries: entries,
        });
      }
    }
    for (const child of fieldBytesAll(entries, 2)) walk(child, depth + 1);
  };

  // GetGroupReply{1: ActivityNode}
  const rootBytes = fieldBytes(readFields(rawBody), 1);
  walk(rootBytes || rawBody, 0);
  return nodes;
}

/**
 * 解析筑桥档位。
 * node.112 = {2: repeated tier{1: 档号, 2: 消耗鹊羽, 4: 状态(2=已领取), ...奖励}}
 * 奖励物品字段号在不同档位可能变化，这里对档位子消息做一次深度扫描收集 item{1:id,2:count}
 */
function parseBridgeTiers(nodeEntries) {
  const configBytes = fieldBytes(nodeEntries || [], QIXI_BRIDGE_NODE_FIELD);
  if (!configBytes) return [];

  const tiers = [];
  for (const tierBytes of fieldBytesAll(readFields(configBytes), 2)) {
    const entries = readFields(tierBytes);
    const tier = fieldNum(entries, 1);
    if (tier <= 0) continue;
    const flag = fieldNum(entries, 4);
    const consume = fieldNum(entries, 2) || fieldNum(entries, 3);

    const rewards = [];
    const collect = (bytes, depth) => {
      if (!bytes || depth > 3) return;
      for (const entry of readFields(bytes)) {
        if (entry.wire !== 2) continue;
        const sub = readFields(entry.value);
        const id = fieldNum(sub, 1);
        const count = fieldNum(sub, 2);
        const looksLikeItem = id > 0 && count > 0 && sub.every(e => e.wire === 0 || e.field >= 6);
        if (looksLikeItem) rewards.push(normalizeItem(id, count));
        else collect(entry.value, depth + 1);
      }
    };
    collect(tierBytes, 0);

    tiers.push({
      tier,
      consume,
      claimed: flag === 2,
      flag,
      rewards: mergeItems(rewards),
    });
  }
  return tiers.sort((a, b) => a.tier - b.tier);
}

async function getQixiBagCounts() {
  const bag = await getBag();
  const items = getBagItems(bag) || [];
  const counts = { feather: 0, sachet: 0, lu: 0, luUid: 0 };
  for (const item of items) {
    const id = toNum(item?.id);
    const count = Math.max(0, toNum(item?.count));
    if (id === QIXI_FEATHER_ITEM_ID) counts.feather += count;
    else if (id === QIXI_SACHET_ITEM_ID) counts.sachet += count;
    else if (id === QIXI_LU_ITEM_ID) {
      counts.lu += count;
      if (!counts.luUid && toNum(item?.uid) > 0) counts.luUid = toNum(item.uid);
    }
  }
  return counts;
}

function buildQixiActivityBase(counts) {
  return {
    uid: QIXI_ACTIVITY_UID,
    title: '鹊桥寄情',
    activityId: QIXI_ROOT_ACTIVITY_ID,
    mainActivityId: QIXI_MAIN_ACTIVITY_ID,
    sideActivityId: QIXI_SIDE_ACTIVITY_ID,
    bridgeCommand: QIXI_BRIDGE_CMD,
    giftCommand: QIXI_GIFT_CMD,
    startTime: 0,
    endTime: 0,
    nowTime: Math.floor(Date.now() / 1000),
    available: false,
    feather: counts.feather,
    sachet: counts.sachet,
    luStock: counts.lu,
    items: {
      feather: normalizeItem(QIXI_FEATHER_ITEM_ID, counts.feather),
      sachet: normalizeItem(QIXI_SACHET_ITEM_ID, counts.sachet),
      lu: normalizeItem(QIXI_LU_ITEM_ID, counts.lu),
    },
    tiers: [],
    nextTier: null,
    bridgeTarget: 0,
    claimableTierCount: 0,
    claimedTierCount: 0,
    passiveLimit: 3,
    tips: null,
    warning: '',
  };
}

async function getQixiActivity() {
  const counts = await getQixiBagCounts();
  const activity = buildQixiActivityBase(counts);

  if (!getUserState() || !isConnected()) {
    activity.warning = '账号连接未就绪，仅显示背包物品数量';
    return activity;
  }

  try {
    const rawBody = await getQixiGroupRaw(QIXI_ROOT_ACTIVITY_ID);
    const nodes = findActivityNodes(rawBody);
    const root = nodes.find(n => n.id === QIXI_ROOT_ACTIVITY_ID) || nodes[0] || null;
    const main = nodes.find(n => n.id === QIXI_MAIN_ACTIVITY_ID) || null;

    activity.title = root?.title || main?.title || activity.title;
    activity.startTime = root?.startTime || main?.startTime || 0;
    activity.endTime = root?.endTime || main?.endTime || 0;
    activity.status = main?.status ?? root?.status ?? 0;
    activity.tips = parseTips(main?.payload || root?.payload);

    const nowSeconds = activity.nowTime;
    activity.available = !!(activity.startTime && activity.endTime
      && nowSeconds >= activity.startTime && nowSeconds <= activity.endTime);
    if (activity.startTime && nowSeconds < activity.startTime) activity.warning = '活动尚未开始';
    else if (activity.endTime && nowSeconds > activity.endTime) activity.warning = '活动已结束';

    const tiers = parseBridgeTiers(main?.nodeEntries);
    activity.tiers = tiers.map(tier => ({
      ...tier,
      claimable: !tier.claimed && tier.consume > 0 && counts.feather >= tier.consume,
    }));
    activity.claimedTierCount = activity.tiers.filter(t => t.claimed).length;
    activity.claimableTierCount = activity.tiers.filter(t => t.claimable).length;
    activity.nextTier = activity.tiers.find(t => !t.claimed) || null;
    activity.bridgeTarget = activity.nextTier?.consume || 0;
  } catch (err) {
    activity.warning = err?.message || String(err);
    qixiLogger.warn('获取鹊桥寄情活动失败', {
      event: 'qixi_activity_fetch_failed',
      error: activity.warning,
    });
  }

  return activity;
}

function isAlreadyClaimedError(err) {
  const message = String(err?.message || err || '');
  return QIXI_ALREADY_CLAIMED_HINTS.some(hint => message.includes(hint));
}

/**
 * 喷洒鹊羽灵露
 * @param {{hostGid?: number, count?: number}} options hostGid>0 时喷好友农场，count 为连续喷洒次数
 */
async function sprayQixiLu(options = {}) {
  assertQixiConnection('鹊羽灵露喷洒');

  const hostGid = Math.max(0, toNum(options.hostGid));
  const requested = Math.max(1, Math.min(20, toNum(options.count) || 1));
  const before = await getQixiBagCounts();
  if (before.lu <= 0) throw new Error('鹊羽灵露库存为空，请先从每日任务/商城领取');

  const times = Math.min(requested, before.lu);
  const rewards = [];
  const errors = [];
  let sprayed = 0;
  let entered = false;

  try {
    if (hostGid > 0) {
      await enterFriendFarm(hostGid, { reason: 2 });
      entered = true;
    }

    for (let i = 0; i < times; i += 1) {
      const counts = i === 0 ? before : await getQixiBagCounts();
      if (counts.lu <= 0) break;
      try {
        const body = await useQixiLu(hostGid, counts.luUid);
        sprayed += 1;
        try {
          const reply = types.UseReply.decode(body);
          for (const item of reply.items || []) {
            const id = toNum(item?.id);
            if (id > 0) rewards.push(normalizeItem(id, toNum(item?.count) || 1));
          }
        } catch {
          rewards.push(...parseRewardItems(body, 1));
        }
      } catch (err) {
        errors.push(err?.message || String(err));
        break;
      }
    }
  } finally {
    if (entered) await leaveFriendFarm(hostGid);
  }

  const after = await getQixiBagCounts();
  const featherGain = Math.max(0, after.feather - before.feather);

  qixiLogger.info('鹊羽灵露喷洒完成', {
    event: 'qixi_spray',
    hostGid: hostGid || undefined,
    sprayed,
    featherGain,
    luLeft: after.lu,
    errors: errors.length ? errors : undefined,
  });

  if (!sprayed && errors.length) throw new Error(errors[0]);

  return {
    ok: true,
    hostGid,
    sprayed,
    featherGain,
    rewards: mergeItems(rewards),
    errors,
    luLeft: after.lu,
    activity: await getQixiActivity(),
  };
}

/**
 * 筑建鹊桥
 * @param {{all?: boolean}} options all=true 时连续领取当前鹊羽足够的所有档位
 */
async function buildQixiBridge(options = {}) {
  assertQixiConnection('筑建鹊桥');

  const claimAll = options.all !== false;
  const before = await getQixiActivity();
  if (!before.tiers.length) throw new Error('未取到筑桥档位数据，请稍后重试');

  const claimedTiers = [];
  const rewards = [];
  let alreadyClaimed = false;
  let activity = before;

  for (let round = 0; round < (claimAll ? before.tiers.length : 1); round += 1) {
    const next = activity.nextTier;
    if (!next) break;
    if (!(next.consume > 0 && activity.feather >= next.consume)) break;

    try {
      const body = await operateQixi(QIXI_BRIDGE_CMD);
      rewards.push(...parseRewardItems(body));
      claimedTiers.push({ tier: next.tier, consume: next.consume });
    } catch (err) {
      if (isAlreadyClaimedError(err)) {
        alreadyClaimed = true;
      } else if (!claimedTiers.length) {
        throw err;
      }
      break;
    }
    activity = await getQixiActivity();
  }

  if (!claimedTiers.length) activity = await getQixiActivity();

  qixiLogger.info('筑建鹊桥完成', {
    event: 'qixi_bridge',
    claimedTiers: claimedTiers.map(t => t.tier),
    rewardCount: rewards.length,
    featherLeft: activity.feather,
    alreadyClaimed,
  });

  return {
    ok: true,
    claimed: claimedTiers.length > 0,
    alreadyClaimed,
    claimedTiers,
    rewards: mergeItems(rewards),
    activity,
  };
}

/** 赠送鹊羽香囊给好友 */
async function giftQixiSachet(hostGid) {
  assertQixiConnection('赠送鹊羽香囊');

  const gid = toNum(hostGid);
  if (gid <= 0) throw new Error('缺少赠送目标好友');

  const before = await getQixiBagCounts();
  if (before.sachet <= 0) throw new Error('鹊羽香囊库存为空，先筑建鹊桥获取');

  let entered = false;
  let body = null;
  try {
    await enterFriendFarm(gid, { reason: 2 });
    entered = true;
    body = await operateQixi(QIXI_GIFT_CMD, { targetGid: gid });
  } finally {
    if (entered) await leaveFriendFarm(gid);
  }

  const after = await getQixiBagCounts();
  const used = Math.max(0, before.sachet - after.sachet);

  qixiLogger.info('赠送鹊羽香囊完成', {
    event: 'qixi_gift',
    hostGid: gid,
    used,
    sachetLeft: after.sachet,
  });

  return {
    ok: true,
    hostGid: gid,
    used,
    sachetLeft: after.sachet,
    rewards: parseRewardItems(body),
    activity: await getQixiActivity(),
  };
}

module.exports = {
  QIXI_ACTIVITY_UID,
  QIXI_ROOT_ACTIVITY_ID,
  QIXI_MAIN_ACTIVITY_ID,
  QIXI_SIDE_ACTIVITY_ID,
  QIXI_BRIDGE_CMD,
  QIXI_GIFT_CMD,
  QIXI_FEATHER_ITEM_ID,
  QIXI_SACHET_ITEM_ID,
  QIXI_LU_ITEM_ID,
  getQixiActivity,
  sprayQixiLu,
  buildQixiBridge,
  giftQixiSachet,
  parseBridgeTiers,
  parseTips,
  findActivityNodes,
};
