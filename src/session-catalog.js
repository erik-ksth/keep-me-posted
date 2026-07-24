export function createSessionRecord(session, sourceName) {
  const normalizedSource = String(sourceName || session?.metadata?.sourceName || "Codex rollout");
  const sessionId = String(session?.metadata?.sessionId || "").trim();
  const cwd = String(session?.metadata?.cwd || "").trim();
  const updatedAt = String(session?.metadata?.updatedAt || "").trim();
  const identity = sessionId
    ? `codex:${sessionId}`
    : `file:${normalizedSource}:${cwd}:${updatedAt}`;

  return {
    id: identity,
    sourceName: normalizedSource,
    session,
    selectedRequestId: session?.terminalRequests?.at(-1)?.id || session?.requests?.at(-1)?.id || null,
  };
}

export function createDiscoveredSessionRecord(summary) {
  const sourceName = String(summary?.name || "Codex rollout");
  const sessionId = String(summary?.sessionId || "").trim();
  return {
    id: sessionId ? `codex:${sessionId}` : `local:${String(summary?.id || sourceName)}`,
    sourceName,
    session: null,
    selectedRequestId: null,
    localFileId: String(summary?.id || ""),
    discovered: {
      project: String(summary?.project || ""),
      cwd: String(summary?.cwd || ""),
      updatedAt: String(summary?.updatedAt || ""),
      size: Number(summary?.size) || 0,
    },
  };
}

export function upsertSessionRecord(records, incoming) {
  const index = records.findIndex((record) => record.id === incoming.id);
  if (index < 0) return [...records, incoming];

  const current = records[index];
  const session = incoming.session || current.session;
  const requestedSelection = current.selectedRequestId || incoming.selectedRequestId;
  const next = records.slice();
  next[index] = {
    ...current,
    ...incoming,
    session,
    selectedRequestId:
      session?.requests?.some((request) => request.id === requestedSelection)
        ? requestedSelection
        : incoming.selectedRequestId || current.selectedRequestId || null,
  };
  return next;
}

export function sessionOptionLabel(record) {
  if (record.localFileId && record.discovered) {
    const turns = Number(record.session?.metadata?.turns) || 0;
    const parts = [
      record.discovered.project || trimRolloutName(record.sourceName),
      formatDiscoveryDate(record.discovered.updatedAt),
      record.session
        ? `${turns} turn${turns === 1 ? "" : "s"}`
        : "on this Mac",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  const project = lastPathPart(record.session?.metadata?.cwd);
  const turns = Number(record.session?.metadata?.turns) || 0;
  const parts = [
    record.sourceName,
    project,
    `${turns} turn${turns === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function trimRolloutName(name) {
  return String(name || "")
    .replace(/^rollout-/, "")
    .replace(/\.jsonl$/i, "");
}

function formatDiscoveryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function lastPathPart(path) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "";
}
