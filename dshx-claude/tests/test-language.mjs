// node tests/test-language.mjs — feeds real hook JSON to scripts/language-mirror.mjs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectLanguage, buildRule, DEFAULT_RULE } from '../scripts/lib/language.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hook = path.join(root, 'scripts', 'language-mirror.mjs')

function runHook(prompt) {
  const input = JSON.stringify({ session_id: 't', transcript_path: 'x.jsonl', cwd: 'F:/ds', hook_event_name: 'UserPromptSubmit', prompt })
  const r = spawnSync(process.execPath, [hook], { input, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  return out.hookSpecificOutput.additionalContext
}

const cases = [
  ['中文', '帮我看看这个函数为什么报错，然后修好它。', /Simplified Chinese/, /mixed/],
  ['English', 'Please refactor the parser and explain what changed in the final summary.', /Detected language of the latest user message: English\./, null],
  ['中英混合', '把 README.md 里的 install steps 更新一下，顺便跑一下 npm test 看看 CI 会不会 fail', /Simplified Chinese \(简体中文\), mixed with English/, null],
]
for (const [name, prompt, must, mustNot] of cases) {
  const ctx = runHook(prompt)
  assert.ok(ctx.startsWith(DEFAULT_RULE), name + ': rule first')
  assert.match(ctx, must, name)
  if (mustNot) assert.doesNotMatch(ctx, mustNot, name)
  console.log(`--- ${name}: ${prompt}\n${ctx.split('\n').at(-1)}\n`)
}

// Paths, code and pasted content do not decide the language.
assert.equal(detectLanguage('看下 `const x = foo()` 和 F:\\ds\\outputs\\a.txt 有什么问题').lang, 'zh-Hans')
assert.equal(detectLanguage('这段报错：\n```\nTypeError: Cannot read properties of undefined (reading map) at render\n```\n怎么回事').mixedWith, null)
assert.equal(detectLanguage('<pasted_content id="1">\nThe quick brown fox jumps over the lazy dog many times over\n</pasted_content id="1">\n总结一下').lang, 'zh-Hans')
// Explicit instruction wins.
assert.equal(detectLanguage('这个问题 reply in English please').lang, 'en')
assert.equal(detectLanguage('Explain this bug, 用中文回答').lang, 'zh-Hans')
// Others.
assert.equal(detectLanguage('這個問題請幫我檢查一下').lang, 'zh-Hant')
assert.equal(detectLanguage('このバグを直してください').lang, 'ja')
assert.equal(detectLanguage('이 버그를 고쳐 주세요').lang, 'ko')
assert.equal(detectLanguage('Peux-tu corriger ce bug et me dire pourquoi il est là').lang, 'fr')
assert.equal(detectLanguage('/token-cost 30').lang, null)
// Short Latin acknowledgements keep the previous language instead of switching to English.
for (const p of ['ok', 'OK', 'yes', 'lgtm', 'go ahead', 'thanks!']) assert.equal(detectLanguage(p).lang, null, p)
assert.match(runHook('ok'), /none/)
assert.equal(detectLanguage('好 ok').lang, 'zh-Hans')
assert.equal(detectLanguage('ok 继续').lang, 'zh-Hans')
assert.equal(detectLanguage('修一下 bug').mixedWith, 'en')
// Three or more words still switch.
assert.equal(detectLanguage('fix the build').lang, 'en')
assert.equal(detectLanguage('ok, go ahead').lang, 'en')
assert.match(runHook('/token-cost 30'), /none/)
// Original buildRule contract.
assert.equal(buildRule({ text: 'X', extra: 'Y' }), 'X\nY')
assert.match(buildRule({ extra: '报告结尾加一句总结' }), /报告结尾加一句总结$/)
// Bad stdin never breaks the prompt.
const bad = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' })
assert.equal(bad.status, 0)
console.log('ok')
