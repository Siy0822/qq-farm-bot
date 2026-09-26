/**
 * 秋日活动服务 - 秋祈良愿（wish）与快乐不独享（happy）
 *
 * 移植自上游 liyangpengs/qq-farm-bot core/src/services/autumn-activities.ts（commit 25dc1e9），
 * 协议位见 docs/autumn-20260924.md：
 * - 秋祈良愿：分组 2026092400 / 活动 2026092401；状态 field 119；抽签 op 51 / field 151；领奖 op 52 / field 152
 * - 快乐不独享：分组 2026092500 / 活动 2026092501；状态 field 120；分享 op 69 / 档位 op 70 / 日志 op 71 / 每日 op 73
 *
 * 本地差异（勿照搬上游）：
 * - 本地 GetGroupRequest 字段名是 id（上游 group_id），GetGroupReply.group 是 ActivityNode（上游 ActivityData）；
 * - 本地 ActivityInfo 用 title/payload/start_time/end_time（上游 name/extra/begin_time/end_time），字段号一致；
 * - ActivityNode 上的 wish_sign(119)/share_reward(120) 是本次为 GetGroup 解码补的字段。
 */
const autumnConfig = require('../activity-data/autumn-20260924.json');
const { sendMsgAsync } = require('../utils/network');
const { types } = require('../utils/proto');
const { getServerTimeSec, toNum } = require('../utils/utils');
const { getItemById, getItemImageById } = require('../config/gameConfig');

const EVENTS = {
  wish: { groupId: 2026092400, id: 2026092401, field: 'wish_sign', title: '秋祈良愿' },
  happy: { groupId: 2026092500, id: 2026092501, field: 'share_reward', title: '快乐不独享' },
};

const ACTIVITY_SVC = 'gamepb.activitypb.ActivityService';

// 每个账号拥有独立的 worker/module 实例，因此这里的串行只作用于单账号：新鲜的读-改-写之间不插入并发操作。
let mutationTail = Promise.resolve();

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function eventFor(key) {
  return Object.hasOwn(EVENTS, key) ? EVENTS[key] : fail('INVALID_AUTUMN_ACTIVITY', '未知活动');
}

function reward(item) {
  const id = toNum(item.id);
  return {
    id,
    count: toNum(item.count),
    name: (getItemById(id) || {}).name || `物品 #${id}`,
    image: getItemImageById(id),
  };
}

function findEntry(entry, id) {
  if (entry && entry.activity && toNum(entry.activity.id) === id) return entry;
  for (const child of (entry && entry.children) || []) {
    const found = findEntry(child, id);
    if (found) return found;
  }
  return null;
}

async function query(key) {
  const event = eventFor(key);
  const body = types.ActivityGetGroupRequest.encode(
    types.ActivityGetGroupRequest.create({ id: event.groupId, uid: '' })
  ).finish();
  const reply = await sendMsgAsync(ACTIVITY_SVC, 'GetGroup', body);
  const entry = findEntry(types.ActivityGetGroupReply.decode(reply.body).group, event.id);
  if (!entry || !entry[event.field]) {
    fail('AUTUMN_STATE_UNAVAILABLE', '活动动态状态未返回，请稍后刷新');
  }
  return entry;
}

function normalize(key, entry) {
  const event = eventFor(key);
  const head = entry.activity;
  const now = getServerTimeSec();
  const startTime = toNum(head.start_time);
  const endTime = toNum(head.end_time);
  const active = startTime <= now && endTime > now;
  let rules = [];
  try {
    const parsed = JSON.parse(head.payload || '');
    rules = parsed.tips.txt
      .filter((v) => typeof v === 'string')
      .map((v) => v.replace(/<[^>]+>/g, ''));
  } catch {}

  const base = {
    key,
    id: String(event.id),
    title: event.title,
    serverTime: now * 1000,
    startTime: startTime * 1000,
    endTime: endTime * 1000,
    active,
    rules,
  };

  if (key === 'wish') {
    const state = entry.wish_sign;
    const pending = state.pending && toNum(state.pending.text_id) > 0 ? state.pending : null;
    return {
      ...base,
      remaining: toNum(state.remaining_count),
      day: toNum(state.activity_day),
      choices: autumnConfig.choices.map((v) => ({ id: v.choose_id, name: v.desc })),
      rewardDays: autumnConfig.rewards.map((v) => {
        const [id, count] = v.reward.split(':').map(Number);
        return { day: v.day_id, reward: reward({ id, count }) };
      }),
      pending: pending ? {
        chooseId: toNum(pending.choose_id),
        textId: toNum(pending.text_id),
        day: toNum(pending.day_id),
        text: (autumnConfig.texts.find((v) => v.choose_id === toNum(pending.choose_id)
          && v.text_id === toNum(pending.text_id)) || {}).desc || '',
        rewards: (pending.rewards || []).map(reward),
      } : null,
      canDraw: active && !pending && toNum(state.remaining_count) > 0,
      canClaim: active && !!pending,
    };
  }

  const summary = entry.share_reward.summary;
  if (!summary || !summary.daily) {
    fail('AUTUMN_STATE_UNAVAILABLE', '快乐值进度未返回，请稍后刷新');
  }
  return {
    ...base,
    score: toNum(summary.current_score),
    scoreItemId: toNum(summary.score_item_id),
    dailyReward: toNum(summary.daily_reward),
    firstShareReward: toNum(summary.first_share_reward),
    claimedCount: toNum(summary.daily.claimed_count),
    claimLimit: toNum(summary.daily.claim_limit),
    poolClaimedCount: toNum(summary.my_pool && summary.my_pool.claimed_count),
    poolClaimLimit: toNum(summary.my_pool && summary.my_pool.claim_limit),
    canClaimDaily: active && !summary.daily.daily_reward_claimed,
    canShare: active && !summary.daily.first_share_awarded,
    firstShareAwarded: !!summary.daily.first_share_awarded,
    canClaimMilestones: active && (summary.milestones || []).some((v) => toNum(v.state) === 2),
    milestones: (summary.milestones || []).map((v) => ({
      id: String(v.tier_id),
      threshold: toNum(v.threshold),
      state: toNum(v.state),
      rewards: (v.rewards || []).map(reward),
    })),
  };
}

async function getAutumnActivity(key) {
  return normalize(key, await query(key));
}

const OPERATIONS = {
  draw: { key: 'wish', cmd: 51, field: 'wish_sign_draw' },
  claim: { key: 'wish', cmd: 52, field: 'wish_sign_claim' },
  daily: { key: 'happy', cmd: 73, field: 'share_reward_claim_daily' },
  milestones: { key: 'happy', cmd: 70, field: 'share_reward_claim_milestones' },
  share: { key: 'happy', cmd: 69, field: 'share_reward_share' },
  logs: { key: 'happy', cmd: 71, field: 'share_reward_get_logs' },
};

function parameters(action, state, input) {
  if (!state.active) fail('AUTUMN_ACTIVITY_ENDED', '活动尚未开放或已经结束');
  if (action === 'draw') {
    if (!state.canDraw) fail('WISH_DRAW_UNAVAILABLE', '请先领取待领取奖励，或等待明日祈愿');
    const chooseId = Number(input && input.chooseId);
    if (!Number.isInteger(chooseId) || !state.choices.some((v) => v.id === chooseId)) {
      fail('INVALID_WISH_CHOICE', '请选择有效的祈愿方向');
    }
    return { choose_id: chooseId };
  }
  if (action === 'claim') {
    if (!state.canClaim) fail('WISH_CLAIM_UNAVAILABLE', '当前没有待领取的祈愿奖励');
    return { choose_id: state.pending.chooseId };
  }
  if (action === 'daily' && !state.canClaimDaily) fail('HAPPY_DAILY_CLAIMED', '今日快乐值已领取');
  if (action === 'share' && !state.canShare) fail('HAPPY_SHARE_CLAIMED', '今日分享奖励已领取');
  if (action === 'milestones' && !state.canClaimMilestones) {
    fail('HAPPY_MILESTONE_UNAVAILABLE', '当前没有可领取的档位奖励');
  }
  if (action === 'logs') return { page: -1, page_size: 100, tab: input && input.tab === 0 ? 0 : 1 };
  return {};
}

async function performOperation(key, action, input) {
  const event = eventFor(key);
  const operation = Object.hasOwn(OPERATIONS, action) ? OPERATIONS[action] : null;
  if (!operation || operation.key !== key) fail('INVALID_AUTUMN_OPERATION', '活动操作不匹配');

  const state = await getAutumnActivity(key);
  const params = parameters(action, state, input);
  const body = types.AutumnOperateRequest.encode(types.AutumnOperateRequest.create({
    activity_id: event.id,
    operate_type: operation.cmd,
    [operation.field]: params,
  })).finish();

  const response = await sendMsgAsync(ACTIVITY_SVC, 'Operate', body);
  const reply = types.AutumnOperateReply.decode(response.body);
  if (toNum(reply.activity_id) !== event.id
    || toNum(reply.operate_type) !== operation.cmd
    || !reply[operation.field]) {
    fail('AUTUMN_RESPONSE_INVALID', '操作回包不完整，请刷新确认结果，勿重复提交');
  }

  let result = types.AutumnOperateReply.toObject(reply, { longs: String, bytes: String })[operation.field];
  // 网页只需要奖励/日志数据，绝不返回可复用的 Ark 分享凭据。
  if (action === 'share') result = { granted_score: result.granted_score || '0' };
  if (action === 'logs') {
    result = {
      total: result.total || 0,
      logs: (result.logs || []).map((entry) => ({
        seq: entry.seq,
        kind: entry.kind,
        score: entry.score,
        created_at: entry.created_at,
        actor: entry.actor ? { name: entry.actor.name } : undefined,
      })),
    };
  }

  const source = reply[operation.field];
  const rewards = ((source.awards || source.rewards) || []).map(reward);

  // 写操作已经成功时，后续读取失败不能把结果报成失败。
  try {
    return { activity: await getAutumnActivity(key), result, rewards };
  } catch {
    return { activity: null, result, rewards, refreshRequired: true };
  }
}

function operateAutumnActivity(key, action, input = {}) {
  const result = mutationTail.then(() => performOperation(key, action, input));
  mutationTail = result.catch(() => {});
  return result;
}

module.exports = { getAutumnActivity, operateAutumnActivity };
