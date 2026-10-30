// dshx-claude — where Claude Code keeps its data, and where this plugin keeps its own.
import os from 'node:os'
import path from 'node:path'

/** Claude Code config dir: $CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir() {
  const v = process.env.CLAUDE_CONFIG_DIR
  return typeof v === 'string' && v.trim() ? path.resolve(v.trim()) : path.join(os.homedir(), '.claude')
}

/** Session logs live in <config>/projects/<project>/**.jsonl. */
export function projectsDir() {
  return path.join(claudeConfigDir(), 'projects')
}

/**
 * This plugin's own state (usage index + exchange-rate cache).
 *
 * A fixed path under the config dir rather than ${CLAUDE_PLUGIN_DATA}: the
 * status line runs from settings.json and the /token-cost skill runs through
 * the Bash tool, and neither receives CLAUDE_PLUGIN_DATA. Both must share one
 * cache. DSHX_CLAUDE_STATE overrides it (tests use a temp dir, like
 * DSHX_TOKEN_COST_STATE in the DSH plugin).
 */
export function stateDir() {
  const v = process.env.DSHX_CLAUDE_STATE
  if (typeof v === 'string' && v.trim()) return path.resolve(v.trim())
  return path.join(claudeConfigDir(), 'dshx-claude')
}

/** Report time zone for day buckets. */
export const TIME_ZONE = process.env.DSHX_TZ || 'Australia/Brisbane'
