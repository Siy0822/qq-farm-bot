<script setup lang="ts">
const flow = [
  ['📋', '每日任务 / 分享', '获取小红花种子'],
  ['🌱', '种植收获', '收获小红花果实'],
  ['💖', '累计爱心值', '解锁个人档位奖励'],
  ['🤝', '公益助力', '送出公益金'],
]

const tiers = [
  ['档位 1', '有机化肥（8小时）×1'],
  ['档位 2', '点券 ×50'],
  ['档位 3', '有机化肥（8小时）×2'],
  ['档位 4', '点券 ×100'],
  ['档位 5', '公益小红花做好事头像框 ×1'],
]
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 via-red-500 to-pink-700 p-5 text-white shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="mb-2 text-3xl">🌸</div>
          <h2 class="text-2xl font-bold">公益小红花</h2>
          <p class="mt-2 max-w-xl text-sm leading-6 text-white/90">种下一朵小红花，帮助乡村学童吃上热腾腾的免费午餐。</p>
          <p class="mt-2 text-xs font-semibold text-white/80">2026.09.01 — 09.09</p>
        </div>
        <span class="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold">活动预告</span>
      </div>
    </section>

    <section class="grid gap-2 md:grid-cols-4">
      <article v-for="([icon, title, note]) in flow" :key="title" class="rounded-xl glass-subtle p-4 text-center">
        <div class="text-2xl">{{ icon }}</div>
        <h3 class="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">{{ title }}</h3>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ note }}</p>
      </article>
    </section>

    <section class="rounded-xl glass-subtle p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-gray-100">个人爱心值档位奖励</h3>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">以下内容来自活动预告，占位展示，开服后以服务端数据为准。</p>
        </div>
        <span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">未接入后端</span>
      </div>
      <div class="mt-3 space-y-2">
        <div v-for="([tier, reward]) in tiers" :key="tier" class="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 px-3 py-2.5 dark:border-gray-700/70">
          <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ tier }}</span>
          <span class="text-right text-xs text-gray-500 dark:text-gray-400">{{ reward }}</span>
        </div>
      </div>
    </section>

    <section class="rounded-xl glass-subtle p-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
      <h3 class="font-semibold text-gray-900 dark:text-gray-100">活动说明</h3>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li>每日任务或分享可获得小红花种子，种植收获后累计爱心值。</li>
        <li>满足条件后可参与公益助力；公益金不支持提现、兑换、转让或售卖。</li>
        <li>全服目标和具体领取条件需等待活动开服后的真实协议与数据确认。</li>
      </ul>
    </section>

    <div class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      当前为纯前端占位面板。所有领取、捐赠和公益金操作均未接线，避免调用未经抓包确认的接口。
    </div>
  </div>
</template>
