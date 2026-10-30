import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TokenPart, UsageReport, UsageRow, UsageView } from '../types'

// The plugin's own report script; `--json` prints the numbers.
const SCRIPT = 'scripts/token-cost.mjs'
const DAYS = 7
const PANE = 'dshx-usage'
const TITLE = '用量'
const EVERY_MS = 60_000

const view = atom(
  { plugin: 'dshx-claude', key: 'view' } as const,
  { report: null, error: null, isLoading: false } as UsageView,
  { shape: 'view-3' },
)

// --- the script's JSON -------------------------------------------------------

type Bucket = {
  label: string
  requests: number
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
  webSearch: number
  totalTokens: number
  usd: number
  /** USD by kind; absent from a script older than 1.1.2. */
  cost?: { input: number; output: number; cw5m: number; cw1h: number; cacheRead: number; webSearch: number }
}

const PARTS: { key: TokenPart['key']; label: string; tokens: (b: Bucket) => number }[] = [
  { key: 'input', label: '输入', tokens: b => b.input },
  { key: 'output', label: '输出', tokens: b => b.output },
  { key: 'cw5m', label: '缓存写入 5m', tokens: b => b.cacheWrite5m },
  { key: 'cw1h', label: '缓存写入 1h', tokens: b => b.cacheWrite1h },
  { key: 'cacheRead', label: '缓存读取', tokens: b => b.cacheRead },
]
type Json = {
  days: { day: string; models: Bucket[] }[]
  models: Bucket[]
  total: Bucket
}

const row = (label: string, buckets: Bucket[]): UsageRow => ({
  label,
  requests: buckets.reduce((s, b) => s + b.requests, 0),
  tokens: buckets.reduce((s, b) => s + b.totalTokens, 0),
  usd: buckets.reduce((s, b) => s + b.usd, 0),
})

export function summarize(json: Json, now: number): UsageReport {
  const t = json.total
  const input = t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead
  return {
    updatedAt: now,
    today: row('今日', json.days[0]?.models ?? []),
    week: row(`近 ${json.days.length} 天`, [t]),
    models: [...json.models].sort((a, b) => b.usd - a.usd).map(m => row(m.label, [m])),
    days: json.days.map(d => ({
      day: d.day,
      tokens: d.models.reduce((s, b) => s + b.totalTokens, 0),
      usd: d.models.reduce((s, b) => s + b.usd, 0),
    })),
    cacheHit: input > 0 ? (100 * t.cacheRead) / input : null,
    breakdown: PARTS.map(p => ({ key: p.key, label: p.label, tokens: p.tokens(t), usd: t.cost?.[p.key] ?? 0 })),
    webSearches: t.webSearch ?? 0,
    webSearchUsd: t.cost?.webSearch ?? 0,
  }
}

// --- refresh -----------------------------------------------------------------

let running: Promise<void> | null = null

async function refresh($: EngineInterface): Promise<void> {
  if (running) return running
  running = (async () => {
    await update($, view, v => ({ ...v, isLoading: true }))
    try {
      const { exitCode, stdout, stderr } = await $.process.run(
        ['node', `${$.plugin.root}/${SCRIPT}`, String(DAYS), '--json', '--offline'],
        { timeoutMs: 30_000 },
      )
      if (exitCode !== 0) throw new Error(stderr.trim().split('\n').at(-1) || `exit ${exitCode}`)
      const report = summarize(JSON.parse(stdout) as Json, Date.now())
      await update($, view, () => ({ report, error: null, isLoading: false }))
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await update($, view, v => ({ ...v, error, isLoading: false }))
    }
  })()
  try {
    await running
  } finally {
    running = null
  }
}

// --- formatting --------------------------------------------------------------

const tok = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K'
  : String(Math.round(n))
const usd = (n: number) => '$' + n.toFixed(2)
/** Small amounts with a third decimal, so a few cents per request still show a change. */
const fine = (n: number) => '$' + n.toFixed(n < 1 ? 3 : 2)
const short = (n: number) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2))

type Day = UsageReport['days'][number]

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const f1 = (n: number) => n.toFixed(1)

// Model colours, in order of spend. The first is the Claude accent.
const PALETTE = ['#D97757', '#6A9BCC', '#8DA370', '#B48EAD', '#C9A86A']
// One colour per kind of token, fixed so the bar reads the same every day.
const PART_COLOUR: Record<TokenPart['key'], string> = {
  input: '#6A9BCC',
  output: '#D97757',
  cw5m: '#C9A86A',
  cw1h: '#B48EAD',
  cacheRead: '#8DA370',
}

/** Today vs the day before, as a signed percentage; null when either is empty. */
export function changeVsYesterday(days: Day[]): number | null {
  const [today, yesterday] = days
  if (!today || !yesterday || yesterday.usd <= 0) return null
  return ((today.usd - yesterday.usd) / yesterday.usd) * 100
}

/**
 * The desktop pane's dashboard as one SVG: two headline figures, a bar per
 * day, and the models' share of spend. Text colours follow the app's light or
 * dark theme through prefers-color-scheme; the attribute colours underneath are
 * a mid grey that reads on both, should a surface drop the style sheet.
 */
export function dashboardSvg(report: UsageReport): string {
  const W = 320
  const PAD = 16
  const FONT = 'font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Microsoft YaHei UI,sans-serif"'
  const NUM = 'font-variant-numeric="tabular-nums"'
  const out: string[] = []
  const text = (x: number, y: number, s: string, cls: string, size: number, extra = '') =>
    out.push(`<text x="${f1(x)}" y="${f1(y)}" class="${cls}" fill="#8A8A8A" font-size="${size}" ${FONT} ${extra}>${esc(s)}</text>`)

  // Headline: today and the window, side by side.
  const col = (W - PAD * 2) / 2
  const change = changeVsYesterday(report.days)
  ;[report.today, report.week].forEach((r, i) => {
    const x = PAD + i * col
    text(x, 30, r.label.toUpperCase(), 'mut', 11, 'letter-spacing="0.6"')
    text(x, 62, usd(r.usd), 'fg', 28, `font-weight="600" ${NUM} letter-spacing="-0.5"`)
    text(x, 82, `${tok(r.tokens)} tokens · ${r.requests} 次`, 'mut', 11, NUM)
  })
  if (change !== null) {
    const up = change >= 0
    const label = `${up ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}% 较昨日`
    const x = PAD
    // Chinese characters are about a full em wide, the rest a bit over half.
    const width = [...label].reduce((w, c) => w + (/[　-鿿]/.test(c) ? 10.5 : 6.4), 0) + 14
    out.push(`<rect x="${x}" y="92" width="${f1(width)}" height="18" rx="9" class="${up ? 'upbg' : 'downbg'}" fill="#8A8A8A" fill-opacity="0.14"/>`)
    text(x + 6, 105, label, up ? 'up' : 'down', 10.5, `font-weight="600" ${NUM}`)
  }

  // Divider.
  const y0 = 126
  out.push(`<line x1="${PAD}" y1="${y0}" x2="${W - PAD}" y2="${y0}" class="rule" stroke="#8A8A8A" stroke-opacity="0.25"/>`)

  // Daily bars, oldest on the left.
  text(PAD, y0 + 26, '每日费用', 'fg', 12, 'font-weight="600"')
  const days = [...report.days].reverse()
  const top = y0 + 50
  const plot = 84
  const base = top + plot
  const slot = (W - PAD * 2) / Math.max(1, days.length)
  const bar = Math.min(26, slot * 0.58)
  const max = Math.max(...days.map(d => d.usd), 0.01)
  out.push(`<line x1="${PAD}" y1="${base + 0.5}" x2="${W - PAD}" y2="${base + 0.5}" class="rule" stroke="#8A8A8A" stroke-opacity="0.25"/>`)
  days.forEach((d, i) => {
    const cx = PAD + i * slot + slot / 2
    const isToday = i === days.length - 1
    const h = d.usd > 0 ? Math.max(3, (d.usd / max) * plot) : 0
    if (h > 0) {
      out.push(isToday
        ? `<rect x="${f1(cx - bar / 2)}" y="${f1(base - h)}" width="${f1(bar)}" height="${f1(h)}" rx="4" fill="#D97757"/>`
        : `<rect x="${f1(cx - bar / 2)}" y="${f1(base - h)}" width="${f1(bar)}" height="${f1(h)}" rx="4" class="past" fill="#B9B5AA"/>`)
      text(cx, base - h - 6, short(d.usd), isToday ? 'fg' : 'mut', 9.5, `text-anchor="middle" ${NUM}${isToday ? ' font-weight="600"' : ''}`)
    } else {
      out.push(`<circle cx="${f1(cx)}" cy="${base - 2}" r="1.6" class="dot" fill="#8A8A8A" fill-opacity="0.5"/>`)
    }
    text(cx, base + 16, isToday ? '今天' : d.day.slice(5), isToday ? 'fg' : 'mut', 9.5, `text-anchor="middle" ${NUM}${isToday ? ' font-weight="600"' : ''}`)
  })

  // Models: one stacked bar and a legend row each.
  let y = base + 48
  text(PAD, y, `模型占比 · ${report.week.label}`, 'fg', 12, 'font-weight="600"')
  y += 14
  const total = report.models.reduce((s, m) => s + m.usd, 0)
  const track = W - PAD * 2
  out.push(`<rect x="${PAD}" y="${y}" width="${track}" height="8" rx="4" class="track" fill="#8A8A8A" fill-opacity="0.15"/>`)
  out.push(`<clipPath id="pill"><rect x="${PAD}" y="${y}" width="${track}" height="8" rx="4"/></clipPath><g clip-path="url(#pill)">`)
  let x = PAD
  report.models.forEach((m, i) => {
    const w = total > 0 ? (m.usd / total) * track : 0
    out.push(`<rect x="${f1(x)}" y="${y}" width="${f1(w)}" height="8" fill="${PALETTE[i % PALETTE.length]}"/>`)
    x += w
  })
  out.push('</g>')
  y += 30
  report.models.slice(0, 5).forEach((m, i) => {
    const pct = total > 0 ? (m.usd / total) * 100 : 0
    out.push(`<circle cx="${PAD + 4}" cy="${y - 4}" r="4" fill="${PALETTE[i % PALETTE.length]}"/>`)
    text(PAD + 14, y, m.label, 'fg', 11.5)
    text(W - PAD - 64, y, `${pct.toFixed(0)}%`, 'mut', 11, `text-anchor="end" ${NUM}`)
    text(W - PAD, y, usd(m.usd), 'fg', 11.5, `text-anchor="end" font-weight="600" ${NUM}`)
    y += 22
  })

  const rule = () => {
    out.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" class="rule" stroke="#8A8A8A" stroke-opacity="0.25"/>`)
  }

  // Token make-up: where the money went, by kind.
  y += 4
  rule()
  y += 26
  text(PAD, y, `Token 构成 · ${report.week.label}`, 'fg', 12, 'font-weight="600"')
  y += 14
  const parts = report.breakdown.filter(p => p.tokens > 0 || p.usd > 0)
  const spend = parts.reduce((s, p) => s + p.usd, 0)
  out.push(`<rect x="${PAD}" y="${y}" width="${track}" height="8" rx="4" class="track" fill="#8A8A8A" fill-opacity="0.15"/>`)
  out.push(`<clipPath id="parts"><rect x="${PAD}" y="${y}" width="${track}" height="8" rx="4"/></clipPath><g clip-path="url(#parts)">`)
  x = PAD
  parts.forEach(p => {
    const w = spend > 0 ? (p.usd / spend) * track : 0
    out.push(`<rect x="${f1(x)}" y="${y}" width="${f1(w)}" height="8" fill="${PART_COLOUR[p.key]}"/>`)
    x += w
  })
  out.push('</g>')
  y += 30
  const colTok = W - PAD - 112
  const colUsd = W - PAD - 42
  text(PAD + 14, y, '类别', 'mut', 10)
  text(colTok, y, 'Token', 'mut', 10, 'text-anchor="end"')
  text(colUsd, y, '费用', 'mut', 10, 'text-anchor="end"')
  text(W - PAD, y, '占比', 'mut', 10, 'text-anchor="end"')
  y += 20
  parts.forEach(p => {
    out.push(`<circle cx="${PAD + 4}" cy="${y - 4}" r="4" fill="${PART_COLOUR[p.key]}"/>`)
    text(PAD + 14, y, p.label, 'fg', 11.5)
    text(colTok, y, tok(p.tokens), 'mut', 11, `text-anchor="end" ${NUM}`)
    text(colUsd, y, usd(p.usd), 'fg', 11.5, `text-anchor="end" font-weight="600" ${NUM}`)
    text(W - PAD, y, `${spend > 0 ? ((p.usd / spend) * 100).toFixed(0) : 0}%`, 'mut', 11, `text-anchor="end" ${NUM}`)
    y += 22
  })

  // Cache: the hit rate, with a meter across the pane.
  y += 4
  rule()
  y += 26
  const hit = report.cacheHit
  text(PAD, y, '缓存命中率', 'fg', 12, 'font-weight="600"')
  text(W - PAD, y, hit === null ? '—' : `${hit.toFixed(1)}%`, 'fg', 16, `text-anchor="end" font-weight="600" ${NUM}`)
  y += 12
  out.push(`<rect x="${PAD}" y="${y}" width="${track}" height="6" rx="3" class="track" fill="#8A8A8A" fill-opacity="0.15"/>`)
  if (hit !== null) {
    out.push(`<rect x="${PAD}" y="${y}" width="${f1((track * Math.min(100, hit)) / 100)}" height="6" rx="3" fill="#8DA370"/>`)
  }
  y += 34

  // A few averages.
  const output = report.breakdown.find(p => p.key === 'output')?.tokens ?? 0
  const per = report.week.requests
  const facts: [string, string][] = [
    ['平均每次请求', per > 0 ? fine(report.week.usd / per) : '—'],
    ['平均每次输出', per > 0 ? `${tok(output / per)} tokens` : '—'],
    ['联网搜索', `${report.webSearches} 次 · ${usd(report.webSearchUsd)}`],
  ]
  facts.forEach(([label, value]) => {
    text(PAD, y, label, 'mut', 11.5)
    text(W - PAD, y, value, 'fg', 11.5, `text-anchor="end" font-weight="600" ${NUM}`)
    y += 22
  })

  const H = y + 2
  const style = '<style>' +
    '.fg{fill:#1F1E1D}.mut{fill:#73726C}.up{fill:#B4532F}.down{fill:#3F7D4E}' +
    '.upbg{fill:#D97757}.downbg{fill:#4E9A62}.rule,.track,.dot{stroke:#1F1E1D;fill:#1F1E1D}.past{fill:#D3CFC4}' +
    '@media (prefers-color-scheme: dark){.fg{fill:#F2F0E8}.mut{fill:#A6A39A}.up{fill:#F0A07E}.down{fill:#86C795}.past{fill:#57554F}' +
    '.rule,.track,.dot{stroke:#F2F0E8;fill:#F2F0E8}}' +
    '</style>'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    style + out.join('') + '</svg>'
}

const dashboardAlt = (r: UsageReport) =>
  `今日 ${usd(r.today.usd)}（${tok(r.today.tokens)} tokens），${r.week.label} ${usd(r.week.usd)}。每日：` +
  r.days.map(d => `${d.day.slice(5)} ${usd(d.usd)}`).join('，') +
  '。模型：' + r.models.map(m => `${m.label} ${usd(m.usd)}`).join('，') +
  '。Token 构成：' + r.breakdown.map(p => `${p.label} ${tok(p.tokens)} ${usd(p.usd)}`).join('，') +
  `。缓存命中率 ${r.cacheHit === null ? '—' : r.cacheHit.toFixed(1) + '%'}`

/** A text bar for the terminal, scaled to the busiest day. */
const textBar = (value: number, days: Day[], width: number) => {
  const max = Math.max(...days.map(d => d.usd), 0.01)
  const filled = value > 0 ? Math.max(1, Math.round((value / max) * width)) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
// The hooks environment runs on UTC; show Brisbane time (UTC+10, no daylight
// saving), the same zone the report buckets days in.
const TZ_OFFSET_MS = 10 * 3600_000
const clock = (ms: number) => {
  const d = new Date(ms + TZ_OFFSET_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// --- hooks -------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-panel',
      description: '打开用量面板（token 与 API 价格折算费用）',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    $.clock.every(EVERY_MS, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'usage-panel' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: '用量面板已打开。' }
  })

  // Each finished turn adds usage: refresh after it.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const { report, error, isLoading } = await read($, view)
    const columns = e.props.bodyColumns
    // The desktop, the editor and the phone draw pictures; the terminal draws text bars.
    const canDraw = e.surface !== 'terminal'

    // One right-aligned row: a label that takes the rest, then fixed columns.
    const tableRow = (key: string, label: string, cells: string[], opts: { bold?: boolean; dim?: boolean } = {}) => (
      <Box key={key}>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold={opts.bold} dimColor={opts.dim} wrap="truncate-end">{label}</Text>
        </Box>
        {cells.map((c, i) => (
          <Box key={`${key}-${i}`} width={i === cells.length - 1 ? 9 : 8} justifyContent="flex-end">
            <Text bold={opts.bold} dimColor={opts.dim}>{c}</Text>
          </Box>
        ))}
      </Box>
    )

    const card = (r: UsageRow) => (
      <Box key={r.label} flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text dimColor>{r.label}</Text>
        <Text bold color="claude">{usd(r.usd)}</Text>
        <Text dimColor>{tok(r.tokens)} tok · {r.requests} 次</Text>
      </Box>
    )

    const heading = (text: string) => <Text bold>{text}</Text>

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between" alignItems="center">
          <Text bold color="claude">Claude Code 用量</Text>
          <Button key="refresh" label={isLoading ? '刷新中…' : '刷新'} onPress={() => void refresh($)} />
        </Box>

        {report === null && !error && <Text dimColor>正在读取用量…</Text>}
        {error && <Text color="error">读取失败：{error}</Text>}

        {report && canDraw && <Svg source={dashboardSvg(report)} alt={dashboardAlt(report)} />}

        {report && !canDraw && (
          <Box flexDirection={columns < 38 ? 'column' : 'row'} gap={1}>
            {card(report.today)}
            {card(report.week)}
          </Box>
        )}

        {report && !canDraw && (
          <Box flexDirection="column">
            {heading('每日费用')}
            {report.days.map(d => (
              <Box key={d.day}>
                <Text dimColor={d.tokens === 0}>
                  {d.day.slice(5)} {textBar(d.usd, report.days, Math.min(20, Math.max(6, columns - 18)))} {usd(d.usd)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {report && !canDraw && report.models.length > 0 && (
          <Box flexDirection="column">
            {heading(`按模型 · ${report.week.label}`)}
            {tableRow('head', '模型', ['Token', '费用'], { dim: true })}
            {report.models.map(m => tableRow(m.label, m.label, [tok(m.tokens), usd(m.usd)]))}
          </Box>
        )}

        {report && !canDraw && (
          <Box flexDirection="column">
            {heading(`Token 构成 · ${report.week.label}`)}
            {tableRow('parts-head', '类别', ['Token', '费用'], { dim: true })}
            {report.breakdown
              .filter(p => p.tokens > 0 || p.usd > 0)
              .map(p => tableRow(`part-${p.key}`, p.label, [tok(p.tokens), usd(p.usd)]))}
          </Box>
        )}

        {report && !canDraw && (
          <Box flexDirection="column">
            {heading('缓存')}
            {tableRow('hit', '命中率', [report.cacheHit === null ? '—' : `${report.cacheHit.toFixed(1)}%`])}
            {tableRow('per', '平均每次请求', [report.week.requests > 0 ? fine(report.week.usd / report.week.requests) : '—'])}
            {tableRow('web', '联网搜索', [`${report.webSearches} 次`])}
          </Box>
        )}

        {report && (
          <Box flexDirection="column">
            <Text dimColor>更新于 {clock(report.updatedAt)} · 每轮对话后自动刷新</Text>
            <Text dimColor>按 API 标价折算，订阅不按此扣费</Text>
          </Box>
        )}
      </Box>
    )
  })
}
