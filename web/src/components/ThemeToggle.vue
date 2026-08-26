<script setup lang="ts">
import type { Theme, ThemePreference } from '@/stores/app'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

const themeOptions: Array<{
  key: ThemePreference
  name: string
  description: string
  icon: string
}> = [
  { key: 'light', name: '晨光', description: '温暖 · 日光田野', icon: 'i-carbon-sun' },
  { key: 'dark', name: '夜幕', description: '深邃 · 光感夜幕', icon: 'i-carbon-moon' },
  { key: 'system', name: '跟随系统', description: '随设备外观自动切换', icon: 'i-carbon-laptop' },
]

function optionTheme(key: ThemePreference): Theme {
  return key === 'system' ? appStore.currentTheme : key
}

function optionGradient(key: ThemePreference) {
  if (key === 'system')
    return 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 48%, #0f172a 52%, #334155 100%)'
  return appStore.themes[key].gradient
}

function optionPrimary(key: ThemePreference) {
  return appStore.themes[optionTheme(key)].primary
}
</script>

<template>
  <div class="relative flex items-center gap-1">
    <!-- 主题切换按钮：一键明暗切换 -->
    <button
      class="flex h-8 w-16 items-center justify-between rounded-full px-1.5 transition-all duration-300"
      :style="{
        background: appStore.isDark
          ? 'linear-gradient(135deg, #1e293b, #334155)'
          : 'linear-gradient(135deg, #fef3c7, #fde68a)',
        boxShadow: appStore.isDark
          ? 'inset 0 1px 2px rgba(0,0,0,0.4)'
          : 'inset 0 1px 2px rgba(0,0,0,0.08)',
      }"
      :title="appStore.isDark ? '切换到浅色模式' : '切换到深色模式'"
      @click="appStore.toggleThemePanel()"
    >
      <!-- 滑块 -->
      <div
        class="flex h-6 w-6 transform items-center justify-center rounded-full shadow-md transition-all duration-300"
        :class="appStore.isDark ? 'translate-x-[18px] bg-slate-700' : 'translate-x-0 bg-white'"
      >
        <div
          :class="appStore.isDark ? 'i-carbon-moon text-yellow-300' : 'i-carbon-sun text-amber-500'"
          class="text-xs"
        />
      </div>
    </button>

    <!-- Teleport 模式选择面板（仅当展开时） -->
    <teleport to="body">
      <!-- 遮罩 -->
      <div
        v-if="appStore.showThemePanel"
        class="fixed inset-0 z-[99] bg-black/20 backdrop-blur-sm"
        @click="appStore.toggleThemePanel()"
      />

      <Transition name="panel">
        <div
          v-if="appStore.showThemePanel"
          class="fixed z-[100] w-64 rounded-2xl p-5 shadow-2xl"
          :style="{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'var(--theme-glass)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--theme-border)',
          }"
        >
          <h3
            class="mb-4 text-center text-sm font-bold"
            :style="{ color: 'var(--theme-text)' }"
          >
            选择主题
          </h3>

          <!-- 三种主题模式 -->
          <div class="flex flex-col gap-3">
            <button
              v-for="option in themeOptions"
              :key="option.key"
              class="group relative flex items-center gap-4 rounded-xl p-4 transition-all duration-300"
              :class="{
                'scale-[1.02]': appStore.themePreference === option.key,
              }"
              :style="{
                background: appStore.themePreference === option.key
                  ? 'color-mix(in srgb, ' + optionPrimary(option.key) + ' 12%, transparent)'
                  : 'color-mix(in srgb, var(--theme-text) 4%, transparent)',
                border: '1px solid ' + (appStore.themePreference === option.key ? optionPrimary(option.key) : 'var(--theme-border)'),
              }"
              @click="appStore.applyPreference(option.key); appStore.toggleThemePanel()"
            >
              <div
                class="flex h-12 w-12 flex-none items-center justify-center rounded-2xl"
                :style="{ background: optionGradient(option.key) }"
              >
                <div :class="option.icon" class="text-lg text-white" />
              </div>

              <div class="flex flex-col items-start text-left">
                <span
                  class="text-sm font-bold"
                  :style="{ color: 'var(--theme-text)' }"
                >
                  {{ option.name }}
                </span>
                <span
                  class="text-xs opacity-60"
                  :style="{ color: 'var(--theme-text)' }"
                >
                  {{ option.description }}
                </span>
              </div>

              <div
                v-if="appStore.themePreference === option.key"
                class="ml-auto flex h-6 w-6 items-center justify-center rounded-full"
                :style="{ background: optionPrimary(option.key) }"
              >
                <div class="i-carbon-checkmark text-xs text-white" />
              </div>
            </button>
          </div>

          <div class="mt-4 border-t pt-3 text-center" :style="{ borderColor: 'var(--theme-border)' }">
            <button
              class="text-xs opacity-60 transition-opacity hover:opacity-100"
              :style="{ color: 'var(--theme-text)' }"
              @click="appStore.toggleThemePanel()"
            >
              关闭
            </button>
          </div>
        </div>
      </Transition>
    </teleport>
  </div>
</template>

<style scoped>
.panel-enter-active {
  animation: panel-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-leave-active {
  animation: panel-out 0.2s ease-in;
}
@keyframes panel-in {
  0% { opacity: 0; transform: translate(-50%, -48%) scale(0.92); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes panel-out {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -48%) scale(0.92); }
}
</style>
