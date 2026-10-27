// Reflect: when you correct Claude, offer to keep the fix as a lasting rule.
// A free local keyword check runs on every prompt; only a likely correction costs
// one small Haiku call, which drafts the rule. Nothing is written until you choose.
import type { Register, EngineInterface, RenderInput, RenderElement } from 'claude-code'

const HINTS = [
  /\b(no|nope|wrong|incorrect)\b[,.!:\s-]/i,
  /\b(don'?t|do not|never|stop|quit)\b/i,
  /\b(always|from now on|going forward|in future|next time|every time)\b/i,
  /\b(instead|rather than|not like that|that'?s not)\b/i,
  /\bI (told|said|asked|prefer|want|like|hate)\b/i,
  /\b(please )?(remember|keep in mind)\b/i,
  /\buse \S+.{0,30}\bnot\b/i,
]
const HEADING = '## Rules from corrections'

type Draft = { rule: string; scope: 'project' | 'global' }
const s = {
  draft: null as Draft | null,
  editing: false,
  gen: 0,
  home: '',
  cwd: '',
}

const looksLikeCorrection = (t: string) => t.length >= 8 && t.length <= 1500 && !t.startsWith('/') && HINTS.some(re => re.test(t))
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const fileFor = (scope: Draft['scope']) => (scope === 'project' ? `${s.cwd}/CLAUDE.md` : `${s.home}/.claude/CLAUDE.md`)
const label = (scope: Draft['scope']) => (scope === 'project' ? 'project CLAUDE.md' : 'global CLAUDE.md')

function prompt(message: string, reply: string, existing: string) {
  return `A person wrote this to an AI coding assistant:
<message>${message}</message>
The assistant's previous reply, for context:
<reply>${reply}</reply>
The instructions the assistant already follows (its CLAUDE.md files):
<existing>${existing || '(none)'}</existing>

Does the message state a lasting rule or preference the assistant should follow in future sessions? Corrections like "no, always use pnpm here" or "never use em dashes" count. A one-off instruction about the current task does not. If the existing instructions already say the same thing, even in different words, it does not count either.

Answer with JSON only, no prose:
{"rule": "<one imperative sentence under 20 words, generalised beyond this task>", "scope": "project" | "global"}
or {"rule": null}
Use "project" when the rule is about this codebase or project (its tools, files, conventions); "global" when it is about the person's general style or preferences.`
}

async function check($: EngineInterface, text: string, mine: number) {
  if (!looksLikeCorrection(text)) return
  const messages = await $.session.messages()
  const reply = [...messages].reverse().find(m => m.role === 'assistant')?.text ?? ''
  // Both CLAUDE.md files go to the model, so a rule already there in other words is skipped.
  const files: string[] = []
  for (const sc of ['project', 'global'] as const) {
    const path = fileFor(sc)
    if (await $.fs.exists(path)) files.push(String(await $.fs.read(path)))
  }
  const existing = files.map(f => f.trim().slice(-4000)).filter(Boolean).join('\n\n---\n\n')
  const r = await $.model.complete({ model: 'haiku', prompt: prompt(text, reply.slice(-800), existing), maxTokens: 150, timeoutMs: 20_000 })
  if (!r.isAnswered || mine !== s.gen) return
  const json = /\{[\s\S]*\}/.exec(r.text)?.[0]
  if (!json) return
  const parsed = JSON.parse(json) as { rule?: string | null; scope?: string }
  const rule = parsed.rule?.trim()
  if (!rule) return
  const scope: Draft['scope'] = parsed.scope === 'project' ? 'project' : 'global'
  // Exact repeat the model missed? Then say nothing.
  if (files.some(f => norm(f).includes(norm(rule)))) return
  s.draft = { rule, scope }
  s.editing = false
  $.ui.invalidate('ui.render')
}

async function save($: EngineInterface, rule: string, scope: Draft['scope']) {
  const path = fileFor(scope)
  try {
    const before = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const line = `- ${rule.trim().replace(/^[-*]\s*/, '')}`
    const next = before.includes(HEADING)
      ? before.replace(HEADING, `${HEADING}\n${line}`)
      : `${before.replace(/\s*$/, '')}${before.trim() ? '\n\n' : ''}${HEADING}\n${line}\n`
    await $.fs.write(path, next)
    $.ui.toast(`Saved to ${label(scope)}.`)
  } catch (err) {
    $.ui.toast(`Could not save the rule: ${err instanceof Error ? err.message : String(err)}`)
  }
  s.draft = null
  s.editing = false
  $.ui.invalidate('ui.render')
}

function band($: EngineInterface, e: RenderInput & { component: 'AbovePrompt' }): RenderElement | null {
  const d = s.draft
  if (!d) return null
  const table = $.ui.resolve(e)
  const { Box, Text, Button } = table
  const Input = 'Input' in table ? table.Input : undefined
  const skip = () => { s.draft = null; s.editing = false; $.ui.invalidate('ui.render') }
  if (s.editing && Input) {
    return (
      <Box key="reflect" flexDirection="column">
        <Text dimColor>Edit the rule, then press Enter to save it to your {label(d.scope)}.</Text>
        <Input key="rule" value={d.rule} autoFocus submitLabel="Save" onSubmit={(v: string) => void save($, v || d.rule, d.scope)} />
      </Box>
    )
  }
  const other: Draft['scope'] = d.scope === 'project' ? 'global' : 'project'
  return (
    <Box key="reflect" flexDirection="row" gap={1} alignItems="center">
      <Text color="claude">◆</Text>
      <Text wrap="truncate-end">
        <Text dimColor>Save as a rule? </Text>“{d.rule}”
      </Text>
      <Button key="save" variant="primary" hotkey="s" label={d.scope === 'project' ? 'This project' : 'Everywhere'} onPress={() => void save($, d.rule, d.scope)} />
      <Button key="other" hotkey="o" label={other === 'project' ? 'This project' : 'Everywhere'} onPress={() => void save($, d.rule, other)} />
      {Input ? <Button key="edit" hotkey="e" label="Edit" onPress={() => { s.editing = true; $.ui.invalidate('ui.render') }} /> : null}
      <Button key="skip" role="dismiss" label="Skip" onPress={skip} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    s.cwd = e.cwd
    s.home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? $.plugin.root.split(/[\\/]\.claude[\\/]/)[0] ?? ''
    return r
  })

  on('prompt.submit', ($, e, next) => {
    const person = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (person && !e.isMeta && !e.command) {
      const mine = ++s.gen
      if (s.draft) { s.draft = null; $.ui.invalidate('ui.render') }
      // In the background: the prompt is never held for this.
      const text = e.text
      $.clock.after(0, () => void check($, text, mine).catch(() => undefined))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const mine = band($, e)
    if (!mine) return below
    const { Box } = $.ui.resolve(e)
    return below ? <Box flexDirection="column">{below}{mine}</Box> : mine
  })
}
