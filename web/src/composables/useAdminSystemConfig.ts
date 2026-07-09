import { ref } from 'vue'
import api from '@/api'

export interface SystemConfig {
  serverUrl: string
  clientVersion: string
  platform: string
  os: string
}

export interface WxConfig {
  enabled: boolean
  apiBase: string
  apiKey: string
  proxyApiUrl: string
  appId: string
  autoAddAccount: boolean
  userIsolation: boolean
}

interface UseAdminSystemConfigOptions {
  showAlert: (message: string, type?: 'primary' | 'danger') => void
}

const defaultSystemConfigValues: SystemConfig = {
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  clientVersion: '1.12.3.20_20260709',
  platform: 'qq',
  os: 'iOS',
}

const defaultWxConfig: WxConfig = {
  enabled: true,
  apiBase: 'https://code.z74d.top/api',
  apiKey: '',
  proxyApiUrl: 'https://code.z74d.top/api',
  appId: 'wx5306c5978fdb76e4',
  autoAddAccount: true,
  userIsolation: true,
}

export function useAdminSystemConfig(options: UseAdminSystemConfigOptions) {
  const systemConfigSaving = ref(false)
  const systemConfigLoading = ref(false)
  const wxConfigSaving = ref(false)

  const showResetSystemConfirm = ref(false)
  const showSaveSystemConfirm = ref(false)
  const showResetWxConfigConfirm = ref(false)
  const showSaveWxConfigConfirm = ref(false)

  const localSystemConfig = ref<SystemConfig>({ ...defaultSystemConfigValues })
  const defaultSystemConfig = ref<SystemConfig>({ ...defaultSystemConfigValues })
  const localWxConfig = ref<WxConfig>({ ...defaultWxConfig })

  const platformOptions = [
    { label: 'QQ', value: 'qq' },
    { label: '微信', value: 'wx' },
  ]

  const osOptions = [
    { label: 'iOS', value: 'iOS' },
    { label: 'Android', value: 'Android' },
  ]

  async function loadWxConfig() {
    try {
      const { data } = await api.get('/api/admin/wx-config')
      if (data?.ok && data.data)
        localWxConfig.value = { ...data.data }
    }
    catch (e: any) {
      console.error('加载微信配置失败:', e)
    }
  }

  async function handleSaveWxConfig() {
    showSaveWxConfigConfirm.value = false
    wxConfigSaving.value = true
    try {
      const { data } = await api.post('/api/admin/wx-config', {
        ...localWxConfig.value,
        confirmed: true,
      })
      if (data?.ok)
        options.showAlert('微信配置已保存，全局应用生效', 'primary')
      else
        options.showAlert(data?.error || '保存失败', 'danger')
    }
    catch (e: any) {
      options.showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
    }
    finally {
      wxConfigSaving.value = false
    }
  }

  async function handleResetWxConfig() {
    showResetWxConfigConfirm.value = false
    localWxConfig.value = { ...defaultWxConfig }
    options.showAlert('微信配置已重置为默认值', 'primary')
  }

  function openResetWxConfigConfirm() {
    showResetWxConfigConfirm.value = true
  }

  function openSaveWxConfigConfirm() {
    showSaveWxConfigConfirm.value = true
  }

  async function loadSystemConfig() {
    systemConfigLoading.value = true
    try {
      const { data } = await api.get('/api/admin/system-config')
      if (data?.ok) {
        if (data.data.saved)
          localSystemConfig.value = { ...data.data.saved }
        if (data.data.default)
          defaultSystemConfig.value = { ...data.data.default }
      }
    }
    catch (e: any) {
      console.error('加载系统配置失败:', e)
    }
    finally {
      systemConfigLoading.value = false
    }
  }

  async function handleSaveSystemConfig() {
    showSaveSystemConfirm.value = false
    systemConfigSaving.value = true
    try {
      const { data } = await api.post('/api/admin/system-config', {
        ...localSystemConfig.value,
        confirmed: true,
      })
      if (data?.ok)
        options.showAlert('系统配置已保存并立即生效，无需重启项目', 'primary')
      else
        options.showAlert(data?.error || '保存失败', 'danger')
    }
    catch (e: any) {
      options.showAlert(`保存失败: ${e.message || '未知错误'}`, 'danger')
    }
    finally {
      systemConfigSaving.value = false
    }
  }

  async function handleResetSystemConfig() {
    showResetSystemConfirm.value = false
    systemConfigSaving.value = true
    try {
      const { data } = await api.post('/api/admin/system-config/reset', {
        confirmed: true,
      })
      if (data?.ok) {
        localSystemConfig.value = { ...data.data.saved }
        options.showAlert('系统配置已重置为默认值', 'primary')
      }
      else {
        options.showAlert(data?.error || '重置失败', 'danger')
      }
    }
    catch (e: any) {
      options.showAlert(`重置失败: ${e.message || '未知错误'}`, 'danger')
    }
    finally {
      systemConfigSaving.value = false
    }
  }

  function openResetSystemConfirm() {
    showResetSystemConfirm.value = true
  }

  function openSaveSystemConfirm() {
    showSaveSystemConfirm.value = true
  }

  return {
    systemConfigSaving,
    systemConfigLoading,
    wxConfigSaving,
    showResetSystemConfirm,
    showSaveSystemConfirm,
    showResetWxConfigConfirm,
    showSaveWxConfigConfirm,
    localSystemConfig,
    defaultSystemConfig,
    localWxConfig,
    platformOptions,
    osOptions,
    loadWxConfig,
    handleSaveWxConfig,
    handleResetWxConfig,
    openResetWxConfigConfirm,
    openSaveWxConfigConfirm,
    loadSystemConfig,
    handleSaveSystemConfig,
    handleResetSystemConfig,
    openResetSystemConfirm,
    openSaveSystemConfirm,
  }
}
