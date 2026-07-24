import { createReadStream } from "node:fs";
import { lstat, open, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSIONS_ROOT = join(homedir(), ".codex", "sessions");
const DEFAULT_PORT = 4173;
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 500;
const SESSION_PREFIX_BYTES = 256 * 1024;

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

export function createContextInspectorServer(options = {}) {
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT);
  const sessionsRoot = resolve(options.sessionsRoot || DEFAULT_SESSIONS_ROOT);

  return createServer((request, response) =>
    handleContextInspectorRequest({ projectRoot, sessionsRoot }, request, response),
  );
}

export async function handleContextInspectorRequest(options, request, response) {
  const projectRoot = resolve(options.projectRoot || PROJECT_ROOT);
  const sessionsRoot = resolve(options.sessionsRoot || DEFAULT_SESSIONS_ROOT);

  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (url.pathname === "/api/sessions") {
      const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT),
      );
      const sessions = await listCodexSessions(sessionsRoot, { limit });
      sendJson(response, 200, { sessions, count: sessions.length }, request.method === "HEAD");
      return;
    }

    if (url.pathname.startsWith("/api/sessions/")) {
      const id = url.pathname.slice("/api/sessions/".length);
      const file = await resolveSessionFile(sessionsRoot, id);
      const fileStat = await stat(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": fileStat.size,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(file).pipe(response);
      return;
    }

    await serveStaticFile({ projectRoot, request, response, pathname: url.pathname });
  } catch (error) {
    const status = error?.code === "ENOENT" || error?.code === "ENOTDIR" ? 404 : 500;
    sendJson(response, status, {
      error:
        status === 404
          ? "Session or file not found."
          : "The local server could not complete the request.",
    });
  }
}

export async function listCodexSessions(sessionsRoot, options = {}) {
  const root = resolve(sessionsRoot);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit) || DEFAULT_LIMIT));
  const files = await collectJsonlFiles(root);
  const withStats = await Promise.all(
    files.map(async (file) => ({
      file,
      stats: await stat(file),
    })),
  );

  withStats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  const selected = withStats.slice(0, limit);

  return Promise.all(
    selected.map(async ({ file, stats }) => {
      const metadata = await readSessionMetadata(file);
      const relativePath = relative(root, file);
      const cwd = stringValue(metadata?.payload?.cwd);
      return {
        id: encodeSessionPath(relativePath),
        sessionId: stringValue(metadata?.payload?.id) || null,
        name: basename(file),
        project: cwd ? basename(cwd) : null,
        cwd: cwd || null,
        updatedAt:
          stringValue(metadata?.timestamp) ||
          stats.mtime.toISOString(),
        size: stats.size,
      };
    }),
  );
}

export async function resolveSessionFile(sessionsRoot, id) {
  const root = resolve(sessionsRoot);
  const decoded = decodeSessionPath(id);
  if (!decoded || isAbsolute(decoded) || extname(decoded).toLowerCase() !== ".jsonl") {
    throw invalidSessionPath();
  }

  const file = resolve(root, decoded);
  if (!isWithin(root, file)) throw invalidSessionPath();

  const fileStat = await lstat(file);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw invalidSessionPath();
  return file;
}

export function encodeSessionPath(relativePath) {
  return Buffer.from(String(relativePath), "utf8").toString("base64url");
}

export function decodeSessionPath(id) {
  try {
    return Buffer.from(String(id), "base64url").toString("utf8");
  } catch {
    return "";
  }
}

async function collectJsonlFiles(root) {
  const files = [];
  const queue = [root];

  while (queue.length) {
    const directory = queue.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(path);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        files.push(path);
      }
    }
  }

  return files;
}

async function readSessionMetadata(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(SESSION_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split(/\n/).slice(0, 8)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record?.type === "session_meta" || record?.payload?.type === "session_meta") {
          return record;
        }
      } catch {
        // A very large first record may exceed the metadata read window. Filename metadata remains usable.
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function serveStaticFile({ projectRoot, request, response, pathname }) {
  const allowed =
    pathname === "/" ||
    pathname === "/index.html" ||
    (pathname.startsWith("/src/") && [".js", ".css"].includes(extname(pathname)));
  if (!allowed) {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = resolve(projectRoot, relativePath);
  if (!isWithin(projectRoot, file)) {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const fileStat = await stat(file);
  if (!fileStat.isFile()) {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": fileStat.size,
    "Content-Type": CONTENT_TYPES.get(extname(file)) || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function sendJson(response, status, body, headOnly = false) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(serialized),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(headOnly ? "" : serialized);
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function invalidSessionPath() {
  const error = new Error("Invalid session path.");
  error.code = "ENOENT";
  return error;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.CONTEXT_WINDOW_INSPECTOR_PORT || "", 10) || DEFAULT_PORT;
  const sessionsRoot =
    process.env.CONTEXT_WINDOW_SESSIONS_DIR || DEFAULT_SESSIONS_ROOT;
  const server = createContextInspectorServer({ sessionsRoot });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Context Window Inspector: http://127.0.0.1:${port}`);
    console.log(`Codex sessions: ${sessionsRoot}`);
  });
}
