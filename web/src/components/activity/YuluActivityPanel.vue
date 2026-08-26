<script setup lang="ts">
const verifiedFeatures = [
  { icon: '🌦️', title: '兑换天气采集瓶', note: '已确认：金豆 ×200 → 天气采集瓶 ×1，每自然日限 1 个' },
  { icon: '⚡', title: '气象研究', note: '已确认：雷电徽章解锁 9 档分支研究树奖励' },
  { icon: '🐸', title: '好友天气瓶', note: '已确认：引雷、青蛙、乌云可对好友农场使用' },
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
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">仅展示已核实用途；本地 Node 后端尚未移植 Go RPC 实现。</p>
        </div>
        <span class="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">只读预览</span>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <div v-for="([name, note], index) in bottles" :key="name" class="flex gap-3 rounded-lg border border-gray-200/70 p-3 dark:border-gray-700/70">
          <span class="text-xl">{{ ['🫧', '🌩️', '⚡', '🌩️', '🐸', '☁️', '🎁'][index] }}</span>
          <div>
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ name }}</div>
            <div class="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{{ note }}</div>
          </div>
        </div>
      </div>
    </section>

    <div class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      为避免误操作，真实领取、兑换和用瓶按钮暂不接线。采集瓶协议仍未确认，也不会通过猜测接口探测。
    </div>
  </div>
</template>
