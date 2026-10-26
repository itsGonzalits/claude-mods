import { expect, mock, test } from 'claude-code/testing'

const BAND = { plugin: 'activity-panel', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 90, scroll: { offset: 0, bodyRows: 9 }, view: {} } } as const
const PANE = { plugin: 'activity-panel', component: 'Pane', requestId: 'activity', props: { title: 'Activity', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const

test('tasks, agents, files and tools show in the band and the pane', async ($, on) => {
  mock.clock(on, { now: 0 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Research cache pricing', type: 'general-purpose', status: 'running' }] }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })
  on('tool.call', (_, e) => (String(e.tool) === 'Agent' ? { result: { agentId: 'a1', status: 'async_launched' } } : { result: {} }) as never)

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'Plan', status: 'completed', activeForm: 'Planning' },
    { content: 'Build', status: 'in_progress', activeForm: 'Building the mods' },
    { content: 'Test', status: 'pending', activeForm: 'Testing' },
  ] })
  await $.tool.call({ tool: 'Agent', description: 'Research cache pricing', prompt: 'x', subagent_type: 'general-purpose' })
  await $.tool.call({ tool: 'Read', file_path: '/proj/src/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/b.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Skill', skill: 'docx' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Building the mods/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /1 agent running/ })).toBeDefined()
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ text: /Research cache pricing/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /src\/b\.ts/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /skill docx 1/ })).toBeDefined()
    expect(await pane.find({ text: /Researcher/ })).toBeDefined()
    if (surface === 'desktop') expect(await pane.find({ type: 'Svg' })).toBeDefined()
    else expect(await pane.find({ type: 'Text', text: /🔬/ })).toBeDefined()
    await pane.unmount()
  }
})

test('a session without a todo tool gets one from the mod, and it fills the progress bar', async ($, on) => {
  mock.clock(on, { now: 0 })
  const registered: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.list', () => ({ value: [{ name: 'Read' }, { name: 'Bash' }] }) as never)
  on('tool.register', (_, e) => { registered.push(e.name); return { value: { tool: `mcp__activity-panel__${e.name}` } } as never })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e); return <Box /> })

  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  expect(registered).toEqual(['todo'])

  const r = await $.tool.call({ tool: 'mcp__activity-panel__todo', todos: [
    { content: 'Make files', status: 'completed', activeForm: 'Making files' },
    { content: 'Run agents', status: 'in_progress', activeForm: 'Running the agents' },
  ] } as never)
  expect(String(r.result)).toMatch(/1\/2 done/)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Running the agents/ })).toBeDefined()
  await band.unmount()
})
