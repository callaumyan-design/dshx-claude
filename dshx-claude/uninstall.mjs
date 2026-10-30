#!/usr/bin/env node
// Undo install.mjs: remove the dshx-claude statusLine from settings.json and
// restore whatever statusLine was there before (if install.mjs recorded one).
//
// Backs the file up to settings.json.bak-20261030 first if that backup does
// not exist yet. Only touches `statusLine`, and only when it still points at
// this plugin — a statusLine you changed by hand afterwards is left alone.
//
// Usage: node uninstall.mjs [--dry-run] [--purge]   (--purge also deletes the usage index/rate cache)
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { claudeConfigDir, stateDir } from './scripts/lib/paths.mjs'

const BACKUP_SUFFIX = '.bak-20261030'
const dryRun = process.argv.includes('--dry-run')
const purge = process.argv.includes('--purge')

const settingsPath = path.join(claudeConfigDir(), 'settings.json')
const backupPath = settingsPath + BACKUP_SUFFIX
const previousPath = path.join(stateDir(), 'previous-statusline.json')

let text
try { text = await fs.readFile(settingsPath, 'utf8') } catch {
  console.log(`${settingsPath} not found — nothing to do.`)
  process.exit(0)
}
const settings = JSON.parse(text.replace(/^\uFEFF/, '') || '{}')
const current = settings.statusLine
const isOurs = typeof current?.command === 'string' && current.command.includes('statusline.mjs') && current.command.includes('dshx-claude')

console.log(`settings file : ${settingsPath}`)
console.log(`statusLine is : ${current === undefined ? '(not set)' : JSON.stringify(current)}`)
if (!isOurs) {
  console.log('✓ statusLine is not the dshx-claude one — left unchanged.')
} else {
  let previous
  try { previous = JSON.parse(await fs.readFile(previousPath, 'utf8')).statusLine } catch { previous = undefined }
  console.log(`restoring to  : ${previous === undefined ? '(remove key)' : JSON.stringify(previous)}`)
  if (dryRun) {
    console.log('(dry run — nothing written)')
  } else {
    try { await fs.access(backupPath); console.log(`backup        : ${backupPath} already exists — kept.`) } catch {
      await fs.writeFile(backupPath, text, 'utf8')
      console.log(`backup        : ${settingsPath} → ${backupPath}`)
    }
    if (previous === undefined) delete settings.statusLine
    else settings.statusLine = previous
    const tmp = settingsPath + '.dshx-tmp'
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    await fs.rename(tmp, settingsPath)
    console.log('✓ changed      : only the "statusLine" key.')
  }
}

if (purge && !dryRun) {
  await fs.rm(stateDir(), { recursive: true, force: true })
  console.log(`✓ removed state dir ${stateDir()}`)
}
console.log('\nTo remove the plugin itself (hook + /token-cost):')
console.log('  claude plugin uninstall dshx-claude@dshx-local --scope user')
console.log('  claude plugin marketplace remove dshx-local')
