/** One line of the panel: a period or a model. */
export type UsageRow = {
  label: string
  requests: number
  tokens: number
  usd: number
}

export type UsageReport = {
  /** Epoch ms of the last successful refresh. */
  updatedAt: number
  today: UsageRow
  week: UsageRow
  models: UsageRow[]
  /** Newest first, YYYY-MM-DD. */
  days: { day: string; tokens: number; usd: number }[]
  /** Cache reads / all input, 0–100; null with no input. */
  cacheHit: number | null
  /** The window's tokens and cost by kind, in a fixed order. */
  breakdown: TokenPart[]
  webSearches: number
  webSearchUsd: number
}

export type TokenPart = {
  key: 'input' | 'output' | 'cw5m' | 'cw1h' | 'cacheRead'
  label: string
  tokens: number
  usd: number
}

export type UsageView = {
  report: UsageReport | null
  error: string | null
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'dshx-claude': { view: Shaped<UsageView> }
  }
}
