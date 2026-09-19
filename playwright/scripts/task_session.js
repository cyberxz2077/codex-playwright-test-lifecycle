#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const FORBIDDEN_OPTIONS = /^(--session(?:=|$)|-s(?:=|$)|--persistent$|--profile(?:=|$)|--cdp(?:=|$)|--endpoint(?:=|$)|--config(?:=|$)|--idle-timeout(?:=|$))/;
const SAFE_CONFIG = path.join(__dirname, "../config/task-browser.json");

function ownerFrom(value) {
  if (!value || !OWNER_PATTERN.test(value))
    throw new Error("A valid CODEX_SESSION_ID is required for task-owned browser tests.");
  return value;
}

function sessionName(owner) {
  return `codex-qa-${ownerFrom(owner)}`;
}

function statePath(owner) {
  const root = process.env.PW_TEST_STATE_DIR || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "playwright-task-sessions");
  return path.join(root, `${ownerFrom(owner)}.json`);
}

function readState(owner) {
  const filename = statePath(owner);
  if (!fs.existsSync(filename))
    return null;
  const state = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (state.owner !== owner || state.session !== sessionName(owner) || typeof state.active !== "boolean")
    throw new Error("Invalid task browser session record; no browser was closed.");
  return state;
}

function writeState(owner, active) {
  const filename = statePath(owner);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const previous = readState(owner);
  const state = { owner, session: sessionName(owner), active, openedAt: previous?.openedAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function callCli(args, timeout = 120000) {
  const command = process.env.PW_TEST_CLI_BIN || path.join(__dirname, "playwright_cli.sh");
  const env = { ...process.env, PWTEST_CLI_GLOBAL_CONFIG: path.join(__dirname, "..") };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PLAYWRIGHT_MCP_") || key === "PLAYWRIGHT_CLI_SESSION")
      delete env[key];
  }
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 });
  return { ok: !result.error && result.status === 0, output: (result.stdout || "") + (result.stderr || ""), error: result.error?.message || (result.status === 0 ? "" : `exit ${result.status}`) };
}

function isOpen(listOutput, session) {
  const lines = listOutput.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `- ${session}:`);
  if (start === -1)
    return false;
  for (let index = start + 1; index < lines.length && !/^\s*- [^\s].*:$/.test(lines[index]); index++) {
    const match = /^\s*- status: (\S+)\s*$/.exec(lines[index]);
    if (match)
      return match[1] === "open";
  }
  return null;
}

function closeOwner(owner) {
  const state = readState(owner);
  if (!state?.active)
    return { ok: true, closed: false };

  const before = callCli(["list"], 20000);
  if (!before.ok)
    return { ok: false, error: `Could not inspect the task browser: ${before.error}` };
  const beforeStatus = isOpen(before.output, state.session);
  if (beforeStatus === null)
    return { ok: false, error: "Could not determine task browser status; no browser was closed." };
  if (!beforeStatus) {
    writeState(owner, false);
    return { ok: true, closed: false };
  }

  const result = callCli([`-s=${state.session}`, "close"], 20000);
  const after = callCli(["list"], 20000);
  if (after.ok && isOpen(after.output, state.session) === false) {
    writeState(owner, false);
    return { ok: true, closed: true };
  }
  return { ok: false, error: `The task browser is still open (${result.error}); no other browser was touched.` };
}

function idleTimeout() {
  const value = Number(process.env.PW_TEST_IDLE_TIMEOUT_MS || DEFAULT_IDLE_TIMEOUT_MS);
  if (!Number.isSafeInteger(value) || value < 1000)
    throw new Error("PW_TEST_IDLE_TIMEOUT_MS must be an integer of at least 1000.");
  return value;
}

function assertScopedCommand(args) {
  if (args.some(arg => FORBIDDEN_OPTIONS.test(arg)))
    throw new Error("Use the task-owned session only; profile, attachment, timeout, config and session overrides are not allowed.");
  if (["close-all", "kill-all", "delete-data", "attach", "detach"].includes(args[0]))
    throw new Error("This command can affect unrelated browsers and is not supported by task QA.");
}

function runCommand(args) {
  const owner = ownerFrom(process.env.CODEX_SESSION_ID);
  const command = args[0];
  if (!command)
    throw new Error("Usage: task_playwright_cli.sh open|<playwright-command>|finish|status [args]");

  if (command === "finish" || command === "close") {
    const result = closeOwner(owner);
    if (!result.ok)
      throw new Error(result.error);
    process.stdout.write(result.closed ? "Closed this task's Playwright browser.\n" : "This task has no open Playwright browser.\n");
    return;
  }
  if (command === "status") {
    const state = readState(owner);
    process.stdout.write(state?.active ? `Task browser registered: ${state.session}\n` : "No task browser registered.\n");
    return;
  }

  assertScopedCommand(args);
  if (command === "open" && readState(owner)?.active)
    throw new Error("This task already has a browser session. Run finish before opening a new QA round.");
  if (command !== "open" && !readState(owner)?.active)
    throw new Error("Open a task-owned browser before running Playwright commands.");

  const session = sessionName(owner);
  const flags = command === "open" ? [`--config=${SAFE_CONFIG}`, `--idle-timeout=${idleTimeout()}`] : [];
  if (command === "open")
    writeState(owner, true);
  const result = callCli([`-s=${session}`, ...args, ...flags]);
  process.stdout.write(result.output);
  if (!result.ok) {
    const cleanup = command === "open" ? closeOwner(owner) : { ok: true };
    throw new Error(`Playwright ${command} failed (${result.error}).${cleanup.ok ? "" : ` Cleanup also failed: ${cleanup.error}`}`);
  }
}

function runStopHook() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (input.hook_event_name !== "Stop")
      throw new Error("Expected a Codex Stop event.");
    const result = closeOwner(ownerFrom(input.session_id));
    if (result.ok) {
      process.stdout.write("{}\n");
    } else if (input.stop_hook_active) {
      process.stdout.write(JSON.stringify({ systemMessage: "Task-owned Playwright browser cleanup failed. Please close that specific session and report the failure; other browsers were untouched." }) + "\n");
    } else {
      process.stdout.write(JSON.stringify({ decision: "block", reason: "Task-owned Playwright browser cleanup failed. Run task_playwright_cli.sh finish for this task, then verify before the final reply." }) + "\n");
    }
  } catch (error) {
    const reason = `Playwright task cleanup could not run: ${error.message}`;
    process.stdout.write(JSON.stringify(input?.stop_hook_active ? { systemMessage: reason } : { decision: "block", reason }) + "\n");
  }
}

try {
  if (process.argv[2] === "hook")
    runStopHook();
  else
    runCommand(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
