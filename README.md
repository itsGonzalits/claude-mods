# claude-mods

Four small mods for Claude Code. They use Claude's own theme colours and native controls, stay hidden until something needs your attention, and make no network calls of their own.

| Mod | What it does | AI cost |
| --- | --- | --- |
| **session-meter** | Shows the cache countdown and chat size in the status line. Before a big chat is re-read cold, it asks once (Send / Hand off / Cancel).\|2h\|off]` keeps the cache warm while you're away. `/handoff` writes a brief to `.claude/handoffs/` and starts a fresh chat with it, and the band offers this at 250k tokens. | Only for handoffs |
| **activity-panel** | While Claude works, a task progress bar sits above the prompt, with a tiny animated Claude for each running subagent, dressed for its job (lab coat for research, hard hat and laptop for code, detective hat for searching…). `/activity` (or **Details**) opens a pane with tasks, subagents (**Watch** one to follow it), files read or changed, and tools and skills used. Where a session has no todo tool, it lends Claude one so the progress bar still works. | None |
| **reflect** | When you correct Claude, it offers to save the fix as a rule: **This project** (`./CLAUDE.md`) or **Everywhere** (`~/.claude/CLAUDE.md`), with Edit and Skip. It never saves a rule that's already there. | One small Haiku call, only when a free keyword check matches |
| **safety-net** | Before `rm -rf`, `Remove-Item -Recurse`, `git reset --hard`, `git clean`, a force push, `DROP TABLE` and similar commands, it lists exactly what would be lost and asks, with **Cancel** first. It only asks when it matters: files that existed before this session, a protected folder (home, Desktop, Documents, a drive root, `.git`, `~/.claude`), or 500+ files / 100 MB+. Scratch files made this session and build output (`node_modules`, `dist`, `build`, caches) go without a question. Variables set in the same command (`D=$(mktemp -d)`, `$TEMP`, `$HOME`) are filled in before measuring. | None |

Works in the Claude Code terminal and the desktop app's Code tab, on Windows, macOS and Linux. Needs Claude Code 2.1.287 or newer. The terminal shows an emoji per subagent instead of the animated Claude.

## Install

**Ask Claude** (any device, Code tab or terminal):

> Install all the mods from the GitHub marketplace itsGonzalits/claude-mods.

**Desktop app (Code tab):** click **+** next to the prompt box → **Plugins** → **Add marketplace**, enter `itsGonzalits/claude-mods`, then add each plugin you want.

**Terminal**, one line per mod:

```
/plugin install session-meter --marketplace itsGonzalits/claude-mods
/plugin install activity-panel --marketplace itsGonzalits/claude-mods
/plugin install reflect --marketplace itsGonzalits/claude-mods
/plugin install safety-net --marketplace itsGonzalits/claude-mods
```

From a shell, use `claude plugin install <mod> --marketplace itsGonzalits/claude-mods`. Answer `y` to add the marketplace and choose the **user** scope so the mods load in every session.

Also worth turning on: Anthropic's built-in **You Should Know** side agent (it uses some extra tokens). In a terminal, run `/plugin enable cc-plugin-you-should-know@builtin`. It is also listed under **Built-in** in the plugin list.

## Turn a mod off

Run `/plugin`, or open **Plugins** in the desktop app, and disable it. To change a setting, open `/config`:

- **session-meter:** cache lifetime (`auto` / `1h` / `5m`) and the handoff threshold.

## Develop

Each mod is a single `hooks/register.tsx` with tests in `tests/`.

```
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```

After changing a mod, bump `version` in its `.claude-plugin/plugin.json` and run `claude plugin update <mod>@claude-mods`: sessions load a cached copy per version, so an edit without a bump never reaches them.

MIT licensed.
