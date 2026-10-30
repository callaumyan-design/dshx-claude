#!/usr/bin/env node
// UserPromptSubmit hook: inject the language-mirror rule plus the detected
// language of the prompt being submitted.
//
// Input  (stdin): Claude Code hook JSON, with `prompt`.
// Output (stdout): {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}
//
// Never blocks and never fails the prompt: any error exits 0 with no output.
//
// Environment knobs (same meaning as the original Cordis Config):
//   DSHX_LANGUAGE_MIRROR=off            disable
//   DSHX_LANGUAGE_MIRROR_EXTRA="…"      appended to the default rule
//   DSHX_LANGUAGE_MIRROR_TEXT="…"       replaces the default rule
import { buildContext } from './lib/language.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  if (String(process.env.DSHX_LANGUAGE_MIRROR ?? '').toLowerCase() === 'off') process.exit(0)
  const raw = await readStdin()
  let input = {}
  try { input = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch { input = {} }
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const { context } = buildContext(prompt, {
    text: process.env.DSHX_LANGUAGE_MIRROR_TEXT,
    extra: process.env.DSHX_LANGUAGE_MIRROR_EXTRA,
  })
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }))
} catch {
  // A broken hook must not stand between the user and the model.
}
process.exit(0)
