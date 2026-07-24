# Context Window Inspector

A local, Codex-only web app for understanding what is inside a model request’s context window.

Start the local app, choose a real Codex session from the dropdown, and inspect:

- official input, cached-input, output, reasoning, and context-capacity counters;
- estimated composition by system instructions, conversation, file contents, searches, commands, code changes, images, and reasoning metadata;
- every locally observable item assigned to the selected request;
- how the context composition changes across turns;
- an optional retention lens for items that may no longer be useful to keep carrying.

The primary purpose is context transparency. The retention lens is supporting information and is off by default.

The main diagram gives every non-zero category its own source and animated packet. All categories
accumulate as patterned layers inside the context window, growing from empty to the selected
request's reported fullness. Packet movement is illustrative; token labels and fill depth come
from the selected Codex request. Pause and replay govern both packet flow and sediment growth.
Motion is removed when the operating system requests reduced motion.

## Run it

No installation or build step is required.

```bash
npm run dev
```

Open [http://localhost:4173](http://localhost:4173). The loopback-only server automatically
discovers recent JSONL rollouts under `~/.codex/sessions`, loads the most recent supported session,
and lists the rest in the **Session** dropdown. A session’s full JSONL is read only when selected.

Use **Open additional rollout files** when a rollout lives outside the normal Codex session folder.
Reloading a rollout with the same Codex session ID updates its existing entry.

Codex rollout files normally live under:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

The server binds only to `127.0.0.1`. JSONL stays on the local machine, is not uploaded, and is not
persisted by the app. The browser performs the context reconstruction after receiving the selected
local file.

To inspect a different session directory:

```bash
CONTEXT_WINDOW_SESSIONS_DIR=/absolute/path/to/sessions npm run dev
```

To use a different port:

```bash
CONTEXT_WINDOW_INSPECTOR_PORT=4180 npm run dev
```

## What the numbers mean

### Official request counters

Codex `token_count` events provide request-level totals:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `model_context_window`

These values are displayed as **Official**.

Repeated snapshots of the same provider request are deduplicated using cumulative input usage when available. The terminal accepted request in each user turn is used for the timeline.

### Reconstructed item composition

Rollout events are converted into a local item ledger:

| Category | Included information |
| --- | --- |
| System & tools | Base instructions, tool definitions, developer messages, and turn configuration |
| Conversation | User messages and assistant responses |
| File contents | Outputs from file-reading commands |
| Search results | Repository search commands and returned matches |
| Command results | Shell commands, tests, Git operations, and tool results |
| Code changes | Patch and edit payloads |
| Images | User references and tool-produced screenshots |
| Reasoning metadata | Provider-reported token segments; reasoning text is not available |
| Context structure | Estimated request framing plus official input tokens that cannot be mapped to a visible rollout item |

The reconstruction uses:

```text
tool-reported Original token count when available
code and tool text ≈ characters / 3.3
plain text ≈ characters / 4
images ≈ 4,000 tokens each
tool output cap = 12,000 tokens
request-structure allowance = 3%
```

Items are fitted newest-first into the official input-token total. Any remaining difference stays visible as **Unresolved structure** instead of being silently guessed.

## Retention lens

The optional lens marks a narrow set of observable situations:

- an older overlapping read when a newer read of the unchanged file is also present;
- transient search or command results carried beyond their source turn;
- older reasoning-token segments;
- an image superseded by a newer image from the same source;
- code-change payloads older than the latest two versions of the same file.

The wording is intentionally conditional: **potentially not useful to keep carrying**. It does not claim that the original work was unnecessary or that the provider definitely retained or ignored a particular item.

## Accuracy boundary

This project reconstructs the context from local Codex rollout events. It does not have access to every exact serialized provider payload, provider-side eviction behavior, or hidden internal representation.

Therefore:

- request-level token counters are authoritative when present;
- item-level token counts are estimates;
- category composition is a deterministic local reconstruction;
- unresolved tokens are reported explicitly;
- the app should not be used as a billing statement.

## Development

```bash
npm test
npm run check
```

The project intentionally has no runtime dependencies:

- `server.mjs` serves the app and exposes a loopback-only, path-validated session API.
- `src/analyzer.js` contains the parser and reconstruction algorithm.
- `src/session-catalog.js` keeps multiple loaded sessions distinct and selectable.
- `src/app.js` renders the browser interface.
- `src/styles.css` contains the responsive design system.
- `tests/analyzer.test.mjs` verifies accounting and retention behavior.

## License

MIT
