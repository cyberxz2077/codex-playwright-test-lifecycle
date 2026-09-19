---
name: "playwright"
description: "Use when the task requires automating a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction, UI-flow debugging) via `playwright-cli` or the bundled wrapper script."
---


# Playwright CLI Skill

Drive a real browser from the terminal using `playwright-cli`. For Codex-owned automated QA, use the task-scoped wrapper: its browser is temporary, isolated from the user's regular Chrome, and closed before the final reply. The original wrapper remains available for explicitly requested persistent/manual sessions.
Treat this skill as CLI-first automation. Do not pivot to `@playwright/test` unless the user explicitly asks for test files.

## Prerequisite check (required)

Before proposing commands, check whether `npx` and `node` are available (the wrappers depend on them):

```bash
command -v npx >/dev/null 2>&1
command -v node >/dev/null 2>&1
```

If it is not available, pause and ask the user to install Node.js/npm (which provides `npx`). Provide these steps verbatim:

```bash
# Verify Node/npm are installed
node --version
npm --version

# If missing, install Node.js/npm, then:
npm install -g @playwright/cli@latest
playwright-cli --help
```

Once `npx` is present, proceed with the wrapper script. A global install of `playwright-cli` is optional.

## Skill path (set once)

```bash
export PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/task_playwright_cli.sh"
export PWCLI_RAW="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"
```

User-scoped skills install under `$CODEX_HOME/skills` (default: `~/.codex/skills`).

## Quick start

Use the task wrapper for a Codex-owned QA round. It requires `CODEX_SESSION_ID`; it does not use the user's regular Chrome profile:

```bash
"$PWCLI" open https://playwright.dev
"$PWCLI" snapshot
"$PWCLI" click e15
"$PWCLI" type "Playwright"
"$PWCLI" press Enter
"$PWCLI" screenshot
"$PWCLI" finish
```

If the user prefers a global install, this is also valid:

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
```

## Core workflow

1. Open the page.
2. Snapshot to get stable element refs.
3. Interact using refs from the latest snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture the useful artifacts and bug feedback.
6. Run `finish` before leaving the QA round. If you implement a fix and test again, open a fresh task-owned browser. Before the final answer, verify `status` reports no registered browser.

Minimal loop:

```bash
"$PWCLI" open https://example.com
"$PWCLI" snapshot
"$PWCLI" click e3
"$PWCLI" snapshot
"$PWCLI" finish
```

## When to snapshot again

Snapshot again after:

- navigation
- clicking elements that change the UI substantially
- opening/closing modals or menus
- tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit

```bash
"$PWCLI" open https://example.com/form
"$PWCLI" snapshot
"$PWCLI" fill e1 "user@example.com"
"$PWCLI" fill e2 "password123"
"$PWCLI" click e3
"$PWCLI" snapshot
"$PWCLI" finish
```

### Debug a UI flow with traces

```bash
"$PWCLI" open https://example.com --headed
"$PWCLI" tracing-start
# ...interactions...
"$PWCLI" tracing-stop
"$PWCLI" finish
```

### Multi-tab work

```bash
"$PWCLI" tab-new https://example.com
"$PWCLI" tab-list
"$PWCLI" tab-select 0
"$PWCLI" snapshot
"$PWCLI" finish
```

## Wrapper script

The task wrapper creates a session named for the current Codex task, forces an isolated Chrome config, defaults to headless operation, and adds a 15-minute idle timeout for interrupted work. `finish` closes only that session; it never calls `close-all`, deletes browser data, or stops a development server. A Codex `Stop` hook can make final-answer cleanup a second safeguard; installation and trust are described in the repository's README. Keep preview URLs in the final answer so the user can open them independently in the in-app browser.

The original wrapper still uses `npx --package @playwright/cli playwright-cli` for an explicitly persistent/manual session:

```bash
"$PWCLI_RAW" --help
```

Prefer the wrapper unless the repository already standardizes on a global install.

## References

Open only what you need:

- CLI command reference: `references/cli.md`
- Practical workflows and troubleshooting: `references/workflows.md`

## Guardrails

- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` and `run-code` unless needed.
- When you do not have a fresh snapshot, use placeholder refs like `eX` and say why; do not bypass refs with `run-code`.
- Use `--headed` only if a visible external browser is needed for the specific check. Screenshots and DOM QA normally work headlessly.
- Do not use the raw wrapper, `close-all`, `kill-all`, a shared Chrome profile, or a saved login for ordinary automatic QA. Keep manual Chrome and the Codex in-app browser outside task cleanup.
- If Playwright MCP was used instead of the CLI, call its `browser_close` after collecting evidence; the CLI cleanup cannot identify or close that separate browser. Do not close an MCP browser owned by another task.
- If the task wrapper reports a cleanup failure, resolve or disclose it before the final answer; never claim a browser was closed from the test result alone.
- When capturing artifacts in this repo, use `output/playwright/` and avoid introducing new top-level artifact folders.
- Default to CLI commands and workflows, not Playwright test specs.
