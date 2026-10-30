// Session Meter: one quiet answer to "keep going in this chat, or start fresh?"
// - Status line: how long the prompt cache stays warm, and how big the chat is.
// - Cold-send guard: once per cold spell, asks before a big chat is re-read at full price.
// - /handoff (or the band's button): writes a handoff brief and starts a fresh chat with it.
import type { Register, EngineInterface, RenderInput, RenderElement } from 'claude-code'

const MIN = 60_000
const HOUR = 60 * MIN
const TICK = 20_000
const GUARD_MIN_TOKENS = 20_000

const HANDOFF_PROMPT = `Write a handoff brief so a brand-new session, with no access to this conversation, can continue the work exactly where it stands.

Output Markdown only, with exactly these sections:
# Handoff: <short title>
## Goal
What we are trying to achieve and why it matters.
## Current state
What is done, what works, what has been verified, what is half-finished.
## Decisions and constraints
Choices made and the reasons; rules or preferences the person stated in this chat.
## Files and resources
Every file read, created or changed (full path, one line on its role), plus URLs, tools, skills and connectors used.
## Open issues
Bugs, unknowns, risks, anything blocked.
## Next steps
A numbered list, concrete and in order.

Be specific: exact paths, names, commands, numbers. No filler. Stay under 700 words.`

type Handoff =
  | { phase: 'writing' }
  | { phase: 'ready'; path: string; text: string }
  | { phase: 'failed'; reason: string }

const s = {
  ttl: HOUR,
  lastEnd: 0, // when the main thread last wrote the cache
  tokens: 0,
  window: 0,
  working: false,
  guarded: false, // asked once this cold spell
  offerDismissedAt: 0, // context size when "Not now" was pressed
  handoff: null as Handoff | null,
  threshold: 250_000,
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
function dur(ms: number) {
  const m = Math.max(0, Math.round(ms / MIN))
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`
}

let autoTtl = true

async function refreshUsage($: EngineInterface) {
  try {
    const u = await $.session.usage()
    s.tokens = u.context.tokens ?? s.tokens
    s.window = u.context.window
    // Subscriptions write a 1-hour cache and report rate-limit windows; API keys and
    // cloud providers write 5 minutes and report none. Until the first turn has
    // reported anything, assume the subscription.
    if (autoTtl && (u.rateLimits.length || s.lastEnd)) s.ttl = u.rateLimits.length ? HOUR : 5 * MIN
  } catch { /* keep the last numbers */ }
}

async function detectTtl($: EngineInterface, setting: string) {
  autoTtl = setting !== '1h' && setting !== '5m'
  if (setting === '5m') return 5 * MIN
  return HOUR
}

async function paintStatus($: EngineInterface) {
  if (!s.lastEnd) return $.ui.status(undefined)
  const left = s.lastEnd + s.ttl - (await $.clock.now())
  const cache = left > 0 ? `Cache warm · ${dur(left)} left` : 'Cache cold'
  $.ui.status(`${cache} · ${k(s.tokens)} context`)
}

async function startHandoff($: EngineInterface) {
  if (s.working) return $.ui.toast('Handoff: wait until Claude finishes this turn.')
  if (s.handoff?.phase === 'writing') return
  s.handoff = { phase: 'writing' }
  $.ui.invalidate('ui.render')
  try {
    const r = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!r.isAnswered) throw new Error(r.reason)
    const text = r.text.trim()
    const title = /^#\s*Handoff:\s*(.+)$/m.exec(text)?.[1] ?? 'session'
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'session'
    const d = new Date(await $.clock.now())
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
    const cwd = await $.session.cwd()
    const path = `${cwd}/.claude/handoffs/${stamp}-${slug}.md`
    await $.fs.write(path, text + '\n')
    s.handoff = { phase: 'ready', path, text }
  } catch (err) {
    s.handoff = { phase: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
  $.ui.invalidate('ui.render')
}

async function startFresh($: EngineInterface) {
  const ho = s.handoff
  if (ho?.phase !== 'ready') return
  s.handoff = null
  await $.command.run({ command: 'clear' })
  await $.prompt.fill({
    text: `Continue from the handoff brief below (saved at ${ho.path}). Start with "Next steps".\n\n${ho.text}`,
    mode: 'replace',
  })
}

function band($: EngineInterface, e: RenderInput & { component: 'AbovePrompt' }) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const row = (dot: string, color: string, text: string, sub: string, buttons: RenderElement[]) => (
    <Box key="session-meter" flexDirection="row" gap={1} alignItems="center">
      <Text color={color}>{dot}</Text>
      <Text wrap="truncate-end">
        {text}
        {sub ? <Text dimColor> · {sub}</Text> : null}
      </Text>
      {buttons}
    </Box>
  )
  const ho = s.handoff
  if (ho?.phase === 'writing') return row('●', 'claude', 'Writing handoff brief…', 'one model call over this chat', [])
  if (ho?.phase === 'failed')
    return row('●', 'error', 'Handoff failed', ho.reason, [
      <Button key="retry" plain hotkey="r" label="Retry" onPress={() => startHandoff($)} />,
      <Button key="dismiss" role="dismiss" label="Dismiss" onPress={() => { s.handoff = null; $.ui.invalidate('ui.render') }} />,
    ])
  if (ho?.phase === 'ready')
    return row('●', 'success', 'Handoff ready', ho.path.split(/[\\/]/).slice(-3).join('/'), [
      <Button key="fresh" variant="primary" hotkey="f" label="Start fresh chat" onPress={() => startFresh($)} />,
      <Button key="copy" hotkey="c" label="Copy" onPress={async () => {
        const r = await $.ui.copy({ text: ho.text, surface: e.surface })
        $.ui.toast(r.isCopied ? 'Handoff copied.' : 'Could not copy; the brief is saved in the file.')
      }} />,
      <Button key="dismiss" role="dismiss" label="Dismiss" onPress={() => { s.handoff = null; $.ui.invalidate('ui.render') }} />,
    ])
  if (s.tokens >= s.threshold && s.tokens >= s.offerDismissedAt + 100_000)
    return row('●', 'warning', `Long chat · ${k(s.tokens)} context`, 'a fresh chat keeps answers sharp', [
      <Button key="handoff" variant="primary" hotkey="h" label="Hand off" onPress={() => startHandoff($)} />,
      <Button key="later" role="dismiss" label="Not now" onPress={() => { s.offerDismissedAt = s.tokens; $.ui.invalidate('ui.render') }} />,
    ])
  return null
}

export const register: Register = (on, options) => {
  const ttlSetting = String(options?.cache_ttl ?? 'auto')
  s.threshold = Number(options?.handoff_at ?? 250_000) || 250_000

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    s.ttl = await detectTtl($, ttlSetting)
    await $.command.register({ name: 'handoff', description: 'Write a handoff brief and start a fresh chat with it' })
    $.clock.every(TICK, () => void paintStatus($).catch(() => undefined))
    return r
  })

  on('turn.start', ($, e, next) => {
    if (!e.agentId) s.working = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    s.working = false
    s.lastEnd = await $.clock.now()
    s.guarded = false
    await refreshUsage($)
    await paintStatus($)
    $.ui.invalidate('ui.render')
    return r
  })

  on('session.end', ($, e, next) => {
    // A /clear starts the chat over: nothing is cached any more.
    s.lastEnd = 0
    s.tokens = 0
    s.offerDismissedAt = 0
    $.ui.status(undefined)
    return next(e)
  })

  // The guard: once per cold spell, before a big chat is re-read at full price.
  on('prompt.submit', async ($, e, next) => {
    const person = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!person || e.isMeta) return next(e)
    if (e.command || s.guarded || !s.lastEnd || s.tokens < GUARD_MIN_TOKENS) return next(e)
    const now = await $.clock.now()
    if (now < s.lastEnd + s.ttl) return next(e)
    s.guarded = true
    const ratio = s.ttl === HOUR ? '~20×' : '~12×'
    let answer = ''
    try {
      answer = await $.ui.ask(
        `The cache went cold ${dur(now - s.lastEnd - s.ttl)} ago. Sending now re-reads ${k(s.tokens)} tokens at full price (${ratio} a warm message). Send it?`,
        { options: ['Send', 'Hand off instead', 'Cancel'], header: 'Cold cache' },
      )
    } catch {
      return next(e) // dismissed or no one to ask: never hold a prompt hostage
    }
    if (answer === 'Hand off instead') {
      void $.prompt.fill({ text: e.text, mode: 'replace' })
      $.clock.after(0, () => void startHandoff($))
      return { drop: 'Held: writing a handoff instead. Your message is back in the prompt box.' }
    }
    if (answer === 'Cancel') {
      void $.prompt.fill({ text: e.text, mode: 'replace' })
      return { drop: 'Not sent. Your message is back in the prompt box.' }
    }
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    $.clock.after(0, () => void startHandoff($))
    return { text: 'Writing a handoff brief. It appears above the prompt when ready.' }
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
