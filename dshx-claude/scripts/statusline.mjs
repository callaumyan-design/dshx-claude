#!/usr/bin/env node
// Status line: port of dshx-usage-panel (balance + today's tokens) for Claude Code.
//
//   [Opus 5.5] $1.23 session · ctx 85.2K (43%) · today 12.3M tok $4.56 · 5h 23% 7d 41%
//
// stdin  : the status-line JSON Claude Code sends (model, cost, context_window, rate_limits …)
// stdout : one line. Must exit 0 and be fast — so today's figure comes from
//          the shared usage index (incremental, only re-reads grown logs) and
//          the exchange rate is never fetched here (cache only).
//
// DSH showed the DeepSeek account balance. Claude Code has no balance API for
// subscriptions; instead, when the JSON carries `rate_limits` (Pro/Max
// subscription windows or a gateway spend limit) those are shown in its place.
import { refreshIndex, uniqueRequests, foldByDayModel, lastDays, totalOf } from './lib/usage.mjs'
import { getRate, CURRENCY } from './lib/rate.mjs'

const NO_COLOR = process.env.NO_COLOR || process.env.DSHX_STATUSLINE_COLOR === 'off'
const c = (code, s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`)
const dim = (s) => c('2', s)

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const tok = (n) => {
  if (!Number.isFinite(n)) return '?'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}
const usd = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2))
const pctColor = (p) => (p >= 90 ? '31' : p >= 70 ? '33' : '32')

function resetIn(epochSec) {
  if (!Number.isFinite(epochSec)) return ''
  const ms = epochSec * 1000 - Date.now()
  if (ms <= 0) return ''
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : h > 0 ? `${h}h${m}m` : `${m}m`
}

/** Subscription / spend-limit segment, or null when the JSON has none. */
export function limitsSegment(rl) {
  if (!rl || typeof rl !== 'object') return null
  const parts = []
  for (const [key, name] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const w = rl[key]
    const p = Number(w?.used_percentage)
    if (!Number.isFinite(p)) continue
    const r = resetIn(Number(w.resets_at))
    parts.push(`${name} ${c(pctColor(p), Math.round(p) + '%')}${r ? dim(' ↻' + r) : ''}`)
  }
  const s = rl.spend_limit
  if (s && Number.isFinite(Number(s.used_percentage))) {
    const p = Number(s.used_percentage)
    const text = Number.isFinite(Number(s.used_usd)) && Number.isFinite(Number(s.limit_usd))
      ? `${usd(Number(s.used_usd))}/${usd(Number(s.limit_usd))}`
      : `${Math.round(p)}%`
    parts.push(`spend ${c(pctColor(p), text)}`)
  }
  return parts.length ? parts.join(' ') : null
}

export async function render(data) {
  const segs = []
  const model = data?.model?.display_name || data?.model?.id || 'Claude'
  segs.push(c('36', `[${model}]`))

  const cost = Number(data?.cost?.total_cost_usd)
  segs.push(`${c('33', usd(Number.isFinite(cost) ? cost : 0))} ${dim('session')}`)

  const cw = data?.context_window ?? {}
  const ctxTokens = Number.isFinite(Number(cw.total_input_tokens))
    ? Number(cw.total_input_tokens)
    : ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((s, k) => s + (Number(cw.current_usage?.[k]) || 0), 0)
  const pct = Number(cw.used_percentage)
  segs.push(`ctx ${tok(ctxTokens)}${Number.isFinite(pct) ? ' ' + c(pctColor(pct), `(${Math.round(pct)}%)`) : ''}`)

  try {
    const { index } = await refreshIndex()
    const today = lastDays(1)
    const day = foldByDayModel(uniqueRequests(index).requests, today).get(today[0])
    let t = 0
    let u = 0
    for (const b of day.values()) { t += totalOf(b); u += b.usd }
    const rate = await getRate({ offline: true })
    const aud = rate && process.env.DSHX_STATUSLINE_AUD !== 'off' ? dim(` ≈A$${(u * rate.rate).toFixed(2)}`) : ''
    segs.push(`today ${tok(t)} tok ${c('33', usd(u))}${aud}`)
  } catch {
    segs.push(dim('today ?'))
  }

  const limits = limitsSegment(data?.rate_limits)
  if (limits) segs.push(limits)

  return segs.join(dim(' · '))
}

// Run only when executed directly (tests import render()).
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1]?.endsWith('statusline.mjs')) {
  let data = {}
  try { data = JSON.parse((await readStdin()).replace(/^\uFEFF/, '') || '{}') } catch { data = {} }
  let line
  try { line = await render(data) } catch { line = `[${data?.model?.display_name ?? 'Claude'}]` }
  process.stdout.write(line + '\n')
  process.exit(0)
}
