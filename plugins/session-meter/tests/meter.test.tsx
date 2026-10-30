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
