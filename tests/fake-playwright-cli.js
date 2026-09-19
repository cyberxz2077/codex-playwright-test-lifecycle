#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const file = process.env.FAKE_CLI_STORE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
state.seenEnv.push({ browser: process.env.PLAYWRIGHT_MCP_BROWSER || null, session: process.env.PLAYWRIGHT_CLI_SESSION || null });

if (args[0] === "list") {
  process.stdout.write("### Browsers\n");
  for (const [name, status] of Object.entries(state.sessions))
    process.stdout.write(`- ${name}:\n${process.env.FAKE_LIST_NO_STATUS === "1" ? "" : `  - status: ${status}\n`}  - browser-type: chromium\n`);
} else {
  const match = /^-s=(.+)$/.exec(args[0] || "");
  if (!match) {
    process.stderr.write("Session required\n");
    process.exitCode = 2;
  } else if (args[1] === "open") {
    state.sessions[match[1]] = "open";
    if (process.env.FAKE_OPEN_FAIL === "1") {
      process.stderr.write("Open failed after launch\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("Opened browser\n");
    }
  } else if (args[1] === "close") {
    if (process.env.FAKE_CLOSE_FAIL === "1") {
      process.stderr.write("Close failed\n");
      process.exitCode = 1;
    } else {
      state.sessions[match[1]] = "closed";
      process.stdout.write("Closed browser\n");
    }
  } else if (state.sessions[match[1]] !== "open") {
    process.stderr.write("Browser is not open\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("Command completed\n");
  }
}

fs.writeFileSync(file, JSON.stringify(state));
