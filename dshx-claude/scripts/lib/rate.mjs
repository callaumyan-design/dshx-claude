// dshx-claude — USD → AUD exchange rate.
//
// Ported from dshx-token-cost/rate.js: same two independent sources
// (exchangerate-api via open.er-api.com, ECB via frankfurter), same
// plausibility guard, same 24 h on-disk cache written atomically, same
// "last known rate beats a stale constant" fallback. Changes: the target
// currency is AUD instead of CNY, and there is no built-in constant — if no
// rate has ever been fetched, the AUD column is simply omitted.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { stateDir } from './paths.mjs'

export const CURRENCY = 'AUD'
export const RATE_TTL_MS = 24 * 60 * 60 * 1000

/** A USD→AUD rate outside this band is a broken response, not a market move. */
export function plausibleRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.8 && value <= 3
}

function numberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const RATE_SOURCES = [
  {
    name: 'er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick(p) {
      const rate = numberOrNull(p?.rates?.[CURRENCY])
      if (rate === null) return null
      const s = numberOrNull(p?.time_last_update_unix)
      return { rate, asOf: s === null ? null : s * 1000 }
    },
  },
  {
    name: 'frankfurter',
    url: `https://api.frankfurter.app/latest?from=USD&to=${CURRENCY}`,
    pick(p) {
      const rate = numberOrNull(p?.rates?.[CURRENCY])
      return rate === null ? null : { rate, asOf: null }
    },
  },
]

export function parseRate(source, text) {
  let payload
  try { payload = JSON.parse(text) } catch { return null }
  let picked
  try { picked = source.pick(payload) } catch { return null }
  if (picked === null || !plausibleRate(picked.rate)) return null
  return picked
}

export function ratePath() {
  return path.join(stateDir(), 'rate-aud.json')
}

export async function readRateCache(file = ratePath()) {
  try {
    const p = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!p || !plausibleRate(p.rate) || !Number.isFinite(p.fetchedAt)) return null
    return { rate: p.rate, fetchedAt: p.fetchedAt, source: String(p.source ?? 'unknown'), asOf: p.asOf ?? null }
  } catch {
    return null
  }
}

export async function writeRateCache(entry, file = ratePath()) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(entry), 'utf8')
  await fs.rename(tmp, file)
}

export function isRateFresh(entry, now = Date.now()) {
  return entry !== null && now - entry.fetchedAt < RATE_TTL_MS
}

async function fetchText(url, timeoutMs) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    return r.ok ? await r.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The rate to use. Network only when the cache is older than 24 h (or `force`).
 * @param {{offline?: boolean, force?: boolean}} opts - offline: never touch the network (status line).
 * @returns {{rate, source, fetchedAt, stale}} or null when nothing is known.
 */
export async function getRate({ offline = false, force = false } = {}) {
  const cached = await readRateCache()
  if (offline || (!force && isRateFresh(cached))) {
    return cached ? { ...cached, stale: !isRateFresh(cached) } : null
  }
  for (const source of RATE_SOURCES) {
    const text = await fetchText(source.url, 5000)
    const parsed = text === null ? null : parseRate(source, text)
    if (parsed) {
      const entry = { rate: parsed.rate, fetchedAt: Date.now(), source: source.name, asOf: parsed.asOf }
      try { await writeRateCache(entry) } catch { /* durability only */ }
      return { ...entry, stale: false }
    }
  }
  return cached ? { ...cached, stale: true } : null
}
