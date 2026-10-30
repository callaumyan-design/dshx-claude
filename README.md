# dshx-claude

Claude Code ports of the dshx DSH plugins: reply-language mirroring, a token-cost report, and a usage panel beside the chat.

把几个 dshx（DeepSeek Harness）插件移植到 Claude Code：

- **语言跟随**：每条消息都提醒 Claude 用你最后一条消息的语言回复，过程说明和最终报告也一样；中英混写时用中文回复，并保留你写的英文术语。
- **`/dshx-claude:token-cost [天数]`**：从本机 Claude Code 日志统计每天、每个模型用了多少 token，按 Anthropic API 标价折算成 USD（和 AUD）。
- **侧边用量面板**：会话开始自动打开在对话旁边，显示今日 / 近 7 天费用、较昨日涨跌、每日柱状图、模型占比、Token 构成、缓存命中率；每轮对话后刷新。关掉后用 `/usage-panel` 重新打开。
- **终端状态栏**（可选）：在终端里的 `claude` 底部显示本次会话费用、上下文占用、今日 token 和订阅额度。

费用是按 API 标价**折算**的，订阅（Pro / Max）不会按这个金额扣费。只统计 Claude Code 的用量，不含 claude.ai 普通聊天。

## 安装

需要 Node.js 18 以上，并且命令行里能直接运行 `node`。

在 Claude Code 里依次输入：

```
/plugin marketplace add callaumyan-design/dshx-claude
/plugin install dshx-claude@dshx-local
```

或者在终端里：

```bash
claude plugin marketplace add callaumyan-design/dshx-claude
claude plugin install dshx-claude@dshx-local --scope user
```

装好后开一个新对话（或输入 `/reload-plugins`），侧边面板就会出现。

**终端状态栏（可选）**：

```bash
node ~/.claude/plugins/marketplaces/dshx-local/dshx-claude/install.mjs
```

## 更新

```bash
claude plugin marketplace update dshx-local
claude plugin update dshx-claude@dshx-local
```

## 卸载

```bash
node ~/.claude/plugins/marketplaces/dshx-local/dshx-claude/uninstall.mjs
claude plugin uninstall dshx-claude@dshx-local --scope user
claude plugin marketplace remove dshx-local
```

第一行只在装过终端状态栏时需要。

## 说明

- 日志读取 `~/.claude/projects`（或 `$CLAUDE_CONFIG_DIR/projects`），只在本机读，不上传任何数据。汇率每天最多联网取一次（open.er-api.com / frankfurter）。
- 日期按 Australia/Brisbane 划分，可用环境变量 `DSHX_TZ` 改时区。
- 价格表在 `dshx-claude/scripts/lib/pricing.mjs`，来自 Anthropic 官方价格页（2026-10-30）。
- 更多细节（去重、计价规则、语言 hook 的开关、测试）见 [dshx-claude/README.md](dshx-claude/README.md)。

## License

MIT
