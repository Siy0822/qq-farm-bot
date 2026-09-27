// 活动中心页签类型（已下线活动：千星游记/观星礼录/节令小札、雨落成诗、公益小红花、鹊桥寄情）
export type ActivitySectionKey = 'petDiary' | 'autumnWish' | 'autumnHappy'

export interface ActivitySection {
  key: ActivitySectionKey
  label: string
  icon: string
  count?: number
}

export interface ActivityLabels {
  title: string
  currentAccount: string
  none: string
  needAccount: string
  refresh: string
}
