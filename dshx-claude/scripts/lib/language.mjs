// dshx-claude — language mirror: rule text + detection of the latest prompt's language.
//
// Ported from dshx-language-mirror (DSH/Cordis plugin). The DSH version
// registered DEFAULT_RULE as a permanent system-prompt section and left the
// detection to the model. Claude Code plugins cannot add system-prompt
// sections, so the port runs on every UserPromptSubmit and injects the same
// rule as additionalContext — plus an explicit "the latest message is in X"
// line computed here, because a hook can see the prompt the model is about to
// answer and the model then no longer has to guess from a long history.
//
// DEFAULT_RULE and buildRule() are copied verbatim from the original
// index.js so both hosts give the model the same instruction.

/** Default rule — identical to dshx-language-mirror/index.js DEFAULT_RULE. */
export const DEFAULT_RULE = [
  'LANGUAGE MIRROR (mandatory, highest priority among formatting rules):',
  '- Detect the language of the user\'s MOST RECENT message. Write your entire reply in that language, including the final report, summary, headings, tables, and status lines.',
  '- Mixed-language prompts (e.g. Chinese with English technical terms): reply in the dominant natural language and keep the same terms in English, mirroring the user\'s mix.',
  '- If the user switches language mid-conversation, switch immediately. The latest message wins over earlier history; an explicit instruction such as "reply in English" / "用中文回答" wins over everything.',
  '- The language of this system prompt, tool output, file contents, logs, web pages, and subagent/teammate reports does NOT decide the reply language. When relaying such material, translate your narration and summary into the user\'s language.',
  '- Keep verbatim (do not translate): code, commands, file paths, identifiers, config keys, error messages, and product/API names.',
  '- Do not announce the language choice; just answer in it.',
].join('\n')

/** Same contract as the original buildRule(config). */
export function buildRule(config = {}) {
  const base = typeof config.text === 'string' && config.text.trim() ? config.text.trim() : DEFAULT_RULE
  const extra = typeof config.extra === 'string' ? config.extra.trim() : ''
  return extra ? `${base}\n${extra}` : base
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

export const LANGS = {
  'zh-Hans': 'Simplified Chinese (简体中文)',
  'zh-Hant': 'Traditional Chinese (繁體中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  en: 'English',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Português)',
  it: 'Italian (Italiano)',
  ru: 'Russian (Русский)',
  ar: 'Arabic (العربية)',
  he: 'Hebrew (עברית)',
  th: 'Thai (ไทย)',
  hi: 'Hindi (हिन्दी)',
  el: 'Greek (Ελληνικά)',
}

/**
 * Remove what the rule says must not decide the language: pasted material,
 * code, commands, paths, URLs. Only the user's own prose should remain.
 */
export function stripNonProse(text) {
  return String(text ?? '')
    // Claude Code wraps pasted text in <pasted_content id="…"> … </pasted_content id="…">
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/gi, ' ')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[a-z][\w-]*(?:\s[^>]*)?>[\s\S]*?<\/[a-z][\w-]*>/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?:^|\s)@"[^"]*"/g, ' ')
    .replace(/(?:^|\s)@\S+/g, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s"'，。、；）)]*/g, ' ')
    .replace(/(?:^|\s)(?:~|\.{1,2})?\/[\w.\-/]+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/(?:^|\s)\/[\w:-]+/g, ' ') // slash commands
    .replace(/\$\{?[A-Z_][A-Z0-9_]*\}?/g, ' ')
}

const RE = {
  han: /\p{Script=Han}/gu,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  hangul: /\p{Script=Hangul}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  arabic: /\p{Script=Arabic}/gu,
  hebrew: /\p{Script=Hebrew}/gu,
  thai: /\p{Script=Thai}/gu,
  devanagari: /\p{Script=Devanagari}/gu,
  greek: /\p{Script=Greek}/gu,
}

// Characters that differ between the two Chinese scripts (common ones only).
const TRAD_ONLY = '們這個說會為來時麼國對還過學點體開關問題請將與從後應當實現讓檢測語輸試設計檔裡嗎單選擇並經驗證據帳號網頁裝載刪錄頭圖錯誤'
const SIMP_ONLY = '们这个说会为来时么国对还过学点体开关问题请将与从后应当实现让检测语输试设计档里吗单选择并经验证据帐号网页装载删录头图错误'

const STOPWORDS = {
  en: 'the and is are to of in it this that for with you what how can please my me be on not do does make',
  es: 'el la los las es son que de y en un una por para con no lo como qué por favor mi',
  fr: 'le la les est sont que de et en un une pour avec ne pas je vous comment mon il elle',
  de: 'der die das ist sind und zu von mit nicht ein eine ich sie wie bitte mein für auf',
  pt: 'o a os as é são que de e em um uma para com não você como meu por favor',
  it: 'il lo la gli le è sono che di e in un una per con non come mio per favore',
}

/** Fewer Latin words than this cannot decide the reply language on their own. */
const MIN_LATIN_WORDS = 3

/**
 * Score Latin-script text against tiny stop-word lists. English wins ties,
 * which matches how technical prompts are written in practice.
 */
function latinLanguage(words) {
  const lower = words.map((w) => w.toLowerCase())
  let best = 'en'
  let bestScore = 0
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list.split(' '))
    const score = lower.filter((w) => set.has(w)).length
    if (score > bestScore) {
      best = lang
      bestScore = score
    }
  }
  return best
}

/** An explicit language instruction wins over everything (original rule). */
const EXPLICIT = [
  [/(?:用|使用|请用|請用|以)\s*(?:简体|簡體)?\s*(?:中文|汉语|漢語|普通话)\s*(?:回答|回复|回覆|作答|写|輸出|输出|说|說)/, 'zh-Hans'],
  [/(?:用|使用|請用)\s*(?:繁体|繁體)(?:中文)?\s*(?:回答|回复|回覆|作答)/, 'zh-Hant'],
  [/(?:用|使用|请用|請用)\s*(?:英文|英语|英語)\s*(?:回答|回复|回覆|作答|写|输出|說|说)/, 'en'],
  [/(?:用|使用|请用)\s*(?:日文|日语|日語)\s*(?:回答|回复|回覆)/, 'ja'],
  [/(?:用|使用|请用)\s*(?:韩文|韩语|韓語)\s*(?:回答|回复|回覆)/, 'ko'],
  [/\b(?:reply|respond|answer|write|speak|talk)(?:\s+to\s+me)?\s+in\s+(english|chinese|mandarin|japanese|korean|spanish|french|german|portuguese|italian|russian)\b/i, null],
]
const EN_NAME = { english: 'en', chinese: 'zh-Hans', mandarin: 'zh-Hans', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', russian: 'ru' }

function explicitLanguage(text) {
  for (const [re, lang] of EXPLICIT) {
    const m = re.exec(text)
    if (m) return lang ?? EN_NAME[m[1].toLowerCase()]
  }
  return null
}

/**
 * Detect the reply language for one prompt.
 * @returns {{lang: string|null, name: string|null, mixedWith: string|null, explicit: boolean, units: object}}
 */
export function detectLanguage(prompt) {
  const raw = String(prompt ?? '')
  const explicit = explicitLanguage(raw)
  const prose = stripNonProse(raw)

  const count = (re) => (prose.match(re) ?? []).length
  const han = count(RE.han)
  const kana = count(RE.kana)
  const hangul = count(RE.hangul)
  const latinWords = (prose.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) ?? [])

  // Information density: one CJK character carries roughly 0.6 of an English
  // word, so weight characters down before comparing scripts.
  const units = {
    zh: kana > 0 ? 0 : han * 0.6,
    ja: kana > 0 ? (han + kana) * 0.6 : 0,
    ko: hangul * 0.6,
    latin: latinWords.length,
    ru: count(RE.cyrillic) / 5,
    ar: count(RE.arabic) / 5,
    he: count(RE.hebrew) / 5,
    th: count(RE.thai) / 4,
    hi: count(RE.devanagari) / 5,
    el: count(RE.greek) / 5,
  }

  const ranked = Object.entries(units).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((s, [, v]) => s + v, 0)

  const resolve = (script) => {
    if (script === 'zh') {
      const trad = [...prose].filter((c) => TRAD_ONLY.includes(c)).length
      const simp = [...prose].filter((c) => SIMP_ONLY.includes(c)).length
      return trad > simp ? 'zh-Hant' : 'zh-Hans'
    }
    if (script === 'latin') return latinLanguage(latinWords)
    return script
  }

  // One or two Latin words ("ok", "yes", "lgtm", "go ahead") are acknowledgements
  // or terms, not a language switch: they never pick the reply language, but can
  // still count as the mixed-in terms.
  const primary = ranked.filter(([script]) => script !== 'latin' || latinWords.length >= MIN_LATIN_WORDS)

  let lang = null
  let mixedWith = null
  if (primary.length > 0 && total >= 1) {
    lang = resolve(primary[0][0])
    // A second script counts as "mixed in" once it is a noticeable share.
    const second = ranked.find(([script]) => script !== primary[0][0])
    if (second && second[1] / total >= 0.04 && second[1] >= 0.6) {
      mixedWith = resolve(second[0])
      if (mixedWith === lang) mixedWith = null
    }
  }

  if (explicit) {
    return { lang: explicit, name: LANGS[explicit] ?? explicit, mixedWith: null, explicit: true, units }
  }
  return { lang, name: lang ? (LANGS[lang] ?? lang) : null, mixedWith, explicit: false, units }
}

/**
 * The additionalContext string injected for one prompt.
 * @param prompt - the submitted prompt text.
 * @param config - {text, extra} like the original plugin's Config.
 */
export function buildContext(prompt, config = {}) {
  const d = detectLanguage(prompt)
  const lines = [buildRule(config), '']
  if (d.lang === null) {
    lines.push('Detected language of the latest user message: none (no natural-language text, e.g. only a command, path, or code). Keep replying in the language of the user\'s most recent natural-language message.')
  } else if (d.explicit) {
    lines.push(`The latest user message explicitly asks for ${d.name}. Reply in ${d.name} — including every progress update, the final report, and summaries.`)
  } else if (d.mixedWith) {
    const other = LANGS[d.mixedWith] ?? d.mixedWith
    lines.push(`Detected language of the latest user message: ${d.name}, mixed with ${other} terms. Reply in ${d.name} — including every progress update, the final report, and summaries — and keep the ${other} terms the user used as they wrote them.`)
  } else {
    lines.push(`Detected language of the latest user message: ${d.name}. Reply in ${d.name} — including every progress update, the final report, and summaries.`)
  }
  return { context: lines.join('\n'), detection: d }
}
