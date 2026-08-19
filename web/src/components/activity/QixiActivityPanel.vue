<script setup lang="ts">
import type { QixiActivity, QixiTier } from '@/stores/activity'
import { computed, ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ActivityItemImage from './ActivityItemImage.vue'

const props = defineProps<{
  activity?: QixiActivity | null
  loading?: boolean
  sprayLoading?: boolean
  bridgeLoading?: boolean
  giftLoading?: boolean
  friends?: Array<{ gid: number, name?: string, nick?: string }>
  friendsLoading?: boolean
}>()

const emit = defineEmits<{
  refresh: []
  spray: [payload: { hostGid: number, count: number }]
  bridge: []
  gift: [payload: { hostGid: number }]
  loadFriends: []
}>()

const selectedFriend = ref<number>(0)
const sprayCount = ref<number>(1)

const feather = computed(() => Number(props.activity?.feather || 0))
const luStock = computed(() => Number(props.activity?.luStock || 0))
const sachet = computed(() => Number(props.activity?.sachet || 0))
const tiers = computed<QixiTier[]>(() => props.activity?.tiers || [])
const nextTier = computed(() => props.activity?.nextTier || null)
const bridgeProgress = computed(() => {
  const target = Number(nextTier.value?.consume || 0)
  if (target <= 0)
    return 100
  return Math.min(100, Math.round((feather.value / target) * 100))
})
const canBridge = computed(() => !!nextTier.value && feather.value >= Number(nextTier.value?.consume || 0))
const friendOptions = computed(() => (props.friends || []).filter(f => Number(f.gid) > 0))

const chips = computed(() => [
  { label: '鹊羽', value: feather.value, item: props.activity?.items?.feather, class: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200' },
  { label: '鹊羽灵露', value: luStock.value, item: props.activity?.items?.lu, class: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200' },
  { label: '鹊羽香囊', value: sachet.value, item: props.activity?.items?.sachet, class: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-200' },
])

function formatTime(value?: number) {
  if (!value)
    return '-'
  return new Date(value * 1000).toLocaleString()
}

function spraySelf() {
  emit('spray', { hostGid: 0, count: Math.max(1, Number(sprayCount.value) || 1) })
}

function sprayFriend() {
  const gid = Number(selectedFriend.value) || 0
  if (gid <= 0)
    return
  emit('spray', { hostGid: gid, count: Math.max(1, Number(sprayCount.value) || 1) })
}

function giftFriend() {
  const gid = Number(selectedFriend.value) || 0
  if (gid <= 0)
    return
  emit('gift', { hostGid: gid })
}

function tierLabel(tier: QixiTier) {
  if (tier.claimed)
    return '已领取'
  if (tier.claimable)
    return '可筑建'
  return `鹊羽不足（${feather.value}/${tier.consume}）`
}
</script>

<template>
  <section class="overflow-hidden rounded-lg bg-white shadow-sm dark:bg-gray-800">
    <div class="from-rose-500 to-pink-600 bg-gradient-to-r px-5 py-4 text-white">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="i-carbon-favorite text-3xl" />
          <div>
            <h2 class="text-lg font-bold">
              {{ activity?.title || '鹊桥寄情' }}
            </h2>
            <p class="mt-0.5 text-sm text-white/85">
              七夕限定 · {{ formatTime(activity?.startTime) }} — {{ formatTime(activity?.endTime) }}
            </p>
          </div>
        </div>
        <BaseButton size="sm" variant="secondary" :loading="loading" @click="emit('refresh')">
          刷新
        </BaseButton>
      </div>
    </div>

    <div class="p-5 space-y-5">
      <div v-if="activity?.warning" class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
        {{ activity.warning }}
      </div>

      <!-- 资源芯片 -->
      <div class="grid gap-3 sm:grid-cols-3">
        <div v-for="chip in chips" :key="chip.label" class="flex items-center gap-3 rounded-xl px-4 py-3" :class="chip.class">
          <ActivityItemImage v-if="chip.item?.image" :item="chip.item" img-class="h-10 w-10" />
          <div v-else class="i-carbon-star text-2xl" />
          <div>
            <div class="text-xl font-bold">
              {{ chip.value }}
            </div>
            <div class="text-xs opacity-80">
              {{ chip.label }}
            </div>
          </div>
        </div>
      </div>

      <!-- 筑建鹊桥 -->
      <div class="rounded-xl border border-gray-100 p-4 dark:border-gray-700">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-base text-gray-900 font-semibold dark:text-gray-100">
            筑建鹊桥
            <span class="ml-2 text-xs text-gray-500 font-normal dark:text-gray-400">
              共 {{ tiers.length || 0 }} 档 · 已领 {{ activity?.claimedTierCount || 0 }} 档
            </span>
          </div>
          <BaseButton
            variant="primary"
            :loading="bridgeLoading"
            :disabled="bridgeLoading || !canBridge"
            @click="emit('bridge')"
          >
            {{ !nextTier ? '全部档位已领取' : (canBridge ? `筑建第 ${nextTier.tier} 档（消耗 ${nextTier.consume}）` : `鹊羽不足（${feather}/${nextTier.consume}）`) }}
          </BaseButton>
        </div>

        <div class="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
          <div class="h-full rounded-full bg-rose-500 transition-all" :style="{ width: `${bridgeProgress}%` }" />
        </div>
        <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          当前 {{ feather }} 鹊羽{{ nextTier ? ` / 下一档需 ${nextTier.consume}` : '' }}
        </div>

        <div v-if="tiers.length" class="mt-4 space-y-3">
          <div
            v-for="tier in tiers"
            :key="tier.tier"
            class="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900/40"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm text-gray-900 font-semibold dark:text-gray-100">
                第 {{ tier.tier }} 档 · 消耗 {{ tier.consume }} 鹊羽
              </div>
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="tier.claimed
                  ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  : (tier.claimable ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200')"
              >
                {{ tierLabel(tier) }}
              </span>
            </div>
            <div v-if="tier.rewards?.length" class="mt-2 flex flex-wrap items-center gap-3">
              <div v-for="reward in tier.rewards" :key="reward.itemId" class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <ActivityItemImage v-if="reward.image" :item="reward" img-class="h-8 w-8" />
                <span>{{ reward.itemName }} × {{ reward.itemCount }}</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="mt-4 text-sm text-gray-500 dark:text-gray-400">
          暂未取到档位数据（活动未开始或服务端未下发）
        </div>
      </div>

      <!-- 鹊羽灵露 / 香囊 -->
      <div class="rounded-xl border border-gray-100 p-4 dark:border-gray-700">
        <div class="text-base text-gray-900 font-semibold dark:text-gray-100">
          鹊羽灵露与香囊
        </div>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          在自己或好友土地上使用鹊羽灵露可主动触发鹊羽效果，每次收获 1 根鹊羽（变异作物额外叠加）。
        </p>

        <div class="mt-3 flex flex-wrap items-end gap-3">
          <label class="text-xs text-gray-500 dark:text-gray-400">
            喷洒次数
            <input
              v-model.number="sprayCount"
              type="number"
              min="1"
              max="20"
              class="mt-1 block w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
            >
          </label>
          <BaseButton
            variant="primary"
            :loading="sprayLoading"
            :disabled="sprayLoading || luStock <= 0"
            @click="spraySelf"
          >
            {{ luStock > 0 ? '在自家喷洒' : '灵露库存为空' }}
          </BaseButton>
        </div>

        <div class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700">
          <div class="flex flex-wrap items-end gap-3">
            <label class="min-w-56 flex-1 text-xs text-gray-500 dark:text-gray-400">
              选择好友
              <select
                v-model.number="selectedFriend"
                class="mt-1 block w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                <option :value="0">
                  {{ friendOptions.length ? '请选择好友' : '暂无好友数据' }}
                </option>
                <option v-for="friend in friendOptions" :key="friend.gid" :value="friend.gid">
                  {{ friend.name || friend.nick || friend.gid }}
                </option>
              </select>
            </label>
            <BaseButton size="sm" variant="secondary" :loading="friendsLoading" @click="emit('loadFriends')">
              加载好友
            </BaseButton>
            <BaseButton
              variant="primary"
              :loading="sprayLoading"
              :disabled="sprayLoading || luStock <= 0 || !selectedFriend"
              @click="sprayFriend"
            >
              给好友喷洒
            </BaseButton>
            <BaseButton
              variant="secondary"
              :loading="giftLoading"
              :disabled="giftLoading || sachet <= 0 || !selectedFriend"
              @click="giftFriend"
            >
              {{ sachet > 0 ? '赠送香囊' : '无香囊可送' }}
            </BaseButton>
          </div>
        </div>
      </div>

      <!-- 玩法说明 -->
      <details v-if="activity?.tips?.sections?.length" class="rounded-xl border border-gray-100 p-4 dark:border-gray-700">
        <summary class="cursor-pointer text-sm text-gray-900 font-semibold dark:text-gray-100">
          {{ activity.tips.title || '活动说明' }}
        </summary>
        <div class="mt-3 space-y-3">
          <div v-for="(section, index) in activity.tips.sections" :key="index">
            <div class="text-sm text-gray-800 font-medium dark:text-gray-200">
              {{ section.title }}
            </div>
            <ul class="mt-1 list-disc pl-5 text-xs text-gray-600 space-y-1 dark:text-gray-400">
              <li v-for="(item, itemIndex) in section.items" :key="itemIndex">
                {{ item }}
              </li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  </section>
</template>
