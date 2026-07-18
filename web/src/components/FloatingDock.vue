<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menuRoutes } from '@/router/menu'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 一级导航：概览 / 个人 / 好友 / 活动
const primaryNames = ['dashboard', 'personal', 'friends', 'activity']
const primaryItems = computed(() => {
  return menuRoutes.filter(item => primaryNames.includes(item.name))
})

// 二级导航（更多面板）：显式声明的 + 兜底（不在一级里的全部自动归入二级）
const secondaryItems = computed(() => {
  return menuRoutes.filter(item => {
    // 一级已显示的不再重复
    if (primaryNames.includes(item.name)) return false
    // adminOnly 对非管理员隐藏
    if (item.adminOnly && !userStore.isAdmin) return false
    return true
  })
})

// 当前激活的菜单项是否在"更多"面板里
const activeInSecondary = computed(() => {
  return secondaryItems.value.some(item =>
    item.path === '' ? route.path === '/' : route.path.startsWith(`/${item.path}`),
  )
})

const showMorePanel = ref(false)

function isActive(path: string): boolean {
  if (path === '')
    return route.path === '/' || route.path === ''
  return route.path.startsWith(`/${path}`)
}

function goTo(path: string) {
  router.push(path === '' ? '/' : `/${path}`)
  showMorePanel.value = false
}

function toggleMorePanel() {
  showMorePanel.value = !showMorePanel.value
}

function closeMorePanel() {
  showMorePanel.value = false
}
</script>

<template>
  <!-- 底部悬浮导航 Dock（鸿蒙式沉浸光感） -->
  <div class="floating-dock-wrapper">
    <!-- 背景光晕层（沉浸光感） -->
    <div class="dock-glow" />

    <!-- "更多"二级面板 -->
    <Transition name="more-panel">
      <div v-if="showMorePanel" class="more-panel">
        <div class="more-panel-header">
          <span class="more-panel-title">更多功能</span>
          <button class="more-panel-close" @click="closeMorePanel">
            <span class="i-carbon-close" />
          </button>
        </div>
        <div class="more-panel-grid">
          <button
            v-for="item in secondaryItems"
            :key="item.path"
            class="more-panel-item"
            :class="{ 'more-panel-item--active': isActive(item.path) }"
            @click="goTo(item.path)"
          >
            <span class="more-panel-item-icon" :class="item.icon" />
            <span class="more-panel-item-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- 点击遮罩关闭更多面板 -->
    <Transition name="more-overlay">
      <div v-if="showMorePanel" class="more-overlay" @click="closeMorePanel" />
    </Transition>

    <!-- 主 Dock 容器 -->
    <nav class="floating-dock" role="navigation" aria-label="主导航">
      <router-link
        v-for="item in primaryItems"
        :key="item.path"
        :to="item.path === '' ? '/' : `/${item.path}`"
        class="dock-item"
        :class="{ 'dock-item--active': isActive(item.path) }"
        :title="item.label"
        @click="closeMorePanel"
      >
        <span class="dock-item-glow" />
        <span class="dock-item-icon" :class="item.icon" />
        <span class="dock-item-label">{{ item.label }}</span>
      </router-link>

      <!-- 更多按钮 -->
      <button
        class="dock-item"
        :class="{ 'dock-item--active': showMorePanel || activeInSecondary }"
        title="更多"
        @click="toggleMorePanel"
      >
        <span class="dock-item-glow" />
        <span class="dock-item-icon i-carbon-overflow-menu-horizontal" />
        <span class="dock-item-label">更多</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.floating-dock-wrapper {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0 env(safe-area-inset-bottom, 0);
  pointer-events: none;
}

/* 背景光晕：鸿蒙式柔和发光 */
.dock-glow {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 140px;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--theme-primary) 12%, transparent) 0%,
    color-mix(in srgb, var(--theme-primary) 4%, transparent) 40%,
    transparent 100%
  );
  pointer-events: none;
  -webkit-mask-image: linear-gradient(to top, black 0%, transparent 100%);
  mask-image: linear-gradient(to top, black 0%, transparent 100%);
}

/* 主 Dock：毛玻璃 pill 形 */
.floating-dock {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0 12px 14px 12px;
  padding: 6px 8px;
  max-width: calc(100vw - 24px);
  border-radius: 22px;
  background: color-mix(in srgb, var(--surface-1, #fff) 72%, transparent);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid color-mix(in srgb, var(--theme-primary) 15%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--theme-primary) 6%, transparent),
    0 8px 32px -4px color-mix(in srgb, var(--theme-primary) 18%, transparent),
    0 4px 16px -2px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
  animation: dock-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes dock-rise {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 单个导航项 */
.dock-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 14px;
  min-width: 60px;
  border-radius: 16px;
  color: var(--theme-text);
  opacity: 0.65;
  text-decoration: none;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.dock-item:hover {
  opacity: 1;
  transform: translateY(-3px);
}

.dock-item:active {
  transform: translateY(-1px) scale(0.96);
  transition-duration: 0.1s;
}

.dock-item--active {
  opacity: 1;
}

.dock-item-glow {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--theme-primary) 22%, transparent),
    color-mix(in srgb, var(--theme-primary) 8%, transparent)
  );
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.dock-item--active .dock-item-glow {
  opacity: 1;
  box-shadow:
    inset 0 0 12px color-mix(in srgb, var(--theme-primary) 20%, transparent),
    0 0 10px color-mix(in srgb, var(--theme-primary) 25%, transparent);
}

.dock-item--active::after {
  content: '';
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--theme-primary);
  box-shadow: 0 0 6px var(--theme-primary);
}

.dock-item-icon {
  font-size: 22px;
  line-height: 1;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  z-index: 1;
}

.dock-item--active .dock-item-icon {
  transform: scale(1.1);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--theme-primary) 50%, transparent));
}

.dock-item:hover .dock-item-icon {
  transform: scale(1.15);
}

.dock-item-label {
  font-size: 10px;
  line-height: 1.2;
  font-weight: 500;
  white-space: nowrap;
  position: relative;
  z-index: 1;
}

/* ===== "更多"二级面板 ===== */
.more-overlay {
  position: fixed;
  inset: 0;
  z-index: 39;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  pointer-events: auto;
}

.more-panel {
  pointer-events: auto;
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 32px));
  padding: 16px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--surface-1, #fff) 80%, transparent);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid color-mix(in srgb, var(--theme-primary) 15%, transparent);
  box-shadow:
    0 12px 40px -8px color-mix(in srgb, var(--theme-primary) 20%, transparent),
    0 4px 16px -2px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
  z-index: 41;
}

.more-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.more-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text);
  opacity: 0.8;
}

.more-panel-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--theme-text);
  opacity: 0.5;
  cursor: pointer;
  font-size: 16px;
  transition: opacity 0.2s, background 0.2s;
}

.more-panel-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--theme-text) 8%, transparent);
}

.more-panel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.more-panel-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-text);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.more-panel-item:hover {
  background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--theme-primary) 20%, transparent);
  transform: translateY(-2px);
}

.more-panel-item--active {
  background: color-mix(in srgb, var(--theme-primary) 15%, transparent);
  border-color: color-mix(in srgb, var(--theme-primary) 30%, transparent);
  box-shadow: inset 0 0 12px color-mix(in srgb, var(--theme-primary) 12%, transparent);
}

.more-panel-item-icon {
  font-size: 26px;
  line-height: 1;
  transition: transform 0.25s ease;
}

.more-panel-item:hover .more-panel-item-icon {
  transform: scale(1.1);
}

.more-panel-item--active .more-panel-item-icon {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--theme-primary) 50%, transparent));
}

.more-panel-item-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

/* ===== 动画 ===== */
.more-panel-enter-active,
.more-panel-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.more-panel-enter-from,
.more-panel-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px) scale(0.95);
}

.more-overlay-enter-active,
.more-overlay-leave-active {
  transition: opacity 0.3s ease;
}

.more-overlay-enter-from,
.more-overlay-leave-to {
  opacity: 0;
}

/* ===== 移动端 ===== */
@media (max-width: 640px) {
  .floating-dock {
    gap: 0;
    padding: 5px 6px;
    margin: 0 8px 10px 8px;
    border-radius: 18px;
  }

  .dock-item {
    min-width: 52px;
    padding: 7px 10px;
  }

  .dock-item-icon {
    font-size: 24px;
  }

  .more-panel {
    width: calc(100vw - 24px);
    padding: 14px;
  }

  .more-panel-grid {
    gap: 6px;
  }

  .more-panel-item {
    padding: 12px 6px;
  }
}

/* ===== 暗色模式 ===== */
@media (prefers-color-scheme: dark) {
  .floating-dock {
    background: color-mix(in srgb, var(--surface-1, #1f2937) 78%, transparent);
    border-color: color-mix(in srgb, var(--theme-primary) 20%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--theme-primary) 8%, transparent),
      0 8px 32px -4px color-mix(in srgb, var(--theme-primary) 22%, transparent),
      0 4px 16px -2px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
  }

  .dock-item-glow,
  .more-panel-item--active {
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--theme-primary) 28%, transparent),
      color-mix(in srgb, var(--theme-primary) 10%, transparent)
    );
  }

  .more-panel {
    background: color-mix(in srgb, var(--surface-1, #1f2937) 85%, transparent);
    box-shadow:
      0 12px 40px -8px color-mix(in srgb, var(--theme-primary) 22%, transparent),
      0 4px 16px -2px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .floating-dock,
  .dock-item,
  .dock-item-icon,
  .dock-item-glow,
  .more-panel,
  .more-panel-item {
    animation: none !important;
    transition: opacity 0.15s ease !important;
  }
}
</style>
