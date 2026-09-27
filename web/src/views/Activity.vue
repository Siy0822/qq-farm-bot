<script setup lang="ts">
import type { ActivityLabels, ActivitySection, ActivitySectionKey } from '@/components/activity/types'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import AutumnActivityPanel from '@/components/activity/AutumnActivityPanel.vue'
import PetDiaryActivityPanel from '@/components/activity/PetDiaryActivityPanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useActivityStore } from '@/stores/activity'

const L: ActivityLabels = {
  title: '\u6D3B\u52A8\u4E2D\u5FC3',
  currentAccount: '\u5F53\u524D\u8D26\u53F7',
  none: '\u672A\u9009\u62E9',
  needAccount: '\u8BF7\u5148\u9009\u62E9\u8D26\u53F7\uFF0C\u518D\u67E5\u770B\u6D3B\u52A8\u6570\u636E\u3002',
  refresh: '\u5237\u65B0',
} as const

// 已结束活动的入口与面板均已下线（2026-09-27）：
// 千星游记/千星同明（观星礼录，7-29 ~ 8-27）、雨落成诗（8-26 ~ 9-08）、
// 公益小红花（9-01 ~ 9-09）、鹊桥寄情（七夕，8-18 ~ 8-22，此前已隐藏）。
// 后端 service / 路由 / proto / activity-data 全部保留，活动回归时重新挂回页签即可。

const accountStore = useAccountStore()
const activityStore = useActivityStore()

const { currentAccountId, currentAccount } = storeToRefs(accountStore)

const activeSection = ref<ActivitySectionKey>('petDiary')
// 面板自带加载逻辑，改 key 触发重新挂载即等价于刷新
const refreshKey = ref(0)

const seasonalActivityTabs = computed<ActivitySection[]>(() => [
  { key: 'petDiary', label: '萌宠日记', icon: '🐶' },
  { key: 'autumnWish', label: '秋祈良愿', icon: '🍁' },
  { key: 'autumnHappy', label: '快乐不独享', icon: '🎉' },
])

const sectionTabs = computed<ActivitySection[]>(() => [...seasonalActivityTabs.value])

const headerPills = computed(() => [
  {
    label: L.currentAccount,
    value: currentAccount.value?.name || L.none,
    icon: 'i-carbon-user',
    class: 'bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  },
])

function segmentedButtonClasses(active: boolean) {
  return active
    ? 'text-white shadow-sm'
    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
}

function refreshAll() {
  refreshKey.value += 1
}

watch(sectionTabs, (sections) => {
  if (!sections.some(section => section.key === activeSection.value))
    activeSection.value = sections[0]?.key || 'petDiary'
}, { immediate: true })

watch(currentAccountId, () => {
  activityStore.clearActivityData()
  refreshAll()
})

onMounted(() => {
  refreshAll()
})
</script>

<template>
  <section class="space-y-4">
    <header class="rounded-lg glass-card p-4">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="min-w-0 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="i-carbon-events text-2xl text-emerald-500" />
            <h1 class="text-xl text-gray-900 font-bold dark:text-gray-100">
              {{ L.title }}
            </h1>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <div
              v-for="item in headerPills"
              :key="item.label"
              class="h-8 flex items-center gap-2 rounded-lg px-3 text-xs"
              :class="item.class"
            >
              <span :class="item.icon" />
              <span>{{ item.label }} {{ item.value }}</span>
            </div>
          </div>
        </div>

        <div class="min-w-0 flex flex-wrap items-center gap-2">
          <div class="max-w-full min-w-0 overflow-x-auto pb-1">
            <div class="h-9 min-w-max inline-flex overflow-hidden border rounded-lg glass-segmented p-0.5">
              <button
                v-for="section in sectionTabs"
                :key="section.key"
                class="min-w-20 shrink-0 rounded-md px-3 text-sm font-medium transition"
                :class="segmentedButtonClasses(activeSection === section.key)"
                :style="activeSection === section.key ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="activeSection = section.key"
              >
                <span>{{ section.label }}</span>
              </button>
            </div>
          </div>
          <BaseButton
            class="w-24"
            variant="primary"
            :disabled="!currentAccountId"
            @click="refreshAll"
          >
            {{ L.refresh }}
          </BaseButton>
        </div>
      </div>
    </header>

    <div
      v-if="!currentAccountId"
      class="rounded-lg glass-subtle p-10 text-center text-sm"
    >
      <div class="i-carbon-user-profile mx-auto mb-3 text-3xl opacity-30" />
      {{ L.needAccount }}
    </div>

    <template v-else>
      <PetDiaryActivityPanel v-if="activeSection === 'petDiary'" :key="`petDiary-${refreshKey}`" />

      <AutumnActivityPanel v-else-if="activeSection === 'autumnWish'" :key="`wish-${refreshKey}`" kind="wish" />

      <AutumnActivityPanel v-else-if="activeSection === 'autumnHappy'" :key="`happy-${refreshKey}`" kind="happy" />
    </template>
  </section>
</template>

<style scoped>
.glass-card {
  border-radius: 16px;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: var(--theme-glass);
  border: 1px solid var(--theme-border);
}

.glass-subtle {
  border-radius: 16px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--theme-bg) 30%, transparent);
  border: 1px solid var(--theme-border);
}

.glass-segmented {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: color-mix(in srgb, var(--theme-glass) 50%, transparent);
  border-color: var(--theme-border);
}

/* 子组件覆盖 */
:deep(.bg-white),
:deep(.dark\\:bg-gray-800),
:deep(.dark\\:bg-gray-900) {
  background: var(--theme-glass) !important;
}

:deep(.border-gray-200),
:deep(.dark\\:border-gray-700) {
  border-color: var(--theme-border) !important;
}

:deep(.shadow-sm),
:deep(.shadow) {
  box-shadow: none !important;
}
</style>
