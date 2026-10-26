import { expect, mock, test } from 'claude-code/testing'
// Windows hands hooks C:\proj\a.txt for /proj/a.txt; compare the POSIX spelling.
const posix = (p: unknown) => String(p).replace(/^[A-Za-z]:/, '').split(String.fromCharCode(92)).join('/')

const TREE: Record<string, { name: string; kind: 'file' | 'dir'; size: number }[]> = {
  '/proj/sub/docs': [{ name: 'index.html', kind: 'file', size: 2000 }, { name: 'js', kind: 'dir', size: 0 }],
  '/proj/sub/docs/js': [{ name: 'app.js', kind: 'file', size: 50_000 }],
}

test('destructive commands are held with what they would destroy; harmless ones pass', async ($, on) => {
  mock.env(on, { HOME: '/home/g' })
  const asked: string[] = []
  let answer = 'Cancel'
  let ran = 0
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { startedAt: 1000, context: { tokens: 0, window: 1 }, rateLimits: [] } }) as never)
  on('fs.stat', (_, e) => (posix(e.path) in TREE ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : (() => { throw new Error('ENOENT') })()) as never)
  on('fs.list', (_, e) => ({ value: (TREE[posix(e.path)] ?? []).map(x => ({ ...x, mtimeMs: 0, isLink: false })) }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' M src/a.ts\n M src/b.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', (_, e) => {
    if (String(e.tool) === 'AskUserQuestion') {
      const q = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
      asked.push(q)
      return { result: { questions: [], answers: { [q]: answer } } } as never
    }
    ran += 1
    return { result: {} } as never
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf does-not-exist' })
  expect(asked.length).toBe(0)
  expect(ran).toBe(2)

  const held = await $.tool.call({ tool: 'Bash', command: 'cd sub && rm -rf docs' })
  expect(asked[0]).toMatch(/deletes 2 files \(52 KB\)/)
  expect(asked[0]).toMatch(/docs\/js\/app\.js/)
  expect(held.deny ?? held.text).toMatch(/chose not to run/)
  expect(ran).toBe(2)

  await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~1' })
  expect(asked[1]).toMatch(/2 files lose uncommitted changes/)

  await $.tool.call({ tool: 'Bash', command: 'rm -rf "$OUT_DIR"' })
  expect(asked[2]).toMatch(/could not measure/)

  answer = 'Run it'
  await $.tool.call({ tool: 'Bash', command: 'cd sub && rm -rf docs' })
  expect(ran).toBe(3)
})

test('scratch files made this session and build output go without asking', async ($, on) => {
  const NEW: Record<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number }[]> = {
    '/proj/mod-test': [{ name: 'hello.py', kind: 'file', size: 300, mtimeMs: 5000 }, { name: 'notes.md', kind: 'file', size: 700, mtimeMs: 5000 }],
    '/proj/build': [{ name: 'old.js', kind: 'file', size: 9000, mtimeMs: 0 }],
  }
  const asked: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => ({ value: { startedAt: 1000, context: { tokens: 0, window: 1 }, rateLimits: [] } }) as never)
  on('fs.stat', (_, e) => (posix(e.path) in NEW ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : (() => { throw new Error('ENOENT') })()) as never)
  on('fs.list', (_, e) => ({ value: (NEW[posix(e.path)] ?? []).map(x => ({ ...x, isLink: false })) }) as never)
  on('tool.call', (_, e) => {
    if (String(e.tool) === 'AskUserQuestion') { asked.push('q'); return { result: { questions: [], answers: {} } } as never }
    return { result: {} } as never
  })
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf mod-test' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(asked.length).toBe(0)
})
