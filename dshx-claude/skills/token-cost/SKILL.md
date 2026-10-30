---
name: token-cost
description: Show Claude Code token usage per day × model from local session logs, priced at Anthropic API list prices (USD, plus AUD). Use when the user asks how many tokens they used, what their Claude Code usage would cost at API prices, or runs /token-cost [days].
argument-hint: "[days]"
---

The report below was generated just now by `scripts/token-cost.mjs` from the local session logs (`$CLAUDE_CONFIG_DIR` or `~/.claude`, `projects/**/*.jsonl`), de-duplicated by `message.id + requestId`, bucketed by Australia/Brisbane date × model. Default window is 7 days; the user's argument (if any) is the number of days.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/token-cost.mjs" $ARGUMENTS`

Present this report to the user. Keep the tables as they are (you may drop all-zero day rows when the window is long), then add at most three short observations — e.g. the most expensive day, which model dominates, cache hit rate. Write all narration in the user's language. Do not re-run the script unless the user asks for a different window.
