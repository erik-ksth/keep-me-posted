import {
  analyzeCodexSession,
  buildContextView,
  buildTimeline,
  CATEGORY_META,
} from "./analyzer.js";
import {
  createDiscoveredSessionRecord,
  createSessionRecord,
  sessionOptionLabel,
  upsertSessionRecord,
} from "./session-catalog.js";
import { SAMPLE_SESSION } from "./sample.js";

const elements = {
  fileInput: document.querySelector("#file-input"),
  fileDrop: document.querySelector("#file-drop"),
  loadStatus: document.querySelector("#load-status"),
  workspace: document.querySelector("#workspace"),
  sessionBar: document.querySelector("#session-bar"),
  requestFacts: document.querySelector("#request-facts"),
  compositionVisual: document.querySelector("#composition-visual"),
  compositionBreakdown: document.querySelector("#composition-breakdown"),
  methodologyButton: document.querySelector("#methodology-button"),
  methodology: document.querySelector("#methodology"),
  turnSelector: document.querySelector("#turn-selector"),
  timeline: document.querySelector("#timeline"),
  contentsSummary: document.querySelector("#contents-summary"),
  categoryFilters: document.querySelector("#category-filters"),
  retentionToggle: document.querySelector("#retention-toggle"),
  itemSearch: document.querySelector("#item-search"),
  itemCount: document.querySelector("#item-count"),
  contextItems: document.querySelector("#context-items"),
};

const state = {
  sessions: [],
  activeSessionId: null,
  session: null,
  timeline: [],
  view: null,
  category: "all",
  query: "",
  retentionLens: false,
};

elements.fileInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (files.length) await readFiles(files);
  event.target.value = "";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileDrop.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.fileDrop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.fileDrop.classList.remove("is-dragging");
  });
}

elements.fileDrop.addEventListener("drop", async (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) await readFiles(files);
});

elements.retentionToggle.addEventListener("change", () => {
  state.retentionLens = elements.retentionToggle.checked;
  renderContents();
});

elements.itemSearch.addEventListener("input", () => {
  state.query = elements.itemSearch.value.trim().toLowerCase();
  renderContents();
});

elements.methodologyButton.addEventListener("click", () => {
  const expanded = elements.methodologyButton.getAttribute("aria-expanded") === "true";
  elements.methodologyButton.setAttribute("aria-expanded", String(!expanded));
  elements.methodology.hidden = expanded;
});

async function readFiles(files) {
  const loaded = [];
  const skipped = [];

  for (const file of files) {
    try {
      const text = await file.text();
      const record = parseSessionRecord(text, file.name);
      state.sessions = upsertSessionRecord(state.sessions, record);
      loaded.push(record);
    } catch (error) {
      skipped.push({
        name: file.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (loaded.length) {
    await activateSession(loaded[0].id, { announce: false });
    showLoadStatus(
      `${loaded.length} session${loaded.length === 1 ? "" : "s"} loaded. Choose a session below.${
        skipped.length ? ` ${skipped.length} file${skipped.length === 1 ? "" : "s"} skipped.` : ""
      }`,
      skipped.length > 0,
    );
    return;
  }

  const detail = skipped.map((item) => `${item.name}: ${item.reason}`).join(" ");
  showLoadStatus(detail || "No Codex rollout files were selected.", true);
}

function parseSessionRecord(text, sourceName) {
  const session = analyzeCodexSession(text, { sourceName });
  if (!session.requests.length) {
    throw new Error("No Codex token_count requests were found.");
  }
  return createSessionRecord(session, sourceName);
}

async function discoverLocalSessions() {
  try {
    const response = await fetch("/api/sessions", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Session discovery returned ${response.status}.`);

    const payload = await response.json();
    const discovered = Array.isArray(payload.sessions)
      ? payload.sessions.map(createDiscoveredSessionRecord)
      : [];

    for (const record of discovered) {
      state.sessions = upsertSessionRecord(state.sessions, record);
    }
    renderSessionBar();

    if (!discovered.length) {
      showLoadStatus("No local Codex sessions were found. You can still open JSONL files manually.");
      return;
    }

    const opened = await activateSession(discovered[0].id, { announce: false });
    showLoadStatus(
      opened
        ? `${discovered.length} recent local Codex session${
            discovered.length === 1 ? "" : "s"
          } found. Showing the most recent.`
        : `${discovered.length} recent local Codex session${
            discovered.length === 1 ? "" : "s"
          } found. Choose one from the Session dropdown.`,
      !opened,
    );
  } catch {
    showLoadStatus(
      "Automatic session discovery is unavailable. Open rollout JSONL files manually.",
      true,
    );
  }
}

async function activateSession(sessionId, options = {}) {
  let record = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!record) return;

  if (!record.session && record.localFileId) {
    setSessionLoading(true);
    showLoadStatus(`Loading ${sessionOptionLabel(record)}…`);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(record.localFileId)}`, {
        cache: "no-store",
        headers: { Accept: "application/x-ndjson, text/plain" },
      });
      if (!response.ok) throw new Error(`Session loading returned ${response.status}.`);
      const text = await response.text();
      const loaded = parseSessionRecord(text, record.sourceName);
      loaded.id = record.id;
      loaded.localFileId = record.localFileId;
      loaded.discovered = record.discovered;
      state.sessions = upsertSessionRecord(state.sessions, loaded);
      record = state.sessions.find((candidate) => candidate.id === sessionId);
    } catch (error) {
      showLoadStatus(
        `Could not load this Codex session: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true,
      );
      setSessionLoading(false);
      renderSessionBar();
      return false;
    }
  }

  if (!record?.session) return false;
  state.activeSessionId = record.id;
  state.session = record.session;
  state.timeline = buildTimeline(record.session);
  state.view =
    buildContextView(record.session, record.selectedRequestId) ||
    state.timeline[state.timeline.length - 1];
  state.category = "all";
  state.query = "";
  elements.itemSearch.value = "";
  elements.retentionToggle.checked = false;
  state.retentionLens = false;
  elements.workspace.hidden = false;
  render();
  setSessionLoading(false);
  if (options.announce !== false && record.localFileId) {
    showLoadStatus(`Loaded ${sessionOptionLabel(record)}.`);
  }
  return true;
}

function render() {
  if (!state.session || !state.view) return;
  renderSessionBar();
  renderRequestFacts();
  renderMethodology();
  renderComposition();
  renderTimeline();
  renderContents();
}

function renderSessionBar() {
  const { metadata, requests } = state.session;
  const selected = state.view.request;
  const activeRecord = state.sessions.find((record) => record.id === state.activeSessionId);
  const localRecords = state.sessions.filter((record) => record.localFileId);
  const openedRecords = state.sessions.filter((record) => !record.localFileId);
  const renderOptions = (records) =>
    records
      .map(
        (record) =>
          `<option value="${escapeHtml(record.id)}" ${
            record.id === state.activeSessionId ? "selected" : ""
          }>${escapeHtml(sessionOptionLabel(record))}</option>`,
      )
      .join("");
  const sessionOptions = `
    ${
      localRecords.length
        ? `<optgroup label="Codex sessions on this Mac">${renderOptions(localRecords)}</optgroup>`
        : ""
    }
    ${
      openedRecords.length
        ? `<optgroup label="Example and opened files">${renderOptions(openedRecords)}</optgroup>`
        : ""
    }
  `;
  const requestOptions = requests
    .map(
      (request) =>
        `<option value="${escapeHtml(request.id)}" ${
          request.id === selected.id ? "selected" : ""
        }>Turn ${request.turn} · request ${request.requestInTurn} · ${formatTokens(
          request.inputTokens,
        )}</option>`,
    )
    .join("");
  const location = metadata.cwd ? abbreviatePath(metadata.cwd) : "Working directory unavailable";

  elements.sessionBar.innerHTML = `
    <div class="session-identity">
      <span class="session-file">${
        localRecords.length
          ? `${localRecords.length} recent local session${
              localRecords.length === 1 ? "" : "s"
            }`
          : `${openedRecords.length} loaded session${openedRecords.length === 1 ? "" : "s"}`
      }</span>
      <span class="session-path" title="${escapeHtml(metadata.cwd || "")}">${escapeHtml(location)}</span>
    </div>
    <div class="session-selectors">
      <label class="session-select">
        <span>Session</span>
        <select id="session-select" aria-label="Choose Codex session">${sessionOptions}</select>
      </label>
      <label class="request-select">
        <span>Model request</span>
        <select id="request-select">${requestOptions}</select>
      </label>
    </div>
  `;

  elements.sessionBar.querySelector("#session-select").addEventListener("change", async (event) => {
    await activateSession(event.target.value);
  });

  elements.sessionBar.querySelector("#request-select").addEventListener("change", (event) => {
    const next = buildContextView(state.session, event.target.value);
    if (!next) return;
    if (activeRecord) activeRecord.selectedRequestId = next.request.id;
    state.view = next;
    render();
  });
}

function renderRequestFacts() {
  const { request, inputTokens, fullnessPercent } = state.view;
  const facts = [
    {
      label: "Input context",
      value: formatInteger(inputTokens),
      suffix: "tokens",
      note: "Official",
    },
    {
      label: "Context capacity",
      value: request.modelContextWindow ? formatInteger(request.modelContextWindow) : "—",
      suffix: request.modelContextWindow ? "tokens" : "",
      note: fullnessPercent === null ? "Not reported" : `${formatPercent(fullnessPercent)} filled`,
    },
    {
      label: "Cached input",
      value: formatInteger(request.cachedInputTokens),
      suffix: "tokens",
      note: "Official",
    },
    {
      label: "Output",
      value: formatInteger(request.outputTokens),
      suffix: "tokens",
      note: "Official",
    },
    {
      label: "Reasoning counter",
      value: formatInteger(request.reasoningOutputTokens),
      suffix: "tokens",
      note: "Official",
    },
    {
      label: "Reconstructed coverage",
      value: formatInteger(state.view.observableEstimatedTokens),
      suffix: "tokens",
      note: "Reconstructed",
    },
  ];

  elements.requestFacts.innerHTML = facts
    .map(
      (fact) => `
        <div class="request-fact">
          <span>${escapeHtml(fact.label)}</span>
          <strong>${escapeHtml(fact.value)} <small>${escapeHtml(fact.suffix)}</small></strong>
          <em>${escapeHtml(fact.note)}</em>
        </div>
      `,
    )
    .join("");
}

function renderMethodology() {
  const unresolved = state.view.unresolvedTokens;
  elements.methodology.innerHTML = `
    <div>
      <h3>What is exact</h3>
      <p>
        Request input, cached input, output, reasoning counters, and model capacity come from
        Codex <code>token_count</code> events. These are shown as official values.
      </p>
    </div>
    <div>
      <h3>What is reconstructed</h3>
      <p>
        Rollout messages and tool events are converted into item estimates, ordered newest-first,
        and fitted into the official ${formatInteger(state.view.inputTokens)}-token request.
      </p>
    </div>
    <div>
      <h3>What remains unresolved</h3>
      <p>
        ${formatInteger(unresolved)} tokens cannot be mapped to a visible rollout item. They remain
        explicit because the exact serialized provider payload is not always present locally.
      </p>
    </div>
  `;
}

function renderComposition() {
  const { compositionRows, inputTokens, unresolvedTokens, fullnessPercent, request } = state.view;
  const capacity = request.modelContextWindow || inputTokens;
  const fillPercent = Math.max(0, Math.min(100, fullnessPercent ?? 100));
  const compactAtPercent = 80;
  const compactions = state.session.compactionTurns.filter((turn) => turn <= request.turn).length;
  const sourceEntries = buildFlowSources(compositionRows);
  const circleBottom = 558;
  const sedimentHeight = (416 * fillPercent) / 100;
  const packetSeconds = 0.72;
  const layerGrowSeconds = 0.48;
  const sequenceGapSeconds = 0.1;
  const sequenceStepSeconds = packetSeconds + layerGrowSeconds + sequenceGapSeconds;
  const sequenceDuration = Math.max(0.01, compositionRows.length * sequenceStepSeconds);
  let sedimentY = circleBottom;
  let layerRevealDefinitions = "";
  const sedimentLayers = compositionRows
    .map((row, index) => {
      const meta = CATEGORY_META[row.category];
      const height = inputTokens > 0 ? (sedimentHeight * row.tokens) / inputTokens : 0;
      const finalHeight = Math.max(0.75, height);
      sedimentY -= height;
      const layerBegin = index * sequenceStepSeconds + packetSeconds;
      const layerStartY = sedimentY + finalHeight;
      layerRevealDefinitions += `
        <clipPath id="sediment-layer-reveal-${index}">
          <rect x="390" y="${layerStartY.toFixed(2)}" width="420" height="0">
            <animate
              attributeName="y"
              from="${layerStartY.toFixed(2)}"
              to="${sedimentY.toFixed(2)}"
              begin="${layerBegin.toFixed(2)}s"
              dur="${layerGrowSeconds}s"
              fill="freeze"
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.22 1 0.36 1"
            />
            <animate
              attributeName="height"
              from="0"
              to="${finalHeight.toFixed(2)}"
              begin="${layerBegin.toFixed(2)}s"
              dur="${layerGrowSeconds}s"
              fill="freeze"
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.22 1 0.36 1"
            />
          </rect>
        </clipPath>
      `;
      return `
        <g
          class="sediment-layer"
          style="--sediment-color:${meta.color}"
          clip-path="url(#sediment-layer-reveal-${index})"
        >
          <title>${escapeHtml(CATEGORY_META[row.category].label)}: ${formatTokens(row.tokens)}</title>
          <rect
            class="sediment-color"
            x="390"
            y="${sedimentY.toFixed(2)}"
            width="420"
            height="${finalHeight.toFixed(2)}"
          />
          <rect
            class="sediment-pattern"
            x="390"
            y="${sedimentY.toFixed(2)}"
            width="420"
            height="${finalHeight.toFixed(2)}"
            fill="url(#sediment-${index % 9})"
          />
        </g>
      `;
    })
    .join("");
  const sourceMarkup = sourceEntries
    .map(({ row, slot }, index) => renderFlowSource(row, slot, index))
    .join("");
  const sourcePaths = sourceEntries
    .map(({ row, slot }, index) => {
      const meta = CATEGORY_META[row.category];
      const packetBegin = index * sequenceStepSeconds;
      return `
        <g class="source-flow" style="--source-color:${meta.color}">
          <path id="flow-path-${index}" class="flow-path" d="${slot.path}" />
          <circle class="flow-particle flow-particle-primary" r="3" style="opacity:0">
            <animate
              attributeName="opacity"
              values="0;0.9;0.9;0"
              keyTimes="0;0.08;0.9;1"
              begin="${packetBegin.toFixed(2)}s"
              dur="${packetSeconds}s"
              fill="freeze"
            />
            <animateMotion
              begin="${packetBegin.toFixed(2)}s"
              dur="${packetSeconds}s"
              repeatCount="1"
              fill="freeze"
              calcMode="spline"
              keyTimes="0;1"
              keySplines="0.25 1 0.5 1"
            >
              <mpath href="#flow-path-${index}" />
            </animateMotion>
          </circle>
        </g>
      `;
    })
    .join("");

  elements.compositionVisual.innerHTML = `
    <div class="flow-instrument">
      <div class="flow-readout" aria-label="Selected request measurements">
        <span>IN WINDOW <strong>${formatCompact(inputTokens)} / ${formatCompact(capacity)}</strong></span>
        <span>TURN <strong>${formatInteger(request.turn)}</strong></span>
        <span>COMPACTIONS <strong>${formatInteger(compactions)}</strong></span>
        <span>SOURCES <strong>${formatInteger(compositionRows.length)}</strong></span>
        <span>FILL <strong>${formatPercent(fillPercent)}</strong></span>
        <button class="flow-control" id="flow-toggle" type="button" aria-pressed="false">pause</button>
        <button class="flow-control" id="flow-replay" type="button">replay</button>
      </div>
      <div class="flow-canvas" tabindex="0" aria-label="Scrollable animated context flow diagram">
        <svg
          id="flow-diagram"
          class="flow-diagram"
          viewBox="0 0 1200 700"
          role="img"
          aria-labelledby="flow-title flow-description"
        >
          <title id="flow-title">All contributors to this Codex context</title>
          <desc id="flow-description">
            Every non-zero context category flows toward the selected model request once, one
            category at a time. After each packet arrives, its patterned layer grows inside the
            context window.
          </desc>
          <defs>
            <clipPath id="context-window-clip">
              <circle cx="600" cy="350" r="208" />
            </clipPath>
            ${layerRevealDefinitions}
            ${renderSedimentPatterns()}
          </defs>

          <g class="sediment" clip-path="url(#context-window-clip)">
            ${sedimentLayers}
          </g>

          ${sourcePaths}
          <circle class="context-window-circle" cx="600" cy="350" r="208" />
          <text class="diagram-label context-label" x="600" y="172" text-anchor="middle">
            CONTEXT WINDOW
          </text>
          <line class="compact-line" x1="408" x2="792" y1="225" y2="225" />
          <text class="diagram-micro compact-label" x="786" y="216" text-anchor="end">
            COMPACT ${compactAtPercent}%
          </text>

          <circle class="agent-halo" cx="600" cy="350" r="10" />
          <circle class="agent-dot" cx="600" cy="350" r="6" />
          <text class="diagram-label agent-label" x="600" y="383" text-anchor="middle">REQUEST</text>

          ${sourceMarkup}
        </svg>
      </div>
      <div class="flow-caption">
        <p>
          Categories enter sequentially. One packet travels from its source to the request once;
          then its matching color-coded layer grows inside the circle before the next category
          begins. Motion is illustrative; displayed token values come from the selected Codex
          rollout request.
        </p>
        <p>
          ${formatInteger(inputTokens - unresolvedTokens)} tokens map to visible items and explicit
          structure estimates. ${formatInteger(unresolvedTokens)} remain unresolved.
        </p>
      </div>
    </div>
  `;

  elements.compositionBreakdown.innerHTML = compositionRows
    .map((row) => {
      const meta = CATEGORY_META[row.category];
      return `
        <button class="breakdown-row" type="button" data-category="${row.category}">
          <span class="category-swatch" style="--swatch:${meta.color}" aria-hidden="true"></span>
          <span class="breakdown-copy">
            <strong>${escapeHtml(meta.label)}</strong>
            <small>${escapeHtml(meta.description)}</small>
          </span>
          <span class="breakdown-value">
            <strong>${formatPercent(row.percent)}</strong>
            <small>${formatTokens(row.tokens)}</small>
          </span>
        </button>
      `;
    })
    .join("");

  for (const button of elements.compositionBreakdown.querySelectorAll("[data-category]")) {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderContents();
      elements.contextItems.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
    });
  }

  const diagram = elements.compositionVisual.querySelector("#flow-diagram");
  const toggle = elements.compositionVisual.querySelector("#flow-toggle");
  const replay = elements.compositionVisual.querySelector("#flow-replay");

  if (reducedMotion()) {
    diagram.setCurrentTime(sequenceDuration);
    diagram.pauseAnimations();
    diagram.classList.add("is-reduced-motion");
    toggle.textContent = "motion off";
    toggle.disabled = true;
    replay.disabled = true;
  } else {
    toggle.addEventListener("click", () => {
      const paused = toggle.getAttribute("aria-pressed") === "true";
      if (paused) {
        diagram.unpauseAnimations();
        toggle.textContent = "pause";
        toggle.setAttribute("aria-pressed", "false");
      } else {
        diagram.pauseAnimations();
        toggle.textContent = "resume";
        toggle.setAttribute("aria-pressed", "true");
      }
    });
    replay.addEventListener("click", () => {
      diagram.setCurrentTime(0);
      diagram.unpauseAnimations();
      toggle.textContent = "pause";
      toggle.setAttribute("aria-pressed", "false");
    });
  }
}

function buildFlowSources(rows) {
  const sides = {
    left: rows.filter((_, index) => index % 2 === 0),
    right: rows.filter((_, index) => index % 2 === 1),
  };
  const slotsByCategory = new Map();

  for (const [side, sideRows] of Object.entries(sides)) {
    const count = sideRows.length;
    sideRows.forEach((row, sideIndex) => {
      const ratio = count === 1 ? 0.5 : sideIndex / (count - 1);
      const sourceY = 92 + ratio * 516;
      const junctionY = 205 + ratio * 290;
      const verticalOffset = junctionY - 350;
      const horizontalOffset = Math.sqrt(Math.max(0, 208 ** 2 - verticalOffset ** 2));
      const isLeft = side === "left";
      const junctionX = 600 + (isLeft ? -horizontalOffset : horizontalOffset);
      const glyphX = isLeft ? 220 : 980;
      const startX = isLeft ? 254 : 946;
      const controlOneX = isLeft ? 320 : 880;
      const controlTwoX = junctionX + (isLeft ? -58 : 58);

      slotsByCategory.set(row.category, {
        side,
        x: glyphX,
        y: sourceY,
        junctionX,
        junctionY,
        path: `M ${startX} ${sourceY.toFixed(2)} C ${controlOneX} ${sourceY.toFixed(
          2,
        )} ${controlTwoX.toFixed(2)} ${junctionY.toFixed(2)} ${junctionX.toFixed(
          2,
        )} ${junctionY.toFixed(2)} L 600 350`,
      });
    });
  }

  return rows.map((row) => ({ row, slot: slotsByCategory.get(row.category) }));
}

function renderFlowSource(row, slot, index) {
  const meta = CATEGORY_META[row.category];
  const isLeft = slot.side === "left";
  const labelX = isLeft ? 34 : 1166;
  const anchor = isLeft ? "start" : "end";

  return `
    <g
      class="flow-source flow-source-${index}"
      style="--source-color:${meta.color}"
    >
      <text
        class="diagram-label source-title"
        x="${labelX}"
        y="${(slot.y - 8).toFixed(2)}"
        text-anchor="${anchor}"
      >${escapeHtml(meta.label.toUpperCase())}</text>
      ${renderSourceGlyph(row.category, slot.x, slot.y)}
      <text
        class="diagram-value"
        x="${labelX}"
        y="${(slot.y + 14).toFixed(2)}"
        text-anchor="${anchor}"
      >
        ${formatCompact(row.tokens)} · ${formatPercent(row.percent)}
      </text>
      <circle
        class="junction-dot"
        cx="${slot.junctionX.toFixed(2)}"
        cy="${slot.junctionY.toFixed(2)}"
        r="3.5"
      />
    </g>
  `;
}

function renderSourceGlyph(category, x, y) {
  if (category === "images") {
    return `
      <g class="source-glyph" transform="translate(${x - 32} ${y - 24})">
        <rect x="0" y="0" width="64" height="48" />
        <rect x="8" y="8" width="48" height="32" />
        <path d="M 18 35 L 31 21 L 44 31 L 53 18" />
        <circle cx="50" cy="10" r="2" />
      </g>
    `;
  }
  if (category === "files") {
    return `
      <g class="source-glyph source-files" transform="translate(${x - 35} ${y - 27})">
        <path d="M 0 8 H 70 M 0 20 H 70 M 0 32 H 70 M 0 44 H 70" />
        <rect x="54" y="0" width="7" height="54" />
        <path d="M 54 8 H 61 M 54 20 H 61 M 54 32 H 61 M 54 44 H 61" />
      </g>
    `;
  }
  if (category === "conversation" || category === "commands") {
    return `
      <g class="source-glyph source-branch" transform="translate(${x - 31} ${y - 26})">
        <circle cx="8" cy="26" r="7" />
        <path d="M 15 26 C 32 26 36 8 54 8 M 15 26 C 32 26 36 26 54 26 M 15 26 C 32 26 36 44 54 44" />
        <circle cx="58" cy="8" r="3" />
        <circle cx="58" cy="26" r="3" />
        <circle cx="58" cy="44" r="3" />
      </g>
    `;
  }
  if (category === "reasoning") {
    return `
      <g class="source-glyph source-reasoning" transform="translate(${x} ${y})">
        <circle cx="0" cy="0" r="34" />
        <circle cx="0" cy="0" r="24" stroke-dasharray="2 4" />
        <circle cx="0" cy="0" r="16" />
        <path d="M 0 16 C 1 30 15 36 28 39" />
      </g>
    `;
  }
  if (category === "searches") {
    return `
      <g class="source-glyph" transform="translate(${x} ${y})">
        <circle cx="-7" cy="-7" r="22" />
        <path d="M 9 9 L 29 29 M -15 -7 H 1 M -7 -15 V 1" />
      </g>
    `;
  }
  if (category === "changes") {
    return `
      <g class="source-glyph" transform="translate(${x - 30} ${y - 26})">
        <path d="M 18 2 H 3 V 50 H 18 M 42 2 H 57 V 50 H 42 M 18 17 H 42 M 18 26 H 36 M 18 35 H 42" />
      </g>
    `;
  }
  if (category === "structure") {
    return `
      <g class="source-glyph" transform="translate(${x - 26} ${y - 26})">
        <rect x="0" y="0" width="52" height="52" />
        <path d="M 17 0 V 52 M 35 0 V 52 M 0 17 H 52 M 0 35 H 52" />
      </g>
    `;
  }
  return `
    <g class="source-glyph" transform="translate(${x - 28} ${y - 28})">
      <rect x="0" y="0" width="56" height="56" />
      <circle cx="28" cy="28" r="16" />
      <path d="M 28 0 V 12 M 28 44 V 56 M 0 28 H 12 M 44 28 H 56" />
    </g>
  `;
}

function renderSedimentPatterns() {
  return `
    <pattern id="sediment-0" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M 0 1 H 8" />
    </pattern>
    <pattern id="sediment-1" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="0.8" /><circle cx="6" cy="6" r="0.8" />
    </pattern>
    <pattern id="sediment-2" width="9" height="9" patternUnits="userSpaceOnUse">
      <path d="M -2 9 L 9 -2 M 3 12 L 12 3" />
    </pattern>
    <pattern id="sediment-3" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 0 3 H 5 M 6 8 H 10" />
    </pattern>
    <pattern id="sediment-4" width="8" height="8" patternUnits="userSpaceOnUse">
      <path d="M 4 0 V 8" />
    </pattern>
    <pattern id="sediment-5" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 0 0 L 10 10 M 10 0 L 0 10" />
    </pattern>
    <pattern id="sediment-6" width="12" height="8" patternUnits="userSpaceOnUse">
      <path d="M 0 2 H 12 M 0 6 H 12" stroke-dasharray="3 2" />
    </pattern>
    <pattern id="sediment-7" width="9" height="9" patternUnits="userSpaceOnUse">
      <circle cx="4.5" cy="4.5" r="1.2" />
    </pattern>
    <pattern id="sediment-8" width="12" height="12" patternUnits="userSpaceOnUse">
      <path d="M 0 6 H 12 M 6 0 V 12" />
    </pattern>
  `;
}

function renderTimeline() {
  const maxInput = Math.max(...state.timeline.map((view) => view.inputTokens), 1);
  const selectedId = state.view.request.id;

  elements.turnSelector.innerHTML = `
    <span>${state.timeline.length} token-counted turn${state.timeline.length === 1 ? "" : "s"}</span>
  `;

  elements.timeline.innerHTML = `
    <div class="timeline-plot">
      ${state.timeline
        .map((view) => {
          const barHeight = Math.max(8, (view.inputTokens / maxInput) * 100);
          const segments = view.compositionRows
            .map(
              (row) =>
                `<span style="height:${row.percent}%;background:${CATEGORY_META[row.category].color}"></span>`,
            )
            .join("");
          return `
            <button
              class="turn-column ${view.request.id === selectedId ? "is-selected" : ""}"
              type="button"
              data-request="${escapeHtml(view.request.id)}"
              aria-label="Turn ${view.request.turn}, ${formatInteger(view.inputTokens)} input tokens"
            >
              <span class="turn-value">${formatCompact(view.inputTokens)}</span>
              <span class="turn-bar-area">
                <span class="turn-bar" style="height:${barHeight}%">${segments}</span>
              </span>
              <span class="turn-label">T${view.request.turn}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  for (const button of elements.timeline.querySelectorAll("[data-request]")) {
    button.addEventListener("click", () => {
      const next = buildContextView(state.session, button.dataset.request);
      if (!next) return;
      state.view = next;
      render();
    });
  }
}

function renderContents() {
  if (!state.view) return;
  const categoryCounts = new Map();
  for (const item of state.view.items) {
    const summary = categoryCounts.get(item.category) || { count: 0, tokens: 0 };
    summary.count += 1;
    summary.tokens += item.tokens;
    categoryCounts.set(item.category, summary);
  }

  const filterRows = [
    {
      key: "all",
      label: "All items",
      count: state.view.items.length,
      tokens: state.view.inputTokens,
    },
    ...Object.keys(CATEGORY_META)
      .filter((key) => categoryCounts.has(key))
      .map((key) => ({
        key,
        label: CATEGORY_META[key].label,
        ...categoryCounts.get(key),
      })),
  ];

  elements.categoryFilters.innerHTML = filterRows
    .map(
      (row) => `
        <button
          type="button"
          class="filter-button ${state.category === row.key ? "is-active" : ""}"
          data-filter="${row.key}"
        >
          <span>
            ${
              row.key === "all"
                ? ""
                : `<i style="--swatch:${CATEGORY_META[row.key].color}" aria-hidden="true"></i>`
            }
            ${escapeHtml(row.label)}
          </span>
          <small>${row.count} · ${formatCompact(row.tokens)}</small>
        </button>
      `,
    )
    .join("");

  for (const button of elements.categoryFilters.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", () => {
      state.category = button.dataset.filter;
      renderContents();
    });
  }

  const visible = state.view.items.filter((item) => {
    if (state.category !== "all" && item.category !== state.category) return false;
    if (!state.query) return true;
    const haystack = [
      item.title,
      item.preview,
      item.detail,
      item.file,
      item.tool,
      item.source,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query);
  });

  elements.contentsSummary.textContent =
    "Every locally observable item fitted into the selected request, with its source and interpretation.";
  elements.itemCount.textContent = `${visible.length} of ${state.view.items.length} items`;
  elements.contextItems.classList.toggle("show-retention", state.retentionLens);

  if (!visible.length) {
    elements.contextItems.innerHTML = document.querySelector("#empty-template").innerHTML;
    return;
  }

  elements.contextItems.innerHTML = visible
    .map((item) => {
      const meta = CATEGORY_META[item.category];
      const sourceParts = [
        item.turn > 0 ? `Turn ${item.turn}` : "Session",
        item.file ? abbreviatePath(item.file) : "",
        item.tool || "",
        item.partial ? "partially represented" : "",
      ].filter(Boolean);
      return `
        <article class="context-item ${item.potentiallyNotUseful ? "has-retention-note" : ""}">
          <span class="item-swatch" style="--swatch:${meta.color}" aria-hidden="true"></span>
          <div class="item-main">
            <div class="item-heading">
              <div>
                <span class="item-category">${escapeHtml(meta.label)}</span>
                <h3>${escapeHtml(item.title)}</h3>
              </div>
              <div class="item-token">
                <strong>${formatInteger(item.tokens)}</strong>
                <span>estimated tokens</span>
              </div>
            </div>
            <p class="item-preview">${escapeHtml(item.preview || "No text preview is available.")}</p>
            <div class="item-meta">
              ${sourceParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
            </div>
            ${
              item.potentiallyNotUseful
                ? `<div class="retention-note">
                    <strong>Potentially not useful to keep carrying</strong>
                    <span>${escapeHtml(item.retentionReason)}</span>
                  </div>`
                : ""
            }
            <details>
              <summary>How this item was interpreted</summary>
              <p>${escapeHtml(item.detail || meta.description)}</p>
            </details>
          </div>
        </article>
      `;
    })
    .join("");
}

function showError(message) {
  elements.workspace.hidden = false;
  elements.sessionBar.innerHTML = `<div class="error-message" role="alert">${escapeHtml(message)}</div>`;
  elements.requestFacts.innerHTML = "";
  elements.compositionVisual.innerHTML = "";
  elements.compositionBreakdown.innerHTML = "";
  elements.timeline.innerHTML = "";
  elements.contextItems.innerHTML = "";
}

function showLoadStatus(message, isError = false) {
  elements.loadStatus.textContent = message;
  elements.loadStatus.classList.toggle("is-error", isError);
}

function setSessionLoading(loading) {
  elements.workspace.setAttribute("aria-busy", String(loading));
  for (const selector of elements.sessionBar.querySelectorAll("select")) {
    selector.disabled = loading;
  }
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value) || 0));
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function formatTokens(value) {
  return `${formatInteger(value)} tokens`;
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number < 10 && number > 0 ? number.toFixed(1) : Math.round(number)}%`;
}

function abbreviatePath(value) {
  const parts = String(value || "").split("/").filter(Boolean);
  if (parts.length <= 3) return value;
  return `…/${parts.slice(-3).join("/")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const builtInSession = parseSessionRecord(SAMPLE_SESSION, "Built-in example");
state.sessions = upsertSessionRecord(state.sessions, builtInSession);
await activateSession(builtInSession.id, { announce: false });
await discoverLocalSessions();
