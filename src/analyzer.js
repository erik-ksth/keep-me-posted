const R_CODE = 3.3;
const R_TEXT = 4;
const IMAGE_TOKENS = 4_000;
const TOOL_OUTPUT_CAP = 12_000;
const STRUCTURE_FRACTION = 0.03;

export const CATEGORY_META = {
  system: {
    label: "System & tools",
    shortLabel: "System",
    description: "Base instructions, tool definitions, developer instructions, and turn configuration.",
    color: "var(--cat-system)",
  },
  conversation: {
    label: "Conversation",
    shortLabel: "Messages",
    description: "User requests and assistant responses carried forward in the session.",
    color: "var(--cat-conversation)",
  },
  files: {
    label: "File contents",
    shortLabel: "Files",
    description: "Outputs from commands that read source files or documents.",
    color: "var(--cat-files)",
  },
  searches: {
    label: "Search results",
    shortLabel: "Search",
    description: "Repository searches and their returned matches.",
    color: "var(--cat-searches)",
  },
  commands: {
    label: "Command results",
    shortLabel: "Commands",
    description: "Shell commands, tests, Git operations, and other tool results.",
    color: "var(--cat-commands)",
  },
  changes: {
    label: "Code changes",
    shortLabel: "Changes",
    description: "Patch and edit payloads produced during the session.",
    color: "var(--cat-changes)",
  },
  images: {
    label: "Images",
    shortLabel: "Images",
    description: "User references and tool-produced screenshots represented in the context.",
    color: "var(--cat-images)",
  },
  reasoning: {
    label: "Reasoning metadata",
    shortLabel: "Reasoning",
    description: "Provider-reported reasoning-token segments. Their contents are not present in rollout logs.",
    color: "var(--cat-reasoning)",
  },
  structure: {
    label: "Context structure",
    shortLabel: "Structure",
    description: "Estimated request framing plus any official input tokens not resolved to a visible item.",
    color: "var(--cat-structure)",
  },
};

const READ_COMMANDS = new Set(["cat", "head", "tail", "sed", "nl", "less", "more", "bat", "strings", "view"]);
const SEARCH_COMMANDS = new Set(["rg", "grep", "ag", "ack", "find", "fd", "fgrep", "egrep"]);

export function analyzeCodexSession(text, options = {}) {
  const items = [];
  const requests = [];
  const turnContexts = [];
  const editEpoch = new Map();
  const callMeta = new Map();
  const compactionTurns = [];
  const requestTracker = createProviderRequestTracker();

  let currentTurn = 0;
  let itemSequence = 0;
  let baseInstructionItem = null;
  let toolDefinitionItem = null;
  let latestTimestamp = null;
  let sessionId = null;
  let cwd = null;
  let cliVersion = null;
  let model = null;

  const pushItem = (item) => {
    const normalized = {
      id: `item-${++itemSequence}`,
      eventOrder: item.eventOrder,
      turn: item.turn ?? currentTurn,
      category: item.category,
      kind: item.kind,
      tokens: nonNegative(item.tokens),
      title: item.title || "Context item",
      preview: compactPreview(item.preview || ""),
      detail: item.detail || "",
      file: item.file || null,
      fileKey: baseName(item.file),
      range: item.range || null,
      target: item.target || null,
      tool: item.tool || null,
      source: item.source || null,
    };
    items.push(normalized);
    return normalized;
  };

  const lines = String(text || "").split(/\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = isRecord(record?.payload) ? record.payload : {};
    const payloadType = typeof payload.type === "string" ? payload.type : "";
    const eventOrder = lineIndex + 1;
    if (typeof record?.timestamp === "string") latestTimestamp = record.timestamp;

    if (record?.type === "session_meta" || payloadType === "session_meta") {
      sessionId = stringValue(payload.id) || sessionId;
      cwd = stringValue(payload.cwd) || cwd;
      cliVersion = stringValue(payload.cli_version) || cliVersion;
      model = stringValue(payload.model) || model;

      const baseText = isRecord(payload.base_instructions)
        ? stringValue(payload.base_instructions.text)
        : "";
      if (baseText) {
        const candidate = makePersistentItem({
          id: "system-base-instructions",
          eventOrder,
          category: "system",
          kind: "base_instructions",
          tokens: estimateText(baseText),
          title: "Base instructions",
          preview: baseText,
          detail: "Persistent instructions supplied to Codex for the session.",
        });
        if (!baseInstructionItem || candidate.tokens > baseInstructionItem.tokens) {
          baseInstructionItem = candidate;
        }
      }

      const dynamicTools = Array.isArray(payload.dynamic_tools) ? payload.dynamic_tools : [];
      if (dynamicTools.length) {
        const serialized = JSON.stringify(dynamicTools);
        const candidate = makePersistentItem({
          id: "system-tool-definitions",
          eventOrder,
          category: "system",
          kind: "tool_definitions",
          tokens: estimateCode(serialized),
          title: `${dynamicTools.length} tool definition${dynamicTools.length === 1 ? "" : "s"}`,
          preview: dynamicTools.map((entry) => entry?.name).filter(Boolean).join(", "),
          detail: "Tool schemas made available to the model.",
        });
        if (!toolDefinitionItem || candidate.tokens > toolDefinitionItem.tokens) {
          toolDefinitionItem = candidate;
        }
      }
      continue;
    }

    if (record?.type === "turn_context" || payload.collaboration_mode) {
      const serialized = JSON.stringify(payload);
      turnContexts.push(
        makePersistentItem({
          id: `turn-context-${eventOrder}`,
          eventOrder,
          turn: currentTurn,
          category: "system",
          kind: "turn_context",
          tokens: estimateText(serialized),
          title: "Turn configuration",
          preview: describeTurnContext(payload),
          detail: "Dynamic configuration and instructions active for this part of the session.",
        }),
      );
      continue;
    }

    if (payloadType === "user_message") {
      currentTurn += 1;
      const message = messageText(payload.message);
      pushItem({
        eventOrder,
        turn: currentTurn,
        category: "conversation",
        kind: "user_message",
        tokens: estimateText(message),
        title: "User message",
        preview: message,
        detail: "The instruction that opened this turn.",
        source: "user",
      });

      const imageCount =
        arrayLength(payload.images) +
        arrayLength(payload.local_images) +
        countImagesDeep(payload.message);
      for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
        pushItem({
          eventOrder,
          turn: currentTurn,
          category: "images",
          kind: "user_image",
          tokens: IMAGE_TOKENS,
          title: "User reference image",
          preview: "Image attached to the user message",
          detail: "Images are represented with a fixed local estimate because rollout logs do not expose their exact input-token count.",
          target: "user-reference",
          source: "user",
        });
      }
      continue;
    }

    if (payloadType === "token_count") {
      const request = acceptProviderRequest(payload.info, requestTracker);
      if (!request || currentTurn <= 0) continue;
      const requestInTurn = requests.filter((entry) => entry.turn === currentTurn).length + 1;
      requests.push({
        id: `request-${requests.length + 1}`,
        turn: currentTurn,
        requestInTurn,
        eventOrder,
        timestamp: latestTimestamp,
        model: request.model || model,
        inputTokens: request.inputTokens,
        cachedInputTokens: request.cachedInputTokens,
        outputTokens: request.outputTokens,
        reasoningOutputTokens: request.reasoningOutputTokens,
        totalTokens: request.totalTokens,
        modelContextWindow: request.modelContextWindow,
      });
      continue;
    }

    if (currentTurn === 0) continue;

    if (payloadType === "message") {
      const role = stringValue(payload.role);
      const content = contentText(payload.content);
      if (content) {
        pushItem({
          eventOrder,
          category: role === "developer" ? "system" : "conversation",
          kind: `${role || "unknown"}_message`,
          tokens: estimateText(content),
          title: role === "developer" ? "Developer instruction" : "Assistant message",
          preview: content,
          detail:
            role === "developer"
              ? "A developer-level instruction inserted during the session."
              : "A message emitted by the assistant.",
          source: role || "assistant",
        });
      }
      continue;
    }

    if (payloadType === "agent_message") {
      const message = stringValue(payload.message);
      if (message) {
        pushItem({
          eventOrder,
          category: "conversation",
          kind: "assistant_message",
          tokens: estimateText(message),
          title: "Assistant response",
          preview: message,
          detail: "Assistant text carried in the conversation history.",
          source: "assistant",
        });
      }
      continue;
    }

    if (payloadType === "context_compacted") {
      compactionTurns.push(currentTurn);
      continue;
    }

    if (payloadType === "patch_apply_end" && isRecord(payload.changes)) {
      for (const file of Object.keys(payload.changes)) {
        const key = baseName(file);
        if (!key) continue;
        editEpoch.set(key, [...(editEpoch.get(key) || []), currentTurn]);
      }
      continue;
    }

    if (payloadType === "custom_tool_call" && typeof payload.input === "string") {
      const files = patchFiles(payload.input);
      pushItem({
        eventOrder,
        category: "changes",
        kind: "code_change",
        tokens: estimateCode(payload.input),
        title: files.length ? `Changed ${files.join(", ")}` : "Code change",
        preview: payload.input,
        detail: "Patch or edit payload generated by Codex.",
        file: files.length === 1 ? files[0] : null,
        source: stringValue(payload.name) || "apply_patch",
      });
      continue;
    }

    if (payloadType === "function_call") {
      const name = stringValue(payload.name) || "tool";
      const callId = stringValue(payload.call_id);
      let args = payload.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = { value: args };
        }
      }
      const command =
        isRecord(args) && (typeof args.cmd === "string" || typeof args.command === "string")
          ? String(args.cmd || args.command)
          : "";
      const kind = command ? commandKind(command) : "command";
      const file = command ? readFileArgument(command) : null;
      const range = command ? readRange(command) : null;
      const category = categoryForCall(kind, name);
      if (callId) {
        callMeta.set(callId, {
          name,
          command,
          kind,
          category,
          file,
          range,
          target: name,
        });
      }
      const serializedArgs = command || JSON.stringify(args || {});
      if (serializedArgs && serializedArgs !== "{}") {
        pushItem({
          eventOrder,
          category,
          kind: "tool_call",
          tokens: estimateCode(serializedArgs),
          title: toolCallTitle(kind, name, command),
          preview: serializedArgs,
          detail: "The tool invocation and arguments produced by the assistant.",
          file,
          range,
          tool: name,
          source: "assistant",
        });
      }
      continue;
    }

    if (payloadType === "function_call_output") {
      const callId = stringValue(payload.call_id);
      const meta = callMeta.get(callId) || {
        name: "tool",
        kind: "command",
        category: "commands",
        file: null,
        range: null,
        target: "tool",
      };
      const imageCount = countImagesDeep(payload.output);
      if (imageCount > 0 || outputContainsImage(payload.output)) {
        const count = Math.max(1, imageCount);
        for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
          pushItem({
            eventOrder,
            category: "images",
            kind: "tool_image",
            tokens: IMAGE_TOKENS,
            title: `${meta.name} image output`,
            preview: "Image returned by a tool",
            detail: "Tool-produced visual context represented with a fixed local estimate.",
            target: meta.target,
            tool: meta.name,
            source: "tool",
          });
        }
      } else {
        const output = outputText(payload.output);
        const originalCount = originalTokenCount(output);
        const tokens = Math.min(
          originalCount ?? estimateCode(output),
          TOOL_OUTPUT_CAP,
        );
        pushItem({
          eventOrder,
          category: meta.category,
          kind: `${meta.kind}_output`,
          tokens,
          title: toolOutputTitle(meta),
          preview: removeTokenEnvelope(output),
          detail: originalCount
            ? "Token estimate reported by the tool output envelope."
            : "Locally estimated from the serialized tool output.",
          file: meta.file,
          range: meta.range,
          tool: meta.name,
          source: "tool",
        });
      }
    }
  }

  const terminalRequests = terminalRequestByTurn(requests);
  return {
    metadata: {
      sourceName: options.sourceName || "Codex rollout",
      sessionId,
      cwd,
      cliVersion,
      model,
      updatedAt: latestTimestamp,
      parsedLines: lines.length,
      turns: currentTurn,
      requestCount: requests.length,
    },
    items,
    requests,
    terminalRequests,
    persistent: {
      baseInstructionItem,
      toolDefinitionItem,
      turnContexts,
    },
    editEpoch,
    compactionTurns,
  };
}

export function buildContextView(session, requestOrId) {
  const request =
    typeof requestOrId === "string"
      ? session.requests.find((entry) => entry.id === requestOrId)
      : requestOrId;
  if (!request) return null;

  const inputTokens = nonNegative(request.inputTokens);
  let remaining = inputTokens;
  const allocated = [];

  const allocate = (item, requestedTokens = item.tokens) => {
    if (remaining <= 0 || requestedTokens <= 0) return 0;
    const tokens = Math.min(nonNegative(requestedTokens), remaining);
    allocated.push({
      ...item,
      tokens,
      originalEstimatedTokens: nonNegative(requestedTokens),
      partial: tokens < nonNegative(requestedTokens),
      official: false,
      potentiallyNotUseful: false,
      retentionReason: "",
    });
    remaining -= tokens;
    return tokens;
  };

  const base = session.persistent.baseInstructionItem;
  const tools = session.persistent.toolDefinitionItem;
  const turnContext = [...session.persistent.turnContexts]
    .filter((entry) => entry.eventOrder <= request.eventOrder)
    .sort((a, b) => b.eventOrder - a.eventOrder)[0];
  for (const item of [base, tools, turnContext]) {
    if (item) allocate(item);
  }

  const structureFloor = Math.round(inputTokens * STRUCTURE_FRACTION);
  if (structureFloor > 0) {
    allocate({
      id: `structure-floor-${request.id}`,
      eventOrder: request.eventOrder,
      turn: request.turn,
      category: "structure",
      kind: "serialization",
      tokens: structureFloor,
      title: "Request serialization",
      preview: "Estimated message framing and serialization",
      detail: "A 3% structural allowance used by the reconstruction model.",
      file: null,
      fileKey: null,
      range: null,
      target: null,
      tool: null,
      source: "estimate",
    });
  }

  for (const item of reasoningItems(session, request)) {
    allocate(item);
  }

  const visibleItems = session.items
    .filter((item) => item.eventOrder <= request.eventOrder && item.turn <= request.turn)
    .slice()
    .reverse();
  for (const item of visibleItems) {
    if (remaining <= 0) break;
    allocate(item);
  }

  if (remaining > 0) {
    allocate({
      id: `unresolved-${request.id}`,
      eventOrder: request.eventOrder,
      turn: request.turn,
      category: "structure",
      kind: "unresolved",
      tokens: remaining,
      title: "Not resolved from rollout events",
      preview: "Official input tokens without a matching visible item",
      detail:
        "Rollout logs expose official request totals but not always the exact serialized input payload. This remainder preserves that difference instead of guessing.",
      file: null,
      fileKey: null,
      range: null,
      target: null,
      tool: null,
      source: "reconciliation",
    });
  }

  const withRetention = applyRetentionLens(allocated, session, request.turn);
  const composition = Object.fromEntries(Object.keys(CATEGORY_META).map((key) => [key, 0]));
  for (const item of withRetention) composition[item.category] += item.tokens;

  const compositionRows = Object.entries(composition)
    .map(([category, tokens]) => ({
      category,
      tokens,
      percent: inputTokens > 0 ? (tokens / inputTokens) * 100 : 0,
    }))
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  const potentiallyNotUsefulTokens = withRetention.reduce(
    (sum, item) => sum + (item.potentiallyNotUseful ? item.tokens : 0),
    0,
  );
  const unresolvedTokens = withRetention.reduce(
    (sum, item) => sum + (item.kind === "unresolved" ? item.tokens : 0),
    0,
  );

  return {
    request,
    inputTokens,
    composition,
    compositionRows,
    items: withRetention,
    observableEstimatedTokens: Math.max(0, inputTokens - unresolvedTokens),
    unresolvedTokens,
    potentiallyNotUsefulTokens,
    potentiallyNotUsefulPercent:
      inputTokens > 0 ? (potentiallyNotUsefulTokens / inputTokens) * 100 : 0,
    fullnessPercent:
      request.modelContextWindow > 0
        ? (inputTokens / request.modelContextWindow) * 100
        : null,
  };
}

export function buildTimeline(session) {
  return session.terminalRequests
    .map((request) => buildContextView(session, request))
    .filter(Boolean);
}

function applyRetentionLens(items, session, selectedTurn) {
  const copies = items.map((item) => ({ ...item }));
  const edits = session.editEpoch;

  for (const item of copies) {
    if (item.kind === "reasoning_segment" && item.turn < selectedTurn) {
      markPotential(item, "Reasoning metadata carried from an earlier turn.");
      continue;
    }

    if (
      (item.category === "searches" || item.category === "commands") &&
      item.turn < selectedTurn
    ) {
      markPotential(item, "A transient tool result carried beyond the turn that produced it.");
      continue;
    }

    if (item.category === "files" && item.fileKey) {
      const newerRead = copies.find(
        (candidate) =>
          candidate.category === "files" &&
          candidate.fileKey === item.fileKey &&
          candidate.eventOrder > item.eventOrder &&
          rangesOverlap(candidate.range, item.range) &&
          !editBetween(edits.get(item.fileKey) || [], item.turn, candidate.turn),
      );
      if (newerRead) {
        markPotential(item, "A newer overlapping read of the unchanged file is also present.");
      }
    }

    if (item.category === "images") {
      const newerImage = copies.find(
        (candidate) =>
          candidate.category === "images" &&
          candidate.target === item.target &&
          candidate.eventOrder > item.eventOrder,
      );
      if (newerImage) {
        markPotential(item, "A newer image from the same source is also present.");
      }
    }
  }

  const changesByFile = new Map();
  for (const item of copies.filter((entry) => entry.category === "changes" && entry.fileKey)) {
    const list = changesByFile.get(item.fileKey) || [];
    list.push(item);
    changesByFile.set(item.fileKey, list);
  }
  for (const list of changesByFile.values()) {
    list.sort((a, b) => b.eventOrder - a.eventOrder);
    for (const item of list.slice(2)) {
      markPotential(item, "Two newer versions of this file change are also present.");
    }
  }

  return copies;
}

function reasoningItems(session, request) {
  const lastCompaction = session.compactionTurns
    .filter((turn) => turn < request.turn)
    .sort((a, b) => b - a)[0] || 0;
  const maxByTurn = new Map();
  for (const entry of session.requests) {
    if (entry.eventOrder > request.eventOrder) break;
    if (entry.turn <= lastCompaction || entry.turn > request.turn) continue;
    maxByTurn.set(
      entry.turn,
      Math.max(maxByTurn.get(entry.turn) || 0, nonNegative(entry.reasoningOutputTokens)),
    );
  }

  const output = [];
  let previousCumulative = 0;
  for (let turn = lastCompaction + 1; turn <= request.turn; turn += 1) {
    const cumulative = Math.max(previousCumulative, maxByTurn.get(turn) || previousCumulative);
    const tokens = cumulative - previousCumulative;
    if (tokens > 0) {
      output.push({
        id: `reasoning-${request.id}-${turn}`,
        eventOrder: request.eventOrder,
        turn,
        category: "reasoning",
        kind: "reasoning_segment",
        tokens,
        title: turn === request.turn ? "Current reasoning tokens" : `Reasoning from turn ${turn}`,
        preview: `${formatInteger(tokens)} provider-reported reasoning tokens`,
        detail: "Only the token count is observable; rollout logs do not contain the reasoning text.",
        file: null,
        fileKey: null,
        range: null,
        target: null,
        tool: null,
        source: "provider counter",
      });
    }
    previousCumulative = cumulative;
  }
  return output;
}

function createProviderRequestTracker() {
  return {
    cumulativeInputTokens: 0,
    sawCumulativeInput: false,
    legacyFingerprint: null,
  };
}

function acceptProviderRequest(rawInfo, tracker) {
  if (!isRecord(rawInfo)) return null;
  const latest = isRecord(rawInfo.last_token_usage) ? rawInfo.last_token_usage : null;
  const cumulativeInput = isRecord(rawInfo.total_token_usage)
    ? positiveNumber(rawInfo.total_token_usage.input_tokens)
    : null;

  if (cumulativeInput !== null) {
    tracker.sawCumulativeInput = true;
    if (cumulativeInput <= tracker.cumulativeInputTokens) return null;
    tracker.cumulativeInputTokens = cumulativeInput;
    if (!latest) return null;
    const request = normalizeProviderUsage(latest, rawInfo);
    tracker.legacyFingerprint = requestFingerprint(request);
    return request.inputTokens > 0 ? request : null;
  }

  if (tracker.sawCumulativeInput || !latest) return null;
  const request = normalizeProviderUsage(latest, rawInfo);
  const fingerprint = requestFingerprint(request);
  if (fingerprint === tracker.legacyFingerprint) return null;
  tracker.legacyFingerprint = fingerprint;
  return request.inputTokens > 0 ? request : null;
}

function normalizeProviderUsage(usage, info) {
  return {
    inputTokens: numberValue(usage.input_tokens),
    cachedInputTokens: numberValue(usage.cached_input_tokens),
    outputTokens: numberValue(usage.output_tokens),
    reasoningOutputTokens: numberValue(usage.reasoning_output_tokens),
    totalTokens: numberValue(usage.total_tokens),
    modelContextWindow: numberValue(info.model_context_window),
    model: stringValue(info.model),
  };
}

function terminalRequestByTurn(requests) {
  const byTurn = new Map();
  for (const request of requests) byTurn.set(request.turn, request);
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn);
}

function makePersistentItem(item) {
  return {
    ...item,
    turn: item.turn || 0,
    file: null,
    fileKey: null,
    range: null,
    target: null,
    tool: null,
    source: "system",
  };
}

function commandKind(command) {
  const executable =
    command.split("|")[0].split(">")[0].trim().split(/\s+/)[0]?.split("/").pop() || "";
  if (READ_COMMANDS.has(executable)) return "read";
  if (SEARCH_COMMANDS.has(executable)) return "search";
  return "command";
}

function categoryForCall(kind, toolName) {
  if (toolName === "view_image" || toolName === "image") return "images";
  if (kind === "read") return "files";
  if (kind === "search") return "searches";
  return "commands";
}

function readFileArgument(command) {
  const segment = command.split("|")[0].split(">")[0].trim();
  const tokens = segment.split(/\s+/);
  const executable = tokens[0]?.split("/").pop() || "";
  if (!READ_COMMANDS.has(executable)) return null;
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const value = tokens[index].replace(/^['"]|['"]$/g, "");
    if (value && !value.startsWith("-") && (value.includes("/") || value.includes("."))) {
      return value;
    }
  }
  return null;
}

function readRange(command) {
  const matches = [...command.matchAll(/(\d+),(\d+)\s*p/g)];
  if (!matches.length) return null;
  return [
    Math.min(...matches.map((match) => Number(match[1]))),
    Math.max(...matches.map((match) => Number(match[2]))),
  ];
}

function patchFiles(input) {
  const files = new Set();
  for (const line of String(input || "").split(/\n/)) {
    const match =
      line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ||
      line.match(/^\*\*\* Move to: (.+)$/);
    if (match?.[1]) files.add(match[1].trim());
  }
  return [...files];
}

function toolCallTitle(kind, name, command) {
  if (kind === "read") return `Read ${readFileArgument(command) || "file"}`;
  if (kind === "search") return `Search with ${commandVerb(command) || name}`;
  return `Run ${commandVerb(command) || name}`;
}

function toolOutputTitle(meta) {
  if (meta.kind === "read") return `Contents of ${meta.file || "file"}`;
  if (meta.kind === "search") return "Search results";
  return `${meta.name || "Tool"} result`;
}

function commandVerb(command) {
  return command.trim().split(/\s+/)[0]?.split("/").pop() || "";
}

function describeTurnContext(payload) {
  const parts = [];
  if (payload.collaboration_mode) parts.push(`mode: ${payload.collaboration_mode}`);
  if (payload.cwd) parts.push(`cwd: ${payload.cwd}`);
  return parts.join(" · ") || "Dynamic turn configuration";
}

function markPotential(item, reason) {
  item.potentiallyNotUseful = true;
  item.retentionReason = reason;
}

function rangesOverlap(a, b) {
  return !a || !b || (a[0] <= b[1] && b[0] <= a[1]);
}

function editBetween(turns, afterTurn, throughTurn) {
  return turns.some((turn) => turn > afterTurn && turn <= throughTurn);
}

function originalTokenCount(output) {
  const match = String(output || "").match(/Original token count:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function removeTokenEnvelope(output) {
  return String(output || "")
    .replace(/^.*?Original token count:\s*\d+\s*/s, "")
    .trim();
}

function outputText(output) {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output || "");
  } catch {
    return String(output || "");
  }
}

function outputContainsImage(output) {
  return (
    Array.isArray(output) &&
    output.some(
      (entry) =>
        isRecord(entry) &&
        (entry.type === "input_image" || Object.hasOwn(entry, "image_url")),
    )
  );
}

function countImagesDeep(value) {
  if (!value) return 0;
  if (typeof value === "string") {
    return (
      (value.match(/"type"\s*:\s*"input_image"/g) || []).length +
      (value.match(/data:image\//g) || []).length
    );
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, entry) => sum + countImagesDeep(entry), 0);
  }
  if (isRecord(value)) {
    const own = value.type === "input_image" ? 1 : 0;
    return own + Object.values(value).reduce((sum, entry) => sum + countImagesDeep(entry), 0);
  }
  return 0;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => (isRecord(entry) ? stringValue(entry.text) : ""))
    .filter(Boolean)
    .join("\n");
}

function messageText(message) {
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(message || "");
  } catch {
    return String(message || "");
  }
}

function compactPreview(value, max = 520) {
  const flat = String(value || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trim()}…`;
}

function estimateCode(value) {
  return Math.round(String(value || "").length / R_CODE);
}

function estimateText(value) {
  return Math.round(String(value || "").length / R_TEXT);
}

function requestFingerprint(request) {
  return [
    request.inputTokens,
    request.cachedInputTokens,
    request.outputTokens,
    request.reasoningOutputTokens,
    request.totalTokens,
  ].join(":");
}

function baseName(value) {
  if (!value) return null;
  return String(value).split("/").pop()?.toLowerCase() || null;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonNegative(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(nonNegative(value));
}
