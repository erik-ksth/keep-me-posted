import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  decodeSessionPath,
  encodeSessionPath,
  handleContextInspectorRequest,
  listCodexSessions,
  resolveSessionFile,
} from "../server.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sessionsRoot = resolve(projectRoot, "tests/fixtures");

test("discovers JSONL sessions with lightweight metadata", async () => {
  const sessions = await listCodexSessions(sessionsRoot, { limit: 10 });

  assert.equal(sessions.length, 2);
  assert.deepEqual(
    new Set(sessions.map((session) => session.project)),
    new Set(["alpha", "beta"]),
  );
  assert.equal(sessions.every((session) => session.id && session.name.endsWith(".jsonl")), true);
});

test("encodes session paths and rejects traversal outside the session root", async () => {
  const encoded = encodeSessionPath("session-alpha.jsonl");
  assert.equal(decodeSessionPath(encoded), "session-alpha.jsonl");
  assert.match(await resolveSessionFile(sessionsRoot, encoded), /session-alpha\.jsonl$/);

  const traversal = encodeSessionPath("../package.json");
  await assert.rejects(resolveSessionFile(sessionsRoot, traversal), /Invalid session path/);
});

test("serves the session catalog and selected JSONL through the request handler", async () => {
  const catalogResponse = new CaptureResponse();
  await handleContextInspectorRequest(
    { projectRoot, sessionsRoot },
    { method: "GET", url: "/api/sessions" },
    catalogResponse,
  );
  const catalog = JSON.parse(catalogResponse.body);

  assert.equal(catalogResponse.status, 200);
  assert.equal(catalog.sessions.length, 2);

  const sessionResponse = new CaptureResponse();
  const finished = once(sessionResponse, "finish");
  await handleContextInspectorRequest(
    { projectRoot, sessionsRoot },
    { method: "GET", url: `/api/sessions/${catalog.sessions[0].id}` },
    sessionResponse,
  );
  await finished;

  assert.equal(sessionResponse.status, 200);
  assert.match(sessionResponse.headers["Content-Type"], /application\/x-ndjson/);
  const jsonl = sessionResponse.body;
  assert.match(jsonl, /"type":"session_meta"/);
});

class CaptureResponse extends Writable {
  chunks = [];
  headers = {};
  status = 0;

  get body() {
    return Buffer.concat(this.chunks).toString("utf8");
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    callback();
  }
}
