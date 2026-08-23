import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import api from '@/api'

const THEME_KEY = 'ui_theme'

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

export interface LoginPageConfig {
  logoUrl: string
  title: string
  loginSubtitle: string
  registerSubtitle: string
  purchaseUrl: string
  qqGroupUrl: string
}

const defaultLoginPageConfig: LoginPageConfig = {
  logoUrl: '',
  title: 'QQ农场智能助手',
  loginSubtitle: '欢迎回来，开启智慧农耕之旅',
  registerSubtitle: '创建账号，开启智慧农耕之旅',
  purchaseUrl: '',
  qqGroupUrl: '',
}

export interface ThemeConfig {
  name: string
  isDark: boolean
  bg: string
  text: string
  primary: string
  secondary: string
  accent: string
  gradient: string
  glass: string
  border: string
  icon: string
}

export const useAppStore = defineStore('app', () => {
  const savedPreference = localStorage.getItem(THEME_KEY) as ThemePreference | null
  // 未存过偏好时默认跟随系统。以前硬编码回退 'light'，导致 iPhone Safari
  // 等「没有本地记录」的设备即使系统开了深色模式也强制显示白底。
  const themePreference = ref<ThemePreference>(savedPreference === 'system' || savedPreference === 'dark' || savedPreference === 'light' ? savedPreference : 'system')
  const currentTheme = ref<Theme>(themePreference.value === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : themePreference.value)
  const showThemePanel = ref(false)
  const loginPageConfig = ref<LoginPageConfig>({ ...defaultLoginPageConfig })
  let loginPageConfigPromise: Promise<void> | null = null

  const themes: Record<Theme, ThemeConfig> = {
    light: {
      name: '晨光',
      isDark: false,
      bg: '#f6f8f3',
      text: '#1c2e1c',
      primary: '#22a65e',
      secondary: '#4ade80',
      accent: '#d97706',
      gradient: 'linear-gradient(135deg, #22a65e 0%, #d97706 100%)',
      glass: 'rgba(255,255,255,0.4)',
      border: 'rgba(34,166,94,0.12)',
      icon: 'i-carbon-sun',
    },
    dark: {
      name: '夜幕',
      isDark: true,
      bg: '#0e1218',
      text: '#e2e8f0',
      primary: '#4ade80',
      secondary: '#22c55e',
      accent: '#fbbf24',
      gradient: 'linear-gradient(135deg, #4ade80 0%, #fbbf24 100%)',
      glass: 'rgba(14,18,24,0.5)',
      border: 'rgba(74,222,128,0.15)',
      icon: 'i-carbon-moon',
    },
  }

  async function fetchTheme() {
    if (themePreference.value === 'system') {
      applySystemTheme()
      return
    }

    const savedTheme = localStorage.getItem(THEME_KEY) as ThemePreference | null
    if (savedTheme === 'system') {
      applySystemTheme()
      return
    }
    if (savedTheme && themes[savedTheme]) {
      applyTheme(savedTheme)
      return
    }

    try {
      const res = await api.get('/api/settings')
      const theme = res.data?.data?.ui?.theme as Theme | undefined
      if (res.data.ok && theme && themes[theme])
        applyTheme(theme)
    }
    catch {
      // 未登录时静默失败，使用默认主题。
    }
  }

  async function fetchLoginPageConfig() {
    if (loginPageConfigPromise)
      return loginPageConfigPromise

    loginPageConfigPromise = api.get('/api/public/login-links').then((res) => {
      if (res.data?.ok && res.data.data) {
        loginPageConfig.value = { ...defaultLoginPageConfig, ...res.data.data }
        document.title = loginPageConfig.value.title || defaultLoginPageConfig.title
      }
    }).catch(() => {
      // 保留默认品牌，页面仍可正常使用。
    }).finally(() => {
      loginPageConfigPromise = null
    })
    return loginPageConfigPromise
  }

  function getSystemTheme(): Theme {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function applyTheme(theme: Theme, persist = true) {
    if (!themes[theme]) {
      theme = 'light'
    }

    const t = themes[theme]
    currentTheme.value = theme
    if (persist) {
      themePreference.value = theme
      localStorage.setItem(THEME_KEY, theme)
    }

    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--theme-bg', t.bg)
      document.documentElement.style.setProperty('--theme-text', t.text)
      document.documentElement.style.setProperty('--theme-primary', t.primary)
      document.documentElement.style.setProperty('--theme-secondary', t.secondary)
      document.documentElement.style.setProperty('--theme-accent', t.accent)
      document.documentElement.style.setProperty('--theme-gradient', t.gradient)
      document.documentElement.style.setProperty('--theme-glass', t.glass)
      document.documentElement.style.setProperty('--theme-border', t.border)

      if (t.isDark) {
        document.documentElement.classList.add('dark')
      }
      else {
        document.documentElement.classList.remove('dark')
      }
    }
  }

  function toggleThemePanel() {
    showThemePanel.value = !showThemePanel.value
  }

  function applyPreference(preference: ThemePreference) {
    themePreference.value = preference
    localStorage.setItem(THEME_KEY, preference)
    applyTheme(preference === 'system' ? getSystemTheme() : preference, false)
  }

  function applySystemTheme() {
    if (themePreference.value === 'system')
      applyTheme(getSystemTheme(), false)
  }

  function toggleDark() {
    applyPreference(currentTheme.value === 'dark' ? 'light' : 'dark')
  }

  const isDark = computed(() => themes[currentTheme.value]?.isDark ?? false)

  let systemThemeMedia: MediaQueryList | null = null
  if (typeof window !== 'undefined') {
    systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeMedia.addEventListener('change', applySystemTheme)
  }

  watch(currentTheme, (val) => {
    applyTheme(val, false)
  })

  applyTheme(currentTheme.value, false)

  return {
    isDark,
    currentTheme,
    themePreference,
    showThemePanel,
    loginPageConfig,
    themes,
    applyTheme,
    applyPreference,
    applySystemTheme,
    toggleThemePanel,
    toggleDark,
    fetchTheme,
    fetchLoginPageConfig,
  }
})
