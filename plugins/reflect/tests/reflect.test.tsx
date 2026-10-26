import { expect, mock, test } from 'claude-code/testing'
// Windows hands hooks C:\proj\a.txt for /proj/a.txt; compare the POSIX spelling.
const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').split(String.fromCharCode(92)).join('/')

const BAND = { plugin: 'reflect', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} } } as const

test('a correction becomes a rule offer, saved under a heading in the project CLAUDE.md', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/home/g' })
  const files: Record<string, string> = { '/proj/CLAUDE.md': '# Project\n' }
  let calls = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: 'I ran npm install.', toolUses: [] }] }) as never)
  on('model.complete', () => { calls += 1; return { value: { isAnswered: true, text: '{"rule": "Use pnpm, never npm, in this repo.", "scope": "project"}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })
  on('fs.exists', (_, e) => ({ value: posix(e.path) in files }))
  on('fs.read', (_, e) => ({ value: files[posix(e.path)] ?? '' }) as never)
  on('fs.write', (_, e) => { files[posix(e.path)] = String(e.text); return { value: undefined } })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'make the header blue', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(calls).toBe(0) // no hint words: no model call at all

  await $.prompt.submit({ text: 'no, always use pnpm here, not npm', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(calls).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Use pnpm, never npm/ })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'save' })
  expect(files['/proj/CLAUDE.md']).toBe('# Project\n\n## Rules from corrections\n- Use pnpm, never npm, in this repo.\n')
  await ui.unmount()

  // The same rule again: already saved, so no offer.
  await $.prompt.submit({ text: 'no, always use pnpm here, not npm', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await again.find({ type: 'Text', text: /Save as a rule/ })).toBeUndefined()
  await again.unmount()
})
