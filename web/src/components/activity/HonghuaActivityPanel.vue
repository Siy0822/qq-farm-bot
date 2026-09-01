<script setup lang="ts">
import api from '@/api'
import { computed, onMounted, ref } from 'vue'

interface RewardTier {
  threshold: number
  donated?: number
  claimable?: boolean
  itemId?: number
  itemName?: string
  count?: number
}

const fallbackTiers: RewardTier[] = [
  { threshold: 30, itemName: '有机化肥（8小时）', count: 1 },
  { threshold: 60, itemName: '点券', count: 50 },
  { threshold: 90, itemName: '有机化肥（8小时）', count: 2 },
  { threshold: 120, itemName: '点券', count: 100 },
  { threshold: 150, itemName: '公益小红花做好事头像框', count: 1 },
]

const activity = ref<any>(null)
const loading = ref(false)
const action = ref('')
const error = ref('')
const notice = ref('')
const tiers = computed<RewardTier[]>(() => activity.value?.tiers?.length ? activity.value.tiers : fallbackTiers)
const love = computed(() => Number(activity.value?.love || 0))
const serverFund = computed(() => Number(activity.value?.serverFund || 0))
const serverGoal = computed(() => Number(activity.value?.serverGoal || 0))
const serverPercent = computed(() => Math.min(100, Number(activity.value?.serverPercent || 0)))

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value || 0)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await api.get('/activity/honghua')
    if (response.data?.ok === false)
      throw new Error(response.data?.error || '加载公益小红花失败')
    activity.value = response.data?.activity || response.data?.data || null
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '加载公益小红花失败'
  }
  finally {
    loading.value = false
  }
}

async function run(name: string, url: string, body: any = {}) {
  action.value = name
  error.value = ''
  notice.value = ''
  try {
    const response = await api.post(url, body)
    if (response.data?.ok === false)
      throw new Error(response.data?.error || response.data?.message || `${name}失败`)
    notice.value = response.data?.message || response.data?.msg || `${name}完成`
    await load()
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || `${name}失败`
  }
  finally {
    action.value = ''
  }
}

function donateFund() {
  const confirmed = window.confirm('送出公益金会产生真实 1 元扣款，且活动期通常仅有一次资格。确定继续吗？')
  if (confirmed) run('送出公益金', '/activity/honghua/fund', { confirmed: true })
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 via-red-500 to-pink-700 p-5 text-white shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-2 text-3xl">🌸</div>
          <h2 class="text-2xl font-bold">公益小红花</h2>
          <p class="mt-2 max-w-xl text-sm leading-6 text-white/90">种下一朵小红花，帮助乡村学童吃上热腾腾的免费午餐。</p>
          <p class="mt-2 text-xs font-semibold text-white/80">2026.09.01 — 09.09</p>
        </div>
        <button class="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold hover:bg-white/25" :disabled="loading" @click="load">
          {{ loading ? '刷新中…' : '刷新活动' }}
        </button>
      </div>
    </section>

    <div v-if="error" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-200">{{ error }}</div>
    <div v-if="notice" class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">{{ notice }}</div>

    <section class="grid gap-3 md:grid-cols-3">
      <article class="rounded-xl glass-subtle p-4">
        <p class="text-xs text-gray-500 dark:text-gray-400">累计已捐爱心值</p>
        <p class="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-300">{{ formatNumber(love) }}</p>
      </article>
      <article class="rounded-xl glass-subtle p-4 md:col-span-2">
        <div class="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>全服公益进度</span><span>{{ formatNumber(serverFund) }} / {{ serverGoal ? formatNumber(serverGoal) : '--' }} 元</span>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div class="h-full rounded-full bg-rose-500" :style="{ width: `${serverPercent}%` }" /></div>
        <p class="mt-2 text-right text-xs font-semibold text-rose-600 dark:text-rose-300">{{ serverPercent.toFixed(2) }}%</p>
      </article>
    </section>

    <section class="flex flex-wrap gap-2 rounded-xl glass-subtle p-4">
      <button class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" :disabled="!!action" @click="run('送出爱心值', '/activity/honghua/love')">💖 {{ action === '送出爱心值' ? '处理中…' : '送出爱心值' }}</button>
      <button class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" :disabled="!!action || activity?.fundClaimed" @click="donateFund">💛 {{ activity?.fundClaimed ? '已送出公益金' : action === '送出公益金' ? '处理中…' : '送出公益金 · 真实扣款 1 元' }}</button>
      <button class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200" :disabled="!!action" @click="run('领取分享奖励', '/activity/honghua/claim', { kind: 'share' })">领取分享奖励</button>
    </section>

    <section class="rounded-xl glass-subtle p-4">
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">个人爱心值档位奖励</h3>
      <div class="mt-3 space-y-2">
        <div v-for="tier in tiers" :key="tier.threshold" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2.5 dark:border-gray-700/70">
          <div>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ tier.threshold }} 爱心值</span>
            <span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{{ tier.itemName || `物品 ${tier.itemId}` }} ×{{ tier.count || 0 }}</span>
          </div>
          <button class="rounded-lg px-3 py-1.5 text-xs font-semibold" :class="tier.claimable ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'" :disabled="!!action || !tier.claimable" @click="run(`领取 ${tier.threshold} 档`, '/activity/honghua/claim', { kind: 'tier', tier: tier.threshold })">{{ tier.claimable ? '领取' : '未达成' }}</button>
        </div>
      </div>
    </section>

    <div class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      公益金操作涉及真实扣款，页面与后端均要求明确确认；上游尚未确认的每日礼包、全服结算领取指令未接入。
    </div>
  </div>
</template>
