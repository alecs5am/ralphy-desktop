# Ralphy Desktop

This repository now contains two desktop surfaces:

- `native/RalphyMedia` — native macOS media browser for generated `.ralphy` files.
- the original Electron chat spike — embedded Claude Code chat over a Ralphy project.

## Run the native media browser

Requires Xcode Command Line Tools with Swift 6.

```bash
cd native/RalphyMedia
swift run RalphyMedia /Users/maximovchinnikov/github/ralphy/ralphy/.ralphy
```

You can also run `swift run RalphyMedia` and choose a `.ralphy` folder from the
open panel.

The app indexes `.ralphy/workspaces/<workspace>/projects/<project>` and watches
the selected `.ralphy` folder with FSEvents. New generated media appears after a
short debounce without restarting the app.

Review metadata is stored next to the selected Ralphy state in:

```text
.ralphy/media-library/library.json
```

The app does not mutate generated artifacts when setting ratings, favorites,
tags, notes, or the rejected/slop flag. The destructive action is explicit
`Move to Trash`, implemented with the macOS Trash API.

Useful checks:

```bash
cd native/RalphyMedia
swift test
swift build
swift run RalphyMedia --scan-only /Users/maximovchinnikov/github/ralphy/ralphy/.ralphy
```

## Run the Electron app (real chat, real auth)

Electron app with an embedded Claude Code chat that drives a Ralphy project — the
pencil.dev shape, applied to UGC video. You chat; a Claude Code agent runs the
`ralphy` pipeline over `workspace/projects/<id>/`; the project panel updates live.

The original design note remains in the core Ralphy development history. The
renderer uses the same public brand language as the website.
The Electron + Claude wiring is live: it spawns your local `claude` and streams a
real conversation.

Requires a local `claude` on PATH (`claude --version`) logged into your subscription.

```bash
bun install                  # downloads the Electron binary; needs network
bun run start                # builds renderer + electron, then opens the window
```

Pick **My Claude subscription** on first run → chat. Each turn spawns
`claude -p --output-format stream-json` with `cwd` at the repo root, so the agent
loads the real `AGENTS.md` + `CLAUDE.md` and answers as the Ralphy router. Usage
draws from your plan's Agent SDK credit (no API key).

## Check just the design (no Electron, no `claude`)

The renderer also runs standalone in a browser with a mock agent stream:

```bash
bun run dev                  # opens http://localhost:4180
```

You'll see: the onboarding auth picker → the workspace (chat left, live project
panel right) → send a message to watch streamed agent events, tool chips, and the
confirm-with-cost permission modal.

## Architecture

```
Electron main process (electron/main.ts)
  ├─ ClaudeSession (electron/claude/session.ts)
  │    spawns the user's local `claude` binary in stream-json mode,
  │    cwd = workspace/projects/<id>  → loads AGENTS.md + CLAUDE.md + skills
  │    normalizes stdout lines → AgentEvent
  │    gates paid/destructive verbs (ralphy generate/render, rm) → permission
  ├─ IPC: auth:get/set, agent:send, agent:event, agent:permission(:resolve)
  └─ BrowserWindow → loads dist/ (the Vite renderer)

Renderer (src/) — React + Vite
  ├─ window.ralphy bridge (electron/preload.ts) ; mock fallback (src/lib/ipc.ts)
  ├─ Onboarding  — subscription vs API-key auth
  ├─ Workspace   — Chat + ProjectPanel + PermissionModal
  └─ styles/     — tokens.css (mirrored from landing) + app.css
```

## Auth & billing (the honest version)

Two paths, picked on first run:

- **My Claude subscription (recommended)** — reuses the same `claude` login you
  use in the terminal. Usage is covered by your plan's monthly **Agent SDK credit**
  (Pro $20 · Max 5x $100 · Max 20x $200), with no API key and no pay-per-token.
- **Anthropic API key** — pay-per-token, for machines without a subscription login.

Important: this does **not** draw from the 5h/weekly *interactive* limits. Anthropic
routes all programmatic driving (Agent SDK and headless `claude -p`) to the separate
Agent SDK credit pool by design — there is no way to present as interactive Claude
Code. The subscription path still means "no extra key, covered by my plan."

Trap: if `ANTHROPIC_API_KEY` is set in your environment it silently overrides the
subscription and bills pay-per-token. The onboarding screen warns when it detects this.

## Known limits of this spike

- **Permission gate is not live yet.** The session runs in `--permission-mode default`,
  so read-only tools work and anything risky (Bash / Edit / Write, incl. paid
  `ralphy generate`) is denied in headless mode — safe, but the confirm-with-cost
  modal is wired in the UI only, not yet to the binary's `can_use_tool` channel
  (needs `--input-format stream-json` + the control protocol).
- **No live file watcher yet** — the project panel reflects chat progress, not real
  changes under `workspace/projects/<id>/`.
- **cwd is the repo root** for the demo (so the agent loads the full router). A real
  build would scope it to the selected project dir.

## Repository boundary

The desktop app launches installed coding-agent and `ralphy` binaries. It must
not import TypeScript from a sibling core checkout. CLI behavior belongs in
[alecs5am/ralphy](https://github.com/alecs5am/ralphy).
