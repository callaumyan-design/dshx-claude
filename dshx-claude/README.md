# dshx-claude

Claude Code 版的三个 dshx DSH 插件（只移植功能，DSH 的 Cordis 插件本身不能在 Claude Code 里用）：

| 原 DSH 插件 | 在 Claude Code 里 | 文件 |
|---|---|---|
| `dshx-language-mirror` | `UserPromptSubmit` hook：检测最新一条提问的语言，用 `hookSpecificOutput.additionalContext` 注入原插件的同一段规则 + "本条是 X 语言，过程说明和最终报告都用 X" | `hooks/hooks.json`、`scripts/language-mirror.mjs`、`scripts/lib/language.mjs` |
| `dshx-token-cost` | `/dshx-claude:token-cost [天数]` 技能：读 `projects/**/*.jsonl`，按 `message.id + requestId` 去重，按 Australia/Brisbane 日期 × 模型统计 input / output / cache write 5m / cache write 1h / cache read，按 Anthropic API 牌价折算 USD + AUD | `skills/token-cost/SKILL.md`、`scripts/token-cost.mjs` |
| `dshx-usage-panel` | 侧边用量面板（`/usage-panel`）：今日 / 近 7 天费用、较昨日、每日柱状图、模型占比、Token 构成、缓存命中率；会话开始自动打开，每轮对话后刷新。桌面端画成一张随深浅色主题变化的图，终端里是文字版 | `hooks/register.tsx`、`types/index.d.ts` |
| `dshx-usage-panel` | 状态栏（终端里的 `claude`）：模型 · 本会话费用 · 上下文 token · 今日 token 与费用 · 订阅额度（5h / 7d / spend limit，代替原来的 DeepSeek 余额） | `scripts/statusline.mjs`（由 `install.mjs` 写进 settings） |

共用：`scripts/lib/usage.mjs`（日志索引，移植自 `usage.js`）、`scripts/lib/rate.mjs`（汇率，移植自 `rate.js`，CNY 改为 AUD）、
**`scripts/lib/pricing.mjs`（价格表，改价格只改这个文件）**、`scripts/lib/paths.mjs`。

## 安装

安装、更新、卸载见仓库根目录的 [README](../README.md)。

`install.mjs`（可选，终端状态栏）只改 `settings.json` 的 `statusLine` 一个键（`--dry-run` 先看会改什么），写之前把 settings 备份成 `settings.json.bak-20261030`；原来如果有 statusLine，会存到 `~/.claude/dshx-claude/previous-statusline.json`，`uninstall.mjs` 时还原（`--purge` 顺便删缓存）。它把**自己所在目录**的 `statusline.mjs` 写进设置，所以要从不随版本变化的目录运行（市场克隆目录 `~/.claude/plugins/marketplaces/dshx-local/dshx-claude/`），不要从带版本号的 `plugins/cache/...` 运行。

## 细节

- **路径**：日志目录是 `$CLAUDE_CONFIG_DIR/projects`（未设置则 `~/.claude/projects`），递归包含子代理日志。插件自己的缓存（索引 `usage-index.json`、汇率 `rate-aud.json`）在 `$CLAUDE_CONFIG_DIR/dshx-claude/`，可用 `DSHX_CLAUDE_STATE` 覆盖。时区可用 `DSHX_TZ` 覆盖。
- **去重**：一次 API 响应在日志里按内容块写成多行，每行都带同样的 `usage`；按 `message.id + requestId` 跨文件去重（续接/分叉会话会复制旧行）。
- **增量**：索引按文件记 `(size, mtime, offset)`，日志只追加，所以长了的文件只从上次读到的字节往后读——状态栏每次刷新通常只读几 KB。
- **计价**：`pricing.mjs` 来自 <https://platform.claude.com/docs/en/about-claude/pricing>（2026-10-30 抓取）。四类 token 互斥；同时处理 Haiku 5.5 的 >100K 提示长档、fast mode、`inference_geo: "us"` ×1.1、web search $10/千次。旧日志没有 5m/1h 拆分的写缓存按 5m 计。表里没有的模型 id 记 $0 并在报表里点名。
- **AUD**：照 `rate.js`：两个独立来源（open.er-api.com、frankfurter/ECB），合理区间校验，24 h 磁盘缓存，失败用上次的值；从未取到过就不显示 AUD 列。状态栏只读缓存、不联网。
- **语言 hook 开关**：环境变量 `DSHX_LANGUAGE_MIRROR=off` 关闭，`DSHX_LANGUAGE_MIRROR_EXTRA` 追加规则，`DSHX_LANGUAGE_MIRROR_TEXT` 替换规则（对应原插件的 `enabled / extra / text` 配置）。
- **Windows**：hook 与状态栏都是 `node "<path>/scripts/…"`；状态栏命令用正斜杠，Git Bash 和 PowerShell 都能跑。

## 测试

```powershell
node tests/test-language.mjs   # 中文 / 英文 / 中英混合 hook JSON + 边界情况
node tests/test-usage.mjs      # 假 CLAUDE_CONFIG_DIR：去重、5m/1h、各种计价规则、费用拆分、增量索引、状态栏
claude plugin test .           # 侧边面板：桌面图 / 终端文字版 / 出错显示
node scripts/token-cost.mjs 30 # 真实日志近 30 天
```
