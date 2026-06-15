const index = window.ANALYZER_INDEX;
const navigation = window.AnalyzerNavigation;

const state = {
  workflows: index?.zoral?.workflows || [],
  parameters: index?.zoral?.parameters || [],
  schemas: index?.zoral?.schemas || [],
  zboAreas: index?.zbo?.areas || [],
  zboQueries: index?.zbo?.queries || [],
  zboPlugins: index?.zbo?.plugins || [],
  zboSchemas: index?.zbo?.schemas || [],
  zboGrids: index?.zbo?.grids || [],
  dbTables: index?.db?.tables || [],
  dbEnums: index?.db?.enums || { custom: [], data: [] },
  dbFunctions: index?.db?.functions || [],
  activeMode: "zoral",
  dbSubmode: "tables",
  selectedTable: null,
  selectedEnum: null,
  selectedFunction: null,
  erCheckedTables: new Set((index?.db?.tables || []).filter(t => t.name.startsWith("appl_")).map(t => t.name)),
  query: "",
  searchMode: "contains",
  searchScope: "all",
  matchOps: [],
  selectedWorkflow: null,
  selectedZboArea: null,
  selectedNodeId: null,
  selectedEdge: null,
  selectedZboNodeId: null,
  selectedZboEdge: null,
  // Per-diagram node-position overrides are in-memory only. Drag updates
  // state.nodePositions[mode][diagramKey][nodeId] = {x,y}; refresh returns to
  // the original Zoral/ZBO layout instead of persisting manual edits.
  nodePositions: { zbo: {}, zoral: {}, database: {} },
  activeTab: "overview",
  showDbBadges: true,
  showConditionText: false,
  showEdgeLabels: true,
  enableNodeDrag: false,
  zoom: 1,
  panes: {
    rail: true,
    results: true,
    diagram: true,
    detail: true,
  },
  sizes: {
    rail: 240,
    results: 340,
    detail: 420,
  },
  crudView: "column",
  showZboCallers: false,
  showEnumTables: false,
  showDeepHierarchy: false,
  showDbTriggers: true,
  showDbTaskTables: false,
  showDbFuncsCallersDb: false,
  liveHighlightedWorkflow: null,
  liveExecutedNodes: null,
};

const els = {
  appShell: document.querySelector(".app-shell"),
  contentGrid: document.querySelector(".content-grid"),
  indexStatus: document.querySelector("#indexStatus"),
  rebuildIndexButton: document.querySelector("#rebuildIndexButton"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  loadingTitle: document.querySelector("#loadingTitle"),
  loadingMessage: document.querySelector("#loadingMessage"),
  searchInput: document.querySelector("#searchInput"),
  searchScope: document.querySelector("#searchScope"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  resultsTitle: document.querySelector("#resultsTitle"),
  resultCount: document.querySelector("#resultCount"),
  resultsList: document.querySelector("#resultsList"),
  workflowTitle: document.querySelector("#workflowTitle"),
  workflowSubtitle: document.querySelector("#workflowSubtitle"),
  diagramCanvas: document.querySelector("#diagramCanvas"),
  detailContent: document.querySelector("#detailContent"),
  fitButton: document.querySelector("#fitButton"),
  toggleDbBadges: document.querySelector("#toggleDbBadges"),
  toggleConditionText: document.querySelector("#toggleConditionText"),
  toggleEdgeLabels: document.querySelector("#toggleEdgeLabels"),
  toggleNodeDrag: document.querySelector("#toggleNodeDrag"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomLabel: document.querySelector("#zoomLabel"),
  toggleZboCallersZoral: document.querySelector("#toggleZboCallersZoral"),
  toggleZboCallersZoralLabel: document.querySelector("#toggleZboCallersZoralLabel"),
  toggleZoralCallersDb: document.querySelector("#toggleZoralCallersDb"),
  toggleZoralCallersDbLabel: document.querySelector("#toggleZoralCallersDbLabel"),
  toggleZboCallersDb: document.querySelector("#toggleZboCallersDb"),
  toggleZboCallersDbLabel: document.querySelector("#toggleZboCallersDbLabel"),
  toggleEnumTables: document.querySelector("#toggleEnumTables"),
  toggleEnumTablesLabel: document.querySelector("#toggleEnumTablesLabel"),
  toggleDeepHierarchy: document.querySelector("#toggleDeepHierarchy"),
  toggleDeepHierarchyLabel: document.querySelector("#toggleDeepHierarchyLabel"),
  toggleDbTriggers: document.querySelector("#toggleDbTriggers"),
  toggleDbTriggersLabel: document.querySelector("#toggleDbTriggersLabel"),
  toggleDbTaskTables: document.querySelector("#toggleDbTaskTables"),
  toggleDbTaskTablesLabel: document.querySelector("#toggleDbTaskTablesLabel"),
  toggleDbFuncsCallersDb: document.querySelector("#toggleDbFuncsCallersDb"),
  toggleDbFuncsCallersDbLabel: document.querySelector("#toggleDbFuncsCallersDbLabel"),
  diagramSettingsBtn: document.querySelector("#diagramSettingsBtn"),
  diagramSettingsModal: document.querySelector("#diagramSettingsModal"),
  closeSettingsBtn: document.querySelector("#closeSettingsBtn"),
  saveSettingsBtn: document.querySelector("#saveSettingsBtn"),
  copyListButton: document.querySelector("#copyListButton"),
};

const STORAGE_KEY = "workflowHelper.state.v4";
const REBUILD_WINDOWS_FILE = "rebuild-index.bat";
const REBUILD_MAC_COMMAND =
  "node scripts/build-index.mjs && node scripts/encrypt-index.mjs";

// The diagram pane must never retain a scroll offset — its header is fixed and
// the canvas scrolls internally. `scrollIntoView()` on a deep timeline row/node
// can otherwise scroll the pane itself (overflow:hidden is still programmatically
// scrollable), pushing the "Process Timeline" header out of view, and the offset
// persists across mode switches. Force it back to 0 on any scroll.
(function guardDiagramPaneScroll() {
  const pane = els.diagramCanvas && els.diagramCanvas.closest(".diagram-pane");
  if (!pane) return;
  pane.addEventListener("scroll", () => {
    if (pane.scrollTop !== 0) pane.scrollTop = 0;
    if (pane.scrollLeft !== 0) pane.scrollLeft = 0;
  }, { passive: true });
})();

// Set true at the end of a click-drag pan so the trailing click does not also
// select a node/edge.
let suppressDiagramClick = false;
let rebuildInstructionsShown = false;
let searchRenderTimer = 0;

function updatePageTitle() {
  const mode = state.activeMode;
  if (mode === "zoral") {
    document.title = "ZDE";
  } else if (mode === "zbo") {
    document.title = "ZBO";
  } else if (mode === "database") {
    if (state.selectedTable && state.selectedTable.name) {
      document.title = "DB: " + state.selectedTable.name;
    } else if (state.selectedEnum && state.selectedEnum.name) {
      document.title = "DB: " + state.selectedEnum.name;
    } else if (state.selectedFunction && state.selectedFunction.name) {
      document.title = "DB: " + state.selectedFunction.name;
    } else {
      document.title = "DB";
    }
  } else if (mode === "live") {
    const L = window.WorkflowLive;
    if (L) {
      const fileName = typeof L.getImportedFileName === "function" ? L.getImportedFileName() : null;
      const appId = typeof L.getLastAppId === "function" ? L.getLastAppId() : null;
      if (fileName) {
        document.title = "Live: " + fileName;
      } else if (appId) {
        document.title = "Live: " + appId;
      } else {
        document.title = "Live";
      }
    } else {
      document.title = "Live";
    }
  } else {
    document.title = "Workflow Helper";
  }
}
window.updatePageTitle = updatePageTitle;
window.setMode = setMode;
window.selectTable = selectTable;
window.selectWorkflow = selectWorkflow;
window.selectFunction = selectFunction;
window.clearLiveHighlights = function() {
  state.liveHighlightedWorkflow = null;
  state.liveExecutedNodes = null;
  renderDiagram();
};


function init() {
  bindRebuildIndex();
  if (!index) {
    renderIndexMissing();
    return;
  }

  renderIndexStatus();
  prepareSearchIndex();

  restoreState();
  const urlParams = new URLSearchParams(window.location.search);
  const urlWorkflow = urlParams.get("workflow");
  const urlZbo = urlParams.get("zbo");
  if (urlWorkflow) {
    state.query = urlWorkflow;
    state.searchScope = "workflow";
  }
  if (urlZbo) {
    state.query = urlZbo;
    state.searchScope = "zbo";
  }
  applyLayoutState();
  bindEvents();
  applyFormState();
  renderResults();

  if (urlWorkflow) state.activeMode = "zoral";
  if (urlZbo) state.activeMode = "zbo";
  applyModeState();

  if (state.activeMode === "database") {
    const resultsTitleRow = document.querySelector(".results-title-row");
    const dbSubmodeContainer = document.querySelector("#dbSubmodeContainer");
    if (resultsTitleRow) resultsTitleRow.style.display = "none";
    if (dbSubmodeContainer) dbSubmodeContainer.style.display = "flex";
    document.querySelectorAll("[data-db-submode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.dbSubmode === state.dbSubmode);
    });
    renderResults();
    selectDatabaseDefaultItem({ restore: true });
    updatePageTitle();
    return;
  }

  if (state.activeMode === "zbo") {
    const preferredZbo =
      state.zboAreas.find((area) => area.name === urlZbo) ||
      state.zboAreas.find((area) => area.name === state.selectedZboArea?.name) ||
      state.zboAreas[0];
    renderResults();
    if (preferredZbo) selectZboArea(preferredZbo.name, { restore: true });
    else renderZboEmpty();
    updatePageTitle();
    return;
  }

  const preferred =
    state.workflows.find((workflow) => workflow.name === urlWorkflow) ||
    state.workflows.find((workflow) => workflow.name === state.selectedWorkflow?.name) ||
    state.workflows.find((workflow) => workflow.name === "Adw_UpdateApplication") ||
    state.workflows[0];
  if (preferred) selectWorkflow(preferred.name, { restore: true, preserveSearch: Boolean(urlWorkflow) });
  updatePageTitle();
}

function renderIndexStatus() {
  els.indexStatus.innerHTML = `
    <div class="status-group">
      <span class="status-title">Zoral</span>
      <span class="status-row"><span>Workflows</span><span>${escapeHtml(index.meta.workflowCount || state.workflows.length)}</span></span>
      <span class="status-row"><span>Parameter tables</span><span>${escapeHtml(index.meta.parameterTableCount || state.parameters.length)}</span></span>
      <span class="status-row"><span>Schemas</span><span>${escapeHtml(index.meta.schemaCount || state.schemas.length)}</span></span>
    </div>
    <div class="status-group">
      <span class="status-title">ZBO</span>
      <span class="status-row"><span>Areas</span><span>${escapeHtml(index.meta.zboAreaCount || state.zboAreas.length)}</span></span>
      <span class="status-row"><span>Queries</span><span>${escapeHtml(index.meta.zboQueryCount || state.zboQueries.length)}</span></span>
    </div>
    <div class="status-group">
      <span class="status-title">Database</span>
      <span class="status-row"><span>Tables</span><span>${escapeHtml(index.meta.dbTableCount || state.dbTables.length)}</span></span>
    </div>
    <div class="status-group">
      <span class="status-title">Generated</span>
      <span>${escapeHtml(formatDate(index.meta.generatedAt))}</span>
    </div>
  `;
}

function renderIndexMissing() {
  els.indexStatus.innerHTML = `
    <div class="status-warning">
      Analyzer index file was not found. Press Rebuild Index for manual rebuild steps.
    </div>
  `;
  els.workflowTitle.textContent = "Index missing";
  els.workflowSubtitle.textContent = "Run the manual rebuild steps, then select the encrypted index.";
  els.diagramCanvas.innerHTML = `<div class="empty-state">Index missing. Build and encrypt the index first.</div>`;
  els.detailContent.innerHTML = renderEmpty("Analyzer index is missing. Press Rebuild Index for manual steps.");
}

function bindRebuildIndex() {
  if (!els.rebuildIndexButton) return;
  els.rebuildIndexButton.addEventListener("click", showManualRebuildInstructions);
}

function showManualRebuildInstructions() {
  if (rebuildInstructionsShown) {
    window.location.reload();
    return;
  }

  rebuildInstructionsShown = true;
  els.rebuildIndexButton.textContent = "Return To Unlock";
  const paths = getLocalAnalyzerPaths();
  const analyzerPath = paths.analyzerPath || "this analyzer folder";
  const instruction = getManualRebuildInstruction(analyzerPath);
  els.indexStatus.innerHTML = `
    <div class="status-instruction">
      <strong>Please manually rebuild the analyzer index.</strong>
      <ol>${instruction.steps
        .map((step) => `<li>${step}</li>`)
        .join("")}
        <li>When the command finishes successfully, click <strong>Return To Unlock</strong> and select the new encrypted file.</li>
      </ol>
    </div>
  `;
}

function getManualRebuildInstruction(analyzerPath) {
  const os = detectOs();
  if (os === "windows") {
    return {
      steps: [
        `Open this folder:<br><code>${escapeHtml(analyzerPath)}</code>`,
        `Run <code>${escapeHtml(REBUILD_WINDOWS_FILE)}</code>`,
      ],
    };
  }

  if (os === "macos" || os === "linux") {
    return {
      steps: [
        `Open this folder in Terminal:<br><code>${escapeHtml(analyzerPath)}</code>`,
        `Run <code>${escapeHtml(REBUILD_MAC_COMMAND)}</code>`,
      ],
    };
  }

  return {
    steps: [
      `Open this folder:<br><code>${escapeHtml(analyzerPath)}</code>`,
      `Run <code>${escapeHtml(REBUILD_WINDOWS_FILE)}</code> on Windows, or <code>${escapeHtml(REBUILD_MAC_COMMAND)}</code> on macOS/Linux.`,
    ],
  };
}

function detectOs() {
  const platform =
    navigator.userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    "";
  const value = platform.toLowerCase();
  if (value.includes("win")) return "windows";
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return "unknown";
}

function getLocalAnalyzerPaths() {
  if (window.location.protocol !== "file:") {
    return { analyzerPath: "", workspacePath: "" };
  }

  let localPath = decodeURIComponent(window.location.pathname || "");
  if (/^\/[A-Za-z]:\//.test(localPath)) {
    localPath = localPath.slice(1).replaceAll("/", "\\");
  }

  const analyzerPath = localPath.replace(/[\\/]index\.html$/i, "");
  const workspacePath = analyzerPath.replace(/[\\/]tools[\\/]analyzer$/i, "");
  return { analyzerPath, workspacePath };
}

function showLoading(title, message) {
  if (!els.loadingOverlay) return;
  els.loadingTitle.textContent = title;
  els.loadingMessage.textContent = message;
  els.loadingOverlay.hidden = false;
}

function hideLoading() {
  if (els.loadingOverlay) els.loadingOverlay.hidden = true;
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.nodePositions) {
      delete saved.nodePositions;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    state.activeMode = ["zbo", "database"].includes(saved.activeMode) ? saved.activeMode : "zoral";
    state.dbSubmode = saved.dbSubmode || "tables";
    state.query = saved.query || "";
    state.searchMode = saved.searchMode || "contains";
    state.searchScope = isValidSearchScope(saved.searchScope) ? saved.searchScope : "all";
    state.matchOps = Array.isArray(saved.matchOps) ? saved.matchOps : [];
    state.selectedWorkflow = saved.selectedWorkflow
      ? { name: saved.selectedWorkflow }
      : null;
    state.selectedZboArea = saved.selectedZboArea ? { name: saved.selectedZboArea } : null;
    state.selectedTable = saved.selectedTable ? state.dbTables.find(t => t.name === saved.selectedTable) : null;
    state.selectedEnum = saved.selectedEnum ? ([...state.dbEnums.custom, ...state.dbEnums.data].find(e => e.name === saved.selectedEnum)) : null;
    state.selectedFunction = saved.selectedFunction ? state.dbFunctions.find(f => f.name === saved.selectedFunction) : null;
    state.selectedNodeId = saved.selectedNodeId || null;
    state.selectedEdge = saved.selectedEdge || null;
    state.activeTab = saved.activeTab || "overview";
    state.showDbBadges = saved.showDbBadges ?? true;
    state.showConditionText = saved.showConditionText ?? false;
    state.showEdgeLabels = saved.showEdgeLabels ?? true;
    state.enableNodeDrag = saved.enableNodeDrag ?? false;
    state.zoom = saved.zoom || 1;
    state.panes = { ...state.panes, ...(saved.panes || {}) };
    state.sizes = { ...state.sizes, ...(saved.sizes || {}) };
    state.crudView = saved.crudView || "column";
    state.showZboCallersZoral = saved.showZboCallersZoral ?? false;
    state.showZoralCallersDb = saved.showZoralCallersDb ?? false;
    state.showZboCallersDb = saved.showZboCallersDb ?? false;
    state.showEnumTables = saved.showEnumTables ?? false;
    state.showDeepHierarchy = saved.showDeepHierarchy ?? false;
    state.showDbTriggers = saved.showDbTriggers ?? true;
    state.showDbTaskTables = saved.showDbTaskTables ?? false;
    state.showDbFuncsCallersDb = saved.showDbFuncsCallersDb ?? false;
  } catch {
    // Ignore corrupt local UI state.
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      query: state.query,
      activeMode: state.activeMode,
      dbSubmode: state.dbSubmode,
      searchMode: state.searchMode,
      searchScope: state.searchScope,
      matchOps: state.matchOps,
      selectedWorkflow: state.selectedWorkflow?.name || "",
      selectedZboArea: state.selectedZboArea?.name || "",
      selectedTable: state.selectedTable?.name || "",
      selectedEnum: state.selectedEnum?.name || "",
      selectedFunction: state.selectedFunction?.name || "",
      selectedNodeId: state.selectedNodeId || "",
      selectedEdge: state.selectedEdge || null,
      activeTab: state.activeTab,
      showDbBadges: state.showDbBadges,
      showConditionText: state.showConditionText,
      showEdgeLabels: state.showEdgeLabels,
      enableNodeDrag: state.enableNodeDrag,
      zoom: state.zoom,
      panes: state.panes,
      sizes: state.sizes,
      crudView: state.crudView,
      showZboCallersZoral: state.showZboCallersZoral,
      showZoralCallersDb: state.showZoralCallersDb,
      showZboCallersDb: state.showZboCallersDb,
      showEnumTables: state.showEnumTables,
      showDeepHierarchy: state.showDeepHierarchy,
      showDbTriggers: state.showDbTriggers,
      showDbTaskTables: state.showDbTaskTables,
      showDbFuncsCallersDb: state.showDbFuncsCallersDb,
    }),
  );
}

function applyFormState() {
  els.searchInput.value = state.query;
  els.searchScope.value = state.searchScope;
  els.toggleDbBadges.checked = state.showDbBadges;
  if (els.toggleConditionText) els.toggleConditionText.checked = state.showConditionText;
  if (els.toggleEdgeLabels) els.toggleEdgeLabels.checked = state.showEdgeLabels;
  if (els.toggleNodeDrag) els.toggleNodeDrag.checked = state.enableNodeDrag;
  if (els.toggleZboCallersZoral) els.toggleZboCallersZoral.checked = state.showZboCallersZoral;
  if (els.toggleZoralCallersDb) els.toggleZoralCallersDb.checked = state.showZoralCallersDb;
  if (els.toggleZboCallersDb) els.toggleZboCallersDb.checked = state.showZboCallersDb;
  if (els.toggleEnumTables) els.toggleEnumTables.checked = state.showEnumTables;
  if (els.toggleDeepHierarchy) els.toggleDeepHierarchy.checked = state.showDeepHierarchy;
  if (els.toggleDbTriggers) els.toggleDbTriggers.checked = state.showDbTriggers;
  if (els.toggleDbTaskTables) els.toggleDbTaskTables.checked = state.showDbTaskTables;
  if (els.toggleDbFuncsCallersDb) els.toggleDbFuncsCallersDb.checked = state.showDbFuncsCallersDb;
  applyDiagramDragState();
  applyModeState();
  document
    .querySelectorAll("[data-search-mode]")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.searchMode === state.searchMode),
    );
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  updateMatchFilterChips();
}

function applyModeState() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.activeMode);
  });
  if (state.activeMode === "database") {
    els.resultsTitle.textContent = "Database Mode";
    els.searchInput.placeholder = "Search tables, enums, functions, columns...";
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const labels = {
        overview: "Datadict",
        node: "Triggers/FKs",
        db: "CRUD Map",
        inbound: "CR Gen",
      };
      button.textContent = labels[button.dataset.tab] || button.textContent;
    });
  } else {
    els.resultsTitle.textContent =
      state.activeMode === "live"
        ? "Processes"
        : state.activeMode === "zbo"
        ? "ZBO Areas"
        : "Zoral Workflows";
    els.searchInput.placeholder =
      state.activeMode === "live"
        ? "Search by ApplicationId..."
        : state.activeMode === "zbo"
        ? "Search ZBO area, query, field, workflow, table..."
        : "Search workflow, ZBO area, parameter, field, table, GraphQL...";
    document.querySelectorAll("[data-tab]").forEach((button) => {
      let labels;
      if (state.activeMode === "live") {
        labels = { overview: "Overall", node: "input/output", db: "DB/GQL", inbound: "Step" };
      } else if (state.activeMode === "zbo") {
        labels = { overview: "Overview", node: "Artifacts", db: "DB/GQL", inbound: "Calls" };
      } else {
        labels = { overview: "Overview", node: "Node", db: "DB/GQL", inbound: "Inbound" };
      }
      button.textContent = labels[button.dataset.tab] || button.textContent;
    });
  }
  const tabLiveExec = document.getElementById("tabLiveExec");
  if (tabLiveExec) {
    const isLiveHighlighted = state.activeMode === "zoral" && 
                              state.liveHighlightedWorkflow && 
                              state.liveHighlightedWorkflow === state.selectedWorkflow?.name;
    tabLiveExec.style.display = isLiveHighlighted ? "inline-block" : "none";
    if (!isLiveHighlighted && state.activeTab === "live-exec") {
      state.activeTab = "overview";
      document.querySelectorAll("[data-tab]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === "overview");
      });
    }
  }
  const isDb = state.activeMode === "database";
  const isDbTables = isDb && state.dbSubmode === "tables";
  const isDbEr = isDb && state.dbSubmode === "er";
  const isZoral = state.activeMode === "zoral";
  const isZbo = state.activeMode === "zbo";

  if (els.toggleDbBadges) {
    els.toggleDbBadges.parentElement.style.display = (isZoral || isZbo) ? "inline-flex" : "none";
  }
  if (els.toggleConditionText) {
    els.toggleConditionText.parentElement.style.display = (isZoral || isZbo) ? "inline-flex" : "none";
  }
  if (els.toggleEdgeLabels) {
    els.toggleEdgeLabels.parentElement.style.display = isZoral ? "inline-flex" : "none";
  }
  if (els.toggleNodeDrag) {
    els.toggleNodeDrag.parentElement.style.display = (isZoral || isZbo || isDbEr || isDbTables) ? "inline-flex" : "none";
  }
  if (els.toggleZboCallersZoralLabel) {
    els.toggleZboCallersZoralLabel.style.display = isZoral ? "inline-flex" : "none";
  }
  if (els.toggleZoralCallersDbLabel) {
    els.toggleZoralCallersDbLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  if (els.toggleZboCallersDbLabel) {
    els.toggleZboCallersDbLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  if (els.toggleEnumTablesLabel) {
    els.toggleEnumTablesLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  const matchFilter = document.querySelector(".match-filter");
  if (matchFilter) {
    matchFilter.style.display = (isDbTables || isZoral || isZbo) ? "flex" : "none";
  }
  const paneHeader = document.querySelector(".detail-pane .pane-header");
  const paneToggles = document.querySelector(".detail-pane .pane-toggles");
  let liveHeader = document.getElementById("liveDetailHeader");
  if (state.activeMode === "live") {
    if (paneToggles) paneToggles.style.display = "none";
    if (!liveHeader && paneHeader) {
      liveHeader = document.createElement("h2");
      liveHeader.id = "liveDetailHeader";
      liveHeader.textContent = "Process Detail";
      liveHeader.style.margin = "0";
      liveHeader.style.fontSize = "16px";
      paneHeader.appendChild(liveHeader);
    } else if (liveHeader) {
      liveHeader.style.display = "block";
    }
  } else {
    if (paneToggles) paneToggles.style.display = "inline-flex";
    if (liveHeader) liveHeader.style.display = "none";
  }
  if (els.toggleDeepHierarchyLabel) {
    els.toggleDeepHierarchyLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  if (els.toggleDbTriggersLabel) {
    els.toggleDbTriggersLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  if (els.toggleDbTaskTablesLabel) {
    els.toggleDbTaskTablesLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
  if (els.toggleDbFuncsCallersDbLabel) {
    els.toggleDbFuncsCallersDbLabel.style.display = isDbTables ? "inline-flex" : "none";
  }
}

function updateMatchFilterChips() {
  document.querySelectorAll("[data-match-op]").forEach((button) => {
    const op = button.dataset.matchOp;
    const active = op === "all" ? !state.matchOps.length : state.matchOps.includes(op);
    button.classList.toggle("active", active);
  });
}

function copyFilteredList() {
  const items = Array.from(els.resultsList.children);
  const names = [];

  for (const item of items) {
    if (
      item.classList.contains("result-limit") || 
      item.classList.contains("result-empty") || 
      item.classList.contains("empty-state")
    ) {
      continue;
    }

    let name = "";
    if (state.activeMode === "zoral") {
      name = item.dataset.workflowName || "";
    } else if (state.activeMode === "zbo") {
      name = item.dataset.zboArea || "";
    } else if (state.activeMode === "database") {
      if (state.dbSubmode === "tables" || state.dbSubmode === "er") {
        name = item.dataset.tableName || 
               item.querySelector("[data-er-table]")?.dataset.erTable || 
               item.querySelector("[data-table-click]")?.dataset.tableClick || "";
      } else if (state.dbSubmode === "enums") {
        name = item.dataset.enumName || "";
      } else if (state.dbSubmode === "functions") {
        name = item.dataset.functionName || "";
      } else if (state.dbSubmode === "triggers") {
        name = item.dataset.triggerName || "";
      }
    } else if (state.activeMode === "live") {
      const strong = item.querySelector("strong");
      if (strong) {
        name = strong.textContent.trim();
      } else {
        name = item.dataset.rid || "";
      }
    }

    if (name) {
      names.push(name);
    }
  }

  if (names.length === 0) {
    return;
  }

  const textToCopy = names.join("\n");
  navigator.clipboard.writeText(textToCopy)
    .then(() => {
      if (els.copyListButton) {
        const originalHtml = els.copyListButton.innerHTML;
        els.copyListButton.innerHTML = "Copied!";
        els.copyListButton.disabled = true;
        setTimeout(() => {
          els.copyListButton.innerHTML = originalHtml;
          els.copyListButton.disabled = false;
        }, 1500);
      }
    })
    .catch((err) => {
      console.error("Failed to copy list: ", err);
    });
}

async function writeClipboardText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Browser clipboard command failed");
}

function getZboArtifactCode(kind, id) {
  const sources = {
    query: state.zboQueries,
    plugin: state.zboPlugins,
    schema: state.zboSchemas,
    grid: state.zboGrids,
  };
  return sources[kind]?.find((artifact) => artifact.id === id)?.code || "";
}

async function handleArtifactCopyEvent(event) {
  const button = event.target.closest("[data-copy-zbo-artifact]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const code = getZboArtifactCode(button.dataset.artifactKind, button.dataset.artifactId);
  if (!code) return;
  const originalText = button.textContent;
  button.disabled = true;
  try {
    await writeClipboardText(code);
    button.textContent = "COPIED";
  } catch (error) {
    console.error("Failed to copy ZBO artifact:", error);
    button.textContent = "FAILED";
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  }
}

function bindEvents() {
  if (els.copyListButton) {
    els.copyListButton.addEventListener("click", copyFilteredList);
  }

  document.addEventListener("click", handleInternalNavigationEvent);
  document.addEventListener("click", handleArtifactCopyEvent);
  document.addEventListener("auxclick", handleInternalNavigationEvent);
  window.addEventListener("popstate", handleNavigationPopState);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled || !button.dataset.mode) return;
      setMode(button.dataset.mode);
    });
  });

  document.querySelectorAll("[data-db-submode]").forEach((button) => {
    button.addEventListener("click", () => {
      setDbSubmode(button.dataset.dbSubmode);
    });
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    saveState();
    scheduleRenderResults();
  });

  els.searchScope.addEventListener("change", (event) => {
    state.searchScope = event.target.value;
    saveState();
    renderResultsNow();
  });

  document.querySelectorAll("[data-search-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.searchMode = button.dataset.searchMode;
      document
        .querySelectorAll("[data-search-mode]")
        .forEach((item) => item.classList.toggle("active", item === button));
      saveState();
      renderResultsNow();
    });
  });

  document.querySelectorAll("[data-match-op]").forEach((button) => {
    button.addEventListener("click", () => {
      const op = button.dataset.matchOp;
      if (op === "all") {
        state.matchOps = [];
      } else if (state.matchOps.includes(op)) {
        state.matchOps = state.matchOps.filter((item) => item !== op);
      } else {
        state.matchOps = [...state.matchOps, op];
      }
      updateMatchFilterChips();
      saveState();
      renderResultsNow();
    });
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((item) => item.classList.toggle("active", item === button));
      saveState();
      renderDetails();
    });
  });

  document.querySelectorAll("[data-pane-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const pane = button.dataset.paneToggle;
      state.panes[pane] = !state.panes[pane];
      applyLayoutState();
      saveState();
    });
  });

  els.toggleDbBadges.addEventListener("change", () => {
    state.showDbBadges = els.toggleDbBadges.checked;
    saveState();
    renderActiveDiagram();
  });

  if (els.toggleConditionText) {
    els.toggleConditionText.addEventListener("change", () => {
      state.showConditionText = els.toggleConditionText.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleEdgeLabels) {
    els.toggleEdgeLabels.addEventListener("change", () => {
      state.showEdgeLabels = els.toggleEdgeLabels.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleNodeDrag) {
    els.toggleNodeDrag.addEventListener("change", () => {
      state.enableNodeDrag = els.toggleNodeDrag.checked;
      applyDiagramDragState();
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleZboCallersZoral) {
    els.toggleZboCallersZoral.addEventListener("change", () => {
      state.showZboCallersZoral = els.toggleZboCallersZoral.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleZoralCallersDb) {
    els.toggleZoralCallersDb.addEventListener("change", () => {
      state.showZoralCallersDb = els.toggleZoralCallersDb.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleZboCallersDb) {
    els.toggleZboCallersDb.addEventListener("change", () => {
      state.showZboCallersDb = els.toggleZboCallersDb.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleEnumTables) {
    els.toggleEnumTables.addEventListener("change", () => {
      state.showEnumTables = els.toggleEnumTables.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleDeepHierarchy) {
    els.toggleDeepHierarchy.addEventListener("change", () => {
      state.showDeepHierarchy = els.toggleDeepHierarchy.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleDbTriggers) {
    els.toggleDbTriggers.addEventListener("change", () => {
      state.showDbTriggers = els.toggleDbTriggers.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleDbTaskTables) {
    els.toggleDbTaskTables.addEventListener("change", () => {
      state.showDbTaskTables = els.toggleDbTaskTables.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.toggleDbFuncsCallersDb) {
    els.toggleDbFuncsCallersDb.addEventListener("change", () => {
      state.showDbFuncsCallersDb = els.toggleDbFuncsCallersDb.checked;
      saveState();
      renderActiveDiagram();
    });
  }

  if (els.diagramSettingsBtn) {
    els.diagramSettingsBtn.addEventListener("click", () => {
      els.diagramSettingsModal.classList.add("active");
    });
  }
  if (els.closeSettingsBtn) {
    els.closeSettingsBtn.addEventListener("click", () => {
      els.diagramSettingsModal.classList.remove("active");
    });
  }
  if (els.saveSettingsBtn) {
    els.saveSettingsBtn.addEventListener("click", () => {
      els.diagramSettingsModal.classList.remove("active");
    });
  }
  if (els.diagramSettingsModal) {
    els.diagramSettingsModal.addEventListener("click", (e) => {
      if (e.target === els.diagramSettingsModal) {
        els.diagramSettingsModal.classList.remove("active");
      }
    });
  }

  els.zoomInButton.addEventListener("click", () => setZoom(state.zoom * 1.2));
  els.zoomOutButton.addEventListener("click", () => setZoom(state.zoom / 1.2));

  // Mouse-wheel zoom over the diagram canvas. Preventing default also stops
  // the canvas from scrolling while zooming, which feels natural for both the
  // Zoral and ZBO diagrams. Adjust the canvas scroll so the point under the
  // cursor stays anchored as zoom changes.
  els.diagramCanvas.addEventListener(
    "wheel",
    (event) => {
      if (!els.diagramCanvas.querySelector(".diagram-svg") && !els.diagramCanvas.querySelector(".trace-viewer")) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const previousZoom = state.zoom;
      const rect = els.diagramCanvas.getBoundingClientRect();
      const cursorX = event.clientX - rect.left + els.diagramCanvas.scrollLeft;
      const cursorY = event.clientY - rect.top + els.diagramCanvas.scrollTop;
      setZoom(state.zoom * factor);
      const ratio = state.zoom / previousZoom;
      els.diagramCanvas.scrollLeft = cursorX * ratio - (event.clientX - rect.left);
      els.diagramCanvas.scrollTop = cursorY * ratio - (event.clientY - rect.top);
    },
    { passive: false },
  );

  els.fitButton.addEventListener("click", () => {
    const svg = els.diagramCanvas.querySelector(".diagram-svg");
    if (svg) {
      const w = Number(svg.getAttribute("width")) || 1;
      const h = Number(svg.getAttribute("height")) || 1;
      const fitZoom = Math.min(
        els.diagramCanvas.clientWidth / w,
        els.diagramCanvas.clientHeight / h,
      );
      setZoom(fitZoom);
    }
    els.diagramCanvas.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  });

  els.detailContent.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-jump-node]");
    if (jump) selectNode(jump.dataset.jumpNode);

    const tLink = event.target.closest("[data-table-link]");
    if (tLink) {
      selectTable(tLink.dataset.tableLink);
      setDbSubmode("tables");
      event.preventDefault();
    }

    const fLink = event.target.closest("[data-func-link]");
    if (fLink) {
      selectFunction(fLink.dataset.funcLink);
      setDbSubmode("functions");
      event.preventDefault();
    }

    const wLink = event.target.closest("[data-workflow-link]");
    if (wLink) {
      selectWorkflow(wLink.dataset.workflowLink);
      setMode("zoral");
      event.preventDefault();
    }
  });

  initResizers();
  window.addEventListener("resize", () => {
    const previousDetailWidth = state.sizes.detail;
    applyLayoutState();
    if (state.sizes.detail !== previousDetailWidth) saveState();
  });
  initDiagramPan();
}

function scheduleRenderResults() {
  window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(renderResults, 120);
}

function renderResultsNow() {
  window.clearTimeout(searchRenderTimer);
  syncSearchStateFromForm();
  renderResults();
}

function syncSearchStateFromForm() {
  if (els.searchInput) state.query = els.searchInput.value.trim();
  if (els.searchScope && isValidSearchScope(els.searchScope.value)) {
    state.searchScope = els.searchScope.value;
  }
  const activeModeButton = document.querySelector("[data-search-mode].active");
  if (activeModeButton?.dataset.searchMode) state.searchMode = activeModeButton.dataset.searchMode;
}

function setMode(mode) {
  state.activeMode = mode;
  state.selectedNodeId = null;
  state.selectedEdge = null;
  state.activeTab = "overview";
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  applyModeState();
  saveState();

  if (window.WorkflowLive) window.WorkflowLive.deactivate();
  if (state.activeMode === "live") {
    const resultsTitleRow = document.querySelector(".results-title-row");
    const dbSubmodeContainer = document.querySelector("#dbSubmodeContainer");
    if (resultsTitleRow) resultsTitleRow.style.display = "flex";
    if (dbSubmodeContainer) dbSubmodeContainer.style.display = "none";
    window.WorkflowLive.activate({ els, state });
    updatePageTitle();
    return;
  }

  const resultsTitleRow = document.querySelector(".results-title-row");
  const dbSubmodeContainer = document.querySelector("#dbSubmodeContainer");

  if (state.activeMode === "database") {
    if (resultsTitleRow) resultsTitleRow.style.display = "none";
    if (dbSubmodeContainer) dbSubmodeContainer.style.display = "flex";
    renderResultsNow();
    selectDatabaseDefaultItem();
    updatePageTitle();
    return;
  } else {
    if (resultsTitleRow) resultsTitleRow.style.display = "flex";
    if (dbSubmodeContainer) dbSubmodeContainer.style.display = "none";
  }

  if (state.activeMode === "zbo") {
    renderResultsNow();
    const preferred =
      state.zboAreas.find((area) => area.name === state.selectedZboArea?.name) ||
      getFilteredZboAreas()[0] ||
      state.zboAreas[0];
    if (preferred) selectZboArea(preferred.name);
    else renderZboEmpty();
    return;
  }

  renderResultsNow();
  if (state.selectedWorkflow?.name) {
    selectWorkflow(state.selectedWorkflow.name, { restore: true });
  } else {
    els.workflowTitle.textContent = "Select a workflow";
    els.workflowSubtitle.textContent = "Search or choose a Zoral workflow from the list.";
    renderDiagram();
    renderDetails();
  }
}

// Left-click drag anywhere on the diagram canvas pans the view. A drag past a
// small threshold suppresses the trailing click so panning never selects a
// node or edge by accident.
function initDiagramPan() {
  const canvas = els.diagramCanvas;
  let active = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (isInteractiveDiagramTarget(event.target)) return;
    // event.preventDefault();
    suppressDiagramClick = false;
    active = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = canvas.scrollLeft;
    startTop = canvas.scrollTop;
    // canvas.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener("pointermove", (event) => {
    if (!active) return;
    event.preventDefault();
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 8) {
      moved = true;
      canvas.classList.add("panning");
      document.body.classList.add("diagram-panning");
    }
    if (moved) {
      canvas.scrollLeft = startLeft - dx;
      canvas.scrollTop = startTop - dy;
    }
  });

  function stopPan() {
    if (!active) return;
    active = false;
    if (moved) {
      suppressDiagramClick = true;
      canvas.classList.remove("panning");
      document.body.classList.remove("diagram-panning");
    }
  }

  window.addEventListener("pointerup", stopPan);
  window.addEventListener("pointercancel", stopPan);
  window.addEventListener("blur", stopPan);

  canvas.addEventListener(
    "click",
    (event) => {
      if (isInteractiveDiagramTarget(event.target)) {
        suppressDiagramClick = false;
        return;
      }
      if (suppressDiagramClick) {
        event.stopPropagation();
        event.preventDefault();
        suppressDiagramClick = false;
      }
    },
    true,
  );
}

function isInteractiveDiagramTarget(target) {
  if (target?.closest?.(".trace-viewer") || target?.closest?.(".code-block")) {
    return true;
  }
  // Panning should only be blocked if node dragging is enabled and the target is a node
  if (state.enableNodeDrag && target?.closest?.("[data-node-id]")) {
    return true;
  }
  return false;
}

function detailResizeMax() {
  const gridWidth = els.contentGrid?.getBoundingClientRect().width || window.innerWidth;
  const resultsWidth = state.panes.results ? state.sizes.results + 6 : 0;
  const resizableWidth = Math.max(280, gridWidth - resultsWidth - 6);
  return Math.max(280, Math.floor(resizableWidth * 0.9));
}

function applyLayoutState() {
  state.sizes.detail = clamp(state.sizes.detail, 280, detailResizeMax());
  document.documentElement.style.setProperty("--rail-width", `${state.sizes.rail}px`);
  document.documentElement.style.setProperty("--results-width", `${state.sizes.results}px`);
  document.documentElement.style.setProperty("--detail-width", `${state.sizes.detail}px`);
  els.appShell.classList.toggle("rail-hidden", !state.panes.rail);
  els.contentGrid.classList.toggle("results-hidden", !state.panes.results);
  els.contentGrid.classList.toggle("diagram-hidden", !state.panes.diagram);
  els.contentGrid.classList.toggle("detail-hidden", !state.panes.detail);
  document.querySelectorAll("[data-pane-toggle]").forEach((button) => {
    button.classList.toggle("active", Boolean(state.panes[button.dataset.paneToggle]));
  });
}

function initResizers() {
  document.querySelectorAll("[data-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const target = handle.dataset.resize;
      const startX = event.clientX;
      const startSizes = { ...state.sizes };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add("dragging");

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        if (target === "rail") {
          state.sizes.rail = clamp(startSizes.rail + dx, 160, 420);
        } else if (target === "results") {
          state.sizes.results = clamp(startSizes.results + dx, 220, 620);
        } else if (target === "detail") {
          state.sizes.detail = clamp(startSizes.detail - dx, 280, detailResizeMax());
        }
        applyLayoutState();
      };

      const onUp = () => {
        handle.classList.remove("dragging");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        saveState();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setZoom(value) {
  state.zoom = clamp(Number(value.toFixed(3)), 0.2, 3);
  applyZoom();
  saveState();
}

function applyZoom() {
  const svg = els.diagramCanvas.querySelector(".diagram-svg");
  if (svg) svg.style.zoom = String(state.zoom);
  
  const viewer = els.diagramCanvas.querySelector(".trace-viewer");
  if (viewer) {
    viewer.style.setProperty("--timeline-zoom", state.zoom);
  }
  
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}
window.applyZoom = applyZoom;

function applyDiagramDragState() {
  els.diagramCanvas.classList.toggle("diagram-drag-enabled", Boolean(state.enableNodeDrag));
}

function isValidSearchScope(scope) {
  return ["all", "workflow", "zbo", "parameter", "field", "table", "graphql", "code"].includes(scope);
}

function prepareSearchIndex() {
  for (const workflow of state.workflows) {
    workflow._normalizedNameSearchText = normalizeSearchText(workflowNameSearchText(workflow));
    workflow._normalizedZboSearchText = normalizeSearchText(workflowZboSearchText(workflow));
    workflow._exactSearchCandidates = [
      workflow.name,
      workflow.description,
      ...workflow.fieldRefs,
      ...workflow.nodes.flatMap((node) => [node.id, node.callName, node.type]),
      ...workflow.dbOperations.flatMap((op) => [op.table, op.operation, op.operationName]),
      ...workflow.graphqlOperations.flatMap((op) => [op.table, op.operation, op.operationName]),
      ...(workflow.inboundZbo || []).flatMap((item) => [item.area, item.match, item.sourcePath]),
      ...(workflow.zboFieldMappings || []).flatMap((item) => [
        item.area,
        item.zboField,
        item.graphqlVariable,
        item.zoralInputField,
      ]),
    ].map(normalizeSearchText);
  }

  for (const area of state.zboAreas) {
    area._normalizedNameSearchText = normalizeSearchText(zboAreaNameSearchText(area));
    area._normalizedZboText = normalizeSearchText(
      [
        area.name,
        ...(area.sourcePaths || []),
        ...(area.schemaIds || []),
        ...(area.gridIds || []),
        ...(area.queryIds || []),
        ...(area.pluginIds || []),
      ].join(" "),
    );
  }

  // Precompute database parent-child relationships and nested descendant counts
  const childMap = new Map();
  for (const t of state.dbTables) {
    childMap.set(t.name, new Set());
  }
  for (const t of state.dbTables) {
    for (const fk of t.foreignKeys || []) {
      const parentName = fk.referencedTable;
      if (childMap.has(parentName)) {
        childMap.get(parentName).add(t.name);
      }
    }
  }

  for (const t of state.dbTables) {
    const directSet = childMap.get(t.name) || new Set();
    t.directChildrenCount = directSet.size;

    const allDescendants = new Set();
    const queue = [t.name];
    const visited = new Set([t.name]);
    while (queue.length > 0) {
      const current = queue.shift();
      const children = childMap.get(current) || new Set();
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child);
          allDescendants.add(child);
          queue.push(child);
        }
      }
    }
    t.totalChildrenCount = allDescendants.size;
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function matches(text, query) {
  if (!String(query || "").trim()) return true;
  const haystack = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle) return false;
  // Code search is ALWAYS substring — exact-equality against a whole code/script
  // file has no useful equality meaning, so Exact must not break Code scope.
  if (state.searchMode === "exact" && state.searchScope !== "code") {
    return haystack === needle;
  }
  return haystack.includes(needle);
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function workflowNameSearchText(workflow) {
  return unique([
    workflow.name,
    workflow.description,
    ...(workflow.fieldRefs || []),
    ...(workflow.nodes || []).flatMap((node) => [
      node.id,
      node.label,
      node.callName,
      node.type,
      ...(node.dependencies || []),
    ]),
    ...(workflow.dbOperations || []).flatMap((op) => [
      op.table,
      op.rawTable,
      op.operation,
      op.operationName,
      op.nodeId,
    ]),
    ...(workflow.graphqlOperations || []).flatMap((op) => [
      op.table,
      op.rawTable,
      op.operation,
      op.operationName,
      op.nodeId,
    ]),
    ...(workflow.calledWorkflows || []),
    ...(workflow.inboundCallers || []).map((caller) => caller.workflow),
  ]).join(" ");
}

function workflowZboSearchText(workflow) {
  return unique([
    ...(workflow.inboundZbo || []).flatMap((item) => [
      item.area,
      item.via,
      item.match,
      item.source,
      item.sourcePath,
    ]),
    ...(workflow.zboFieldMappings || []).flatMap((item) => [
      item.area,
      item.zboField,
      item.graphqlVariable,
      item.zoralInputField,
      item.source,
      item.sourcePath,
    ]),
  ])
    .join(" ")
    .toLowerCase();
}

function zboAreaNameSearchText(area) {
  return unique([
    area.name,
    ...(area.queryIds || []),
    ...(area.schemaIds || []),
    ...(area.gridIds || []),
    ...(area.pluginIds || []),
    ...(area.fields || []),
    ...(area.zoralCalls || []).map((call) => call.workflow),
    ...(area.actions || []).flatMap((action) => [
      action.name,
      action.label,
      action.type,
      action.operationType,
      action.eventType,
      ...(action.queryRefs || []),
      ...(action.pluginRefs || []),
      ...(action.zoralCalls || []).map((call) => call.workflow),
      ...(action.fields || []),
      ...(action.dbOperations || []).flatMap((op) => [
        op.table,
        op.rawTable,
        op.operation,
        op.operationName,
      ]),
      ...(action.navigationTargets || []).flatMap((target) => [
        target.route,
        target.targetArea,
        target.condition,
      ]),
    ]),
    ...(area.graphqlOperations || []).flatMap((op) => [
      op.table,
      op.rawTable,
      op.operation,
      op.operationName,
      op.nodeId,
    ]),
    ...(area.tableTraces || []).flatMap((entry) => [
      entry.table,
      ...(entry.traces || []).flatMap((trace) => [
        trace.operation,
        trace.source,
        trace.query,
        ...(trace.zoralWorkflows || []),
      ]),
    ]),
    ...(area.fieldMappings || []).flatMap((mapping) => [
      mapping.zboField,
      mapping.graphqlVariable,
      mapping.zoralInputField,
    ]),
    ...(area.outboundPages || []).flatMap((target) => [
      target.route,
      target.targetArea,
      target.condition,
    ]),
    ...(area.inboundPages || []).flatMap((inbound) => [
      inbound.area,
      inbound.route,
      inbound.condition,
    ]),
  ]).join(" ");
}

function workflowMatchesScope(workflow, query) {
  if (!query) return true;
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;
  if (state.searchMode === "exact") {
    if (state.searchScope === "workflow" || state.searchScope === "all" || state.searchScope === "zbo") {
      return (workflow._exactSearchCandidates || []).includes(normalizedQuery);
    }
  }

  if (state.searchScope === "all") {
    return (
      (workflow._normalizedNameSearchText || "").includes(normalizedQuery) ||
      (workflow._normalizedZboSearchText || "").includes(normalizedQuery)
    );
  }

  if (state.searchScope === "workflow") {
    return (
      matches(workflow.name, query) ||
      matches(workflow.description, query)
    );
  }

  if (state.searchScope === "zbo") {
    return (workflow._normalizedZboSearchText || "").includes(normalizedQuery);
  }

  if (state.searchScope === "field") {
    const fieldMatch = workflow.fieldRefs.some((field) => matches(field, query));
    if (fieldMatch) return true;
    return workflow.dbOperations.some((op) => (op.columns || []).some((col) => matches(col, query)));
  }

  if (state.searchScope === "code") {
    return workflow.nodes.some((node) => {
      return (
        matches(node.inputScript || "", query) ||
        matches(node.outputScript || "", query) ||
        matches(node.conditionScript || "", query)
      );
    });
  }

  if (state.searchScope === "table") {
    return workflow.dbOperations.some((op) => matches(op.table, query));
  }

  if (state.searchScope === "graphql") {
    return workflow.graphqlOperations.some((op) => {
      return (
        matches(op.table, query) ||
        matches(op.operation, query) ||
        matches(op.operationName, query)
      );
    });
  }

  if (state.searchScope === "parameter") {
    const workflowText = `${workflow.name} ${workflow.nodes
      .filter((node) => node.type === "parametersTable")
      .map((node) => `${node.id} ${node.callName}`)
      .join(" ")}`;
    if (matches(workflowText, query)) return true;
    return state.parameters.some((param) => {
      return (
        matches(param.name, query) &&
        workflow.nodes.some((node) => node.callName === param.name)
      );
    });
  }

  return (workflow._normalizedNameSearchText || "").includes(normalizedQuery);
}

function getFilteredWorkflows() {
  return state.workflows.filter((workflow) => {
    return workflowMatchesScope(workflow, state.query) && workflowMatchesOperationFilter(workflow);
  });
}

function workflowMatchesOperationFilter(workflow) {
  if (!state.matchOps.length) return true;
  return getSearchMatchedOperations(workflow).some((op) =>
    state.matchOps.includes(normalizeOperation(op.operation)),
  );
}

function shouldConstrainTableUsageByQuery() {
  return Boolean(state.query && (state.searchScope === "table" || state.searchScope === "graphql"));
}

function operationMatchesSelectedFilter(op) {
  return !state.matchOps.length || state.matchOps.includes(normalizeOperation(op.operation));
}

function operationMatchesTableQuery(op) {
  if (!shouldConstrainTableUsageByQuery()) return true;
  return matches(op.table, state.query) || matches(op.operationName, state.query);
}

function tableTraceMatchesSelectedFilter(entry) {
  return (
    !state.matchOps.length ||
    (entry.traces || []).some((trace) =>
      state.matchOps.includes(normalizeOperation(trace.operation)),
    )
  );
}

function tableTraceMatchesTableQuery(entry) {
  if (!shouldConstrainTableUsageByQuery()) return true;
  return matches(entry.table, state.query);
}

function renderResults() {
  if (state.activeMode === "database") {
    renderDatabaseResults();
    return;
  }
  if (state.activeMode === "zbo") {
    renderZboResults();
    return;
  }

  const filtered = getFilteredWorkflows();
  const workflows = filtered.slice(0, 400);
  els.resultCount.textContent =
    filtered.length > workflows.length
      ? `${workflows.length}/${filtered.length}`
      : String(workflows.length);
  if (!filtered.length) {
    els.resultsList.innerHTML = renderNoResults();
    return;
  }
  els.resultsList.innerHTML =
    workflows.map(renderResultItem).join("") +
    (filtered.length > workflows.length
      ? `<div class="result-limit">Showing first ${workflows.length} matches. Narrow the search to see more.</div>`
      : "");

  els.resultsList.querySelectorAll("[data-workflow-name]").forEach((button) => {
    button.addEventListener("click", () => selectWorkflow(button.dataset.workflowName));
  });
}

function getFilteredZboAreas() {
  return state.zboAreas.filter(
    (area) => zboAreaMatchesScope(area, state.query) && zboAreaMatchesOperationFilter(area),
  );
}

function zboAreaMatchesOperationFilter(area) {
  if (!state.matchOps.length) return true;
  if (shouldConstrainTableUsageByQuery()) {
    return (
      (area.graphqlOperations || []).some(
        (op) => operationMatchesTableQuery(op) && operationMatchesSelectedFilter(op),
      ) ||
      (area.actions || []).some((action) =>
        (action.dbOperations || []).some(
          (op) => operationMatchesTableQuery(op) && operationMatchesSelectedFilter(op),
        ),
      ) ||
      (area.tableTraces || []).some(
        (entry) => tableTraceMatchesTableQuery(entry) && tableTraceMatchesSelectedFilter(entry),
      )
    );
  }
  return (
    (area.graphqlOperations || []).some((op) =>
      state.matchOps.includes(normalizeOperation(op.operation)),
    ) ||
    (area.actions || []).some((action) =>
      (action.dbOperations || []).some((op) =>
        state.matchOps.includes(normalizeOperation(op.operation)),
      ),
    ) ||
    (area.tableTraces || []).some((entry) =>
      (entry.traces || []).some((trace) =>
        state.matchOps.includes(normalizeOperation(trace.operation)),
      ),
    )
  );
}

function zboAreaMatchesScope(area, query) {
  if (!query) return true;
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;
  if (state.searchScope === "all") {
    return (area._normalizedNameSearchText || "").includes(normalizedQuery);
  }
  if (state.searchScope === "zbo") {
    return (area._normalizedZboText || "").includes(normalizedQuery);
  }
  if (state.searchScope === "workflow") {
    return (
      (area.zoralCalls || []).some((call) => matches(call.workflow, query)) ||
      (area.actions || []).some((action) =>
        (action.zoralCalls || []).some((call) => matches(call.workflow, query)),
      )
    );
  }
  if (state.searchScope === "field") {
    const fieldMatch = (area.fields || []).some((field) => matches(field, query));
    if (fieldMatch) return true;
    const gqlMatch = (area.graphqlOperations || []).some((op) => (op.columns || []).some((col) => matches(col, query)));
    if (gqlMatch) return true;
    return (area.actions || []).some((action) =>
      (action.dbOperations || []).some((op) => (op.columns || []).some((col) => matches(col, query)))
    );
  }

  if (state.searchScope === "code") {
    // UI/hardcoded text from schemas & grids (labels, placeholders, defaults,
    // options, validation, resolved i18n) — precomputed on the area.
    if (matches(area.uiText || "", query)) return true;
    const queryMatch = (area.queryIds || []).some((qid) => {
      const q = state.zboQueries.find((item) => item.id === qid);
      return q && matches(q.code || "", query);
    });
    if (queryMatch) return true;
    return (area.pluginIds || []).some((pid) => {
      const p = state.zboPlugins.find((item) => item.id === pid);
      return p && matches(p.code || "", query);
    });
  }
  if (state.searchScope === "table" || state.searchScope === "graphql") {
    return (
      (area.graphqlOperations || []).some(
        (op) =>
          matches(op.table, query) ||
          matches(op.operation, query) ||
          matches(op.operationName, query),
      ) ||
      (area.tableTraces || []).some(
        (entry) =>
          matches(entry.table, query),
      ) ||
      (area.actions || []).some((action) =>
        (action.dbOperations || []).some(
          (op) =>
            matches(op.table, query) ||
            matches(op.operation, query) ||
            matches(op.operationName, query),
        ),
      )
    );
  }
  if (state.searchScope === "parameter") {
    return (area.fieldMappings || []).some(
      (mapping) =>
        matches(mapping.graphqlVariable, query) || matches(mapping.zoralInputField, query),
    );
  }
  return (area._normalizedNameSearchText || "").includes(normalizedQuery);
}

function renderZboResults() {
  const filtered = getFilteredZboAreas();
  const areas = filtered.slice(0, 400);
  els.resultCount.textContent =
    filtered.length > areas.length ? `${areas.length}/${filtered.length}` : String(areas.length);
  if (!filtered.length) {
    els.resultsList.innerHTML = renderNoResults();
    return;
  }
  els.resultsList.innerHTML =
    areas.map(renderZboResultItem).join("") +
    (filtered.length > areas.length
      ? `<div class="result-limit">Showing first ${areas.length} matches. Narrow the search to see more.</div>`
      : "");

  els.resultsList.querySelectorAll("[data-zbo-area]").forEach((button) => {
    button.addEventListener("click", () => selectZboArea(button.dataset.zboArea));
  });
}

function renderNoResults() {
  const query = state.query || "(empty)";
  const scope = els.searchScope?.selectedOptions?.[0]?.textContent || state.searchScope;
  return `
    <div class="result-empty">
      <strong>No results found</strong>
      <span>${escapeHtml(query)} in ${escapeHtml(scope)}</span>
    </div>
  `;
}

function renderZboResultItem(area) {
  const isActive = state.selectedZboArea?.name === area.name;
  const zoralCount = area.zoralCalls?.length || 0;
  const dbCount = area.graphqlOperations?.length || 0;
  const actionCount = area.actions?.length || 0;
  return `
    <button class="result-item ${isActive ? "active" : ""}" type="button" data-zbo-area="${escapeAttr(area.name)}">
      <div class="result-title">
        <span>${escapeHtml(area.name)}</span>
      </div>
      <div class="result-meta">
        <span class="badge">${area.queryIds.length} queries</span>
        <span class="badge">${area.schemaIds.length} schemas</span>
        <span class="badge">${area.gridIds.length} grids</span>
        ${actionCount ? `<span class="badge">${actionCount} actions</span>` : ""}
        ${zoralCount ? `<span class="badge success">${zoralCount} Zoral calls</span>` : ""}
        ${dbCount ? `<span class="badge accent">${dbCount} DB/GQL</span>` : ""}
      </div>
      ${renderZboResultDbOps(area)}
    </button>
  `;
}

function renderZboResultDbOps(area) {
  const entries = (area.tableTraces || [])
    .map((entry) => ({
      table: entry.table,
      traces: entry.traces || [],
    }))
    .filter(
      (entry) =>
        entry.traces.length &&
        tableTraceMatchesTableQuery(entry) &&
        tableTraceMatchesSelectedFilter(entry),
    )
    .sort((left, right) => left.table.localeCompare(right.table));
  if (!entries.length) return "";
  return `
    <div class="result-db-ops">
      <span class="result-db-caption">Table Usage</span>
      ${entries
        .map(
          (entry) => `
            <div class="result-db-row">
              <span class="db-op-table">${escapeHtml(entry.table)}</span>
              ${unique(entry.traces.map((trace) => normalizeOperation(trace.operation)))
                .map(
                  (op) =>
                    `<span class="db-op op-${escapeAttr(op)}">${escapeHtml(capitalizeWord(op))}</span>`,
                )
                .join("")}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderResultItem(workflow) {
  const isActive = state.selectedWorkflow?.name === workflow.name;
  const nodeCount = workflow.nodes.length;
  const dbCount = workflow.dbOperations.length;
  const inboundCount = workflow.inboundCallers.length;
  return `
    <button class="result-item ${isActive ? "active" : ""}" type="button" data-workflow-name="${escapeAttr(workflow.name)}">
      <div class="result-title">
        <span>${escapeHtml(workflow.name)}</span>
      </div>
      <div class="result-meta">
        <span class="badge">${escapeHtml(workflow.type || "unknown")}</span>
        <span class="badge">${nodeCount} nodes</span>
        ${dbCount ? `<span class="badge accent">${dbCount} DB/GQL</span>` : ""}
        ${inboundCount ? `<span class="badge success">${inboundCount} inbound</span>` : ""}
        ${workflow.parseWarning ? `<span class="badge warning">limited</span>` : ""}
      </div>
      ${renderResultDbOps(workflow)}
    </button>
  `;
}

function getSearchMatchedOperations(workflow) {
  const ops = workflow.dbOperations || [];
  if (!state.query) return ops;
  if (!["table", "all", "graphql"].includes(state.searchScope)) return ops;
  const matchedOps = ops.filter((op) => {
    if (!op.table) return false;
    return (
      matches(op.table, state.query) ||
      matches(op.operation, state.query) ||
      matches(op.operationName, state.query)
    );
  });
  return matchedOps;
}

function getMatchedTableOps(workflow) {
  const byTable = new Map();
  const matchedTables = new Set();
  for (const op of workflow.dbOperations || []) {
    if (!op.table) continue;
    const normalized = normalizeOperation(op.operation);
    const operations = byTable.get(op.table) || new Set();
    operations.add(normalized);
    byTable.set(op.table, operations);
    if (operationMatchesTableQuery(op) && operationMatchesSelectedFilter(op)) {
      matchedTables.add(op.table);
    }
  }
  return [...byTable.entries()]
    .filter(([table]) => {
      if (!state.matchOps.length && !shouldConstrainTableUsageByQuery()) return true;
      return matchedTables.has(table);
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, operations]) => ({
      table,
      operations: [...operations].sort(),
    }));
}

function normalizeOperation(value) {
  return String(value || "").toLowerCase();
}

function renderResultDbOps(workflow) {
  const entries = getMatchedTableOps(workflow);
  if (!entries.length) return "";
  const rows = entries
    .map(
      (entry) => `
        <div class="result-db-row">
          <span class="db-op-table">${escapeHtml(entry.table)}</span>
          ${entry.operations
            .map(
              (op) =>
                `<span class="db-op op-${escapeAttr(op)}">${escapeHtml(capitalizeWord(op))}</span>`,
            )
            .join("")}
        </div>
      `,
    )
    .join("");
  return `
    <div class="result-db-ops">
      <span class="result-db-caption">Table Usage</span>
      ${rows}
    </div>
  `;
}

function capitalizeWord(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function areaHasArtifactCodeMatch(area) {
  if (state.searchScope !== "code" || !state.query) return false;
  const inList = (ids, arr) =>
    (ids || []).some((id) => {
      const a = arr.find((x) => x.id === id);
      return a && matches(a.code || "", state.query);
    });
  return (
    inList(area.queryIds, state.zboQueries) ||
    inList(area.pluginIds, state.zboPlugins) ||
    inList(area.schemaIds, state.zboSchemas) ||
    inList(area.gridIds, state.zboGrids)
  );
}

function selectZboArea(name, options = {}) {
  const area = state.zboAreas.find((item) => item.name === name);
  if (!area) return;
  state.activeMode = "zbo";
  state.selectedZboArea = area;
  state.selectedNodeId = null;
  state.selectedEdge = null;
  state.selectedZboNodeId = null;
  state.selectedZboEdge = null;
  // On a code search, land on the Artifacts tab so the matched + highlighted
  // source is shown immediately instead of the Overview tab.
  const codeMatchTab = areaHasArtifactCodeMatch(area) ? "node" : "overview";
  state.activeTab = options.restore ? state.activeTab || "overview" : codeMatchTab;
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  applyModeState();
  els.workflowTitle.textContent = area.name;
  els.workflowSubtitle.textContent = `${area.queryIds.length} queries - ${area.schemaIds.length} schemas - ${area.gridIds.length} grids`;
  saveState();
  renderResults();
  renderZboMap(area);
  renderDetails();
  updatePageTitle();
}

function renderZboEmpty() {
  els.workflowTitle.textContent = "Select a ZBO area";
  els.workflowSubtitle.textContent = "Search or choose a backoffice area from the list.";
  els.diagramCanvas.innerHTML = `<div class="empty-state">No ZBO area selected</div>`;
  els.detailContent.innerHTML = renderEmpty("Select a ZBO area.");
}

function selectWorkflow(name, options = {}) {
  let workflow = state.workflows.find((item) => item.name === name);
  if (!workflow && name) {
    workflow = state.workflows.find((item) => item.name.toLowerCase() === name.toLowerCase());
  }
  if (!workflow) return;
  if (!options.keepHighlights) {
    state.liveHighlightedWorkflow = null;
    state.liveExecutedNodes = null;
  }
  state.activeMode = "zoral";
  const previousNodeId = state.selectedNodeId;
  const previousTab = state.activeTab;
  state.selectedWorkflow = workflow;
  state.selectedNodeId =
    options.restore && workflow.nodes.some((node) => node.id === previousNodeId)
      ? previousNodeId
      : null;
  state.activeTab = options.restore ? previousTab || "overview" : "overview";
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  applyModeState();
  els.workflowTitle.textContent = workflow.name;
  els.workflowSubtitle.textContent = "";
  saveState();
  renderResults();
  renderDiagram();
  renderDetails();
  updatePageTitle();
}

function selectNode(nodeId) {
  state.selectedNodeId = state.selectedNodeId === nodeId ? null : nodeId;
  state.selectedEdge = null;
  const isLiveHighlighted = state.liveHighlightedWorkflow && 
                            state.liveHighlightedWorkflow === state.selectedWorkflow?.name;
  state.activeTab = isLiveHighlighted ? "live-exec" : "node";
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  saveState();
  renderDiagram();
  renderDetails();
}

function selectEdge(from, to) {
  const isSame = state.selectedEdge && state.selectedEdge.from === from && state.selectedEdge.to === to;
  state.selectedEdge = isSame ? null : { from, to };
  state.selectedNodeId = null;
  const isLiveHighlighted = state.liveHighlightedWorkflow && 
                            state.liveHighlightedWorkflow === state.selectedWorkflow?.name;
  state.activeTab = isLiveHighlighted ? "live-exec" : "node";
  document
    .querySelectorAll("[data-tab]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tab === state.activeTab));
  saveState();
  renderDiagram();
  renderDetails();
}

function selectDatabaseDiagramEdge(from, to) {
  const isSame = state.selectedEdge && state.selectedEdge.from === from && state.selectedEdge.to === to;
  state.selectedEdge = isSame ? null : { from, to };
  state.selectedNodeId = null;
  saveState();
  renderDatabaseDiagram();
  renderDatabaseDetails();
}

function isNodeHighlighted(nodeId) {
  if (state.selectedNodeId === nodeId) return true;
  if (state.selectedEdge && (state.selectedEdge.from === nodeId || state.selectedEdge.to === nodeId)) {
    return true;
  }
  return false;
}

function renderActiveDiagram() {
  if (state.activeMode === "database") {
    renderDatabaseDiagram();
    return;
  }
  if (state.activeMode === "zbo") {
    if (state.selectedZboArea) renderZboMap(state.selectedZboArea);
    else renderZboEmpty();
    return;
  }
  renderDiagram();
}

function renderDiagram() {
  const workflow = state.selectedWorkflow;
  if (!workflow || !workflow.nodes.length) {
    els.diagramCanvas.innerHTML = `<div class="empty-state">No diagram data</div>`;
    return;
  }

  if (state.liveHighlightedWorkflow === workflow.name) {
    els.workflowSubtitle.innerHTML = `
      <div class="path-highlight-banner">
        <span>Showing execution path highlights from Live API trace.</span>
        <button onclick="window.clearLiveHighlights()">Clear Highlights ✕</button>
      </div>
    `;
  } else {
    els.workflowSubtitle.textContent = "Search or choose a Zoral workflow from the list.";
  }

  delete workflow._nodeSpacingOffsets;
  let displayNodes = [...workflow.nodes];
  let displayEdges = [...workflow.edges];

  if (state.showZboCallersZoral) {
    const directZboCallers = (workflow.inboundZbo || []).filter((caller) => caller.via === "workflow");
    if (directZboCallers.length > 0) {
      let startNode = displayNodes.find(n => n.type === "startEvent" || n.type === "start/message" || n.id.toLowerCase().includes("start"));
      if (!startNode && displayNodes.length > 0) startNode = displayNodes[0];
      if (startNode) {
        const startPosition = scaledPosition(startNode);
        directZboCallers.forEach((caller, i) => {
          const callerId = `zbo_caller_${i}`;
          const callerX = startPosition.x - 260;
          const callerY = startPosition.y + (i * 92) - ((directZboCallers.length - 1) * 46);
          displayNodes.push({
            id: callerId,
            type: "zbo-caller",
            name: caller.area,
            callName: caller.area,
            x: callerX,
            y: callerY,
            position: { x: callerX / SPACING_X, y: callerY / SPACING_Y },
            width: 152,
            height: 76
          });
          displayEdges.push({
            from: callerId,
            to: startNode.id,
            label: "ZBO caller",
            kind: "zbo-caller",
            fromSide: "right",
            toSide: "left",
            isZboCaller: true
          });
        });
      }
    }
  }

  const nodeById = new Map(displayNodes.map((node) => [node.id, node]));
  const routedEdges = buildRoutedEdges({ edges: displayEdges }, nodeById);
  const bounds = getDiagramBounds(displayNodes, routedEdges);
  const padding = 150;
  const width = Math.max(900, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(560, bounds.maxY - bounds.minY + padding * 2);
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;

  const dbOpsByNode = workflow.dbOperations.reduce((acc, op) => {
    const ops = acc.get(op.nodeId) || [];
    ops.push(op);
    acc.set(op.nodeId, ops);
    return acc;
  }, new Map());
  const edgeParts = routedEdges.map((routed, index) =>
    renderEdge(routed, offsetX, offsetY, state.selectedNodeId, index),
  );
  const edges = edgeParts.map((part) => part.edge).join("");
  const edgeOverlays = edgeParts.map((part) => part.overlay).join("");
  const edgeLabels = edgeParts.map((part) => part.label).join("");
  const nodes = displayNodes
    .map((node) =>
      renderNode(
        node,
        offsetX,
        offsetY,
        isNodeHighlighted(node.id),
        state.showDbBadges ? dbOpsByNode.get(node.id) || [] : [],
      ),
    )
    .join("");

  els.diagramCanvas.innerHTML = `
    <svg class="diagram-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
      <defs>
        <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto" markerUnits="strokeWidth" overflow="visible">
          <path d="M0,0 L0,8 L10,4 z" fill="#8090a0"></path>
        </marker>
      </defs>
      <g>${edges}</g>
      <g>${nodes}</g>
      <g class="edge-overlay-layer">${edgeOverlays}</g>
      <g class="edge-label-layer">${edgeLabels}</g>
    </svg>
  `;
  applyDiagramDragState();
  // Cache the rendered center of every Zoral node so the drag handler can
  // read pre-drag coords without re-running scaledPosition/getDiagramBounds.
  els.diagramCanvas._zoralNodeCenters = new Map(
    displayNodes.map((node) => [node.id, nodeCenter(node, offsetX, offsetY)]),
  );
  els.diagramCanvas._zoralOffsetX = offsetX;
  els.diagramCanvas._zoralOffsetY = offsetY;

  els.diagramCanvas.querySelectorAll("[data-node-id]").forEach((nodeEl) => {
    nodeEl.addEventListener("click", () => selectNode(nodeEl.dataset.nodeId));
    if (state.enableNodeDrag) attachZoralNodeDrag(nodeEl, workflow);
  });

  els.diagramCanvas.querySelectorAll("[data-edge-from]").forEach((edgeEl) => {
    edgeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEdge(edgeEl.dataset.edgeFrom, edgeEl.dataset.edgeTo);
    });
  });

  applyZoom();
}

function renderZboMap(area) {
  const diagram = buildZboFlowDiagram(area);
  els.diagramCanvas.innerHTML = `
    <svg class="diagram-svg zbo-flow-svg" width="${diagram.width}" height="${diagram.height}" viewBox="0 0 ${diagram.width} ${diagram.height}" role="img">
      <defs>
        <marker id="zboArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#8090a0"></path>
        </marker>
      </defs>
      <g>${diagram.edges.map(renderZboFlowEdge).join("")}</g>
      <g>${diagram.nodes.map(renderZboFlowNode).join("")}</g>
    </svg>
  `;
  applyDiagramDragState();
  // Cache the most recent computed positions so the drag handler can read a
  // node's pre-drag x/y without re-running buildZboFlowDiagram on every move.
  els.diagramCanvas._zboDiagramNodes = new Map(diagram.nodes.map((node) => [node.id, node]));

  els.diagramCanvas.querySelectorAll("[data-node-id]").forEach((nodeEl) => {
    nodeEl.addEventListener("click", () => selectZboNode(nodeEl.dataset.nodeId));
    if (state.enableNodeDrag) attachZboNodeDrag(nodeEl, area);
  });
  els.diagramCanvas.querySelectorAll("[data-edge-from]").forEach((edgeEl) => {
    edgeEl.addEventListener("click", (event) => {
      event.stopPropagation();
      selectZboEdge(edgeEl.dataset.edgeFrom, edgeEl.dataset.edgeTo);
    });
  });

  applyZoom();
}

function selectZboNode(nodeId) {
  state.selectedZboNodeId = state.selectedZboNodeId === nodeId ? null : nodeId;
  state.selectedZboEdge = null;
  if (state.selectedZboNodeId) {
    state.activeTab = "node";
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === "node");
    });
  }
  if (state.selectedZboArea) renderZboMap(state.selectedZboArea);
  renderDetails();
  saveState();
}

function selectZboEdge(from, to) {
  const same =
    state.selectedZboEdge &&
    state.selectedZboEdge.from === from &&
    state.selectedZboEdge.to === to;
  state.selectedZboEdge = same ? null : { from, to };
  state.selectedZboNodeId = null;
  if (state.selectedZboEdge) {
    state.activeTab = "node";
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === "node");
    });
  }
  if (state.selectedZboArea) renderZboMap(state.selectedZboArea);
  renderDetails();
  saveState();
}

function isZboNodeHighlighted(nodeId) {
  if (state.selectedZboNodeId === nodeId) return true;
  if (
    state.selectedZboEdge &&
    (state.selectedZboEdge.from === nodeId || state.selectedZboEdge.to === nodeId)
  ) {
    return true;
  }
  return false;
}

// Phase 2.3: Zoral-style sequential flow. Instead of a fixed column matrix that
// renders every action/query/workflow/table, build a directed flow:
//   start -> trigger (onLoad / user action) -> API (GraphQL or Zoral workflow)
//   -> condition (BRE) -> navigate. Only actions that actually call an API or
// navigate are kept; DB usage is shown as a cylinder badge on each node.
function buildZboFlowDiagram(area) {
  const layerX = { start: 120, trigger: 390, api: 740, condition: 1080, navigate: 1410 };
  const rowGap = 122;
  const startY = 96;
  const nodes = [];
  const edges = [];
  const rowCursor = { start: 0, trigger: 0, api: 0, condition: 0, navigate: 0 };
  // Stagger the condition layer half a row down so condition diamonds sit
  // between trigger rows. A direct trigger->navigate edge in row N runs at
  // y = startY + N*rowGap; without this offset, a condition node at the same
  // row would sit on top of that edge.
  const layerYOffset = { start: 0, trigger: 0, api: 0, condition: rowGap / 2, navigate: 0 };
  const place = (layer) => {
    const y = startY + rowCursor[layer] * rowGap + (layerYOffset[layer] || 0);
    rowCursor[layer] += 1;
    return y;
  };

  const queriesById = new Map(getAreaQueries(area).map((query) => [query.id, query]));
  const workflowByName = new Map(state.workflows.map((workflow) => [workflow.name, workflow]));
  const workflowByLower = new Map(
    state.workflows.map((workflow) => [workflow.name.toLowerCase(), workflow]),
  );
  const resolveWorkflow = (name) => {
    const text = String(name || "").trim();
    if (!text || /[{}]/.test(text)) return null;
    return workflowByName.get(text) || workflowByLower.get(text.toLowerCase()) || null;
  };
  const dbOpsForWorkflow = (name) => resolveWorkflow(name)?.dbOperations || [];

  // De-dup maps so a workflow/query/table/screen shared by several actions
  // becomes one node with converging edges instead of repeating.
  const gqlNodes = new Map();
  const wfNodes = new Map();
  const condNodes = new Map();
  const navNodes = new Map();

  const startId = "start";
  nodes.push({
    id: startId,
    kind: "start",
    label: "Start",
    subtitle: area.name,
    x: layerX.start,
    y: place("start") + 26,
  });

  const ensureGql = (queryId) => {
    if (gqlNodes.has(queryId)) return gqlNodes.get(queryId);
    const query = queriesById.get(queryId);
    const id = `gql-${gqlNodes.size}`;
    gqlNodes.set(queryId, id);
    nodes.push({
      id,
      kind: "gql",
      label: queryId,
      subtitle: query?.operationType ? `GraphQL ${query.operationType}` : "GraphQL",
      dbOps: query?.dbOperations || [],
      x: layerX.api,
      y: place("api"),
    });
    return id;
  };
  const ensureWorkflow = (name) => {
    if (wfNodes.has(name)) return wfNodes.get(name);
    const id = `wf-${wfNodes.size}`;
    wfNodes.set(name, id);
    nodes.push({
      id,
      kind: "workflow",
      label: name,
      subtitle: "Zoral API",
      workflowName: resolveWorkflow(name)?.name || null,
      dbOps: dbOpsForWorkflow(name),
      x: layerX.api,
      y: place("api"),
    });
    return id;
  };
  const ensureCondition = (name) => {
    if (condNodes.has(name)) return condNodes.get(name);
    const id = `cond-${condNodes.size}`;
    condNodes.set(name, id);
    nodes.push({
      id,
      kind: "condition",
      label: name,
      workflowName: resolveWorkflow(name)?.name || null,
      dbOps: dbOpsForWorkflow(name),
      x: layerX.condition,
      y: place("condition"),
    });
    return id;
  };
  const navKeyOf = (target) => `nav:${target.route}:${target.condition || ""}`;
  const ensureNav = (target) => {
    const key = navKeyOf(target);
    if (navNodes.has(key)) return navNodes.get(key);
    const id = `nav-${navNodes.size}`;
    navNodes.set(key, id);
    nodes.push({
      id,
      kind: "navigate",
      label: target.targetArea || target.route,
      subtitle: target.route,
      x: layerX.navigate,
      y: place("navigate"),
    });
    return id;
  };
  const navLabel = (condition) =>
    condition ? (/^else$/i.test(condition) ? "Else" : `If ${condition}`) : "navigate";

  const ownedWorkflows = new Set();
  const ownedQueries = new Set();
  const ownedNavKeys = new Set();

  // Collapse actions whose user-visible behavior is identical (same label,
  // event, queries, zoral calls, navigation targets, DB ops). Areas like
  // GlobalSearch otherwise produce many duplicate "open -> Global_Search"
  // triggers because each repeats the same button across rows of a grid.
  const actionGroups = groupZboActionsByTriggerIdentity(
    sortZboActions((area.actions || []).filter(isMeaningfulZboAction)),
  ).slice(0, 30);
  actionGroups.forEach((group, index) => {
    const triggerId = `trigger-${index}`;
    const representative = group[0];
    const event = displayActionEvent(representative.eventType) || representative.type;
    const groupDbOps = uniqueBy(
      group.flatMap((member) => member.dbOperations || []),
      (op) => `${op.table}:${String(op.operation || "").toLowerCase()}`,
    );
    nodes.push({
      id: triggerId,
      kind: "trigger",
      label: displayZboActionLabel(representative),
      subtitle: event,
      eventType: representative.eventType,
      userTriggered: representative.userTriggered,
      dbOps: groupDbOps,
      x: layerX.trigger,
      y: place("trigger"),
    });
    edges.push({ from: startId, to: triggerId, label: event, kind: "trigger" });

    // Emit each action's outgoing edges underneath the shared trigger.
    // ensureGql/Workflow/Condition/Nav dedupe by name/key so shared destinations
    // across actions still merge into one downstream node — preserving the
    // branching structure when one trigger fans out to different targets.
    for (const action of group) {
      const wfCalls = (action.zoralCalls || []).filter((call) => call.kind !== "condition");
      const condCalls = (action.zoralCalls || []).filter((call) => call.kind === "condition");

      const wfIds = [];
      for (const queryRef of action.queryRefs || []) {
        ownedQueries.add(queryRef);
        const id = ensureGql(queryRef);
        edges.push({ from: triggerId, to: id, label: "query", kind: "api" });
      }
      for (const call of wfCalls) {
        ownedWorkflows.add(call.workflow);
        const id = ensureWorkflow(call.workflow);
        wfIds.push(id);
        edges.push({ from: triggerId, to: id, label: "call", kind: "api" });
      }

      const condIds = [];
      const condSources = wfIds.length ? wfIds : [triggerId];
      for (const call of condCalls) {
        ownedWorkflows.add(call.workflow);
        const id = ensureCondition(call.workflow);
        condIds.push(id);
        for (const source of condSources) {
          edges.push({ from: source, to: id, label: "", kind: "condition-in" });
        }
      }

      const navSources = condIds.length ? condIds : wfIds.length ? wfIds : [triggerId];
      for (const target of action.navigationTargets || []) {
        ownedNavKeys.add(navKeyOf(target));
        const id = ensureNav(target);
        for (const source of navSources) {
          edges.push({ from: source, to: id, label: navLabel(target.condition), kind: "navigate" });
        }
      }
    }
  });

  // Synthetic page-load trigger for area-level data fetches / navigation that
  // are not tied to a specific indexed action, so the "onLoad -> API" story
  // still shows up for pages whose init logic lives outside parsed actions.
  const orphanQueries = getAreaQueries(area).filter((query) => !ownedQueries.has(query.id));
  const orphanZoral = (area.zoralCalls || []).filter((call) => !ownedWorkflows.has(call.workflow));
  const orphanNavs = (area.outboundPages || []).filter((target) => !ownedNavKeys.has(navKeyOf(target)));
  if (orphanQueries.length || orphanZoral.length || orphanNavs.length) {
    const pageId = "page-load";
    nodes.push({
      id: pageId,
      kind: "trigger",
      label: "Page load",
      subtitle: "onLoad",
      eventType: "load",
      userTriggered: false,
      x: layerX.trigger,
      y: place("trigger"),
    });
    edges.push({ from: startId, to: pageId, label: "onLoad", kind: "trigger" });
    for (const query of orphanQueries.slice(0, 12)) {
      const id = ensureGql(query.id);
      edges.push({ from: pageId, to: id, label: "query", kind: "api" });
    }
    for (const call of orphanZoral.slice(0, 12)) {
      if (call.kind === "condition") {
        const id = ensureCondition(call.workflow);
        edges.push({ from: pageId, to: id, label: "", kind: "condition-in" });
      } else {
        const id = ensureWorkflow(call.workflow);
        edges.push({ from: pageId, to: id, label: "call", kind: "api" });
      }
    }
    for (const target of orphanNavs.slice(0, 12)) {
      const id = ensureNav(target);
      edges.push({ from: pageId, to: id, label: navLabel(target.condition), kind: "navigate" });
    }
  }

  // Apply user drag overrides BEFORE smart placement so the smart pass reads
  // the trigger's final Y (e.g. a trigger the user has dragged). Smart
  // placement then skips any node the user has manually positioned, leaving
  // user choices intact.
  const overridesEarly = (state.nodePositions?.zbo || {})[area.name] || {};
  for (const node of nodes) {
    const override = overridesEarly[node.id];
    if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
      node.x = override.x;
      node.y = override.y;
    }
  }

  // Smart placement pass: pull a navigate node up to the same row as its
  // source trigger when there's no condition/workflow gate between them. That
  // turns a long diagonal edge (which crosses the condition column and any
  // diamonds living there) into a short horizontal line. If the trigger has
  // several direct nav targets, stagger them around the trigger's row.
  // Predecessor sets per node, deduped: the trigger-group loop emits the same
  // (trigger -> nav) edge once per member action, so the raw edges array can
  // list a trigger multiple times for the same nav. Dedup here so the
  // one-predecessor fast path runs when the trigger really is the only source.
  const predMap = new Map();
  for (const edge of edges) {
    if (!predMap.has(edge.to)) predMap.set(edge.to, new Set());
    predMap.get(edge.to).add(edge.from);
  }
  const nodeById2 = new Map(nodes.map((node) => [node.id, node]));
  const navsByTrigger = new Map();
  const navsKeepInColumn = [];
  for (const node of nodes) {
    if (node.kind !== "navigate") continue;
    // Respect user drag: if this nav has its own position override, leave it
    // alone. Smart placement only runs on auto-placed nav nodes.
    if (overridesEarly[node.id]) continue;
    const preds = [...(predMap.get(node.id) || [])]
      .map((id) => nodeById2.get(id))
      .filter(Boolean);
    if (!preds.length) continue;
    const allTrigger = preds.every((p) => p.kind === "trigger");
    if (!allTrigger) continue;
    if (preds.length === 1) {
      const trigId = preds[0].id;
      if (!navsByTrigger.has(trigId)) navsByTrigger.set(trigId, []);
      navsByTrigger.get(trigId).push(node);
    } else {
      navsKeepInColumn.push({ node, preds });
    }
  }
  // After Y-align, also try to pull the nav LEFT toward the trigger if a
  // closer column is free at the new Y. Empty cells next to the trigger let
  // us replace a canvas-wide diagonal with a stubby horizontal line.
  const tryColumns = [layerX.api, layerX.condition];
  // Use a 52px Y-clearance so the 64px sibling stagger below doesn't false-
  // positive itself as a collision (each pair of siblings sits 64px apart;
  // collision detection at 52px still blocks anything visually overlapping a
  // node body of height ~56px).
  const isCellFree = (skipNode, x, y) =>
    !nodes.some(
      (other) =>
        other !== skipNode &&
        other.kind !== "start" &&
        Math.abs(other.x - x) < 1 &&
        Math.abs(other.y - y) < 52,
    );
  for (const [, navs] of navsByTrigger) {
    const trigger = nodeById2.get([...(predMap.get(navs[0].id) || [])][0]);
    if (!trigger) continue;
    if (navs.length === 1) {
      const nav = navs[0];
      nav.y = trigger.y;
      const nearestFreeX = tryColumns.find((x) => isCellFree(nav, x, nav.y));
      if (nearestFreeX) nav.x = nearestFreeX;
    } else {
      const offset = 64;
      navs.forEach((nav, index) => {
        nav.y = trigger.y + (index - (navs.length - 1) / 2) * offset;
        const nearestFreeX = tryColumns.find((x) => isCellFree(nav, x, nav.y));
        if (nearestFreeX) nav.x = nearestFreeX;
      });
    }
  }
  // Multiple triggers converging on one nav: place at average Y so the
  // incoming lines distribute symmetrically around the target.
  for (const { node, preds } of navsKeepInColumn) {
    node.y = preds.reduce((sum, p) => sum + p.y, 0) / preds.length;
  }

  // (User overrides were applied earlier — before smart placement — so the
  // smart pass could read the trigger's final Y and stagger navs around it.)

  // Fan-out: edges that share the same from-node would otherwise stack their
  // vertical mid-segments on top of each other, hiding labels. Give each edge
  // its own vertical lane (offset midX) and stagger label Y so they don't
  // collide. Sorting by target Y minimizes crossings.
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const dedupedEdges = uniqueBy(edges, (edge) => `${edge.from}:${edge.to}:${edge.label}`);
  const byFrom = new Map();
  for (const edge of dedupedEdges) {
    const list = byFrom.get(edge.from) || [];
    list.push(edge);
    byFrom.set(edge.from, list);
  }
  // Sort fan-out edges by the absolute vertical distance to their target,
  // longest first. Longest-haul edges get the innermost lane (smallest midX,
  // closest to the source), so they turn early and drop down on the far side
  // of any shorter-haul edges. Shorter-haul edges sit on outer lanes near the
  // target column, so their tiny vertical hops never need to cross a long
  // vertical segment of another edge. Without this, the topmost target
  // (closest to source) was getting the innermost lane and every edge to a
  // farther target had to cross its short horizontal entry segment.
  const laneAssignments = new Map();
  for (const [, list] of byFrom) {
    const fromY = nodeById.get(list[0].from)?.y ?? 0;
    list.sort((a, b) => {
      const distA = Math.abs((nodeById.get(a.to)?.y ?? 0) - fromY);
      const distB = Math.abs((nodeById.get(b.to)?.y ?? 0) - fromY);
      return distB - distA;
    });
    list.forEach((edge, index) => {
      laneAssignments.set(edge, { lane: index, total: list.length });
    });
  }
  const LANE_PITCH = 18;
  const LANE_MARGIN = 18;
  const routedEdges = dedupedEdges
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return null;
      const sx = from.x + zboNodeHalfWidth(from.kind);
      const ex = to.x - zboNodeHalfWidth(to.kind);
      const sy = from.y;
      const ey = to.y;
      const { lane = 0, total = 1 } = laneAssignments.get(edge) || {};
      // Shrink pitch so all lanes stay inside the horizontal gap between the
      // source and the target columns. Without this, a fan-out of N edges
      // would spread (N-1)*18 px wide and push outer lanes past sx, drawing
      // vertical segments to the LEFT of the Start node.
      const available = Math.max(0, ex - sx - 2 * LANE_MARGIN);
      const pitch = total > 1 ? Math.min(LANE_PITCH, available / (total - 1)) : 0;
      const laneOffset = total > 1 ? (lane - (total - 1) / 2) * pitch : 0;
      const baseMid = (sx + ex) / 2;
      const midX = baseMid + laneOffset;
      // Sit the label on the target-side horizontal segment so each edge's
      // label has a unique Y (= target row), preventing the source-side stack.
      const labelX = Math.max(ex - 32, midX + 10);
      const labelY = ey - 7;
      return {
        ...edge,
        path: `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`,
        labelX,
        labelY,
      };
    })
    .filter(Boolean);

  const maxRow = Math.max(...Object.values(rowCursor), 1);
  const baseHeight = Math.max(560, startY + maxRow * rowGap + 70);
  const baseWidth = layerX.navigate + 320;
  // Expand canvas so dragged nodes don't get clipped.
  const maxX = nodes.reduce((m, node) => Math.max(m, node.x + 160), 0);
  const maxY = nodes.reduce((m, node) => Math.max(m, node.y + 80), 0);
  const width = Math.max(baseWidth, maxX);
  const height = Math.max(baseHeight, maxY);
  return { nodes, edges: routedEdges, width, height };
}

// Trigger identity = the part of an action that's visible on the trigger
// node itself (label + event + user-vs-system). Actions sharing an identity
// are the same button to the reader, even when each goes to a different
// page. They merge into ONE trigger; downstream divergence is preserved by
// emitting each action's edges underneath the shared trigger.
function zboActionTriggerIdentity(action) {
  return [
    displayZboActionLabel(action),
    String(action.eventType || action.type || "").toLowerCase(),
    action.userTriggered ? "u" : "s",
  ].join("||");
}

function groupZboActionsByTriggerIdentity(actions) {
  const groups = new Map();
  for (const action of actions) {
    const key = zboActionTriggerIdentity(action);
    const list = groups.get(key) || [];
    list.push(action);
    groups.set(key, list);
  }
  return [...groups.values()];
}

// Drag-to-reposition. The pointermove path applies a temporary SVG transform
// to the node group so it tracks the cursor smoothly without re-rendering the
// full diagram; on release we keep the new position in memory and re-render
// once so edges follow. The shared canvas pan/click-suppression
// flag (`suppressDiagramClick`) prevents the trailing click from selecting
// the node when the user was actually dragging it.
function attachZboNodeDrag(nodeEl, area) {
  const nodeId = nodeEl.dataset.nodeId;
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".zbo-edge-hit")) return;
    const startCursorX = event.clientX;
    const startCursorY = event.clientY;
    const diagramNode = (els.diagramCanvas._zboDiagramNodes || new Map()).get(nodeId);
    if (!diagramNode) return;
    const startNodeX = diagramNode.x;
    const startNodeY = diagramNode.y;
    let dragging = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let rafQueued = false;
    try {
      nodeEl.setPointerCapture(event.pointerId);
    } catch {
      /* not all node groups capture pointers cleanly */
    }
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startCursorX) / state.zoom;
      const dy = (moveEvent.clientY - startCursorY) / state.zoom;
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startCursorX, moveEvent.clientY - startCursorY) > 4
      ) {
        dragging = true;
        suppressDiagramClick = true;
        nodeEl.classList.add("dragging");
      }
      if (!dragging) return;
      pendingDx = dx;
      pendingDy = dy;
      if (!rafQueued) {
        rafQueued = true;
        requestAnimationFrame(() => {
          rafQueued = false;
          nodeEl.setAttribute("transform", `translate(${pendingDx}, ${pendingDy})`);
        });
      }
    };
    const onUp = () => {
      nodeEl.removeEventListener("pointermove", onMove);
      nodeEl.removeEventListener("pointerup", onUp);
      nodeEl.removeEventListener("pointercancel", onUp);
      try {
        nodeEl.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      nodeEl.classList.remove("dragging");
      if (!dragging) return;
      const finalX = startNodeX + pendingDx;
      const finalY = startNodeY + pendingDy;
      if (!state.nodePositions.zbo[area.name]) state.nodePositions.zbo[area.name] = {};
      state.nodePositions.zbo[area.name][nodeId] = { x: finalX, y: finalY };
      renderZboMap(area);
    };
    nodeEl.addEventListener("pointermove", onMove);
    nodeEl.addEventListener("pointerup", onUp);
    nodeEl.addEventListener("pointercancel", onUp);
  });
}

function attachZoralNodeDrag(nodeEl, workflow) {
  const nodeId = nodeEl.dataset.nodeId;
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".edge-hit")) return;
    const startCursorX = event.clientX;
    const startCursorY = event.clientY;
    const centers = els.diagramCanvas._zoralNodeCenters || new Map();
    const startCenter = centers.get(nodeId);
    if (!startCenter) return;
    let dragging = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let rafQueued = false;
    try {
      nodeEl.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startCursorX) / state.zoom;
      const dy = (moveEvent.clientY - startCursorY) / state.zoom;
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startCursorX, moveEvent.clientY - startCursorY) > 4
      ) {
        dragging = true;
        suppressDiagramClick = true;
        nodeEl.classList.add("dragging");
      }
      if (!dragging) return;
      pendingDx = dx;
      pendingDy = dy;
      if (!rafQueued) {
        rafQueued = true;
        requestAnimationFrame(() => {
          rafQueued = false;
          nodeEl.setAttribute("transform", `translate(${pendingDx}, ${pendingDy})`);
        });
      }
    };
    const onUp = () => {
      nodeEl.removeEventListener("pointermove", onMove);
      nodeEl.removeEventListener("pointerup", onUp);
      nodeEl.removeEventListener("pointercancel", onUp);
      try {
        nodeEl.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      nodeEl.classList.remove("dragging");
      if (!dragging) return;
      // Keep the scaled-canvas coordinates that the node actually sits at in
      // memory (so scaledPosition can return them verbatim during this page
      // session). Undo the diagram's auto-fit offset before storing it.
      const newCenterX = startCenter.x + pendingDx;
      const newCenterY = startCenter.y + pendingDy;
      // bounds — but renderDiagram recomputes them. To stay simple, store the
      const offX = Number(els.diagramCanvas._zoralOffsetX || 0);
      const offY = Number(els.diagramCanvas._zoralOffsetY || 0);
      if (!state.nodePositions.zoral[workflow.name]) state.nodePositions.zoral[workflow.name] = {};
      state.nodePositions.zoral[workflow.name][nodeId] = {
        x: newCenterX - offX,
        y: newCenterY - offY,
      };
      renderDiagram();
    };
    nodeEl.addEventListener("pointermove", onMove);
    nodeEl.addEventListener("pointerup", onUp);
    nodeEl.addEventListener("pointercancel", onUp);
  });
}

function isMeaningfulZboAction(action) {
  return Boolean(
    (action.queryRefs && action.queryRefs.length) ||
      (action.zoralCalls && action.zoralCalls.length) ||
      (action.navigationTargets && action.navigationTargets.length) ||
      (action.dbOperations && action.dbOperations.length),
  );
}

function zboNodeHalfWidth(kind) {
  if (kind === "start") return 48;
  if (kind === "condition") return 68;
  return 105;
}

function sortZboActions(actions) {
  const order = { load: 0, query: 1, change: 2, blur: 3, click: 4, submit: 5, action: 6 };
  return [...actions].sort((a, b) => {
    const left = order[a.eventType] ?? 10;
    const right = order[b.eventType] ?? 10;
    return left - right || (a.label || a.name || "").localeCompare(b.label || b.name || "");
  });
}

// When the action label is just "open" (uiSchema `operationType: "open"`),
// surface the first navigation target so the node tells the reader what is
// being opened. Prefers the target ZBO area name; falls back to the last
// non-template route segment, then to the raw route.
function displayZboActionLabel(action) {
  const raw = action.label || action.name || "";
  if (!/^open\b/i.test(raw)) return raw;
  const target = (action.navigationTargets || [])[0];
  if (!target) return raw;
  // Prefer the deepest non-template route segment (e.g. `audit_trail`,
  // `payment-schedule`, `create`) — it's the page being opened and reads more
  // specifically than the targetArea which can be the same for many buttons
  // (e.g. all GlobalSearch sub-pages share targetArea=Global_Search).
  const segments = (target.route || "")
    .split("/")
    .filter((part) => part && !/^[{]/.test(part));
  const hint = segments[segments.length - 1] || target.targetArea || target.route || "";
  return hint ? `open → ${hint}` : raw;
}

function displayActionEvent(eventType) {
  return (
    {
      load: "onLoad",
      query: "onLoad",
      click: "click",
      blur: "blur",
      change: "change",
      submit: "submit",
      open: "click",
    }[eventType] || eventType || ""
  );
}

function renderZboFlowNode(node) {
  if (node.kind === "start") return renderZboStartNode(node);
  if (node.kind === "condition") return renderZboConditionNode(node);
  const width = 210;
  const height = 56;
  const x = node.x - width / 2;
  const y = node.y - height / 2;
  const labelLines = splitLabel(node.label, 26).slice(0, 2);
  const firstY = labelLines.length > 1 ? node.y - 7 : node.y - 1;
  const active = isZboNodeHighlighted(node.id) ? "active" : "";

  const isGqlCodeMatch = node.kind === "gql" && state.searchScope === "code" && state.query && (() => {
    const query = state.zboQueries.find(q => q.id === node.label);
    return query && matches(query.code || "", state.query);
  })();
  const isWorkflowCodeMatch = (node.kind === "workflow" || node.kind === "condition") && state.searchScope === "code" && state.query && (() => {
    const wf = state.workflows.find(w => w.name === node.label);
    return wf && wf.nodes.some(n => 
      matches(n.inputScript || "", state.query) ||
      matches(n.outputScript || "", state.query) ||
      matches(n.conditionScript || "", state.query)
    );
  })();
  const isCodeMatch = isGqlCodeMatch || isWorkflowCodeMatch;
  const matchCodeClass = isCodeMatch ? "match-code" : "";

  return `
    <g class="zbo-flow-node zbo-flow-${escapeAttr(node.kind)} ${active} ${matchCodeClass}" data-node-id="${escapeAttr(node.id)}">
      <title>${escapeHtml(zboNodeTooltip(node))}</title>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="9"></rect>
      ${node.kind === "navigate" ? renderScreenIcon(x + 10, y + 11) : ""}
      ${node.userTriggered ? renderUserIcon(x + 10, y + 10) : ""}
      ${node.eventType ? `<text class="zbo-flow-event" x="${x + width - 10}" y="${y + 14}" text-anchor="end">${escapeHtml(displayActionEvent(node.eventType))}</text>` : ""}
      ${labelLines
        .map(
          (line, index) =>
            `<text class="zbo-flow-label" x="${node.x}" y="${firstY + index * 14}" text-anchor="middle">${escapeHtml(line)}</text>`,
        )
        .join("")}
      <text class="zbo-flow-subtitle" x="${node.x}" y="${node.y + 21}" text-anchor="middle">${escapeHtml(truncate(node.subtitle || "", 30))}</text>
      ${state.showDbBadges ? renderZboDbBadge(node) : ""}
    </g>
  `;
}

function renderZboStartNode(node) {
  const width = 96;
  const height = 44;
  const x = node.x - width / 2;
  const y = node.y - height / 2;
  const active = isZboNodeHighlighted(node.id) ? "active" : "";
  return `
    <g class="zbo-flow-node zbo-flow-start ${active}" data-node-id="${escapeAttr(node.id)}">
      <title>${escapeHtml(zboNodeTooltip(node))}</title>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22"></rect>
      <text class="zbo-flow-label" x="${node.x}" y="${node.y + 4}" text-anchor="middle">Start</text>
    </g>
  `;
}

function renderZboConditionNode(node) {
  const halfW = 68;
  const halfH = 38;
  const cx = node.x;
  const cy = node.y;
  const points = `${cx},${cy - halfH} ${cx + halfW},${cy} ${cx},${cy + halfH} ${cx - halfW},${cy}`;
  const labelLines = splitLabel(node.label, 16).slice(0, 2);
  const firstY = labelLines.length > 1 ? cy - 5 : cy + 1;
  const active = isZboNodeHighlighted(node.id) ? "active" : "";

  const isWorkflowCodeMatch = state.searchScope === "code" && state.query && (() => {
    const wf = state.workflows.find(w => w.name === node.label);
    return wf && wf.nodes.some(n => 
      matches(n.inputScript || "", state.query) ||
      matches(n.outputScript || "", state.query) ||
      matches(n.conditionScript || "", state.query)
    );
  })();
  const matchCodeClass = isWorkflowCodeMatch ? "match-code" : "";

  return `
    <g class="zbo-flow-node zbo-flow-condition ${active} ${matchCodeClass}" data-node-id="${escapeAttr(node.id)}">
      <title>${escapeHtml(zboNodeTooltip(node))}</title>
      <polygon points="${points}"></polygon>
      ${labelLines
        .map(
          (line, index) =>
            `<text class="zbo-flow-label" x="${cx}" y="${firstY + index * 13}" text-anchor="middle">${escapeHtml(line)}</text>`,
        )
        .join("")}
      ${state.showDbBadges ? renderZboDbBadge(node) : ""}
    </g>
  `;
}

function renderScreenIcon(x, y) {
  return `
    <g class="zbo-screen-icon" aria-hidden="true">
      <rect x="${x}" y="${y}" width="15" height="10" rx="1.5"></rect>
      <path d="M ${x + 4} ${y + 14} L ${x + 11} ${y + 14}"></path>
      <path d="M ${x + 7.5} ${y + 10} L ${x + 7.5} ${y + 14}"></path>
    </g>
  `;
}

// DB usage badge for a ZBO flow node: a cylinder placed just below the node with
// the touched tables listed to its right, each tagged SEL/INS/UPD/DEL. Mirrors
// the Zoral diagram DB badge (reuses node-db-* styles). Capped at 4 tables.
function renderZboDbBadge(node) {
  const groups = groupOpsByTable(node.dbOps || []);
  if (!groups.length) return "";
  const shown = groups.slice(0, 4);
  const overflow = groups.length - shown.length;
  const iconCx = node.x - 72;
  const iconCy = node.y + 42;
  const tooltip = groups.map((group) => `${group.table} [${group.ops.join(" | ")}]`).join("\n");
  const lineHeight = 13;
  const listX = iconCx + 13;
  const listTop = iconCy - ((shown.length - 1) * lineHeight) / 2;
  const rows = shown
    .map((group, index) => {
      const y = listTop + index * lineHeight + 3;
      const opSpans = group.ops
        .map(
          (op) =>
            `<tspan class="db-op-code op-${escapeAttr(op)}" dx="5">${escapeHtml(opCode(op))}</tspan>`,
        )
        .join("");
      return `<text class="node-db-list" x="${listX}" y="${y}"><tspan class="db-table-name">${escapeHtml(truncate(group.table, 20))}</tspan>${opSpans}</text>`;
    })
    .join("");
  const more = overflow > 0
    ? `<text class="node-db-list db-more" x="${listX}" y="${listTop + shown.length * lineHeight + 3}">+${overflow} more</text>`
    : "";
  return `
    <g class="node-db-icon-group">
      <title>${escapeHtml(tooltip)}</title>
      <path class="node-db-connector" d="M ${node.x} ${node.y + 28} L ${iconCx} ${iconCy - 9}"></path>
      ${renderDbCylinder(iconCx, iconCy)}
      ${rows}
      ${more}
    </g>
  `;
}

function renderUserIcon(x, y) {
  return `
    <g class="zbo-user-icon" aria-hidden="true">
      <circle cx="${x + 6}" cy="${y + 5}" r="4"></circle>
      <path d="M ${x} ${y + 16} Q ${x + 6} ${y + 10} ${x + 12} ${y + 16}"></path>
    </g>
  `;
}

function zboNodeTooltip(node) {
  const route = node.kind === "navigate" ? node.subtitle : "";
  return [node.label, node.kind === "navigate" ? route : node.subtitle]
    .filter(Boolean)
    .join(" — ");
}

function renderZboFlowEdge(edge) {
  const full = edge.label || "";
  const label = full ? truncate(full, 24) : "";
  const highlight = [
    state.selectedZboNodeId && edge.from === state.selectedZboNodeId ? "edge-outbound" : "",
    state.selectedZboNodeId && edge.to === state.selectedZboNodeId ? "edge-inbound" : "",
    state.selectedZboEdge &&
    state.selectedZboEdge.from === edge.from &&
    state.selectedZboEdge.to === edge.to
      ? "selected"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <g class="zbo-flow-edge zbo-edge-${escapeAttr(edge.kind || "normal")} ${highlight}" data-edge-from="${escapeAttr(edge.from)}" data-edge-to="${escapeAttr(edge.to)}">
      <path class="zbo-edge-hit" d="${edge.path}"></path>
      <path class="zbo-edge-line" d="${edge.path}" marker-end="url(#zboArrow)"></path>
      ${
        label
          ? `<title>${escapeHtml(full)}</title><text x="${edge.labelX}" y="${edge.labelY}" text-anchor="middle">${escapeHtml(label)}</text>`
          : ""
      }
    </g>
  `;
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Layout coordinates from Zoral `.layout` files pack nodes ~140px apart
// center-to-center, which is barely wider than a node, so connectors become
// invisible. Spread positions out so edges and labels have room to breathe.
const SPACING_X = 1.5;
const SPACING_Y = 1.28;

function scaledPosition(node) {
  // Drag override is stored in already-scaled coordinates (so reading it back
  // produces the same final center as the user dragged to, regardless of
  // SPACING_X/Y tweaks). Falls back to the original layout positions.
  const wf = state.selectedWorkflow;
  const override = getZoralPositionOverride(wf, node.id);
  if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
    return { x: override.x, y: override.y };
  }
  const base = baseScaledPosition(node);
  const spacing = nodeSpacingOffset(wf, node);
  return {
    x: base.x + spacing.x,
    y: base.y + spacing.y,
  };
}

function baseScaledPosition(node) {
  return {
    x: node.position.x * SPACING_X,
    y: node.position.y * SPACING_Y,
  };
}

function getZoralPositionOverride(workflow, nodeId) {
  return workflow && state.nodePositions?.zoral?.[workflow.name]?.[nodeId];
}

function nodeSpacingOffset(workflow, node) {
  if (!workflow) return { x: 0, y: 0 };
  if (!workflow._nodeSpacingOffsets) {
    workflow._nodeSpacingOffsets = buildNodeSpacingOffsets(workflow);
  }
  return workflow._nodeSpacingOffsets.get(node.id) || { x: 0, y: 0 };
}

function buildNodeSpacingOffsets(workflow) {
  const offsets = new Map();
  const minGap = 34;
  const rowPadding = 18;
  const rows = [];
  const nodes = workflow.nodes
    .filter((node) => !getZoralPositionOverride(workflow, node.id))
    .map((node) => {
      const position = baseScaledPosition(node);
      const size = nodeSize(node);
      return {
        node,
        position,
        size,
        halfWidth: size.width / 2,
        halfHeight: size.height / 2,
      };
    })
    .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x);

  for (const item of nodes) {
    let row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - item.position.y) <=
        Math.max(candidate.halfHeight, item.halfHeight) + rowPadding,
    );
    if (!row) {
      row = { y: item.position.y, halfHeight: item.halfHeight, items: [] };
      rows.push(row);
    }
    const nextCount = row.items.length + 1;
    row.y = (row.y * row.items.length + item.position.y) / nextCount;
    row.halfHeight = Math.max(row.halfHeight, item.halfHeight);
    row.items.push(item);
  }

  for (const row of rows) {
    row.items.sort((left, right) => left.position.x - right.position.x);
    let lastRight = -Infinity;
    for (const item of row.items) {
      const currentOffset = offsets.get(item.node.id) || { x: 0, y: 0 };
      const currentX = item.position.x + currentOffset.x;
      const currentLeft = currentX - item.halfWidth;
      const targetLeft = Math.max(currentLeft, lastRight + minGap);
      const shiftX = targetLeft - currentLeft;
      if (shiftX > 0) {
        offsets.set(item.node.id, { x: currentOffset.x + shiftX, y: currentOffset.y });
      }
      lastRight = targetLeft + item.size.width;
    }
  }

  return offsets;
}

function getBounds(nodes) {
  return nodes.reduce(
    (acc, node) => {
      const pos = scaledPosition(node);
      acc.minX = Math.min(acc.minX, pos.x);
      acc.minY = Math.min(acc.minY, pos.y);
      acc.maxX = Math.max(acc.maxX, pos.x);
      acc.maxY = Math.max(acc.maxY, pos.y);
      return acc;
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function getDiagramBounds(nodes, routedEdges) {
  const rawNodeBounds = getBounds(nodes);
  const zeroOffsetX = -rawNodeBounds.minX;
  const zeroOffsetY = -rawNodeBounds.minY;
  const nodeBounds = nodes.reduce(
    (acc, node) => {
      const center = nodeCenter(node, zeroOffsetX, zeroOffsetY);
      const size = nodeSize(node);
      expandBounds(acc, center.x - size.width / 2, center.y - size.height / 2);
      expandBounds(acc, center.x + size.width / 2, center.y + size.height / 2);
      return acc;
    },
    createEmptyBounds(),
  );
  const diagramBounds = routedEdges.reduce((acc, routed, index) => {
    getEdgeRoutePoints(routed, zeroOffsetX, zeroOffsetY, index).forEach((point) =>
      expandBounds(acc, point.x, point.y),
    );
    return acc;
  }, nodeBounds);

  return {
    minX: diagramBounds.minX + rawNodeBounds.minX,
    minY: diagramBounds.minY + rawNodeBounds.minY,
    maxX: diagramBounds.maxX + rawNodeBounds.minX,
    maxY: diagramBounds.maxY + rawNodeBounds.minY,
  };
}

function createEmptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function expandBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function nodeCenter(node, offsetX, offsetY) {
  const pos = scaledPosition(node);
  return {
    x: pos.x + offsetX,
    y: pos.y + offsetY,
  };
}

function normalizeSide(side) {
  return side === "boundary" ? "right" : side;
}

// Resolve each edge's physical from/to sides and distribute (fan out) the
// connection points along a node's side when several edges share it. Spreading
// the anchors keeps the parallel segments on separate tracks instead of
// stacking on top of each other, which is the main source of overlap.
function buildRoutedEdges(workflow, nodeById) {
  const obstacles = [...nodeById.values()];
  const resolved = workflow.edges
    .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to))
    .map((edge) => {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      const fromSide = normalizeSide(edge.fromSide || inferSide(fromNode, toNode));
      const rawToSide = normalizeSide(edge.toSide || oppositeSide(fromSide));
      const toSide = adjustIncomingSide(fromNode, toNode, fromSide, rawToSide);
      return {
        edge,
        fromNode,
        toNode,
        fromSide,
        toSide,
        fromOffset: 0,
        toOffset: 0,
        obstacles,
      };
    });

  const sideGroups = new Map();
  const addToGroup = (id, side, entry) => {
    const key = `${id}|${side}`;
    if (!sideGroups.has(key)) sideGroups.set(key, []);
    sideGroups.get(key).push(entry);
  };
  for (const routed of resolved) {
    addToGroup(routed.edge.from, routed.fromSide, { routed, role: "from" });
    addToGroup(routed.edge.to, routed.toSide, { routed, role: "to" });
  }

  for (const list of sideGroups.values()) {
    if (list.length < 2) continue;
    const sample = list[0];
    const node = sample.role === "from" ? sample.routed.fromNode : sample.routed.toNode;
    // Diamond (condition) nodes only have one connection vertex per side;
    // offsetting along the slanted edge would detach the line, so skip them.
    if (node.type === "condition") continue;
    const side = sample.role === "from" ? sample.routed.fromSide : sample.routed.toSide;
    const vertical = side === "left" || side === "right";
    const span = vertical ? nodeSize(node).height : nodeSize(node).width;
    list.sort((a, b) => {
      const oa = a.role === "from" ? a.routed.toNode : a.routed.fromNode;
      const ob = b.role === "from" ? b.routed.toNode : b.routed.fromNode;
      const pa = scaledPosition(oa);
      const pb = scaledPosition(ob);
      return vertical ? pa.y - pb.y : pa.x - pb.x;
    });
    const n = list.length;
    const step = Math.min(18, (span - 18) / (n - 1));
    list.forEach((entry, i) => {
      const offset = (i - (n - 1) / 2) * step;
      if (entry.role === "from") entry.routed.fromOffset = offset;
      else entry.routed.toOffset = offset;
    });
  }

  return resolved;
}

function matchNodeWithStep(nodeId, step, workflow) {
  if (!nodeId || !step) return false;
  const node = workflow?.nodes.find(n => n.id === nodeId);
  if (typeof window.LivePresentation?.matchesWorkflowNodeStep === "function") {
    return window.LivePresentation.matchesWorkflowNodeStep(node, step);
  }

  const nodeIdLower = nodeId.toLowerCase().trim();
  const nodeCallNameLower = node && node.callName ? node.callName.toLowerCase().trim() : null;

  const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName;
  const stepNameLower = stepName ? stepName.toLowerCase().trim() : "";
  const activityId = step.ActivityId || step.StepId || step.NodeId;
  const activityIdLower = activityId ? activityId.toLowerCase().trim() : "";

  return (
    stepNameLower === nodeIdLower ||
    activityIdLower === nodeIdLower ||
    (nodeCallNameLower && stepNameLower === nodeCallNameLower) ||
    (nodeCallNameLower && activityIdLower === nodeCallNameLower)
  );
}

function isNodeMarkedExecuted(nodeId, workflow) {
  const nodeIdLower = nodeId.toLowerCase().trim();
  const node = workflow.nodes.find(n => n.id === nodeId);
  const nodeCallNameLower = node && node.callName ? node.callName.toLowerCase().trim() : null;
  return state.liveExecutedNodes.has(nodeId) ||
    state.liveExecutedNodes.has(nodeIdLower) ||
    (node && node.callName && state.liveExecutedNodes.has(node.callName)) ||
    (node && node.callName && state.liveExecutedNodes.has(nodeCallNameLower));
}

function getNodeLiveInfo(nodeId, workflow) {
  if (!state.liveHighlightedWorkflow || !state.liveExecutedNodes) return null;
  if (!workflow) return null;

  const steps = typeof window.WorkflowLive?.getSelectedProcessSteps === "function"
    ? window.WorkflowLive.getSelectedProcessSteps()
    : [];
  if (steps.length === 0) {
    return isNodeMarkedExecuted(nodeId, workflow)
      ? { status: "completed", executionCount: 1 }
      : null;
  }

  const matchedSteps = steps.filter(step => matchNodeWithStep(nodeId, step, workflow));

  if (matchedSteps.length === 0) {
    return isNodeMarkedExecuted(nodeId, workflow)
      ? { status: "completed", executionCount: 1 }
      : null;
  }

  const hasFailed = matchedSteps.some(s => s.IsFailed || s.ErrorDescription || s.ErrorCode);
  if (hasFailed) return { status: "failed", executionCount: matchedSteps.length };

  // "alert": the step completed, but its output payload carries a failing
  // status/severity field (business-rule failure). Mirrors the dark-pink JSON
  // highlight in the Live Exec output panel.
  const hasOutputAlert = matchedSteps.some(s =>
    payloadHasFailFlag(s.OutputJson || s.Output || s.Result || s.WorkflowOutputJson || s.workflowOutputJson, 0)
  );
  return {
    status: hasOutputAlert ? "alert" : "completed",
    executionCount: matchedSteps.length,
  };
}

function getNodeLiveStatus(nodeId, workflow) {
  return getNodeLiveInfo(nodeId, workflow)?.status || null;
}

// Deep-scan a payload for a `status`/`severity` field (any nesting level, incl.
// nested JSON strings and arrays) whose value reads as a failure. Keep this in
// sync with the json-tree-flag-alert rule in live-mode.js renderJsonTree.
function payloadHasFailFlag(value, depth) {
  if (value == null || depth > 8) return false;
  if (typeof value === "string") {
    const t = value.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return payloadHasFailFlag(JSON.parse(value), depth + 1); } catch (_) { return false; }
    }
    return false;
  }
  if (typeof value !== "object") return false;
  const failRe = /(fail|error|false|(not|in)\s*complete)/i;
  if (Array.isArray(value)) return value.some(v => payloadHasFailFlag(v, depth + 1));
  for (const [k, v] of Object.entries(value)) {
    if (/^(status|severity)$/i.test(k) &&
        (typeof v === "string" || typeof v === "boolean" || typeof v === "number") &&
        failRe.test(String(v))) {
      return true;
    }
    if (payloadHasFailFlag(v, depth + 1)) return true;
  }
  return false;
}

function getEdgeLiveStatus(edge, fromNode, toNode, workflow) {
  if (!state.liveHighlightedWorkflow || !state.liveExecutedNodes) return null;
  
  const fromStatus = getNodeLiveStatus(edge.from, workflow);
  const toStatus = getNodeLiveStatus(edge.to, workflow);
  
  if (!fromStatus || !toStatus) return null;

  // Branch exclusion logic for Live execution path:
  // If the source node has multiple outgoing edges (a gateway or branch point),
  // we check the chronological trace steps to see which transition was actually taken.
  const isBranchNode = fromNode && (fromNode.type === "condition" || workflow.edges.filter(e => e.from === edge.from).length > 1);

  if (isBranchNode) {
    const steps = typeof window.WorkflowLive?.getSelectedProcessSteps === "function"
      ? window.WorkflowLive.getSelectedProcessSteps()
      : [];
    
    if (steps.length > 0) {
      // Find all sibling target node IDs from the same source node
      const siblingTargets = workflow.edges.filter(e => e.from === edge.from).map(e => e.to);
      
      let transitionOccurred = false;
      
      for (let i = 0; i < steps.length; i++) {
        if (matchNodeWithStep(edge.from, steps[i], workflow)) {
          // Look ahead in trace to find the first executed sibling target
          for (let j = i + 1; j < steps.length; j++) {
            const matchedTarget = siblingTargets.find(targetId => matchNodeWithStep(targetId, steps[j], workflow));
            if (matchedTarget) {
              if (matchedTarget === edge.to) {
                transitionOccurred = true;
              }
              break; // Stop lookahead at the first executed sibling target
            }
          }
          if (transitionOccurred) break;
        }
      }
      
      if (!transitionOccurred) {
        return null; // Suppress edge highlight since it wasn't the branch taken in the trace
      }
    } else {
      // Fallback label-based heuristics if step data is unavailable
      const edgeLabel = edge.label || "";
      const isElseLabel = (label) => {
        const l = String(label || "").toLowerCase().trim();
        return l === "else" || l === "false" || l === "no" || l === "otherwise";
      };
      const isIfLabel = (label) => {
        const l = String(label || "").toLowerCase().trim();
        return l === "if" || l === "true" || l === "yes" || l === "then";
      };

      if (isElseLabel(edgeLabel)) {
        const siblingEdges = workflow.edges.filter(e => e.from === edge.from && e.to !== edge.to);
        const hasExecutedIfBranch = siblingEdges.some(se => {
          if (isIfLabel(se.label)) {
            const seTargetStatus = getNodeLiveStatus(se.to, workflow);
            return seTargetStatus !== null;
          }
          return false;
        });
        if (hasExecutedIfBranch) {
          return null;
        }
      }
    }
  }
  
  if (toStatus === "failed") return "failed";
  return "completed";
}

function renderEdge(routed, offsetX, offsetY, selectedNodeId, edgeIndex = 0) {
  const { edge, fromNode, toNode, fromSide, toSide, fromOffset, toOffset } = routed;
  const pathPoints = getEdgeRoutePoints(routed, offsetX, offsetY, edgeIndex);
  const visiblePoints = visibleEdgeLinePoints(pathPoints);
  const start = visiblePoints[0] || pathPoints[0];
  const end = pathPoints[pathPoints.length - 1];
  const d = visiblePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const labelPoint = edgeLabelPoint(pathPoints) || {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  const fullLabel = edgeLabelText(edge);
  // Keep the label from overrunning the gap between two close nodes: estimate
  // the room available along the route and truncate (full text stays in the
  // hover tooltip).
  const horizontalGap = Math.abs(end.x - start.x);
  const verticalGap = Math.abs(end.y - start.y);
  const available =
    verticalGap < 40 ? Math.max(horizontalGap - 14, 34) : Math.max(horizontalGap, 220);
  const maxChars = Math.max(6, Math.floor(available / 6));
  const displayLabel = truncate(fullLabel, maxChars);
  const isSelected =
    state.selectedEdge &&
    state.selectedEdge.from === edge.from &&
    state.selectedEdge.to === edge.to;

  const edgeStatus = getEdgeLiveStatus(edge, fromNode, toNode, state.selectedWorkflow);
  const liveHighlightClass = edgeStatus 
    ? `step-highlight-edge ${edgeStatus === "failed" ? "danger" : "success"}` 
    : "";

  const isAsync = Boolean(fromNode.async || toNode.async);
  const edgeClasses = [
    "edge-line",
    isAsync ? "edge-async" : "",
    selectedNodeId && edge.from === selectedNodeId ? "edge-outbound" : "",
    selectedNodeId && edge.to === selectedNodeId ? "edge-inbound" : "",
    isSelected ? "edge-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const overlayClasses = [
    selectedNodeId && edge.from === selectedNodeId ? "edge-outbound" : "",
    selectedNodeId && edge.to === selectedNodeId ? "edge-inbound" : "",
    isSelected ? "edge-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const labelWidth = displayLabel.length * 6.2 + 12;
  const labelMarkup = displayLabel
    ? `
      <g class="edge-label-group">
        <rect class="edge-label-bg ${isSelected ? "selected" : ""}" x="${labelPoint.x - labelWidth / 2}" y="${labelPoint.y - 19}" width="${labelWidth}" height="16" rx="4"><title>${escapeHtml(edgeLabelTooltip(edge))}</title></rect>
        <text class="edge-label" x="${labelPoint.x}" y="${labelPoint.y - 7}" text-anchor="middle">${escapeHtml(displayLabel)}</text>
      </g>`
    : "";
  const edgeMarkup = `
    <g class="edge-group ${isSelected ? "selected" : ""} ${liveHighlightClass}" data-edge-from="${escapeAttr(edge.from)}" data-edge-to="${escapeAttr(edge.to)}">
      <path class="edge-hit" d="${d}"></path>
      <path class="${edgeClasses}" d="${d}"></path>
    </g>
  `;
  const overlayMarkup = `
    <g class="edge-overlay ${overlayClasses}">
      <circle class="edge-source-dot" cx="${start.x}" cy="${start.y}" r="${isSelected || selectedNodeId === edge.from ? 4.5 : 3.4}"></circle>
      ${renderEdgeArrow(pathPoints)}
    </g>
  `;
  return { edge: edgeMarkup, overlay: overlayMarkup, label: labelMarkup };
}

function visibleEdgeLinePoints(points) {
  const route = dedupePoints(points);
  if (route.length < 2) return route;
  const visible = route.map((point) => ({ ...point }));
  const sourceTrim = 4;
  const arrowTrim = 11;
  visible[0] = pointToward(visible[0], visible[1], sourceTrim);
  visible[visible.length - 1] = pointToward(
    visible[visible.length - 1],
    visible[visible.length - 2],
    arrowTrim,
  );
  return simplifyRoute(visible);
}

function edgeLabelPoint(points) {
  const route = dedupePoints(points);
  if (route.length < 2) return null;
  const startIndex = route.length > 2 ? 1 : 0;
  const from = route[startIndex];
  const to = route[startIndex + 1] || route[startIndex - 1];
  if (!to) return from;
  const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
  return pointToward(from, to, Math.min(46, segmentLength / 2));
}

function pointToward(from, to, distance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return { ...from };
  const amount = Math.min(distance, length);
  return {
    x: from.x + (dx / length) * amount,
    y: from.y + (dy / length) * amount,
  };
}

function renderEdgeArrow(points) {
  if (points.length < 2) return "";
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  const dx = end.x - previous.x;
  const dy = end.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (!length) return "";
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const size = 10;
  const half = 5;
  const base = {
    x: end.x - ux * size,
    y: end.y - uy * size,
  };
  const pointsAttr = [
    `${end.x},${end.y}`,
    `${base.x + px * half},${base.y + py * half}`,
    `${base.x - px * half},${base.y - py * half}`,
  ].join(" ");
  return `<polygon class="edge-arrow" points="${pointsAttr}"></polygon>`;
}

function getEdgeRoutePoints(routed, offsetX, offsetY, edgeIndex = 0) {
  const { fromNode, toNode, fromSide, toSide, fromOffset, toOffset } = routed;
  const start = anchorPoint(fromNode, fromSide, offsetX, offsetY, fromOffset);
  const end = anchorPoint(toNode, toSide, offsetX, offsetY, toOffset);
  const initialRoute = applyEntryLaneRule(
    orthogonalRoute(start, end, fromSide, toSide, edgeIndex),
    routed,
    start,
    end,
    fromSide,
    toSide,
    offsetX,
    offsetY,
  );
  return simplifyRoute(
    avoidNodeIntersections(
      initialRoute,
      routed,
      offsetX,
      offsetY,
      edgeIndex,
    ),
  );
}

function applyEntryLaneRule(points, routed, start, end, fromSide, toSide, offsetX, offsetY) {
  const route = simplifyRoute(points);
  if (route.length < 2) return route;

  const fromCenter = nodeCenter(routed.fromNode, offsetX, offsetY);
  const toCenter = nodeCenter(routed.toNode, offsetX, offsetY);
  const sourceStub = Math.max(
    16,
    Math.min(34, Math.hypot(end.x - start.x, end.y - start.y) / 12),
  );
  const startOut = project(start, fromSide, sourceStub);
  const clearance = 46;

  if (toSide === "top" && fromCenter.y >= toCenter.y && fromSide !== "top") {
    const laneY = Math.min(startOut.y, end.y) - clearance;
    return simplifyRoute([start, startOut, { x: startOut.x, y: laneY }, { x: end.x, y: laneY }, end]);
  }

  if (toSide === "bottom" && fromCenter.y <= toCenter.y && fromSide !== "bottom") {
    const laneY = Math.max(startOut.y, end.y) + clearance;
    return simplifyRoute([start, startOut, { x: startOut.x, y: laneY }, { x: end.x, y: laneY }, end]);
  }

  return route;
}

// Build the human-readable edge label. Condition branches get an explicit
// "If " prefix so it reads as a condition; the default branch shows "Else".
function edgeLabelText(edge) {
  if (edge.condition && edge.condition !== "else") {
    return state.showConditionText ? `If ${edge.condition}` : "If";
  }
  if (edge.condition === "else") return "Else";
  return state.showEdgeLabels ? edge.label || "" : "";
}

function edgeLabelTooltip(edge) {
  if (edge.condition && edge.condition !== "else") return `If ${edge.condition}`;
  if (edge.condition === "else") return "Else";
  return edge.label || "";
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function anchorPoint(node, side, offsetX, offsetY, along = 0) {
  const center = nodeCenter(node, offsetX, offsetY);
  const size = nodeSize(node);
  const normalized = side === "boundary" ? "right" : side;
  if (normalized === "left") return { x: center.x - size.width / 2, y: center.y + along };
  if (normalized === "right") return { x: center.x + size.width / 2, y: center.y + along };
  if (normalized === "top") return { x: center.x + along, y: center.y - size.height / 2 };
  if (normalized === "bottom") return { x: center.x + along, y: center.y + size.height / 2 };
  return center;
}

function nodeSize(node) {
  if (node.type === "condition") return { width: 148, height: 92 };
  // Event nodes: compact circular icons, gateway and process the same size.
  if (node.type === "event/gateway" || node.type === "event/process" || node.type === "event/process/failed") return { width: 48, height: 48 };
  return { width: 152, height: 76 };
}

function adjustIncomingSide(fromNode, toNode, fromSide, toSide) {
  const from = scaledPosition(fromNode);
  const to = scaledPosition(toNode);
  const verticalGap = to.y - from.y;
  const threshold = nodeSize(toNode).height * 0.8;
  if (toSide === "bottom" && fromSide === "bottom" && verticalGap > threshold) return "top";
  if (toSide === "top" && fromSide === "top" && verticalGap < -threshold) return "bottom";
  return toSide;
}

function avoidNodeIntersections(points, routed, offsetX, offsetY, seed = 0) {
  let route = simplifyRoute(points);
  const margin = 18;
  const lane = (seed % 5) * 10;
  const rects = (routed.obstacles || [])
    .filter((node) => node.id !== routed.fromNode.id && node.id !== routed.toNode.id)
    .map((node) => nodeRect(node, offsetX, offsetY, margin));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hit = findRouteObstacleHit(route, rects);
    if (!hit) return route;
    const { index, rect, orientation } = hit;
    if (orientation === "point") {
      const previous = route[index - 1];
      const next = route[index + 1];
      if (!previous || !next) return route;
      const detourY = chooseVerticalDetourY([rect], routed, offsetX, offsetY, margin, lane);
      route.splice(index, 1, { x: previous.x, y: detourY }, { x: next.x, y: detourY });
      route = simplifyRoute(route);
      continue;
    }

    const a = route[index];
    const b = route[index + 1];
    if (orientation === "horizontal") {
      const overlapping = rects.filter((candidate) =>
        horizontalSegmentHitsRect(a, b, candidate),
      );
      const detourY = chooseVerticalDetourY(overlapping, routed, offsetX, offsetY, margin, lane);
      route.splice(index + 1, 0, { x: a.x, y: detourY }, { x: b.x, y: detourY });
    } else {
      const overlapping = rects.filter((candidate) => verticalSegmentHitsRect(a, b, candidate));
      const detourX = chooseHorizontalDetourX(overlapping, routed, offsetX, offsetY, margin, lane);
      route.splice(index + 1, 0, { x: detourX, y: a.y }, { x: detourX, y: b.y });
    }
    route = simplifyRoute(route);
  }

  return route;
}

function chooseVerticalDetourY(rects, routed, offsetX, offsetY, margin, lane = 0) {
  const target = nodeCenter(routed.toNode, offsetX, offsetY);
  const averageY =
    rects.reduce((sum, rect) => sum + (rect.top + rect.bottom) / 2, 0) / Math.max(rects.length, 1);
  const topY = Math.min(...rects.map((rect) => rect.top)) - margin - lane;
  const bottomY = Math.max(...rects.map((rect) => rect.bottom)) + margin + lane;
  return target.y <= averageY ? topY : bottomY;
}

function chooseHorizontalDetourX(rects, routed, offsetX, offsetY, margin, lane = 0) {
  const target = nodeCenter(routed.toNode, offsetX, offsetY);
  const averageX =
    rects.reduce((sum, rect) => sum + (rect.left + rect.right) / 2, 0) / Math.max(rects.length, 1);
  const leftX = Math.min(...rects.map((rect) => rect.left)) - margin - lane;
  const rightX = Math.max(...rects.map((rect) => rect.right)) + margin + lane;
  return target.x <= averageX ? leftX : rightX;
}

function simplifyRoute(points) {
  let route = dedupePoints(points);
  let changed = true;
  while (changed) {
    changed = false;
    route = route.filter((point, index) => {
      if (index === 0 || index === route.length - 1) return true;
      const previous = route[index - 1];
      const next = route[index + 1];
      if ((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y)) {
        changed = true;
        return false;
      }
      return true;
    });
  }

  return dedupePoints(route);
}

function nodeRect(node, offsetX, offsetY, margin = 0) {
  const center = nodeCenter(node, offsetX, offsetY);
  const size = nodeSize(node);
  return {
    left: center.x - size.width / 2 - margin,
    right: center.x + size.width / 2 + margin,
    top: center.y - size.height / 2 - margin,
    bottom: center.y + size.height / 2 + margin,
  };
}

function findRouteObstacleHit(points, rects) {
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const rect = rects.find((candidate) => pointInsideRect(point, candidate));
    if (rect) return { index, rect, orientation: "point" };
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a.y === b.y) {
      const rect = rects.find((candidate) => horizontalSegmentHitsRect(a, b, candidate));
      if (rect) return { index, rect, orientation: "horizontal" };
    } else if (a.x === b.x) {
      const rect = rects.find((candidate) => verticalSegmentHitsRect(a, b, candidate));
      if (rect) return { index, rect, orientation: "vertical" };
    }
  }
  return null;
}

function pointInsideRect(point, rect) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function horizontalSegmentHitsRect(a, b, rect) {
  if (a.y < rect.top || a.y > rect.bottom) return false;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  return maxX >= rect.left && minX <= rect.right;
}

function verticalSegmentHitsRect(a, b, rect) {
  if (a.x < rect.left || a.x > rect.right) return false;
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxY >= rect.top && minY <= rect.bottom;
}

function orthogonalRoute(start, end, fromSide, toSide, seed = 0) {
  const horizontal = fromSide === "left" || fromSide === "right";
  // Shorten the exit/entry stubs when the two nodes sit close together so the
  // stubs can never overshoot each other. Overshooting previously made a normal
  // short forward edge look like a back edge and routed it through a big loop.
  const axisGap = horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y);
  const stub = Math.max(6, Math.min(28, axisGap / 2 - 2));
  const startOut = project(start, fromSide, stub);
  const endIn = project(end, toSide, stub);
  // Spread parallel edges onto slightly different lanes so their shared
  // bridging segments do not stack on top of each other.
  const lane = ((seed % 6) - 2.5) * 12;
  const detourStep = (seed % 4) * 22;
  const points = [start, startOut];
  const fromVertical = fromSide === "top" || fromSide === "bottom";
  const toHorizontal = toSide === "left" || toSide === "right";
  const fromHorizontal = fromSide === "left" || fromSide === "right";
  const toVertical = toSide === "top" || toSide === "bottom";

  if (fromVertical && toHorizontal) {
    const directY = end.y;
    points.push({ x: startOut.x, y: directY }, end);
    return simplifyRoute(points);
  }

  if (fromHorizontal && toVertical) {
    const directX = end.x;
    points.push({ x: directX, y: startOut.y }, end);
    return simplifyRoute(points);
  }

  if (horizontal) {
    // Decide "back edge" from the real node anchors, not the projected stubs.
    const isBackEdge =
      (fromSide === "right" && end.x < start.x) ||
      (fromSide === "left" && end.x > start.x);
    if (isBackEdge) {
      const detourX =
        fromSide === "right"
          ? Math.max(startOut.x, endIn.x) + 80 + detourStep
          : Math.min(startOut.x, endIn.x) - 80 - detourStep;
      let detourY = (startOut.y + endIn.y) / 2 + lane;
      if (Math.abs(startOut.y - endIn.y) < 24) detourY = startOut.y + 88 + detourStep;
      points.push(
        { x: detourX, y: startOut.y },
        { x: detourX, y: detourY },
        { x: endIn.x, y: detourY },
      );
    } else {
      // Clamp the bridge so the lane offset can never push it outside the
      // channel between the two stubs (which would bend the line backward).
      const midX = clampBetween((startOut.x + endIn.x) / 2 + lane, startOut.x, endIn.x);
      points.push({ x: midX, y: startOut.y }, { x: midX, y: endIn.y });
    }
  } else {
    const isBackEdge =
      (fromSide === "bottom" && end.y < start.y) ||
      (fromSide === "top" && end.y > start.y);
    if (isBackEdge) {
      const detourY =
        fromSide === "bottom"
          ? Math.max(startOut.y, endIn.y) + 80 + detourStep
          : Math.min(startOut.y, endIn.y) - 80 - detourStep;
      let detourX = (startOut.x + endIn.x) / 2 + lane;
      if (Math.abs(startOut.x - endIn.x) < 24) detourX = startOut.x + 88 + detourStep;
      points.push(
        { x: startOut.x, y: detourY },
        { x: detourX, y: detourY },
        { x: detourX, y: endIn.y },
      );
    } else {
      const midY = clampBetween((startOut.y + endIn.y) / 2 + lane, startOut.y, endIn.y);
      points.push({ x: startOut.x, y: midY }, { x: endIn.x, y: midY });
    }
  }

  points.push(endIn, end);
  return dedupePoints(points);
}

function project(point, side, amount) {
  if (side === "left") return { x: point.x - amount, y: point.y };
  if (side === "right" || side === "boundary") return { x: point.x + amount, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - amount };
  if (side === "bottom") return { x: point.x, y: point.y + amount };
  return point;
}

function clampBetween(value, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return Math.max(min, Math.min(max, value));
}

function dedupePoints(points) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function inferSide(fromNode, toNode) {
  const dx = (toNode.position.x - fromNode.position.x) * SPACING_X;
  const dy = (toNode.position.y - fromNode.position.y) * SPACING_Y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function oppositeSide(side) {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  return "left";
}

function renderNode(node, offsetX, offsetY, isActive, dbOps = []) {
  const center = nodeCenter(node, offsetX, offsetY);
  const nodeClass = getNodeClass(node.type);
  const asyncClass = node.async ? "node-async" : "";
  const labelLines = splitLabel(node.id, 18).slice(0, 2);
  const callName =
    node.callName && node.callName !== node.id ? splitLabel(node.callName, 20)[0] : node.type;
  const asyncTag = node.async
    ? `<text class="node-async-tag" x="${center.x}" y="${center.y - 24}" text-anchor="middle">async</text>`
    : "";

  const nodeLiveInfo = getNodeLiveInfo(node.id, state.selectedWorkflow);
  const nodeStatus = nodeLiveInfo?.status || null;
  const liveHighlightClass = nodeStatus
    ? `step-highlight-node ${nodeStatus === "failed" ? "danger" : nodeStatus === "alert" ? "alert" : "success"}`
    : "";
  const repeatBadge = renderNodeRepeatBadge(
    center,
    node,
    nodeLiveInfo?.executionCount || 0,
  );

  const tooltip = zoralNodeTooltip(node);

  const isCodeMatch = state.searchScope === "code" && state.query && 
    (!state.selectedWorkflow || state.query.toLowerCase().trim() !== state.selectedWorkflow.name.toLowerCase().trim()) && (
      matches(node.inputScript || "", state.query) ||
      matches(node.outputScript || "", state.query) ||
      matches(node.conditionScript || "", state.query)
    );
  const matchCodeClass = isCodeMatch ? "match-code" : "";

  if (node.type === "zbo-caller") {
    const callerLines = splitLabel(node.name, 20).slice(0, 3);
    const firstY = center.y - ((callerLines.length - 1) * 7);
    const callerLabel = callerLines
      .map(
        (line, index) =>
          `<text class="node-label" x="${center.x}" y="${firstY + index * 14}" text-anchor="middle">${escapeHtml(line)}</text>`,
      )
      .join("");
    return `
      <g class="node-group zbo-caller-node" data-node-id="${escapeAttr(node.id)}">
        <title>ZBO Area: ${escapeHtml(node.name)}</title>
        <rect class="node-shape" x="${center.x - 76}" y="${center.y - 34}" width="152" height="68" rx="10"></rect>
        ${callerLabel}
      </g>
    `;
  }

  if (node.type === "condition") {
    return `
      <g class="node-group ${nodeClass} ${asyncClass} ${isActive ? "active" : ""} ${matchCodeClass} ${liveHighlightClass}" data-node-id="${escapeAttr(node.id)}">
        <title>${escapeHtml(tooltip)}</title>
        <polygon class="node-shape" points="${center.x},${center.y - 46} ${center.x + 74},${center.y} ${center.x},${center.y + 46} ${center.x - 74},${center.y}"></polygon>
        ${renderNodeText(center, labelLines, callName)}
        ${asyncTag}
        ${renderDbBadge(center, node, dbOps)}
        ${repeatBadge}
      </g>
    `;
  }

  // BPMN-style event nodes (match the source Zoral diagram icons). Same size
  // for gateway and process; no baked-in colour on process (the green/red/pink
  // comes from selection / live-API highlighting).
  if (node.type === "event/gateway") {
    // Event-based gateway: double circle + pentagon (no diamond)
    const pent = [[0, -9.5], [9.04, -2.94], [5.59, 7.69], [-5.59, 7.69], [-9.04, -2.94]]
      .map(([dx, dy]) => `${center.x + dx},${center.y + dy}`).join(" ");
    return `
      <g class="node-group ${nodeClass} ${asyncClass} ${isActive ? "active" : ""} ${matchCodeClass} ${liveHighlightClass}" data-node-id="${escapeAttr(node.id)}">
        <title>${escapeHtml(tooltip)}</title>
        <circle class="node-shape" cx="${center.x}" cy="${center.y}" r="23"></circle>
        <circle class="node-event-icon" cx="${center.x}" cy="${center.y}" r="18" fill="none"></circle>
        <polygon class="node-event-icon" points="${pent}" fill="none"></polygon>
        <text class="node-label node-event-caption" x="${center.x}" y="${center.y + 39}" text-anchor="middle">${escapeHtml(labelLines[0] || "")}</text>
        ${asyncTag}
        ${renderDbBadge(center, node, dbOps)}
        ${repeatBadge}
      </g>
    `;
  }

  if (node.type === "event/process" || node.type === "event/process/failed") {
    const failed = node.type === "event/process/failed";
    const icon = failed
      ? `<path class="node-event-icon" d="M ${center.x - 6} ${center.y - 6} L ${center.x + 6} ${center.y + 6} M ${center.x + 6} ${center.y - 6} L ${center.x - 6} ${center.y + 6}" fill="none"></path>`
      : `<path class="node-event-icon" d="M ${center.x - 7} ${center.y + 1} L ${center.x - 2} ${center.y + 6} L ${center.x + 8} ${center.y - 6}" fill="none"></path>`;
    return `
      <g class="node-group ${nodeClass} ${asyncClass} ${isActive ? "active" : ""} ${matchCodeClass} ${liveHighlightClass}" data-node-id="${escapeAttr(node.id)}">
        <title>${escapeHtml(tooltip)}</title>
        <circle class="node-shape" cx="${center.x}" cy="${center.y}" r="23"></circle>
        ${icon}
        <text class="node-label node-event-caption" x="${center.x}" y="${center.y + 39}" text-anchor="middle">${escapeHtml(labelLines[0] || "")}</text>
        ${asyncTag}
        ${renderDbBadge(center, node, dbOps)}
        ${repeatBadge}
      </g>
    `;
  }

  const rx = node.type === "start/message" || node.type === "end" ? 40 : 8;
  return `
    <g class="node-group ${nodeClass} ${asyncClass} ${isActive ? "active" : ""} ${matchCodeClass} ${liveHighlightClass}" data-node-id="${escapeAttr(node.id)}">
      <title>${escapeHtml(tooltip)}</title>
      <rect class="node-shape" x="${center.x - 76}" y="${center.y - 38}" width="152" height="76" rx="${rx}"></rect>
      ${renderNodeText(center, labelLines, callName)}
      ${asyncTag}
      ${renderDbBadge(center, node, dbOps)}
      ${repeatBadge}
    </g>
  `;
}

function renderNodeRepeatBadge(center, node, executionCount) {
  if (!Number.isFinite(executionCount) || executionCount < 2) return "";
  const countText = String(Math.floor(executionCount));
  const label = `x${countText}`;
  const height = 24;
  const radius = height / 2;
  const width = Math.max(38, 26 + countText.length * 8);
  const size = nodeSize(node);
  const x = center.x - size.width / 2 - 8;
  const y = center.y - size.height / 2 - 12;
  const path = [
    `M ${x + radius} ${y}`,
    `H ${x + width - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width} ${y + radius}`,
    `V ${y + height - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + width - radius} ${y + height}`,
    `H ${x + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x} ${y + height - radius}`,
    `V ${y + radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    "Z",
  ].join(" ");

  return `
    <g class="node-repeat-badge" aria-label="Executed ${countText} times">
      <title>Executed ${countText} times</title>
      <path class="node-repeat-badge-shape" d="${path}"></path>
      <text class="node-repeat-badge-text" x="${x + width / 2}" y="${y + 16}" text-anchor="middle">${label}</text>
    </g>
  `;
}

function zoralNodeTooltip(node) {
  const parts = [node.id];
  if (node.callName && node.callName !== node.id) parts.push(node.callName);
  if (node.type) parts.push(`(${node.type})`);
  return parts.join(" — ");
}

// Show DB usage as a compact database icon linked to the node by a short
// connector line, with the touched tables listed to the right of the icon so
// the table name and its operation chips (SEL/INS/UPD/DEL) are visible at a
// glance. The full untruncated list is also kept in a hover tooltip.
function renderDbBadge(center, node, ops) {
  const groups = groupOpsByTable(ops);
  if (!groups.length) return "";
  const size = nodeSize(node);
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const anchorX = center.x + halfW * 0.5;
  const anchorY = center.y - halfH;
  const iconCx = anchorX + 12;
  const iconCy = anchorY - 26;
  const tooltip = groups.map((group) => `${group.table} [${group.ops.join(" | ")}]`).join("\n");
  const lineHeight = 14;
  const listX = iconCx + 13;
  const listTop = iconCy - ((groups.length - 1) * lineHeight) / 2;
  const rows = groups
    .map((group, index) => {
      const y = listTop + index * lineHeight + 3;
      const opSpans = group.ops
        .map(
          (op) =>
            `<tspan class="db-op-code op-${escapeAttr(op)}" dx="5">${escapeHtml(opCode(op))}</tspan>`,
        )
        .join("");
      return `<text class="node-db-list" x="${listX}" y="${y}"><tspan class="db-table-name">${escapeHtml(truncate(group.table, 22))}</tspan>${opSpans}</text>`;
    })
    .join("");
  return `
    <g class="node-db-icon-group">
      <title>${escapeHtml(tooltip)}</title>
      <path class="node-db-connector" d="M ${anchorX} ${anchorY} L ${iconCx} ${iconCy + 9}"></path>
      ${renderDbCylinder(iconCx, iconCy)}
      ${rows}
    </g>
  `;
}

function renderDbCylinder(cx, cy) {
  const rx = 9;
  const ry = 3.2;
  const bodyH = 15;
  const top = cy - bodyH / 2;
  const bottom = cy + bodyH / 2;
  return `
    <path class="node-db-cyl-body" d="M ${cx - rx} ${top} L ${cx - rx} ${bottom} A ${rx} ${ry} 0 0 0 ${cx + rx} ${bottom} L ${cx + rx} ${top} Z"></path>
    <ellipse class="node-db-cyl-top" cx="${cx}" cy="${top}" rx="${rx}" ry="${ry}"></ellipse>
    <path class="node-db-cyl-band" d="M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}"></path>
  `;
}

function groupOpsByTable(ops) {
  const byTable = new Map();
  for (const op of ops || []) {
    if (!op.table) continue;
    const operations = byTable.get(op.table) || new Set();
    operations.add(String(op.operation || "").toLowerCase());
    byTable.set(op.table, operations);
  }
  return [...byTable.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([table, operations]) => ({
      table,
      ops: [...operations].sort(),
    }));
}

function opCode(op) {
  return (
    {
      select: "SEL",
      insert: "INS",
      update: "UPD",
      delete: "DEL",
      upsert: "UPS",
      mutation: "MUT",
    }[op] || String(op || "").toUpperCase().slice(0, 3)
  );
}

function renderNodeText(center, labelLines, callName) {
  const firstY = labelLines.length > 1 ? center.y - 8 : center.y - 2;
  const labels = labelLines
    .map((line, index) => {
      return `<text class="node-label" x="${center.x}" y="${firstY + index * 14}" text-anchor="middle">${escapeHtml(line)}</text>`;
    })
    .join("");
  return `
    ${labels}
    <text class="node-type" x="${center.x}" y="${center.y + 25}" text-anchor="middle">${escapeHtml(callName || "")}</text>
  `;
}

function getNodeClass(type) {
  if (type === "start/message") return "node-start";
  if (type === "end") return "node-end";
  if (type === "condition" || type === "rules") return "node-condition";
  if (type === "parametersTable") return "node-parameters";
  if (type === "event/gateway") return "node-event-gateway";
  if (type === "event/process") return "node-event-process";
  if (type === "event/process/failed") return "node-event-failed";
  return "node-process";
}

function splitLabel(text, max) {
  const raw = String(text || "");
  if (raw.length <= max) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > max && chunks.length < 3) {
    const cut = Math.max(rest.lastIndexOf("_", max), rest.lastIndexOf(" ", max));
    const index = cut > 5 ? cut : max;
    chunks.push(rest.slice(0, index));
    rest = rest.slice(index).replace(/^[_\s]+/, "");
  }
  if (rest) chunks.push(rest.length > max ? `${rest.slice(0, max - 1)}...` : rest);
  return chunks;
}

function renderDetails() {
  if (state.activeMode === "live") {
    if (window.WorkflowLive && window.WorkflowLive.renderDetail) {
      window.WorkflowLive.renderDetail();
    }
    return;
  }
  if (state.activeMode === "database") {
    renderDatabaseDetails();
    return;
  }
  if (state.activeMode === "zbo") {
    renderZboDetails();
    return;
  }

  const workflow = state.selectedWorkflow;
  if (!workflow) {
    els.detailContent.innerHTML = renderEmpty("Select a workflow.");
    return;
  }

  if (state.activeTab === "overview") {
    els.detailContent.innerHTML = renderOverview(workflow);
  } else if (state.activeTab === "node") {
    els.detailContent.innerHTML =
      state.selectedEdge && !state.selectedNodeId
        ? renderEdgeDetail(workflow)
        : renderNodeDetail(workflow);
  } else if (state.activeTab === "db") {
    els.detailContent.innerHTML = renderDbGraphql(workflow);
  } else if (state.activeTab === "inbound") {
    els.detailContent.innerHTML = renderInbound(workflow);
  } else if (state.activeTab === "live-exec") {
    els.detailContent.innerHTML = renderLiveExecDetail(workflow);
  }
}

function renderZboDetails() {
  const area = state.selectedZboArea;
  if (!area) {
    els.detailContent.innerHTML = renderEmpty("Select a ZBO area.");
    return;
  }

  if (state.activeTab === "overview") {
    els.detailContent.innerHTML = renderZboOverview(area);
  } else if (state.activeTab === "node") {
    els.detailContent.innerHTML = state.selectedZboNodeId
      ? renderZboNodeDetail(area)
      : renderZboArtifacts(area);

    // Bring the first matched artifact into view (scroll the detail pane only).
    const hit = els.detailContent.querySelector(".artifact-hit");
    if (hit) setTimeout(() => hit.scrollIntoView({ block: "nearest" }), 0);

    const backBtn = els.detailContent.querySelector("#deselectZboNodeBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        state.selectedZboNodeId = null;
        renderZboDetails();
        if (state.selectedZboArea) renderZboMap(state.selectedZboArea);
      });
    }
  } else if (state.activeTab === "db") {
    els.detailContent.innerHTML = renderZboDbGraphql(area);
  } else if (state.activeTab === "inbound") {
    els.detailContent.innerHTML = renderZboCalls(area);
  }
}

function renderZboOverview(area) {
  return `
    <section class="detail-section">
      <h3>ZBO Area</h3>
      ${renderKv("Area", area.name)}
      ${renderKv("Queries", area.queryIds.length)}
      ${renderKv("Schemas", area.schemaIds.length)}
      ${renderKv("Grids", area.gridIds.length)}
      ${renderKv("Plugins", area.pluginIds.length)}
      ${renderKv("Actions", (area.actions || []).length)}
    </section>
    <section class="detail-section">
      <h3>Fields</h3>
      <div class="small-list">
        ${(area.fields || []).slice(0, 160).map((field) => `<span class="badge">${escapeHtml(field)}</span>`).join("") || '<span class="muted">No fields indexed.</span>'}
      </div>
    </section>
    <section class="detail-section">
      <h3>Field Mapping</h3>
      ${renderZboFieldMappingTable(area.fieldMappings || [], { dbOps: area.graphqlOperations || [] })}
    </section>
  `;
}

function renderZboArtifacts(area) {
  return `
    <section class="detail-section">
      <h3>Query Files</h3>
      ${renderArtifactList(area.queryIds, "query")}
    </section>
    <section class="detail-section">
      <h3>Schema Files</h3>
      ${renderArtifactList(area.schemaIds, "schema")}
    </section>
    <section class="detail-section">
      <h3>Grid Files</h3>
      ${renderArtifactList(area.gridIds, "grid")}
    </section>
    <section class="detail-section">
      <h3>Plugin Files</h3>
      ${renderArtifactList(area.pluginIds, "plugin")}
    </section>
  `;
}

function renderArtifactList(ids, kind) {
  if (!ids.length) return '<p class="muted">No artifacts indexed.</p>';
  return `
    <div class="artifact-list" style="display: flex; flex-direction: column; gap: 8px;">
      ${ids
        .slice(0, 140)
        .map((id) => {
          // Raw source for all kinds (query/plugin .gql/.js, schema/grid .json).
          let code = "";
          if (kind === "query") {
            code = state.zboQueries.find(q => q.id === id)?.code || "";
          } else if (kind === "plugin") {
            code = state.zboPlugins.find(p => p.id === id)?.code || "";
          } else if (kind === "schema") {
            code = state.zboSchemas.find(s => s.id === id)?.code || "";
          } else if (kind === "grid") {
            code = state.zboGrids.find(g => g.id === id)?.code || "";
          }

          // Highlight + auto-open the artifact when its content matches the search.
          const isHit = state.searchScope === "code" && state.query && matches(code, state.query);

          if (code) {
            return `
              <details class="artifact-details${isHit ? " artifact-hit" : ""}" ${isHit ? "open" : ""} style="border: 1px solid ${isHit ? "#ff8f00" : "var(--line)"}; border-radius: 6px; background: var(--surface-2); overflow: hidden;">
                <summary style="padding: 6px 10px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 13px; user-select: none;">
                  <span class="badge" style="background: rgba(14, 165, 233, 0.12); color: #0ea5e9; font-weight: 600;">${escapeHtml(kind)}</span>
                  <span style="color: var(--text); font-family: monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(id)}</span>
                  ${isHit ? `<span class="badge" style="background: rgba(255,143,0,0.15); color: #ff8f00; font-weight: 700;">match</span>` : ""}
                </summary>
                <div class="artifact-code-wrap" style="padding: 10px; border-top: 1px solid var(--line); background: #0f172a; margin: 0;">
                  <button type="button" class="artifact-copy-btn"
                    data-copy-zbo-artifact
                    data-artifact-kind="${escapeAttr(kind)}"
                    data-artifact-id="${escapeAttr(id)}"
                    aria-label="Copy artifact source" title="Copy artifact source">COPY</button>
                  <pre class="code-block" style="margin: 0; padding: 0; background: transparent; color: #f8fafc; font-family: monospace; font-size: 12px; line-height: 1.4; overflow: auto; max-height: 250px; user-select: text;">${isHit ? highlightSearchHits(code, state.query) : escapeHtml(code)}</pre>
                </div>
              </details>
            `;
          } else {
            return `
              <div class="artifact-row" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font-size: 13px;">
                <span class="badge">${escapeHtml(kind)}</span>
                <span style="font-family: monospace; color: var(--text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(id)}</span>
              </div>
            `;
          }
        })
        .join("")}
      ${ids.length > 140 ? `<p class="muted">Showing first 140 of ${ids.length}.</p>` : ""}
    </div>
  `;
}

function renderZboNodeDetail(area) {
  const diagram = buildZboFlowDiagram(area);
  const node = diagram.nodes.find(n => n.id === state.selectedZboNodeId);
  if (!node) return renderEmpty("No node selected.");

  let codeHtml = "";
  if (node.kind === "gql") {
    const query = state.zboQueries.find(q => q.id === node.label);
    if (query && query.code) {
      codeHtml = renderCodeSection("GraphQL Query Code", query.code);
    }
  } else if (node.kind === "workflow" || node.kind === "condition") {
    codeHtml = `
      <section class="detail-section">
        <h3>Referenced Workflow</h3>
        <p>This node calls the Zoral workflow:</p>
        <div style="margin-top: 8px;">
          <a href="#" data-workflow-link="${escapeAttr(node.label)}" class="workflow-link" style="font-weight: 600; font-size: 14px; text-decoration: underline; color: var(--accent);">
            ${escapeHtml(node.label)}
          </a>
        </div>
      </section>
    `;
  }

  const opsHtml = node.dbOps && node.dbOps.length ? `
    <section class="detail-section">
      <h3>Node DB Operations</h3>
      ${renderOperationsTable(node.dbOps, { showNode: false })}
    </section>
  ` : "";

  return `
    <section class="detail-section" style="padding-bottom: 8px; border-bottom: 1px solid var(--line);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 15px;">ZBO Flow Node Details</h3>
        <button type="button" class="btn-copy-list" id="deselectZboNodeBtn" style="padding: 2px 6px; font-size: 11px;">Back</button>
      </div>
      ${renderKv("Node ID", node.id)}
      ${renderKv("Label", node.label)}
      ${renderKv("Kind/Type", node.kind)}
      ${node.subtitle ? renderKv("Subtitle", node.subtitle) : ""}
    </section>

    ${codeHtml}
    ${opsHtml}
  `;
}

function renderZboDbGraphql(area) {
  return `
    <section class="detail-section">
      <h3>GraphQL / DB Operations</h3>
      ${renderOperationsTable(area.graphqlOperations || [], { showNode: false })}
    </section>
    <section class="detail-section">
      <h3>Queries</h3>
      ${renderZboQueryTable(getAreaQueries(area))}
    </section>
  `;
}

function renderZboQueryTable(queries) {
  if (!queries.length) return '<p class="muted">No queries indexed.</p>';
  return `
    <table class="table">
      <thead><tr><th>Query</th><th>Operation</th><th>Variables</th></tr></thead>
      <tbody>
        ${queries
          .slice(0, 160)
          .map(
            (query) => `
              <tr>
                <td>${escapeHtml(query.id)}</td>
                <td>${escapeHtml(query.operationName || query.operationType || "-")}</td>
                <td>${escapeHtml((query.variables || []).map((item) => item.name).join(", ") || "-")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderZboCalls(area) {
  return `
    <section class="detail-section">
      <h3>Page Inbound</h3>
      <div class="small-list">
        ${(area.inboundPages || [])
          .map((item) => `<span class="badge">${escapeHtml(item.area)} via ${escapeHtml(item.route || "-")}</span>`)
          .join("") ||
          [
            ...area.schemaIds.map((id) => `schema: ${id}`),
            ...area.gridIds.map((id) => `grid: ${id}`),
            ...area.pluginIds.map((id) => `plugin: ${id}`),
          ]
            .slice(0, 120)
            .map((item) => `<span class="badge">${escapeHtml(item)}</span>`)
            .join("") ||
          '<span class="muted">No page inbound/artifacts indexed.</span>'}
      </div>
    </section>

    <section class="detail-section">
      <h3>Actions</h3>
      ${renderZboActionsTable(area.actions || [])}
    </section>

    <section class="detail-section">
      <h3>Zoral Calls</h3>
      ${
        (area.zoralCalls || []).length
          ? `<table class="table">
              <thead><tr><th>Workflow / Action ID</th><th>Source</th><th>File</th></tr></thead>
              <tbody>
                ${area.zoralCalls
                  .map(
                    (call) => `
                      <tr>
                        <td>${renderWorkflowInline(call.workflow)}</td>
                        <td>${escapeHtml(call.source || "-")}</td>
                        <td>${escapeHtml(call.sourcePath || "-")}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>`
          : '<p class="muted">No direct Zoral calls detected.</p>'
      }
    </section>

    <section class="detail-section">
      <h3>Outbound DB/GQL</h3>
      ${renderOperationsTable(area.graphqlOperations || [], { showNode: false })}
    </section>

    <section class="detail-section">
      <h3>Outbound Pages</h3>
      ${renderZboNavigationTable(area.outboundPages || [])}
    </section>
  `;
}

function renderZboActionsTable(actions) {
  if (!actions.length) return '<p class="muted">No actions indexed.</p>';
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Action</th>
          <th>Event</th>
          <th>Zoral Calls</th>
          <th>DB/GQL</th>
          <th>Navigation / Query / Plugin</th>
        </tr>
      </thead>
      <tbody>
        ${actions
          .map(
            (action) => `
              <tr>
                <td>${escapeHtml(action.label || action.name)}</td>
                <td>${escapeHtml(displayActionEvent(action.eventType) || action.type || action.operationType || "-")}${action.userTriggered ? " (user)" : ""}</td>
                <td>${(action.zoralCalls || []).map((call) => renderWorkflowInline(call.workflow)).join("<br>") || "-"}</td>
                <td>${renderInlineOps(action.dbOperations || [])}</td>
                <td>${renderActionRefs(action)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderActionRefs(action) {
  const nav = (action.navigationTargets || [])
    .map((target) => `${target.route}${target.condition ? ` if ${target.condition}` : ""}`);
  const refs = [...nav, ...(action.queryRefs || []), ...(action.pluginRefs || [])];
  return refs.length ? escapeHtml(refs.join(", ")) : "-";
}

function renderZboNavigationTable(targets) {
  if (!targets.length) return '<p class="muted">No outbound page navigation indexed.</p>';
  return `
    <table class="table">
      <thead><tr><th>Target ZBO</th><th>Route</th><th>Condition</th><th>Source</th></tr></thead>
      <tbody>
        ${targets
          .map(
            (target) => `
              <tr>
                <td>${escapeHtml(target.targetArea || "-")}</td>
                <td>${escapeHtml(target.route || "-")}</td>
                <td>${escapeHtml(target.condition || "-")}</td>
                <td>${escapeHtml(target.sourcePath || "-")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderInlineOps(ops) {
  const groups = groupOpsByTable(ops);
  if (!groups.length) return "-";
  return groups
    .map((group) => `${escapeHtml(group.table)} ${group.ops.map((op) => `[${escapeHtml(opCode(op))}]`).join(" ")}`)
    .join("<br>");
}

function getAreaQueries(area) {
  const ids = new Set(area.queryIds || []);
  return state.zboQueries.filter((query) => ids.has(query.id));
}

function renderOverview(workflow) {
  const firstNodes = workflow.edges
    .filter((edge) => /^start/i.test(edge.from))
    .map((edge) => edge.to);
  return `
    <section class="detail-section">
      <h3>Workflow</h3>
      ${renderKv("Name", workflow.name)}
      ${renderKv("Type", workflow.type)}
      ${renderKv("Format", workflow.format || "-")}
      ${renderKv("Source", workflow.sourcePath)}
      ${renderKv("Layout", workflow.layoutPath || "-")}
      ${workflow.parseWarning ? `<p class="warning-text">${escapeHtml(workflow.parseWarning)}</p>` : ""}
    </section>

    <section class="detail-section">
      <h3>Entry</h3>
      ${renderKv("Start flow", firstNodes.length ? firstNodes.join(", ") : "-")}
      ${renderKv("Required input", workflow.dataContext.requiredFields?.join(", ") || "-")}
      <div class="small-list">
        ${(workflow.dataContext.inputFields || []).map((field) => `<span class="badge">${escapeHtml(field)}</span>`).join("") || '<span class="muted">No input fields indexed</span>'}
      </div>
    </section>

    <section class="detail-section">
      <h3>Workflow Calls</h3>
      <div class="small-list">
        ${workflow.calledWorkflows.map((name) => `<span class="badge accent">${escapeHtml(name)}</span>`).join("") || '<span class="muted">No process workflow calls detected</span>'}
      </div>
    </section>

    <section class="detail-section">
      <h3>ZBO Field Mapping</h3>
      ${renderWorkflowZboFieldMappings(workflow, 8)}
    </section>

    <section class="detail-section">
      <h3>Indexed Fields</h3>
      <div class="small-list">
        ${workflow.fieldRefs.slice(0, 120).map((field) => `<span class="badge">${escapeHtml(field)}</span>`).join("") || '<span class="muted">No field references indexed</span>'}
      </div>
    </section>
  `;
}

function renderEdgeDetail(workflow) {
  const { from, to } = state.selectedEdge;
  const edge =
    workflow.edges.find((item) => item.from === from && item.to === to) || { from, to };
  const fromNode = workflow.nodes.find((item) => item.id === from);
  const toNode = workflow.nodes.find((item) => item.id === to);
  const condition = edge.condition && edge.condition !== "else" ? edge.condition : "";
  return `
    <section class="detail-section">
      <h3>Edge</h3>
      ${renderKv("From", from)}
      ${renderKv("To", to)}
      ${renderKv("Branch", edge.condition === "else" ? "else (default)" : edge.kind || "normal")}
    </section>

    ${
      condition
        ? renderCodeSection("Condition", condition)
        : `<section class="detail-section"><h3>Condition</h3><p class="muted">No explicit condition (default / sequential flow).</p></section>`
    }

    <section class="detail-section">
      <h3>Connected Nodes</h3>
      <div class="small-list">
        <button class="link-button" type="button" data-jump-node="${escapeAttr(from)}">${escapeHtml(from)} (${escapeHtml(fromNode?.type || "?")})</button>
        <span class="muted">&rarr;</span>
        <button class="link-button" type="button" data-jump-node="${escapeAttr(to)}">${escapeHtml(to)} (${escapeHtml(toNode?.type || "?")})</button>
      </div>
    </section>
  `;
}

function renderNodeDetail(workflow) {
  const node =
    workflow.nodes.find((item) => item.id === state.selectedNodeId) || workflow.nodes[0];
  if (!node) return renderEmpty("No node selected.");
  const outgoing = workflow.edges.filter((edge) => edge.from === node.id);
  const incoming = workflow.edges.filter((edge) => edge.to === node.id);
  const nodeOps = workflow.dbOperations.filter((op) => op.nodeId === node.id);
  const nodeSnippets = workflow.graphqlSnippets.filter((item) => item.nodeId === node.id);

  return `
    <section class="detail-section">
      <h3>Node</h3>
      ${renderWorkflowRefRow("ID", node.id)}
      ${renderKv("Type", node.type)}
      ${renderWorkflowRefRow("Call name", node.callName || "")}
      ${renderKv("Version", node.version ?? "-")}
      ${renderKv("Incoming", incoming.map(edgeLabel).join(", ") || "-")}
      ${renderKv("Outgoing", outgoing.map(edgeLabel).join(", ") || "-")}
    </section>

    <section class="detail-section">
      <h3>Dependencies</h3>
      <div class="small-list">
        ${node.dependencies.map((dep) => `<span class="badge">${escapeHtml(dep)}</span>`).join("") || '<span class="muted">No dependencies</span>'}
      </div>
    </section>

    <section class="detail-section">
      <h3>Input</h3>
      ${renderIoRows(node.inputRows || [], workflow.dataContext.requiredFields || [], workflow, node)}
    </section>

    <section class="detail-section">
      <h3>Output</h3>
      ${renderIoRows(node.outputRows || [])}
    </section>

    ${node.conditionScript ? renderCodeSection("Condition / Rules", node.conditionScript) : ""}
    ${node.inputScript ? renderCodeSection("Input Script", node.inputScript) : ""}
    ${node.outputScript ? renderCodeSection("Output Script", node.outputScript) : ""}

    <section class="detail-section">
      <h3>Node DB / GraphQL</h3>
      ${renderOperationsTable(nodeOps, { showNode: false })}
      ${nodeSnippets.map((item) => renderCodeSection(`GraphQL Snippet`, item.snippet)).join("")}
    </section>
  `;
}

function renderIoRows(rows, requiredFields = [], workflow = null, node = null) {
  if (!rows.length) return '<p class="muted">No structured fields detected.</p>';
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type/Source</th>
          <th>Req</th>
          <th>Origin</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.field)}</td>
                <td>${escapeHtml(row.type || row.source || "-")}</td>
                <td>${row.required || requiredFields.includes(row.field) ? "Yes" : ""}</td>
                <td>${escapeHtml(getInputOrigin(row, workflow, node))}</td>
                <td>${escapeHtml(row.description || "")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function getInputOrigin(row, workflow, node) {
  if (!workflow || !node) return "";
  if (row.source === "input") {
    const zboSources = getZboMappingsForField(workflow, row.field).map((item) => item.area);
    return zboSources.length ? `Workflow input; ZBO: ${unique(zboSources).join(", ")}` : "Workflow input";
  }
  if (row.source === "result" || row.source === "variables") return "Current node request";
  if (row.source === "steps") {
    return workflow.nodes.some((item) => item.id === row.field) ? row.field : "Previous step";
  }

  const ancestors = getAncestors(workflow, node.id);
  const writers = workflow.nodes.filter((candidate) => {
    return (
      ancestors.has(candidate.id) &&
      (candidate.writes || []).some(
        (write) => write.scope === row.source && write.field === row.field,
      )
    );
  });
  if (writers.length) return writers.map((writer) => writer.id).join(", ");
  if (row.source === "globalVariables" || row.source === "tags") return "Workflow/global state";
  return "";
}

function getAncestors(workflow, nodeId) {
  const parents = new Map();
  for (const edge of workflow.edges) {
    const list = parents.get(edge.to) || [];
    list.push(edge.from);
    parents.set(edge.to, list);
  }

  const visited = new Set();
  const stack = [...(parents.get(nodeId) || [])];
  while (stack.length) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(parents.get(current) || []));
  }
  return visited;
}

function edgeLabel(edge) {
  return `${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`;
}

function renderDbGraphql(workflow) {
  return `
    <section class="detail-section">
      <h3>Database / GraphQL Operations</h3>
      ${renderOperationsTable(workflow.dbOperations)}
    </section>
    <section class="detail-section">
      <h3>GraphQL Snippets</h3>
      ${
        workflow.graphqlSnippets
          .map((item) => renderCodeSection(item.nodeId, item.snippet))
          .join("") || '<p class="muted">No GraphQL snippets detected.</p>'
      }
    </section>
  `;
}

function renderOperationsTable(ops, options = {}) {
  if (!ops.length) return '<p class="muted">No DB or GraphQL operation detected.</p>';
  const showNode = options.showNode !== false;
  return `
    <table class="table">
      <thead>
        <tr>
          ${showNode ? "<th>Node</th>" : ""}
          <th>Source</th>
          <th>Operation</th>
          <th>Table / Root</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${ops
          .map(
            (op) => `
          <tr>
            ${showNode ? `<td>${escapeHtml(op.nodeId)}</td>` : ""}
            <td>${escapeHtml(op.source)}</td>
            <td>${escapeHtml(op.operation)}</td>
            <td>${escapeHtml(op.table)}</td>
            <td>${escapeHtml(op.confidence || "-")}</td>
          </tr>
        `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderWorkflowZboFieldMappings(workflow, limit = 80) {
  const mappings = workflow.zboFieldMappings || [];
  if (!mappings.length) return '<p class="muted">No ZBO field mapping inferred.</p>';
  return renderZboFieldMappingTable(mappings.slice(0, limit), {
    footer: mappings.length > limit ? `Showing first ${limit} of ${mappings.length}.` : "",
    dbOps: workflow.graphqlOperations || [],
  });
}

// Fuzzy join key: drop separators and case so GraphQL variable names
// (camelCase, e.g. nationalId) align with DB column names (snake_case,
// e.g. national_id) extracted from the GraphQL/SQL text.
function normalizeBindingKey(name) {
  return String(name || "").replace(/[_\s-]+/g, "").toLowerCase();
}

// Join one inferred ZBO field mapping to concrete DB table.column bindings by
// matching the mapping's candidate names against the columns already detected
// on the area/workflow GraphQL & SQL operations. Heuristic — see README
// "Some ZBO field/payload mappings are heuristic."
function findDbBindingsForMapping(mapping, dbOps) {
  if (!mapping || !Array.isArray(dbOps) || !dbOps.length) return [];
  const rawCandidates = [
    mapping.zoralInputField,
    mapping.graphqlVariable,
    mapping.zboField,
  ].filter(Boolean);
  if (!rawCandidates.length) return [];
  const normCandidates = new Set(rawCandidates.map(normalizeBindingKey));
  const rawSet = new Set(rawCandidates);

  const results = [];
  const seen = new Set();
  for (const op of dbOps) {
    if (!op || !op.table) continue;
    for (const col of op.columns || []) {
      const colKey = normalizeBindingKey(col);
      if (!colKey || !normCandidates.has(colKey)) continue;
      // Very short keys (id, no, dt) only bind on a raw exact name match to
      // avoid spraying generic columns across every table.
      if (colKey.length < 3 && !rawSet.has(col)) continue;
      const confidence = rawSet.has(col) ? "high" : "medium";
      const key = `${op.table}.${col}:${op.operation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        table: op.table,
        column: col,
        operation: op.operation,
        operationName: op.operationName || "",
        confidence,
      });
    }
  }
  // High-confidence (exact-name) bindings first; cap to keep the cell readable.
  results.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
  return results.slice(0, 6);
}

function renderDbBindingCell(bindings) {
  if (!bindings.length) return '<span class="muted">-</span>';
  return bindings
    .map(
      (b) =>
        `<div class="db-binding"><code>${escapeHtml(b.table)}.${escapeHtml(b.column)}</code> ` +
        `<span class="badge">${escapeHtml(b.operation)}${b.operationName ? " · " + escapeHtml(b.operationName) : ""}</span> ` +
        `<span class="muted">${escapeHtml(b.confidence)}</span></div>`,
    )
    .join("");
}

function renderZboFieldMappingTable(mappings, options = {}) {
  if (!mappings.length) return '<p class="muted">No field mappings inferred.</p>';
  const dbOps = Array.isArray(options.dbOps) ? options.dbOps : null;
  const showBinding = dbOps !== null;
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Area</th>
          <th>ZBO Field</th>
          <th>GraphQL Var / Payload</th>
          <th>Zoral Input</th>
          ${showBinding ? "<th>DB Table.Field (via)</th>" : ""}
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${mappings
          .map(
            (mapping) => `
              <tr>
                <td>${escapeHtml(mapping.area || "-")}</td>
                <td>${escapeHtml(mapping.zboField || "-")}</td>
                <td>${escapeHtml(mapping.graphqlVariable || mapping.kind || "-")}</td>
                <td>${escapeHtml(mapping.zoralInputField || "-")}</td>
                ${showBinding ? `<td>${renderDbBindingCell(findDbBindingsForMapping(mapping, dbOps))}</td>` : ""}
                <td>${escapeHtml(mapping.confidence || "-")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
    ${options.footer ? `<p class="muted">${escapeHtml(options.footer)}</p>` : ""}
  `;
}

function getZboMappingsForField(workflow, field) {
  const target = normalizeSearchText(field);
  return (workflow.zboFieldMappings || []).filter(
    (mapping) => normalizeSearchText(mapping.zoralInputField) === target,
  );
}

function renderInbound(workflow) {
  const directZboCallers = (workflow.inboundZbo || []).filter((caller) => caller.via === "workflow");
  return `
    <section class="detail-section">
      <h3>Inbound Workflows</h3>
      ${
        workflow.inboundCallers.length
          ? `<table class="table">
              <thead>
                <tr><th>Workflow</th><th>Source</th></tr>
              </thead>
              <tbody>
                ${workflow.inboundCallers
                  .map(
                    (caller) => `
                    <tr>
                      <td><a class="workflow-link" href="${escapeAttr(makeWorkflowUrl(caller.workflow))}" target="_blank" rel="noreferrer">${escapeHtml(caller.workflow)}</a></td>
                      <td>${escapeHtml(caller.sourcePath)}</td>
                    </tr>
                  `,
                  )
                  .join("")}
              </tbody>
            </table>`
          : '<p class="muted">No inbound workflow callers detected.</p>'
      }
    </section>

    <section class="detail-section">
      <h3>Inbound from ZBO</h3>
      ${
        directZboCallers.length
          ? `<table class="table">
              <thead>
                <tr><th>Area</th><th>Via</th><th>Match</th><th>Confidence</th><th>Source</th></tr>
              </thead>
              <tbody>
                ${directZboCallers
                  .map(
                    (caller) => `
                      <tr>
                        <td>${renderZboAreaInline(caller.area)}</td>
                        <td>${escapeHtml(caller.via)}</td>
                        <td>${escapeHtml(caller.match)}</td>
                        <td>${escapeHtml(caller.confidence)}</td>
                        <td>${escapeHtml(caller.sourcePath || "-")}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>`
          : '<p class="muted">No direct ZBO callers detected.</p>'
      }
    </section>

    <section class="detail-section">
      <h3>Outbound Workflow Calls</h3>
      <div class="small-list">
        ${workflow.calledWorkflows.map((name) => `<span class="badge accent">${escapeHtml(name)}</span>`).join("") || '<span class="muted">No outbound process workflow calls detected.</span>'}
      </div>
    <section class="detail-section">
      <h3>Outbound Workflow Calls</h3>
      <div class="small-list">
        ${workflow.calledWorkflows.map((name) => `<span class="badge accent">${escapeHtml(name)}</span>`).join("") || '<span class="muted">No outbound process workflow calls detected.</span>'}
      </div>
    </section>
  `;
}

function renderLiveExecProcessContext(processContext, prefix) {
  if (!processContext) return "";
  const renderer = window.WorkflowLive?.renderPayloadTable;
  if (typeof renderer !== "function") return "";

  const blocks = [
    ["Global Variables", processContext.globalVariables, `${prefix}GlobalVariables`],
    ["Workflow Input", processContext.workflowInput, `${prefix}WorkflowInput`],
  ].filter(([, payload]) => payload !== null && payload !== undefined);

  if (blocks.length === 0) return "";
  return `
    <section class="live-process-context" style="margin-bottom:16px;">
      <h4 style="margin:0 0 10px; color:var(--accent);">Process Entry Context</h4>
      ${blocks.map(([title, payload, containerId]) => `
        <div style="margin-bottom:14px;">
          <div style="font-size:11px; font-weight:700; margin-bottom:6px;">${title}</div>
          ${renderer(payload, containerId)}
        </div>
      `).join("")}
    </section>
  `;
}

function findExecutedBranch(nodeId, step, workflow, steps) {
  const node = workflow?.nodes.find(n => n.id === nodeId);
  if (!node || !workflow || !steps) return null;

  const currentIdx = steps.findIndex(s => s === step);
  if (currentIdx === -1 || currentIdx >= steps.length - 1) return null;

  const nextStep = steps[currentIdx + 1];
  const nextStepName = nextStep.Name || nextStep.StepName || nextStep.ActivityName || nextStep.NodeName;
  const nextStepId = nextStep.ActivityId || nextStep.StepId || nextStep.NodeId;

  const outgoingEdges = workflow.edges.filter(e => e.from === nodeId);
  for (const edge of outgoingEdges) {
    const targetNode = workflow.nodes.find(n => n.id === edge.to);
    if (!targetNode) continue;

    const targetIdLower = targetNode.id.toLowerCase().trim();
    const targetCallLower = targetNode.callName ? targetNode.callName.toLowerCase().trim() : "";
    const nextNameLower = nextStepName ? nextStepName.toLowerCase().trim() : "";
    const nextIdLower = nextStepId ? nextStepId.toLowerCase().trim() : "";

    if (
      targetIdLower === nextIdLower ||
      targetIdLower === nextNameLower ||
      (targetCallLower && targetCallLower === nextIdLower) ||
      (targetCallLower && targetCallLower === nextNameLower)
    ) {
      return {
        label: edge.label || (edge.condition ? "If" : "Else"),
        target: targetNode.id
      };
    }
  }
  return null;
}

function findKeyValueRecursive(obj, searchKey) {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return undefined;

  const keyLower = searchKey.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === keyLower) {
      return obj[k];
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = findKeyValueRecursive(item, searchKey);
      if (res !== undefined) return res;
    }
  } else {
    for (const v of Object.values(obj)) {
      const res = findKeyValueRecursive(v, searchKey);
      if (res !== undefined) return res;
    }
  }
  return undefined;
}

function extractAndEvaluateVariables(script, stepInput, stepOutput, processContext) {
  if (!script) return null;

  const matches = script.match(/\b(input|globalVariables|global|variables|context|data)\.[a-zA-Z0-9_$]+(\.[a-zA-Z0-9_$]+)*/gi) || [];
  const results = {};
  const searchPayloads = [
    stepInput,
    stepOutput,
    processContext?.globalVariables,
    processContext?.workflowInput
  ].filter(p => p !== null && p !== undefined);

  const lookupValue = (path) => {
    const parts = path.split('.');
    const prefixes = ["input", "globalvariables", "global", "variables", "context", "data"];
    
    let keyPath = parts;
    if (parts.length > 1 && prefixes.includes(parts[0].toLowerCase())) {
      keyPath = parts.slice(1);
    }
    
    for (const payload of searchPayloads) {
      let current = payload;
      let found = true;
      for (const part of keyPath) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          found = false;
          break;
        }
      }
      if (found) return current;
    }
    
    const searchKey = keyPath[keyPath.length - 1];
    for (const payload of searchPayloads) {
      const foundVal = findKeyValueRecursive(payload, searchKey);
      if (foundVal !== undefined) return foundVal;
    }
    
    return undefined;
  };

  const uniquePaths = [...new Set(matches)];
  uniquePaths.forEach(path => {
    const val = lookupValue(path);
    if (val !== undefined) {
      results[path] = val;
    }
  });

  const jsKeywords = new Set([
    "true", "false", "null", "undefined", "if", "else", "return", "var", "let", "const", 
    "function", "typeof", "instanceof", "new", "this", "class", "import", "export"
  ]);
  const words = script.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
  const uniqueWords = [...new Set(words)];

  uniqueWords.forEach(word => {
    if (jsKeywords.has(word) || word.length < 2) return;
    if (uniquePaths.some(p => p.toLowerCase().split('.').includes(word.toLowerCase()))) return;
    
    const val = lookupValue(word);
    if (val !== undefined && typeof val !== 'function') {
      results[word] = val;
    }
  });

  return Object.keys(results).length > 0 ? results : null;
}

function renderLiveExecDetail(workflow) {
  if (state.liveHighlightedWorkflow !== workflow.name) {
    return `
      <div style="padding: 20px; text-align: center;" class="empty-state">
        <p>No live execution data is loaded for this workflow.</p>
        <p style="font-size:12px; margin-top:8px;" class="dim">Run or import a trace in the <strong>Live API</strong> tab, then click <strong>Highlight Path 🎯</strong>.</p>
      </div>
    `;
  }

  const steps = typeof window.WorkflowLive?.getSelectedProcessSteps === "function" 
    ? window.WorkflowLive.getSelectedProcessSteps() 
    : [];

  const processNode = typeof window.WorkflowLive?.getSelectedProcessNode === "function"
    ? window.WorkflowLive.getSelectedProcessNode()
    : null;

  if (!processNode) {
    return `
      <div style="padding: 20px; text-align: center;" class="empty-state">
        No active process run selected.
      </div>
    `;
  }

  const processContext = window.LivePresentation?.getProcessContext(processNode) || null;
  const entryNode = window.LivePresentation?.findWorkflowEntryNode(workflow) || workflow.nodes[0] || null;

  // If no node is selected in the diagram
  if (!state.selectedNodeId) {
    let statusBadgeClass = "badge";
    if (processNode.status === "completed") {
      statusBadgeClass = "badge success";
    } else if (processNode.status === "failed") {
      statusBadgeClass = "badge danger";
    } else {
      statusBadgeClass = "badge warning";
    }

    const durText = processNode.durationMs != null ? `${processNode.durationMs}ms` : "Unknown";
    const startText = processNode.start ? new Date(processNode.start).toLocaleString() : "Unknown";
    const endText = processNode.end ? new Date(processNode.end).toLocaleString() : "Unknown";

    return `
      <section class="detail-section" style="padding: 16px;">
        <h4 style="margin: 0 0 12px 0; color: var(--accent); font-weight: 700;">Live Process Execution Summary</h4>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div class="kv"><span>Workflow Name</span><strong>${escapeHtml(processNode.workflowName)}</strong></div>
          <div class="kv"><span>Request ID</span><span style="font-family:monospace; font-size:11px;">${processNode.requestId}</span></div>
          <div class="kv"><span>Status</span><span class="${statusBadgeClass}">${processNode.status.toUpperCase()}</span></div>
          <div class="kv"><span>Start Time</span><span>${startText}</span></div>
          <div class="kv"><span>End Time</span><span>${endText}</span></div>
          <div class="kv"><span>Duration</span><span>${durText}</span></div>
          ${processNode.error ? `<div class="kv" style="color:var(--danger);"><span>Error</span><span>${escapeHtml(processNode.error)}</span></div>` : ""}
          <div class="kv"><span>Total Executed Steps</span><span>${steps.length}</span></div>
        </div>
        <div style="margin-top: 20px; text-align: center; border: 1px dashed var(--line); border-radius: 8px; padding: 16px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 8px; color: var(--text-muted, #7e8aa3);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <div style="font-size: 12px; font-weight: 600;">Diagram Node Details</div>
          <div style="font-size: 11px;" class="dim">Select any highlighted node in the diagram to inspect its specific Live Input, Output, Status, and Execution details here.</div>
        </div>
      </section>
    `;
  }

  const nodeId = state.selectedNodeId;
  const nodeIdLower = nodeId.toLowerCase().trim();
  const node = workflow.nodes.find(n => n.id === nodeId);
  const nodeCallNameLower = node && node.callName ? node.callName.toLowerCase().trim() : null;
  const isEntryNode = entryNode?.id === nodeId;
  const processContextHtml = isEntryNode
    ? renderLiveExecProcessContext(processContext, "liveExecEntry")
    : "";

  const matchedSteps = steps.filter(step => {
    const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName;
    const stepNameLower = stepName ? stepName.toLowerCase().trim() : "";
    const activityId = step.ActivityId || step.StepId || step.NodeId;
    const activityIdLower = activityId ? activityId.toLowerCase().trim() : "";

    return (
      stepNameLower === nodeIdLower ||
      activityIdLower === nodeIdLower ||
      (nodeCallNameLower && stepNameLower === nodeCallNameLower) ||
      (nodeCallNameLower && activityIdLower === nodeCallNameLower)
    );
  });

  if (matchedSteps.length === 0) {
    const isHighlighted = state.liveExecutedNodes && (
      state.liveExecutedNodes.has(nodeId) ||
      state.liveExecutedNodes.has(nodeIdLower) ||
      (node && node.callName && state.liveExecutedNodes.has(node.callName)) ||
      (node && node.callName && state.liveExecutedNodes.has(nodeCallNameLower))
    );

    if (processContextHtml) {
      return `
        <div style="padding:16px;">
          <h3 style="margin:0 0 4px; color:var(--accent);">Live Execution Details</h3>
          <div class="dim" style="font-size:11px; margin-bottom:12px;">Entry node: <strong>${escapeHtml(nodeId)}</strong></div>
          ${processContextHtml}
          <p class="dim" style="font-size:11px;">No separate execution step was recorded for this entry node.</p>
        </div>
      `;
    }

    return `
      <div style="padding: 20px; text-align: center;" class="empty-state">
        <p>No execution step was recorded for node <strong>${escapeHtml(nodeId)}</strong>.</p>
        ${isHighlighted ? `<p class="dim" style="font-size:11px; margin-top:8px;">This node was marked as executed, but no exact payload step matched. It might be a system event or gateway.</p>` : `<p class="dim" style="font-size:11px; margin-top:8px;">This node was not executed in this process run instance.</p>`}
      </div>
    `;
  }

  let html = `
    <div style="padding: 16px;">
      <h3 style="margin: 0 0 4px 0; color: var(--accent); display:flex; align-items:center; gap:8px;">
        <span>Live Execution Details</span>
      </h3>
      <div class="dim" style="font-size:11px; margin-bottom:12px;">Node: <strong>${escapeHtml(nodeId)}</strong>${node && node.callName && node.callName !== nodeId ? ` (${escapeHtml(node.callName)})` : ""}</div>
      ${processContextHtml}
  `;

  matchedSteps.forEach((step, idx) => {
    const runNumber = matchedSteps.length > 1 ? `<span style="font-size: 12px; background: var(--bg-hover); padding: 2px 8px; border-radius: 4px; font-weight:bold; color:var(--accent);">Run #${idx + 1}</span>` : "";
    const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "(unnamed)";
    const stepType = step.Type || step.StepType || step.ActivityType || step.NodeType || "Task";
    const start = step.RequestDateTime || step.Start || "";
    const end = step.ResponseDateTime || step.End || "";
    const duration = step.DurationMs ?? step.Duration ?? (start && end ? (Date.parse(end) - Date.parse(start)) : null);
    const durText = duration != null ? `${duration}ms` : "0ms";
    const status = step.IsFailed ? "failed" : "completed";
    const statusClass = status === "failed" ? "badge danger" : "badge success";
    const statusBadge = `<span class="${statusClass}">${status.toUpperCase()}</span>`;

    const getPayloadObj = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch (_) {
          return val;
        }
      }
      return val;
    };
    const inputJson = getPayloadObj(step.InputJson || step.Input || step.Variables || step.WorkflowInputJson || step.workflowInputJson);
    const outputJson = getPayloadObj(step.OutputJson || step.Output || step.Result || step.WorkflowOutputJson || step.workflowOutputJson);

    let inputHtml = `<span class="dim" style="font-size:11px;">(Empty payload)</span>`;
    if (inputJson !== null) {
      if (typeof window.WorkflowLive?.renderPayloadTable === "function") {
        inputHtml = window.WorkflowLive.renderPayloadTable(inputJson, `liveExecInput_${idx}`);
      } else {
        inputHtml = `<pre class="json-code">${escapeHtml(JSON.stringify(inputJson, null, 2))}</pre>`;
      }
    }

    let outputHtml = `<span class="dim" style="font-size:11px;">(Empty payload)</span>`;
    if (outputJson !== null) {
      if (typeof window.WorkflowLive?.renderPayloadTable === "function") {
        outputHtml = window.WorkflowLive.renderPayloadTable(outputJson, `liveExecOutput_${idx}`);
      } else {
        outputHtml = `<pre class="json-code">${escapeHtml(JSON.stringify(outputJson, null, 2))}</pre>`;
      }
    }

    let diagnosticsHtml = "";
    if (step.IsFailed || step.ErrorDescription || step.ErrorCode) {
      const errCode = step.ErrorCode || "ERROR";
      const errDesc = step.ErrorDescription || step.Error || "Execution failure.";
      diagnosticsHtml = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid var(--danger); border-radius: 8px; padding: 12px; margin-top: 12px; font-size: 12px;">
          <strong style="color: var(--danger); display:block; margin-bottom: 4px;">⚠️ Diagnostics (${escapeHtml(errCode)})</strong>
          <span style="color: var(--text);">${escapeHtml(errDesc)}</span>
        </div>
      `;
    }

    let conditionBlockHtml = "";
    if (node && node.type === "condition" && node.conditionScript) {
      const executedBranch = findExecutedBranch(node.id, step, workflow, steps);
      let branchTextHtml = "";
      if (executedBranch) {
        const badgeStyle = executedBranch.label.toLowerCase() === "else"
          ? "background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);"
          : "background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);";
        branchTextHtml = `<span style="padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; ${badgeStyle}">${escapeHtml(executedBranch.label)} &rarr; ${escapeHtml(executedBranch.target)}</span>`;
      } else {
        branchTextHtml = `<span class="dim" style="font-size: 11px;">(Unknown / End of flow)</span>`;
      }

      const logicHtml = `<pre style="margin: 0; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--line); border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text);">${escapeHtml(node.conditionScript)}</pre>`;

      const evaluatedVars = extractAndEvaluateVariables(node.conditionScript, inputJson, outputJson, processContext);
      let varsHtml = "";
      if (evaluatedVars) {
        let rows = "";
        for (const [key, val] of Object.entries(evaluatedVars)) {
          let valText = "";
          if (typeof val === "object" && val !== null) {
            const str = JSON.stringify(val);
            valText = str.length > 60 ? (Array.isArray(val) ? `[... ${val.length} items]` : `{... ${Object.keys(val).length} keys}`) : str;
          } else {
            valText = String(val);
          }
          rows += `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--line); padding: 3px 0;">
              <span style="font-family: monospace; color: var(--text-muted, #7e8aa3);">${escapeHtml(key)}</span>
              <strong style="font-family: monospace; color: var(--accent);">${escapeHtml(valText)}</strong>
            </div>
          `;
        }
        varsHtml = `
          <div style="margin-top: 10px;">
            <strong style="font-size: 11px; display: block; margin-bottom: 4px; color: var(--text-muted);">Variable Values:</strong>
            <div style="background: rgba(255,255,255,0.01); border: 1px solid var(--line); border-radius: 4px; padding: 6px 10px;">
              ${rows}
            </div>
          </div>
        `;
      } else {
        varsHtml = `
          <div style="margin-top: 10px; font-size: 11px;" class="dim">
            (No variables could be extracted/evaluated from current payloads)
          </div>
        `;
      }

      conditionBlockHtml = `
        <div style="margin-top: 12px; padding: 12px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
            <strong style="font-size: 12px; color: var(--accent);">Condition Evaluation Details</strong>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 11px; color: var(--text-muted);">Branch Taken:</span>
              ${branchTextHtml}
            </div>
          </div>
          <div style="margin-bottom: 8px;">
            <strong style="font-size: 11px; display: block; margin-bottom: 4px; color: var(--text-muted);">Expression / Logic:</strong>
            ${logicHtml}
          </div>
          ${varsHtml}
        </div>
      `;
    }

    html += `
      <div style="border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 16px; background: var(--bg-card, rgba(255,255,255,0.02));">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${runNumber}
            <span class="badge" style="font-weight:600; text-transform:uppercase;">${escapeHtml(stepType)}</span>
            ${statusBadge}
          </div>
          <span style="font-family:monospace; font-size:11px;" class="dim">${durText}</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:4px; font-size:11px; margin-bottom:12px;">
          <div class="kv"><span>Start Time</span><span>${escapeHtml(start ? new Date(start).toLocaleString() : "")}</span></div>
          <div class="kv"><span>End Time</span><span>${escapeHtml(end ? new Date(end).toLocaleString() : "")}</span></div>
        </div>

        ${diagnosticsHtml}

        ${conditionBlockHtml}

        <div style="margin-top: 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; border-bottom: 1px solid var(--line); padding-bottom: 4px;">
            <strong style="font-size: 11px;">Input Payload:</strong>
            ${inputJson && typeof window.WorkflowLive?.renderPayloadTable === "function" ? `
              <div style="display:flex; gap:8px;">
                <button type="button" class="json-tree-btn" onclick="window.expandAllJson('liveExecInput_${idx}')" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-size:10px; font-weight:600;">EXPAND</button>
                <button type="button" class="json-tree-btn" onclick="window.collapseAllJson('liveExecInput_${idx}')" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-size:10px; font-weight:600;">COLLAPSE</button>
              </div>
            ` : ""}
          </div>
          ${inputHtml}
        </div>

        <div style="margin-top: 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px; border-bottom: 1px solid var(--line); padding-bottom: 4px;">
            <strong style="font-size: 11px;">Output Payload / Result:</strong>
            ${outputJson && typeof window.WorkflowLive?.renderPayloadTable === "function" ? `
              <div style="display:flex; gap:8px;">
                <button type="button" class="json-tree-btn" onclick="window.expandAllJson('liveExecOutput_${idx}')" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-size:10px; font-weight:600;">EXPAND</button>
                <button type="button" class="json-tree-btn" onclick="window.collapseAllJson('liveExecOutput_${idx}')" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-size:10px; font-weight:600;">COLLAPSE</button>
              </div>
            ` : ""}
          </div>
          ${outputHtml}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  return html;
}

function makeWorkflowUrl(name) {
  return navigation.buildTargetUrl(window.location.href, "workflow", name);
}

function makeZboUrl(name) {
  return navigation.buildTargetUrl(window.location.href, "zbo", name);
}

function internalNavigationAttributes(kind, name) {
  const href = kind === "workflow" ? makeWorkflowUrl(name) : makeZboUrl(name);
  return `href="${escapeAttr(href)}" data-analyzer-nav="${kind}" data-analyzer-target="${escapeAttr(name)}"`;
}

function navigationSnapshot() {
  if (state.activeMode === "zoral" && state.selectedWorkflow?.name) {
    return { kind: "workflow", name: state.selectedWorkflow.name };
  }
  if (state.activeMode === "zbo" && state.selectedZboArea?.name) {
    return { kind: "zbo", name: state.selectedZboArea.name };
  }
  return { kind: "mode", name: state.activeMode };
}

function initializeNavigationHistory() {
  window.history.replaceState(
    { analyzerNavigation: navigationSnapshot() },
    "",
    window.location.href,
  );
}

function navigateInternal(kind, name, options = {}) {
  if (kind === "workflow") {
    if (!state.workflows.some((workflow) => workflow.name === name)) return false;
    selectWorkflow(name);
  } else if (kind === "zbo") {
    if (!state.zboAreas.some((area) => area.name === name)) return false;
    selectZboArea(name);
  } else if (kind === "mode") {
    setMode(name);
  } else {
    return false;
  }

  if (options.history === "push") {
    const url =
      kind === "workflow"
        ? makeWorkflowUrl(name)
        : kind === "zbo"
          ? makeZboUrl(name)
          : window.location.href;
    window.history.pushState(
      { analyzerNavigation: { kind, name } },
      "",
      url,
    );
  }
  return true;
}

function openInternalNavigationTab(kind, name) {
  const token = window.WorkflowIndexHandoff?.issue();
  if (!token) return false;
  const url = navigation.buildTargetUrl(window.location.href, kind, name, token);
  return Boolean(window.open(url, "_blank"));
}

function handleInternalNavigationEvent(event) {
  const link = event.target.closest?.(
    '[data-analyzer-nav], a.workflow-link[target="_blank"]',
  );
  if (!link) return;
  if (event.type === "click" && event.button !== 0) return;
  if (event.type === "auxclick" && event.button !== 1) return;

  const target =
    link.dataset.analyzerNav && link.dataset.analyzerTarget
      ? {
          kind: link.dataset.analyzerNav,
          name: link.dataset.analyzerTarget,
        }
      : navigation.readTarget(link.href);
  if (!target) return;

  event.preventDefault();
  if (
    navigation.shouldOpenNewTab(event, window.location) &&
    openInternalNavigationTab(target.kind, target.name)
  ) {
    return;
  }
  navigateInternal(target.kind, target.name, { history: "push" });
}

function handleNavigationPopState(event) {
  const target =
    event.state?.analyzerNavigation || navigation.readTarget(window.location.href);
  if (target) navigateInternal(target.kind, target.name);
}

function renderWorkflowChip(name) {
  if (state.workflows.some((workflow) => workflow.name === name)) {
    return `<a class="zbo-chip zbo-chip-link" ${internalNavigationAttributes("workflow", name)}>${escapeHtml(name)}</a>`;
  }
  return `<span class="zbo-chip">${escapeHtml(name)}</span>`;
}

function renderWorkflowInline(name) {
  if (state.workflows.some((workflow) => workflow.name === name)) {
    return `<a class="workflow-link" ${internalNavigationAttributes("workflow", name)}>${escapeHtml(name)}</a>`;
  }
  return escapeHtml(name);
}

function renderZboAreaInline(name) {
  if (state.zboAreas.some((area) => area.name === name)) {
    return `<a class="workflow-link" ${internalNavigationAttributes("zbo", name)}>${escapeHtml(name)}</a>`;
  }
  return escapeHtml(name);
}

// Render a key/value row whose value links to another workflow (opened in a
// new tab) when the value matches a known workflow name — used so a node that
// calls another workflow is directly navigable from the Node detail tab.
function renderWorkflowRefRow(label, value) {
  const target = value && state.workflows.some((workflow) => workflow.name === value);
  if (!target) return renderKv(label, value || "-");
  return `
    <div class="kv">
      <span>${escapeHtml(label)}</span>
      <span><a class="workflow-link" href="${escapeAttr(makeWorkflowUrl(value))}" target="_blank" rel="noreferrer">${escapeHtml(value)} ↗</a></span>
    </div>
  `;
}

function renderKv(label, value) {
  return `
    <div class="kv">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value == null || value === "" ? "-" : String(value))}</span>
    </div>
  `;
}

function renderCodeSection(title, code) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <pre class="code-block">${escapeHtml(code || "")}</pre>
    </section>
  `;
}

function renderEmpty(message) {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

// Escape code, then wrap case-insensitive occurrences of the query in <mark>.
function highlightSearchHits(code, query) {
  const escaped = escapeHtml(code);
  const q = String(query || "").trim();
  if (!q) return escaped;
  const escQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return escaped.replace(new RegExp(escQ, "gi"), (m) => `<mark class="search-hit">${m}</mark>`);
  } catch {
    return escaped;
  }
}

function selectDatabaseDefaultItem(options = {}) {
  if (state.dbSubmode === "tables") {
    const preferred = state.selectedTable || state.dbTables[0];
    if (preferred) selectTable(preferred.name, options);
  } else if (state.dbSubmode === "enums") {
    const allEnums = [...state.dbEnums.custom, ...state.dbEnums.data];
    const preferred = state.selectedEnum || allEnums[0];
    if (preferred) selectEnum(preferred.name, options);
  } else if (state.dbSubmode === "functions") {
    const preferred = state.selectedFunction || state.dbFunctions[0];
    if (preferred) selectFunction(preferred.name, options);
  } else if (state.dbSubmode === "er") {
    renderDatabaseDiagram();
    renderDatabaseDetails();
  } else if (state.dbSubmode === "triggers") {
    const allTriggers = [];
    for (const t of state.dbTables) {
      for (const trg of t.triggers || []) {
        allTriggers.push({ ...trg, tableName: t.name, sourcePath: t.sourcePath });
      }
    }
    const preferred = state.selectedTrigger || allTriggers[0];
    if (preferred) {
      selectTable(preferred.tableName, options);
      state.selectedTrigger = preferred;
    }
  }
}

function selectTable(name, options = {}) {
  const table = state.dbTables.find(t => t.name === name);
  if (!table) return;
  state.selectedTable = table;
  state.selectedEnum = null;
  state.selectedFunction = null;
  
  state.activeMode = "database";
  if (state.dbSubmode !== "triggers" && state.dbSubmode !== "er") {
    state.dbSubmode = "tables";
  }
  state.activeTab = options.restore ? state.activeTab || "overview" : "overview";
  
  els.workflowTitle.textContent = `Table: ${table.name}`;
  els.workflowSubtitle.textContent = `${table.columns.length} columns | ${table.primaryKeys.length} PKs | ${table.foreignKeys.length} FKs | ${table.triggers.length} triggers`;
  
  state.panes.detail = true;

  const resultsTitleRow = document.querySelector(".results-title-row");
  const dbSubmodeContainer = document.querySelector("#dbSubmodeContainer");
  if (resultsTitleRow) resultsTitleRow.style.display = "none";
  if (dbSubmodeContainer) dbSubmodeContainer.style.display = "flex";
  
  document.querySelectorAll("[data-db-submode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.dbSubmode === state.dbSubmode);
  });
  
  applyFormState();
  applyModeState();
  applyLayoutState();

  saveState();
  renderResults();
  renderDatabaseDiagram();
  renderDetails();
  updatePageTitle();
}

function selectEnum(name, options = {}) {
  const allEnums = [...state.dbEnums.custom, ...state.dbEnums.data];
  const en = allEnums.find(e => e.name === name);
  if (!en) return;
  state.selectedEnum = en;
  state.selectedTable = null;
  state.selectedFunction = null;
  state.activeTab = "overview";
  
  els.workflowTitle.textContent = `Enum: ${en.name}`;
  els.workflowSubtitle.textContent = en.values ? `Custom Schema Enum | ${en.values.length} values` : `Table Enum Data | ${en.rows.length} rows`;
  
  state.panes.detail = true;
  applyLayoutState();

  saveState();
  renderResults();
  renderDatabaseDiagram();
  renderDetails();
  updatePageTitle();
}

function selectFunction(name, options = {}) {
  const fn = state.dbFunctions.find(f => f.name === name);
  if (!fn) return;
  state.selectedFunction = fn;
  state.selectedTable = null;
  state.selectedEnum = null;
  state.activeTab = "overview";
  
  els.workflowTitle.textContent = `Function/Proc: ${fn.name}`;
  els.workflowSubtitle.textContent = `Database PL/pgSQL Function | File: ${fn.sourcePath}`;
  
  state.panes.detail = true;
  applyLayoutState();

  saveState();
  renderResults();
  renderDatabaseDiagram();
  renderDetails();
  updatePageTitle();
}

function setDbSubmode(submode) {
  state.dbSubmode = submode;
  document.querySelectorAll("[data-db-submode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.dbSubmode === submode);
  });
  applyModeState();
  renderResultsNow();
  selectDatabaseDefaultItem();
  saveState();
}

function renderDatabaseResults() {
  const query = state.query ? state.query.trim() : "";
  els.resultsList.innerHTML = "";

  if (state.dbSubmode === "tables" || state.dbSubmode === "er") {
    const filtered = state.dbTables.filter(t => {
      if (!query) return true;
      return matches(t.name, query) || 
             t.columns.some(c => matches(c.name, query));
    });
    
    els.resultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      els.resultsList.innerHTML = renderNoResults();
      return;
    }

    // Build parent-to-children and child-to-parents maps
    const parentToChildren = new Map();
    const childToParents = new Map();
    for (const t of state.dbTables) {
      parentToChildren.set(t.name, new Set());
      childToParents.set(t.name, new Set());
    }
    for (const t of state.dbTables) {
      for (const fk of t.foreignKeys || []) {
        const p = fk.referencedTable;
        if (parentToChildren.has(p)) {
          parentToChildren.get(p).add(t.name);
        }
        if (childToParents.has(t.name)) {
          childToParents.get(t.name).add(p);
        }
      }
    }

    const filteredSet = new Set(filtered.map(t => t.name));
    const visited = new Set();
    const hierarchicalList = [];

    function dfs(tableName, depth = 0) {
      if (visited.has(tableName)) return;
      visited.add(tableName);
      const tableObj = filtered.find(t => t.name === tableName);
      if (tableObj) {
        hierarchicalList.push({ table: tableObj, depth });
      }
      const children = Array.from(parentToChildren.get(tableName) || []).sort();
      for (const child of children) {
        if (filteredSet.has(child)) {
          dfs(child, depth + 1);
        }
      }
    }

    // Find roots in the filtered context (parents are not in filteredSet)
    const filteredRoots = filtered.filter(t => {
      const parents = childToParents.get(t.name) || new Set();
      for (const p of parents) {
        if (filteredSet.has(p)) return false;
      }
      return true;
    }).map(t => t.name).sort();

    for (const root of filteredRoots) {
      dfs(root, 0);
    }

    for (const t of filtered) {
      if (!visited.has(t.name)) {
        dfs(t.name, 0);
      }
    }

    els.resultsList.innerHTML = hierarchicalList.map(({ table: t, depth }) => {
      const isSelected = state.selectedTable?.name === t.name;
      const activeClass = isSelected ? "active" : "";
      const directCount = t.directChildrenCount || 0;
      const totalCount = t.totalChildrenCount || 0;
      const childBadge = `<span class="badge" style="background: rgba(14, 165, 233, 0.12); color: #0ea5e9; font-weight: 600;">Child: ${directCount} (Total: ${totalCount})</span>`;
      
      const paddingLeft = 10 + depth * 16;
      const prefix = depth > 0 ? '<span class="tree-connector" style="font-family: monospace; color: var(--accent); opacity: 0.6; margin-right: 4px;">└─ </span>' : '';

      if (state.dbSubmode === "er") {
        const isChecked = state.erCheckedTables.has(t.name) ? "checked" : "";
        return `
          <div class="result-item db-er-card ${activeClass}" style="display: flex; align-items: center; gap: 8px; padding-left: ${paddingLeft}px;">
            <input type="checkbox" data-er-table="${escapeAttr(t.name)}" ${isChecked} style="width: 16px; height: 16px; cursor: pointer;">
            <div style="flex: 1; cursor: pointer;" data-table-click="${escapeAttr(t.name)}">
              <div class="result-title"><span>${prefix}${escapeHtml(t.name)}</span></div>
              <div class="result-meta">
                <span class="badge">${t.columns.length} cols</span>
                ${t.foreignKeys.length ? `<span class="badge accent">${t.foreignKeys.length} FKs</span>` : ""}
                ${childBadge}
              </div>
            </div>
          </div>
        `;
      } else {
        return `
          <button class="result-item ${activeClass}" type="button" data-table-name="${escapeAttr(t.name)}" style="padding-left: ${paddingLeft}px;">
            <div class="result-title"><span>${prefix}${escapeHtml(t.name)}</span></div>
            <div class="result-meta">
              <span class="badge">${t.columns.length} columns</span>
              ${t.primaryKeys.length ? `<span class="badge success">${t.primaryKeys.length} PKs</span>` : ""}
              ${t.foreignKeys.length ? `<span class="badge accent">${t.foreignKeys.length} FKs</span>` : ""}
              ${t.triggers.length ? `<span class="badge warning">${t.triggers.length} triggers</span>` : ""}
              ${childBadge}
            </div>
          </button>
        `;
      }
    }).join("");

    if (state.dbSubmode === "er") {
      els.resultsList.querySelectorAll("[data-er-table]").forEach(cb => {
        cb.addEventListener("change", (e) => {
          const tName = cb.dataset.erTable;
          if (e.target.checked) state.erCheckedTables.add(tName);
          else state.erCheckedTables.delete(tName);
          renderDatabaseDiagram();
        });
      });
      els.resultsList.querySelectorAll("[data-table-click]").forEach(div => {
        div.addEventListener("click", () => {
          selectTable(div.dataset.tableClick);
          setDbSubmode("tables");
        });
      });
    } else {
      els.resultsList.querySelectorAll("[data-table-name]").forEach(btn => {
        btn.addEventListener("click", () => selectTable(btn.dataset.tableName));
      });
    }
  } else if (state.dbSubmode === "enums") {
    const allEnums = [...state.dbEnums.custom, ...state.dbEnums.data];
    const filtered = allEnums.filter(e => {
      if (!query) return true;
      if (matches(e.name, query)) return true;
      if (e.values && e.values.some(v => matches(v, query))) return true;
      if (e.rows && e.rows.some(r => Object.values(r).some(val => matches(String(val), query)))) return true;
      return false;
    });

    els.resultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      els.resultsList.innerHTML = renderNoResults();
      return;
    }

    els.resultsList.innerHTML = filtered.map(e => {
      const isSelected = state.selectedEnum?.name === e.name;
      const isCustom = Boolean(e.values);
      return `
        <button class="result-item ${isSelected ? "active" : ""}" type="button" data-enum-name="${escapeAttr(e.name)}">
          <div class="result-title"><span>${escapeHtml(e.name)}</span></div>
          <div class="result-meta">
            <span class="badge">${isCustom ? "custom enum" : "table data"}</span>
            <span class="badge success">${isCustom ? e.values.length : e.rows.length} values</span>
          </div>
        </button>
      `;
    }).join("");

    els.resultsList.querySelectorAll("[data-enum-name]").forEach(btn => {
      btn.addEventListener("click", () => selectEnum(btn.dataset.enumName));
    });
  } else if (state.dbSubmode === "functions") {
    const filtered = state.dbFunctions.filter(f => {
      if (!query) return true;
      return matches(f.name, query) || 
             matches(f.sourcePath, query) ||
             (f.code && matches(f.code, query));
    });

    els.resultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      els.resultsList.innerHTML = renderNoResults();
      return;
    }

    els.resultsList.innerHTML = filtered.map(f => {
      const isSelected = state.selectedFunction?.name === f.name;
      return `
        <button class="result-item ${isSelected ? "active" : ""}" type="button" data-function-name="${escapeAttr(f.name)}">
          <div class="result-title"><span>${escapeHtml(f.name)}</span></div>
          <div class="result-meta">
            <span class="badge">${f.operations?.length || 0} DB Ops</span>
            <span class="badge accent">${f.sourcePath.split("/").pop()}</span>
          </div>
        </button>
      `;
    }).join("");

    els.resultsList.querySelectorAll("[data-function-name]").forEach(btn => {
      btn.addEventListener("click", () => selectFunction(btn.dataset.functionName));
    });
  } else if (state.dbSubmode === "triggers") {
    const allTriggers = [];
    for (const t of state.dbTables) {
      for (const trg of t.triggers || []) {
        allTriggers.push({
          ...trg,
          tableName: t.name,
          sourcePath: t.sourcePath
        });
      }
    }
    
    const filtered = allTriggers.filter(trg => {
      if (!query) return true;
      return matches(trg.name, query) ||
             matches(trg.tableName, query) ||
             matches(trg.function, query);
    });

    els.resultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      els.resultsList.innerHTML = renderNoResults();
      return;
    }

    els.resultsList.innerHTML = filtered.map(trg => {
      const isSelected = state.selectedTrigger?.name === trg.name;
      return `
        <button class="result-item ${isSelected ? "active" : ""}" type="button" data-trigger-name="${escapeAttr(trg.name)}" data-trigger-table="${escapeAttr(trg.tableName)}">
          <div class="result-title"><span>${escapeHtml(trg.name)}</span></div>
          <div class="result-meta">
            <span class="badge warning">${escapeHtml(trg.timing)} ${escapeHtml(trg.events)}</span>
            <span class="badge accent">Table: ${escapeHtml(trg.tableName)}</span>
            <span class="badge success">Func: ${escapeHtml(trg.function)}</span>
          </div>
        </button>
      `;
    }).join("");

    els.resultsList.querySelectorAll("[data-trigger-name]").forEach(btn => {
      btn.addEventListener("click", () => {
        selectTable(btn.dataset.triggerTable);
        state.selectedTrigger = { name: btn.dataset.triggerName, tableName: btn.dataset.triggerTable };
        renderDatabaseResults();
      });
    });
  }
}

function renderTableDatadict(table) {
  const colsHtml = table.columns.map(c => {
    const isPk = table.primaryKeys.includes(c.name);
    const isFk = table.foreignKeys.some(fk => fk.columns.includes(c.name));
    const pkBadge = isPk ? `<span class="badge success" style="font-size:9px; padding:1px 4px; min-height:0; margin-left:4px;">PK</span>` : "";
    const fkBadge = isFk ? `<span class="badge accent" style="font-size:9px; padding:1px 4px; min-height:0; margin-left:4px;">FK</span>` : "";
    return `
      <tr>
        <td style="font-weight:600; color:var(--text);">${escapeHtml(c.name)}${pkBadge}${fkBadge}</td>
        <td style="font-family:monospace; font-size:12px;">${escapeHtml(c.type)}</td>
        <td>${c.nullable ? "Yes" : "No"}</td>
        <td style="font-family:monospace; font-size:12px; color:var(--muted);">${escapeHtml(c.default || "-")}</td>
        <td style="color:var(--text); font-size:12px;">${escapeHtml(c.comment || "-")}</td>
      </tr>
    `;
  }).join("");

  const fkHtml = table.foreignKeys.length ? table.foreignKeys.map(fk => `
    <div style="padding: 6px; border: 1px solid var(--line); border-radius:6px; margin-bottom:6px; background:var(--surface-2);">
      <strong>Constraint:</strong> ${escapeHtml(fk.constraintName)}<br>
      <strong>Columns:</strong> ${escapeHtml(fk.columns.join(", "))}<br>
      <strong>References:</strong> <a href="#" data-table-link="${escapeAttr(fk.referencedTable)}" class="workflow-link">${escapeHtml(fk.referencedTable)}</a>(${escapeHtml(fk.referencedColumns.join(", "))})
    </div>
  `).join("") : '<p class="muted">No foreign key constraints defined.</p>';

  const uqHtml = table.uniqueKeys?.length ? table.uniqueKeys.map(uq => `
    <div style="padding: 6px; border: 1px solid var(--line); border-radius:6px; margin-bottom:6px; background:var(--surface-2);">
      <strong>Constraint:</strong> ${escapeHtml(uq.name)}<br>
      <strong>Fields:</strong> ${escapeHtml(uq.fields.join(", "))}
    </div>
  `).join("") : "";

  return `
    <section class="detail-section">
      <h3>Table: ${escapeHtml(table.name)}</h3>
      ${renderKv("Source DDL Path", table.sourcePath)}
      ${renderKv("Columns Count", table.columns.length)}
    </section>

    <section class="detail-section">
      <h3>Columns Schema</h3>
      <table class="table">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Null?</th>
            <th>Default</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${colsHtml}
        </tbody>
      </table>
    </section>

    <section class="detail-section">
      <h3>Primary Keys</h3>
      <div class="small-list">
        ${table.primaryKeys.map(k => `<span class="badge success">${escapeHtml(k)}</span>`).join("") || '<span class="muted">No primary keys defined.</span>'}
      </div>
    </section>

    <section class="detail-section">
      <h3>Foreign Keys</h3>
      ${fkHtml}
    </section>

    ${uqHtml ? `
    <section class="detail-section">
      <h3>Unique Constraints</h3>
      ${uqHtml}
    </section>
    ` : ""}
  `;
}

function renderTableTriggersAndFKs(table) {
  const triggerHtml = table.triggers.length ? `
    <table class="table">
      <thead>
        <tr>
          <th>Trigger Name</th>
          <th>Timing</th>
          <th>Event</th>
          <th>Function</th>
        </tr>
      </thead>
      <tbody>
        ${table.triggers.map(t => `
          <tr>
            <td style="font-weight:600;">${escapeHtml(t.name)}</td>
            <td><span class="badge warning" style="font-size:10px;">${escapeHtml(t.timing)}</span></td>
            <td><span class="badge accent" style="font-size:10px;">${escapeHtml(t.events)}</span></td>
            <td><a href="#" data-func-link="${escapeAttr(t.function.replace(/\(\)$/, ""))}" class="workflow-link">${escapeHtml(t.function)}</a></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : '<p class="muted">No triggers defined on this table.</p>';

  const parents = table.foreignKeys.map(fk => fk.referencedTable);
  const children = state.dbTables.filter(t => t.foreignKeys.some(fk => fk.referencedTable === table.name)).map(t => t.name);

  return `
    <section class="detail-section">
      <h3>Table Triggers</h3>
      ${triggerHtml}
    </section>

    <section class="detail-section">
      <h3>Relationship Hierarchy</h3>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
        <div>
          <h4>Parent Tables (Referenced)</h4>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${unique(parents).map(p => `<a href="#" data-table-link="${escapeAttr(p)}" class="workflow-link" style="display:block;">&larr; ${escapeHtml(p)}</a>`).join("") || '<span class="muted">None</span>'}
          </div>
        </div>
        <div>
          <h4>Child Tables (Referencing)</h4>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${unique(children).map(c => `<a href="#" data-table-link="${escapeAttr(c)}" class="workflow-link" style="display:block;">${escapeHtml(c)} &rarr;</a>`).join("") || '<span class="muted">None</span>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderTableCrudMap(table) {
  const callers = [];
  const query = table.name.toLowerCase();

  for (const wf of state.workflows) {
    for (const op of wf.dbOperations || []) {
      if (op.table === query) {
        callers.push({
          name: wf.name,
          type: "workflow",
          nodeId: op.nodeId,
          operation: op.operation,
          columns: op.columns || [],
          source: wf.sourcePath,
        });
      }
    }
  }

  for (const area of state.zboAreas) {
    for (const action of area.actions || []) {
      for (const op of action.dbOperations || []) {
        if (op.table === query) {
          callers.push({
            name: area.name,
            type: "zbo-action",
            actionLabel: action.label || action.name,
            operation: op.operation,
            columns: op.columns || [],
            source: action.sourcePath || area.sourcePaths[0],
          });
        }
      }
    }
    for (const op of area.graphqlOperations || []) {
      if (op.table === query) {
        callers.push({
          name: area.name,
          type: "zbo-graphql",
          nodeId: op.nodeId || "query",
          operation: op.operation,
          columns: op.columns || [],
          source: area.sourcePaths[0],
        });
      }
    }
  }

  for (const f of state.dbFunctions) {
    for (const op of f.operations || []) {
      if (op.table === query) {
        callers.push({
          name: f.name,
          type: "db-function",
          operation: op.operation,
          columns: [],
          source: f.sourcePath,
        });
      }
    }
  }

  for (const trg of table.triggers || []) {
    callers.push({
      name: trg.name,
      type: "db-trigger",
      operation: trg.events,
      columns: [],
      source: table.sourcePath,
      triggerFunction: trg.function,
    });
  }

  callers.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const tabSelector = `
    <div class="crud-tabs" style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--line); padding-bottom: 8px;">
      <button id="btnCrudByCaller" class="match-filter-chip ${state.crudView === "caller" ? "active" : ""}" type="button" style="min-height: 28px; padding: 0 12px; font-size: 11px;">By Caller</button>
      <button id="btnCrudByColumn" class="match-filter-chip ${state.crudView === "column" ? "active" : ""}" type="button" style="min-height: 28px; padding: 0 12px; font-size: 11px;">By Column</button>
    </div>
  `;

  if (!callers.length) {
    return `
      <section class="detail-section">
        <h3>External Callers Mapping</h3>
        ${tabSelector}
        <p class="muted" style="padding:16px;">No external callers (Zoral or ZBO) touch this table directly.</p>
      </section>
    `;
  }

  let contentHtml = "";

  if (state.crudView === "column") {
    const rows = table.columns.map(col => {
      const colCallers = callers.filter(c => c.columns && c.columns.includes(col.name));
      
      let callersListHtml = "";
      if (colCallers.length === 0) {
        callersListHtml = `<span class="muted" style="font-size: 11px;">No callers touch this column directly.</span>`;
      } else {
        const opGroups = {};
        for (const c of colCallers) {
          const op = normalizeOperation(c.operation);
          if (!opGroups[op]) opGroups[op] = [];
          opGroups[op].push(c);
        }
        
        callersListHtml = Object.entries(opGroups).map(([op, list]) => {
          const opBadge = `<span class="db-op op-${escapeAttr(op)}" style="padding: 1px 6px; font-size: 10px; line-height: 1.2; min-height: 0; margin-right: 8px; vertical-align: middle; display: inline-block; width: 50px; text-align: center;">${escapeHtml(capitalizeWord(op))}</span>`;
          const links = list.map(c => {
            if (c.type === "workflow") {
              return `<a href="${escapeAttr(makeWorkflowUrl(c.name))}" target="_blank" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)}</a>`;
            } else if (c.type === "db-function") {
              return `<a href="#" data-func-link="${escapeAttr(c.name)}" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)} (Func)</a>`;
            } else if (c.type === "db-trigger") {
              return `<span style="font-size: 11px; font-weight:600; color:var(--text-strong);">${escapeHtml(c.name)} (Trigger &rarr; <a href="#" data-func-link="${escapeAttr(c.triggerFunction.replace(/\(\)$/, ""))}" class="workflow-link">${escapeHtml(c.triggerFunction)}</a>)</span>`;
            } else {
              return `<a href="${escapeAttr(makeZboUrl(c.name))}" target="_blank" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)} (${c.type === "zbo-action" ? `Act: ${escapeHtml(c.actionLabel)}` : `GQL`})</a>`;
            }
          }).join(", ");
          return `
            <div style="margin-bottom: 6px; display: flex; align-items: flex-start; gap: 4px;">
              <div style="flex-shrink: 0;">${opBadge}</div>
              <div style="flex: 1; font-size: 11px; line-height: 1.4;">${links}</div>
            </div>
          `;
        }).join("");
      }

      return `
        <tr>
          <td style="font-weight: 600; font-family: monospace; font-size: 11px; vertical-align: top; width: 140px; word-break: break-all;">${escapeHtml(col.name)}</td>
          <td style="font-size: 10px; font-family: monospace; color: var(--muted); vertical-align: top; width: 100px; word-break: break-all;">${escapeHtml(col.type.split("(")[0])}</td>
          <td style="vertical-align: top;">${callersListHtml}</td>
        </tr>
      `;
    }).join("");

    const tableLevelCallers = callers.filter(c => !c.columns || c.columns.length === 0);
    let tableLevelRow = "";
    if (tableLevelCallers.length > 0) {
      const opGroups = {};
      for (const c of tableLevelCallers) {
        const op = normalizeOperation(c.operation);
        if (!opGroups[op]) opGroups[op] = [];
        opGroups[op].push(c);
      }
      const callersListHtml = Object.entries(opGroups).map(([op, list]) => {
        const opBadge = `<span class="db-op op-${escapeAttr(op)}" style="padding: 1px 6px; font-size: 10px; line-height: 1.2; min-height: 0; margin-right: 8px; vertical-align: middle; display: inline-block; width: 50px; text-align: center;">${escapeHtml(capitalizeWord(op))}</span>`;
        const links = list.map(c => {
          if (c.type === "workflow") {
            return `<a href="${escapeAttr(makeWorkflowUrl(c.name))}" target="_blank" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)}</a>`;
          } else if (c.type === "db-function") {
            return `<a href="#" data-func-link="${escapeAttr(c.name)}" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)} (Func)</a>`;
          } else if (c.type === "db-trigger") {
            return `<span style="font-size: 11px; font-weight:600; color:var(--text-strong);">${escapeHtml(c.name)} (Trigger &rarr; <a href="#" data-func-link="${escapeAttr(c.triggerFunction.replace(/\(\)$/, ""))}" class="workflow-link">${escapeHtml(c.triggerFunction)}</a>)</span>`;
          } else {
            return `<a href="${escapeAttr(makeZboUrl(c.name))}" target="_blank" class="workflow-link" style="font-size: 11px;">${escapeHtml(c.name)} (${c.type === "zbo-action" ? `Act: ${escapeHtml(c.actionLabel)}` : `GQL`})</a>`;
          }
        }).join(", ");
        return `
          <div style="margin-bottom: 6px; display: flex; align-items: flex-start; gap: 4px;">
            <div style="flex-shrink: 0;">${opBadge}</div>
            <div style="flex: 1; font-size: 11px; line-height: 1.4;">${links}</div>
          </div>
        `;
      }).join("");

      tableLevelRow = `
        <tr style="background: rgba(245, 158, 11, 0.05);">
          <td style="font-weight: bold; font-family: monospace; font-size: 11px; vertical-align: top; color: var(--warning);">(table-level / unknown)</td>
          <td style="font-size: 10px; font-family: monospace; color: var(--muted); vertical-align: top;">-</td>
          <td style="vertical-align: top;">${callersListHtml}</td>
        </tr>
      `;
    }

    contentHtml = `
      <table class="table" style="table-layout: fixed; width: 100%;">
        <thead>
          <tr>
            <th style="width: 140px;">Field Name</th>
            <th style="width: 100px;">Type</th>
            <th>Operations & Callers</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${tableLevelRow}
        </tbody>
      </table>
    `;
  } else {
    const rowsHtml = callers.map(c => {
      let callerLink = "";
      if (c.type === "workflow") {
        callerLink = `<a href="${escapeAttr(makeWorkflowUrl(c.name))}" target="_blank" class="workflow-link">${escapeHtml(c.name)} (Node: ${escapeHtml(c.nodeId)})</a>`;
      } else if (c.type === "db-function") {
        callerLink = `<a href="#" data-func-link="${escapeAttr(c.name)}" class="workflow-link">${escapeHtml(c.name)} (PL/pgSQL Function)</a>`;
      } else if (c.type === "db-trigger") {
        callerLink = `<span style="font-weight:600; color:var(--text-strong);">${escapeHtml(c.name)} (Trigger) &rarr; <a href="#" data-func-link="${escapeAttr(c.triggerFunction.replace(/\(\)$/, ""))}" class="workflow-link">${escapeHtml(c.triggerFunction)}</a></span>`;
      } else {
        callerLink = `<a href="${escapeAttr(makeZboUrl(c.name))}" target="_blank" class="workflow-link">${escapeHtml(c.name)} (${c.type === "zbo-action" ? `Action: ${escapeHtml(c.actionLabel)}` : `GQL: ${escapeHtml(c.nodeId)}`})</a>`;
      }

      const colPills = c.columns.length ? c.columns.map(col => `<span class="badge" style="font-size:10px; padding:1px 5px; min-height:0; margin: 1px;">${escapeHtml(col)}</span>`).join("") : `<span class="muted" style="font-size:11px;">(table-level)</span>`;
      const op = normalizeOperation(c.operation);
      const opBadge = `<span class="db-op op-${escapeAttr(op)}" style="padding: 1px 6px; font-size:10px; line-height:1; min-height:0;">${escapeHtml(capitalizeWord(op))}</span>`;

      return `
        <tr>
          <td>${callerLink}</td>
          <td>${opBadge}</td>
          <td><div style="display:flex; flex-wrap:wrap; max-width:240px;">${colPills}</div></td>
          <td style="font-size:11px; color:var(--muted); max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(c.source)}">${escapeHtml(c.source.split("/").pop())}</td>
        </tr>
      `;
    }).join("");

    contentHtml = `
      <table class="table">
        <thead>
          <tr>
            <th>Caller / Context</th>
            <th>Op</th>
            <th>Columns Touched</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  return `
    <section class="detail-section">
      <h3>External Callers Mapping</h3>
      ${tabSelector}
      ${contentHtml}
    </section>
  `;
}

function renderTableCrGen(table) {
  const colsOptions = table.columns.map(c => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  return `
    <section class="detail-section">
      <h3>CR Change Impact Generator</h3>
      <p class="muted" style="margin-bottom:12px;">Simulate schema changes (rename, change type, drop) to automatically trace affected workflows, ZBO screens, triggers, and functions.</p>
      
      <div style="display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--surface-2);">
        <div>
          <label style="display:block; font-weight:600; margin-bottom:4px;">Target Column</label>
          <select id="crColumnSelect" class="table-select" style="width:100%; height:34px; padding:0 8px; border:1px solid var(--line-strong); border-radius:6px; background:#fff;">
            ${colsOptions}
          </select>
        </div>
        <div>
          <label style="display:block; font-weight:600; margin-bottom:4px;">Action</label>
          <select id="crActionSelect" class="table-select" style="width:100%; height:34px; padding:0 8px; border:1px solid var(--line-strong); border-radius:6px; background:#fff;">
            <option value="type">Change Data Type</option>
            <option value="rename">Rename Column</option>
            <option value="drop">Drop Column</option>
          </select>
        </div>
        <div id="crNewValueGroup">
          <label id="crNewValueLabel" style="display:block; font-weight:600; margin-bottom:4px;">New Data Type</label>
          <input id="crNewValueInput" type="text" placeholder="e.g. integer, numeric(10,2)" style="width:100%; height:34px; padding:0 8px; border:1px solid var(--line-strong); border-radius:6px; background:#fff;">
        </div>
        <button id="crGenerateBtn" type="button" class="rebuild-button" style="margin-top:6px; background:var(--accent-2); color:#fff; border:0; min-height:38px; border-radius:8px; font-weight:bold;">Generate Impact Report</button>
      </div>

      <div id="crReportContainer" style="display:none; margin-top:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
          <h4 style="margin:0;">Generated Impact Report</h4>
          <button id="crCopyBtn" type="button" class="match-filter-chip" style="min-height:24px;">Copy to Clipboard</button>
        </div>
        <pre id="crReportOutput" class="code-block" style="white-space: pre-wrap; font-size:11px; max-height:300px; overflow-y:auto; background: #0f172a; color: #f8fafc; padding: 12px; border-radius: 6px; font-family: monospace;"></pre>
        <button id="crDownloadBtn" type="button" class="pane-toggle active" style="margin-top:10px; width:100%; height:38px; border-radius:8px; font-weight:bold; font-size:13px;">Download Markdown Report (.md)</button>
      </div>
    </section>
  `;
}

function bindCrFormEvents(table) {
  const colSelect = document.getElementById("crColumnSelect");
  const actionSelect = document.getElementById("crActionSelect");
  const valGroup = document.getElementById("crNewValueGroup");
  const valLabel = document.getElementById("crNewValueLabel");
  const valInput = document.getElementById("crNewValueInput");
  const generateBtn = document.getElementById("crGenerateBtn");
  const reportContainer = document.getElementById("crReportContainer");
  const reportOutput = document.getElementById("crReportOutput");
  const downloadBtn = document.getElementById("crDownloadBtn");
  const copyBtn = document.getElementById("crCopyBtn");

  if (!colSelect || !actionSelect) return;

  actionSelect.addEventListener("change", () => {
    const act = actionSelect.value;
    if (act === "drop") {
      valGroup.style.display = "none";
    } else {
      valGroup.style.display = "block";
      valLabel.textContent = act === "rename" ? "New Column Name" : "New Data Type";
      valInput.placeholder = act === "rename" ? "e.g. updated_at, comment_text" : "e.g. text, boolean";
    }
  });

  generateBtn.addEventListener("click", () => {
    const colName = colSelect.value;
    const action = actionSelect.value;
    const newVal = valInput.value.trim();

    if (action !== "drop" && !newVal) {
      alert("Please specify the new name or data type.");
      return;
    }

    const reportMarkdown = generateColumnCrReport(table, colName, action, newVal);
    
    reportOutput.textContent = reportMarkdown;
    reportContainer.style.display = "block";
    reportContainer.scrollIntoView({ behavior: "smooth" });
  });

  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => {
      const colName = colSelect.value;
      const action = actionSelect.value;
      const markdown = reportOutput.textContent;
      const filename = `${state.selectedTable.name}_${colName}_${action}_impact.md`;
      
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(reportOutput.textContent).then(() => {
        const oldText = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = oldText; }, 1500);
      });
    });
  }
}

function generateColumnCrReport(table, colName, action, newVal) {
  const normCol = colName.toLowerCase();
  const normTable = table.name.toLowerCase();

  const affectedWorkflows = [];
  const affectedZbo = [];
  const affectedTriggers = [];
  const affectedFunctions = [];

  for (const wf of state.workflows) {
    for (const op of wf.dbOperations || []) {
      if (op.table === normTable && op.columns.includes(normCol)) {
        affectedWorkflows.push({
          workflow: wf.name,
          nodeId: op.nodeId,
          operation: op.operation,
          file: wf.sourcePath,
        });
      }
    }
  }

  for (const area of state.zboAreas) {
    for (const action of area.actions || []) {
      for (const op of action.dbOperations || []) {
        if (op.table === normTable && op.columns.includes(normCol)) {
          affectedZbo.push({
            area: area.name,
            context: `Action: ${action.label || action.name}`,
            operation: op.operation,
            file: action.sourcePath || area.sourcePaths[0],
          });
        }
      }
    }
    for (const op of area.graphqlOperations || []) {
      if (op.table === normTable && op.columns.includes(normCol)) {
        affectedZbo.push({
          area: area.name,
          context: `GraphQL: ${op.nodeId || "query"}`,
          operation: op.operation,
          file: area.sourcePaths[0],
        });
      }
    }
  }

  for (const t of table.triggers || []) {
    affectedTriggers.push({
      name: t.name,
      timing: t.timing,
      events: t.events,
      function: t.function,
    });
  }

  for (const fn of state.dbFunctions) {
    for (const op of fn.operations || []) {
      if (op.table === normTable) {
        const colRegex = new RegExp(`\\b${normCol}\\b`, "i");
        if (fn.code && colRegex.test(fn.code)) {
          affectedFunctions.push({
            name: fn.name,
            operation: op.operation,
            file: fn.sourcePath,
          });
        }
      }
    }
  }

  const uniqueWfs = uniqueBy(affectedWorkflows, w => `${w.workflow}:${w.nodeId}`);
  const uniqueZbos = uniqueBy(affectedZbo, z => `${z.area}:${z.context}`);
  const uniqueFns = uniqueBy(affectedFunctions, f => f.name);

  let riskScore = 1;
  let riskLevel = "LOW";
  let riskReason = "The column has minimal external impact.";

  const impactCount = uniqueWfs.length + uniqueZbos.length + uniqueFns.length + affectedTriggers.length;
  if (impactCount > 0) {
    riskScore = Math.min(10, Math.ceil(1.5 + impactCount * 0.8));
  }
  if (action === "drop") {
    riskScore = Math.min(10, riskScore + 3);
  }
  if (riskScore >= 7) {
    riskLevel = "HIGH";
    riskReason = "This column is widely referenced across multiple workflows, UI grids, or stored procedures. Breaking changes will cause widespread failures.";
  } else if (riskScore >= 4) {
    riskLevel = "MEDIUM";
    riskReason = "This column has moderate dependencies. Requires careful regression testing on the affected workflows and backoffice screens.";
  }

  const currentDate = new Date().toISOString().split("T")[0];

  let actionText = "";
  if (action === "drop") actionText = "DROP COLUMN";
  else if (action === "rename") actionText = `RENAME TO \`${newVal}\``;
  else actionText = `CHANGE TYPE TO \`${newVal}\``;

  let report = `# Database Change Impact Analysis\n`;
  report += `**Table:** \`${table.name}\`  \n`;
  report += `**Column:** \`${colName}\`  \n`;
  report += `**Action:** ${actionText}  \n`;
  report += `**Date:** ${currentDate}  \n\n`;

  report += `## Executive Summary\n`;
  report += `An impact analysis was generated for changing the column \`${colName}\` in table \`${table.name}\`.\n\n`;
  report += `- **Overall Risk Rating:** **${riskLevel}** (${riskScore}/10)\n`;
  report += `- **Dependency Count:** ${impactCount} total references found\n`;
  report += `- **Risk Rationale:** ${riskReason}\n\n`;

  report += `## Change Specifications\n`;
  report += `- **Target Table:** \`${table.name}\`\n`;
  report += `- **Target Column:** \`${colName}\`\n`;
  report += `- **Action Type:** ${action.toUpperCase()}\n`;
  report += `- **Modification Details:** ${actionText}\n\n`;

  report += `## Dependency Analysis\n\n`;

  report += `### 1. Zoral Workflows (${uniqueWfs.length} affected)\n`;
  if (uniqueWfs.length) {
    report += `The following Zoral workflow nodes query or modify this column:\n\n`;
    report += `| Workflow | Node ID | DB Operation | Source File |\n`;
    report += `|----------|---------|--------------|-------------|\n`;
    report += uniqueWfs.map(w => `| \`${w.workflow}\` | \`${w.nodeId}\` | ${w.operation} | \`${w.file.split("/").pop()}\` |`).join("\n") + "\n\n";
  } else {
    report += `No direct Zoral workflows reference this column.\n\n`;
  }

  report += `### 2. ZBO Backoffice UI Areas (${uniqueZbos.length} affected)\n`;
  if (uniqueZbos.length) {
    report += `The following backoffice UI sections, actions, or GraphQL queries use this column:\n\n`;
    report += `| ZBO Area | Context / Source | Operation | File |\n`;
    report += `|----------|------------------|-----------|------|\n`;
    report += uniqueZbos.map(z => `| \`${z.area}\` | ${z.context} | ${z.operation} | \`${z.file.split("/").pop()}\` |`).join("\n") + "\n\n";
  } else {
    report += `No direct ZBO screens query or display this column.\n\n`;
  }

  report += `### 3. PL/pgSQL Database Functions (${uniqueFns.length} affected)\n`;
  if (uniqueFns.length) {
    report += `The following database stored procedures execute logic depending on this column:\n\n`;
    report += `| Function Name | DB Operation | DDL File |\n`;
    report += `|---------------|--------------|----------|\n`;
    report += uniqueFns.map(f => `| \`${f.name}\` | ${f.operation} | \`${f.file.split("/").pop()}\` |`).join("\n") + "\n\n";
  } else {
    report += `No database functions reference this column directly.\n\n`;
  }

  report += `### 4. Active Table Triggers (${affectedTriggers.length} affected)\n`;
  if (affectedTriggers.length) {
    report += `The following active triggers are defined on table \`${table.name}\` and must be validated for compatibility:\n\n`;
    report += `| Trigger Name | Timing | Events | Executed Function |\n`;
    report += `|--------------|--------|--------|-------------------|\n`;
    report += affectedTriggers.map(t => `| \`${t.name}\` | ${t.timing} | ${t.events} | \`${t.function}\` |`).join("\n") + "\n\n";
  } else {
    report += `No active triggers are defined on this table.\n\n`;
  }

  report += `## Recommended Verification & Test Plan\n\n`;
  report += `1. **Database Schema Update:**  \n`;
  report += `   - Verify DDL deployment script correctness in staging.  \n`;
  report += `   - For type changes/renames, ensure existing data is migrated safely.  \n`;
  report += `2. **Automated Integration Testing:**  \n`;
  report += `   - Execute integration suites for the affected workflows: ${uniqueWfs.slice(0, 5).map(w => `\`${w.workflow}\``).join(", ") || "None"}.  \n`;
  report += `3. **Manual UI Validation:**  \n`;
  report += `   - Navigate to affected ZBO Areas: ${uniqueZbos.slice(0, 5).map(z => `\`${z.area}\``).join(", ") || "None"}.  \n`;
  report += `   - Perform read (SELECT) validation and write (INSERT/UPDATE) operations on forms touching this table.  \n`;
  report += `4. **Trigger Regression Testing:**  \n`;
  report += `   - Verify that trigger operations execute without SQL compilation errors after column modification.  \n`;

  return report;
}

function renderDatabaseDetails() {
  if (state.dbSubmode === "tables" || state.dbSubmode === "er") {
    const table = state.selectedTable;
    if (!table) {
      els.detailContent.innerHTML = renderEmpty("Select a table.");
      return;
    }
    if (state.activeTab === "overview") {
      els.detailContent.innerHTML = renderTableDatadict(table);
    } else if (state.activeTab === "node") {
      els.detailContent.innerHTML = renderTableTriggersAndFKs(table);
      // Bind click triggers/functions/FK table links inside the detail content
      els.detailContent.querySelectorAll("[data-func-link]").forEach(el => {
        el.addEventListener("click", (e) => {
          selectFunction(el.dataset.funcLink);
          setDbSubmode("functions");
          e.preventDefault();
        });
      });
      els.detailContent.querySelectorAll("[data-table-link]").forEach(el => {
        el.addEventListener("click", (e) => {
          selectTable(el.dataset.tableLink);
          e.preventDefault();
        });
      });
    } else if (state.activeTab === "db") {
      els.detailContent.innerHTML = renderTableCrudMap(table);
      
      els.detailContent.querySelectorAll("[data-func-link]").forEach(el => {
        el.addEventListener("click", (e) => {
          selectFunction(el.dataset.funcLink);
          setDbSubmode("functions");
          e.preventDefault();
        });
      });
      els.detailContent.querySelectorAll("[data-table-link]").forEach(el => {
        el.addEventListener("click", (e) => {
          selectTable(el.dataset.tableLink);
          e.preventDefault();
        });
      });

      const btnByCaller = document.getElementById("btnCrudByCaller");
      const btnByColumn = document.getElementById("btnCrudByColumn");
      if (btnByCaller && btnByColumn) {
        btnByCaller.addEventListener("click", () => {
          state.crudView = "caller";
          saveState();
          renderDatabaseDetails();
        });
        btnByColumn.addEventListener("click", () => {
          state.crudView = "column";
          saveState();
          renderDatabaseDetails();
        });
      }
    } else if (state.activeTab === "inbound") {
      els.detailContent.innerHTML = renderTableCrGen(table);
      bindCrFormEvents(table);
    }
  } else if (state.dbSubmode === "enums") {
    const en = state.selectedEnum;
    if (!en) {
      els.detailContent.innerHTML = renderEmpty("Select an enum.");
      return;
    }
    
    let content = "";
    if (en.values) {
      content = `
        <section class="detail-section">
          <h3>Custom Enum: ${escapeHtml(en.name)}</h3>
          ${renderKv("Source DDL File", "_schema_types_sequences.sql")}
        </section>
        <section class="detail-section">
          <h3>Enum Values</h3>
          <div class="small-list">
            ${en.values.map(v => `<span class="badge success">${escapeHtml(v)}</span>`).join("")}
          </div>
        </section>
      `;
    } else {
      const headers = en.rows.length ? Object.keys(en.rows[0]) : [];
      content = `
        <section class="detail-section">
          <h3>Table Enum: ${escapeHtml(en.name)}</h3>
          ${renderKv("Source Data File", en.sourcePath)}
          ${renderKv("Rows Count", en.rows.length)}
        </section>
        <section class="detail-section">
          <h3>Enum Data Rows</h3>
          <div style="overflow-x:auto;">
            <table class="table" style="font-size:12px;">
              <thead>
                <tr>
                  ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${en.rows.map(row => `
                  <tr>
                    ${headers.map(h => `<td>${escapeHtml(row[h] === null ? "NULL" : String(row[h]))}</td>`).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }
    els.detailContent.innerHTML = content;
  } else if (state.dbSubmode === "functions") {
    const fn = state.selectedFunction;
    if (!fn) {
      els.detailContent.innerHTML = renderEmpty("Select a function.");
      return;
    }

    const opRows = fn.operations?.length ? fn.operations.map(op => `
      <tr>
        <td style="font-weight:600;"><a href="#" data-table-link="${escapeAttr(op.table)}" class="workflow-link">${escapeHtml(op.table)}</a></td>
        <td><span class="db-op op-${escapeAttr(op.operation.toLowerCase())}" style="padding:1px 6px; font-size:10px;">${escapeHtml(op.operation)}</span></td>
      </tr>
    `).join("") : '<tr><td colspan="2" class="muted">No direct table operations parsed in function body.</td></tr>';

    els.detailContent.innerHTML = `
      <section class="detail-section">
        <h3>Function: ${escapeHtml(fn.name)}</h3>
        ${renderKv("File Path", fn.sourcePath)}
        ${renderKv("Operations Count", fn.operations?.length || 0)}
      </section>

      <section class="detail-section">
        <h3>Database Operations</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            ${opRows}
          </tbody>
        </table>
      </section>
    `;

    // Bind click table links in the functions DB ops tab
    els.detailContent.querySelectorAll("[data-table-link]").forEach(el => {
      el.addEventListener("click", (e) => {
        selectTable(el.dataset.tableLink);
        setDbSubmode("tables");
        e.preventDefault();
      });
    });
  }
}

function renderDatabaseDiagram() {
  if (state.dbSubmode === "tables" && state.selectedTable) {
    renderTableDependencyDiagram(state.selectedTable);
  } else if (state.dbSubmode === "enums" && state.selectedEnum) {
    if (state.selectedEnum.values) {
      const enumCode = `CREATE TYPE ${state.selectedEnum.name} AS ENUM (\n  ${state.selectedEnum.values.map(v => `'${v}'`).join(",\n  ")}\n);`;
      els.diagramCanvas.innerHTML = `<pre class="code-block" style="padding: 20px; margin: 20px; background: #0f172a; color: #f8fafc; font-family: monospace; border-radius: 8px; font-size: 13px; line-height: 1.5; overflow: auto; user-select: text; border: 1px solid var(--line); box-shadow: var(--shadow);">${escapeHtml(enumCode)}</pre>`;
    } else {
      els.diagramCanvas.innerHTML = `<div class="empty-state">Enum data table details are shown in the right pane. Select "Tables" or "Functions" for diagrams.</div>`;
    }
  } else if (state.dbSubmode === "functions" && state.selectedFunction) {
    els.diagramCanvas.innerHTML = `<pre class="code-block" style="padding: 20px; margin: 20px; background: #0f172a; color: #f8fafc; font-family: monospace; border-radius: 8px; font-size: 13px; line-height: 1.5; height: calc(100% - 40px); overflow: auto; user-select: text; border: 1px solid var(--line); box-shadow: var(--shadow);">${escapeHtml(state.selectedFunction.code || "No source code available.")}</pre>`;
  } else if (state.dbSubmode === "er") {
    renderErDiagram();
  } else {
    els.diagramCanvas.innerHTML = `<div class="empty-state">No database item selected</div>`;
  }
  applyZoom();
}

function addOpsForTable(ops, tableName, target) {
  for (const op of ops || []) {
    if (op.table === tableName && op.operation) {
      target.add(normalizeOperation(op.operation).toUpperCase());
    }
  }
}

function addWorkflowOpsForTable(workflowNames, tableName, target) {
  const names = new Set(workflowNames || []);
  for (const wf of state.workflows || []) {
    if (!names.has(wf.name)) continue;
    addOpsForTable(wf.dbOperations, tableName, target);
  }
}

function addZboOpsForTable(areaNames, tableName, target) {
  const names = new Set(areaNames || []);
  for (const area of state.zboAreas || []) {
    if (!names.has(area.name)) continue;
    addOpsForTable(area.graphqlOperations, tableName, target);
    for (const action of area.actions || []) {
      addOpsForTable(action.dbOperations, tableName, target);
    }
  }
}

function operationEdgeLabel(ops, fallback) {
  const order = ["SELECT", "INSERT", "UPDATE", "DELETE", "UPSERT", "MUTATION"];
  const ordered = [...ops].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex >= 0 ? leftIndex : order.length) - (rightIndex >= 0 ? rightIndex : order.length);
    }
    return left.localeCompare(right);
  });
  return ordered.length ? ordered.join("/") : fallback;
}

function renderTableDependencyDiagram(table) {
  // 1. Ancestors BFS (negative layers relative to selected table at 0)
  const ancestorNodes = [];
  const visited = new Set([table.name]);
  const queue = [{ name: table.name, layer: 0 }];

  while (queue.length > 0) {
    const curr = queue.shift();
    if (!state.showDeepHierarchy && curr.layer <= -1) {
      continue;
    }
    const currTable = state.dbTables.find(t => t.name === curr.name);
    if (!currTable) continue;
    
    const parentNames = unique((currTable.foreignKeys || []).map(fk => fk.referencedTable));
    for (const pName of parentNames) {
      if (!state.showEnumTables && pName.toLowerCase().startsWith("enum_")) {
        continue;
      }
      if (!state.showDbTaskTables && (pName === "task" || pName === "task_document")) {
        continue;
      }
      if (!visited.has(pName)) {
        visited.add(pName);
        const parentLayer = curr.layer - 1;
        ancestorNodes.push({ name: pName, layer: parentLayer });
        queue.push({ name: pName, layer: parentLayer });
      }
    }
  }

  // 2. Descendants BFS (positive layers relative to selected table at 0)
  const descendantNodes = [];
  const dVisited = new Set(visited);
  const dQueue = [{ name: table.name, layer: 0 }];

  while (dQueue.length > 0) {
    const curr = dQueue.shift();
    if (!state.showDeepHierarchy && curr.layer >= 1) {
      continue;
    }
    
    const childNames = unique(
      state.dbTables
        .filter(t => (t.foreignKeys || []).some(fk => fk.referencedTable === curr.name))
        .map(t => t.name)
    );
    
    for (const cName of childNames) {
      if (!state.showEnumTables && cName.toLowerCase().startsWith("enum_")) {
        continue;
      }
      if (!state.showDbTaskTables && (cName === "task" || cName === "task_document")) {
        continue;
      }
      if (!dVisited.has(cName)) {
        dVisited.add(cName);
        const childLayer = curr.layer + 1;
        descendantNodes.push({ name: cName, layer: childLayer });
        dQueue.push({ name: cName, layer: childLayer });
      }
    }
  }

  // 3. Group into layers
  const layers = {};
  layers[0] = [table.name];

  for (const n of ancestorNodes) {
    if (!layers[n.layer]) layers[n.layer] = [];
    layers[n.layer].push(n.name);
  }

  for (const n of descendantNodes) {
    if (!layers[n.layer]) layers[n.layer] = [];
    layers[n.layer].push(n.name);
  }

  const layerKeys = Object.keys(layers).map(Number).sort((a, b) => a - b);
  const minLayer = Math.min(...layerKeys, 0);
  const maxLayer = Math.max(...layerKeys, 0);

  for (const L of layerKeys) {
    layers[L].sort();
  }

  // 4. Layout coordinates
  const showZoralCallers = state.showZoralCallersDb;
  const showZboCallers = state.showZboCallersDb;
  const showDbFuncs = state.showDbFuncsCallersDb;
  const colSpacing = 285;
  const rowSpacing = 160;
  const maxNodesInLayer = Math.max(...Object.values(layers).map(arr => arr.length));
  let centerX = 500;

  // Group workflows and ZBO callers early to compute dynamic heights/spacing
  const wfGroups = {};
  const zboGroups = {};
  let maxZboH = 50;
  let maxWfH = 50;
  let wfY = 200;
  let tableStartY = 100;

  const wfCallers = state.workflows.filter(wf => 
    (wf.dbOperations || []).some(op => op.table === table.name)
  ).map(wf => wf.name).sort();

  const zboCallers = [];
  if (showZoralCallers || showZboCallers) {
    for (const area of state.zboAreas) {
      const callsWfs = (area.zoralCalls || []).some(call => wfCallers.includes(call.workflow));
      const callsTableDirect = (area.actions || []).some(action => 
        (action.dbOperations || []).some(op => op.table === table.name)
      ) || (area.graphqlOperations || []).some(op => op.table === table.name);
      
      if (callsWfs || callsTableDirect) {
        zboCallers.push(area.name);
      }
    }
    zboCallers.sort();
  }

  // Group Zoral workflows by their callers
  if (showZoralCallers) {
    wfCallers.forEach(wfName => {
      const callers = zboCallers
        .filter(areaName => {
          const area = state.zboAreas.find(a => a.name === areaName);
          return area && (area.zoralCalls || []).some(call => call.workflow === wfName);
        })
        .sort();
      const key = callers.join(",") || "(direct)";
      if (!wfGroups[key]) {
        wfGroups[key] = {
          key,
          workflows: [],
          zboCallers: callers
        };
      }
      wfGroups[key].workflows.push(wfName);
    });
  }

  if (showZboCallers) {
    // Group ZBO areas by their called workflows / direct calls
    zboCallers.forEach(areaName => {
      const area = state.zboAreas.find(a => a.name === areaName);
      if (!area) return;
      const calledWfs = (area.zoralCalls || [])
        .map(call => call.workflow)
        .filter(w => wfCallers.includes(w))
        .sort();
      const callsDirect = (area.actions || []).some(action => 
        (action.dbOperations || []).some(op => op.table === table.name)
      ) || (area.graphqlOperations || []).some(op => op.table === table.name);
      
      const key = calledWfs.join(",") + (callsDirect ? "+direct" : "");
      if (!zboGroups[key]) {
        zboGroups[key] = {
          key,
          areas: [],
          calledWfs,
          callsDirect
        };
      }
      zboGroups[key].areas.push(areaName);
    });
  }

  // Compute max heights
  Object.values(zboGroups).forEach(group => {
    const MAX_VISIBLE = 8;
    const visible = group.areas.slice(0, MAX_VISIBLE);
    if (group.areas.length > MAX_VISIBLE) {
      visible.push(`... and ${group.areas.length - MAX_VISIBLE} more`);
    }
    const h = Math.max(50, 20 + visible.length * 15);
    if (h > maxZboH) maxZboH = h;
  });

  Object.values(wfGroups).forEach(group => {
    const MAX_VISIBLE = 8;
    const visible = group.workflows.slice(0, MAX_VISIBLE);
    if (group.workflows.length > MAX_VISIBLE) {
      visible.push(`... and ${group.workflows.length - MAX_VISIBLE} more`);
    }
    const h = Math.max(50, 20 + visible.length * 15);
    if (h > maxWfH) maxWfH = h;
  });

  // Collect PL/pgSQL function callers
  const dbFuncCallers = state.dbFunctions.filter(f =>
    (f.operations || []).some(op => op.table === table.name)
  ).map(f => f.name).sort();

  // Dynamically calculate layout y positions (with at least 120px vertical gap)
  let currentY = 80;
  let zboY = 0;
  wfY = 0;
  let dbFuncY = 0;

  if (showZboCallers && Object.keys(zboGroups).length > 0) {
    zboY = currentY + maxZboH / 2;
    currentY += maxZboH + 120;
  }
  if (showZoralCallers && Object.keys(wfGroups).length > 0) {
    wfY = currentY + maxWfH / 2;
    currentY += maxWfH + 120;
  }
  if (showDbFuncs && dbFuncCallers.length > 0) {
    dbFuncY = currentY + 25;
    currentY += 50 + 120;
  }
  tableStartY = currentY + 25;
  let centerY = tableStartY + (0 - minLayer) * rowSpacing;

  const nodes = [];
  const edges = [];
  const nodeWidths = {};

  // Lay out table nodes
  for (const L of layerKeys) {
    const arr = layers[L];
    const n = arr.length;
    arr.forEach((tableName, idx) => {
      const originalY = tableStartY + (L - minLayer) * rowSpacing;
      const originalX = centerX - ((n - 1) * colSpacing) / 2 + idx * colSpacing;
      
      const override = state.nodePositions?.database?.[`tableDep-${table.name}-${tableName}`];
      const x = override && Number.isFinite(override.x) ? override.x : originalX;
      const y = override && Number.isFinite(override.y) ? override.y : originalY;
      
      const label = tableName;
      const w = Math.max(120, label.length * 6.5 + 45);
      nodeWidths[tableName] = w;
      
      nodes.push({
        id: tableName,
        kind: tableName === table.name ? "center" : (L < 0 ? "parent" : "child"),
        tableName,
        label,
        x,
        y,
        width: w,
        height: 50
      });
    });
  }

  // Connect table foreign keys (swapped to point Parent -> Child)
  const nodeNames = new Set(nodes.map(n => n.id));
  for (const n of nodes) {
    const currentTable = state.dbTables.find(t => t.name === n.tableName);
    if (!currentTable) continue;
    
    for (const fk of currentTable.foreignKeys || []) {
      if (nodeNames.has(fk.referencedTable) && fk.referencedTable !== n.id) {
        edges.push({
          from: fk.referencedTable, // parent referenced
          to: n.id, // child referencing
          kind: "fk",
          label: ""
        });
      }
    }
  }

  // Lay out trigger functions
  if (state.showDbTriggers) {
    const triggerFunctions = unique((table.triggers || []).map(t => t.function.replace(/\(\)$/, ""))).sort();
    const triggerLayer = maxLayer + 1;
    const triggerStartY = tableStartY + (triggerLayer - minLayer) * rowSpacing;
    triggerFunctions.forEach((f, idx) => {
      const id = `trig-${f}`;
      const originalX = centerX - ((triggerFunctions.length - 1) * colSpacing) / 2 + idx * colSpacing;
      const originalY = triggerStartY;
      
      const override = state.nodePositions?.database?.[`tableDep-${table.name}-${id}`];
      const x = override && Number.isFinite(override.x) ? override.x : originalX;
      const y = override && Number.isFinite(override.y) ? override.y : originalY;
      
      const w = Math.max(120, f.length * 6.5 + 45);
      nodeWidths[id] = w;
      nodes.push({
        id,
        kind: "trigger",
        functionName: f,
        label: f,
        x,
        y,
        width: w,
        height: 50
      });
      edges.push({
        from: table.name,
        to: id,
        kind: "trigger",
        label: ""
      });
    });
  }

  // UI Callers Overlay (grouped by target paths to avoid clutter)
  if (showZoralCallers || showZboCallers) {
    const wfGroupList = Object.values(wfGroups);
    const gap = 40;
    
    const wfGroupWidths = wfGroupList.map(group => {
      const MAX_VISIBLE = 8;
      const visible = group.workflows.slice(0, MAX_VISIBLE);
      if (group.workflows.length > MAX_VISIBLE) {
        visible.push(`... and ${group.workflows.length - MAX_VISIBLE} more`);
      }
      const maxLen = Math.max(...visible.map(w => w.length));
      return Math.max(120, maxLen * 6.5 + 45);
    });
    
    const totalWfWidth = wfGroupWidths.reduce((sum, w) => sum + w, 0) + gap * (wfGroupList.length - 1);
    let startWfX = centerX - totalWfWidth / 2;

    if (showZoralCallers) {
      wfGroupList.forEach((group, idx) => {
      const id = `wfGroup-${group.key}`;
      const w = wfGroupWidths[idx];
      
      const MAX_VISIBLE = 8;
      const visible = group.workflows.slice(0, MAX_VISIBLE);
      if (group.workflows.length > MAX_VISIBLE) {
        visible.push(`... and ${group.workflows.length - MAX_VISIBLE} more`);
      }
      
      const h = Math.max(50, 20 + visible.length * 15);
      const originalX = startWfX + w / 2;
      startWfX += w + gap;
      const originalY = wfY;
      
      const override = state.nodePositions?.database?.[`tableDep-${table.name}-${id}`];
      const x = override && Number.isFinite(override.x) ? override.x : originalX;
      const y = override && Number.isFinite(override.y) ? override.y : originalY;
      
      nodeWidths[id] = w;
      nodes.push({
        id,
        kind: "zoralCall",
        workflowName: group.workflows[0],
        workflows: visible,
        label: visible.join("\n"),
        x,
        y,
        width: w,
        height: h
      });

      const opsSet = new Set();
      group.workflows.forEach(wfName => {
        const wf = state.workflows.find(w => w.name === wfName);
        if (wf) {
          addOpsForTable(wf.dbOperations, table.name, opsSet);
        }
      });
      const edgeLabel = operationEdgeLabel(opsSet, "calls DB");

      edges.push({
        from: id,
        to: table.name,
        kind: "caller-link",
        label: edgeLabel
      });
      });
    }

    if (showZboCallers) {
      const zboGroupList = Object.values(zboGroups);
    const zboGroupWidths = zboGroupList.map(group => {
      const MAX_VISIBLE = 8;
      const visible = group.areas.slice(0, MAX_VISIBLE);
      if (group.areas.length > MAX_VISIBLE) {
        visible.push(`... and ${group.areas.length - MAX_VISIBLE} more`);
      }
      const maxLen = Math.max(...visible.map(a => a.length));
      return Math.max(120, maxLen * 6.5 + 45);
    });

    const totalZboWidth = zboGroupWidths.reduce((sum, w) => sum + w, 0) + gap * (zboGroupList.length - 1);
    let startZboX = centerX - totalZboWidth / 2;

    zboGroupList.forEach((group, idx) => {
      const id = `zboGroup-${group.key}`;
      const w = zboGroupWidths[idx];
      
      const MAX_VISIBLE = 8;
      const visible = group.areas.slice(0, MAX_VISIBLE);
      if (group.areas.length > MAX_VISIBLE) {
        visible.push(`... and ${group.areas.length - MAX_VISIBLE} more`);
      }
      
      const h = Math.max(50, 20 + visible.length * 15);
      const originalX = startZboX + w / 2;
      startZboX += w + gap;
      const originalY = 80;
      
      const override = state.nodePositions?.database?.[`tableDep-${table.name}-${id}`];
      const x = override && Number.isFinite(override.x) ? override.x : originalX;
      const y = override && Number.isFinite(override.y) ? override.y : originalY;
      
      nodeWidths[id] = w;
      nodes.push({
        id,
        kind: "zboCall",
        zboAreaName: group.areas[0],
        areas: visible,
        label: visible.join("\n"),
        x,
        y,
        width: w,
        height: h
      });

      let connected = false;
      wfGroupList.forEach(wfGroup => {
        const hasCall = wfGroup.workflows.some(w => group.calledWfs.includes(w));
        if (hasCall) {
          edges.push({
            from: id,
            to: `wfGroup-${wfGroup.key}`,
            kind: "caller-link",
            label: operationEdgeLabel(
              new Set(
                wfGroup.workflows
                  .filter((wfName) => group.calledWfs.includes(wfName))
                  .flatMap((wfName) => {
                    const wf = state.workflows.find((item) => item.name === wfName);
                    return (wf?.dbOperations || [])
                      .filter((op) => op.table === table.name && op.operation)
                      .map((op) => normalizeOperation(op.operation).toUpperCase());
                  }),
              ),
              "calls API",
            )
          });
          connected = true;
        }
      });

      if (!connected || group.callsDirect) {
        const zboOpsSet = new Set();
        addZboOpsForTable(group.areas, table.name, zboOpsSet);
        addWorkflowOpsForTable(group.calledWfs, table.name, zboOpsSet);
        const edgeLabel = operationEdgeLabel(zboOpsSet, "calls GQL");

        edges.push({
          from: id,
          to: table.name,
          kind: "caller-link",
          label: edgeLabel
        });
      }
    });
    }
  }

  // DB Function Callers Layout
  if (showDbFuncs && dbFuncCallers.length > 0) {
    dbFuncCallers.forEach((fName, idx) => {
      const id = `dbFunc-${fName}`;
      const originalX = centerX - ((dbFuncCallers.length - 1) * colSpacing) / 2 + idx * colSpacing;
      const originalY = dbFuncY;

      const override = state.nodePositions?.database?.[`tableDep-${table.name}-${id}`];
      const x = override && Number.isFinite(override.x) ? override.x : originalX;
      const y = override && Number.isFinite(override.y) ? override.y : originalY;

      const w = Math.max(120, fName.length * 6.5 + 45);
      nodeWidths[id] = w;
      nodes.push({
        id,
        kind: "dbFunction",
        functionName: fName,
        label: fName,
        x,
        y,
        width: w,
        height: 50
      });

      const f = state.dbFunctions.find(item => item.name === fName);
      const opsSet = new Set();
      if (f) {
        addOpsForTable(f.operations, table.name, opsSet);
      }
      const edgeLabel = operationEdgeLabel(opsSet, "uses");

      edges.push({
        from: id,
        to: table.name,
        kind: "dbFunc-link",
        label: edgeLabel
      });
    });
  }

  // Deduplicate edges with the same source, target, kind, and label to avoid duplicate lines
  const seenEdges = new Set();
  const uniqueEdges = [];
  for (const edge of edges) {
    const key = `${edge.from}:${edge.to}:${edge.kind || ""}:${edge.label || ""}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      uniqueEdges.push(edge);
    }
  }

  // Merge bidirectional edges (e.g. A -> B and B -> A) into one edge with double arrows
  const finalEdges = [];
  const processedKeys = new Set();
  for (const edge of uniqueEdges) {
    const key = `${edge.from}:${edge.to}:${edge.kind || ""}:${edge.label || ""}`;
    if (processedKeys.has(key)) continue;

    const revKey = `${edge.to}:${edge.from}:${edge.kind || ""}:${edge.label || ""}`;
    // Look for a reverse edge in uniqueEdges
    const hasReverse = uniqueEdges.some(e => 
      e.from === edge.to && 
      e.to === edge.from && 
      (e.kind || "") === (edge.kind || "") && 
      (e.label || "") === (edge.label || "")
    );

    if (hasReverse) {
      edge.bidirectional = true;
      processedKeys.add(key);
      processedKeys.add(revKey);
    } else {
      processedKeys.add(key);
    }
    finalEdges.push(edge);
  }

  edges.length = 0;
  edges.push(...finalEdges);

  // 5. Shift all coordinates to prevent left/top overflow (negative coordinates)
  let minNodeX = Infinity;
  let minNodeY = Infinity;
  nodes.forEach(n => {
    const leftX = n.x - n.width / 2;
    const topY = n.y - n.height / 2;
    if (leftX < minNodeX) minNodeX = leftX;
    if (topY < minNodeY) minNodeY = topY;
  });

  const shiftX = minNodeX < 50 ? (50 - minNodeX) : 0;
  const shiftY = minNodeY < 50 ? (50 - minNodeY) : 0;

  if (shiftX > 0 || shiftY > 0) {
    nodes.forEach(n => {
      n.x += shiftX;
      n.y += shiftY;
    });
    centerY += shiftY;
    centerX += shiftX;
    wfY += shiftY;
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.width / 2 + 150), 1000);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.height / 2 + 100), 600);

  // SVG Helper icon renderers
  const renderDbIcon = (x, y) => `
    <g class="db-icon" aria-hidden="true" style="stroke: #0d9488; fill: none; stroke-width: 1.5px; opacity: 0.85;">
      <ellipse cx="${x + 7}" cy="${y + 4}" rx="6" ry="2.5"></ellipse>
      <path d="M ${x + 1} ${y + 4} L ${x + 1} ${y + 11} A 6 2.5 0 0 0 ${x + 13} ${y + 11} L ${x + 13} ${y + 4}"></path>
      <path d="M ${x + 1} ${y + 7.5} A 6 2.5 0 0 0 ${x + 13} ${y + 7.5}"></path>
    </g>
  `;

  const renderScreenIcon = (x, y) => `
    <g class="zbo-screen-icon" aria-hidden="true" style="stroke: #7c3aed; fill: none; stroke-width: 1.5px;">
      <rect x="${x}" y="${y}" width="15" height="10" rx="1.5"></rect>
      <path d="M ${x + 4} ${y + 13} L ${x + 11} ${y + 13}"></path>
      <path d="M ${x + 7.5} ${y + 10} L ${x + 7.5} ${y + 13}"></path>
    </g>
  `;

  const renderWfIcon = (x, y) => `
    <g class="wf-icon" aria-hidden="true" style="stroke: #2563eb; fill: none; stroke-width: 1.5px;">
      <rect x="${x}" y="${y}" width="14" height="14" rx="2.5"></rect>
      <path d="M ${x + 3} ${y + 7} L ${x + 11} ${y + 7} M ${x + 7} ${y + 3} L ${x + 7} ${y + 11}"></path>
    </g>
  `;

  const renderTriggerIcon = (x, y) => `
    <g class="trigger-icon" aria-hidden="true" style="stroke: #ea580c; fill: none; stroke-width: 1.5px;">
      <path d="M ${x + 7} ${y + 1} L ${x + 1} ${y + 7} L ${x + 7} ${y + 13} L ${x + 13} ${y + 7} Z"></path>
      <circle cx="${x + 7}" cy="${y + 7}" r="2.5"></circle>
    </g>
  `;

  // Draw edges between dynamic boundaries of rectangles (with non-overlapping routing)
  const edgeHtml = edges.map((edge, idx) => {
    const fromNode = nodes.find(n => n.id === edge.from);
    const toNode = nodes.find(n => n.id === edge.to);
    if (!fromNode || !toNode) return "";

    const w1 = nodeWidths[fromNode.id] || 180;
    const w2 = nodeWidths[toNode.id] || 180;
    const h1 = fromNode.height || 50;
    const h2 = toNode.height || 50;

    // Caller-link and trigger edges should always go straight (no lane offset).
    // Only FK edges use a small lane offset to separate overlapping parallel lines.
    const isStraightEdge = edge.kind === "caller-link" || edge.kind === "trigger";
    const lane = isStraightEdge ? 0 : ((idx % 5) - 2) * 12;

    let path = "";
    let labelX = (fromNode.x + toNode.x) / 2;
    let labelY = (fromNode.y + toNode.y) / 2 + 3;

    if (edge.kind === "caller-link") {
      if (Math.abs(fromNode.y - toNode.y) < 5) {
        const toRight = fromNode.x <= toNode.x;
        const sx = fromNode.x + (toRight ? w1 / 2 : -w1 / 2);
        const sy = fromNode.y;
        const ex = toNode.x + (toRight ? -w2 / 2 : w2 / 2);
        const ey = toNode.y;
        const midX = (sx + ex) / 2;
        path = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`;
        labelX = sx + (toRight ? 54 : -54);
        labelY = sy - 10;
      } else {
        const toBelow = fromNode.y < toNode.y;
        const sx = fromNode.x;
        const sy = fromNode.y + (toBelow ? h1 / 2 : -h1 / 2);
        const ex = toNode.x;
        const ey = toNode.y + (toBelow ? -h2 / 2 : h2 / 2);
        if (Math.abs(sx - ex) < 8) {
          path = `M ${sx} ${sy} L ${ex} ${ey}`;
          labelX = sx;
          labelY = sy + (toBelow ? 34 : -26);
        } else {
          const midY = (sy + ey) / 2;
          path = `M ${sx} ${sy} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${ey}`;
          labelX = sx;
          labelY = sy + (toBelow ? 34 : -26);
        }
      }
    // Special routing for vertical orthogonal paths (ZBO -> Workflow -> Table -> Trigger)
    } else if (Math.abs(fromNode.y - toNode.y) < 5) {
      // Same layer horizontal: use a simple bracket route (go down, horizontally, then up)
      const sy = fromNode.y + h1/2;
      const ey = toNode.y + h2/2;
      const stepY = sy + 30 + Math.abs(lane);
      path = `M ${fromNode.x + lane} ${sy} L ${fromNode.x + lane} ${stepY} L ${toNode.x + lane} ${stepY} L ${toNode.x + lane} ${ey}`;
      labelX = (fromNode.x + toNode.x) / 2 + lane;
      labelY = stepY - 12;
    } else {
      // Different layers: use vertical orthogonal routing
      const toBelow = fromNode.y < toNode.y;
      const sy = fromNode.y + (toBelow ? h1/2 : -h1/2);
      const ey = toNode.y + (toBelow ? -h2/2 : h2/2);
      const sx = fromNode.x + lane;
      const ex = toNode.x + lane;

      const yDiff = Math.abs(fromNode.y - toNode.y);
      if (yDiff < rowSpacing + 10) {
        // Adjacent layers: 3-segment step route in the gap
        const midY = (sy + ey) / 2;
        path = `M ${sx} ${sy} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${ey}`;
        labelX = (sx + ex) / 2;
        labelY = midY + 3;
      } else {
        // Non-adjacent layers: route around intermediate nodes to avoid collision
        const minY = Math.min(fromNode.y, toNode.y);
        const maxY = Math.max(fromNode.y, toNode.y);
        const intermediateNodes = nodes.filter(n => n.y > minY + 10 && n.y < maxY - 10);

        let minX = Math.min(fromNode.x - w1/2, toNode.x - w2/2);
        let maxX = Math.max(fromNode.x + w1/2, toNode.x + w2/2);
        intermediateNodes.forEach(n => {
          const left = n.x - n.width/2;
          const right = n.x + n.width/2;
          if (left < minX) minX = left;
          if (right > maxX) maxX = right;
        });

        const routeOnLeft = toNode.x < fromNode.x;
        const routeX = routeOnLeft ? (minX - 45 + lane) : (maxX + 45 + lane);

        const stepY1 = sy + (toBelow ? 20 : -20);
        const stepY2 = ey + (toBelow ? -20 : 20);

        path = `M ${sx} ${sy} L ${sx} ${stepY1} L ${routeX} ${stepY1} L ${routeX} ${stepY2} L ${ex} ${stepY2} L ${ex} ${ey}`;
        labelX = routeX;
        labelY = (stepY1 + stepY2) / 2 + 3;
      }
    }

    const isEdgeSelected = state.selectedEdge && 
                           state.selectedEdge.from === edge.from && 
                           state.selectedEdge.to === edge.to;
    const isFromHighlighted = state.selectedNodeId === edge.from;
    const isToHighlighted = state.selectedNodeId === edge.to;
    
    const edgeClasses = [
      "zbo-flow-edge",
      edge.kind === "trigger" ? "is-trigger" : "",
      isEdgeSelected ? "selected" : "",
      isFromHighlighted ? "edge-outbound" : "",
      isToHighlighted ? "edge-inbound" : ""
    ].filter(Boolean).join(" ");

    const markerStart = edge.bidirectional ? 'marker-start="url(#zboArrowStart)"' : "";
    const labelText = edge.label ? `<text class="edge-label" x="${labelX}" y="${labelY}" text-anchor="middle" style="font-size:10px; fill:var(--muted); stroke:#ffffff; stroke-width:3px; stroke-linejoin:round; paint-order:stroke fill;">${escapeHtml(edge.label)}</text>` : "";
    return `
      <g class="${edgeClasses}" data-edge-from="${escapeAttr(edge.from)}" data-edge-to="${escapeAttr(edge.to)}">
        <path class="zbo-edge-line" d="${path}" marker-end="url(#zboArrow)" ${markerStart}></path>
        <path class="zbo-edge-hit" d="${path}"></path>
        ${labelText}
      </g>
    `;
  }).join("");

  const nodeHtml = nodes.map(node => {
    const w = node.width;
    const h = node.height;
    const x = node.x - w / 2;
    const y = node.y - h / 2;
    
    let colorClass = "zbo-flow-api";
    let linkData = "";
    let iconHtml = "";

    if (node.kind === "center") {
      colorClass = "zbo-flow-trigger active";
      iconHtml = renderDbIcon(x + 10, node.y - 7);
    } else if (node.kind === "parent" || node.kind === "child") {
      colorClass = "zbo-flow-node";
      linkData = `data-table-click="${escapeAttr(node.tableName)}"`;
      iconHtml = renderDbIcon(x + 10, node.y - 7);
    } else if (node.kind === "trigger") {
      colorClass = "zbo-flow-navigate";
      linkData = `data-func-click="${escapeAttr(node.functionName)}"`;
      iconHtml = renderTriggerIcon(x + 10, node.y - 7);
    } else if (node.kind === "zoralCall") {
      colorClass = "zbo-flow-workflow";
      linkData = `data-wf-click="${escapeAttr(node.workflowName)}"`;
      iconHtml = renderWfIcon(x + 10, node.y - 7);
    } else if (node.kind === "zboCall") {
      colorClass = "zbo-flow-gql zbo-flow-zbo-caller";
      linkData = `data-zbo-click="${escapeAttr(node.zboAreaName)}"`;
      iconHtml = renderScreenIcon(x + 10, node.y - 7);
    } else if (node.kind === "dbFunction") {
      colorClass = "zbo-flow-gql";
      linkData = `data-func-click="${escapeAttr(node.functionName)}"`;
      iconHtml = renderTriggerIcon(x + 10, node.y - 7);
    }

    // Handle multiline labels using tspan
    let labelHtml = "";
    if (node.workflows || node.areas) {
      const list = node.workflows || node.areas;
      const startDy = -(list.length - 1) * 7.5 + 4;
      labelHtml = list.map((item, idx) => {
        return `<tspan x="${x + 30}" dy="${idx === 0 ? startDy : 15}">${escapeHtml(item)}</tspan>`;
      }).join("");
    } else {
      labelHtml = escapeHtml(node.label);
    }

    const isNodeActive = state.selectedNodeId === node.id || 
                         (state.selectedEdge && (state.selectedEdge.from === node.id || state.selectedEdge.to === node.id));
    const activeNodeClass = isNodeActive ? "active" : "";

    const cursorStyle = state.enableNodeDrag ? "cursor: grab;" : "cursor: pointer;";
    const rectStyle = node.kind === "zboCall" ? "stroke-width:2.4px;" : "stroke-width:1.5px;";
    return `
      <g class="zbo-flow-node ${colorClass} ${activeNodeClass}" data-node-id="${escapeAttr(node.id)}" style="${cursorStyle}" ${linkData}>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" style="${rectStyle}"></rect>
        ${iconHtml}
        <text class="zbo-flow-label" x="${x + 30}" y="${node.y}" text-anchor="start" style="font-size:11px; font-weight:600;">${labelHtml}</text>
      </g>
    `;
  }).join("");

  els.diagramCanvas.innerHTML = `
    <svg class="diagram-svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
      <defs>
        <marker id="zboArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#8090a0"></path>
        </marker>
        <marker id="zboArrowStart" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M9,0 L9,6 L0,3 z" fill="#8090a0"></path>
        </marker>
      </defs>
      <g>${edgeHtml}</g>
      <g>${nodeHtml}</g>
    </svg>
  `;

  // Bind interactive click handlers (Click selects node, Double-click navigates)
  els.diagramCanvas.querySelectorAll("[data-node-id]").forEach(el => {
    const nodeId = el.dataset.nodeId;
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      selectTable(nodeId);
      setDbSubmode("tables");
    });
  });

  els.diagramCanvas.querySelectorAll("[data-table-click]").forEach(el => {
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectTable(el.dataset.tableClick);
      state.panes.detail = true;
      applyLayoutState();
    });
  });

  els.diagramCanvas.querySelectorAll("[data-func-click]").forEach(el => {
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectFunction(el.dataset.funcClick);
      setDbSubmode("functions");
      state.panes.detail = true;
      applyLayoutState();
    });
  });

  els.diagramCanvas.querySelectorAll("[data-wf-click]").forEach(el => {
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectWorkflow(el.dataset.wfClick);
      setMode("zoral");
      state.panes.detail = true;
      applyLayoutState();
    });
  });

  els.diagramCanvas.querySelectorAll("[data-zbo-click]").forEach(el => {
    el.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      selectZboArea(el.dataset.zboClick);
      setMode("zbo");
      state.panes.detail = true;
      applyLayoutState();
    });
  });

  els.diagramCanvas.querySelectorAll("[data-edge-from]").forEach(el => {
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      selectDatabaseDiagramEdge(el.dataset.edgeFrom, el.dataset.edgeTo);
    });
  });

  // SVG background click clears selection
  const svgEl = els.diagramCanvas.querySelector(".diagram-svg");
  if (svgEl) {
    svgEl.addEventListener("click", (event) => {
      if (event.target === svgEl) {
        state.selectedNodeId = null;
        state.selectedEdge = null;
        saveState();
        renderDatabaseDiagram();
        renderDatabaseDetails();
      }
    });
  }

  // Attach node dragging if enabled
  applyDiagramDragState();
  els.diagramCanvas._tableDepNodes = new Map(nodes.map(n => [n.id, n]));
  els.diagramCanvas.querySelectorAll("[data-node-id]").forEach(nodeEl => {
    if (state.enableNodeDrag) {
      attachTableDepNodeDrag(nodeEl, table);
    }
  });

  // Center diagram on the selected table node
  requestAnimationFrame(() => {
    const canvas = els.diagramCanvas;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.scrollLeft = (centerX * state.zoom) - cw / 2;
    canvas.scrollTop = (centerY * state.zoom) - ch / 2;
  });
}

function attachTableDepNodeDrag(nodeEl, table) {
  const nodeId = nodeEl.dataset.nodeId;
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("text")) return;
    const startCursorX = event.clientX;
    const startCursorY = event.clientY;
    const diagramNode = (els.diagramCanvas._tableDepNodes || new Map()).get(nodeId);
    if (!diagramNode) return;
    const startNodeX = diagramNode.x;
    const startNodeY = diagramNode.y;
    let dragging = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let rafQueued = false;
    try {
      nodeEl.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startCursorX) / state.zoom;
      const dy = (moveEvent.clientY - startCursorY) / state.zoom;
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startCursorX, moveEvent.clientY - startCursorY) > 4
      ) {
        dragging = true;
        suppressDiagramClick = true;
        nodeEl.classList.add("dragging");
      }
      if (!dragging) return;
      pendingDx = dx;
      pendingDy = dy;
      if (!rafQueued) {
        rafQueued = true;
        requestAnimationFrame(() => {
          rafQueued = false;
          nodeEl.setAttribute("transform", `translate(${pendingDx}, ${pendingDy})`);
        });
      }
    };
    const onUp = () => {
      nodeEl.removeEventListener("pointermove", onMove);
      nodeEl.removeEventListener("pointerup", onUp);
      nodeEl.removeEventListener("pointercancel", onUp);
      try {
        nodeEl.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      nodeEl.classList.remove("dragging");
      if (!dragging) return;
      const finalX = startNodeX + pendingDx;
      const finalY = startNodeY + pendingDy;
      if (!state.nodePositions.database) state.nodePositions.database = {};
      state.nodePositions.database[`tableDep-${table.name}-${nodeId}`] = { x: finalX, y: finalY };
      renderTableDependencyDiagram(table);
    };
    nodeEl.addEventListener("pointermove", onMove);
    nodeEl.addEventListener("pointerup", onUp);
    nodeEl.addEventListener("pointercancel", onUp);
  });
}

function renderErDiagram() {
  const query = state.query ? state.query.trim() : "";
  const tables = state.dbTables.filter(t => {
    if (!state.erCheckedTables.has(t.name)) return false;
    if (!query) return true;
    return matches(t.name, query) || 
           t.columns.some(c => matches(c.name, query));
  });

  if (!tables.length) {
    els.diagramCanvas.innerHTML = `
      <div class="empty-state" style="display:flex; flex-direction:column; gap:12px; padding:32px; text-align:center;">
        <strong>ER Diagram Canvas is empty</strong>
        <span>Check one or more tables matching your search query in the left sidebar explorer to render their relationships.</span>
        <button id="erCheckDefaultBtn" type="button" class="match-filter-chip active" style="min-height:30px; font-size:12px; padding:0 16px;">Check Default tables (appl_*)</button>
      </div>
    `;
    const defaultBtn = document.getElementById("erCheckDefaultBtn");
    if (defaultBtn) {
      defaultBtn.addEventListener("click", () => {
        state.erCheckedTables = new Set(state.dbTables.filter(t => t.name.startsWith("appl_")).map(t => t.name));
        renderResults();
        renderErDiagram();
      });
    }
    return;
  }

  const spacingX = 380;
  const spacingY = 400;
  const cols = Math.ceil(Math.sqrt(tables.length));

  const nodes = tables.map((t, idx) => {
    const colIdx = idx % cols;
    const rowIdx = Math.floor(idx / cols);
    const originalX = 140 + colIdx * spacingX;
    const originalY = 100 + rowIdx * spacingY;

    const override = state.nodePositions?.database?.[t.name];
    const x = override && Number.isFinite(override.x) ? override.x : originalX;
    const y = override && Number.isFinite(override.y) ? override.y : originalY;

    const columnHeight = 20;
    const headerHeight = 32;
    const height = headerHeight + t.columns.length * columnHeight;
    
    let maxColWidth = 180;
    t.columns.forEach(c => {
      const isPk = t.primaryKeys.includes(c.name);
      const isFk = t.foreignKeys.some(fk => fk.columns.includes(c.name));
      const markerLen = (isPk || isFk) ? 14 : 0;
      const nameLen = c.name.length * 6.5;
      const typeLen = (c.type || "").split("(")[0].length * 6.0;
      const needed = markerLen + nameLen + typeLen + 30;
      if (needed > maxColWidth) maxColWidth = needed;
    });
    const w = Math.max(240, t.name.length * 8 + 40, Math.ceil(maxColWidth));

    return {
      table: t,
      id: t.name,
      x,
      y,
      width: w,
      height
    };
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const edges = [];
  for (const n of nodes) {
    for (const fk of n.table.foreignKeys || []) {
      if (nodeMap.has(fk.referencedTable)) {
        const fromColIdx = n.table.columns.findIndex(c => fk.columns.includes(c.name));
        const toNode = nodeMap.get(fk.referencedTable);
        const toColIdx = toNode.table.columns.findIndex(c => fk.referencedColumns.includes(c.name));

        edges.push({
          from: n.id,
          to: fk.referencedTable,
          fromColIdx: fromColIdx !== -1 ? fromColIdx : 0,
          toColIdx: toColIdx !== -1 ? toColIdx : 0
        });
      }
    }
  }

  const edgeHtml = edges.map(edge => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) return "";

    const fromY = fromNode.y - fromNode.height / 2 + 32 + edge.fromColIdx * 20 + 10;
    const toY = toNode.y - toNode.height / 2 + 32 + edge.toColIdx * 20 + 10;

    const fromRight = fromNode.x + fromNode.width / 2;
    const fromLeft = fromNode.x - fromNode.width / 2;
    const toRight = toNode.x + toNode.width / 2;
    const toLeft = toNode.x - toNode.width / 2;

    let sx = fromRight;
    let ex = toLeft;
    if (fromNode.x > toNode.x) {
      sx = fromLeft;
      ex = toRight;
    }

    const path = `M ${sx} ${fromY} C ${(sx + ex)/2} ${fromY}, ${(sx + ex)/2} ${toY}, ${ex} ${toY}`;

    return `
      <g class="zbo-flow-edge" style="opacity: 0.85;">
        <path class="zbo-edge-line" d="${path}" style="stroke: var(--line-strong); fill:none;" marker-end="url(#zboArrow)"></path>
      </g>
    `;
  }).join("");

  const nodeHtml = nodes.map(n => {
    const w = n.width;
    const h = n.height;
    const x = n.x - w / 2;
    const y = n.y - h / 2;

    const headerHtml = `
      <rect x="${x}" y="${y}" width="${w}" height="32" rx="6" fill="#1e293b" style="stroke: #1e293b;"></rect>
      <text x="${n.x}" y="${y + 20}" text-anchor="middle" style="font-size:12px; font-weight:700; fill:#ffffff; cursor:pointer;" data-er-title="${escapeAttr(n.id)}">${escapeHtml(n.id)}</text>
    `;

    const colsHtml = n.table.columns.map((c, idx) => {
      const cy = y + 32 + idx * 20;
      const isPk = n.table.primaryKeys.includes(c.name);
      const isFk = n.table.foreignKeys.some(fk => fk.columns.includes(c.name));
      const marker = isPk ? "🔑" : isFk ? "🔗" : "";
      
      return `
        <rect x="${x}" y="${cy}" width="${w}" height="20" fill="${idx % 2 === 0 ? "var(--surface)" : "var(--surface-2)"}" style="stroke: var(--line);"></rect>
        <text x="${x + 8}" y="${cy + 14}" style="font-size:11px; fill:var(--text);">${escapeHtml(marker)} ${escapeHtml(c.name)}</text>
        <text x="${x + w - 8}" y="${cy + 14}" text-anchor="end" style="font-size:10px; fill:var(--muted); font-family:monospace;">${escapeHtml(c.type.split("(")[0])}</text>
      `;
    }).join("");

    return `
      <g class="node-group" data-node-id="${escapeAttr(n.id)}" style="cursor: grab;">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" style="fill:none; stroke: var(--line-strong); stroke-width:1.5px;"></rect>
        ${colsHtml}
        ${headerHtml}
      </g>
    `;
  }).join("");

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + 200), 1000);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.height / 2 + 100), 600);

  els.diagramCanvas.innerHTML = `
    <svg class="diagram-svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
      <defs>
        <marker id="zboArrow" markerWidth="8" markerHeight="8" refX="7" refY="2.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,5 L7,2.5 z" fill="#8090a0"></path>
        </marker>
      </defs>
      <g>${edgeHtml}</g>
      <g>${nodeHtml}</g>
    </svg>
  `;

  applyDiagramDragState();
  els.diagramCanvas._erDiagramNodes = new Map(nodes.map(n => [n.id, n]));
  els.diagramCanvas.querySelectorAll("[data-node-id]").forEach(nodeEl => {
    if (state.enableNodeDrag) {
      attachErNodeDrag(nodeEl);
    }
  });

  els.diagramCanvas.querySelectorAll("[data-er-title]").forEach(el => {
    el.addEventListener("click", (e) => {
      selectTable(el.dataset.erTitle);
      setDbSubmode("tables");
      e.stopPropagation();
    });
  });
}

function attachErNodeDrag(nodeEl) {
  const nodeId = nodeEl.dataset.nodeId;
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("text")) return;
    const startCursorX = event.clientX;
    const startCursorY = event.clientY;
    const diagramNode = (els.diagramCanvas._erDiagramNodes || new Map()).get(nodeId);
    if (!diagramNode) return;
    const startNodeX = diagramNode.x;
    const startNodeY = diagramNode.y;
    let dragging = false;
    let pendingDx = 0;
    let pendingDy = 0;
    let rafQueued = false;
    try {
      nodeEl.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startCursorX) / state.zoom;
      const dy = (moveEvent.clientY - startCursorY) / state.zoom;
      if (
        !dragging &&
        Math.hypot(moveEvent.clientX - startCursorX, moveEvent.clientY - startCursorY) > 4
      ) {
        dragging = true;
        suppressDiagramClick = true;
        nodeEl.classList.add("dragging");
      }
      if (!dragging) return;
      pendingDx = dx;
      pendingDy = dy;
      if (!rafQueued) {
        rafQueued = true;
        requestAnimationFrame(() => {
          rafQueued = false;
          nodeEl.setAttribute("transform", `translate(${pendingDx}, ${pendingDy})`);
        });
      }
    };
    const onUp = () => {
      nodeEl.removeEventListener("pointermove", onMove);
      nodeEl.removeEventListener("pointerup", onUp);
      nodeEl.removeEventListener("pointercancel", onUp);
      try {
        nodeEl.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      nodeEl.classList.remove("dragging");
      if (!dragging) return;
      const finalX = startNodeX + pendingDx;
      const finalY = startNodeY + pendingDy;
      if (!state.nodePositions.database) state.nodePositions.database = {};
      state.nodePositions.database[nodeId] = { x: finalX, y: finalY };
      renderErDiagram();
    };
    nodeEl.addEventListener("pointermove", onMove);
    nodeEl.addEventListener("pointerup", onUp);
    nodeEl.addEventListener("pointercancel", onUp);
  });
}

function init() {
  hideLoading();
  bindRebuildIndex();
  if (!index) {
    renderIndexMissing();
    return;
  }

  renderIndexStatus();
  prepareSearchIndex();

  restoreState();
  const urlParams = new URLSearchParams(window.location.search);
  const urlWorkflow = urlParams.get("workflow");
  const urlZbo = urlParams.get("zbo");
  if (urlWorkflow) {
    state.query = urlWorkflow;
    state.searchScope = "workflow";
  }
  if (urlZbo) {
    state.query = urlZbo;
    state.searchScope = "zbo";
  }
  applyLayoutState();
  bindEvents();
  applyFormState();
  renderResults();

  if (urlWorkflow) state.activeMode = "zoral";
  if (urlZbo) state.activeMode = "zbo";
  applyModeState();

  if (state.activeMode === "database") {
    const resultsTitleRow = document.querySelector(".results-title-row");
    const dbSubmodeContainer = document.querySelector("#dbSubmodeContainer");
    if (resultsTitleRow) resultsTitleRow.style.display = "none";
    if (dbSubmodeContainer) dbSubmodeContainer.style.display = "flex";
    document.querySelectorAll("[data-db-submode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.dbSubmode === state.dbSubmode);
    });
    renderResults();
    selectDatabaseDefaultItem({ restore: true });
    return;
  }

  if (state.activeMode === "zbo") {
    const preferred =
      state.zboAreas.find((area) => area.name === urlZbo) ||
      state.zboAreas.find((area) => area.name === state.selectedZboArea?.name) ||
      state.zboAreas[0];
    renderResults();
    if (preferred) selectZboArea(preferred.name, { restore: true });
    else renderZboEmpty();
    return;
  }

  const preferred =
    state.workflows.find((workflow) => workflow.name === urlWorkflow) ||
    state.workflows.find((workflow) => workflow.name === state.selectedWorkflow?.name) ||
    state.workflows.find((workflow) => workflow.name === "Adw_UpdateApplication") ||
    state.workflows[0];
  if (preferred) selectWorkflow(preferred.name, { restore: true, preserveSearch: Boolean(urlWorkflow) });
}

init();
initializeNavigationHistory();

