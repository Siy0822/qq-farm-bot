<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'

const activity = ref<any>(null)
const loading = ref(false)
const action = ref('')
const error = ref('')
const load = async () => {
  loading.value = true; error.value = ''
  try { activity.value = (await api.get('/api/activity/yulu')).data.activity } catch (e: any) { error.value = e?.response?.data?.error || e?.message || '获取活动失败' } finally { loading.value = false }
}
const run = async (name: string, url: string, body: any = {}) => {
  action.value = name; error.value = ''
  try { await api.post(url, body); await load() } catch (e: any) { error.value = e?.response?.data?.error || e?.message || `${name}失败` } finally { action.value = '' }
}
onMounted(load)
const verifiedFeatures = [
  { icon: '🌦️', title: '兑换天气采集瓶', note: '金豆 ×200 → 天气采集瓶 ×1，每自然日限 1 个' },
  { icon: '⚡', title: '气象研究', note: '已确认：雷电徽章解锁 9 档分支研究树奖励' },
  { icon: '🐸', title: '好友天气瓶', note: '好友向协议暂不执行，避免误操作' },
]

const bottles = [
  ['天气采集瓶', '好友雷雨农场采集，协议仍待客户端报文确认'],
  ['雷雨召唤瓶', '在自己的农场召唤雷雨'],
  ['闪电变异瓶', '使自己的作物发生闪电变异'],
  ['霹雳引雷瓶', '对好友农场使用'],
  ['青蛙使坏瓶', '对好友农场使用'],
  ['乌云使坏瓶', '对好友农场使用'],
  ['百宝惊喜瓶', '开启活动奖励'],
]
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5 text-white shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="mb-2 text-3xl">🌧️</div>
          <h2 class="text-2xl font-bold">雨落成诗</h2>
          <p class="mt-2 text-sm text-white/85">雷雨限定活动 · 2026.08.26 — 09.08</p>
        </div>
        <span class="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold">活动已开启</span>
      </div>
    </section>

    <section class="grid gap-3 md:grid-cols-3">
      <article v-for="item in verifiedFeatures" :key="item.title" class="rounded-xl glass-subtle p-4">
        <div class="text-2xl">{{ item.icon }}</div>
        <h3 class="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{{ item.title }}</h3>
        <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ item.note }}</p>
      </article>
    </section>

    <section class="rounded-xl glass-subtle p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-gray-100">天气瓶图鉴</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">背包状态来自服务端；已确认的开箱、研究、兑换可直接操作。</p>
        </div>
        <span class="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">只读预览</span>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <div v-for="([name, note], index) in bottles" :key="name" class="flex items-start gap-3 rounded-lg border border-gray-200/70 p-3 dark:border-gray-700/70">
          <span class="text-xl">{{ ['🫧', '🌩️', '⚡', '🌩️', '🐸', '☁️', '🎁'][index] }}</span>
          <div>
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ name }}</div>
            <div class="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ note }}</div>
          </div>
          <span v-if="[1, 6, 7].includes(index)" class="ml-auto flex gap-1">
            <button v-if="index === 1 || index === 6" class="rounded bg-sky-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action" @click="run(index === 1 ? 'open' : 'open', '/api/activity/yulu/open', { itemId: index === 1 ? 5002 : 5007 })">使用</button>
            <button v-if="index === 7" class="rounded bg-amber-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action" @click="run('open', '/api/activity/yulu/open', { itemId: 5008 })">使用</button>
          </span>
        </div>
      </div>
    </section>

    <section v-if="activity" class="rounded-xl glass-subtle p-4">
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold">活动状态</h3><span>雷电徽章：{{ activity.badge }}</span></div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><div v-for="item in activity.research?.tiers" :key="item.nodeId" class="rounded border p-3 text-sm"><div>{{ item.nodeId }} · {{ item.reward }} ×{{ item.count }}</div><button class="mt-2 rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action" @click="run('research', '/api/activity/yulu/research', { nodeId: item.nodeId })">研究领取</button></div></div>
      <button class="mt-3 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" :disabled="!!action" @click="run('exchange', '/api/activity/yulu/exchange')">兑换天气采集瓶（200 金豆）</button>
    </section>

    <div v-if="loading" class="text-sm text-gray-500">正在读取背包…</div>
    <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>

    <div class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      采集瓶及好友向协议仍未确认，因此不会执行；5002/5007/5008、研究和兑换使用已确认协议。
    </div>
  </div>
</template>
