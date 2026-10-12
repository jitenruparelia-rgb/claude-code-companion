# Code Companion

A pixel companion for Claude Code. It lives in a pane beside the transcript, levels up on your tool calls, takes damage on errors, and keeps a quest log of the session. Progress carries over between sessions.

```
   ▄▄▄▄▄  ╱   Companion · Lv 3
  █ ● ● █╱    ♥ ████████░░ 16/20
  █  ▂  █     ✦ ███░░░░░░░ 42 xp
   ▀▀█▀▀      ◆ 7 files · streak 4 · session 2
  ▟█████▙     casting Bash
  █ ▐█▌ █
   ▀   ▀      ── quest log ──
              ⚑ checks passed +10 xp
              ✎ Edit Modal.tsx +3 xp
              ★ level 3!
```

## Install

From a terminal session of Claude Code:

```
/plugin install code-companion --marketplace jitenruparelia-rgb/claude-code-companion
```

Answer `y` to add the marketplace, then pick the user scope. The pane opens on the next session start, and `/companion` opens it any time. The install command is a terminal's; a session the desktop app starts for its Code tab does not take it, but a plugin installed at the user scope loads there too.

## How it plays

| Event | Effect |
| --- | --- |
| Any tool call | +1 xp |
| Edit or Write | +3 xp, and a new file adds one to the gold count |
| A test, lint, build or typecheck command that passes | +10 xp |
| A turn the model answers | +5 xp, +1 hp |
| A tool call that errors | −2 hp, streak reset |
| A turn that ends in an error | −3 hp |
| Five clean calls in a row | +1 hp |
| Health reaches zero | the companion is down; the next turn revives it at half health |

Level follows the square root of experience, so early levels come quickly. The sprite blinks while idle, thinks while a turn runs, swings while a tool runs, flinches on an error, cheers on a level-up, and lies down at zero.

Experience, level, health, files and the session count persist across sessions in Claude Code's plugin store. The streak, the log and the mood are per session.

## Commands

- `/companion` opens the pane.
- `/companion reset` starts a new character and clears the stored one.

## Development

The mod is a Claude Code function-hooks plugin: `hooks/register.tsx` registers the hooks, `hooks/game.ts` holds the rules and sprites, `types/index.d.ts` declares the session state. Check it with:

```
claude plugin validate .
claude plugin test .
```

Run it from the folder without installing: `claude --plugin-dir .`

## Licence

MIT.
