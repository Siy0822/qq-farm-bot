<script setup lang="ts">
import type { SystemConfig, WxConfig } from '@/composables/useAdminSystemConfig'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

interface OptionItem {
  label: string
  value: string
}

defineProps<{
  defaultSystemConfig: SystemConfig
  platformOptions: OptionItem[]
  osOptions: OptionItem[]
  systemConfigSaving: boolean
  wxConfigSaving: boolean
}>()

defineEmits<{
  resetSystem: []
  saveSystem: []
  resetWx: []
  saveWx: []
}>()

const localSystemConfig = defineModel<SystemConfig>('localSystemConfig', { required: true })
const localWxConfig = defineModel<WxConfig>('localWxConfig', { required: true })
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg text-gray-900 font-bold dark:text-gray-100">
      系统配置
    </h3>

    <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
      修改后会直接影响全局连接参数与微信登录行为，保存前建议再次核对目标环境。
    </div>

    <div class="space-y-4">
      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-settings" />
          系统配置
        </h4>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前平台
            </div>
            <div class="mt-1 font-semibold">
              {{ platformOptions.find(option => option.value === localSystemConfig.platform)?.label || '未设置' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              当前系统
            </div>
            <div class="mt-1 font-semibold">
              {{ localSystemConfig.os }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              默认版本
            </div>
            <div class="mt-1 font-semibold">
              {{ defaultSystemConfig.clientVersion }}
            </div>
          </div>
        </div>

        <div class="mb-3 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
          服务器地址与客户端版本通常需要成对调整，建议先在测试环境验证，再同步到生产使用。
        </div>

        <div class="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          保存后会立刻影响全局连接参数。若服务器地址、平台或系统版本不匹配，可能导致后续账号连接异常。
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <BaseInput
            v-model="localSystemConfig.serverUrl"
            label="服务器地址"
            type="text"
            placeholder="wss://..."
            class="col-span-2"
          />
          <BaseInput
            v-model="localSystemConfig.clientVersion"
            label="客户端版本"
            type="text"
            placeholder="1.12.3.20_20260709"
            class="col-span-2"
          />
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">平台</label>
            <div class="flex gap-2">
              <button
                v-for="option in platformOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.platform === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.platform === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.platform = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-sm text-gray-700 font-medium dark:text-gray-300">系统</label>
            <div class="flex gap-2">
              <button
                v-for="option in osOptions"
                :key="option.value"
                class="rounded-lg px-3 py-1.5 text-sm transition-all"
                :class="localSystemConfig.os === option.value
                  ? 'text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'"
                :style="localSystemConfig.os === option.value ? { backgroundColor: 'var(--theme-primary)' } : {}"
                @click="localSystemConfig.os = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('resetSystem')"
          >
            重置
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="systemConfigSaving"
            @click="$emit('saveSystem')"
          >
            保存
          </BaseButton>
        </div>
      </div>

      <div class="border border-gray-200 rounded-lg bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h4 class="mb-3 flex items-center gap-2 text-base text-gray-900 font-bold dark:text-gray-100">
          <div class="i-carbon-logo-wechat" />
          微信配置
        </h4>

        <div class="grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              登录状态
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.enabled ? '已启用' : '已关闭' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              自动添加账号
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.autoAddAccount ? '开启' : '关闭' }}
            </div>
          </div>
          <div class="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
            <div class="text-xs text-gray-500 dark:text-gray-400">
              用户隔离
            </div>
            <div class="mt-1 font-semibold">
              {{ localWxConfig.userIsolation ? '开启' : '关闭' }}
            </div>
          </div>
        </div>

        <div class="mb-3 rounded-2xl p-3 text-xs" style="background-color: rgba(var(--theme-primary-rgb, 59, 130, 246), 0.1); color: var(--theme-primary);">
          <div>启用微信登录：关闭后普通用户无法使用微信扫码登录。</div>
          <div class="mt-1">
            自动添加账号：扫码成功后自动添加账号，关闭则只返回 Code。
          </div>
          <div class="mt-1">
            用户隔离：开启后普通用户只能看到自己的账号。
          </div>
        </div>

        <div class="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          重置只会回填当前编辑区的默认值，不会立刻写回服务端。只有点击“保存”后，微信登录相关设置才会正式生效。
        </div>

        <div class="mb-3 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
          保存会立即影响扫码登录、自动添加账号与用户隔离行为，建议确认当前环境、代理地址和启用状态后再提交。
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="col-span-2">
            <BaseSwitch
              v-model="localWxConfig.enabled"
              label="启用微信登录"
            />
          </div>
          <BaseInput
            v-model="localWxConfig.apiBase"
            label="API地址"
            type="text"
            placeholder="https://code.z74d.top/api"
            class="col-span-2"
          />
          <BaseInput
            v-model="localWxConfig.apiKey"
            label="API密钥"
            type="text"
            placeholder="可选，用于代理模式"
            class="col-span-2"
          />
          <BaseInput
            v-model="localWxConfig.proxyApiUrl"
            label="代理API地址"
            type="text"
            placeholder="https://code.z74d.top/api"
            class="col-span-2"
          />
          <BaseSwitch
            v-model="localWxConfig.autoAddAccount"
            label="自动添加账号"
          />
          <BaseSwitch
            v-model="localWxConfig.userIsolation"
            label="用户隔离"
          />
        </div>

        <div class="mt-3 flex justify-end gap-2">
          <BaseButton
            variant="secondary"
            size="sm"
            :loading="wxConfigSaving"
            @click="$emit('resetWx')"
          >
            重置
          </BaseButton>
          <BaseButton
            variant="primary"
            size="sm"
            :loading="wxConfigSaving"
            @click="$emit('saveWx')"
          >
            保存
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
