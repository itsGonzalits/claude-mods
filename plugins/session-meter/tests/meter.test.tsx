import { expect, mock, test } from 'claude-code/testing'
// Windows hands hooks C:\proj\a.txt for /proj/a.txt; compare the POSIX spelling.
const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').split(String.fromCharCode(92)).join('/')
import type { On } from 'claude-code'

const BAND = {
  plugin: 'session-meter',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

function world(on: On, tokens: number) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10, source: 'test' }] } }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
function answer(on: On, label: string, asked: string[]) {
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    asked.push(q)
    return { result: { questions: [], answers: { [q]: label } } } as never
  })
}
const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('a long chat offers a handoff, which writes the brief and shows it ready', async ($, on) => {
  world(on, 300_000)
  mock.clock(on, { now: 1_000_000 })
  const writes: string[] = []
  on('model.fork', () => ({ value: { isAnswered: true, text: '# Handoff: Ship mods\n## Goal\nx', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('fs.write', (_, e) => { writes.push(posix(e.path)); return { value: undefined } })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Long chat · 300k context/ }))).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'handoff' })
  expect(await ui.find({ type: 'Text', text: /Handoff ready/ })).toBeDefined()
  expect(writes[0]).toMatch(/^\/proj\/\.claude\/handoffs\/.*-ship-mods\.md$/)
  await ui.unmount()
})

test('a cold cache holds the next message once and can cancel it', async ($, on) => {
  world(on, 120_000)
  const clock = mock.clock(on, { now: 1_000_000 })
  const asked: string[] = []
  answer(on, 'Cancel', asked)
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)

  await clock.advance(30 * 60_000)
  const warm = await $.prompt.submit({ text: 'still warm', wait: false, origin: { kind: 'composer' } })
  expect('drop' in warm).toBe(false)

  await clock.advance(2 * 60 * 60_000)
  const cold = await $.prompt.submit({ text: 'hello again', wait: false, origin: { kind: 'composer' } })
  expect(asked.join(' ')).toMatch(/re-reads 120k tokens/)
  expect('drop' in cold).toBe(true)
})

test('/keepwarm pings before the cache would go cold, and stops when the person is back', async ($, on) => {
  world(on, 80_000)
  const clock = mock.clock(on, { now: 1_000_000 })
  let pings = 0
  on('model.fork', () => { pings += 1; return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 0 } } } })
  on('command.run', () => ({ text: '' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.turn.complete(done)
  const r = await $.command.run({ command: 'keepwarm', args: '3h', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toMatch(/for 3h/)
  for (let i = 0; i < 9 * 6; i++) await clock.advance(20_000) // 18 minutes past the hour mark
  await clock.advance(60 * 60_000)
  expect(pings).toBeGreaterThanOrEqual(1)
  const before = pings
  await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } })
  for (let i = 0; i < 6 * 60; i++) await clock.advance(20_000)
  expect(pings).toBe(before)
})
