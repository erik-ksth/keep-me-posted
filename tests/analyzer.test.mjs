import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeCodexSession,
  buildContextView,
  buildTimeline,
  CATEGORY_META,
} from "../src/analyzer.js";
import { SAMPLE_SESSION } from "../src/sample.js";

const jsonl = (records) => records.map((record) => JSON.stringify(record)).join("\n");

test("parses the built-in Codex session into request-level views", () => {
  const session = analyzeCodexSession(SAMPLE_SESSION, { sourceName: "sample.jsonl" });

  assert.equal(session.metadata.sourceName, "sample.jsonl");
  assert.equal(session.metadata.turns, 4);
  assert.equal(session.requests.length, 4);
  assert.equal(session.terminalRequests.length, 4);
  assert.deepEqual(
    session.terminalRequests.map((request) => request.inputTokens),
    [2_600, 4_300, 7_200, 8_800],
  );

  const timeline = buildTimeline(session);
  assert.equal(timeline.length, 4);
  assert.equal(timeline.at(-1).request.turn, 4);
});

test("every context view reconciles exactly to the official input-token total", () => {
  const session = analyzeCodexSession(SAMPLE_SESSION);
  for (const request of session.requests) {
    const view = buildContextView(session, request);
    const itemTotal = view.items.reduce((sum, item) => sum + item.tokens, 0);
    const compositionTotal = Object.values(view.composition).reduce(
      (sum, tokens) => sum + tokens,
      0,
    );

    assert.equal(itemTotal, request.inputTokens);
    assert.equal(compositionTotal, request.inputTokens);
    assert.equal(
      view.compositionRows.reduce((sum, row) => sum + row.tokens, 0),
      request.inputTokens,
    );
  }
});

test("keeps official counters distinct from reconstructed categories", () => {
  const session = analyzeCodexSession(SAMPLE_SESSION);
  const view = buildContextView(session, session.terminalRequests.at(-1));

  assert.equal(view.request.cachedInputTokens, 7_120);
  assert.equal(view.request.outputTokens, 290);
  assert.equal(view.request.reasoningOutputTokens, 760);
  assert.equal(view.request.modelContextWindow, 16_000);
  assert.equal(Math.round(view.fullnessPercent), 55);
  assert.equal(view.observableEstimatedTokens + view.unresolvedTokens, view.inputTokens);
  assert.equal(Object.keys(view.composition).length, Object.keys(CATEGORY_META).length);
});

test("deduplicates repeated snapshots of one provider request", () => {
  const records = [
    sessionMeta(),
    userMessage("Inspect the request."),
    tokenCount({ cumulative: 1_000, input: 1_000, output: 10 }),
    tokenCount({ cumulative: 1_000, input: 1_000, output: 40 }),
    userMessage("Continue."),
    tokenCount({ cumulative: 2_500, input: 1_500, output: 20 }),
  ];

  const session = analyzeCodexSession(jsonl(records));
  assert.equal(session.requests.length, 2);
  assert.deepEqual(
    session.requests.map((request) => request.inputTokens),
    [1_000, 1_500],
  );
});

test("retention lens marks the older unchanged overlapping read", () => {
  const records = [
    sessionMeta(),
    userMessage("Read the module."),
    toolCall("r1", "sed -n '1,80p' src/example.ts"),
    toolOutput("r1", 240, "export const value = 1;"),
    tokenCount({ cumulative: 1_200, input: 1_200 }),
    userMessage("Read that section again."),
    toolCall("r2", "sed -n '20,60p' src/example.ts"),
    toolOutput("r2", 250, "export const value = 1;"),
    tokenCount({ cumulative: 3_200, input: 2_000 }),
  ];

  const session = analyzeCodexSession(jsonl(records));
  const view = buildContextView(session, session.terminalRequests.at(-1));
  const reads = view.items.filter((item) => item.kind === "read_output");

  assert.equal(reads.length, 2);
  const older = reads.find((item) => item.turn === 1);
  const newer = reads.find((item) => item.turn === 2);
  assert.equal(older.potentiallyNotUseful, true);
  assert.match(older.retentionReason, /newer overlapping read/i);
  assert.equal(newer.potentiallyNotUseful, false);
});

test("does not mark a reread across an intervening edit", () => {
  const records = [
    sessionMeta(),
    userMessage("Read the module."),
    toolCall("r1", "sed -n '1,80p' src/example.ts"),
    toolOutput("r1", 200, "export const value = 1;"),
    tokenCount({ cumulative: 1_000, input: 1_000 }),
    userMessage("Change it and reread."),
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch\n",
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        changes: { "src/example.ts": { kind: "modified" } },
      },
    },
    toolCall("r2", "sed -n '1,80p' src/example.ts"),
    toolOutput("r2", 210, "export const value = 2;"),
    tokenCount({ cumulative: 3_200, input: 2_200 }),
  ];

  const session = analyzeCodexSession(jsonl(records));
  const view = buildContextView(session, session.terminalRequests.at(-1));
  const reads = view.items.filter((item) => item.kind === "read_output");

  assert.equal(reads.length, 2);
  assert.equal(reads.some((item) => item.potentiallyNotUseful), false);
});

test("skips malformed lines without losing valid events", () => {
  const text = [
    JSON.stringify(sessionMeta()),
    "{ definitely-not-json",
    JSON.stringify(userMessage("Continue.")),
    JSON.stringify(tokenCount({ cumulative: 800, input: 800 })),
  ].join("\n");

  const session = analyzeCodexSession(text);
  assert.equal(session.metadata.turns, 1);
  assert.equal(session.requests.length, 1);
});

function sessionMeta() {
  return {
    type: "session_meta",
    payload: {
      type: "session_meta",
      id: "fixture",
      cwd: "/tmp/fixture",
      base_instructions: { text: "Keep changes focused." },
      dynamic_tools: [{ name: "exec_command" }],
    },
  };
}

function userMessage(message) {
  return {
    type: "event_msg",
    payload: { type: "user_message", message },
  };
}

function toolCall(callId, cmd) {
  return {
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: callId,
      arguments: JSON.stringify({ cmd }),
    },
  };
}

function toolOutput(callId, tokens, output) {
  return {
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: callId,
      output: `Original token count: ${tokens}\n${output}`,
    },
  };
}

function tokenCount({ cumulative, input, output = 0 }) {
  return {
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 10_000,
        total_token_usage: { input_tokens: cumulative },
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: Math.round(input * 0.6),
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
      },
    },
  };
}
