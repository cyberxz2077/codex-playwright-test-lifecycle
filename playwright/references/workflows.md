# Playwright CLI Workflows

Use the task-scoped wrapper and snapshot often. Assume `PWCLI` is set to `scripts/task_playwright_cli.sh` and `pwcli` is an alias for `"$PWCLI"`.
In this repo, run commands from `output/playwright/<label>/` to keep artifacts contained.
End each QA round with `pwcli finish`; save artifacts and feedback first. A local preview URL is an output for the user, not a reason to leave the testing browser open.

## Standard interaction loop

```bash
pwcli open https://example.com
pwcli snapshot
pwcli click e3
pwcli snapshot
pwcli finish
```

## Form submission

```bash
pwcli open https://example.com/form
pwcli snapshot
pwcli fill e1 "user@example.com"
pwcli fill e2 "password123"
pwcli click e3
pwcli snapshot
pwcli screenshot
pwcli finish
```

## Data extraction

```bash
pwcli open https://example.com
pwcli snapshot
pwcli eval "document.title"
pwcli eval "el => el.textContent" e12
pwcli finish
```

## Debugging and inspection

Capture console messages and network activity after reproducing an issue:

```bash
pwcli console warning
pwcli network
```

Record a trace around a suspicious flow:

```bash
pwcli tracing-start
# reproduce the issue
pwcli tracing-stop
pwcli screenshot
pwcli finish
```

## Sessions

The task wrapper assigns a private session using `CODEX_SESSION_ID`. It rejects custom session names and attachment/profile flags, and `finish` closes only that task's session. The next QA round can call `open` again. For a deliberately persistent manual session, use the original `scripts/playwright_cli.sh` instead:

```bash
"$PWCLI_RAW" --session manual-review open https://example.com --headed
"$PWCLI_RAW" --session manual-review close
```

Do not reuse the manual session name for task QA. The task wrapper supplies its own isolated configuration and ignores inherited Playwright browser/profile environment variables.

## Troubleshooting

- If an element ref fails, run `pwcli snapshot` again and retry.
- If the page looks wrong, re-open with `--headed` and resize the window.
- If a flow depends on state inside one QA round, keep the task session until evidence is captured, then `finish`. For a later round, reopen and recreate only the necessary test state.
- A failed `finish` is not a successful cleanup. The configured Codex `Stop` hook retries before the final answer; the idle timeout limits interrupted sessions.
