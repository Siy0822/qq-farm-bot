<script setup lang="ts">
import api from '@/api'
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{ kind: 'wish' | 'happy' }>()

const accountStore = useAccountStore()
const toast = useToastStore()

const state = ref<any>(null)
const records = ref<any[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const choice = ref(1)
const logTab = ref(1)

const currentAccountId = computed(() => accountStore.currentAccountId)
const title = computed(() => (props.kind === 'wish' ? '秋祈良愿' : '快乐不独享'))
const icon = computed(() => (props.kind === 'wish' ? '🍁' : '🎉'))

const rewardText = (reward: any) => `${reward?.name || `物品${reward?.id}`} ×${reward?.count ?? 0}`
const milestones = computed<any[]>(() => state.value?.milestones || [])
const rewardDays = computed<any[]>(() => state.value?.rewardDays || [])
const choices = computed<any[]>(() => state.value?.choices || [])

function formatTime(ms: number) {
  if (!ms)
    return '—'
  const date = new Date(ms)
  return `${date.getMonth() + 1}.${date.getDate()}`
}

let sequence = 0

async function request(action = '') {
  const accountId = String(currentAccountId.value || '')
  if (!accountId || busy.value)
    return
  const version = ++sequence
  busy.value = true
  if (!action)
    loading.value = true
  error.value = ''
  try {
    const url = `/api/activity/autumn/${props.kind}${action ? `/${action}` : ''}`
    const payload = { chooseId: choice.value, tab: logTab.value }
    const response = action ? await api.post(url, payload) : await api.get(url)
    if (version !== sequence)
      return
    if (response.data?.ok === false)
      throw new Error(response.data?.error || response.data?.message || '活动请求失败')
    if (action) {
      state.value = response.data?.activity || state.value
      if (action === 'logs')
        records.value = response.data?.result?.logs || []
      else {
        const rewards = (response.data?.rewards || []).map(rewardText).join('、')
        const message = rewards
          || (response.data?.result?.granted_score ? `获得 ${response.data.result.granted_score} 快乐值` : '')
          || (action === 'draw' ? '签文已揭晓，请领取好运奖励' : '操作已完成')
        if (response.data?.refreshRequired)
          toast.warning(`${message}。请刷新确认最新进度`)
        else
          toast.success(message)
      }
    }
    else {
      state.value = response.data?.activity || null
    }
  }
  catch (e: any) {
    if (version !== sequence)
      return
    error.value = e?.response?.data?.error || e?.message || '加载失败，请刷新重试'
    if (action)
      state.value = null
  }
  finally {
    if (version === sequence) {
      busy.value = false
      loading.value = false
    }
  }
}

function switchLogTab(tab: number) {
  logTab.value = tab
  void request('logs')
}

watch([currentAccountId, () => props.kind], () => {
  sequence++
  busy.value = false
  state.value = null
  records.value = []
  logTab.value = 1
  choice.value = 1
  if (currentAccountId.value)
    void request()
}, { immediate: true })

onMounted(() => { if (currentAccountId.value) void request() })
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-600 p-5 text-white shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-2 text-3xl">{{ icon }}</div>
          <h2 class="text-2xl font-bold">{{ title }}</h2>
          <p class="mt-2 text-xs font-semibold text-white/85">
            {{ formatTime(state?.startTime) }} — {{ formatTime(state?.endTime) }}
          </p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="state?.active ? 'bg-white/20' : 'bg-black/25'">
          {{ state?.active ? '活动进行中' : '未开始或已结束' }}
        </span>
      </div>
    </section>

    <div v-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm dark:bg-red-900/20 dark:text-red-300">
      {{ error }}
    </div>

    <div v-if="loading" class="rounded-lg glass-subtle p-6 text-center text-sm">正在加载…</div>

    <template v-else-if="state">
      <!-- 秋祈良愿 -->
      <template v-if="kind === 'wish'">
        <section class="rounded-xl glass-subtle p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">今日祈愿</h3>
            <span class="text-sm">剩余 {{ state.remaining }} 次 · 第 {{ state.day }} 天</span>
          </div>

          <div v-if="state.pending" class="mt-3 rounded-lg border border-amber-300/70 p-4 dark:border-amber-600/50">
            <div class="text-sm font-semibold">签文：{{ state.pending.text || '—' }}</div>
            <div class="mt-2 text-xs opacity-70">待领取：{{ (state.pending.rewards || []).map(rewardText).join('、') || '—' }}</div>
            <button
              class="mt-3 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !state.canClaim"
              @click="request('claim')"
            >
              领取祈愿奖励
            </button>
          </div>

          <div v-else class="mt-3">
            <div class="text-sm opacity-75">选择祈愿方向后揭晓签文</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="item in choices"
                :key="item.id"
                class="rounded border px-3 py-1.5 text-sm transition"
                :class="choice === item.id ? 'border-transparent bg-amber-600 text-white' : 'border-gray-300 dark:border-gray-600'"
                :disabled="busy"
                @click="choice = item.id"
              >
                {{ item.name }}
              </button>
            </div>
            <button
              class="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !state.canDraw"
              @click="request('draw')"
            >
              抽签
            </button>
          </div>
        </section>

        <section v-if="rewardDays.length" class="rounded-xl glass-subtle p-4">
          <h3 class="font-semibold">祈愿奖励</h3>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="item in rewardDays" :key="item.day" class="rounded border border-gray-200/70 p-3 text-sm dark:border-gray-700/70">
              <div class="opacity-70">第 {{ item.day }} 天</div>
              <div class="mt-1">{{ rewardText(item.reward) }}</div>
            </div>
          </div>
        </section>
      </template>

      <!-- 快乐不独享 -->
      <template v-else>
        <section class="rounded-xl glass-subtle p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">快乐值</h3>
            <span class="text-sm">当前 {{ state.score }}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              class="rounded bg-orange-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !state.canClaimDaily"
              @click="request('daily')"
            >
              领取今日快乐值（{{ state.claimedCount }}/{{ state.claimLimit }}）
            </button>
            <button
              class="rounded bg-rose-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !state.canShare"
              @click="request('share')"
            >
              分享并领奖
            </button>
            <button
              class="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !state.canClaimMilestones"
              @click="request('milestones')"
            >
              领取档位奖励
            </button>
          </div>
        </section>

        <section v-if="milestones.length" class="rounded-xl glass-subtle p-4">
          <h3 class="font-semibold">快乐值档位</h3>
          <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="item in milestones"
              :key="item.id"
              class="rounded border p-3 text-sm"
              :class="item.state === 2 ? 'border-emerald-400' : 'border-gray-200/70 dark:border-gray-700/70'"
            >
              <div class="opacity-70">满 {{ item.threshold }} 快乐值</div>
              <div class="mt-1">{{ (item.rewards || []).map(rewardText).join('、') || '—' }}</div>
              <div class="mt-1 text-xs opacity-60">{{ item.state === 2 ? '可领取' : (item.state === 1 ? '已领取' : '未达成') }}</div>
            </div>
          </div>
        </section>

        <section class="rounded-xl glass-subtle p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold">快乐值记录</h3>
            <div class="flex gap-2">
              <button
                class="rounded px-2 py-1 text-xs"
                :class="logTab === 1 ? 'bg-amber-600 text-white' : 'bg-gray-200 dark:bg-gray-700'"
                :disabled="busy"
                @click="switchLogTab(1)"
              >
                我领取的
              </button>
              <button
                class="rounded px-2 py-1 text-xs"
                :class="logTab === 0 ? 'bg-amber-600 text-white' : 'bg-gray-200 dark:bg-gray-700'"
                :disabled="busy"
                @click="switchLogTab(0)"
              >
                领取我的
              </button>
            </div>
          </div>
          <div v-if="records.length" class="mt-3 space-y-1 text-sm">
            <div v-for="entry in records" :key="entry.seq" class="flex items-center justify-between rounded border border-gray-200/70 px-3 py-2 dark:border-gray-700/70">
              <span>{{ entry.actor?.name || '我' }}</span>
              <span class="opacity-70">+{{ entry.score }}</span>
            </div>
          </div>
          <div v-else class="mt-3 text-sm opacity-60">暂无记录</div>
        </section>
      </template>

      <section v-if="state.rules?.length" class="rounded-xl glass-subtle p-4">
        <h3 class="font-semibold">活动说明</h3>
        <ul class="mt-2 space-y-1 text-sm opacity-80">
          <li v-for="(rule, index) in state.rules" :key="index">{{ rule }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>
