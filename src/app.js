import {
  analyzeCodexSession,
  buildContextView,
  buildTimeline,
  CATEGORY_META,
} from "./analyzer.js";
import { SAMPLE_SESSION } from "./sample.js";

const elements = {
  fileInput: document.querySelector("#file-input"),
  fileDrop: document.querySelector("#file-drop"),
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
  session: null,
  timeline: [],
  view: null,
  sourceName: "Built-in example",
  category: "all",
  query: "",
  retentionLens: false,
};

elements.fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (file) await readFile(file);
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
  const [file] = event.dataTransfer?.files || [];
  if (file) await readFile(file);
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

async function readFile(file) {
  try {
    const text = await file.text();
    loadSession(text, file.name);
  } catch (error) {
    showError(`Could not read this file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadSession(text, sourceName) {
  try {
    const session = analyzeCodexSession(text, { sourceName });
    if (!session.requests.length) {
      throw new Error("No Codex token_count requests were found.");
    }
    state.session = session;
    state.timeline = buildTimeline(session);
    state.view = state.timeline[state.timeline.length - 1];
    state.sourceName = sourceName;
    state.category = "all";
    state.query = "";
    elements.itemSearch.value = "";
    elements.retentionToggle.checked = false;
    state.retentionLens = false;
    elements.workspace.hidden = false;
    render();
  } catch (error) {
    showError(
      `This does not look like a supported Codex rollout: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
      <span class="session-file">${escapeHtml(state.sourceName)}</span>
      <span class="session-path" title="${escapeHtml(metadata.cwd || "")}">${escapeHtml(location)}</span>
    </div>
    <label class="request-select">
      <span>Model request</span>
      <select id="request-select">${requestOptions}</select>
    </label>
  `;

  elements.sessionBar.querySelector("#request-select").addEventListener("change", (event) => {
    const next = buildContextView(state.session, event.target.value);
    if (!next) return;
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
  const { compositionRows, inputTokens, unresolvedTokens } = state.view;
  const circumference = 2 * Math.PI * 52;
  let consumed = 0;
  const rings = compositionRows
    .map((row) => {
      const length = (row.tokens / inputTokens) * circumference;
      const dashOffset = -consumed;
      consumed += length;
      return `
        <circle
          class="ring-segment"
          cx="68"
          cy="68"
          r="52"
          pathLength="${circumference}"
          stroke="${CATEGORY_META[row.category].color}"
          stroke-dasharray="${length} ${Math.max(0, circumference - length)}"
          stroke-dashoffset="${dashOffset}"
        />
      `;
    })
    .join("");

  const stack = compositionRows
    .map(
      (row) =>
        `<span
          style="width:${Math.max(0.35, row.percent)}%;background:${CATEGORY_META[row.category].color}"
          title="${escapeHtml(CATEGORY_META[row.category].label)}: ${formatTokens(row.tokens)}"
        ></span>`,
    )
    .join("");

  elements.compositionVisual.innerHTML = `
    <div class="ring-wrap">
      <svg class="composition-ring" viewBox="0 0 136 136" role="img" aria-label="Context composition chart">
        <circle class="ring-track" cx="68" cy="68" r="52" />
        ${rings}
      </svg>
      <div class="ring-center">
        <strong>${formatCompact(inputTokens)}</strong>
        <span>tokens in context</span>
      </div>
    </div>
    <div class="composition-stack" aria-label="Stacked context composition">${stack}</div>
    <p class="composition-note">
      ${formatInteger(inputTokens - unresolvedTokens)} tokens are covered by visible items and
      explicit structure estimates. ${formatInteger(unresolvedTokens)} remain unresolved.
    </p>
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

loadSession(SAMPLE_SESSION, "Built-in example");
