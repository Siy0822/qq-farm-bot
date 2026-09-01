const protobuf = require('protobufjs/minimal');
const { sendMsgAsync, isConnected } = require('../utils/network');
const { types } = require('../utils/proto');
const { getItemById } = require('../config/gameConfig');

const ACTIVITY_SERVICE = 'gamepb.activitypb.ActivityService';
const ROOT_ACTIVITY_ID = 2026090900;
const ACTIVITY_ID = 2026090901;
const EXT_FIELD_BASE = 99;
const CMD_SHARE = 35;
const CMD_LOVE = 36;
const CMD_FUND = 38;
const CMD_TIER = 39;
const CACHE_TTL_MS = 30_000;

const DEFAULT_TIERS = [
  { threshold: 30, itemId: 80013, itemName: '有机化肥(8小时)', count: 1 },
  { threshold: 60, itemId: 1002, itemName: '点券', count: 50 },
  { threshold: 90, itemId: 80013, itemName: '有机化肥(8小时)', count: 2 },
  { threshold: 120, itemId: 1002, itemName: '点券', count: 100 },
  { threshold: 150, itemId: 2158, itemName: '公益小红花做好事头像框', count: 1 },
];

const progressCache = new Map();
const fundSucceeded = new Set();
const fundInFlight = new Map();

function assertConnected(action) {
  if (!isConnected()) throw new Error(`${action}失败: 连接已断开，请等待自动重连后重试`);
}

function readFields(input) {
  const fields = [];
  const reader = protobuf.Reader.create(Buffer.from(input || []));
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) fields.push({ field, wire, value: Number(reader.int64()) });
    else if (wire === 1) fields.push({ field, wire, value: reader.fixed64() });
    else if (wire === 2) {
      const length = reader.uint32();
      const end = reader.pos + length;
      if (end > reader.len) throw new Error('活动数据长度异常');
      fields.push({ field, wire, bytes: Buffer.from(reader.buf.subarray(reader.pos, end)) });
      reader.pos = end;
    }
    else if (wire === 5) fields.push({ field, wire, value: reader.fixed32() });
    else throw new Error(`不支持的 protobuf wire type: ${wire}`);
  }
  return fields;
}

function fieldNumber(fields, field) {
  const found = fields.find(item => item.field === field && item.wire === 0);
  return found ? Number(found.value) : 0;
}

function findNestedField(input, targetField) {
  let fields;
  try { fields = readFields(input); }
  catch { return null; }
  for (const item of fields) {
    if (item.field === targetField && item.wire === 2) return item.bytes;
  }
  for (const item of fields) {
    if (item.wire !== 2 || !item.bytes?.length) continue;
    const found = findNestedField(item.bytes, targetField);
    if (found) return found;
  }
  return null;
}

function itemName(itemId) {
  if (itemId === 80013) return '有机化肥(8小时)';
  if (itemId === 80001) return '化肥(1小时)';
  if (itemId === 1002) return '点券';
  if (itemId === 2158) return '公益小红花做好事头像框';
  if (itemId === 101604) return '金豆豆';
  return getItemById(itemId)?.name || `物品${itemId}`;
}

function createOperateRequest(cmd, extFields = []) {
  const writer = protobuf.Writer.create();
  writer.uint32(8).int64(ACTIVITY_ID);
  writer.uint32(16).int64(cmd);
  const extWriter = protobuf.Writer.create();
  for (const [field, value] of extFields) extWriter.uint32(field * 8).int64(Number(value) || 0);
  const ext = extWriter.finish();
  writer.uint32(((cmd + EXT_FIELD_BASE) << 3) | 2).bytes(ext);
  return writer.finish();
}

async function operate(cmd, action, extFields = []) {
  assertConnected(action);
  const { body } = await sendMsgAsync(ACTIVITY_SERVICE, 'Operate', createOperateRequest(cmd, extFields));
  return Buffer.from(body || []);
}

function parseTiers(progressFields, donated) {
  const tiers = [];
  for (const item of progressFields) {
    if (item.field !== 9 || item.wire !== 2) continue;
    let tierFields;
    try { tierFields = readFields(item.bytes); }
    catch { continue; }
    const threshold = fieldNumber(tierFields, 1);
    const rewardField = tierFields.find(field => field.field === 2 && field.wire === 2);
    let itemId = 0;
    let count = 0;
    if (rewardField) {
      try {
        const rewardFields = readFields(rewardField.bytes);
        itemId = fieldNumber(rewardFields, 1);
        count = fieldNumber(rewardFields, 2);
      }
      catch { /* use fallback tier metadata */ }
    }
    const fallback = DEFAULT_TIERS.find(tier => tier.threshold === threshold);
    tiers.push({
      threshold,
      donated,
      claimable: donated >= threshold,
      itemId: itemId || fallback?.itemId || 0,
      itemName: itemName(itemId || fallback?.itemId || 0),
      count: count || fallback?.count || 0,
    });
  }
  return tiers.length ? tiers : DEFAULT_TIERS.map(tier => ({ ...tier, donated, claimable: donated >= tier.threshold }));
}

async function fetchProgress() {
  const request = types.ActivityGetGroupRequest.encode(
    types.ActivityGetGroupRequest.create({ id: ACTIVITY_ID, uid: '' }),
  ).finish();
  const { body } = await sendMsgAsync(ACTIVITY_SERVICE, 'GetGroup', request);
  const raw = findNestedField(body, 116);
  if (!raw) throw new Error('活动进度中未找到 f116');
  const fields = readFields(raw);
  const donated = fieldNumber(fields, 3);
  const serverFund = Math.floor(fieldNumber(fields, 4) / 100);
  const serverGoal = Math.floor(fieldNumber(fields, 5) / 100);
  return { donated, serverFund, serverGoal, tiers: parseTiers(fields, donated) };
}

async function getProgress() {
  try {
    const progress = await fetchProgress();
    progressCache.set('current', { value: progress, at: Date.now() });
    return { ...progress, cached: false };
  }
  catch (error) {
    const cached = progressCache.get('current');
    if (cached && Date.now() - cached.at <= CACHE_TTL_MS) return { ...cached.value, cached: true };
    throw error;
  }
}

async function getHonghuaActivity() {
  assertConnected('获取公益小红花活动');
  const progress = await getProgress();
  const serverPercent = progress.serverGoal > 0 ? progress.serverFund / progress.serverGoal * 100 : 0;
  return {
    activityId: ACTIVITY_ID,
    rootActivityId: ROOT_ACTIVITY_ID,
    name: '公益小红花',
    uid: 'CharityRedFlower',
    startTime: 1788192000,
    endTime: 1788969599,
    love: progress.donated,
    serverFund: progress.serverFund,
    serverGoal: progress.serverGoal,
    serverPercent,
    tiers: progress.tiers,
    progressCached: progress.cached,
    fundClaimed: fundSucceeded.has('current'),
    actions: { share: true, love: true, fund: true, tier: true },
  };
}

async function sendHonghuaLove() {
  const body = await operate(CMD_LOVE, '送出爱心值');
  const result = { cmd: CMD_LOVE };
  const raw = findNestedField(body, 136);
  if (raw) {
    const fields = readFields(raw);
    result.loveValue = fieldNumber(fields, 4);
    result.counter = [1, 2, 3].map(field => fieldNumber(fields, field));
  }
  progressCache.delete('current');
  return result;
}

function parseFundResult(body) {
  const result = { cmd: CMD_FUND, donated: true };
  const raw = findNestedField(body, 138);
  if (!raw) return result;
  const fields = readFields(raw);
  const reward = fields.find(item => item.field === 3 && item.wire === 2);
  if (reward) {
    const rewardFields = readFields(reward.bytes);
    const id = fieldNumber(rewardFields, 1);
    result.gift = { itemId: id, itemName: itemName(id), count: fieldNumber(rewardFields, 2) };
  }
  return result;
}

async function sendHonghuaFund() {
  if (fundSucceeded.has('current')) return { cmd: CMD_FUND, donated: false, alreadyDonated: true };
  if (fundInFlight.has('current')) return fundInFlight.get('current');
  const task = (async () => {
    const body = await operate(CMD_FUND, '送出公益金');
    fundSucceeded.add('current');
    progressCache.delete('current');
    return parseFundResult(body);
  })();
  fundInFlight.set('current', task);
  try { return await task; }
  finally { fundInFlight.delete('current'); }
}

function parseRewards(body) {
  const raw = findNestedField(body, 126);
  if (!raw) return [];
  const rewards = [];
  for (const item of readFields(raw)) {
    if (item.wire !== 2) continue;
    try {
      const fields = readFields(item.bytes);
      const id = fieldNumber(fields, 1);
      const count = fieldNumber(fields, 2);
      if (id && count) rewards.push({ itemId: id, itemName: itemName(id), count });
    }
    catch { /* ignore unrelated nested messages */ }
  }
  return rewards;
}

async function claimHonghuaReward(kind, tier) {
  const commands = { share: CMD_SHARE, tier: CMD_TIER };
  const cmd = commands[kind];
  if (!cmd) throw new Error('仅支持领取 share 或 tier 奖励');
  const threshold = Number(tier) || 0;
  if (kind === 'tier' && !DEFAULT_TIERS.some(item => item.threshold === threshold)) {
    throw new Error('无效的爱心值档位');
  }
  const body = await operate(
    cmd,
    kind === 'share' ? '领取分享奖励' : '领取爱心值档位奖励',
    kind === 'tier' ? [[1, threshold]] : [],
  );
  const rewards = parseRewards(body);
  progressCache.delete('current');
  if (!rewards.length) throw new Error('未领取到奖励：条件未达成、已领取，或服务端未返回奖励数据');
  return { cmd, kind, rewards };
}

module.exports = {
  getHonghuaActivity,
  sendHonghuaLove,
  sendHonghuaFund,
  claimHonghuaReward,
};
