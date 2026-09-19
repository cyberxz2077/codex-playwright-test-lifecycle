# Codex Playwright test-browser lifecycle

Source for a task-scoped Playwright CLI skill. The original skill is kept as the base; this change adds an automatic-QA entry point without changing the user's regular Chrome, Codex in-app browser, development server, or preview URL. This is a Codex-side workflow fix, not a pull request to the upstream Playwright MCP server.

## Behavior

- `playwright/scripts/task_playwright_cli.sh open <url>` creates one isolated, headless Chrome session named from `CODEX_SESSION_ID`. It uses the installed Chrome channel without the user's regular browser profile or another Codex task's session.
- Use the same wrapper for snapshots, clicks, screenshots and traces. Save test evidence first, then run `finish` at the end of **each** QA round. A later fix can start a fresh round with `open`.
- The optional Codex `Stop` hook closes a registered session before a final reply if a task forgot `finish`. A 15-minute CLI idle timeout is a fallback for interruption or a disabled hook; it is not the normal cleanup path.
- Cleanup calls Playwright's named-session `close`, verifies the session is no longer open, and leaves other sessions untouched. It never uses `close-all`, `kill-all`, `delete-data`, or a system process kill.

## Local installation

After reviewing the change, back up the existing `~/.codex/skills/playwright` folder, install this repository's `playwright/` directory in its place, and merge this `Stop` entry into `~/.codex/hooks.json` without replacing its other events:

```json
"Stop": [{
  "hooks": [{
    "type": "command",
    "command": "node \"$HOME/.codex/skills/playwright/scripts/task_session.js\" hook",
    "timeout": 65
  }]
}]
```

This is one property inside the existing `hooks` object, not a complete replacement JSON file. Avoid adding an inline `[hooks]` to `config.toml` alongside an existing `hooks.json` at the same layer: Codex loads both and warns. Review and trust the new hook when Codex prompts you. An untrusted or disabled hook will not provide final-reply cleanup; the task wrapper's explicit `finish` and idle timeout still work. Existing Playwright sessions created before installation are not enrolled or silently closed.

The default Chrome channel needs Google Chrome installed. For an environment that has only Playwright's downloaded Chromium, change `browser.launchOptions.channel` in `playwright/config/task-browser.json` to the installed channel. The default remains headless and isolated.

The normal `scripts/playwright_cli.sh` remains available for an explicitly requested persistent/manual session. Its sessions are not registered for task cleanup. The task wrapper requires `CODEX_SESSION_ID` and rejects profile, attachment, custom-session, custom-config, and mass-cleanup options.

This repository scopes cleanup to the Playwright CLI sessions it created. A Playwright MCP server is a separate browser owner; if used for a test, explicitly call its `browser_close` tool after collecting results. The CLI `Stop` hook cannot safely close an unrelated or shared MCP session.

## Verification

```bash
node --test tests/task-session.test.js
node --check playwright/scripts/task_session.js
bash -n playwright/scripts/playwright_cli.sh playwright/scripts/task_playwright_cli.sh
```

The tests use a fake CLI and verify task isolation, cleanup before Stop, failure reporting, environment isolation, and preservation of a regular browser. A separate real-browser smoke test is necessary before claiming macOS Dock behavior.
