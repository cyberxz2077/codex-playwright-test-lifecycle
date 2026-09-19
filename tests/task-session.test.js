"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "../playwright/scripts/task_session.js");
const rawWrapper = path.join(__dirname, "../playwright/scripts/playwright_cli.sh");
const fakeCli = path.join(__dirname, "fake-playwright-cli.js");
const firstOwner = "11111111-1111-4111-8111-111111111111";
const secondOwner = "22222222-2222-4222-8222-222222222222";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-task-qa-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.chmodSync(fakeCli, 0o755);
  const store = path.join(directory, "fake-cli.json");
  fs.writeFileSync(store, JSON.stringify({ sessions: { "my-regular-browser": "open" }, calls: [], seenEnv: [] }));
  return {
    store,
    env: { ...process.env, CODEX_HOME: directory, PW_TEST_CLI_BIN: fakeCli, FAKE_CLI_STORE: store, CODEX_SESSION_ID: firstOwner },
    read: () => JSON.parse(fs.readFileSync(store, "utf8")),
    run(args, extra = {}, input) {
      return spawnSync(process.execPath, [script, ...args], { env: { ...this.env, ...extra }, input, encoding: "utf8" });
    },
  };
}

test("a task closes only its own session and never touches the regular browser", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "http://127.0.0.1:4321/"]).status, 0);
  assert.equal(f.run(["snapshot"]).status, 0);
  assert.equal(f.run(["finish"]).status, 0);
  assert.equal(f.run(["finish"]).status, 0);

  const state = f.read();
  assert.equal(state.sessions[`codex-qa-${firstOwner}`], "closed");
  assert.equal(state.sessions["my-regular-browser"], "open");
  const open = state.calls.find(args => args[1] === "open");
  assert.deepEqual(open.slice(0, 3), [`-s=codex-qa-${firstOwner}`, "open", "http://127.0.0.1:4321/"]);
  assert.match(open[3], /^--config=.*\/config\/task-browser\.json$/);
  assert.equal(open[4], "--idle-timeout=900000");
  assert.deepEqual(state.calls.filter(args => args[1] === "close"), [[`-s=codex-qa-${firstOwner}`, "close"]]);
  assert.equal(fs.statSync(path.join(f.env.CODEX_HOME, "playwright-task-sessions", `${firstOwner}.json`)).mode & 0o777, 0o600);
});

test("Stop closes the current task before final reply without closing another task", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "about:blank"]).status, 0);
  assert.equal(f.run(["open", "about:blank"], { CODEX_SESSION_ID: secondOwner }).status, 0);
  const hook = f.run(["hook"], {}, JSON.stringify({ hook_event_name: "Stop", session_id: firstOwner, stop_hook_active: false }));
  assert.equal(hook.status, 0);
  assert.deepEqual(JSON.parse(hook.stdout), {});
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "closed");
  assert.equal(f.read().sessions[`codex-qa-${secondOwner}`], "open");
  assert.equal(f.read().sessions["my-regular-browser"], "open");
});

test("failed cleanup blocks one final reply and remains scoped", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "about:blank"]).status, 0);
  const input = { hook_event_name: "Stop", session_id: firstOwner, stop_hook_active: false };
  const first = f.run(["hook"], { FAKE_CLOSE_FAIL: "1" }, JSON.stringify(input));
  assert.equal(JSON.parse(first.stdout).decision, "block");
  const second = f.run(["hook"], { FAKE_CLOSE_FAIL: "1" }, JSON.stringify({ ...input, stop_hook_active: true }));
  assert.match(JSON.parse(second.stdout).systemMessage, /cleanup failed/);
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "open");
  assert.equal(f.read().sessions["my-regular-browser"], "open");
  assert.equal(f.run(["finish"]).status, 0);
});

test("unknown browser status fails closed rather than marking an open session clean", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "about:blank"]).status, 0);
  assert.notEqual(f.run(["finish"], { FAKE_LIST_NO_STATUS: "1" }).status, 0);
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "open");
  assert.equal(f.read().calls.some(args => args[1] === "close"), false);
});

test("a damaged task record blocks a final reply rather than silently skipping cleanup", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "about:blank"]).status, 0);
  const stateFile = path.join(f.env.CODEX_HOME, "playwright-task-sessions", `${firstOwner}.json`);
  fs.writeFileSync(stateFile, "corrupt");
  const hook = f.run(["hook"], {}, JSON.stringify({ hook_event_name: "Stop", session_id: firstOwner, stop_hook_active: false }));
  assert.equal(JSON.parse(hook.stdout).decision, "block");
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "open");
});

test("inherited Playwright profile and browser environment cannot redirect task QA", t => {
  const f = fixture(t);
  const env = { PLAYWRIGHT_CLI_SESSION: "my-regular-browser", PLAYWRIGHT_MCP_BROWSER: "chrome" };
  assert.equal(f.run(["open", "about:blank"], env).status, 0);
  assert.equal(f.run(["finish"], env).status, 0);
  assert.equal(f.read().sessions["my-regular-browser"], "open");
  assert(f.read().seenEnv.every(item => item.browser === null && item.session === null));
});

test("task QA refuses session/profile overrides and mass cleanup", t => {
  const f = fixture(t);
  for (const args of [["open", "about:blank", "--persistent"], ["open", "about:blank", "--profile=/tmp/manual"], ["open", "about:blank", "--session=manual"], ["open", "about:blank", "--idle-timeout=0"], ["open", "about:blank", "--config=/tmp/manual"], ["close-all"], ["kill-all"], ["attach", "manual"]])
    assert.notEqual(f.run(args).status, 0, args.join(" "));
  assert.equal(f.read().sessions["my-regular-browser"], "open");
  assert.equal(f.read().calls.length, 0);
  assert.notEqual(f.run(["open", "about:blank"], { CODEX_SESSION_ID: "" }).status, 0);
});

test("a second open cannot accidentally close this task's existing QA round", t => {
  const f = fixture(t);
  assert.equal(f.run(["open", "about:blank"]).status, 0);
  assert.notEqual(f.run(["open", "about:blank"]).status, 0);
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "open");
  assert.equal(f.read().calls.filter(args => args[1] === "close").length, 0);
  assert.equal(f.run(["finish"]).status, 0);
});

test("an open error cleans up an already-launched task browser", t => {
  const f = fixture(t);
  assert.notEqual(f.run(["open", "about:blank"], { FAKE_OPEN_FAIL: "1" }).status, 0);
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "closed");
  assert.equal(f.read().sessions["my-regular-browser"], "open");
  assert.equal(f.run(["status"]).stdout.trim(), "No task browser registered.");
});

test("a failed recovery after open reports the remaining browser", t => {
  const f = fixture(t);
  const result = f.run(["open", "about:blank"], { FAKE_OPEN_FAIL: "1", FAKE_CLOSE_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cleanup also failed/);
  assert.equal(f.read().sessions[`codex-qa-${firstOwner}`], "open");
  assert.equal(f.run(["finish"]).status, 0);
});

test("the raw wrapper does not inject an inherited session over -s=task", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "playwright-wrapper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const npx = path.join(directory, "npx");
  fs.writeFileSync(npx, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n", { mode: 0o755 });
  const result = spawnSync(rawWrapper, ["-s=task", "list"], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, PLAYWRIGHT_CLI_SESSION: "my-regular-browser" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["--yes", "--package", "@playwright/cli", "playwright-cli", "-s=task", "list"]);
});
