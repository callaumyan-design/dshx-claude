// node tests/test-usage.mjs — synthetic CLAUDE_CONFIG_DIR: dedup, cache split, pricing, Brisbane days, status line.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshx-claude-test-'))
const cfg = path.join(tmp, 'cfg')
const state = path.join(tmp, 'state')
fs.mkdirSync(path.join(cfg, 'projects', 'proj-a', 'sub'), { recursive: true })
fs.mkdirSync(path.join(cfg, 'projects', 'proj-b'), { recursive: true })

const line = (id, req, ts, model, usage) => JSON.stringify({ type: 'assistant', requestId: req, timestamp: ts, message: { id, model, usage } })
// 2026-10-29T14:30Z = 2026-10-30 00:30 Brisbane (UTC+10, no DST)
const A = line('msg_1', 'req_1', '2026-10-29T14:30:00Z', 'claude-opus-5-5', {
  input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 3000, cache_read_input_tokens: 1_000_000,
  cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
})
const B = line('msg_2', 'req_2', '2026-10-29T13:59:00Z', 'claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 500_000, cache_read_input_tokens: 0 }) // 23:59 on 10-29, no split ->5m
const F = line('msg_3', 'req_3', '2026-10-29T15:00:00Z', 'claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0, speed: 'fast', inference_geo: 'us', server_tool_use: { web_search_requests: 3 } })
const H = line('msg_4', 'req_4', '2026-10-29T15:10:00Z', 'claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 0, cache_read_input_tokens: 60_000 }) // >100K prompt ->long tier
const S = line('msg_5', 'req_5', '2026-10-29T15:20:00Z', '<synthetic>', { input_tokens: 0, output_tokens: 0 })

// A appears 3x (content blocks) in one file and again in a resumed copy.
fs.writeFileSync(path.join(cfg, 'projects', 'proj-a', 's1.jsonl'), [A, A, A, B, '{"type":"user"}', 'torn{'].join('\n') + '\n')
fs.writeFileSync(path.join(cfg, 'projects', 'proj-a', 'sub', 'agent.jsonl'), [F, H, S].join('\n') + '\n')
fs.writeFileSync(path.join(cfg, 'projects', 'proj-b', 's2.jsonl'), A + '\n')
fs.mkdirSync(state, { recursive: true })
fs.writeFileSync(path.join(state, 'rate-aud.json'), JSON.stringify({ rate: 1.5, fetchedAt: Date.now(), source: 'test' }))

// Run in-process (no child pipes, so it also works inside sandboxes).
Object.assign(process.env, { CLAUDE_CONFIG_DIR: cfg, DSHX_CLAUDE_STATE: state, NO_COLOR: '1' })
const { main } = await import('../scripts/token-cost.mjs')
const { render } = await import('../scripts/statusline.mjs')
const run = async (script, args = [], input = '') => {
  if (script === 'token-cost.mjs') return main(args)
  let data = {}
  try { data = JSON.parse(input || '{}') } catch { data = {} }
  return render(data)
}

const report = JSON.parse(await run('token-cost.mjs', ['400', '--json', '--offline']))
assert.equal(report.scan.uniqueRequests, 4, 'A deduped across blocks and files; synthetic zero row dropped')
const day = (d) => report.days.find((x) => x.day === d)
const m = (d, label) => day(d).models.find((x) => x.label === label)

// Opus 5.5 normal request on 10-30 Brisbane: 1000x4 + 2000x20 + 1000x5 + 2000x8 + 1e6x0.20
const opusA = (1000 * 4 + 2000 * 20 + 1000 * 5 + 2000 * 8 + 1e6 * 0.2) / 1e6
// Fast + US geo + 3 web searches: 1e6x8 x1.1 + 3x$0.01
const opusF = 8 * 1.1 + 0.03
const opus = m('2026-10-30', 'Claude Opus 5.5')
assert.equal(opus.requests, 2)
assert.equal(opus.cacheWrite5m, 1000)
assert.equal(opus.cacheWrite1h, 2000)
assert.ok(Math.abs(opus.usd - (opusA + opusF)) < 1e-9, `opus ${opus.usd} vs ${opusA + opusF}`)
assert.ok(Math.abs(opus.aud - opus.usd * 1.5) < 1e-9)

// Haiku 4.5 on 10-29 (23:59 Brisbane): unsplit cache write counts as 5m.
const h45 = m('2026-10-29', 'Claude Haiku 4.5')
assert.equal(h45.cacheWrite5m, 500_000)
assert.ok(Math.abs(h45.usd - (1 * 1 + 0.5 * 1.25)) < 1e-9)

// Haiku 5.5, 110K-token prompt ->long-context prices 0.50 / 0.05.
const h55 = m('2026-10-30', 'Claude Haiku 5.5')
assert.ok(Math.abs(h55.usd - (50_000 * 0.5 + 60_000 * 0.05) / 1e6) < 1e-12)

// Incremental: append to a file, only that file is re-read from its offset.
fs.appendFileSync(path.join(cfg, 'projects', 'proj-b', 's2.jsonl'), line('msg_6', 'req_6', '2026-10-29T16:00:00Z', 'claude-sonnet-5-5', { input_tokens: 10, output_tokens: 10 }) + '\n')
const again = JSON.parse(await run('token-cost.mjs', ['400', '--json', '--offline']))
assert.equal(again.scan.appended, 1)
assert.equal(again.scan.reused, 2)
assert.equal(again.scan.uniqueRequests, 5)

// Markdown report renders with an AUD column.
const md = await run('token-cost.mjs', ['3', '--offline'])
assert.match(md, /\| USD \| AUD \|/)

// Status line with a mock JSON (subscription limits replace the old "balance").
const now = Math.floor(Date.now() / 1000)
const mock = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  cost: { total_cost_usd: 1.2345 },
  context_window: { total_input_tokens: 85200, context_window_size: 200000, used_percentage: 43 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: now + 7200 }, seven_day: { used_percentage: 91, resets_at: now + 3 * 86400 } },
}
const sl = (await run('statusline.mjs', [], JSON.stringify(mock))).trim()
console.log('statusline (with rate_limits):', sl)
assert.match(sl, /^\[Opus 5\.5\] · \$1\.23 session · ctx 85\.2K \(43%\) · today [\d.]+[KMB]? tok \$[\d.]+ ≈A\$[\d.]+ · 5h 24% ↻(1h59m|2h0m) 7d 91% ↻(2d23h|3d0h)$/)
const sl2 = (await run('statusline.mjs', [], JSON.stringify({ model: { display_name: 'Sonnet' }, rate_limits: { spend_limit: { used_percentage: 62.8, used_usd: 314.12, limit_usd: 500 } } }))).trim()
console.log('statusline (spend limit):    ', sl2)
assert.match(sl2, /spend \$314\/\$500$/)
const sl3 = (await run('statusline.mjs', [], '')).trim()
console.log('statusline (empty stdin):    ', sl3)
assert.match(sl3, /^\[Claude\] · \$0\.00 session · ctx 0/)

// Cost split: the parts add up to the total, and the cache's savings are the
// cache-read tokens at the input price less what they cost as cache reads.
const { requestCost, requestCostParts } = await import('../scripts/lib/pricing.mjs')
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`)
const t = { input: 1000, output: 2000, cw5m: 0, cw1h: 3000, cacheRead: 1_000_000, webSearch: 2 }
const parts = requestCostParts('claude-opus-5-5', t)
near(parts.cacheRead, 0.20)
near(parts.output, 0.04)
near(parts.webSearch, 0.02)
near(parts.cacheSavings, 4 - 0.20)
near(parts.input + parts.output + parts.cw5m + parts.cw1h + parts.cacheRead + parts.webSearch, parts.total)
near(parts.total, requestCost('claude-opus-5-5', t))
// US-only inference scales the savings with the price.
near(requestCostParts('claude-opus-5-5', { ...t, geo: 'us' }).cacheSavings, (4 - 0.20) * 1.1)
// The report's buckets carry the split.
assert.ok(report.total.cost && typeof report.total.cacheSavings === 'number', 'report carries cost split')
near(Object.values(report.total.cost).reduce((a, b) => a + b, 0), report.total.usd)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ok')
