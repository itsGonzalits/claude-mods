// Activity Panel: what Claude is doing in this chat, without reading the transcript.
// - Band above the prompt while work is under way: task progress and running agents.
// - /activity pane: tasks, subagents (click one to watch it), files, tools and skills.
// Watches tool calls only; no model calls, no files written.
import type { Register, EngineInterface, RenderInput, RenderElement } from 'claude-code'

const PANE = 'activity'
type Task = { id: string; subject: string; active: string; status: 'pending' | 'in_progress' | 'completed' }

// Each subagent is drawn as a tiny Claude dressed for its job: a lab coat for research,
// a hard hat for building, a detective hat for searching... Animated while it runs.
type Role = 'research' | 'explore' | 'build' | 'review' | 'plan' | 'write' | 'data' | 'web' | 'work'
const ROLES: { role: Role; label: string; glyph: string; words: RegExp }[] = [
  { role: 'research', label: 'Researcher', glyph: '🔬', words: /\b(medic\w*|clinic\w*|health|drug|disease|bio\w*|chem\w*|scien\w*|lab|study|studies|research\w*|papers?|literature|pharma\w*|patient)\b/i },
  { role: 'review', label: 'Reviewer', glyph: '🧐', words: /\b(review\w*|audit\w*|verif\w*|test\w*|check\w*|security|vulnerab\w*|lint|qa|critique|grade|judge)\b/i },
  { role: 'plan', label: 'Planner', glyph: '💡', words: /\b(plan\w*|design\w*|architect\w*|strateg\w*|roadmap|brainstorm\w*|outline)\b/i },
  { role: 'data', label: 'Analyst', glyph: '📊', words: /\b(analy\w*|data|stats?|statistic\w*|metric\w*|chart\w*|numbers|spreadsheet|csv|benchmark\w*|measure\w*)\b/i },
  { role: 'web', label: 'Browser', glyph: '🌐', words: /\b(web|browse\w*|online|internet|news|fetch\w*|url|site|pricing|prices)\b/i },
  { role: 'explore', label: 'Explorer', glyph: '🔎', words: /\b(explore\w*|search\w*|find\w*|locate\w*|look\w*|investigat\w*|scan\w*|map\w*|trace\w*|discover\w*)\b/i },
  { role: 'write', label: 'Writer', glyph: '✍️', words: /\b(writ\w*|draft\w*|docs?|document\w*|summar\w*|explain\w*|readme|copy|email|blog|translat\w*)\b/i },
  { role: 'build', label: 'Builder', glyph: '🔧', words: /\b(build\w*|implement\w*|fix\w*|code|coding|refactor\w*|develop\w*|migrat\w*|debug\w*|install\w*|setup|set up|deploy\w*|port)\b/i },
]
const TYPE_ROLE: Record<string, Role> = { explore: 'explore', plan: 'plan', 'claude-code-guide': 'write', 'statusline-setup': 'build' }

function roleOf(type: string, description: string, prompt: string): Role {
  // The description says what this agent is for; the prompt only breaks a tie.
  for (const text of [description, `${description} ${prompt.slice(0, 400)}`])
    for (const r of ROLES) if (r.words.test(text)) return r.role
  return TYPE_ROLE[type.toLowerCase()] ?? 'work'
}
const roleInfo = (role: Role) => ROLES.find(r => r.role === role) ?? { role, label: 'Worker', glyph: '💻' }

const ORANGE = '#D97757'
const INK = '#2B1D16'
const spin = (cx: number, cy: number, from: number, to: number, dur: string) =>
  `<animateTransform attributeName="transform" type="rotate" values="${from} ${cx} ${cy};${to} ${cx} ${cy};${from} ${cx} ${cy}" dur="${dur}" repeatCount="indefinite"/>`

function outfit(role: Role, live: boolean) {
  const a = (s: string) => (live ? s : '')
  switch (role) {
    case 'research': return `
      <rect x="10" y="26" width="28" height="9" fill="#F5F5F2"/><polygon points="19,26 24,32 29,26" fill="${ORANGE}"/>
      <rect x="31" y="28" width="4" height="3" fill="none" stroke="#9DB4C0" stroke-width=".8"/><rect x="31.6" y="26.6" width=".8" height="2.4" fill="#4C8DD6"/>
      <rect x="14" y="15" width="20" height="3" rx="1.2" fill="#7FC8E8" opacity=".85"/>
      <path d="M41 19h4v4l3 8h-10l3-8z" fill="#EAF6F2" stroke="#7A8A90" stroke-width=".8"/><path d="M39.2 28.5h7.6l1.2 2.5h-10z" fill="#6CC3A0"/>
      ${a(`<circle cx="43" cy="27" r=".9" fill="#6CC3A0"><animate attributeName="cy" values="27;16" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite"/></circle>
      <circle cx="44.5" cy="27" r=".7" fill="#6CC3A0"><animate attributeName="cy" values="27;15" dur="1.4s" begin=".7s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.4s" begin=".7s" repeatCount="indefinite"/></circle>`)}`
    case 'build': return `
      <path d="M13 14 Q24 3 35 14 Z" fill="#F2C94C"/><rect x="9" y="13" width="30" height="2.6" rx="1" fill="#E0B43A"/><rect x="23" y="5.5" width="2" height="8" fill="#E0B43A"/>
      <g>${a(spin(40, 26, -25, 20, '.7s'))}<rect x="39.2" y="17" width="2.6" height="10" rx="1" fill="#8A9098"/><path d="M37.5 13.5a3.2 3.2 0 1 0 6 0l-1.6 1.6h-2.8z" fill="#8A9098"/></g>
      <rect x="13" y="26" width="22" height="7.5" rx=".8" fill="#2E3440" stroke="#8A9098" stroke-width=".6"/><path d="M11 33.5h26l-1.5 2h-23z" fill="#8A9098"/>
      <rect x="14.5" y="27.5" width="7" height="1" fill="#88C0D0">${a(`<animate attributeName="width" values="0;7;7" dur="1.8s" repeatCount="indefinite"/>`)}</rect>
      <rect x="16.5" y="29.5" width="9" height="1" fill="#A3BE8C">${a(`<animate attributeName="width" values="0;0;9;9" keyTimes="0;.3;.6;1" dur="1.8s" repeatCount="indefinite"/>`)}</rect>
      <rect x="16.5" y="31.3" width="5" height="1" fill="${ORANGE}">${a(`<animate attributeName="width" values="0;0;5" keyTimes="0;.65;1" dur="1.8s" repeatCount="indefinite"/>`)}</rect>
      <rect x="22.5" y="31.3" width=".8" height="1.2" fill="#ECEFF4">${a(`<animate attributeName="opacity" values="1;0;1" dur=".6s" repeatCount="indefinite"/>`)}</rect>`
    case 'explore': return `
      <rect x="8" y="12.5" width="32" height="2.4" rx="1" fill="#6B4F3A"/><rect x="14" y="6" width="20" height="7.5" rx="2" fill="#7D5D45"/><rect x="14" y="10.6" width="20" height="1.6" fill="#3E2C20"/>
      <g>${a(spin(39, 27, -18, 18, '1.6s'))}<line x1="41" y1="24" x2="38" y2="29" stroke="#6B4F3A" stroke-width="2.2" stroke-linecap="round"/><circle cx="43.5" cy="20" r="4.2" fill="#CFE8F5" fill-opacity=".75" stroke="#555" stroke-width="1.4"/></g>`
    case 'review': return `
      <circle cx="18.5" cy="22.5" r="3.6" fill="#fff" fill-opacity=".25" stroke="${INK}" stroke-width="1"/><circle cx="29.5" cy="22.5" r="3.6" fill="#fff" fill-opacity=".25" stroke="${INK}" stroke-width="1"/><line x1="22.1" y1="22.5" x2="25.9" y2="22.5" stroke="${INK}" stroke-width="1"/>
      <rect x="0.5" y="19" width="8.5" height="12" rx="1" fill="#C89B6A"/><rect x="1.6" y="21" width="6.3" height="9" fill="#fff"/><rect x="3" y="18" width="3.5" height="2" rx=".6" fill="#8A9098"/>
      <path d="M2.4 23.4l1 1 1.8-1.8M2.4 27l1 1 1.8-1.8" fill="none" stroke="#3FA66B" stroke-width=".9">${a(`<animate attributeName="stroke-dasharray" values="0 8;8 0;8 0" dur="1.8s" repeatCount="indefinite"/>`)}</path>`
    case 'plan': return `
      <rect x="11" y="30" width="26" height="8" rx="1" fill="#3F7FD0"/><path d="M14 32.5h20M14 35.5h20M19 30.5v7M27 30.5v7" stroke="#fff" stroke-width=".5" opacity=".6"/>
      <circle cx="24" cy="6.5" r="3.4" fill="#FFD85A">${a(`<animate attributeName="opacity" values=".35;1;.35" dur="1.6s" repeatCount="indefinite"/>`)}</circle><rect x="22.6" y="9.6" width="2.8" height="1.8" fill="#9A9A9A"/>`
    case 'write': return `
      <rect x="38" y="23" width="9" height="12" fill="#fff" stroke="#C9C9C9" stroke-width=".6"/><path d="M39.5 26h6M39.5 28.5h6M39.5 31h4" stroke="#A0A0A0" stroke-width=".6"/>
      <g>${a(`<animateTransform attributeName="transform" type="translate" values="0 0;-2.5 1;0 2;-2 3;0 0" dur="1.2s" repeatCount="indefinite"/>`)}<path d="M44 30 L47.5 18 Q48 22 45 30 Z" fill="#7D5D45"/></g>`
    case 'data': return `
      <rect x="37.5" y="34" width="10" height=".8" fill="#8A9098"/>
      <rect x="38.5" y="28" width="2.2" height="6" fill="#4C8DD6">${a(`<animate attributeName="height" values="6;3;6" dur="1.3s" repeatCount="indefinite"/><animate attributeName="y" values="28;31;28" dur="1.3s" repeatCount="indefinite"/>`)}</rect>
      <rect x="41.5" y="24" width="2.2" height="10" fill="#6CC3A0">${a(`<animate attributeName="height" values="10;6;10" dur="1.1s" repeatCount="indefinite"/><animate attributeName="y" values="24;28;24" dur="1.1s" repeatCount="indefinite"/>`)}</rect>
      <rect x="44.5" y="20" width="2.2" height="14" fill="${ORANGE}" stroke="${INK}" stroke-width=".3">${a(`<animate attributeName="height" values="14;9;14" dur="1.5s" repeatCount="indefinite"/><animate attributeName="y" values="20;25;20" dur="1.5s" repeatCount="indefinite"/>`)}</rect>`
    case 'web': return `
      <path d="M15 20a9 9 0 0 1 18 0" fill="none" stroke="#444" stroke-width="1.4"/><rect x="12.5" y="19" width="3.5" height="5" rx="1.2" fill="#444"/><rect x="32" y="19" width="3.5" height="5" rx="1.2" fill="#444"/>
      <circle cx="43" cy="24" r="4.6" fill="#7FC8E8" stroke="#3F7FD0" stroke-width=".8"/><ellipse cx="43" cy="24" rx="2" ry="4.6" fill="none" stroke="#3F7FD0" stroke-width=".6">${a(`<animate attributeName="rx" values="4.6;.3;4.6" dur="2s" repeatCount="indefinite"/>`)}</ellipse><path d="M38.4 24h9.2" stroke="#3F7FD0" stroke-width=".6"/>`
    default: return `
      <path d="M15 30h18l-2-8h-14z" fill="#B9BEC6"/><rect x="12" y="30" width="24" height="2" rx=".8" fill="#8A9098"/>
      <circle cx="24" cy="26" r="1" fill="#fff">${a(`<animate attributeName="opacity" values="1;.2;1" dur=".9s" repeatCount="indefinite"/>`)}</circle>`
  }
}

function critter(role: Role, status: Agent['status']) {
  const live = status === 'running'
  const body = status === 'failed' ? '#A7A2A0' : ORANGE
  const legs = [13, 19, 26, 32].map((x, i) =>
    `<rect x="${x}" y="34" width="3" height="6" fill="${body}">${live ? `<animate attributeName="height" values="6;4;6" dur=".5s" begin="${(i % 2) * 0.25}s" repeatCount="indefinite"/>` : ''}</rect>`).join('')
  const eye = (x: number) => live
    ? `<rect x="${x}" y="20" width="3" height="5" fill="${INK}"><animate attributeName="height" values="5;5;.6;5" keyTimes="0;.92;.96;1" dur="3.6s" repeatCount="indefinite"/><animate attributeName="y" values="20;20;22.2;20" keyTimes="0;.92;.96;1" dur="3.6s" repeatCount="indefinite"/></rect>`
    : status === 'done'
      ? `<path d="M${x - 0.5} 23.5l2-2.5 2 2.5" fill="none" stroke="${INK}" stroke-width="1.2"/>`
      : `<path d="M${x} 20.5l3 3.5M${x + 3} 20.5l-3 3.5" stroke="${INK}" stroke-width="1.1"/>`
  const badge = status === 'done'
    ? '<circle cx="42" cy="8" r="5" fill="#3FA66B"/><path d="M39.6 8.2l1.7 1.7 3.2-3.4" fill="none" stroke="#fff" stroke-width="1.4"/>'
    : status === 'failed' ? '<circle cx="42" cy="8" r="5" fill="#D9534F"/><path d="M40 6l4 4M44 6l-4 4" stroke="#fff" stroke-width="1.4"/>' : ''
  const bob = live ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur=".5s" repeatCount="indefinite"/>' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 44" width="48" height="44"><g>${bob}
    ${legs}<rect x="6" y="22" width="4" height="5" fill="${body}"/><rect x="38" y="22" width="4" height="5" fill="${body}"/>
    <rect x="10" y="14" width="28" height="21" rx="1" fill="${body}"/>${eye(17)}${eye(28)}${outfit(role, live)}</g>${badge}</svg>`
}

type Agent = {
  key: string
  agentId?: string
  description: string
  role: Role
  type: string
  model: string
  status: 'running' | 'done' | 'failed'
  tools: number
  tokens: number
  startedAt: number
  endedAt: number
}
type FileUse = { path: string; reads: number; edits: number; last: number }

const s = {
  tasks: [] as Task[],
  agents: [] as Agent[],
  files: new Map<string, FileUse>(),
  tools: new Map<string, number>(),
  cwd: '',
  polling: false,
}

const TODO_TOOL = 'mcp__activity-panel__todo'
const TODO_SPEC = {
  name: 'todo',
  description: 'Your todo list for multi-step work, shown to the person as a progress bar above the prompt. ' +
    'Use it for any task with 3 or more steps: write the whole list at the start, then call it again with the full list ' +
    'each time a step starts or finishes. Exactly one item is in_progress at a time; mark items completed as soon as they are done.',
  inputSchema: {
    type: 'object',
    required: ['todos'],
    properties: {
      todos: {
        type: 'array',
        description: 'The whole list, every call',
        items: {
          type: 'object',
          required: ['content', 'activeForm', 'status'],
          properties: {
            content: { type: 'string', description: 'The step, imperative: "Run the tests"' },
            activeForm: { type: 'string', description: 'The step while it runs: "Running the tests"' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
        },
      },
    },
  },
}
const FILE_TOOLS: Record<string, 'read' | 'edit'> = { Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit' }
const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)
const shortModel = (m: string) => {
  const hit = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)?(?:[-_.](\d+))?/i.exec(m)
  if (!hit) return m || 'inherit'
  const name = hit[1]!.charAt(0).toUpperCase() + hit[1]!.slice(1).toLowerCase()
  return [name, [hit[2], hit[3]].filter(Boolean).join('.')].filter(Boolean).join(' ')
}
function rel(path: string) {
  const p = path.replace(/\\/g, '/')
  const c = s.cwd.replace(/\\/g, '/').replace(/\/$/, '')
  return c && p.startsWith(c + '/') ? p.slice(c.length + 1) : p
}
function toolLabel(tool: string, input: Record<string, unknown>) {
  if (tool === 'Skill') return `skill ${String(input.skill ?? '')}`
  const mcp = /^mcp__(.+?)__/.exec(tool)
  if (mcp) return mcp[1]!.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ')
  return tool
}
function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function touchFile(path: string, kind: 'read' | 'edit', now: number) {
  const f = s.files.get(path) ?? { path, reads: 0, edits: 0, last: 0 }
  if (kind === 'read') f.reads += 1
  else f.edits += 1
  f.last = now
  s.files.set(path, f)
}

function applyTodo(tool: string, input: Record<string, unknown>, result: unknown) {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    s.tasks = (input.todos as { content: string; activeForm?: string; status: Task['status'] }[]).map((t, n) => ({
      id: `todo-${n}`, subject: t.content, active: t.activeForm ?? t.content, status: t.status,
    }))
  } else if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: string } } | undefined)?.task?.id ?? `task-${s.tasks.length + 1}`
    s.tasks.push({ id, subject: String(input.subject ?? ''), active: String(input.activeForm ?? input.subject ?? ''), status: 'pending' })
  } else if (tool === 'TaskUpdate') {
    const t = s.tasks.find(x => x.id === String(input.taskId))
    if (!t) return
    if (input.status === 'deleted') s.tasks = s.tasks.filter(x => x !== t)
    else if (typeof input.status === 'string') t.status = input.status as Task['status']
    if (typeof input.subject === 'string') t.subject = input.subject
    if (typeof input.activeForm === 'string') t.active = input.activeForm
  }
}

// Match running subagents to their ids, so their own tool calls count toward them.
async function pollAgents($: EngineInterface) {
  if (s.polling || !s.agents.some(a => a.status === 'running')) return
  s.polling = true
  try {
    const list = await $.agent.list()
    for (const a of s.agents) {
      const info = a.agentId ? list.find(i => i.id === a.agentId) : list.find(i => i.description === a.description && !s.agents.some(o => o.agentId === i.id))
      if (!info) continue
      a.agentId = info.id
      if (info.status === 'completed' || info.status === 'idle') a.status = 'done'
      if (info.status === 'failed' || info.status === 'killed') a.status = 'failed'
      if (a.status !== 'running' && !a.endedAt) a.endedAt = await $.clock.now()
    }
    $.ui.invalidate('ui.render')
  } catch { /* try again next tick */ } finally {
    s.polling = false
  }
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Activity' })

function progressBar(done: number, total: number, width: number) {
  const filled = total ? Math.round((done / total) * width) : 0
  return ['━'.repeat(filled), '━'.repeat(width - filled)] as const
}

function band($: EngineInterface, e: RenderInput & { component: 'AbovePrompt' }): RenderElement | null {
  const total = s.tasks.length
  const done = s.tasks.filter(t => t.status === 'completed').length
  const running = s.agents.filter(a => a.status === 'running').length
  const tasksOpen = total > 0 && done < total
  if (!tasksOpen && !running) return null
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
  const current = s.tasks.find(t => t.status === 'in_progress')
  const width = Math.max(8, Math.min(20, Math.floor(e.props.bodyColumns / 5)))
  const [on, off] = progressBar(done, total, width)
  const crew = s.agents.filter(a => a.status === 'running').slice(-6)
  return (
    <Box key="activity-band" flexDirection="row" gap={1} alignItems="center">
      {Svg
        ? crew.map(a => <Svg key={`crew-${a.key}`} source={critter(a.role, 'running')} alt={`${roleInfo(a.role).label} Claude: ${a.description}`} width={30} height={28} isInteractive />)
        : crew.length ? <Text>{crew.map(a => roleInfo(a.role).glyph).join(' ')}</Text> : null}
      {tasksOpen ? <Text><Text color="claude">{on}</Text><Text color="subtle">{off}</Text></Text> : null}
      {tasksOpen ? <Text>{done}/{total}</Text> : null}
      <Text wrap="truncate-end">
        {current ? current.active : ''}
        {running ? <Text dimColor>{current ? ' · ' : ''}{running} agent{running === 1 ? '' : 's'} running</Text> : null}
      </Text>
      <Button key="details" plain hotkey="a" dimColor label="Details" onPress={() => void openPane($)} />
    </Box>
  )
}

function pane($: EngineInterface, e: RenderInput & { component: 'Pane' }, now: number) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const cols = e.props.bodyColumns
  const head = (label: string, extra = '') => (
    <Text bold color="subtle">{label}{extra ? <Text dimColor> {extra}</Text> : null}</Text>
  )
  const sections: RenderElement[] = []

  if (s.tasks.length) {
    const done = s.tasks.filter(t => t.status === 'completed').length
    sections.push(
      <Box key="tasks" flexDirection="column">
        {head('Tasks', `${done}/${s.tasks.length}`)}
        {s.tasks.map(t =>
          t.status === 'completed' ? <Text dimColor wrap="truncate-end"><Text color="success">✓</Text> {t.subject}</Text>
          : t.status === 'in_progress' ? <Text wrap="truncate-end"><Text color="claude">◼</Text> <Text bold>{t.active}</Text></Text>
          : <Text wrap="truncate-end"><Text color="subtle">◻</Text> {t.subject}</Text>)}
      </Box>,
    )
  }

  if (s.agents.length) {
    const shown = s.agents.slice(-8)
    const els = $.ui.resolve(e)
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    sections.push(
      <Box key="agents" flexDirection="column" gap={Svg ? 1 : 0}>
        {head('Agents', `${s.agents.filter(a => a.status === 'running').length} running`)}
        {shown.map(a => {
          const color = a.status === 'running' ? 'claude' : a.status === 'done' ? 'success' : 'error'
          const took = mins((a.endedAt || now) - a.startedAt)
          const info = roleInfo(a.role)
          const meta = [info.label, shortModel(a.model), `${a.tools} tools`, a.tokens ? `${k(a.tokens)} tokens` : '', took].filter(Boolean).join(' · ')
          const watch = a.agentId && a.status === 'running'
            ? <Button key={`agent-${a.key}`} plain dimColor label="Watch" onPress={() => void $.ui.view({ agentId: a.agentId! })} />
            : null
          if (!Svg)
            return (
              <Box key={`row-${a.key}`} flexDirection="row" gap={1}>
                <Text wrap="truncate-end"><Text color={color}>●</Text> {info.glyph} {a.description} <Text dimColor>{meta}</Text></Text>
                {watch}
              </Box>
            )
          return (
            <Box key={`row-${a.key}`} flexDirection="row" gap={1} alignItems="center">
              <Svg source={critter(a.role, a.status)} alt={`${info.label} Claude, ${a.status}`} width={48} height={44} isInteractive={a.status === 'running'} />
              <Box flexDirection="column">
                <Text wrap="truncate-end" bold>{a.description}</Text>
                <Text wrap="truncate-end" dimColor>{meta}</Text>
                {watch}
              </Box>
            </Box>
          )
        })}
      </Box>,
    )
  }

  if (s.files.size) {
    const files = [...s.files.values()].sort((x, y) => (y.edits ? 1 : 0) - (x.edits ? 1 : 0) || y.last - x.last)
    const edited = files.filter(f => f.edits).length
    sections.push(
      <Box key="files" flexDirection="column">
        {head('Files', `${edited} changed · ${files.length - edited} read`)}
        {files.slice(0, 12).map(f => (
          <Text wrap="truncate-start">
            <Text color={f.edits ? 'claude' : 'subtle'}>{f.edits ? '✎' : '○'}</Text> {f.edits ? rel(f.path) : <Text dimColor>{rel(f.path)}</Text>}
            {f.edits > 1 ? <Text dimColor> ×{f.edits}</Text> : null}
          </Text>
        ))}
        {files.length > 12 ? <Text dimColor>+{files.length - 12} more</Text> : null}
      </Box>,
    )
  }

  if (s.tools.size) {
    const list = [...s.tools.entries()].sort((x, y) => y[1] - x[1])
    sections.push(
      <Box key="tools" flexDirection="column">
        {head('Tools & skills')}
        <Text dimColor wrap="wrap">{list.map(([name, n]) => `${name} ${n}`).join('  ·  ')}</Text>
      </Box>,
    )
  }

  if (!sections.length) return <Text dimColor>Nothing yet. Tasks, agents, files and tools show up here as Claude works.</Text>
  return <Box flexDirection="column" gap={1} width={cols}>{sections}</Box>
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    s.cwd = e.cwd
    await $.command.register({ name: 'activity', description: 'Show tasks, agents, files and tools used in this chat' })
    $.clock.every(2000, () => void pollAgents($).catch(() => undefined))
    // Some sessions (the desktop app's among them) give the model no todo tool, so there
    // is no task list to show. Then this mod lends it one of its own.
    try {
      const names = (await $.tool.list()).map(t => t.name)
      if (!names.some(n => n === 'TodoWrite' || n === 'TaskCreate')) await $.tool.register(TODO_SPEC)
    } catch { /* the bar just stays without tasks */ }
    return r
  })

  on('tool.call', { tool: TODO_TOOL }, async ($, e) => {
    const todos = (e as unknown as { todos?: unknown }).todos
    if (!Array.isArray(todos)) return { result: 'Error: pass todos, an array of { content, activeForm, status }.' }
    applyTodo('TodoWrite', { todos }, undefined)
    $.ui.invalidate('ui.render')
    const done = s.tasks.filter(t => t.status === 'completed').length
    return { result: `Todo list updated: ${done}/${s.tasks.length} done. The person sees it above the prompt; keep it current as you work.` }
  })

  on('session.end', ($, e, next) => {
    s.tasks = []
    s.agents = []
    s.files.clear()
    s.tools.clear()
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'activity' }, async $ => {
    await openPane($)
    return { text: 'Activity pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === TODO_TOOL) return next(e) // answered by its own hook; not counted as a tool
    const input = e as unknown as Record<string, unknown>
    const now = await $.clock.now()
    let agent: Agent | undefined
    if (tool === 'Agent') {
      agent = {
        key: e.tool_use_id, description: String(input.description ?? 'agent'), type: String(input.subagent_type ?? 'general'),
        role: roleOf(String(input.subagent_type ?? ''), String(input.description ?? ''), String(input.prompt ?? '')),
        model: String(input.model ?? ''), status: 'running', tools: 0, tokens: 0, startedAt: now, endedAt: 0,
      }
      s.agents.push(agent)
    } else {
      bump(s.tools, toolLabel(tool, input))
      const kind = FILE_TOOLS[tool]
      const path = input.file_path ?? input.notebook_path
      if (kind && typeof path === 'string') touchFile(path, kind, now)
      if (e.agentId) {
        const owner = s.agents.find(a => a.agentId === e.agentId)
        if (owner) owner.tools += 1
      }
    }
    $.ui.invalidate('ui.render')

    const r = await next(e)
    try {
      applyTodo(tool, input, r.result)
      if (agent) {
        const res = (r.result ?? {}) as { agentId?: string; status?: string; totalTokens?: number; resolvedModel?: string; totalToolUseCount?: number }
        if (res.agentId) agent.agentId = res.agentId
        if (res.resolvedModel) agent.model = res.resolvedModel
        if (typeof res.totalTokens === 'number') {
          // A foreground agent returns when it is done; a background one returns at launch.
          agent.tokens = res.totalTokens
          agent.tools = res.totalToolUseCount ?? agent.tools
          agent.status = r.isError ? 'failed' : 'done'
          agent.endedAt = await $.clock.now()
        } else if (r.deny !== undefined || r.isError) {
          agent.status = 'failed'
          agent.endedAt = await $.clock.now()
        }
      }
    } catch { /* tracking never affects the call */ }
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const mine = band($, e)
    if (!mine) return below
    const { Box } = $.ui.resolve(e)
    return below ? <Box flexDirection="column">{below}{mine}</Box> : mine
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => pane($, e, await $.clock.now()))
}
