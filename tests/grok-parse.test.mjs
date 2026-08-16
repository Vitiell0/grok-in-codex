import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGrokArgs,
  buildGrokBackgroundWrapperSource,
  formatStreamProgressMessage,
  getStreamProgressHelperSource,
  getStreamStateHelperSource,
  humanizeGrokFailure,
  parseGrokJsonOutput,
  parseGrokStreamingOutput
} from "../plugins/grok/scripts/lib/grok.mjs";

test("parseGrokJsonOutput reads success payload", () => {
  const parsed = parseGrokJsonOutput(
    JSON.stringify({
      text: "hello",
      stopReason: "EndTurn",
      sessionId: "sess-1",
      requestId: "req-1"
    })
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.text, "hello");
  assert.equal(parsed.sessionId, "sess-1");
});

test("parseGrokJsonOutput reads error payload", () => {
  const parsed = parseGrokJsonOutput(JSON.stringify({ type: "error", message: "nope" }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /nope/);
});

test("buildGrokArgs write mode uses the documented automation flag", () => {
  const args = buildGrokArgs({ prompt: "hi", write: true, model: "grok-4.6" });
  assert.ok(args.includes("--always-approve"));
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("grok-4.6"));
  assert.ok(args.includes("--rules"));
  assert.ok(args.some((arg) => String(arg).includes("hypothetical diff")));
});

test("buildGrokArgs read-only mode uses denylist not allowlist", () => {
  const args = buildGrokArgs({ prompt: "review", write: false });
  assert.ok(!args.includes("--always-approve"));
  assert.ok(!args.includes("--tools"));
  assert.ok(args.includes("--disallowed-tools"));
  assert.ok(args.some((a) => String(a).includes("run_terminal_cmd")));
  assert.ok(args.includes("--rules"));
});

test("buildGrokArgs media mode avoids tools allowlist and always-approve", () => {
  const args = buildGrokArgs({
    prompt: "draw a banner",
    media: true,
    write: false,
    yolo: false
  });
  assert.ok(!args.includes("--tools"));
  assert.ok(!args.includes("--always-approve"));
  assert.ok(args.includes("--disallowed-tools"));
  assert.ok(args.some((a) => String(a).includes("run_terminal_cmd")));
});

test("humanizeGrokFailure maps RequirementError tool dumps", () => {
  const msg = humanizeGrokFailure({
    stderr:
      'RequirementError { message: "run_terminal_cmd background param constraint with --tools allowlist" }',
    exitCode: 1
  });
  assert.match(msg, /tool configuration/i);
  assert.match(msg, /disallowed-tools/i);
  assert.ok(!/RequirementError \{/.test(msg));
});

test("humanizeGrokFailure maps auth failures", () => {
  const msg = humanizeGrokFailure({ stderr: "Error: not logged in" });
  assert.match(msg, /not authenticated/i);
  assert.match(msg, /grok login/i);
});

test("parseGrokJsonOutput humanizes bare RequirementError text", () => {
  const parsed = parseGrokJsonOutput(
    'Error: RequirementError { kind: "tools", detail: "run_terminal_cmd background" }'
  );
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /tool configuration|requirement error/i);
});

test("parseGrokStreamingOutput records completed editor calls and paths", () => {
  const stdout = [
    JSON.stringify({ type: "text", data: "Editing now" }),
    JSON.stringify({
      type: "tool_call",
      toolCallId: "edit-1",
      toolName: "search_replace",
      kind: "edit",
      status: "pending",
      rawInput: { file_path: "src/app.ts" }
    }),
    JSON.stringify({
      type: "tool_call_update",
      toolCallId: "edit-1",
      status: "completed",
      locations: [{ path: "src/app.ts" }]
    }),
    JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-edit" })
  ].join("\n");

  const parsed = parseGrokStreamingOutput(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.text, "Editing now");
  assert.equal(parsed.sessionId, "sess-edit");
  assert.deepEqual(parsed.editSummary, {
    completedEditCalls: 1,
    tools: ["search_replace"],
    paths: ["src/app.ts"]
  });
});

test("parseGrokStreamingOutput does not mistake narrated tool markers for edits", () => {
  const stdout = [
    JSON.stringify({ type: "thought", data: "<|tool_call_begin|>search_replace..." }),
    JSON.stringify({ type: "text", data: "I fixed src/app.ts" }),
    JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "sess-false" })
  ].join("\n");

  const parsed = parseGrokStreamingOutput(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.editSummary.completedEditCalls, 0);
  assert.deepEqual(parsed.editSummary.paths, []);
});

test("parseGrokStreamingOutput rejects cancelled editor calls as completion evidence", () => {
  const stdout = [
    JSON.stringify({
      type: "tool_call",
      toolCallId: "edit-1",
      toolName: "write",
      kind: "edit",
      status: "pending",
      rawInput: { file_path: "src/app.ts" }
    }),
    JSON.stringify({
      type: "tool_call_update",
      toolCallId: "edit-1",
      status: "cancelled"
    }),
    JSON.stringify({ type: "end", stopReason: "EndTurn" })
  ].join("\n");

  const parsed = parseGrokStreamingOutput(stdout);
  assert.equal(parsed.editSummary.completedEditCalls, 0);
});

test("parseGrokStreamingOutput propagates structured stream errors", () => {
  const stdout = [
    JSON.stringify({ type: "available_commands", tools: ["read_file"] }),
    JSON.stringify({ type: "error", message: "session failed" })
  ].join("\n");

  const parsed = parseGrokStreamingOutput(stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "session failed");
});

test("formatStreamProgressMessage tails accumulated text", () => {
  assert.equal(formatStreamProgressMessage("  hello   world  "), "hello world");
  const long = "a".repeat(200);
  const msg = formatStreamProgressMessage(long);
  assert.equal(msg.length, 160);
  assert.equal(msg, "a".repeat(160));
});

test("formatStreamProgressMessage is empty until non-whitespace content exists", () => {
  // Grok emits truthy whitespace-only thought/text chunks; helper must not invent
  // a prefix-only line — call sites floor empty to "running".
  assert.equal(formatStreamProgressMessage(""), "");
  assert.equal(formatStreamProgressMessage("   "), "");
  assert.equal(formatStreamProgressMessage(" \n\t "), "");
  assert.equal(formatStreamProgressMessage("", { prefix: "thinking: " }), "");
  assert.equal(formatStreamProgressMessage("  ", { prefix: "thinking: " }), "");
  // Floor pattern used by the background worker
  assert.equal(formatStreamProgressMessage(" \n") || "running", "running");
  assert.equal(
    formatStreamProgressMessage("  ", { prefix: "thinking: " }) || "running",
    "running"
  );
});

test("formatStreamProgressMessage tails thinking with prefix (not single token)", () => {
  // Live repro: thought events stream as tiny chunks; progress must show a tail of all of them.
  let thoughtAcc = "";
  for (const chunk of [" frame", "...", " how control.mjs is used", " across the plugin"]) {
    thoughtAcc += chunk;
  }
  const msg = formatStreamProgressMessage(thoughtAcc, { prefix: "thinking: " });
  assert.match(msg, /^thinking: /);
  assert.match(msg, /across the plugin/);
  assert.ok(!/^thinking:  frame\.\.\.$/.test(msg), "must not show only first token");
  // Last token alone would be " across the plugin" — full tail is longer.
  assert.ok(msg.length > "thinking:  across the plugin".length);
});

test("background wrapper embeds the same progress helper tests exercise", () => {
  const helperSrc = getStreamProgressHelperSource();
  const stateHelperSrc = getStreamStateHelperSource();
  assert.equal(helperSrc, formatStreamProgressMessage.toString());

  // The string that lands in the worker is the live function body — evaluate it.
  const embedded = new Function(`${helperSrc}; return formatStreamProgressMessage;`)();
  assert.equal(embedded("  hello   world  "), "hello world");
  assert.equal(embedded("a".repeat(200)).length, 160);
  assert.equal(embedded(" \n") || "running", "running");
  assert.equal(embedded("  ", { prefix: "thinking: " }) || "running", "running");

  let thoughtAcc = "";
  for (const chunk of [" frame", "...", " how control.mjs is used", " across the plugin"]) {
    thoughtAcc += chunk;
  }
  const thinking = embedded(thoughtAcc, { prefix: "thinking: " });
  assert.match(thinking, /^thinking: /);
  assert.match(thinking, /across the plugin/);

  const wrapper = buildGrokBackgroundWrapperSource({
    binary: "/usr/bin/true",
    args: ["-p", "hi"],
    resultFile: "/tmp/result.json",
    progressFile: "/tmp/progress.json",
    cwd: "/tmp",
    streaming: true
  });
  assert.doesNotThrow(() => new Function(wrapper));
  assert.ok(
    wrapper.includes(helperSrc),
    "worker script must contain the helper source (not a drifted copy)"
  );
  assert.ok(wrapper.includes(stateHelperSrc));
  assert.match(wrapper, /editSummary/);
  assert.ok(!wrapper.includes("formatProgressTail"), "old inline copy must be gone");
  assert.match(wrapper, /formatStreamProgressMessage\(thoughtAcc/);
  assert.match(wrapper, /formatStreamProgressMessage\(textAcc/);
  // Call-site floor: empty helper result must not blank /status
  assert.match(
    wrapper,
    /formatStreamProgressMessage\(textAcc,\s*\{\}\)\s*\|\|\s*"running"/
  );
  assert.match(wrapper, /\|\|\s*"running"/g);
  const floors = wrapper.match(/\|\|\s*"running"/g) || [];
  assert.equal(floors.length, 2, "text and thought branches both floor empty progress");
});
