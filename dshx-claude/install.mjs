#!/usr/bin/env node
// Point Claude Code's statusLine at this plugin's status-line script.
//
// A plugin cannot ship a statusLine (plugin settings only honour `agent` and
// `subagentStatusLine`), so this script edits the user settings file:
//
//   <CLAUDE_CONFIG_DIR or ~/.claude>/settings.json
//
// Before writing it copies the file to settings.json.bak-20261030 (only if
// that backup does not exist yet, so re-running never overwrites the
// original). Any statusLine that was there before is saved under
// <config>/dshx-claude/previous-statusline.json so uninstall.mjs can put it back.
//
// Usage: node install.mjs [--dry-run] [--refresh <seconds>]
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeConfigDir, stateDir } from './scripts/lib/paths.mjs'

const BACKUP_SUFFIX = '.bak-20261030'
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const refreshIdx = args.indexOf('--refresh')
const refresh = refreshIdx >= 0 ? Number(args[refreshIdx + 1]) : 60

const here = path.dirname(fileURLToPath(import.meta.url))
// Forward slashes: Claude Code runs statusLine through Git Bash on Windows when
// it is installed, and Bash would eat backslashes.
const script = path.join(here, 'scripts', 'statusline.mjs').replace(/\\/g, '/')
const statusLine = { type: 'command', command: `node "${script}"`, padding: 0 }
if (Number.isFinite(refresh) && refresh >= 1) statusLine.refreshInterval = Math.round(refresh)

const settingsPath = path.join(claudeConfigDir(), 'settings.json')
const backupPath = settingsPath + BACKUP_SUFFIX
const previousPath = path.join(stateDir(), 'previous-statusline.json')

let text = null
try { text = await fs.readFile(settingsPath, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
let settings = {}
if (text !== null && text.trim()) {
  try { settings = JSON.parse(text.replace(/^\uFEFF/, '')) } catch (e) {
    console.error(`✗ ${settingsPath} is not valid JSON (${e.message}); nothing changed.`)
    process.exit(1)
  }
}

const before = settings.statusLine
const already = JSON.stringify(before) === JSON.stringify(statusLine)
console.log(`settings file : ${settingsPath}`)
console.log(`statusLine was: ${before === undefined ? '(not set)' : JSON.stringify(before)}`)
console.log(`statusLine now: ${JSON.stringify(statusLine)}`)
if (already) {
  console.log('✓ already installed — no change.')
  process.exit(0)
}
if (dryRun) {
  console.log('(dry run — nothing written)')
  process.exit(0)
}

// 1. backup
if (text !== null) {
  try {
    await fs.access(backupPath)
    console.log(`backup        : ${backupPath} already exists — kept as is (original copy).`)
  } catch {
    await fs.writeFile(backupPath, text, 'utf8')
    console.log(`backup        : ${settingsPath} → ${backupPath}`)
  }
} else {
  console.log('backup        : settings.json did not exist — nothing to back up (it will be created).')
}

// 2. remember the previous statusLine for uninstall (never overwrite an earlier record
//    with our own value)
const isOurs = (v) => typeof v?.command === 'string' && v.command.includes('statusline.mjs') && v.command.includes('dshx-claude')
if (before !== undefined && !isOurs(before)) {
  await fs.mkdir(path.dirname(previousPath), { recursive: true })
  await fs.writeFile(previousPath, JSON.stringify({ savedAt: new Date().toISOString(), statusLine: before }, null, 2), 'utf8')
  console.log(`previous value: saved to ${previousPath}`)
}

// 3. write: only the statusLine key changes; every other key is preserved in order
settings.statusLine = statusLine
const tmp = settingsPath + '.dshx-tmp'
await fs.mkdir(path.dirname(settingsPath), { recursive: true })
await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
await fs.rename(tmp, settingsPath)
console.log('✓ changed      : added/replaced the "statusLine" key; no other key was touched.')
console.log('  Claude Code reloads settings automatically; new sessions show the status line immediately.')
