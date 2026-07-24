const records = [
  {
    timestamp: "2026-07-23T16:00:00.000Z",
    type: "session_meta",
    payload: {
      type: "session_meta",
      id: "example-context-session",
      cwd: "/Users/example/projects/atlas",
      cli_version: "0.1.0",
      model: "codex",
      base_instructions: {
        text: "You are a coding agent. Keep changes focused, preserve user work, and verify the result.",
      },
      dynamic_tools: [
        { name: "exec_command", description: "Run a shell command." },
        { name: "apply_patch", description: "Edit files with a patch." },
        { name: "view_image", description: "Inspect a local image." },
      ],
    },
  },
  {
    timestamp: "2026-07-23T16:00:01.000Z",
    type: "turn_context",
    payload: {
      collaboration_mode: "default",
      cwd: "/Users/example/projects/atlas",
    },
  },
  {
    timestamp: "2026-07-23T16:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "Inspect the session parser and explain how it reconstructs context.",
    },
  },
  {
    timestamp: "2026-07-23T16:00:03.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "read-parser-1",
      arguments: JSON.stringify({ cmd: "sed -n '1,220p' src/session-parser.ts" }),
    },
  },
  {
    timestamp: "2026-07-23T16:00:04.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "read-parser-1",
      output:
        "Original token count: 920\nexport function parseSession(lines: string[]) {\n  return lines.map(parseEvent).filter(Boolean);\n}\n",
    },
  },
  {
    timestamp: "2026-07-23T16:00:05.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message:
        "The parser turns each rollout event into a typed ledger entry and preserves its source turn.",
    },
  },
  {
    timestamp: "2026-07-23T16:00:06.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 16_000,
        total_token_usage: { input_tokens: 2_600 },
        last_token_usage: {
          input_tokens: 2_600,
          cached_input_tokens: 1_120,
          output_tokens: 180,
          reasoning_output_tokens: 240,
          total_tokens: 3_020,
        },
      },
    },
  },
  {
    timestamp: "2026-07-23T16:01:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "Add request-level accounting and preserve every visible item.",
    },
  },
  {
    timestamp: "2026-07-23T16:01:01.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "search-usage",
      arguments: JSON.stringify({ cmd: "rg -n \"token_count|input_tokens\" src tests" }),
    },
  },
  {
    timestamp: "2026-07-23T16:01:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "search-usage",
      output:
        "Original token count: 410\nsrc/session-parser.ts:44: if (event.type === 'token_count')\ntests/session-parser.test.ts:88: input_tokens: 4200",
    },
  },
  {
    timestamp: "2026-07-23T16:01:03.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "read-parser-2",
      arguments: JSON.stringify({ cmd: "sed -n '1,220p' src/session-parser.ts" }),
    },
  },
  {
    timestamp: "2026-07-23T16:01:04.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "read-parser-2",
      output:
        "Original token count: 960\nexport function parseSession(lines: string[]) {\n  const requests = [];\n  return { requests, items: lines.map(parseEvent).filter(Boolean) };\n}\n",
    },
  },
  {
    timestamp: "2026-07-23T16:01:05.000Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "apply_patch",
      input:
        "*** Begin Patch\n*** Update File: src/session-parser.ts\n@@\n-export function parseSession(lines: string[]) {\n+export function parseSession(lines: string[]) {\n+  const requests = collectRequests(lines);\n*** End Patch\n",
    },
  },
  {
    timestamp: "2026-07-23T16:01:06.000Z",
    type: "event_msg",
    payload: {
      type: "patch_apply_end",
      changes: { "src/session-parser.ts": { kind: "modified" } },
    },
  },
  {
    timestamp: "2026-07-23T16:01:07.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message:
        "Request snapshots now retain the official input, cached-input, output, and reasoning counters.",
    },
  },
  {
    timestamp: "2026-07-23T16:01:08.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 16_000,
        total_token_usage: { input_tokens: 6_900 },
        last_token_usage: {
          input_tokens: 4_300,
          cached_input_tokens: 2_900,
          output_tokens: 260,
          reasoning_output_tokens: 430,
          total_tokens: 4_990,
        },
      },
    },
  },
  {
    timestamp: "2026-07-23T16:02:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "Run the tests and show me the resulting context composition.",
      local_images: ["context-reference.png"],
    },
  },
  {
    timestamp: "2026-07-23T16:02:01.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "run-tests",
      arguments: JSON.stringify({ cmd: "npm test" }),
    },
  },
  {
    timestamp: "2026-07-23T16:02:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "run-tests",
      output:
        "Original token count: 260\nPASS tests/session-parser.test.ts\n12 tests passed\n",
    },
  },
  {
    timestamp: "2026-07-23T16:02:03.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message:
        "All parser tests pass. The active request is primarily file context and conversation, with one visual reference.",
    },
  },
  {
    timestamp: "2026-07-23T16:02:04.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 16_000,
        total_token_usage: { input_tokens: 14_100 },
        last_token_usage: {
          input_tokens: 7_200,
          cached_input_tokens: 5_480,
          output_tokens: 310,
          reasoning_output_tokens: 610,
          total_tokens: 8_120,
        },
      },
    },
  },
  {
    timestamp: "2026-07-23T16:03:00.000Z",
    type: "event_msg",
    payload: {
      type: "user_message",
      message: "Open the parser one more time and summarize exactly what is observable.",
    },
  },
  {
    timestamp: "2026-07-23T16:03:01.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: "read-parser-3",
      arguments: JSON.stringify({ cmd: "sed -n '1,220p' src/session-parser.ts" }),
    },
  },
  {
    timestamp: "2026-07-23T16:03:02.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "read-parser-3",
      output:
        "Original token count: 980\nexport function parseSession(lines: string[]) {\n  const requests = collectRequests(lines);\n  const items = lines.map(parseEvent).filter(Boolean);\n  return { requests, items };\n}\n",
    },
  },
  {
    timestamp: "2026-07-23T16:03:03.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message:
        "The rollout exposes official request totals and a rich item ledger. Exact provider serialization remains partially unresolved.",
    },
  },
  {
    timestamp: "2026-07-23T16:03:04.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 16_000,
        total_token_usage: { input_tokens: 22_900 },
        last_token_usage: {
          input_tokens: 8_800,
          cached_input_tokens: 7_120,
          output_tokens: 290,
          reasoning_output_tokens: 760,
          total_tokens: 9_850,
        },
      },
    },
  },
];

export const SAMPLE_SESSION = records.map((record) => JSON.stringify(record)).join("\n");
