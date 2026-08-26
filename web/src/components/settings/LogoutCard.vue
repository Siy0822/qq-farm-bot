<script setup lang="ts">
import { computed, ref } from 'vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()

const showConfirm = ref(false)
const loggingOut = ref(false)

const currentUsername = computed(() => userStore.username || '当前账号')
const roleLabel = computed(() => {
  const role = userStore.userInfo?.role
  if (role === 'super_admin')
    return '超级管理员'
  if (role === 'admin')
    return '管理员'
  return '普通用户'
})

async function handleLogout() {
  if (loggingOut.value)
    return
  loggingOut.value = true
  try {
    // logout() 内部已 try/finally 清空本地 token 与用户信息，
    // 即使 /api/logout 请求失败也不会把人卡在已登录状态。
    await userStore.logout()
  }
  finally {
    // 硬跳转而非 router.push：整页重载可确保清空所有 store 内存态，
    // 与 useUserSettings.ts 改密后的登出流程保持一致。
    window.location.href = '/login'
  }
}
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white p-4 max-sm:p-3 dark:border-gray-700 dark:bg-gray-800">
    <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100 max-sm:text-sm">
      <div class="i-carbon-logout" />
      退出登录
    </h4>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0 text-sm text-gray-600 dark:text-gray-300">
        <div class="truncate">
          当前网站用户：<span class="text-gray-900 font-medium dark:text-gray-100">{{ currentUsername }}</span>
          <span class="ml-2 inline-flex rounded-full bg-gray-100 px-2 text-xs leading-5 dark:bg-gray-700">{{ roleLabel }}</span>
        </div>
        <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          仅退出本网站的登录状态，需重新输入网站账号密码登录。
        </div>
      </div>

      <BaseButton
        variant="danger"
        size="sm"
        :loading="loggingOut"
        :disabled="loggingOut"
        @click="showConfirm = true"
      >
        退出登录
      </BaseButton>
    </div>

    <ConfirmModal
      :show="showConfirm"
      :loading="loggingOut"
      title="退出网站登录"
      :message="`确定要退出网站用户 ${currentUsername} 吗？`"
      confirm-text="退出登录"
      type="danger"
      @close="!loggingOut && (showConfirm = false)"
      @cancel="!loggingOut && (showConfirm = false)"
      @confirm="handleLogout"
    />
  </div>
</template>
