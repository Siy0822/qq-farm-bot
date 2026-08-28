const protobuf = require('protobufjs/minimal');
const { sendMsgAsync, isConnected } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, sleep } = require('../utils/utils');
const { getItemImageById } = require('../config/gameConfig');
const { getBag, getBagItems, useItem } = require('./warehouse');
const { enterFriendFarm, leaveFriendFarm } = require('./friend-api');
const { getAllLands } = require('./farm-api');

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
const BADGE_ID = 1027;
const ROOT_ID = 2026070300;
const RESEARCH_ID = 2026070304;
const EXCHANGE_ID = 2026070301;
const COLLECT_ID = 2026070303;
const ACTIVITY_SVC = 'gamepb.activitypb.ActivityService';
const WEATHER_SVC = 'gamepb.weatherpb.WeatherService';

function varintField(writer, field, value) { writer.uint32(field * 8).int64(Number(value) || 0); }
function messageField(writer, field, bytes) { writer.uint32((field << 3) | 2).bytes(bytes || Buffer.alloc(0)); }
function rawOperate(id, cmd, extField, subFields) {
  const w = protobuf.Writer.create(); varintField(w, 1, id); varintField(w, 2, cmd);
  const sub = protobuf.Writer.create();
  for (const [field, value] of subFields) varintField(sub, field, value);
  messageField(w, extField, sub.finish()); return w.finish();
}
function readFields(buf) {
  const out = [];
  const r = protobuf.Reader.create(Buffer.from(buf || []));
  while (r.pos < r.len) {
    const tag = r.uint32(); const field = tag >>> 3; const wire = tag & 7;
    if (wire === 0) out.push({ field, wire, value: Number(r.int64()) });
    else if (wire === 1) out.push({ field, wire, value: r.fixed64() });
    else if (wire === 2) { const n = r.uint32(); out.push({ field, wire, bytes: Buffer.from(r.buf.subarray(r.pos, r.pos + n)) }); r.pos += n; }
    else if (wire === 5) out.push({ field, wire, value: r.fixed32() });
    else break;
  }
  return out;
}
function oneField(buf, field) { return readFields(buf).find(x => x.field === field); }
function allFields(buf, field) { return readFields(buf).filter(x => x.field === field); }
function num(buf, field) { const x = oneField(buf, field); return x && x.wire === 0 ? Number(x.value) : 0; }
function bytes(buf, field) { const x = oneField(buf, field); return x && x.wire === 2 ? x.bytes : null; }
function bytesAll(buf, field) { return allFields(buf, field).filter(x => x.wire === 2).map(x => x.bytes); }

function itemMap(items) {
  const map = new Map(); for (const item of items || []) map.set(toNum(item?.id), item); return map;
}
function tierById(id) { return RESEARCH.find(x => x[0] === Number(id)); }

async function getYuluActivity() {
  const bag = await getBag(); const map = itemMap(getBagItems(bag));
  const items = Object.fromEntries(ITEMS.map(([id, name]) => [id, {
    id, name, count: toNum(map.get(id)?.count), image: getItemImageById(id) || '',
  }]));
  const badge = toNum(map.get(BADGE_ID)?.count);
  const weather = await getWeatherStatus();
  const state = await getResearchState();
  return {
    title: '雨落成诗', badge, badgeNote: '雷电徽章：气象研究/换天气瓶消耗',
    badgeImage: getItemImageById(BADGE_ID) || '', weather,
    items, research: { tiers: RESEARCH.map(([nodeId, rewardId, reward, count, cost, prevs]) => ({
      nodeId, rewardId, reward, name: reward, count, cost, prevs,
      claimed: !!state[nodeId]?.claimed, status: state[nodeId]?.status || 0,
    })), claimedAll: false },
  };
}

async function openYuluItem(itemId) {
  const id = Number(itemId);
  if (![5002, 5007, 5008].includes(id)) throw new Error('仅支持使用 5002、5007、5008');
  await useItem(id, 1, []); return { itemId: id, opened: true };
}

async function getWeatherStatus() {
  if (!isConnected()) return { id: 0, name: '无', active: false };
  try {
    const { body } = await sendMsgAsync(WEATHER_SVC, 'GetWeatherStatus', Buffer.alloc(0));
    const status = bytes(body, 1); const id = status ? num(status, 1) : 0;
    return { id, name: id ? '雷雨' : '无', active: !!(status && num(status, 5)) };
  } catch { return { id: 0, name: '无', active: false }; }
}

async function getResearchState() {
  const out = {};
  try {
    const req = types.ActivityGetGroupRequest.encode(types.ActivityGetGroupRequest.create({ id: ROOT_ID, uid: '' })).finish();
    const { body } = await sendMsgAsync(ACTIVITY_SVC, 'GetGroup', req);
    const root = bytes(body, 1); if (!root) return out;
    const walk = raw => {
      const info = bytes(raw, 1);
      if (info && num(info, 1) === RESEARCH_ID) {
        const research = bytes(raw, 118); const state = research && bytes(research, 1);
        for (const node of bytesAll(state, 2)) out[num(node, 1)] = { status: num(node, 3), claimed: !!num(node, 4) };
        return true;
      }
      return bytesAll(raw, 2).some(walk);
    };
    walk(root);
  } catch { /* status is best effort */ }
  return out;
}

async function researchYulu(nodeId) {
  const tier = tierById(nodeId); if (!tier) throw new Error('无效的研究节点 nodeId');
  const request = rawOperate(RESEARCH_ID, 40, 140, [[1, Number(nodeId)]]);
  try {
    const { body } = await sendMsgAsync(ACTIVITY_SVC, 'Operate', request);
    return { nodeId: Number(nodeId), reward: tier[2], count: tier[3], rewards: [], unlockedNodeIds: parseUnlocked(body) };
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('雷电徽章不足')) throw new Error('雷电徽章不足');
    if (message.includes('节点未解锁')) throw new Error('节点未解锁（需先领取前置档位）');
    throw err;
  }
}
function parseUnlocked(body) {
  const result = bytes(body, 140); if (!result) return [];
  const f = oneField(result, 3); if (!f || f.wire !== 2) return [];
  const out = []; let r = protobuf.Reader.create(f.bytes);
  while (r.pos < r.len) out.push(Number(r.int64())); return out;
}

async function exchangeYulu() {
  const request = rawOperate(EXCHANGE_ID, 1, 101, [[1, 200], [2, 1]]);
  try { await sendMsgAsync(ACTIVITY_SVC, 'Operate', request); }
  catch (err) {
    const message = String(err?.message || err);
    if (message.includes('限购')) throw new Error('今日已兑换过（每自然日限兑 1 个）');
    if (message.includes('不足')) throw new Error('金豆不足（需 200 金豆）');
    throw err;
  }
  return { costItem: 1005, costCount: 200, getItem: 5001, getCount: 1 };
}

async function mutateYulu() {
  const bag = await getBag(); const item = itemMap(getBagItems(bag)).get(5003);
  if (!item || toNum(item.count) <= 0) throw new Error('闪电变异瓶库存为空');
  const lands = await getAllLands(); const now = Date.now() / 1000; const targets = [];
  for (const land of lands?.lands || []) {
    const plant = land?.plant; const phases = plant?.phases || [];
    const phase = [...phases].sort((a, b) => toNum(a?.begin_time) - toNum(b?.begin_time))
      .filter(p => toNum(p?.begin_time) <= now).pop() || phases[phases.length - 1];
    if (!phase || toNum(phase.phase) === 1 || toNum(phase.phase) === 7 || (plant.mutant_config_ids || []).length) continue;
    targets.push(toNum(land.id));
  }
  const used = []; const errors = [];
  for (const landId of targets) {
    const req = encodeTargetUse(5003, 1, toNum(item.uid), 0, landId);
    try { await sendMsgAsync('gamepb.itempb.ItemService', 'Use', req); used.push(landId); } catch (e) { errors.push(`land${landId}:${e.message}`); }
    await sleep(300);
  }
  return { mutated: used, mutateCount: used.length, errors };
}
function encodeTargetUse(itemId, count, uid, hostGid, landId = 0) {
  const item = protobuf.Writer.create(); varintField(item, 1, itemId); varintField(item, 2, count); if (uid) varintField(item, 6, uid);
  const target = protobuf.Writer.create(); varintField(target, 1, hostGid); if (landId) messageField(target, 2, varintBytes(landId));
  const out = protobuf.Writer.create(); messageField(out, 1, item.finish()); messageField(out, 2, target.finish()); return out.finish();
}
function varintBytes(value) { const w = protobuf.Writer.create(); w.int64(Number(value) || 0); return w.finish(); }

function currentPlantPhase(phases) {
  const list = Array.isArray(phases) ? phases : [];
  const now = Date.now() / 1000;
  return [...list].sort((a, b) => toNum(a?.begin_time) - toNum(b?.begin_time))
    .filter(phase => toNum(phase?.begin_time) <= now).pop() || list[list.length - 1] || null;
}

async function useYulu(itemId, hostGid = 0, landIds = []) {
  const id = Number(itemId);
  if (id === 5002) {
    const weather = await getWeatherStatus(); if (weather.id) throw new Error('当前已有特殊天气，无法召唤雷雨');
    await useItem(id, 1, []); return { itemId: id, used: true };
  }
  if (![5001, 5004, 5005, 5006].includes(id)) throw new Error(`物品 ${id} 不支持该接口`);
  if (Number(hostGid) <= 0) throw new Error('好友向瓶子需指定 hostGid');
  await enterFriendFarm(Number(hostGid), { reason: 2 });
  try {
    if (id === 5001) {
      const req = rawOperate(COLLECT_ID, 9, 107, [[3, Number(hostGid)]]);
      await sendMsgAsync(ACTIVITY_SVC, 'Operate', req);
      return { itemId: id, used: [Number(hostGid)], useCount: 1 };
    }
    const bag = await getBag(); const found = itemMap(getBagItems(bag)).get(id);
    if (!found || toNum(found.count) <= 0) throw new Error(`${ITEMS.find(item => item[0] === id)?.[1] || `物品 ${id}`}库存为空`);
    if (id === 5005) {
      await sendMsgAsync('gamepb.itempb.ItemService', 'Use', encodeTargetUse(id, 1, toNum(found.uid), Number(hostGid)));
      return { itemId: id, used: [Number(hostGid)], useCount: 1, errors: [] };
    }
    const lands = await getAllLands(Number(hostGid)); const wanted = new Set((landIds || []).map(Number));
    const targets = [];
    for (const land of lands?.lands || []) {
      const lid = toNum(land?.id); const phases = land?.plant?.phases || [];
      if (!phases.length || (wanted.size && !wanted.has(lid))) continue;
      if (id === 5006) {
        const phase = currentPlantPhase(phases);
        if (!phase || toNum(phase.phase) <= 1 || toNum(phase.phase) >= 6) continue;
        targets.push(lid);
        break;
      }
      targets.push(lid);
    }
    const used = []; const errors = [];
    for (const lid of targets) {
      try { await sendMsgAsync('gamepb.itempb.ItemService', 'Use', encodeTargetUse(id, 1, toNum(found.uid), Number(hostGid), lid)); used.push(lid); }
      catch (e) { errors.push(`land${lid}:${e.message}`); }
      await sleep(300);
    }
    return { itemId: id, used, useCount: used.length, errors };
  } finally { await leaveFriendFarm(Number(hostGid)); }
}

module.exports = { getYuluActivity, openYuluItem, researchYulu, exchangeYulu, mutateYulu, useYulu };
