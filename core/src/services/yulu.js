const protobuf = require('protobufjs');
const { sendMsgAsync } = require('../utils/network');
const { getBag, getBagItems, useItem } = require('./warehouse');

const ITEMS = [
  [5001, '天气采集瓶'], [5002, '雷雨召唤瓶'], [5003, '闪电变异瓶'],
  [5004, '霹雳引雷瓶'], [5005, '青蛙使坏瓶'], [5006, '乌云使坏瓶'],
  [5007, '百宝惊喜瓶'], [5008, '雷纹礼盒'], [5009, '雷击木'], [5010, '黄金雷击木'],
];
const RESEARCH = [
  [1000, 5001, '天气采集瓶', 1, 20, []], [1001, 100003, '化肥礼包', 5, 40, [1000]],
  [1002, 5005, '青蛙使坏瓶', 20, 40, [1001]], [1003, 5006, '乌云使坏瓶', 20, 40, [1001]],
  [1004, 5002, '雷雨召唤瓶', 1, 60, [1002]], [1005, 80013, '有机化肥(8小时)', 3, 60, [1003]],
  [1006, 4002, '闪电感应', 1, 80, [1004]], [1007, 4003, '闪电感应', 1, 80, [1005]],
  [1008, 2159, '头像框', 1, 100, [1006, 1007]],
];

function rawOperate(id, cmd, field, subFields) {
  const writer = protobuf.Writer.create();
  writer.uint32(8).int64(id).uint32(16).int64(cmd);
  writer.uint32((field << 3) | 2).fork();
  for (const [number, value] of subFields) writer.uint32(number * 8).int64(value);
  writer.ldelim();
  return writer.finish();
}

async function getYuluActivity() {
  const bag = await getBag();
  const items = getBagItems(bag);
  const count = new Map(items.map(item => [Number(item.id), Number(item.count) || 0]));
  return {
    title: '雨落成诗', badge: count.get(1027) || 0,
    items: Object.fromEntries(ITEMS.map(([id, name]) => [id, { id, name, count: count.get(id) || 0 }])),
    research: { tiers: RESEARCH.map(([nodeId, rewardId, reward, countValue, cost, prevs]) => ({ nodeId, rewardId, reward, name: reward, count: countValue, cost, prevs })), claimedAll: false },
  };
}

async function openYuluItem(itemId) {
  const id = Number(itemId);
  if (![5002, 5007, 5008].includes(id)) throw new Error('仅支持使用 5002、5007、5008');
  await useItem(id, 1, []);
  return { itemId: id, opened: true };
}

async function researchYulu(nodeId) {
  const tier = RESEARCH.find(item => item[0] === Number(nodeId));
  if (!tier) throw new Error('无效的研究节点 nodeId');
  const request = rawOperate(2026070304, 40, 140, [[1, Number(nodeId)]]);
  try {
    const { body } = await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', request);
    return { nodeId: Number(nodeId), reward: tier[2], count: tier[3], rewards: body ? [] : [] };
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('雷电徽章不足')) throw new Error('雷电徽章不足');
    if (message.includes('节点未解锁')) throw new Error('节点未解锁（需先领取前置档位）');
    throw err;
  }
}

async function exchangeYulu() {
  const request = rawOperate(2026070301, 1, 101, [[1, 200], [2, 1]]);
  try {
    await sendMsgAsync('gamepb.activitypb.ActivityService', 'Operate', request);
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('限购')) throw new Error('今日已兑换过（每自然日限兑 1 个）');
    if (message.includes('不足')) throw new Error('金豆不足（需 200 金豆）');
    throw err;
  }
  return { costItem: 1005, costCount: 200, getItem: 5001, getCount: 1 };
}

module.exports = { getYuluActivity, openYuluItem, researchYulu, exchangeYulu };
