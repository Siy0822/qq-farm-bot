import type { Account } from '@/stores/account'
import { computed, ref } from 'vue'
import api from '@/api'
import { useToastStore } from '@/stores/toast'

export function useAdminAccounts() {
  const toast = useToastStore()

  const accounts = ref<Account[]>([])
  const accountsLoading = ref(false)
  const accountSearchQuery = ref('')
  const showDeleteConfirm = ref(false)
  const pendingDelete = ref<Account | null>(null)
  const deleteLoading = ref(false)
  const showRemarkModal = ref(false)
  const pendingRemark = ref<Account | null>(null)
  const remarkValue = ref('')
  const remarkLoading = ref(false)

  const filteredAccounts = computed(() => {
    const query = accountSearchQuery.value.trim().toLowerCase()
    if (!query)
      return accounts.value

    return accounts.value.filter(account => {
      const haystack = [
        account.name,
        account.nick,
        account.username,
        account.uin,
        account.qq,
        account.wxid,
        account.platform,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  })

  const runningCount = computed(() =>
    accounts.value.filter(account => account.running).length,
  )
  const wxCount = computed(() =>
    accounts.value.filter(account => account.platform === 'wx').length,
  )
  const qqCount = computed(() =>
    accounts.value.filter(account => account.platform === 'qq').length,
  )

  async function fetchAccounts() {
    accountsLoading.value = true
    try {
      const res = await api.get('/api/admin/all-accounts')
      if (res.data.ok) {
        accounts.value = Array.isArray(res.data.data?.accounts)
          ? res.data.data.accounts
          : []
      }
      else {
        toast.error(res.data.error || '获取账号列表失败')
      }
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '获取账号列表失败')
    }
    finally {
      accountsLoading.value = false
    }
  }

  async function toggleAccountRun(account: Account) {
    try {
      if (account.running) {
        await api.post(`/api/accounts/${account.id}/stop`)
        toast.success(`已停止 ${account.name || account.id}`)
      }
      else {
        await api.post(`/api/accounts/${account.id}/start`)
        toast.success(`已启动 ${account.name || account.id}`)
      }
      await fetchAccounts()
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '操作失败')
    }
  }

  function requestDelete(account: Account) {
    pendingDelete.value = account
    showDeleteConfirm.value = true
  }

  async function confirmDelete() {
    if (!pendingDelete.value)
      return

    deleteLoading.value = true
    try {
      const res = await api.delete(`/api/accounts/${pendingDelete.value.id}`)
      if (res.data.ok) {
        toast.success('账号删除成功')
        showDeleteConfirm.value = false
        pendingDelete.value = null
        await fetchAccounts()
      }
      else {
        toast.error(res.data.error || '删除账号失败')
      }
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '删除账号失败')
    }
    finally {
      deleteLoading.value = false
    }
  }

  function openRemarkModal(account: Account) {
    pendingRemark.value = account
    remarkValue.value = account.name || ''
    showRemarkModal.value = true
  }

  async function confirmRemark() {
    if (!pendingRemark.value)
      return

    remarkLoading.value = true
    try {
      const res = await api.post('/api/accounts', {
        id: pendingRemark.value.id,
        name: remarkValue.value.trim(),
      })
      if (res.data.ok) {
        toast.success('备注已更新')
        showRemarkModal.value = false
        pendingRemark.value = null
        await fetchAccounts()
      }
      else {
        toast.error(res.data.error || '保存备注失败')
      }
    }
    catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || '保存备注失败')
    }
    finally {
      remarkLoading.value = false
    }
  }

  return {
    accounts,
    accountsLoading,
    accountSearchQuery,
    filteredAccounts,
    runningCount,
    wxCount,
    qqCount,
    showDeleteConfirm,
    pendingDelete,
    deleteLoading,
    showRemarkModal,
    pendingRemark,
    remarkValue,
    remarkLoading,
    fetchAccounts,
    toggleAccountRun,
    requestDelete,
    confirmDelete,
    openRemarkModal,
    confirmRemark,
  }
}
