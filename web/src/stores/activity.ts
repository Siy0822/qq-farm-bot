import { defineStore } from 'pinia'

// 活动中心已下线千星游记/千星同明/雨落成诗/公益小红花/鹊桥寄情（2026-09-27）。
// 现役活动（萌宠日记、秋祈良愿、快乐不独享）面板自带加载逻辑，不经过本 store。
// 原来的 helu / guanxing / qixi 状态与请求方法随面板一并移除；
// 后端 service / 路由 / proto / activity-data 仍保留，活动回归时把对应面板与请求方法移植回 Activity.vue 即可。
export const useActivityStore = defineStore('activity', () => {
  // 切换账号时清一次，避免下次挂载读到上一个账号的残留状态
  function clearActivityData() {
    // 现役面板均为本地状态，无需清理；保留此入口给后续回归的活动复用
  }

  return {
    clearActivityData,
  }
})
