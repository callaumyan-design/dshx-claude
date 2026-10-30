// dshx-claude — Claude Code session-log reader and persistent index.
//
// Port of dshx-token-cost/usage.js to Claude Code's on-disk layout:
//
//   <CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project>/<session>.jsonl
//   (subagent transcripts live in nested folders; the walk is recursive)
//
// Each API response is logged as one or more `type: "assistant"` lines — one
// per content block — all repeating the same `message.usage`. Counting lines
// would multiply the bill, so requests are de-duplicated on
// `message.id + requestId` across ALL files (a resumed/forked session may copy
// earlier lines into a new file).
//
// What is kept from the DSH plugin:
//   * the persistent index keyed by file, reusing work when (size, mtime) is
//     unchanged — logs are append-only, so a grown file is read only from the
//     last fully-parsed byte offset;
//   * atomic temp-file + rename writes;
//   * day × model buckets with disjoint token buckets (input / output /
//     cache write / cache read), now with cache write split into 5m and 1h
//     because Anthropic prices them differently.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { projectsDir, stateDir, TIME_ZONE } from './paths.mjs'
import { requestCostParts, labelFor } from './pricing.mjs'

export const INDEX_VERSION = 1

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

/** `YYYY-MM-DD` in the report time zone (Australia/Brisbane by default). */
export function dayKey(ms) {
  return dayFormatter.format(new Date(ms))
}

/** Day keys from today back `days - 1` days, newest first (Brisbane has no DST, but stay calendar-safe). */
export function lastDays(days, now = Date.now()) {
  const keys = []
  const seen = new Set()
  for (let i = 0; keys.length < days && i < days * 2 + 2; i++) {
    const k = dayKey(now - i * 86400000)
    if (!seen.has(k)) { seen.add(k); keys.push(k) }
  }
  return keys
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Turn one parsed log line into a request record, or null.
 * Record: [key, day, model, input, output, cw5m, cw1h, cacheRead, webSearch, speed, geo]
 */
export function recordOf(event) {
  if (event?.type !== 'assistant') return null
  const msg = event.message
  const u = msg?.usage
  if (!u || typeof u !== 'object') return null
  const id = msg.id
  const req = event.requestId
  if (!id && !req) return null
  const ms = Date.parse(event.timestamp)
  if (!Number.isFinite(ms)) return null

  const cwTotal = num(u.cache_creation_input_tokens)
  let cw1h = num(u.cache_creation?.ephemeral_1h_input_tokens)
  let cw5m = num(u.cache_creation?.ephemeral_5m_input_tokens)
  // Older logs carry only the total; the API default TTL is 5 minutes.
  const rest = cwTotal - cw1h - cw5m
  if (rest > 0) cw5m += rest

  const input = num(u.input_tokens)
  const output = num(u.output_tokens)
  const cacheRead = num(u.cache_read_input_tokens)
  const web = num(u.server_tool_use?.web_search_requests)
  if (input + output + cw5m + cw1h + cacheRead + web === 0) return null // e.g. <synthetic> error rows

  return [
    String(id ?? '') + '|' + String(req ?? ''),
    dayKey(ms),
    typeof msg.model === 'string' ? msg.model : 'unknown',
    input, output, cw5m, cw1h, cacheRead, web,
    u.speed === 'fast' ? 'fast' : '',
    u.inference_geo === 'us' ? 'us' : '',
  ]
}

/** Recursively list *.jsonl under the projects dir with their stat. */
export async function scanLogFiles(root = projectsDir()) {
  const out = []
  async function walk(dir) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = await fs.stat(full)
          out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs })
        } catch { /* vanished mid-scan */ }
      }
    }
  }
  await walk(root)
  return out
}

/**
 * Parse `buffer` from byte `start`; returns records and the offset just after
 * the last complete line (a torn final line is re-read next time).
 */
export function parseChunk(buffer, start = 0) {
  const records = []
  let pos = start
  let lineStart = start
  for (;;) {
    const nl = buffer.indexOf(0x0a, lineStart)
    if (nl < 0) break
    const line = buffer.toString('utf8', lineStart, nl)
    lineStart = nl + 1
    pos = lineStart
    // Cheap pre-filter: only assistant lines with usage matter.
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    const r = recordOf(event)
    if (r) records.push(r)
  }
  return { records, offset: pos }
}

export function indexPath() {
  return path.join(stateDir(), 'usage-index.json')
}

export async function readIndex(file = indexPath()) {
  try {
    const p = JSON.parse(await fs.readFile(file, 'utf8'))
    if (p?.version !== INDEX_VERSION || typeof p.files !== 'object' || p.files === null) throw new Error('stale')
    if (p.root !== projectsDir()) throw new Error('other root')
    return p
  } catch {
    return { version: INDEX_VERSION, root: projectsDir(), builtAt: 0, files: {} }
  }
}

export async function writeIndex(index, file = indexPath()) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(index), 'utf8')
  await fs.rename(tmp, file)
}

/**
 * Bring the index up to date with the logs on disk.
 * @returns {{index, stats: {files, reread, appended, reused}}}
 */
export async function refreshIndex() {
  const index = await readIndex()
  const files = await scanLogFiles()
  const live = new Set()
  const stats = { files: files.length, reread: 0, appended: 0, reused: 0 }
  let dirty = false

  for (const f of files) {
    live.add(f.path)
    const prev = index.files[f.path]
    if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) { stats.reused++; continue }

    let handle
    try {
      handle = await fs.open(f.path, 'r')
      const grownFrom = prev && f.size > prev.size && prev.offset <= f.size ? prev.offset : 0
      const length = f.size - grownFrom
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, grownFrom)
      const { records, offset } = parseChunk(buffer, 0)
      const base = grownFrom > 0 ? prev.records : []
      index.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, offset: grownFrom + offset, records: base.concat(records) }
      if (grownFrom > 0) stats.appended++
      else stats.reread++
      dirty = true
    } catch {
      // unreadable right now — keep whatever we had
    } finally {
      await handle?.close()
    }
  }
  for (const p of Object.keys(index.files)) {
    if (!live.has(p)) { delete index.files[p]; dirty = true }
  }
  if (dirty) {
    index.builtAt = Date.now()
    try { await writeIndex(index) } catch { /* read-only state dir costs speed, not correctness */ }
  }
  return { index, stats }
}

/** All requests in the index, de-duplicated on message.id + requestId. */
export function uniqueRequests(index) {
  const seen = new Map()
  let raw = 0
  for (const entry of Object.values(index.files)) {
    for (const r of entry.records) {
      raw++
      if (!seen.has(r[0])) seen.set(r[0], r)
    }
  }
  return { requests: [...seen.values()], raw }
}

export function emptyBucket(label) {
  return {
    label, models: new Set(), requests: 0, input: 0, output: 0, cw5m: 0, cw1h: 0, cacheRead: 0, webSearch: 0, usd: 0,
    cost: emptyCost(), cacheSavings: 0,
  }
}

/** USD by what it paid for; the keys of requestCostParts() less total and savings. */
export const COST_KEYS = ['input', 'output', 'cw5m', 'cw1h', 'cacheRead', 'webSearch']
export const emptyCost = () => Object.fromEntries(COST_KEYS.map((k) => [k, 0]))

/** Add bucket `from` into bucket `into`: counts, USD, its split and the savings. */
export function addBucket(into, from) {
  for (const k of ['requests', 'input', 'output', 'cw5m', 'cw1h', 'cacheRead', 'webSearch', 'usd', 'cacheSavings']) into[k] += from[k]
  for (const k of COST_KEYS) into.cost[k] += from.cost[k]
}

export function addRequest(bucket, r) {
  const [, , model, input, output, cw5m, cw1h, cacheRead, web, speed, geo] = r
  bucket.models.add(model)
  bucket.requests++
  bucket.input += input
  bucket.output += output
  bucket.cw5m += cw5m
  bucket.cw1h += cw1h
  bucket.cacheRead += cacheRead
  bucket.webSearch += web
  const parts = requestCostParts(model, { input, output, cw5m, cw1h, cacheRead, webSearch: web, speed, geo })
  bucket.usd += parts.total
  bucket.cacheSavings += parts.cacheSavings
  for (const k of COST_KEYS) bucket.cost[k] += parts[k]
}

/** Total tokens — the four buckets are disjoint, as in the DSH plugin. */
export function totalOf(b) {
  return b.input + b.output + b.cw5m + b.cw1h + b.cacheRead
}

/**
 * Fold requests into Map<day, Map<label, bucket>> for the given days.
 * Grouped by product label (one row per model, not per raw id).
 */
export function foldByDayModel(requests, dayKeys) {
  const wanted = new Set(dayKeys)
  const byDay = new Map(dayKeys.map((d) => [d, new Map()]))
  for (const r of requests) {
    if (!wanted.has(r[1])) continue
    const label = labelFor(r[2])
    const day = byDay.get(r[1])
    let b = day.get(label)
    if (!b) { b = emptyBucket(label); day.set(label, b) }
    addRequest(b, r)
  }
  return byDay
}
