import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiscoveredSessionRecord,
  createSessionRecord,
  sessionOptionLabel,
  upsertSessionRecord,
} from "../src/session-catalog.js";

test("creates a stable catalog identity from the Codex session id", () => {
  const record = createSessionRecord(sessionFixture(), "rollout-alpha.jsonl");

  assert.equal(record.id, "codex:session-alpha");
  assert.equal(record.selectedRequestId, "request-2");
  assert.equal(
    sessionOptionLabel(record),
    "rollout-alpha.jsonl · atlas · 2 turns",
  );
});

test("creates an unloaded record for a discovered local session", () => {
  const record = createDiscoveredSessionRecord({
    id: "opaque-file-id",
    sessionId: "session-local",
    name: "rollout-local.jsonl",
    project: "context-window-inspector",
    cwd: "/projects/context-window-inspector",
    updatedAt: "2026-07-23T19:30:00.000Z",
    size: 42_000,
  });

  assert.equal(record.id, "codex:session-local");
  assert.equal(record.localFileId, "opaque-file-id");
  assert.equal(record.session, null);
  assert.match(sessionOptionLabel(record), /context-window-inspector/);
  assert.match(sessionOptionLabel(record), /on this Mac/);
});

test("adds different sessions and replaces a reloaded session", () => {
  const first = createSessionRecord(sessionFixture(), "rollout-alpha.jsonl");
  const second = createSessionRecord(
    sessionFixture({ sessionId: "session-beta", cwd: "/projects/beta" }),
    "rollout-beta.jsonl",
  );

  let catalog = upsertSessionRecord([], first);
  catalog = upsertSessionRecord(catalog, second);
  assert.equal(catalog.length, 2);

  first.selectedRequestId = "request-1";
  const refreshed = createSessionRecord(
    sessionFixture({ requests: [{ id: "request-1" }, { id: "request-2" }, { id: "request-3" }] }),
    "rollout-alpha-updated.jsonl",
  );
  catalog = upsertSessionRecord(catalog, refreshed);

  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].sourceName, "rollout-alpha-updated.jsonl");
  assert.equal(catalog[0].selectedRequestId, "request-1");
});

test("hydrates a discovered record without losing its local file identity", () => {
  const discovered = createDiscoveredSessionRecord({
    id: "opaque-file-id",
    sessionId: "session-alpha",
    name: "rollout-alpha.jsonl",
    project: "alpha",
    updatedAt: "2026-07-23T19:30:00.000Z",
  });
  const loaded = createSessionRecord(sessionFixture(), "rollout-alpha.jsonl");

  let catalog = upsertSessionRecord([], discovered);
  catalog = upsertSessionRecord(catalog, loaded);

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].localFileId, "opaque-file-id");
  assert.equal(catalog[0].session.metadata.sessionId, "session-alpha");
  assert.match(sessionOptionLabel(catalog[0]), /^alpha · .+ · 2 turns$/);
});

function sessionFixture(overrides = {}) {
  const requests = overrides.requests || [{ id: "request-1" }, { id: "request-2" }];
  return {
    metadata: {
      sessionId: overrides.sessionId || "session-alpha",
      cwd: overrides.cwd || "/Users/example/projects/atlas",
      updatedAt: "2026-07-23T16:00:00.000Z",
      turns: 2,
    },
    requests,
    terminalRequests: requests,
  };
}
