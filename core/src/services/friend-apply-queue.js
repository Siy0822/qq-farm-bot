// Per-account serial friend-application queue.  Keep only one ReportArkClick
// in flight per worker connection; bulk requests must not fan out RPCs.
const queues = new Map()

function getQueue(accountId, provider) {
  let q = queues.get(String(accountId))
  if (!q) {
    q = { items: new Map(), order: [], running: false, provider }
    queues.set(String(accountId), q)
  }
  return q
}

async function drain(q, accountId) {
  if (q.running) return
  q.running = true
  try {
    while (true) {
      const item = q.order.map(gid => q.items.get(gid)).find(it => it && it.status === 'pending')
      if (!item) break
      item.status = 'sending'
      item.error = ''
      try {
        await q.provider.sendReportArkClick(accountId, item.gid, item.openid, item.shareKey)
        if (item.cancelled) q.items.delete(item.gid)
        else item.status = 'sent'
      } catch (error) {
        if (item.cancelled) q.items.delete(item.gid)
        else { item.status = 'failed'; item.error = String(error?.message || error) }
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  } finally { q.running = false }
}

function enqueue(accountId, provider, items) {
  const q = getQueue(accountId, provider)
  let accepted = 0; let skipped = 0; let invalid = 0
  for (const raw of Array.isArray(items) ? items : []) {
    const gid = Number(raw?.gid)
    const openid = String(raw?.openid || '').trim()
    const shareKey = String(raw?.shareKey || '').trim().toLowerCase()
    if (!Number.isFinite(gid) || gid <= 0 || !openid || !/^[0-9a-f]{32}$/.test(shareKey)) { invalid++; continue }
    const old = q.items.get(gid)
    if (old && (old.status === 'pending' || old.status === 'sending' || old.status === 'sent')) { skipped++; continue }
    const item = { gid, openid, shareKey, status: 'pending', error: '' }
    q.items.set(gid, item); q.order.push(gid); accepted++
  }
  void drain(q, accountId)
  return { accepted, skipped, invalid, total: Array.isArray(items) ? items.length : 0 }
}

function snapshot(accountId, provider) {
  const q = getQueue(accountId, provider)
  return q.order.map(gid => q.items.get(gid)).filter(Boolean).map(item => ({ ...item }))
}

function cancel(accountId, provider, gids) {
  const q = getQueue(accountId, provider)
  const set = new Set((Array.isArray(gids) ? gids : []).map(Number))
  let cancelled = 0
  for (const gid of set) {
    const item = q.items.get(gid)
    if (!item) continue
    if (item.status === 'sending') item.cancelled = true
    else q.items.delete(gid)
    cancelled++
  }
  return cancelled
}

module.exports = { enqueue, snapshot, cancel }
