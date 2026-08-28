<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'

const activity = ref<any>(null)
const loading = ref(false)
const action = ref('')
const error = ref('')
const friends = ref<any[]>([])
const load = async () => {
  loading.value = true; error.value = ''
  try { activity.value = (await api.get('/api/activity/yulu')).data.activity }
  catch (e: any) { error.value = e?.response?.data?.error || e?.message || '获取活动失败' }
  finally { loading.value = false }
}
const run = async (name: string, url: string, body: any = {}) => {
  action.value = name; error.value = ''
  try { await api.post(url, body); await load() }
  catch (e: any) { error.value = e?.response?.data?.error || e?.message || `${name}失败` }
  finally { action.value = '' }
}
const loadFriends = async () => {
  try {
    const data = (await api.get('/api/friends')).data
    friends.value = (data?.data?.friends || data?.friends || []).filter((f: any) => f.gid)
  } catch (e: any) { error.value = e?.response?.data?.error || '好友列表加载失败' }
}
const count = (id: number) => Number(activity.value?.items?.[id]?.count || 0)
const itemName = (id: number) => activity.value?.items?.[id]?.name || `物品${id}`
const research = computed(() => activity.value?.research?.tiers || [])
onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-700 p-5 text-white shadow-sm">
      <div class="flex items-start justify-between gap-3"><div><div class="mb-2 text-3xl">🌧️</div><h2 class="text-2xl font-bold">雨落成诗</h2><p class="mt-2 text-sm text-white/85">雷雨限定活动 · 2026.08.26 — 09.08 · 当前天气：{{ activity?.weather?.name || '—' }}</p></div><span class="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold">活动已开启</span></div>
    </section>

    <section class="rounded-xl glass-subtle p-4">
      <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-semibold text-gray-900 dark:text-gray-100">活动物品</h3><span class="text-sm">⚡ 雷电徽章：{{ activity?.badge ?? '—' }}</span></div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div v-for="id in [5001,5002,5003,5004,5005,5006,5007,5008,5009,5010]" :key="id" class="rounded-lg border border-gray-200/70 p-3 dark:border-gray-700/70">
          <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ itemName(id) }}</div><div class="mt-1 text-xs text-gray-500 dark:text-gray-400">库存 ×{{ count(id) }}</div>
          <button v-if="[5002,5007,5008].includes(id)" class="mt-2 rounded bg-sky-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action || count(id) <= 0" @click="run('open', '/api/activity/yulu/open', { itemId: id })">使用</button>
          <button v-if="id === 5003" class="mt-2 rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action || count(id) <= 0" @click="run('mutate', '/api/activity/yulu/mutate')">闪电变异</button>
        </div>
      </div>
    </section>

    <section class="rounded-xl glass-subtle p-4"><div class="flex items-center justify-between gap-3"><h3 class="font-semibold">气象研究</h3><span class="text-xs text-gray-500">按前置档位领取</span></div><div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><div v-for="item in research" :key="item.nodeId" class="rounded border p-3 text-sm" :class="item.claimed ? 'border-emerald-400 opacity-70' : ''"><div>{{ item.nodeId }} · {{ item.reward }} ×{{ item.count }}</div><div class="mt-1 text-xs text-gray-500">消耗雷电徽章 ×{{ item.cost }}{{ item.claimed ? ' · 已领取' : '' }}</div><button v-if="!item.claimed" class="mt-2 rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action" @click="run('research', '/api/activity/yulu/research', { nodeId: item.nodeId })">研究领取</button></div></div></section>

    <section class="rounded-xl glass-subtle p-4"><div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-semibold">好友天气瓶</h3><p class="mt-1 text-xs text-gray-500">逐好友执行，服务端校验雷雨状态；不会自动批量操作。</p></div><button class="rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700" :disabled="!!action" @click="loadFriends">刷新好友</button></div><div v-if="friends.length" class="mt-3 space-y-2"><div v-for="friend in friends" :key="friend.gid" class="flex flex-wrap items-center gap-2 rounded border p-2"><span class="flex-1 text-sm">{{ friend.nickname || friend.name || friend.gid }}</span><button v-for="[id, label] in [[5001,'采集'],[5004,'引雷'],[5005,'青蛙'],[5006,'乌云']]" :key="id" class="rounded bg-sky-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="!!action || count(Number(id)) <= 0" @click="run(label, '/api/activity/yulu/use', { itemId: Number(id), hostGid: friend.gid })">{{ label }}</button></div></div></section>

    <section class="rounded-xl glass-subtle p-4"><button class="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50" :disabled="!!action" @click="run('exchange', '/api/activity/yulu/exchange')">兑换天气采集瓶（200 金豆）</button></section>
    <div v-if="loading" class="text-sm text-gray-500">正在读取活动状态…</div><div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
  </div>
</template>
