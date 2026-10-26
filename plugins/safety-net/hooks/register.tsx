// Safety Net: before a destructive shell command runs, show what it would destroy
// and ask. Cancel is the first option. A command that would destroy nothing passes
// silently. Measures with the file API and git itself, so it works on Windows too.
// A last look, not a permission system: keep your normal permissions on.
import type { Register, EngineInterface } from 'claude-code'

type Hit =
  | { kind: 'delete'; label: string; targets: string[]; base: string; vars: Record<string, string> }
  | { kind: 'git'; label: string; argv: string[]; base: string }
  | { kind: 'sql'; label: string; statement: string }

const MAX_WALK = 5000
const SHOW = 8

function tokens(seg: string) {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m; (m = re.exec(seg)); ) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}
const isFlag = (t: string) => /^-/.test(t) || /^\/[a-z]$/i.test(t)

// Git Bash spells C:\x as /c/x; the file API wants C:/x.
const winPath = (p: string) => p.replace(/^\/([a-z])\//i, (_, d: string) => `${d.toUpperCase()}:/`)
function resolve(base: string, p: string, home: string) {
  let q = winPath(p.replace(/^~(?=$|[\\/])/, home))
  if (!/^([a-z]:)?[\\/]/i.test(q)) q = `${base.replace(/[\\/]$/, '')}/${q}`
  const parts: string[] = []
  for (const part of q.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && (part !== '' || parts.length === 0)) parts.push(part)
  }
  return parts.join('/') || '/'
}

// A variable set to a fresh mktemp folder: deleting it later loses nothing.
const FRESH_TMP = '\u0000fresh-tmp'
const unquote = (v: string) => v.trim().replace(/^"(.*)"$|^'(.*)'$/s, (_, a, b) => a ?? b)
function assignment(seg: string): [string, string] | null {
  const m = /^(?:export\s+|local\s+)?([A-Za-z_]\w*)=(.*)$/s.exec(seg) ?? /^\$([A-Za-z_]\w*)\s*=\s*(.+)$/s.exec(seg)
  if (!m) return null
  const value = unquote(m[2] ?? '')
  return [m[1]!, /^(\$\(|`)\s*mktemp\b|New-TemporaryFile|GetTempFileName/i.test(value) ? FRESH_TMP : value]
}

function detect(command: string, cwd: string, home: string): Hit[] {
  const hits: Hit[] = []
  const vars: Record<string, string> = {}
  let base = cwd
  for (const seg of command.split(/&&|\|\||;|\n/)) {
    const set = assignment(seg.trim())
    if (set) { vars[set[0]] = set[1]; continue }
    const t = tokens(seg.trim()).filter(x => x !== 'sudo')
    const [cmd = '', ...rest] = t
    const c = cmd.toLowerCase()
    const flags = rest.filter(isFlag).join(' ')
    const args = rest.filter(x => !isFlag(x))
    const del = (targets: string[]) => hits.push({ kind: 'delete', label: seg.trim(), targets, base, vars: { ...vars } })
    if (c === 'cd' && args[0]) base = resolve(base, args[0], home)
    else if (c === 'rm' && /(^|\s)-(\w*[rR]\w*|-recursive)\b/.test(flags)) del(args)
    else if (/^(remove-item|ri)$/.test(c) && /-recurse/i.test(flags)) del(args.filter(a => !/^-/.test(a)))
    else if (/^(rd|rmdir|del|erase)$/.test(c) && /\/s\b/i.test(flags)) del(args)
    else if (c === 'find' && /\s-delete\b|-exec\s+rm\b/.test(seg)) del(args.slice(0, 1))
    else if (c === 'git') {
      const sub = args[0] ?? ''
      const all = rest.join(' ')
      if (sub === 'reset' && /--hard/.test(all)) hits.push({ kind: 'git', label: 'git reset --hard', argv: ['git', 'status', '--porcelain', '--untracked-files=no'], base })
      else if (sub === 'clean' && /-\w*f/.test(flags)) hits.push({ kind: 'git', label: seg.trim(), argv: ['git', 'clean', '-n', ...(/-\w*d/.test(flags) ? ['-d'] : []), ...(/-\w*x/.test(flags) ? ['-x'] : [])], base })
      else if ((sub === 'checkout' || sub === 'restore') && /(^|\s)\.(\s|$)/.test(all) && !/--staged/.test(all)) hits.push({ kind: 'git', label: seg.trim(), argv: ['git', 'status', '--porcelain', '--untracked-files=no'], base })
      else if (sub === 'push' && /(^|\s)(--force|-f)(\s|$)/.test(all)) hits.push({ kind: 'git', label: seg.trim(), argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], base })
      else if (sub === 'branch' && /(^|\s)-D(\s|$)/.test(all)) hits.push({ kind: 'git', label: seg.trim(), argv: ['git', 'log', '--oneline', '-n', '20', args[1] ?? 'HEAD', '--not', '--remotes'], base })
      else if (sub === 'stash' && /^(drop|clear)$/.test(args[1] ?? '')) hits.push({ kind: 'git', label: seg.trim(), argv: ['git', 'stash', 'list'], base })
    }
    const sql = /\b(drop\s+(table|database|schema)\s+\S+|truncate\s+(table\s+)?\S+|delete\s+from\s+\S+\s*(;|"|'|$))/i.exec(seg)
    if (sql && !/\bwhere\b/i.test(seg.slice(sql.index))) hits.push({ kind: 'sql', label: 'SQL', statement: sql[0].trim().replace(/[;"']$/, '') })
  }
  return hits
}

function globRe(glob: string) {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
}

// Only a serious delete is worth a question: files that were there before this session
// (minus build output and caches, which regenerate), a huge amount of anything, or a
// protected place. Scratch files Claude made in this session go without asking.
const BIG_FILES = 500
const BIG_BYTES = 100e6
const JUNK = /(^|\/)(node_modules|dist|build|out|target|coverage|__pycache__|\.pytest_cache|\.mypy_cache|\.next|\.nuxt|\.turbo|\.cache|\.parcel-cache|\.venv|venv|tmp|temp)(\/|$)|\.(log|pyc|tmp)$/i
type Acc = { files: number; bytes: number; old: number; sample: string[]; capped: boolean; since: number }
function count(acc: Acc, p: string, bytes: number, mtimeMs: number) {
  acc.files += 1
  acc.bytes += bytes
  const isOld = mtimeMs < acc.since && !JUNK.test(p)
  if (isOld) acc.old += 1
  if (acc.sample.length < SHOW && (isOld || acc.old === 0)) acc.sample.push(p)
}
function isProtected(p: string, home: string) {
  const q = p.replace(/\/$/, '').toLowerCase()
  const h = home.replace(/\/$/, '').toLowerCase()
  return q === '' || /^[a-z]:$/.test(q) || q === h || /(^|\/)\.git$/.test(q) || q === `${h}/.claude`
    || ['desktop', 'documents', 'downloads', 'pictures', 'onedrive'].some(d => q === `${h}/${d}`)
}

async function walk($: EngineInterface, path: string, acc: Acc) {
  const stack = [path]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try { entries = await $.fs.list(dir) } catch { continue }
    for (const en of entries) {
      if (acc.files >= MAX_WALK) { acc.capped = true; return }
      const p = `${dir}/${en.name}`
      if (en.kind === 'dir' && !en.isLink) stack.push(p)
      else count(acc, p, en.size, en.mtimeMs)
    }
  }
}

const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`)
const shortPath = (p: string, base: string) => (p.startsWith(base.replace(/\\/g, '/') + '/') ? p.slice(base.length + 1) : p)

// The path variables a delete commonly names, read once (env names must be literals).
type Env = Record<string, string>
async function pathEnv($: EngineInterface): Promise<Env> {
  const got: [string, string | undefined][] = [
    ['HOME', await $.env.get('HOME')], ['USERPROFILE', await $.env.get('USERPROFILE')],
    ['TEMP', await $.env.get('TEMP')], ['TMP', await $.env.get('TMP')], ['TMPDIR', await $.env.get('TMPDIR')],
    ['APPDATA', await $.env.get('APPDATA')], ['LOCALAPPDATA', await $.env.get('LOCALAPPDATA')],
  ]
  const env: Env = {}
  for (const [k, v] of got) if (v) env[k] = v.replace(/\\/g, '/')
  return env
}

// Fills in $VAR, ${VAR}, $env:VAR and %VAR% from earlier assignments in the same command,
// then the environment. Unknown ones stay as they are, so the caller can still say so.
function expand(s: string, vars: Record<string, string>, env: Env, depth = 0): string {
  let out = s.replace(/\$\{(\w+)\}|\$env:(\w+)|\$(\w+)|%(\w+)%/gi, (all, a, b, c, d) => {
    const name: string = a ?? b ?? c ?? d
    const local = vars[name]
    if (local !== undefined) return depth < 4 ? expand(local, vars, env, depth + 1) : local
    return env[name] ?? env[name.toUpperCase()] ?? all
  }).replace(/\\/g, '/')
  // Git Bash's /tmp is the Windows temp folder.
  if (depth === 0 && /^\/tmp(\/|$)/.test(out) && env.TEMP && /^[a-z]:/i.test(env.TEMP)) out = env.TEMP + out.slice(4)
  return out
}

// Returns what would be lost, or null when nothing would be.
async function measure($: EngineInterface, hit: Hit, home: string, since: number, env: Env): Promise<string | null> {
  if (hit.kind === 'sql') return `Runs ${hit.statement}: the data cannot be recovered from here.`
  if (hit.kind === 'git') {
    const r = await $.process.run(hit.argv, { cwd: winPath(hit.base), timeoutMs: 8000 })
    const lines = r.stdout.split('\n').map(l => l.trim()).filter(Boolean)
    if (r.exitCode !== 0) return `${hit.label}: could not measure (${r.stderr.trim().split('\n')[0] || 'git failed'}).`
    if (hit.argv[1] === 'rev-parse') return `Force-pushes ${lines[0] ?? 'this branch'}: rewrites remote history; commits others pushed can be lost.`
    if (!lines.length) return hit.argv[1] === 'log' ? `Deletes branch ${hit.argv[5]}.` : null
    const what = hit.argv[1] === 'clean' ? 'untracked items deleted' : hit.argv[1] === 'log' ? 'unpushed commits lost' : hit.argv[1] === 'stash' ? 'stash entries affected' : 'files lose uncommitted changes'
    const list = lines.slice(0, SHOW).map(l => `  ${l.replace(/^Would remove /, '')}`)
    return [`${hit.label}: ${lines.length} ${what}`, ...list, ...(lines.length > SHOW ? [`  …and ${lines.length - SHOW} more`] : [])].join('\n')
  }
  const targets: string[] = []
  for (const raw of hit.targets) {
    const x = expand(raw, hit.vars, env)
    if (!x.includes(FRESH_TMP)) targets.push(x)
  }
  const dynamic = targets.filter(x => /[$`%]/.test(x))
  if (dynamic.length) return `${hit.label}: deletes ${dynamic.join(', ')}, which is only known when the command runs; could not measure it.`
  const acc: Acc = { files: 0, bytes: 0, old: 0, sample: [], capped: false, since }
  let guarded = ''
  for (const target of targets) {
    const full = resolve(hit.base, target, home)
    if (isProtected(full, home)) guarded = full
    const slash = full.lastIndexOf('/')
    const leaf = full.slice(slash + 1)
    const paths = /[*?]/.test(leaf)
      ? (await $.fs.list(full.slice(0, slash) || '/').catch(() => [])).filter(en => globRe(leaf).test(en.name)).map(en => `${full.slice(0, slash)}/${en.name}`)
      : [full]
    for (const p of paths) {
      const st = await $.fs.stat(p).catch(() => null)
      if (!st) continue
      if (st.kind === 'dir' && !st.isLink) await walk($, p, acc)
      else count(acc, p, st.size, st.mtimeMs)
    }
  }
  if (!acc.files && !guarded) return null
  const isSerious = guarded || acc.old > 0 || acc.capped || acc.files >= BIG_FILES || acc.bytes >= BIG_BYTES
  if (!isSerious) return null // only files made this session, or build output: let it go
  const total = `${acc.capped ? 'over ' : ''}${acc.files} file${acc.files === 1 ? '' : 's'} (${size(acc.bytes)})`
  const why = guarded ? ` · ${shortPath(guarded, hit.base)} is a protected folder`
    : acc.old ? ` · ${acc.old} existed before this session` : ''
  return [`${hit.label}: deletes ${total}${why}`, ...acc.sample.map(p => `  ${shortPath(p, hit.base)}`), ...(acc.files > acc.sample.length ? [`  …and ${acc.files - acc.sample.length} more`] : [])].join('\n')
}

export const register: Register = on => {
  let home = ''
  let env: Env = {}
  on('session.start', async ($, e, next) => {
    env = await pathEnv($).catch(() => ({}))
    home = env.USERPROFILE ?? env.HOME ?? ''
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool !== 'Bash' && tool !== 'PowerShell') return next(e)
    const command = String((e as unknown as { command?: string }).command ?? '')
    let hits: Hit[] = []
    try {
      hits = detect(command, (await $.session.cwd()).replace(/\\/g, '/'), home)
    } catch {
      return next(e) // a parsing problem never blocks ordinary commands
    }
    if (!hits.length) return next(e)
    const found: string[] = []
    const since = await $.session.usage().then(u => u.startedAt, () => Infinity) // unknown: treat every file as old
    for (const hit of hits) {
      const m = await measure($, hit, home, since, env).catch(() => `${hit.label}: could not measure what it would remove.`)
      if (m) found.push(m)
    }
    if (!found.length) return next(e) // nothing there to lose
    let answer = ''
    try {
      answer = await $.ui.ask(`${found.join('\n\n')}\n\nRun this command?`, { options: ['Cancel', 'Run it'], header: 'Safety Net' })
    } catch {
      answer = 'Cancel'
    }
    if (answer === 'Run it') return next(e)
    return { deny: 'Safety Net: the person chose not to run this destructive command. Do not retry it another way; ask them how they want to proceed.' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Safety Net could not check this command, so it was held. Ask the person before retrying.' }))
}
