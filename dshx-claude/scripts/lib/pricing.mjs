// dshx-claude — Anthropic API price book. EDIT THIS FILE WHEN PRICES CHANGE.
//
// Source: https://platform.claude.com/docs/en/about-claude/pricing
// (the page says "All prices are in USD"), fetched 2026-10-30.
//
// Every number is USD per 1,000,000 tokens (MTok), copied from the
// "Model pricing" table: Base input | 5m cache writes | 1h cache writes |
// Cache hits and refreshes | Output.
//
// Rules are matched in order against the model id from the session log
// (e.g. "claude-opus-5-5"), so put specific rules before general ones —
// same convention as dshx-token-cost/pricing.js.

export const PRICES_AS_OF = '2026-10-30'
export const PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing'

/** Model pricing table. in / cw5m / cw1h / cr / out are USD per MTok. */
export const RULES = [
  { match: /fable-5-1|fable-5\.1/i, label: 'Claude Fable 5.1', in: 10, cw5m: 12.5, cw1h: 20, cr: 0.25, out: 50 },
  { match: /mythos-5-1|mythos-5\.1/i, label: 'Claude Mythos 5.1', in: 10, cw5m: 12.5, cw1h: 20, cr: 0.25, out: 50 },
  { match: /fable-5/i, label: 'Claude Fable 5', in: 10, cw5m: 12.5, cw1h: 20, cr: 1, out: 50 },
  { match: /mythos-5/i, label: 'Claude Mythos 5', in: 10, cw5m: 12.5, cw1h: 20, cr: 1, out: 50 },
  { match: /opus-5-5|opus-5\.5/i, label: 'Claude Opus 5.5', in: 4, cw5m: 5, cw1h: 8, cr: 0.20, out: 20, fast: { in: 8, out: 40 }, geo: true },
  { match: /opus-5/i, label: 'Claude Opus 5', in: 5, cw5m: 6.25, cw1h: 10, cr: 0.50, out: 25, fast: { in: 10, out: 50 }, geo: true },
  { match: /opus-4-8|opus-4\.8/i, label: 'Claude Opus 4.8', in: 5, cw5m: 6.25, cw1h: 10, cr: 0.50, out: 25, fast: { in: 10, out: 50 }, geo: true },
  { match: /opus-4-7|opus-4\.7/i, label: 'Claude Opus 4.7', in: 5, cw5m: 6.25, cw1h: 10, cr: 0.50, out: 25, geo: true },
  { match: /opus-4-6|opus-4\.6/i, label: 'Claude Opus 4.6', in: 5, cw5m: 6.25, cw1h: 10, cr: 0.50, out: 25, geo: true },
  { match: /opus-4-5|opus-4\.5/i, label: 'Claude Opus 4.5', in: 5, cw5m: 6.25, cw1h: 10, cr: 0.50, out: 25 },
  { match: /opus-4-1|opus-4\.1/i, label: 'Claude Opus 4.1', in: 15, cw5m: 18.75, cw1h: 30, cr: 1.50, out: 75 },
  { match: /opus-4/i, label: 'Claude Opus 4', in: 15, cw5m: 18.75, cw1h: 30, cr: 1.50, out: 75 },
  { match: /sonnet-5-5|sonnet-5\.5/i, label: 'Claude Sonnet 5.5', in: 2, cw5m: 2.5, cw1h: 4, cr: 0.10, out: 10, geo: true },
  { match: /sonnet-5/i, label: 'Claude Sonnet 5', in: 2, cw5m: 2.5, cw1h: 4, cr: 0.20, out: 10, geo: true },
  { match: /sonnet-4-6|sonnet-4\.6/i, label: 'Claude Sonnet 4.6', in: 3, cw5m: 3.75, cw1h: 6, cr: 0.30, out: 15, geo: true },
  { match: /sonnet-4-5|sonnet-4\.5/i, label: 'Claude Sonnet 4.5', in: 3, cw5m: 3.75, cw1h: 6, cr: 0.30, out: 15 },
  { match: /sonnet-4/i, label: 'Claude Sonnet 4', in: 3, cw5m: 3.75, cw1h: 6, cr: 0.30, out: 15 },
  // Haiku 5.5 is priced per request by prompt length (input + cache reads + cache writes).
  {
    match: /haiku-5-5|haiku-5\.5/i, label: 'Claude Haiku 5.5', in: 0.10, cw5m: 0.125, cw1h: 0.20, cr: 0.01, out: 0.50, geo: true,
    longContext: { over: 100000, in: 0.50, cw5m: 0.625, cw1h: 1, cr: 0.05, out: 2.50 },
  },
  { match: /haiku-4-5|haiku-4\.5/i, label: 'Claude Haiku 4.5', in: 1, cw5m: 1.25, cw1h: 2, cr: 0.10, out: 5 },
  { match: /haiku-3-5|haiku-3\.5/i, label: 'Claude Haiku 3.5', in: 0.80, cw5m: 1, cw1h: 1.60, cr: 0.08, out: 4 },
]

/** Web search: "$10 USD per 1,000 searches" (Feature-specific pricing → Web search tool). */
export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000

/** "using inference_geo: "us" applies a 1.1x pricing multiplier" (Claude 4.6 and later). */
export const US_GEO_MULTIPLIER = 1.1

/** Placeholder for model ids not in the table (e.g. "<synthetic>"); priced at 0 and flagged. */
const UNKNOWN = { label: null, in: 0, cw5m: 0, cw1h: 0, cr: 0, out: 0, unpriced: true }

/**
 * Price row for a model id.
 * @returns the matched rule, or an unpriced placeholder labelled with the raw id.
 */
export function rateFor(model) {
  const id = typeof model === 'string' ? model : ''
  for (const rule of RULES) if (rule.match.test(id)) return rule
  return { ...UNKNOWN, label: id || 'unknown' }
}

/** Display label used to group report rows (one row per product, as in the DSH plugin). */
export function labelFor(model) {
  return rateFor(model).label
}

/**
 * Cost of ONE API request in USD, applying the modifiers the price page lists:
 * Haiku 5.5 long-prompt tier, fast mode (cache multipliers stack on the fast
 * base price), US-only inference 1.1x, and web-search requests.
 *
 * @param model model id
 * @param t {input, output, cw5m, cw1h, cacheRead, webSearch, speed, geo}
 */
export function requestCost(model, t) {
  return requestCostParts(model, t).total
}

/**
 * The same cost split by what it paid for, plus what the cache saved: the
 * cache-read tokens priced as plain input, minus what they cost as cache reads
 * (same tier, fast-mode and US-only modifiers as the request itself).
 *
 * @returns {{input, output, cw5m, cw1h, cacheRead, webSearch, total, cacheSavings}} USD
 */
export function requestCostParts(model, t) {
  const rule = rateFor(model)
  let p = rule
  if (rule.longContext && (t.input + t.cw5m + t.cw1h + t.cacheRead) > rule.longContext.over) {
    p = { ...rule, ...rule.longContext }
  }
  if (t.speed === 'fast' && rule.fast) {
    // Prompt-caching multipliers "apply on top of fast mode pricing".
    const k = rule.fast.in / rule.in
    p = { ...p, in: rule.fast.in, out: rule.fast.out, cw5m: p.cw5m * k, cw1h: p.cw1h * k, cr: p.cr * k }
  }
  const geo = t.geo === 'us' && rule.geo ? US_GEO_MULTIPLIER : 1
  const perM = (n, price) => (Number(n) || 0) * (Number(price) || 0) / 1e6 * geo
  const parts = {
    input: perM(t.input, p.in),
    output: perM(t.output, p.out),
    cw5m: perM(t.cw5m, p.cw5m),
    cw1h: perM(t.cw1h, p.cw1h),
    cacheRead: perM(t.cacheRead, p.cr),
    webSearch: (Number(t.webSearch) || 0) * WEB_SEARCH_USD_PER_REQUEST,
  }
  const total = parts.input + parts.output + parts.cw5m + parts.cw1h + parts.cacheRead + parts.webSearch
  const cacheSavings = Math.max(0, perM(t.cacheRead, p.in) - parts.cacheRead)
  return { ...parts, total, cacheSavings }
}
