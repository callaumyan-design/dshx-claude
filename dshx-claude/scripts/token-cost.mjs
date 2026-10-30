#!/usr/bin/env node
// /token-cost report: tokens per day × model from Claude Code session logs,
// priced at Anthropic API list prices. Port of dshx-token-cost's report.
//
// Usage: node token-cost.mjs [days] [--json] [--offline]
//   days       how many local days to show, default 7 (1–400)
//   --json     machine-readable output
//   --offline  never fetch the exchange rate (use the cached one if any)
import { refreshIndex, uniqueRequests, foldByDayModel, lastDays, emptyBucket, addBucket, totalOf } from './lib/usage.mjs'
import { PRICES_AS_OF, PRICES_SOURCE, RULES } from './lib/pricing.mjs'
import { getRate, CURRENCY } from './lib/rate.mjs'
import { projectsDir, TIME_ZONE } from './lib/paths.mjs'

/** Build the report text (markdown, or JSON with --json). */
export async function main(argv = []) {
  const args = argv.flatMap((a) => a.split(/\s+/)).filter(Boolean)
  const json = args.includes('--json')
  const offline = args.includes('--offline')
  const numArg = args.find((a) => /^\d+$/.test(a))
  const days = Math.min(400, Math.max(1, numArg ? Number(numArg) : 7))

  const fmtInt = (n) => Math.round(n).toLocaleString('en-US')
  const fmtTok = (n) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return String(Math.round(n))
  }
  const fmtUsd = (n) => '$' + n.toFixed(n === 0 || n >= 1 ? 2 : 4)
  const fmtAud = (n) => 'A$' + n.toFixed(n === 0 || n >= 1 ? 2 : 4)

  const { index, stats } = await refreshIndex()
  const { requests, raw } = uniqueRequests(index)
  const keys = lastDays(days)
  const byDay = foldByDayModel(requests, keys)
  const rate = await getRate({ offline })

  // Per-model totals and the grand total.
  const byModel = new Map()
  const total = emptyBucket('Total')
  for (const day of byDay.values()) {
    for (const b of day.values()) {
      let m = byModel.get(b.label)
      if (!m) { m = emptyBucket(b.label); byModel.set(b.label, m) }
      addBucket(m, b)
      addBucket(total, b)
    }
  }

  if (json) {
    const plain = (b) => ({ label: b.label, requests: b.requests, input: b.input, output: b.output, cacheWrite5m: b.cw5m, cacheWrite1h: b.cw1h, cacheRead: b.cacheRead, webSearch: b.webSearch, totalTokens: totalOf(b), usd: b.usd, aud: rate ? b.usd * rate.rate : null, cost: { ...b.cost }, cacheSavings: b.cacheSavings })
    return JSON.stringify({
      timeZone: TIME_ZONE, days, from: keys.at(-1), to: keys[0], projectsDir: projectsDir(),
      pricesAsOf: PRICES_AS_OF, pricesSource: PRICES_SOURCE,
      rate: rate ? { pair: 'USD/' + CURRENCY, value: rate.rate, source: rate.source, fetchedAt: new Date(rate.fetchedAt).toISOString(), stale: rate.stale } : null,
      scan: { ...stats, logLines: raw, uniqueRequests: requests.length },
      days: keys.map((d) => ({ day: d, models: [...byDay.get(d).values()].map(plain) })),
      models: [...byModel.values()].map(plain),
      total: plain(total),
    }, null, 2)
  }

  const audCol = rate !== null
  const head = ['Date', 'Model', 'Req', 'Input', 'Output', 'CacheW 5m', 'CacheW 1h', 'CacheRead', 'Total tok', 'USD'].concat(audCol ? [CURRENCY] : [])
  const rows = []
  const row = (date, b) => [date, b.label, fmtInt(b.requests), fmtTok(b.input), fmtTok(b.output), fmtTok(b.cw5m), fmtTok(b.cw1h), fmtTok(b.cacheRead), fmtTok(totalOf(b)), fmtUsd(b.usd)].concat(audCol ? [fmtAud(b.usd * rate.rate)] : [])

  for (const d of keys) {
    const models = [...byDay.get(d).values()].sort((a, b) => b.usd - a.usd)
    if (models.length === 0) { rows.push([d, '—', '0', '0', '0', '0', '0', '0', '0', fmtUsd(0)].concat(audCol ? [fmtAud(0)] : [])); continue }
    models.forEach((b, i) => rows.push(row(i === 0 ? d : '', b)))
  }

  const md = (cells) => '| ' + cells.join(' | ') + ' |'
  const out = []
  out.push(`## Claude Code token cost — last ${days} day${days > 1 ? 's' : ''} (${keys.at(-1)} → ${keys[0]}, ${TIME_ZONE})`)
  out.push('')
  out.push(md(head))
  out.push(md(head.map((h, i) => (i < 2 ? '---' : '---:'))))
  for (const r of rows) out.push(md(r))
  out.push(md([`**Total**`, '', fmtInt(total.requests), fmtTok(total.input), fmtTok(total.output), fmtTok(total.cw5m), fmtTok(total.cw1h), fmtTok(total.cacheRead), fmtTok(totalOf(total)), `**${fmtUsd(total.usd)}**`].concat(audCol ? [`**${fmtAud(total.usd * rate.rate)}**`] : [])))
  out.push('')

  if (byModel.size > 1) {
    out.push('### By model')
    out.push('')
    out.push(md(['Model', 'Req', 'Input', 'Output', 'CacheW 5m', 'CacheW 1h', 'CacheRead', 'USD'].concat(audCol ? [CURRENCY] : [])))
    out.push(md(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:'].concat(audCol ? ['---:'] : [])))
    for (const b of [...byModel.values()].sort((a, c) => c.usd - a.usd)) {
      out.push(md([b.label, fmtInt(b.requests), fmtTok(b.input), fmtTok(b.output), fmtTok(b.cw5m), fmtTok(b.cw1h), fmtTok(b.cacheRead), fmtUsd(b.usd)].concat(audCol ? [fmtAud(b.usd * rate.rate)] : [])))
    }
    out.push('')
  }

  const unpriced = [...byModel.values()].filter((b) => !RULES.some((r) => r.label === b.label))
  const cacheIn = total.input + total.cw5m + total.cw1h + total.cacheRead
  out.push('Notes:')
  out.push(`- Prices: Anthropic API list prices (USD / MTok) as of ${PRICES_AS_OF}, from ${PRICES_SOURCE}. Estimate only — subscription plans are not billed per token.`)
  if (cacheIn > 0) out.push(`- Cache hit rate (cache read / all input): ${(100 * total.cacheRead / cacheIn).toFixed(1)}%. Web searches: ${fmtInt(total.webSearch)}.`)
  out.push(rate
    ? `- ${CURRENCY} at 1 USD = ${rate.rate.toFixed(4)} ${CURRENCY} (${rate.source}, fetched ${new Date(rate.fetchedAt).toISOString().slice(0, 10)}${rate.stale ? ', stale' : ''}).`
    : `- ${CURRENCY} column omitted: exchange rate unavailable (offline and no cache).`)
  out.push(`- Source: ${stats.files} log file(s) under ${projectsDir()}; ${fmtInt(raw)} usage lines → ${fmtInt(requests.length)} unique requests (dedup by message.id + requestId).`)
  if (unpriced.length) out.push(`- Unpriced model ids (counted as $0): ${unpriced.map((b) => b.label).join(', ')} — add them to scripts/lib/pricing.mjs.`)
  return out.join('\n')
}

if (process.argv[1] && /token-cost\.mjs$/.test(process.argv[1])) {
  console.log(await main(process.argv.slice(2)))
}
