<script setup lang="ts">
import type { Account } from '@/stores/account'
import { ref } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

defineProps<{
  accounts: Account[]
  filteredAccounts: Account[]
  accountsLoading: boolean
  runningCount: number
  wxCount: number
  qqCount: number
  deleteLoading: boolean
  remarkLoading: boolean
}>()

defineEmits<{
  refresh: []
  toggleRun: [account: Account]
  delete: [account: Account]
  openRemark: [account: Account]
  confirmDelete: []
  confirmRemark: []
}>()

const showDeleteConfirm = defineModel<boolean>('showDeleteConfirm', { required: true })
const pendingDelete = defineModel<Account | null>('pendingDelete', { required: true })
const showRemarkModal = defineModel<boolean>('showRemarkModal', { required: true })
const pendingRemark = defineModel<Account | null>('pendingRemark', { required: true })
const remarkValue = defineModel<string>('remarkValue', { required: true })
const searchQuery = defineModel<string>('searchQuery', { required: true })

const failedAvatars = ref<Set<string>>(new Set())

function cleanText(value: unknown) {
  return String(value || '').trim()
}

function accountAvatarSrc(account: Account) {
  const explicit = cleanText(account.avatar || account.avatarUrl)
  if (explicit)
    return explicit
  if (cleanText(account.platform).toLowerCase() === 'wx')
    return ''
  const qq = cleanText(account.uin || account.qq)
  if (qq && /^\d+$/.test(qq))
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`
  return ''
}

function avatarKey(account: Account) {
  return cleanText(account.id || account.uin || account.qq || account.wxid || '')
}

function canShowAvatar(account: Account) {
  const key = avatarKey(account)
  return !!accountAvatarSrc(account) && !!key && !failedAvatars.value.has(key)
}

function markAvatarFailed(account: Account) {
  const key = avatarKey(account)
  if (!key)
    return
  const next = new Set(failedAvatars.value)
  next.add(key)
  failedAvatars.value = next
}

function closeDeleteConfirm() {
  showDeleteConfirm.value = false
  pendingDelete.value = null
}

function closeRemarkModal() {
  showRemarkModal.value = false
  pendingRemark.value = null
}

function platformLabel(account: Account) {
  if (account.platform === 'qq')
    return 'QQ'
  if (account.platform === 'wx')
    return '微信'
  return '其他'
}

function accountDisplayName(account: Account) {
  return account.name || account.nick || `账号 ${account.id}`
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
        账号管理
      </h3>
      <BaseButton variant="primary" size="sm" :loading="accountsLoading" @click="$emit('refresh')">
        刷新
      </BaseButton>
    </div>

    <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          账号总数
        </div>
        <div class="mt-1 font-semibold">
          {{ accounts.length }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          运行中
        </div>
        <div class="mt-1 font-semibold">
          {{ runningCount }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          微信账号
        </div>
        <div class="mt-1 font-semibold">
          {{ wxCount }} 个
        </div>
      </div>
      <div class="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-glass)] px-4 py-3 text-sm text-gray-700 backdrop-blur-md dark:text-gray-200">
        <div class="text-xs text-gray-500 dark:text-gray-400">
          QQ 账号
        </div>
        <div class="mt-1 font-semibold">
          {{ qqCount }} 个
        </div>
      </div>
    </div>

    <div class="flex items-center justify-between gap-3">
      <BaseInput
        v-model="searchQuery"
        class="max-w-xs"
        placeholder="搜索名称 / 用户 / 平台"
      />
      <span class="text-xs text-gray-500 dark:text-gray-400">
        共 {{ filteredAccounts.length }} 个账号
      </span>
    </div>

    <div v-if="accountsLoading" class="flex justify-center py-10 text-gray-400">
      <div class="i-svg-spinners-ring-resize animate-spin text-2xl" />
    </div>

    <div v-else-if="filteredAccounts.length === 0" class="rounded-lg border border-dashed border-gray-300 py-10 text-center text-sm text-gray-400 dark:border-gray-600">
      暂无账号
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="account in filteredAccounts"
        :key="account.id"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
      >
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white"
            :class="account.platform === 'qq' ? 'bg-blue-500' : 'bg-green-500'"
          >
            <img
              v-if="canShowAvatar(account)"
              :src="accountAvatarSrc(account)"
              class="h-full w-full object-cover"
              @error="markAvatarFailed(account)"
            >
            <span v-else>{{ account.platform === 'qq' ? 'Q' : '微' }}</span>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium text-gray-900 dark:text-gray-100">
                {{ accountDisplayName(account) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs"
                :class="account.running
                  ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'"
              >
                {{ account.running ? '运行中' : '已停止' }}
              </span>
              <span class="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                {{ platformLabel(account) }}
              </span>
            </div>
            <div class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {{ account.username ? `所属用户: ${account.username}` : '无归属用户' }}
              <template v-if="account.uin || account.qq">
                · ID: {{ account.uin || account.qq }}
              </template>
            </div>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <BaseButton
            size="sm"
            :variant="account.running ? 'outline' : 'success'"
            @click="$emit('toggleRun', account)"
          >
            {{ account.running ? '停止' : '启动' }}
          </BaseButton>
          <BaseButton size="sm" variant="outline" @click="$emit('openRemark', account)">
            备注
          </BaseButton>
          <BaseButton size="sm" variant="danger" @click="$emit('delete', account)">
            删除
          </BaseButton>
        </div>
      </div>
    </div>

    <div v-if="showDeleteConfirm && pendingDelete" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div class="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div class="border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            删除账号
          </h3>
        </div>
        <div class="space-y-4 p-4">
          <p class="text-sm text-gray-600 dark:text-gray-300">
            确定要删除账号「{{ accountDisplayName(pendingDelete) }}」吗？此操作不可恢复。
          </p>
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" @click="closeDeleteConfirm">
              取消
            </BaseButton>
            <BaseButton variant="danger" :loading="deleteLoading" @click="$emit('confirmDelete')">
              确认删除
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showRemarkModal && pendingRemark" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div class="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div class="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            修改备注
          </h3>
          <BaseButton variant="ghost" class="!p-1" @click="closeRemarkModal">
            <div class="i-carbon-close text-xl" />
          </BaseButton>
        </div>
        <div class="space-y-4 p-4">
          <BaseInput
            v-model="remarkValue"
            label="备注名称"
            placeholder="请输入备注名称"
            @keyup.enter="$emit('confirmRemark')"
          />
          <div class="flex justify-end gap-2">
            <BaseButton variant="outline" @click="closeRemarkModal">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="remarkLoading" @click="$emit('confirmRemark')">
              保存
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
