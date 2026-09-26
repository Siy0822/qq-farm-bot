/**
 * 萌宠成长日记（萌宠养成 / 宝藏护送 / 锦囊 / 拾物小铺）
 *
 * 移植自上游 liyangpengs/qq-farm-bot core/src/services/activity-center/pet-diary.ts（commit bb2f78a）。
 *
 * 活动分组 2026090100，子活动：
 *   - 2026090101 萌宠养成（投喂 / 领养 / 手记 / 锦囊 / 夺宝 / 开宝箱）
 *   - 2026090102 种子礼包（mega_event）
 *   - 2026090103 拾物小铺（shop）
 *
 * 【与上游的差异】
 * 上游把本服务挂在自研的 activity-center 容器里，依赖容器注入 itemDto / textContent /
 * positiveDecimal / serializeMutation 等一堆 helper；本机没有那套框架，因此本文件自带
 * 等价 helper，并把节令领取直接接到本地 activity.js 的 getSolarTermsInfo/claimSolarTermsReward。
 *
 * 【安全约束（与上游一致）】
 * - 锦囊刷新只允许「免费」或「点券」，绝不落到钻石；
 * - 拾物小铺遇到可能消耗钻石的商品直接拒绝；
 * - 投喂/寻宝/兑换/夺宝下单前都重新读背包余额，余额不足即停。
 */
const catalog = require('../activity-data/pet-diary-2026090101.json');
const assets = require('../activity-data/pet-diary-assets.json');
const { sendMsgAsync } = require('../utils/network');
const { types, getRoot } = require('../utils/proto');
const { toNum, getServerTimeSec } = require('../utils/utils');
const { getItemById, getItemImageById } = require('../config/gameConfig');

const ACTIVITY_SVC = 'gamepb.activitypb.ActivityService';

const GROUP_ID = '2026090100';
const PET_ID = '2026090101';
const SEEDS_ID = '2026090102';
const SHOP_ID = '2026090103';
const DIAMOND_ID = '1004';

const base = catalog.ActivityPetTreasureHuntBase[0];
const fight = catalog.ActivityPetTreasureHuntFight[0];
const refresh = catalog.ActivityPetTreasureCharmRefresh[0];
const assetPaths = new Map(
  assets.map(entry => [String(entry.path).replace(/\/spriteFrame$/, ''), `/activity-assets/pet-diary/${entry.file}`])
);

// 命令号与回包字段一一对应，取自官方 1.14.x 编码器（非按响应长度猜测）。
const OPERATIONS = {
  initialize: [27, 'pet_treasure_hunt_finish_cg'],
  feed: [29, 'pet_treasure_hunt_feed'],
  draw: [30, 'pet_treasure_hunt_draw'],
  story: [32, 'pet_treasure_hunt_claim_story'],
  refreshCharm: [41, 'pet_treasure_hunt_refresh_charm_pool'],
  equipCharm: [42, 'pet_treasure_hunt_equip_charms'],
  battle: [43, 'pet_treasure_hunt_start_battle'],
  openTreasure: [45, 'pet_treasure_hunt_open_treasure'],
  compensation: [46, 'pet_treasure_hunt_claim_plunder_compensation'],
  claimDog: [48, 'pet_treasure_hunt_claim_dog'],
  markStories: [49, 'pet_treasure_hunt_mark_story_animated'],
  skipBattle: [50, 'pet_treasure_hunt_set_skip_battle_cg'],
  seeds: [21, 'mega_event_claim_all'],
  exchange: [1, 'shop_buy'],
};

const MAX_SIGNED_INT64 = 9223372036854775807n;

// 同一账号一个模块实例：写操作与快照读取串行，避免并发下重复下单。
let mutationTail = Promise.resolve();
let pendingRead = null;

// ─── helper ───

function businessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fail(message) {
  throw businessError('PET_DIARY_UNAVAILABLE', message);
}

function int64String(value) {
  if (value == null) return '0';
  if (typeof value === 'string') return /^-?\d+$/.test(value) ? value : '0';
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : '0';
  if (typeof value.toNumber === 'function') {
    try { return value.toNumber().toString(); } catch { return '0'; }
  }
  if (typeof value.toString === 'function') {
    const text = value.toString();
    return /^-?\d+$/.test(text) ? text : '0';
  }
  return '0';
}

function int64Number(value) {
  const parsed = Number(int64String(value));
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function positiveDecimal(value, code, fieldName) {
  let normalized = '';
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) normalized = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) normalized = String(value);
  if (!normalized || normalized.length > 19 || BigInt(normalized) > MAX_SIGNED_INT64) {
    throw businessError(code, `${fieldName} 必须是 int64 范围内的正十进制整数`);
  }
  return normalized;
}

function bytesToText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try { return Buffer.from(value).toString('utf8'); } catch { return ''; }
}

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function textContent(value) {
  const text = bytesToText(value).trim();
  if (!text) return { title: '', paragraphs: [] };
  try {
    const parsed = JSON.parse(text);
    const tips = parsed && typeof parsed === 'object' ? parsed.tips : null;
    const raw = tips && Array.isArray(tips.txt) ? tips.txt : [];
    const paragraphs = raw.filter(entry => typeof entry === 'string').map(plainText).filter(Boolean);
    if (paragraphs.length) {
      return { title: typeof tips.title === 'string' ? plainText(tips.title) : '', paragraphs };
    }
    return { title: '', paragraphs: [plainText(text)].filter(Boolean) };
  } catch {
    return { title: '', paragraphs: [plainText(text)].filter(Boolean) };
  }
}

function parseJson(value) {
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
}

function itemDto(item) {
  const rawId = item && (item.item_id ?? item.itemId ?? item.id);
  const id = int64String(rawId);
  const numericId = int64Number(rawId);
  const metadata = numericId > 0 ? getItemById(numericId) : null;
  return {
    id,
    count: int64String(item && item.count),
    name: (metadata && metadata.name) || bytesToText(item && item.name) || (numericId > 0 ? `物品 #${numericId}` : '未知物品'),
    image: numericId > 0 ? getItemImageById(numericId) : '',
    rarity: Number(metadata && metadata.rarity) || 0,
  };
}

function itemList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map(itemDto);
}

function localImage(value) {
  return assetPaths.get(String(value || '').replace(/\/spriteFrame$/, '')) || '';
}

function isActive(head) {
  const now = getServerTimeSec();
  const start = toNum(head && head.start_time);
  const end = toNum(head && head.end_time);
  return start > 0 && now >= start && now <= end;
}

function plainReply(selector, value) {
  try {
    return getRoot().lookupType(`gamepb.activitypb.${selector}`).toObject(value, { longs: String, defaults: true });
  } catch {
    return null;
  }
}

// ─── 背包 ───

async function balances() {
  const warehouse = require('./warehouse');
  const result = new Map();
  for (const item of warehouse.getBagItems(await warehouse.getBag())) {
    const id = int64String(item && item.id);
    result.set(id, (BigInt(result.get(id) || '0') + BigInt(int64String(item && item.count))).toString());
  }
  return result;
}

function costsAvailable(costs, bag, count = '1') {
  const list = Array.isArray(costs) ? costs : [];
  if (!bag || !list.length) return false;
  const totals = new Map();
  for (const item of list) {
    const id = int64String(item && item.id);
    if (id === DIAMOND_ID || id === '0' || BigInt(int64String(item && item.count)) <= 0n) return false;
    totals.set(id, (totals.get(id) || 0n) + BigInt(int64String(item && item.count)) * BigInt(count));
  }
  return [...totals].every(([id, amount]) => BigInt(bag.get(id) || '0') >= amount);
}

function feedCosts() {
  return String(base.feed_items || '').split(';').filter(Boolean).map((value) => {
    const [id, count] = value.split(':');
    return { id, count };
  });
}

function charmRefreshCost() {
  return { id: String(refresh.manual_refresh_cost_id), count: String(refresh.manual_refresh_cost_count) };
}

function charmNeedsChoice(battle) {
  return (Array.isArray(battle && battle.charm_equipped) ? battle.charm_equipped : []).length > 0
    && battle.charm_pick_used !== true;
}

// ─── RPC ───

async function rpc(method, typeName, replyTypeName, input) {
  const type = types[typeName];
  const request = type.fromObject(input);
  const { body } = await sendMsgAsync(ACTIVITY_SVC, method, Buffer.from(type.encode(request).finish()));
  return types[replyTypeName].decode(body);
}

async function operate(activityId, command, selector, params = {}) {
  const reply = await rpc('Operate', 'PetDiaryOperateRequest', 'PetDiaryOperateReply', {
    activity_id: activityId,
    operate_type: command,
    ...(selector ? { [selector]: params } : {}),
  });
  if (int64String(reply.activity_id) !== activityId || toNum(reply.operate_type) !== command) {
    fail('活动响应不匹配，请刷新后查看结果');
  }
  if (selector && !Object.hasOwn(reply, selector)) {
    fail('活动响应缺少操作结果，请刷新后查看结果');
  }
  return reply;
}

async function readGroup() {
  const reply = await rpc('GetGroup', 'ActivityGetGroupRequest', 'PetDiaryGetGroupReply', { id: GROUP_ID, uid: '' });
  const head = reply.group && reply.group.head;
  if (int64String(head && head.id) !== GROUP_ID) fail('服务端未返回萌宠成长日记活动');
  const children = Array.isArray(reply.group.children) ? reply.group.children : [];
  const pet = children.find(entry => int64String(entry.head && entry.head.id) === PET_ID);
  if (!pet || !pet.pet_treasure_hunt) fail('服务端未返回萌宠养成状态');
  return {
    pet,
    seeds: children.find(entry => int64String(entry.head && entry.head.id) === SEEDS_ID),
    shop: children.find(entry => int64String(entry.head && entry.head.id) === SHOP_ID),
  };
}

// ─── 归一化 ───

function treasureDto(value) {
  return {
    id: String(value.id),
    status: toNum(value.status),
    item: itemDto({ id: value.item_id, count: value.count }),
    protectedCount: int64String(value.protected_count),
    originalCount: int64String(value.original_count),
    maxCount: int64String(value.max_count),
    startTime: toNum(value.start_at) * 1000,
    endTime: toNum(value.end_at) * 1000,
    createdTime: toNum(value.created_at) * 1000,
    sourceCharmIds: (Array.isArray(value.source_charm_ids) ? value.source_charm_ids : []).map(Number),
    plunderCount: toNum(value.plunder_count),
    maxPlunderCount: toNum(value.max_plunder_count),
    previews: (Array.isArray(value.battle_previews) ? value.battle_previews : []).map(p => ({
      challengeId: int64String(p.challenge_item_id),
      canStart: p.can_start === true,
      maxProfit: itemDto(p.max_profit),
      maxLoss: itemDto(p.max_loss),
      plunderableCount: int64String(p.plunderable_count),
    })),
  };
}

function normalize(group, bag, solar) {
  const state = group.pet.pet_treasure_hunt || {};
  const nurture = state.nurture || {};
  const hunt = state.hunt || {};
  const battle = state.battle || {};
  const active = isActive(group.pet.head);
  const adult = toNum(nurture.stage) === 2;
  const warnings = [];

  const availableSeeds = Array.isArray(group.seeds && group.seeds.mega_event && group.seeds.mega_event.rewards)
    ? group.seeds.mega_event.rewards
    : [];

  const charmDto = (id) => {
    const config = catalog.ActivityPetTreasureHuntCharm.find(entry => entry.charm_id === id);
    return {
      id,
      name: (config && config.name) || `锦囊 ${id}`,
      description: (config && config.desc) || '',
      shortDescription: (config && (config.short_desc || config.desc)) || '',
      useLimit: (config && config.use_limit) ?? 0,
      image: localImage(config && config.icon_path),
      remaining: (Array.isArray(battle.charm_effect_remaining_count) ? battle.charm_effect_remaining_count : [])
        .filter(e => toNum(e.charm_id) === id)
        .map(e => toNum(e.remaining_count)),
    };
  };

  const goods = (Array.isArray(group.shop && group.shop.shop && group.shop.shop.goods)
    ? group.shop.shop.goods
    : []).map((g) => {
    const limit = BigInt(int64String(g.purchase_limit));
    const purchased = BigInt(int64String(g.purchased_count));
    const remaining = limit > 0n ? (limit > purchased ? (limit - purchased).toString() : '0') : null;
    const costList = Array.isArray(g.cost) ? g.cost : [];
    const safeCosts = costList.length > 0
      && costList.every(c => int64String(c.id) !== DIAMOND_ID)
      && toNum(g.diamond_cost_count) === 0;
    return {
      id: int64String(g.id),
      name: String(g.name || ''),
      image: localImage(parseJson(g.desc).res) || itemDto((Array.isArray(g.item) ? g.item : [])[0]).image,
      rewards: itemList(g.item),
      costs: itemList(g.cost),
      limit: int64String(g.purchase_limit),
      purchased: int64String(g.purchased_count),
      remaining,
      exchangeable: active && isActive(group.shop && group.shop.head) && safeCosts
        && remaining !== '0' && costsAvailable(costList, bag),
      safeCosts,
      order: toNum(g.order),
      category: String(g.category_tag || '游记好礼'),
    };
  }).sort((a, b) => a.order - b.order);

  const canClaimSeeds = availableSeeds.some(r => r.claimable === true && r.claimed !== true);
  const freeRefreshRemaining = Math.max(0, refresh.free_refresh_daily_limit - toNum(battle.charm_free_refresh_count));
  const paidRefreshCount = toNum(battle.charm_paid_refresh_count);
  const paidRefreshRemaining = Math.max(0, refresh.manual_refresh_daily_limit - paidRefreshCount);
  const canChooseCharm = active && adult && battle.charm_pick_used !== true
    && (Array.isArray(battle.charm_daily_pool) ? battle.charm_daily_pool : []).length > 0;

  return {
    activityId: PET_ID,
    groupId: GROUP_ID,
    title: '萌宠成长日记',
    active,
    startTime: toNum(group.pet.head.start_time) * 1000,
    endTime: toNum(group.pet.head.end_time) * 1000,
    serverTime: getServerTimeSec() * 1000,
    rules: textContent(group.pet.head.desc).paragraphs,
    warnings,
    balances: [1028, 1029, 80101, 80102, 80103, 1002].map(id => ({
      ...itemDto({ id, count: bag ? (bag.get(String(id)) || '0') : '0' }),
      known: bag !== null,
    })),
    nurture: {
      initialized: nurture.cg_played === true,
      adult,
      growth: toNum(nurture.growth),
      adultGrowth: base.growth_adult_threshold,
      dogGranted: nurture.dog_granted === true,
      feedCount: toNum(state.feed && state.feed.feed_count),
      feedLimit: base.daily_feed_limit,
      feedCosts: itemList(feedCosts()),
      canFeed: active && !adult && toNum(nurture.stage) === 1
        && toNum(state.feed && state.feed.feed_count) < base.daily_feed_limit
        && costsAvailable(feedCosts(), bag),
    },
    hunt: {
      count: toNum(hunt.treasure_count),
      limit: base.daily_treasure_limit,
      total: int64String(hunt.treasure_total),
      luckyStarTotal: int64String(hunt.lucky_star_gained_total),
      costs: itemList(hunt.treasure_cost),
      canDraw: active && adult && toNum(hunt.treasure_count) < base.daily_treasure_limit
        && costsAvailable(hunt.treasure_cost, bag),
      canPlunder: active && hunt.can_play_plunder === true && toNum(battle.battle_count) < fight.daily_battle_limit,
    },
    seeds: {
      canClaim: active && isActive(group.seeds && group.seeds.head) && canClaimSeeds,
      days: availableSeeds.map(r => ({
        day: toNum(r.unlock_day),
        claimed: r.claimed === true,
        claimable: r.claimable === true,
        rewards: itemList(r.reward),
      })),
    },
    stories: (Array.isArray(state.story && state.story.stories) ? state.story.stories : []).map((s) => {
      const desc = parseJson(s.selected_desc);
      return {
        order: toNum(s.order),
        unlocked: s.unlocked === true,
        claimed: s.claimed === true,
        animated: s.animated === true,
        photo: localImage(desc.photo),
      };
    }),
    charms: {
      pool: (Array.isArray(battle.charm_daily_pool) ? battle.charm_daily_pool : []).map(charmDto),
      equipped: (Array.isArray(battle.charm_equipped) ? battle.charm_equipped : []).map(charmDto),
      all: catalog.ActivityPetTreasureHuntCharm.map(c => charmDto(c.charm_id)),
      picked: battle.charm_pick_used === true,
      canChoose: canChooseCharm,
      freeRefreshRemaining,
      freeRefreshLimit: refresh.free_refresh_daily_limit,
      paidRefreshCount,
      paidRefreshRemaining,
      paidRefreshLimit: refresh.manual_refresh_daily_limit,
      refreshCost: itemDto(charmRefreshCost()),
      refreshBalance: bag ? (bag.get(String(refresh.manual_refresh_cost_id)) || '0') : null,
      canRefresh: active && adult && !charmNeedsChoice(battle)
        && (freeRefreshRemaining > 0
          || (paidRefreshRemaining > 0 && costsAvailable([charmRefreshCost()], bag))),
      refreshNote: `每日免费 ${refresh.free_refresh_daily_limit} 次，之后每次 ${refresh.manual_refresh_cost_count} 点券，今日还可付费刷新 ${paidRefreshRemaining} 次。点券不足时不刷新。`,
    },
    treasures: (Array.isArray(state.pool && state.pool.treasures) ? state.pool.treasures : []).map(treasureDto),
    compensationCount: int64String(state.plunder && state.plunder.plunder_compensation_count),
    battleCount: toNum(battle.battle_count),
    battleLimit: fight.daily_battle_limit,
    skipBattle: battle.is_skip_battle_cg === true,
    shop: goods,
    solarTerms: solar ? {
      ...solar,
      terms: (Array.isArray(solar.terms) ? solar.terms : []).filter(term => (
        Number(term.endTime) >= toNum(group.pet.head.start_time)
        && Number(term.startTime) <= toNum(group.pet.head.end_time)
      )),
    } : null,
    plants: [20516, 29004, 25995, 21625, 20154, 21072].map(id => itemDto({
      id,
      count: bag ? (bag.get(String(id)) || '0') : '0',
    })),
  };
}

async function readSnapshot() {
  const group = await readGroup();
  const warnings = [];
  try {
    const shop = await operate(SHOP_ID, 7);
    if (!(shop.data && shop.data.shop)) fail('拾物小铺目录缺失');
    group.shop = shop.data;
  } catch (error) {
    group.shop = null;
    warnings.push(`拾物小铺：${error.message}`);
  }
  let bag = null;
  let solar = null;
  try { bag = await balances(); } catch { warnings.push('背包读取失败，消耗资源的操作已暂停'); }
  try { solar = await require('./activity').getSolarTermsInfo(); } catch { warnings.push('节令小礼读取失败，请稍后刷新'); }
  const normalized = normalize(group, bag, solar);
  normalized.warnings = warnings;
  return normalized;
}

// ─── 对外读取 ───

function getPetDiary() {
  if (pendingRead) return pendingRead;
  pendingRead = readSnapshot().finally(() => { pendingRead = null; });
  return pendingRead;
}

async function getPetDiaryRecords(kind) {
  if (kind !== 'interact' && kind !== 'plunder') fail('未知记录类型');
  const selector = kind === 'interact' ? 'pet_treasure_hunt_get_log' : 'pet_treasure_hunt_get_plundered_log';
  const reply = await operate(PET_ID, kind === 'interact' ? 31 : 44, selector);
  const logs = (reply[selector] && reply[selector].logs) || [];
  return logs.map(entry => (kind === 'interact'
    ? {
      time: toNum(entry.ts) * 1000,
      type: toNum(entry.type),
      costs: itemList(entry.costs),
      rewards: itemList(entry.rewards),
      dogId: int64String(entry.dog_id),
      skins: (Array.isArray(entry.dog_skin_ids) ? entry.dog_skin_ids : []).map(int64String),
    }
    : {
      time: toNum(entry.ts) * 1000,
      attackerGid: int64String(entry.attacker_gid),
      name: String(entry.attacker_name || ''),
      won: entry.attacker_won === true,
      treasureId: String(entry.treasure_id || ''),
      challenge: itemDto({ id: entry.challenge_item_id, count: 1 }),
      level: toNum(entry.attacker_level),
      attackerCharms: (Array.isArray(entry.attacker_charm) ? entry.attacker_charm : []).map(Number),
      defenderCharms: (Array.isArray(entry.defender_charm) ? entry.defender_charm : []).map(Number),
      lost: itemList(entry.lost_items),
      injected: itemList(entry.injected_items),
      fake: entry.is_fake === true,
    }));
}

async function getPetDiaryFriend(gidInput) {
  const gid = positiveDecimal(gidInput, 'INVALID_FRIEND_GID', '好友 GID');
  const reply = await operate(PET_ID, 47, 'pet_treasure_hunt_get_friend_activity_info', { friend_gid: gid });
  const result = reply.pet_treasure_hunt_get_friend_activity_info;
  if (int64String(result.gid) !== gid) fail('好友响应不匹配');
  return {
    gid,
    treasures: ((result.info && result.info.treasures) || []).map(treasureDto),
    charms: (result.info && result.info.defender_charm_ids) || [],
  };
}

// ─── 操作 ───

async function claimSolar(termIdInput) {
  const termId = positiveDecimal(termIdInput, 'INVALID_SOLAR_TERM', '节令编号');
  const group = await readGroup();
  if (!isActive(group.pet.head)) fail('萌宠成长日记当前不在活动时间内');
  const activity = require('./activity');
  const solar = await activity.getSolarTermsInfo();
  const term = (solar.terms || []).find(t => String(t.id) === termId
    && Number(t.endTime) >= toNum(group.pet.head.start_time)
    && Number(t.startTime) <= toNum(group.pet.head.end_time));
  if (!term || !term.claimable) fail('该节令当前不可领取');

  const claimed = await activity.claimSolarTermsReward(termId);
  let snapshot = null;
  let refreshError = '';
  try { snapshot = await readSnapshot(); } catch (error) { refreshError = `领取已成功，刷新失败：${error.message}`; }
  return {
    action: 'solar',
    rewards: itemList(claimed.rewards),
    snapshot,
    refreshError,
    message: '节令好礼领取成功',
  };
}

async function performOperation(actionInput, input = {}) {
  if (actionInput === 'solar') return claimSolar(input && input.termId);
  if (typeof actionInput !== 'string' || !Object.hasOwn(OPERATIONS, actionInput)) fail('未知萌宠操作');

  const action = actionInput;
  const group = await readGroup();
  if (!isActive(group.pet.head)) fail('萌宠成长日记当前不在活动时间内');

  const state = group.pet.pet_treasure_hunt || {};
  const nurture = state.nurture || {};
  const battle = state.battle || {};
  let params = {};
  let id = PET_ID;

  if (action === 'feed' || action === 'draw') {
    if (action === 'feed' && (toNum(nurture.stage) !== 1 || toNum(state.feed && state.feed.feed_count) >= base.daily_feed_limit)) {
      fail('当前不可投喂');
    }
    if (action === 'draw' && (toNum(nurture.stage) !== 2 || toNum(state.hunt && state.hunt.treasure_count) >= base.daily_treasure_limit)) {
      fail('当前不可寻宝');
    }
    const costs = action === 'feed' ? feedCosts() : (state.hunt && state.hunt.treasure_cost);
    if (!costsAvailable(costs, await balances())) fail('萌宠元气糕不足，请先种植活动作物');
  } else if (action === 'initialize' && nurture.cg_played) {
    fail('已领养比熊，请刷新状态');
  } else if (action === 'claimDog' && (toNum(nurture.stage) !== 2 || nurture.dog_granted)) {
    fail('比熊尚未成年或已经领取');
  } else if (action === 'story') {
    const order = positiveDecimal(input && input.order, 'INVALID_STORY', '手记编号');
    const stories = Array.isArray(state.story && state.story.stories) ? state.story.stories : [];
    if (!stories.some(s => int64String(s.order) === order && s.unlocked && !s.claimed)) {
      fail('手记尚未解锁或已领取');
    }
    params = { order: Number(order) };
  } else if (action === 'seeds') {
    const rewards = Array.isArray(group.seeds && group.seeds.mega_event && group.seeds.mega_event.rewards)
      ? group.seeds.mega_event.rewards
      : [];
    if (!isActive(group.seeds && group.seeds.head) || !rewards.some(r => r.claimable && !r.claimed)) {
      fail('当前没有可领取的种子礼包');
    }
    id = SEEDS_ID;
  } else if (action === 'refreshCharm') {
    if (toNum(nurture.stage) !== 2) fail('比熊成年后才可刷新锦囊');
    if (charmNeedsChoice(battle)) fail('请先替换或保留当前锦囊，再刷新');
    const free = toNum(battle.charm_free_refresh_count) < refresh.free_refresh_daily_limit;
    // 付费次数与支付方式是面板前置条件；官方请求体里没有这些字段。
    // 过期的「免费」点击绝不能变成付费刷新，重复的付费点击也不能扣两次。
    if (input && (input.allowDiamonds || (input.payment && !['free', 'tickets'].includes(input.payment)))) {
      fail('锦囊刷新不支持使用钻石');
    }
    if (free) {
      if (input && input.payment && input.payment !== 'free') fail('刷新次数已变化，请刷新状态后重试');
    } else {
      if (!input || input.payment !== 'tickets') fail('免费刷新已用完，请确认点券费用后再操作');
      const paidCount = toNum(battle.charm_paid_refresh_count);
      if (paidCount >= refresh.manual_refresh_daily_limit) fail('今日付费刷新次数已用完');
      if (!Number.isSafeInteger(input.expectedPaidRefreshCount) || input.expectedPaidRefreshCount !== paidCount) {
        fail('刷新次数已变化，请刷新状态后重试');
      }
      // 命令 41 实际扣 1002 x30；发包前立刻重读点券，点券不足就停，绝不落到钻石。
      if (!costsAvailable([charmRefreshCost()], await balances())) fail('点券不足，已停止刷新，不使用钻石');
    }
  } else if (action === 'equipCharm') {
    const charmId = Number(positiveDecimal(input && input.charmId, 'INVALID_CHARM', '锦囊编号'));
    const choices = [
      ...(Array.isArray(battle.charm_daily_pool) ? battle.charm_daily_pool : []),
      ...(Array.isArray(battle.charm_equipped) ? battle.charm_equipped : []),
    ].map(Number);
    if (toNum(nurture.stage) !== 2 || battle.charm_pick_used || !choices.includes(charmId)) {
      fail('该锦囊不可选择或本轮已经选择');
    }
    params = { charm_ids: [charmId] };
  } else if (action === 'openTreasure') {
    const treasures = (state.pool && state.pool.treasures) || [];
    if (!treasures.some(t => toNum(t.status) === 3 || (toNum(t.status) === 2 && toNum(t.end_at) > 0 && toNum(t.end_at) <= getServerTimeSec()))) {
      fail('还没有完成护送的宝藏');
    }
  } else if (action === 'compensation' && toNum(state.plunder && state.plunder.plunder_compensation_count) <= 0) {
    fail('当前没有可领取的夺宝补偿');
  } else if (action === 'exchange') {
    id = SHOP_ID;
    const goodsId = positiveDecimal(input && input.goodsId, 'INVALID_GOODS', '商品编号');
    const count = positiveDecimal((input && input.count) ?? '1', 'INVALID_COUNT', '兑换数量');
    const shop = await operate(SHOP_ID, 7);
    if (!isActive(shop.data && shop.data.head)) fail('拾物小铺当前不可兑换');
    const goodsList = (shop.data && shop.data.shop && shop.data.shop.goods) || [];
    const goods = goodsList.find(g => int64String(g.id) === goodsId);
    if (!goods) fail('服务端目录未发现该商品');
    if (toNum(goods.diamond_cost_count) > 0 || (Array.isArray(goods.cost) ? goods.cost : []).some(c => int64String(c.id) === DIAMOND_ID)) {
      fail('该商品可能消耗钻石，已阻止兑换');
    }
    if (BigInt(int64String(goods.purchase_limit)) > 0n
      && BigInt(int64String(goods.purchased_count)) + BigInt(count) > BigInt(int64String(goods.purchase_limit))) {
      fail('兑换数量超过剩余限购次数');
    }
    if (!costsAvailable(goods.cost, await balances(), count)) fail('兑换余额不足');
    params = { goods_id: goodsId, count };
  } else if (action === 'battle') {
    if (!(state.hunt && state.hunt.can_play_plunder) || toNum(battle.battle_count) >= fight.daily_battle_limit) {
      fail('当前不可夺宝');
    }
    const gid = positiveDecimal(input && input.gid, 'INVALID_FRIEND_GID', '好友 GID');
    const challengeId = positiveDecimal(input && input.challengeId, 'INVALID_CHALLENGE', '挑战书编号');
    if (![80101, 80102, 80103].includes(Number(challengeId))) fail('挑战书类型无效');
    const friend = await getPetDiaryFriend(gid);
    const treasure = friend.treasures.find(t => t.id === String(input && input.treasureId));
    if (!treasure || treasure.status !== 2
      || !treasure.previews.some(p => p.challengeId === challengeId && p.canStart)) {
      fail('好友宝藏状态已变化，请重新查看');
    }
    if (!costsAvailable([{ id: challengeId, count: '1' }], await balances())) fail('对应挑战书不足');
    params = { defender_gid: gid, treasure_id: treasure.id, challenge_item_id: challengeId };
  } else if (action === 'skipBattle') {
    if (typeof (input && input.skip) !== 'boolean') fail('跳过动画设置无效');
    params = { skip: input.skip };
  } else if (action === 'markStories') {
    const stories = Array.isArray(state.story && state.story.stories) ? state.story.stories : [];
    const orders = (Array.isArray(input && input.orders) ? input.orders : []).map(Number);
    if (!orders.length || orders.some(order => !stories.some(s => toNum(s.order) === order && s.unlocked))) {
      fail('手记编号无效');
    }
    params = { orders };
  }

  const [command, selector] = OPERATIONS[action];
  const reply = await operate(id, command, selector, params);
  const result = reply[selector] || {};
  const rewards = itemList(result.rewards || result.awards);
  let snapshot = null;
  let refreshError = '';
  try { snapshot = await readSnapshot(); } catch (error) { refreshError = `操作已成功，刷新失败：${error.message}`; }
  return {
    action,
    rewards,
    costs: itemList(result.costs),
    result: plainReply(selector, result),
    snapshot,
    refreshError,
    message: action === 'battle'
      ? (result.won ? '夺宝成功' : '本次夺宝未获胜，已按规则结算')
      : '操作成功',
  };
}

function operatePetDiary(action, input = {}) {
  const result = mutationTail.then(() => performOperation(action, input));
  mutationTail = result.catch(() => {});
  return result;
}

module.exports = {
  PET_DIARY_OPERATIONS: OPERATIONS,
  getPetDiary,
  operatePetDiary,
  getPetDiaryRecords,
  getPetDiaryFriend,
  normalizePetDiary: normalize,
};
