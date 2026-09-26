<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue'
import type { SvipMallGoods } from '@/stores/shop'

defineProps<{
  item: SvipMallGoods
  hint: string
}>()

const emit = defineEmits<{
  (e: 'buy', item: SvipMallGoods): void
}>()

const L = {
  free: '\u514D\u8D39',
  buy: '\u7ACB\u5373\u8D2D\u4E70',
  claim: '\u7ACB\u5373\u9886\u53D6',
  soldOut: '\u5DF2\u552E\u7F44',
  owned: '\u5DF2\u62E5\u6709',
}

function priceLabel(item: SvipMallGoods) {
  if (item.isFree)
    return L.free
  const name = item.price?.name || (item.price?.id ? `\u7269\u54C1${item.price.id}` : '')
  return `${item.price?.count ?? 0} ${name}`.trim()
}

function canClick(item: SvipMallGoods) {
  return item.purchasable && item.purchaseStatus !== 'sold_out' && item.purchaseStatus !== 'owned'
}

function buttonLabel(item: SvipMallGoods) {
  if (item.purchaseStatus === 'sold_out')
    return L.soldOut
  if (item.purchaseStatus === 'owned')
    return L.owned
  if (!item.purchasable)
    return item.unavailableReason || '\u4E0D\u53EF\u8D2D\u4E70'
  return item.isFree ? L.claim : L.buy
}
</script>

<template>
  <article class="min-h-[216px] min-w-0 flex flex-col overflow-hidden border border-gray-200 rounded-lg bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div class="relative grid h-24 place-items-center bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/20 dark:to-amber-800/20">
      <span class="absolute left-0 top-0 rounded-br-lg bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 font-semibold dark:bg-amber-900/40 dark:text-amber-200">
        SVIP
      </span>
      <span class="absolute right-0 top-0 rounded-bl-lg bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 font-semibold dark:bg-blue-900/20 dark:text-blue-300">
        #{{ item.id }}
      </span>
      <div class="grid h-14 w-14 place-items-center rounded-lg bg-white text-sm text-gray-500 font-semibold dark:bg-gray-800">
        {{ String(item.name || '?').slice(0, 1) }}
      </div>
    </div>

    <div class="min-h-[120px] flex flex-1 flex-col p-3">
      <div class="line-clamp-2 text-center text-sm text-gray-900 font-semibold dark:text-gray-100">
        {{ item.name }}
      </div>
      <div class="mt-1 text-center text-xs text-amber-600 font-semibold dark:text-amber-400">
        <span v-if="item.isDiscounted && item.originalPrice" class="mr-1 text-gray-400 line-through dark:text-gray-500">
          {{ item.originalPrice }}
        </span>
        {{ priceLabel(item) }}
      </div>
      <p v-if="item.rewards?.length" class="line-clamp-2 mt-2 text-[11px] text-blue-500 leading-5 dark:text-blue-400">
        {{ item.rewards.map(r => `${r.name} \u00D7${r.count}`).join('\u3001') }}
      </p>
      <p class="line-clamp-2 mt-2 text-[11px] text-gray-500 leading-5 dark:text-gray-400">
        {{ hint }}
      </p>
      <BaseButton
        class="mt-auto w-full"
        variant="primary"
        :disabled="!canClick(item)"
        @click="emit('buy', item)"
      >
        {{ buttonLabel(item) }}
      </BaseButton>
    </div>
  </article>
</template>
