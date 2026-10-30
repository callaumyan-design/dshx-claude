import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'dshx-claude',
  component: 'Pane',
  requestId: 'dshx-usage',
  props: {
    title: '用量',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const bucket = (label: string, totalTokens: number, usd: number, cacheRead = 0) => ({
  label, requests: 10, input: 100, output: 1000, cacheWrite5m: 0, cacheWrite1h: 900,
  cacheRead, webSearch: 0, totalTokens, usd,
  // Half the money on cache reads, 30% on output, 20% on 1h cache writes.
  cost: { input: 0, output: usd * 0.3, cw5m: 0, cw1h: usd * 0.2, cacheRead: usd * 0.5, webSearch: 0 },
  cacheSavings: (cacheRead * 3.8) / 1e6,
})

// What `token-cost.mjs 3 --json` prints, cut down.
const REPORT = {
  days: [
    { day: '2026-10-31', models: [bucket('Claude Opus 5.5', 7_330_000, 3.97, 7_000_000)] },
    { day: '2026-10-30', models: [bucket('Claude Opus 5.5', 28_400_000, 11.06), bucket('Claude <Haiku> 5.5', 100_000, 0.04)] },
    { day: '2026-10-29', models: [] },
  ],
  models: [bucket('Claude Opus 5.5', 35_730_000, 15.03), bucket('Claude <Haiku> 5.5', 100_000, 0.04)],
  total: bucket('Total', 35_830_000, 15.07, 7_000_000),
}

type On = Parameters<Parameters<typeof test>[1]>[1]
const engine = (on: On, stdout: string, exitCode = 0) => {
  on('command.register', () => ({ value: { command: 'usage-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({
    value: { exitCode, stdout, stderr: exitCode ? 'boom' : '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
}

test('the desktop pane draws the dashboard as one picture', async ($, on) => {
  engine(on, JSON.stringify(REPORT))
  await $.command.run({ command: 'usage-panel' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  // Headline figures, the change against yesterday, the days and the models.
  expect(source).toContain('>$3.97<')
  expect(source).toContain('>$15.07<')
  expect(source).toContain('▼ 64% 较昨日')
  expect(source).toContain('>今天<')
  expect(source).toContain('>10-29<')
  expect(source).toContain('>Claude Opus 5.5<')
  // A model id is escaped, never markup.
  expect(source).toContain('Claude &lt;Haiku&gt; 5.5')
  expect(source).not.toContain('<Haiku>')
  // Follows the app's light or dark theme.
  expect(source).toContain('prefers-color-scheme: dark')
  expect(String(svg?.props.alt)).toContain('今日 $3.97')
  // The text layout is the terminal's only.
  expect(await ui.find({ type: 'Text', text: /tok · 10 次/ })).toBeUndefined()
  // Token make-up: each kind with its tokens, cost and share; empty kinds left out.
  expect(source).toContain('>Token 构成 · 近 3 天<')
  expect(source).toContain('>缓存读取<')
  expect(source).toContain('>缓存写入 1h<')
  expect(source).not.toContain('>缓存写入 5m<')
  expect(source).toContain('>$7.54<') // half of $15.07 on cache reads
  expect(source).toContain('>50%<')
  // Cache: the hit rate alone; no savings or cost-without-cache figures.
  expect(source).toContain('>缓存命中率<')
  expect(source).toMatch(/>\d+\.\d%</)
  expect(source).not.toContain('省下')
  expect(source).not.toContain('无缓存')
  expect(source).toContain('>平均每次请求<')
  expect(source).toContain('>0 次 · $0.00<')
  expect((await ui.find({ type: 'Text', text: /更新于/ }))?.text).toMatch(/^更新于 \d\d:\d\d · 每轮对话后自动刷新$/)
  await ui.unmount()
})

test('the terminal pane lays the same out in text', async ($, on) => {
  engine(on, JSON.stringify(REPORT))
  await $.command.run({ command: 'usage-panel' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^今日$/ }))?.text).toBe('今日')
  expect((await ui.find({ type: 'Text', text: /^7\.33M tok/ }))?.text).toBe('7.33M tok · 10 次')
  expect((await ui.find({ type: 'Text', text: /^10-30/ }))?.text).toMatch(/^10-30 █+░* \$11\.10$/)
  expect((await ui.find({ type: 'Text', text: /^10-29/ }))?.text).toMatch(/^10-29 ░+ \$0\.00$/)
  expect((await ui.find({ type: 'Text', text: /^Claude Opus 5\.5$/ }))?.text).toBe('Claude Opus 5.5')
  expect((await ui.find({ type: 'Text', text: /^缓存读取$/ }))?.text).toBe('缓存读取')
  expect((await ui.find({ type: 'Text', text: /^命中率$/ }))?.text).toBe('命中率')
  expect(await ui.find({ type: 'Text', text: /省下|无缓存/ })).toBeUndefined()
  await ui.unmount()
})

test('nothing is drawn above the prompt', async ($, on) => {
  engine(on, JSON.stringify(REPORT))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.command.run({ command: 'usage-panel' })

  const ui = await $.ui.mount({
    plugin: 'dshx-claude',
    component: 'AbovePrompt',
    props: { bodyColumns: 100, hasSurvey: false },
    surface: 'desktop',
  })
  expect(await ui.find({ type: 'Text', text: /今日/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the report script is run from the plugin\'s own folder', async ($, on) => {
  const seen: string[][] = []
  on('command.register', () => ({ value: { command: 'usage-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    seen.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify(REPORT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run({ command: 'usage-panel' })

  const argv = seen[0] ?? []
  expect(argv[0]).toBe('node')
  // The engine's root for this plugin, then the script inside it: an absolute path.
  expect(argv[1]).toMatch(/^([A-Za-z]:)?[\\/].*[\\/]dshx-claude\/scripts\/token-cost\.mjs$/)
  expect(argv.slice(2)).toEqual(['7', '--json', '--offline'])
})

test('a failed run shows the error', async ($, on) => {
  engine(on, '', 1)
  await $.command.run({ command: 'usage-panel' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /读取失败/ }))?.text).toBe('读取失败：boom')
  await ui.unmount()
})
