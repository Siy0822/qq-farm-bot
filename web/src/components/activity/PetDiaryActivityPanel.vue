<script setup lang="ts">
import api from '@/api'
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const toast = useToastStore()

const state = ref<any>(null)
const records = ref<any[]>([])
const logKind = ref<'interact' | 'plunder'>('interact')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const exchangeCount = ref(1)
const friendGid = ref('')
const friendInfo = ref<any>(null)
const battleChallenge = ref('80101')
const battleTreasureId = ref('')
const skipBattle = ref(false)

const accountId = computed(() => accountStore.currentAccountId)
const active = computed(() => state.value?.active === true)
const nurture = computed(() => state.value?.nurture || null)
const hunt = computed(() => state.value?.hunt || null)
const charms = computed(() => state.value?.charms || null)
const treasures = computed<any[]>(() => state.value?.treasures || [])
const shop = computed<any[]>(() => state.value?.shop || [])
const stories = computed<any[]>(() => state.value?.stories || [])
const seeds = computed(() => state.value?.seeds || null)
const solarTerms = computed<any[]>(() => state.value?.solarTerms?.terms || [])
const warnings = computed<string[]>(() => state.value?.warnings || [])

const itemText = (item: any) => `${item?.name || `物品${item?.id}`} ×${item?.count ?? 0}`
const rewardText = (list: any[]) => (list || []).map(itemText).join('、')

function formatTime(ms: number) {
  if (!ms)
    return '—'
  const d = new Date(ms)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

let seq = 0

async function load() {
  if (!accountId.value)
    return
  const v = ++seq
  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/api/activity/pet-diary')
    if (v !== seq)
      return
    if (res.data?.ok === false)
      throw new Error(res.data?.error || '加载萌宠日记失败')
    state.value = res.data?.activity || null
    skipBattle.value = state.value?.skipBattle === true
  }
  catch (e: any) {
    if (v !== seq)
      return
    error.value = e?.response?.data?.error || e?.message || '加载萌宠日记失败'
  }
  finally {
    if (v === seq)
      loading.value = false
  }
}

async function operate(action: string, params: any = {}, label = '') {
  if (!accountId.value || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const res = await api.post('/api/activity/pet-diary/operate', { action, params })
    if (res.data?.ok === false)
      throw new Error(res.data?.error || res.data?.message || `${label || action}失败`)
    const data = res.data || {}
    if (data.snapshot)
      state.value = data.snapshot
    const rewards = rewardText(data.rewards)
    const msg = rewards ? `${data.message || '操作成功'}：${rewards}` : (data.message || '操作成功')
    if (data.refreshError)
      toast.warning(`${msg}。${data.refreshError}`)
    else
      toast.success(msg)
    if (!data.snapshot)
      await load()
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || `${label || action}失败`
  }
  finally {
    busy.value = false
  }
}

async function loadRecords() {
  if (!accountId.value || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const res = await api.get('/api/activity/pet-diary/records', { params: { kind: logKind.value } })
    if (res.data?.ok === false)
      throw new Error(res.data?.error || '获取记录失败')
    records.value = res.data?.records || []
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '获取记录失败'
  }
  finally {
    busy.value = false
  }
}

async function loadFriend() {
  const gid = String(friendGid.value || '').trim()
  if (!gid || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const res = await api.get('/api/activity/pet-diary/friend', { params: { gid } })
    if (res.data?.ok === false)
      throw new Error(res.data?.error || '获取好友信息失败')
    friendInfo.value = res.data?.friend || null
    const first = (friendInfo.value?.treasures || []).find((t: any) => t.status === 2)
    battleTreasureId.value = first ? String(first.id) : ''
  }
  catch (e: any) {
    error.value = e?.response?.data?.error || e?.message || '获取好友信息失败'
    friendInfo.value = null
  }
  finally {
    busy.value = false
  }
}

function doFeed() {
  operate('feed', {}, '投喂')
}

function doDraw() {
  operate('draw', {}, '寻宝')
}

function doClaimDog() {
  operate('claimDog', {}, '领取比熊')
}

function doInitialize() {
  operate('initialize', {}, '领养比熊')
}

function doClaimSeeds() {
  operate('seeds', {}, '领取种子礼包')
}

function doStory(order: number) {
  operate('story', { order }, '领取手记')
}

function doRefreshCharm() {
  const c = charms.value
  if (!c)
    return
  if (c.freeRefreshRemaining > 0)
    operate('refreshCharm', { payment: 'free' }, '刷新锦囊')
  else
    operate('refreshCharm', { payment: 'tickets', expectedPaidRefreshCount: c.paidRefreshCount }, '付费刷新锦囊')
}

function doEquipCharm(charmId: number) {
  operate('equipCharm', { charmId }, '装备锦囊')
}

function doOpenTreasure() {
  operate('openTreasure', {}, '开启宝藏')
}

function doCompensation() {
  operate('compensation', {}, '领取补偿')
}

function doExchange(goods: any) {
  const count = Math.max(1, Number(exchangeCount.value) || 1)
  if (count > 1 && !window.confirm(`确认为「${goods.name}」兑换 ${count} 份？`))
    return
  operate('exchange', { goodsId: goods.id, count }, '兑换')
}

function doBattle() {
  const gid = String(friendGid.value || '').trim()
  if (!gid || !battleTreasureId.value)
    return
  operate('battle', {
    gid,
    treasureId: battleTreasureId.value,
    challengeId: battleChallenge.value,
  }, '夺宝')
}

function doSkipBattle(next: boolean) {
  operate('skipBattle', { skip: next }, '跳过动画设置')
}

function doMarkStories() {
  const orders = stories.value.filter(s => s.unlocked && !s.animated).map(s => s.order)
  if (!orders.length) {
    toast.error('没有可标记的手记')
    return
  }
  operate('markStories', { orders }, '标记手记')
}

function doSolar(term: any) {
  operate('solar', { termId: String(term.id) }, '领取节令')
}

watch([accountId], () => {
  seq++
  state.value = null
  records.value = []
  friendInfo.value = null
  void load()
}, { immediate: true })

watch(logKind, () => { void loadRecords() })

onMounted(() => { if (accountId.value) void load() })
</script>

<template>
  <div class="space-y-4">
    <section class="overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-500 to-emerald-600 p-5 text-white shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-2 text-3xl">🐶</div>
          <h2 class="text-2xl font-bold">萌宠成长日记</h2>
          <p class="mt-2 text-xs font-semibold text-white/85">
            {{ formatTime(state?.startTime) }} — {{ formatTime(state?.endTime) }}
          </p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="active ? 'bg-white/20' : 'bg-black/25'">
          {{ active ? '活动进行中' : '未开始或已结束' }}
        </span>
      </div>
    </section>

    <div v-if="error" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm dark:bg-red-900/20 dark:text-red-300">
      {{ error }}
    </div>

    <div v-if="loading" class="rounded-lg glass-subtle p-6 text-center text-sm">正在加载…</div>

    <template v-else-if="state">
      <div v-if="warnings.length" class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
        <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
      </div>

      <!-- 养成 -->
      <section class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">比熊养成</h3>
          <span class="text-sm">
            {{ nurture?.adult ? '已成年' : `成长 ${nurture?.growth ?? 0}/${nurture?.adultGrowth ?? 0}` }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="!nurture?.initialized"
            class="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !active"
            @click="doInitialize"
          >
            领养比熊
          </button>
          <button
            v-if="nurture?.adult && !nurture?.dogGranted"
            class="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !active"
            @click="doClaimDog"
          >
            领取永久比熊
          </button>
          <button
            class="rounded bg-cyan-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !nurture?.canFeed"
            @click="doFeed"
          >
            投喂（{{ nurture?.feedCount ?? 0 }}/{{ nurture?.feedLimit ?? 0 }}）
          </button>
        </div>
        <div v-if="nurture?.feedCosts?.length" class="mt-2 text-xs opacity-70">
          投喂消耗：{{ rewardText(nurture.feedCosts) }}
        </div>
      </section>

      <!-- 宝藏护送 -->
      <section class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">宝藏护送</h3>
          <span class="text-sm">
            今日寻宝 {{ hunt?.count ?? 0 }}/{{ hunt?.limit ?? 0 }} · 夺宝 {{ state.battleCount ?? 0 }}/{{ state.battleLimit ?? 0 }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            class="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !hunt?.canDraw"
            @click="doDraw"
          >
            寻宝
          </button>
          <button
            class="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !treasures.some(t => t.status === 3 || (t.status === 2 && t.endTime > 0 && t.endTime <= (state.serverTime / 1000)))"
            @click="doOpenTreasure"
          >
            开启已完成宝藏
          </button>
          <button
            v-if="Number(state.compensationCount || 0) > 0"
            class="rounded bg-rose-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy"
            @click="doCompensation"
          >
            领取夺宝补偿（{{ state.compensationCount }}）
          </button>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="skipBattle" type="checkbox" :disabled="busy" @change="doSkipBattle(skipBattle)">
            跳过战斗动画
          </label>
        </div>
        <div v-if="hunt?.costs?.length" class="mt-2 text-xs opacity-70">寻宝消耗：{{ rewardText(hunt.costs) }}</div>

        <div v-if="treasures.length" class="mt-3 space-y-2">
          <div v-for="t in treasures" :key="t.id" class="rounded border border-gray-200/70 p-3 text-sm dark:border-gray-700/70">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span>{{ itemText(t.item) }}</span>
              <span class="text-xs opacity-70">
                {{ t.status === 3 ? '已完成' : (t.status === 2 ? '护送中' : '状态 ' + t.status) }}
              </span>
            </div>
            <div class="mt-1 text-xs opacity-70">
              保护 {{ t.protectedCount }} · 原有 {{ t.originalCount }} · 上限 {{ t.maxCount }}
            </div>
          </div>
        </div>
      </section>

      <!-- 锦囊 -->
      <section v-if="charms" class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">锦囊</h3>
          <span class="text-xs opacity-70">
            免费刷新 {{ charms.freeRefreshRemaining }}/{{ charms.freeRefreshLimit }} · 付费 {{ charms.paidRefreshCount }}/{{ charms.paidRefreshLimit }}
          </span>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            class="rounded px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :class="charms.freeRefreshRemaining > 0 ? 'bg-emerald-600' : 'bg-amber-600'"
            :disabled="busy || !charms.canRefresh"
            @click="doRefreshCharm"
          >
            {{ charms.freeRefreshRemaining > 0 ? '免费刷新' : `付费刷新（${charms.refreshCost?.count ?? 0} 点券）` }}
          </button>
          <span v-if="charms.refreshBalance !== null" class="text-xs opacity-70">点券余额 {{ charms.refreshBalance }}</span>
        </div>
        <p class="mt-2 text-xs opacity-70">{{ charms.refreshNote }}</p>

        <div v-if="charms.canChoose && charms.pool.length" class="mt-3">
          <div class="text-sm font-medium">选择锦囊</div>
          <div class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="c in charms.pool" :key="c.id" class="rounded border border-gray-200/70 p-3 text-sm dark:border-gray-700/70">
              <div class="font-medium">{{ c.name }}</div>
              <div class="mt-1 text-xs opacity-70">{{ c.shortDescription }}</div>
              <button class="mt-2 rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-50" :disabled="busy" @click="doEquipCharm(c.id)">
                选择
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="charms.equipped.length" class="mt-3 text-sm">
          已装备：{{ charms.equipped.map((c: any) => c.name).join('、') }}
        </div>
      </section>

      <!-- 手记 -->
      <section v-if="stories.length" class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">爪印手记</h3>
          <button class="rounded bg-gray-200 px-2 py-1 text-xs dark:bg-gray-700" :disabled="busy" @click="doMarkStories">
            标记已看动图
          </button>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="s in stories"
            :key="s.order"
            class="overflow-hidden rounded border p-3 text-sm"
            :class="s.claimed ? 'border-emerald-400 opacity-70' : 'border-gray-200/70 dark:border-gray-700/70'"
          >
            <img v-if="s.photo" :src="s.photo" :alt="`手记 ${s.order}`" class="mb-2 h-20 w-full rounded object-cover">
            <div>手记 #{{ s.order }}</div>
            <div class="mt-1 text-xs opacity-60">
              {{ s.claimed ? '已领取' : (s.unlocked ? '可领取' : '未解锁') }}
            </div>
            <button
              v-if="s.unlocked && !s.claimed"
              class="mt-2 rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              :disabled="busy"
              @click="doStory(s.order)"
            >
              领取
            </button>
          </div>
        </div>
      </section>

      <!-- 种子礼包 -->
      <section v-if="seeds" class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">种子礼包</h3>
          <button
            class="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !seeds.canClaim"
            @click="doClaimSeeds"
          >
            一键领取
          </button>
        </div>
        <div v-if="seeds.days?.length" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="d in seeds.days" :key="d.day" class="rounded border p-3 text-sm" :class="d.claimed ? 'border-emerald-400 opacity-70' : 'border-gray-200/70 dark:border-gray-700/70'">
            <div class="opacity-70">第 {{ d.day }} 天</div>
            <div class="mt-1">{{ rewardText(d.rewards) || '—' }}</div>
          </div>
        </div>
      </section>

      <!-- 拾物小铺 -->
      <section v-if="shop.length" class="rounded-xl glass-subtle p-4">
        <h3 class="font-semibold">拾物小铺</h3>
        <p class="mt-1 text-xs opacity-70">可能消耗钻石的商品已被后端拦截，不会下单。</p>
        <div class="mt-3 space-y-2">
          <div v-for="g in shop" :key="g.id" class="flex flex-wrap items-center gap-3 rounded border border-gray-200/70 p-3 text-sm dark:border-gray-700/70">
            <img v-if="g.image" :src="g.image" :alt="g.name" class="h-10 w-10 rounded object-contain">
            <div class="min-w-0 flex-1">
              <div class="font-medium">{{ g.name }}</div>
              <div class="mt-1 text-xs opacity-70">
                换取：{{ rewardText(g.costs) || '—' }} ｜ 获得：{{ rewardText(g.rewards) || '—' }}
                <span v-if="g.remaining !== null"> ｜ 剩余 {{ g.remaining }}</span>
              </div>
            </div>
            <button
              class="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !g.exchangeable"
              @click="doExchange(g)"
            >
              兑换
            </button>
          </div>
        </div>
      </section>

      <!-- 节令 -->
      <section v-if="solarTerms.length" class="rounded-xl glass-subtle p-4">
        <h3 class="font-semibold">节令好礼</h3>
        <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="t in solarTerms" :key="t.id" class="rounded border p-3 text-sm" :class="t.claimable ? 'border-emerald-400' : 'border-gray-200/70 dark:border-gray-700/70'">
            <div class="font-medium">{{ t.title || `节令 ${t.id}` }}</div>
            <div class="mt-1 text-xs opacity-70">{{ t.statusLabel }}</div>
            <button
              v-if="t.claimable"
              class="mt-2 rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-50"
              :disabled="busy"
              @click="doSolar(t)"
            >
              领取
            </button>
          </div>
        </div>
      </section>

      <!-- 夺宝 -->
      <section class="rounded-xl glass-subtle p-4">
        <h3 class="font-semibold">好友夺宝</h3>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <label class="text-sm">
            好友 GID
            <input v-model="friendGid" class="ml-2 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800" placeholder="输入好友 GID">
          </label>
          <button class="rounded bg-gray-200 px-3 py-1.5 text-sm dark:bg-gray-700" :disabled="busy || !friendGid" @click="loadFriend">
            查询
          </button>
        </div>
        <div v-if="friendInfo" class="mt-3 space-y-2">
          <div v-for="t in friendInfo.treasures" :key="t.id" class="rounded border border-gray-200/70 p-3 text-sm dark:border-gray-700/70">
            <div>{{ itemText(t.item) }} — {{ t.status === 2 ? '可夺宝' : '状态 ' + t.status }}</div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <select v-model="battleTreasureId" class="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800">
                <option :value="String(t.id)">{{ String(t.id) }}</option>
              </select>
              <select v-model="battleChallenge" class="rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800">
                <option value="80101">挑战书 80101</option>
                <option value="80102">挑战书 80102</option>
                <option value="80103">挑战书 80103</option>
              </select>
              <button
                class="rounded bg-rose-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                :disabled="busy || !hunt?.canPlunder || t.status !== 2"
                @click="doBattle"
              >
                夺宝
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 记录 -->
      <section class="rounded-xl glass-subtle p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-semibold">活动记录</h3>
          <div class="flex gap-2">
            <button
              class="rounded px-2 py-1 text-xs"
              :class="logKind === 'interact' ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700'"
              :disabled="busy"
              @click="logKind = 'interact'"
            >
              互动记录
            </button>
            <button
              class="rounded px-2 py-1 text-xs"
              :class="logKind === 'plunder' ? 'bg-sky-600 text-white' : 'bg-gray-200 dark:bg-gray-700'"
              :disabled="busy"
              @click="logKind = 'plunder'"
            >
              被夺记录
            </button>
          </div>
        </div>
        <div v-if="records.length" class="mt-3 space-y-1 text-sm">
          <div v-for="(r, i) in records" :key="i" class="rounded border border-gray-200/70 px-3 py-2 dark:border-gray-700/70">
            <span class="opacity-70">{{ new Date(r.time).toLocaleString() }}</span>
            <span v-if="logKind === 'interact'" class="ml-2">获得 {{ rewardText(r.rewards) || '—' }}</span>
            <span v-else class="ml-2">{{ r.name || r.attackerGid }} {{ r.won ? '夺宝成功' : '夺宝失败' }}</span>
          </div>
        </div>
        <div v-else class="mt-3 text-sm opacity-60">暂无记录（点上方标签加载）</div>
      </section>

      <section v-if="state.rules?.length" class="rounded-xl glass-subtle p-4">
        <h3 class="font-semibold">活动说明</h3>
        <ul class="mt-2 space-y-1 text-sm opacity-80">
          <li v-for="(r, i) in state.rules" :key="i">{{ r }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>
