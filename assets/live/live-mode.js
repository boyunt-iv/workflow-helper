(function (root) {
  "use strict";
  const L = () => root.WorkflowLive;
  const P = () => root.LivePresentation;
  const st = { ctx: null, graph: null, view: "gantt", selected: null, env: null, token: null, bridgeWin: null, importedFileName: null, lastAppId: null, showDbInterventions: true, stopRequested: false, loadAllMode: false, autoFetchRelationships: false, allDirectItems: [], directTotal: null, nextDirectPage: 1, effPageSize: 0, lastDirectPageCount: 0, hasMorePages: false, incrementalLoad: false, scrollBottomGap: null, progress: { segments: [], skipped: 0 } };

  // --- Loading progress tracking (per round / per page) ---
  // Each segment = one direct page's load + its expansion. The CURRENT (last)
  // segment's total = its completed queries + the live remaining; previous
  // segments are complete (100%). A new round (Run / Load earlier / Load all)
  // resets; Load all accumulates one segment per page.
  function resetProgress() { st.progress = { segments: [], skipped: 0 }; }
  function pushProgressSegment(label) { st.progress.segments.push({ label: label, done: 0 }); }
  function tickProgress() {
    const segs = st.progress.segments;
    if (segs.length) segs[segs.length - 1].done++;
  }
  let graphRebuildTimer = null;
  let graphRebuildNeeded = false;
  let workflowSuggestTimer = null;
  let workflowSuggestActiveIndex = -1;
  let allCollectedItems = [];
  let lastQueryOpts = {};
  const fetchedParents = new Set();
  const fetchedDetails = new Set();
  const requestQueue = [];
  let queueTimer = null;
  let autoFetchCount = 0;
  let activeAutoFetches = 0;
  let loadingActive = false;
  const jsonPayloads = new Map();
  const jsonSearchStates = new Map();
  // Requested direct-list page size. The *effective* size (st.effPageSize) is
  // captured from page 1 in case the server caps it below this value.
  const DIRECT_PAGE_SIZE = 25;
  // Page size for expand-down (children/sibling) queries. These ARE paginated
  // now (see fetchChildPage + the isChild handler) so parents with many children
  // are fetched completely, not capped at one page.
  const CHILD_PAGE_SIZE = 30;
  // Hard backstop on forward pagination in case an API returns endlessly
  // "full" pages (overlapping/shifting totals) so it can never loop forever.
  const MAX_DIRECT_PAGES = 500;
  // Safety ceiling against pathological expansion loops only; expansion
  // terminates naturally via the fetchedParents/fetchedDetails dedupe sets.
  let MAX_AUTO_FETCHES = 100000;

  function addToQueue(url, reqId) {
    requestQueue.push({ url, reqId });
    processQueue();
  }

  function processQueue() {
    if (queueTimer) return;
    if (requestQueue.length === 0) {
      updateLoadingState();
      return;
    }

    const { url, reqId } = requestQueue.shift();
    st.bridgeWin.postMessage({ type: "BRIDGE_FETCH", reqId, url }, "*");

    // Add 100ms delay between consecutive requests
    queueTimer = setTimeout(() => {
      queueTimer = null;
      processQueue();
    }, 100);

    updateLoadingState();
  }

  // Queue one page of a node's children (expand-down). Page 1 is gated by the
  // caller via fetchedParents; subsequent pages are driven from the isChild
  // handler, which fetches the next page while a page comes back full + new.
  function fetchChildPage(parentId, pageIndex) {
    const env = curEnv();
    if (!env || !st.token || !st.bridgeWin) return;
    if (autoFetchCount >= MAX_AUTO_FETCHES) return;
    autoFetchCount++;
    activeAutoFetches++;
    const url = L().buildProcessUrl(env.msBase, { parentRequestId: parentId, pageIndex: pageIndex, pageSize: CHILD_PAGE_SIZE });
    addToQueue(url, "child_" + parentId + "_" + pageIndex + "_" + Date.now());
  }

  function fetchChildren(items) {
    const env = curEnv();
    if (!env || !st.token || !st.bridgeWin) return;

    // Sort items chronologically (oldest-to-newest start time)
    const sortedItems = [...items].sort((a, b) => (a.start || 0) - (b.start || 0));

    sortedItems.forEach((item) => {
      const id = item.requestId;
      if (!id) return;

      const needsParent = !fetchedParents.has(id);
      const needsDetail = !fetchedDetails.has(id);

      if ((needsParent || needsDetail) && autoFetchCount >= MAX_AUTO_FETCHES) return;

      // 1. Expand-down: query children of this node (paginated, starting page 1)
      if (needsParent) {
        fetchedParents.add(id);
        fetchChildPage(id, 1);
      }

      // 2. Climb-up: query detail of this node to find parent
      if (needsDetail && autoFetchCount < MAX_AUTO_FETCHES) {
        fetchedDetails.add(id);
        autoFetchCount++;
        activeAutoFetches++;
        const url = env.msBase + "/runtime/api/report/process/" + id;
        addToQueue(url, "detail_" + id + "_" + Date.now());
      }
    });

    updateLoadingState();
  }

  function hasPendingRelationshipExpansion() {
    return st.allDirectItems.some((item) => item.requestId
      && (!fetchedParents.has(item.requestId) || !fetchedDetails.has(item.requestId)));
  }

  function startRelationshipExpansion() {
    if (!st.allDirectItems.length || !hasPendingRelationshipExpansion()) return;
    resetProgress();
    pushProgressSegment("Relationships");
    st.stopRequested = false;
    fetchChildren(st.allDirectItems);
    renderPaginationControls();
  }

  function getParentIdFromDetail(json) {
    if (!json) return null;
    const r = json.Request || {};
    return r.ParentRequestId || json.ParentRequestId || null;
  }

  function enableButtons(enabled) {
    const runBtn = document.getElementById("liveRun");
    const importBtn = document.getElementById("liveImport");
    const exportBtn = document.getElementById("liveExport");
    if (runBtn) {
      runBtn.disabled = !enabled;
      runBtn.textContent = enabled ? "Run (bridge)" : "Running... ⟳";
      runBtn.style.opacity = enabled ? "" : "0.7";
    }
    if (importBtn) {
      importBtn.disabled = !enabled;
      importBtn.style.opacity = enabled ? "" : "0.7";
    }
    if (exportBtn) {
      exportBtn.disabled = !enabled;
      exportBtn.style.opacity = enabled ? "" : "0.7";
    }
  }

  function fitDiagram() {
    const canvas = st.ctx.els.diagramCanvas;
    const svg = canvas.querySelector(".diagram-svg");
    if (svg && st.ctx.state) {
      const w = Number(svg.getAttribute("width")) || 1;
      const h = Number(svg.getAttribute("height")) || 1;
      const fitZoom = Math.min(
        (canvas.clientWidth - 20) / w,
        (canvas.clientHeight - 20) / h
      );

      if (typeof window.setZoom === "function") {
        window.setZoom(fitZoom);
      } else {
        st.ctx.state.zoom = Math.max(0.2, Math.min(3, Number(fitZoom.toFixed(3))));
        svg.style.zoom = String(st.ctx.state.zoom);
        const zoomLabel = document.getElementById("zoomLabel");
        if (zoomLabel) zoomLabel.textContent = `${Math.round(st.ctx.state.zoom * 100)}%`;
      }
    }
    canvas.scrollTo({ top: 0, left: 0 });
  }

  function showLoadingOverlay(message, options) {
    options = options || {};
    const el = document.getElementById("loadingOverlay");
    if (el) {
      el.hidden = false;
      const titleEl = document.getElementById("loadingTitle");
      if (titleEl) titleEl.textContent = options.title || "Fetching Live Trace Data";
      const msgEl = document.getElementById("loadingMessage");
      if (msgEl) msgEl.textContent = message;
      const stopBtn = document.getElementById("stopFetchBtn");
      if (stopBtn) stopBtn.style.display = options.stoppable === false ? "none" : "block";
    }
  }

  function hideLoadingOverlay() {
    const el = document.getElementById("loadingOverlay");
    if (el) el.hidden = true;
    const stopBtn = document.getElementById("stopFetchBtn");
    if (stopBtn) stopBtn.style.display = "none";
    const prog = document.getElementById("loadingProgress");
    if (prog) { prog.hidden = true; prog.innerHTML = ""; }
  }

  function progressMessage() {
    const page = Math.max(1, st.nextDirectPage - 1);
    return `Page ${page} · ${st.allDirectItems.length} processes loaded`;
  }

  // Render the per-page progress bars + done/skipped/remaining counters.
  function renderLoadingProgress() {
    const el = document.getElementById("loadingProgress");
    if (!el) return;
    const segs = st.progress.segments;
    if (!segs.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;

    const remaining = activeAutoFetches + requestQueue.length;
    const multi = segs.length > 1; // Load all → label + stack each page
    let totalDone = 0;
    let rows = "";
    segs.forEach((seg, i) => {
      const isLast = i === segs.length - 1;
      const total = isLast ? seg.done + remaining : seg.done;
      const pct = total > 0 ? Math.round((seg.done / total) * 100) : (isLast ? 0 : 100);
      totalDone += seg.done;
      rows += `
        <div class="lp-row">
          ${multi ? `<span class="lp-label">${escapeHtml(seg.label)}</span>` : ""}
          <div class="lp-bar"><div class="lp-bar-fill" style="width:${pct}%;"></div></div>
          <span class="lp-pct">${pct}% · ${seg.done}/${total}</span>
        </div>`;
    });
    rows += `<div class="lp-meta">✓ done ${totalDone} · ⤼ skipped ${st.progress.skipped} (already had) · ${remaining} left</div>`;
    el.innerHTML = rows;
  }

  function updateLoadingState() {
    if (activeAutoFetches > 0) {
      loadingActive = true;
      setBridge(`fetching… (${activeAutoFetches} left) ⟳`, true);
      enableButtons(false);
      showLoadingOverlay(progressMessage());
      renderLoadingProgress();
      renderPaginationControls();
    } else if (requestQueue.length > 0) {
      loadingActive = true;
      setBridge(`processing queue… (${requestQueue.length} left) ⟳`, true);
      enableButtons(false);
      showLoadingOverlay(progressMessage());
      renderLoadingProgress();
      renderPaginationControls();
    } else {
      setBridge("connected", true);
      enableButtons(true);
      hideLoadingOverlay();

      // Flush any pending debounced graph rebuild so the final hierarchy is shown
      if (graphRebuildNeeded) {
        if (graphRebuildTimer) {
          clearTimeout(graphRebuildTimer);
          graphRebuildTimer = null;
        }
        graphRebuildNeeded = false;
        loadGraph(allCollectedItems, true);
      }

      // Load all: auto-advance to the next direct page until pages run out
      if (st.loadAllMode && st.hasMorePages && !st.stopRequested) {
        renderPaginationControls();
        fetchNextDirectPage(false);
        return;
      }
      st.loadAllMode = false;

      if (loadingActive) {
        loadingActive = false;
        const canvas = st.ctx && st.ctx.els && st.ctx.els.diagramCanvas;
        if (st.incrementalLoad && canvas && st.scrollBottomGap != null) {
          // Older rows prepended at the top: keep distance-from-bottom so the
          // user's current view stays put instead of jumping.
          canvas.scrollTop = Math.max(0, canvas.scrollHeight - st.scrollBottomGap);
        } else {
          setTimeout(fitDiagram, 50);
        }
      }
      st.incrementalLoad = false;
      renderPaginationControls();
    }
  }

  function stopFetching() {
    st.stopRequested = true;
    st.loadAllMode = false;
    requestQueue.length = 0;
    activeAutoFetches = 0;
    if (queueTimer) {
      clearTimeout(queueTimer);
      queueTimer = null;
    }
    updateLoadingState();
  }

  // Fetch the next direct-list page forward (page N -> N+1). `incremental`
  // means a user-driven "Load earlier" where the viewport should be preserved.
  function fetchNextDirectPage(incremental) {
    const env = curEnv();
    if (!env || !st.bridgeWin || st.bridgeWin.closed) return;
    if (!st.hasMorePages) { st.loadAllMode = false; renderPaginationControls(); return; }

    st.stopRequested = false;
    enableButtons(false);

    st.incrementalLoad = !!incremental;
    if (incremental) {
      const canvas = st.ctx && st.ctx.els && st.ctx.els.diagramCanvas;
      st.scrollBottomGap = canvas ? (canvas.scrollHeight - canvas.scrollTop) : null;
    }

    const page = st.nextDirectPage;
    st.nextDirectPage += 1;
    pushProgressSegment("Page " + page);

    activeAutoFetches++;
    const url = L().buildProcessUrl(env.msBase, Object.assign({ pageIndex: page, pageSize: DIRECT_PAGE_SIZE }, lastQueryOpts));
    addToQueue(url, "mainpage_" + page + "_" + Date.now());

    updateLoadingState();
  }

  function renderPaginationControls() {
    const host = document.getElementById("livePaginationControls");
    if (!host) return;
    const inLive = document.body.classList.contains("live-active");
    if (!inLive || !st.graph || !st.allDirectItems || st.allDirectItems.length === 0) {
      host.style.display = "none";
      host.innerHTML = "";
      return;
    }
    const page = Math.max(1, st.nextDirectPage - 1);
    const busy = activeAutoFetches > 0 || requestQueue.length > 0;

    if (busy) {
      host.innerHTML = `<span class="live-page-status">⟳ Loading… page ${page} · ${st.allDirectItems.length} loaded</span>`;
      host.style.display = "inline-flex";
      return;
    }

    const canFetchRelationships = !!(st.token && st.bridgeWin && !st.bridgeWin.closed);
    const relationshipButton = canFetchRelationships && !st.autoFetchRelationships && hasPendingRelationshipExpansion()
      ? `<button id="liveLoadRelationshipsBtn" class="live-page-btn live-page-btn-related"
          title="Load parent, child, and sibling processes for the current direct search results">Expand related processes</button>`
      : "";

    if (st.hasMorePages) {
      const loadedLabel = Number.isFinite(st.directTotal)
        ? `Loaded ${st.allDirectItems.length} of ${st.directTotal} · page ${page}`
        : `Loaded ${st.allDirectItems.length} · page ${page}`;
      host.innerHTML = `
        <span class="live-page-status">${loadedLabel}</span>
        ${relationshipButton}
        <button id="liveLoadEarlierBtn" class="live-page-btn" title="Load earlier (older) direct search results">⏶ Load earlier</button>
        <button id="liveLoadAllBtn" class="live-page-btn live-page-btn-all" title="Load all remaining direct search result pages">Load all</button>
      `;
      host.style.display = "inline-flex";
      const earlierBtn = host.querySelector("#liveLoadEarlierBtn");
      if (earlierBtn) earlierBtn.addEventListener("click", () => { resetProgress(); fetchNextDirectPage(true); });
      const allBtn = host.querySelector("#liveLoadAllBtn");
      if (allBtn) allBtn.addEventListener("click", () => {
        if (window.confirm("Load all remaining direct search result pages? This may issue many requests and take a while.")) {
          resetProgress();
          st.loadAllMode = true;
          fetchNextDirectPage(false);
        }
      });
    } else {
      host.innerHTML = `
        <span class="live-page-status live-page-done">All direct results loaded ✓ · ${st.allDirectItems.length} processes</span>
        ${relationshipButton}
      `;
      host.style.display = "inline-flex";
    }
    const relationshipBtn = host.querySelector("#liveLoadRelationshipsBtn");
    if (relationshipBtn) relationshipBtn.addEventListener("click", startRelationshipExpansion);
  }

  function envList() { return (root.ANALYZER_ENV && root.ANALYZER_ENV.environments) || []; }
  function curEnv() { return envList().find((e) => e.key === st.env) || envList()[0] || null; }
  function tagDefinitions() { return root.ANALYZER_ENV?.liveApi?.tags || []; }

  const toolbarIcons = {
    environment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 17v3h14v-3"/></svg>',
    import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
    export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14"/></svg>',
    gantt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M4 12h16M4 18h11"/></svg>',
    tree: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v4m0 0H6v4m6-4h6v4M6 13v4m12-4v4"/><circle cx="12" cy="4" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></svg>',
  };

  function updateViewButton() {
    const button = document.getElementById("liveView");
    if (!button) return;
    const isGantt = st.view === "gantt";
    button.innerHTML = isGantt ? toolbarIcons.gantt : toolbarIcons.tree;
    button.title = isGantt
      ? "Current view: Gantt. Switch to Tree"
      : "Current view: Tree. Switch to Gantt";
    button.setAttribute("aria-label", button.title);
  }

  function serviceOrigins() {
    return envList().map((environment) => new URL(environment.msBase).origin);
  }

  function configureBridge(target = st.bridgeWin) {
    if (!target || target.closed) return;
    target.postMessage(
      { type: "BRIDGE_CONFIG", allowedOrigins: serviceOrigins() },
      "*",
    );
  }

  function renderTagControls() {
    const select = document.getElementById("liveTagName");
    const input = document.getElementById("liveTagValue");
    if (!select || !input) return;
    const previous = select.value;
    const tags = tagDefinitions();
    select.replaceChildren();
    for (const tag of tags) {
      const option = document.createElement("option");
      option.value = tag.name;
      option.textContent = tag.label || tag.name;
      select.appendChild(option);
    }
    const configuredDefault = root.ANALYZER_ENV?.liveApi?.defaultTag;
    select.value = tags.some((tag) => tag.name === previous)
      ? previous
      : (tags.some((tag) => tag.name === configuredDefault) ? configuredDefault : tags[0]?.name || "");
    select.disabled = tags.length === 0;
    updateTagValuePlaceholder();
  }

  function updateTagValuePlaceholder() {
    const select = document.getElementById("liveTagName");
    const input = document.getElementById("liveTagValue");
    if (!select || !input) return;
    const tag = tagDefinitions().find((item) => item.name === select.value);
    input.placeholder = tag?.placeholder || (tag ? `Enter ${tag.label || tag.name}` : "Tag value");
    updateWorkflowTagWarning();
  }

  function collectTagFilter() {
    return {
      key: document.getElementById("liveTagName")?.value || "",
      value: document.getElementById("liveTagValue")?.value.trim() || "",
    };
  }

  function workflowDefinitions() {
    return (st.ctx && st.ctx.state && st.ctx.state.workflows) || [];
  }

  function findExactWorkflow(name) {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return null;
    return workflowDefinitions().find(
      (workflow) => String(workflow && workflow.name || "").toLowerCase() === wanted,
    ) || null;
  }

  function hideWorkflowSuggestions() {
    const list = document.getElementById("liveWorkflowSuggestions");
    const input = document.getElementById("liveWorkflowName");
    if (list) {
      list.hidden = true;
      list.replaceChildren();
    }
    if (input) input.setAttribute("aria-expanded", "false");
    if (input) input.removeAttribute("aria-activedescendant");
    workflowSuggestActiveIndex = -1;
  }

  function setWorkflowSuggestionActive(index) {
    const list = document.getElementById("liveWorkflowSuggestions");
    const input = document.getElementById("liveWorkflowName");
    const options = list ? [...list.querySelectorAll("[role=option]")] : [];
    if (!options.length) return;
    workflowSuggestActiveIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === workflowSuggestActiveIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    });
    const activeOption = options[workflowSuggestActiveIndex];
    if (input && activeOption) input.setAttribute("aria-activedescendant", activeOption.id);
    activeOption?.scrollIntoView({ block: "nearest" });
  }

  function updateWorkflowTagWarning() {
    const warning = document.getElementById("liveWorkflowTagWarning");
    const workflowName = document.getElementById("liveWorkflowName")?.value || "";
    const tagName = document.getElementById("liveTagName")?.value || "";
    if (!warning) return;

    const workflow = findExactWorkflow(workflowName);
    if (!workflow || !tagName) {
      warning.hidden = true;
      warning.textContent = "";
      return;
    }
    const compatibility = L().getWorkflowTagCompatibility(workflow, tagName);
    if (!compatibility.known || compatibility.supported) {
      warning.hidden = true;
      warning.textContent = "";
      return;
    }

    const detected = compatibility.tags.length
      ? ` Detected: ${compatibility.tags.join(", ")}.`
      : " No process tags were detected.";
    warning.textContent = `Warning: ${workflow.name} does not set process tag "${tagName}".${detected}`;
    warning.hidden = false;
  }

  function chooseWorkflowSuggestion(name) {
    const input = document.getElementById("liveWorkflowName");
    if (!input) return;
    input.value = name;
    hideWorkflowSuggestions();
    updateWorkflowTagWarning();
  }

  function renderWorkflowSuggestions() {
    const input = document.getElementById("liveWorkflowName");
    const list = document.getElementById("liveWorkflowSuggestions");
    if (!input || !list) return;
    const query = input.value.trim();
    if (query.length < 3 || findExactWorkflow(query)) {
      hideWorkflowSuggestions();
      updateWorkflowTagWarning();
      return;
    }

    const suggestions = L().findWorkflowSuggestions(workflowDefinitions(), query, 12);
    list.replaceChildren();
    for (const [index, name] of suggestions.entries()) {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `liveWorkflowSuggestion-${index}`;
      option.className = "live-workflow-suggestion";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = name;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        chooseWorkflowSuggestion(name);
      });
      list.appendChild(option);
    }

    list.hidden = suggestions.length === 0;
    input.setAttribute("aria-expanded", suggestions.length ? "true" : "false");
    workflowSuggestActiveIndex = -1;
    updateWorkflowTagWarning();
  }

  function scheduleWorkflowSuggestions() {
    clearTimeout(workflowSuggestTimer);
    workflowSuggestTimer = setTimeout(renderWorkflowSuggestions, 180);
    updateWorkflowTagWarning();
  }

  function handleWorkflowSuggestionKeydown(event) {
    const list = document.getElementById("liveWorkflowSuggestions");
    const options = list && !list.hidden ? [...list.querySelectorAll("[role=option]")] : [];
    if (event.key === "Escape") {
      hideWorkflowSuggestions();
      return;
    }
    if (!options.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowDown") {
      setWorkflowSuggestionActive(workflowSuggestActiveIndex + 1);
    } else if (event.key === "ArrowUp") {
      setWorkflowSuggestionActive(workflowSuggestActiveIndex - 1);
    } else if (workflowSuggestActiveIndex >= 0) {
      chooseWorkflowSuggestion(options[workflowSuggestActiveIndex].textContent);
    }
  }

  function refreshEnvironmentControls() {
    const select = document.getElementById("liveEnv");
    const runButton = document.getElementById("liveRun");
    const status = document.getElementById("liveEnvStatus");
    if (!select) return;

    const environments = envList();
    const preferred =
      environments.find((environment) => environment.key === st.env)?.key ||
      root.ANALYZER_ENV?.defaultEnv ||
      environments[0]?.key ||
      "";
    select.replaceChildren();
    if (environments.length) {
      for (const environment of environments) {
        const option = document.createElement("option");
        option.value = environment.key;
        option.textContent = environment.label;
        select.appendChild(option);
      }
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Upload ENV first";
      select.appendChild(option);
    }
    select.value = preferred;
    select.disabled = environments.length === 0;
    st.env = preferred;
    renderTagControls();
    if (runButton) runButton.disabled = environments.length === 0;
    if (status) {
      if (environments.length) {
        status.textContent = "";
        status.hidden = true;
      } else {
        status.textContent = "Upload an environment JSON file before using the bridge.";
        status.className = "live-bridge-status bad";
        status.hidden = false;
      }
    }
  }

  async function loadEnvironmentFile(file) {
    try {
      await root.LiveEnvironment.loadFile(file);
      st.token = null;
      if (st.bridgeWin && !st.bridgeWin.closed) st.bridgeWin.close();
      st.bridgeWin = null;
      setBridge("off", false);
      refreshEnvironmentControls();
    } catch (error) {
      const status = document.getElementById("liveEnvStatus");
      if (status) {
        status.textContent = error.message;
        status.className = "live-bridge-status bad";
        status.hidden = false;
      }
    }
  }

  function parseDateTime(str) {
    if (!str) return null;
    const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const minute = parseInt(m[5], 10);
    const second = m[6] ? parseInt(m[6], 10) : 0;

    if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      return null;
    }
    const d = new Date(year, month, day, hour, minute, second);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatLocalDatetime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function isDetailLoaded(n) {
    return !!(n && n.detailLoaded);
  }

  function getSteps(n) {
    if (!n || !n.raw) return [];
    const rawObj = n.raw;
    const r = rawObj.Request || {};
    return rawObj.ProcessItems || r.ProcessItems || rawObj.Steps || r.Steps || rawObj.ActivitySteps || [];
  }

  function isoDays(deltaDays, endOfDay) {
    const d = new Date(Date.now() + deltaDays * 864e5);
    if (endOfDay) d.setUTCHours(16, 59, 59, 0); else d.setUTCHours(17, 0, 0, 0);
    return d.toISOString().replace(/\.\d+Z$/, ".000Z");
  }

  function ensureToolbar() {
    let bar = document.getElementById("liveToolbar");
    if (bar) {
      refreshEnvironmentControls();
      return bar;
    }
    bar = document.createElement("div");
    bar.id = "liveToolbar";
    bar.className = "live-toolbar";
    bar.innerHTML = `
      <input id="liveEnvFile" type="file" accept=".json,application/json" hidden />
      <div class="live-toolbar-row live-toolbar-query-row">
        <button class="live-run live-icon-button" id="liveEnvUpload" type="button"
          title="Load environment JSON" aria-label="Load environment JSON">${toolbarIcons.environment}</button>
        <div class="live-toolbar-field live-env-field"><label>ENV</label><select id="liveEnv"></select></div>
        <span id="liveEnvStatus" class="live-bridge-status bad" hidden></span>
        <div class="live-toolbar-field live-tag-name-field">
          <label>Tag Name</label>
          <select id="liveTagName"></select>
        </div>
        <div class="live-toolbar-field live-tag-value-field">
          <label>Tag Value</label>
          <input id="liveTagValue" type="text" placeholder="Tag value" />
        </div>
        <div class="live-toolbar-field live-request-id-field">
          <label>workflowRequestId</label>
          <input id="liveWorkflowRequestId" type="text" placeholder="Optional request UUID" />
        </div>
        <div class="live-toolbar-field live-workflow-name-field">
          <label>workflowName</label>
          <div class="live-workflow-autocomplete">
            <input id="liveWorkflowName" type="text" placeholder="Type at least 3 characters"
              autocomplete="off" role="combobox" aria-autocomplete="list"
              aria-controls="liveWorkflowSuggestions" aria-expanded="false" />
            <div id="liveWorkflowSuggestions" class="live-workflow-suggestions"
              role="listbox" hidden></div>
            <div id="liveWorkflowTagWarning" class="live-workflow-tag-warning"
              role="status" hidden></div>
          </div>
        </div>
        <div class="live-toolbar-field live-status-field">
          <label>Status</label>
          <select id="liveStatus">
            <option value="">All</option>
            <option value="InProgress">InProgress</option>
            <option value="Failed">Failed</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
      </div>
      <div class="live-toolbar-row live-toolbar-filter-row">
        <div class="live-toolbar-field live-date-field"><label>From</label><input type="text" id="liveFrom" placeholder="DD/MM/YYYY HH:mm"/></div>
        <div class="live-toolbar-field live-date-field"><label>To</label><input type="text" id="liveTo" placeholder="DD/MM/YYYY HH:mm"/></div>
        <label class="live-auto-fetch-option"
          title="Automatically load parent, child, and sibling processes after each search page.">
          <input id="liveAutoRelationships" type="checkbox" />
          <span>Auto-expand related processes</span>
        </label>
        <div class="live-toolbar-actions">
          <button class="live-run" id="liveRun" type="button">Run (bridge)</button>
          <button class="live-run live-icon-button" id="liveImport" type="button"
            title="Import trace JSON" aria-label="Import trace JSON">${toolbarIcons.import}</button>
          <button class="live-run live-icon-button" id="liveExport" type="button"
            title="Export trace JSON" aria-label="Export trace JSON">${toolbarIcons.export}</button>
          <button class="live-run live-icon-button" id="liveView" type="button"></button>
          <a href="bookmarklet/install.html" target="_blank" class="live-run live-bridge-link">Install Bridge</a>
          <span id="liveBridge" class="live-bridge-status bad">bridge: off</span>
        </div>
      </div>`;
    document.querySelector(".toolbar").after(bar);

    let banner = document.getElementById("liveWarningBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "liveWarningBanner";
      banner.className = "live-warning-banner";
      banner.style.display = "none";
      bar.after(banner);
    }

    refreshEnvironmentControls();
    updateViewButton();

    const fromDate = new Date(Date.now() - 10 * 864e5);
    fromDate.setHours(0, 0, 0, 0);
    bar.querySelector("#liveFrom").value = formatLocalDatetime(fromDate);

    const toDate = new Date();
    toDate.setHours(23, 59, 0, 0);
    bar.querySelector("#liveTo").value = formatLocalDatetime(toDate);

    bar.querySelector("#liveEnv").addEventListener("change", (e) => {
      st.env = e.target.value;
      st.token = null;
      if (st.bridgeWin && !st.bridgeWin.closed) {
        st.bridgeWin.close();
      }
      st.bridgeWin = null;
      setBridge("off", false);
    });
    bar.querySelector("#liveEnvUpload").addEventListener("click", () => {
      bar.querySelector("#liveEnvFile").click();
    });
    bar.querySelector("#liveEnvFile").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) loadEnvironmentFile(file);
      event.target.value = "";
    });
    bar.querySelector("#liveTagName").addEventListener("change", updateTagValuePlaceholder);
    const workflowNameInput = bar.querySelector("#liveWorkflowName");
    workflowNameInput.addEventListener("input", scheduleWorkflowSuggestions);
    workflowNameInput.addEventListener("focus", scheduleWorkflowSuggestions);
    workflowNameInput.addEventListener("keydown", handleWorkflowSuggestionKeydown);
    workflowNameInput.addEventListener("blur", () => {
      setTimeout(hideWorkflowSuggestions, 120);
      updateWorkflowTagWarning();
    });
    bar.querySelector("#liveRun").addEventListener("click", runBridge);
    bar.querySelector("#liveImport").addEventListener("click", importPrompt);
    bar.querySelector("#liveExport").addEventListener("click", () => {
      if (typeof window.exportTraceJson === "function") {
        window.exportTraceJson();
      }
    });
    bar.querySelector("#liveView").addEventListener("click", toggleView);

    const stopBtn = document.getElementById("stopFetchBtn");
    if (stopBtn && !stopBtn.dataset.bound) {
      stopBtn.dataset.bound = "true";
      stopBtn.addEventListener("click", () => {
        stopFetching();
      });
    }
    return bar;
  }

  function setBridge(label, ok) {
    const el = document.getElementById("liveBridge");
    if (el) { el.textContent = "bridge: " + label; el.className = "live-bridge-status " + (ok ? "ok" : "bad"); }
  }

  function loadGraph(records, preserveSelected) {
    const prevSelected = st.selected;
    st.graph = L().buildProcessGraph(records);
    if (preserveSelected) {
      st.selected = prevSelected;
    } else {
      st.selected = null;
    }
    renderResults();
    renderView();
    renderDetail();
  }

  // Debounced version of loadGraph for auto-fetch responses (child/detail)
  // Prevents excessive DOM rebuilds when many responses arrive in quick succession
  function scheduleGraphRebuild() {
    graphRebuildNeeded = true;
    if (graphRebuildTimer) return;
    graphRebuildTimer = setTimeout(() => {
      graphRebuildTimer = null;
      if (graphRebuildNeeded) {
        graphRebuildNeeded = false;
        loadGraph(allCollectedItems, true);
      }
    }, 300);
  }

  // Enrich an existing item with detail API data.
  // Design: detail data FILLS GAPS only — it never overwrites fields that
  // the list API already set correctly. This keeps sort order stable by
  // construction, not as a patch after the fact.
  function enrichWithDetail(existingItem, detailObj) {
    const normalized = L().normalizeProcess(detailObj);
    if (!normalized) return existingItem;

    // Start from existing item — all sort-critical fields stay as-is
    const enriched = Object.assign({}, existingItem);

    // Merge raw objects so steps and full detail are available
    enriched.raw = Object.assign({}, existingItem.raw, detailObj);
    enriched.detailLoaded = true;

    // Fill in only fields that are null/missing in the existing item
    if (enriched.start == null && normalized.start != null) enriched.start = normalized.start;
    if (enriched.end == null && normalized.end != null) enriched.end = normalized.end;
    if (enriched.durationMs == null && normalized.durationMs != null) enriched.durationMs = normalized.durationMs;
    if (enriched.parentRequestId == null && normalized.parentRequestId != null) enriched.parentRequestId = normalized.parentRequestId;
    if (enriched.version == null && normalized.version != null) enriched.version = normalized.version;
    if (!enriched.error && normalized.error) enriched.error = normalized.error;
    if (enriched.status === "unknown" && normalized.status !== "unknown") enriched.status = normalized.status;

    return enriched;
  }

  function importPrompt() {
    let fileInput = document.getElementById("liveImportFile");
    if (!fileInput) {
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.id = "liveImportFile";
      fileInput.accept = ".json";
      fileInput.style.display = "none";
      document.body.appendChild(fileInput);
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        st.importedFileName = file.name;
        st.lastAppId = null;
        if (typeof window.updatePageTitle === "function") {
          window.updatePageTitle();
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const json = JSON.parse(evt.target.result);
            // Imported data is a static snapshot — no forward pagination.
            st.allDirectItems = [];
            st.directTotal = null;
            st.hasMorePages = false;
            st.loadAllMode = false;
            loadGraph(L().normalizeResponse(json).items);
            renderPaginationControls();
          } catch (err) {
            window.alert("Invalid JSON file: " + err.message);
          }
        };
        reader.readAsText(file);
        fileInput.value = "";
      });
    }
    fileInput.click();
  }

  function renderResults() {
    const host = st.ctx.els.resultsList;
    st.ctx.els.resultsTitle.textContent = "Processes";
    if (!st.graph || !st.graph.nodes.length) { host.innerHTML = '<div class="empty-state">No processes. Run or import.</div>'; st.ctx.els.resultCount.textContent = "0"; return; }
    st.ctx.els.resultCount.textContent = String(st.graph.count);

    let html = "";
    const visited = new Set();

    function renderNode(nodeId, depth) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const n = st.graph.byId.get(nodeId);
      if (!n) return;

      const padLeft = depth * 12;
      const borderStyle = depth > 0 ? `border-left: 2px solid #2f3b54; margin-left: ${padLeft - 6}px; padding-left: 6px;` : "";
      const styleAttr = borderStyle ? `style="${borderStyle}"` : "";

      html += `
        <div class="result-card live-result${st.selected === n.requestId ? " active" : ""}" data-rid="${n.requestId}" ${styleAttr}>
          <div class="live-result-time" style="font-size:11px; color:#475569; font-weight:bold; margin-bottom:2px;">${formatDateTime(n.start)}</div>
          <strong>${escapeHtml(n.workflowName)}</strong>
          <div class="dim" style="font-size:12px">${n.status} · ${n.durationMs != null ? n.durationMs + "ms" : "?"} · ${n.version || ""}</div>
          <div class="dim" style="font-size:11px">${n.requestId}</div>
        </div>`;

      if (n.children && n.children.length > 0) {
        const sortedChildren = n.children
          .map(cid => st.graph.byId.get(cid))
          .filter(Boolean)
          .sort((a, b) => (a.start || 0) - (b.start || 0));
        for (const child of sortedChildren) {
          renderNode(child.requestId, depth + 1);
        }
      }
    }

    const rootNodes = st.graph.roots
      .map(rid => st.graph.byId.get(rid))
      .filter(Boolean)
      .sort((a, b) => (a.start || 0) - (b.start || 0));

    for (const rn of rootNodes) {
      renderNode(rn.requestId, 0);
    }

    for (const n of st.graph.nodes) {
      if (!visited.has(n.requestId)) {
        renderNode(n.requestId, 0);
      }
    }

    // Direct-list pagination is handled by the header controls
    // (#livePaginationControls); see renderPaginationControls().

    host.innerHTML = html;
    host.querySelectorAll(".live-result").forEach((c) =>
      c.addEventListener("click", () => select(c.dataset.rid)));

    if (st.selected) {
      setTimeout(() => {
        const activeCard = host.querySelector(`.live-result[data-rid="${st.selected}"]`);
        if (activeCard) {
          activeCard.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        }
      }, 0);
    }
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function getDisplayGraph() {
    return st.graph;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderView() {
    const host = st.ctx.els.diagramCanvas;
    st.ctx.els.workflowTitle.textContent = st.view === "gantt" ? "Process Timeline" : "Process Tree";
    const displayGraph = getDisplayGraph();
    st.ctx.els.workflowSubtitle.textContent = displayGraph ? `${displayGraph.count} processes · ${displayGraph.roots.length} root(s)` : "";
    if (!displayGraph || !displayGraph.nodes.length) { host.innerHTML = '<div class="empty-state">No data</div>'; return; }
    if (st.view === "gantt") L().renderGantt(displayGraph, host); else L().renderTree(displayGraph, host);

    // Apply active zoom to the newly rendered SVG
    const svg = host.querySelector(".diagram-svg");
    if (svg && st.ctx && st.ctx.state) {
      svg.style.zoom = String(st.ctx.state.zoom || 1);
    }
  }

  function toggleView() {
    st.view = st.view === "gantt" ? "tree" : "gantt";
    updateViewButton();
    renderView();
  }

  function select(rid) {
    if (st.selected === rid) {
      st.selected = null;
    } else {
      st.selected = rid;
    }
    L().selectedId = st.selected;
    document.querySelectorAll(".live-result").forEach((c) => c.classList.toggle("active", c.dataset.rid === st.selected));
    if (st.selected && st.ctx && st.ctx.state) {
      st.ctx.state.panes.detail = true;
      if (typeof window.applyLayoutState === "function") {
        window.applyLayoutState();
      }

      // Check if we need to fetch details for this selected node
      const n = st.graph && st.graph.byId.get(st.selected);
      const env = curEnv();
      if (n && env && st.token && st.bridgeWin) {
        const rawObj = n.raw || {};
        if (!n.detailLoaded && st.loadingDetailId !== st.selected) {
          st.loadingDetailId = st.selected;
          st.detailError = null;
          const url = env.msBase + "/runtime/api/report/process/" + st.selected;
          st.bridgeWin.postMessage({ type: "BRIDGE_FETCH", reqId: "user_detail_" + st.selected + "_" + Date.now(), url }, "*");
        }
      }
    }
    renderView();
    renderDetail();
  }

  function extractPayload(obj, keys) {
    if (!obj) return null;
    for (const key of keys) {
      let val = obj[key];
      if (val === undefined && obj.Request) {
        val = obj.Request[key];
      }
      if (val !== undefined && val !== null) {
        if (typeof val === "string") {
          try {
            return JSON.parse(val);
          } catch (_) {
            return val;
          }
        }
        return val;
      }
    }
    return null;
  }

  function renderJsonTree(value, key = null) {
    let typeClass = typeof value;

    // Auto-parse JSON strings
    let parsedValue = value;
    let isJsonString = false;
    if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
      try {
        parsedValue = JSON.parse(value);
        isJsonString = true;
      } catch (e) {
        // Not valid JSON, keep as is
      }
    }

    const isCollapsible = parsedValue !== null && typeof parsedValue === 'object';
    if (isCollapsible) {
      typeClass = Array.isArray(parsedValue) ? 'array' : 'object';
    } else if (value === null) {
      typeClass = 'null';
    }

    const keyHtml = key !== null ? `<span class="json-tree-key">${escapeHtml(key)}</span><span class="json-tree-colon"> : </span>` : '';

    if (isCollapsible) {
      const isEmpty = Array.isArray(parsedValue) ? parsedValue.length === 0 : Object.keys(parsedValue).length === 0;
      const bracketOpen = Array.isArray(parsedValue) ? '[' : '{';
      const bracketClose = Array.isArray(parsedValue) ? ']' : '}';
      const displayType = Array.isArray(parsedValue) ? `Array(${parsedValue.length})` : 'object';
      const jsonStrIndicator = isJsonString ? `<span class="json-tree-parsed-badge" title="Automatically parsed JSON string">JSON</span> ` : '';

      if (isEmpty) {
        return `
          <div class="json-tree-node json-tree-leaf">
            ${keyHtml}${jsonStrIndicator}<span class="json-tree-bracket-empty">${bracketOpen}${bracketClose}</span>
            <span class="json-tree-empty-text">(empty ${displayType})</span>
          </div>
        `;
      }

      let childrenHtml = '';
      if (Array.isArray(parsedValue)) {
        parsedValue.forEach((item, index) => {
          childrenHtml += renderJsonTree(item, index);
        });
      } else {
        Object.entries(parsedValue).forEach(([k, v]) => {
          childrenHtml += renderJsonTree(v, k);
        });
      }

      return `
        <div class="json-tree-node json-tree-branch">
          <div class="json-tree-branch-header">
            <span class="json-tree-toggle">▼</span>
            ${keyHtml}${jsonStrIndicator}<span class="json-tree-bracket">${bracketOpen}</span>
            <span class="json-tree-ellipsis">...</span>
            <span class="json-tree-bracket-close-collapsed">${bracketClose}</span>
          </div>
          <div class="json-tree-branch-children">
            ${childrenHtml}
          </div>
          <div class="json-tree-branch-footer">
            <span class="json-tree-bracket">${bracketClose}</span>
          </div>
        </div>
      `;
    } else {
      let displayValue = String(value);
      if (value === null) displayValue = 'null';
      else if (typeof value === 'string') displayValue = `"${value}"`;

      // Flag failure-ish values on `status`/`severity` fields (any nesting level)
      // with a dark-pink highlight — distinct from the red used when the whole
      // process status != Completed. Case-insensitive, value at any depth.
      const isFlagKey = key != null && /^(status|severity)$/i.test(String(key));
      const isFailVal = /(fail|error|false|(not|in)\s*complete)/i.test(String(value));
      const flagClass = isFlagKey && isFailVal ? ' json-tree-flag-alert' : '';

      return `
        <div class="json-tree-node json-tree-leaf${flagClass}">
          ${keyHtml}<span class="json-tree-value json-tree-type-${typeClass}">${escapeHtml(displayValue)}</span>
        </div>
      `;
    }
  }

  function renderPayloadTable(payload, containerId) {
    if (payload === null || payload === undefined) {
      return `<span class="dim" style="font-size:11px;">(Empty payload)</span>`;
    }

    const copyValue = P()?.parseMaybeJson(payload) ?? payload;
    const copyText = typeof copyValue === "string"
      ? copyValue
      : JSON.stringify(copyValue, null, 2);
    jsonPayloads.set(containerId, copyText);
    jsonSearchStates.delete(containerId);

    const copyButton = `
      <button type="button" class="json-copy-btn"
        onclick="window.copyJsonPayload('${escapeHtml(containerId)}', this)"
        aria-label="Copy JSON to clipboard" title="Copy JSON to clipboard">COPY</button>
    `;

    const searchControls = `
      <div class="json-search-controls">
        <input type="search" class="json-search-input" placeholder="Filter JSON..."
          aria-label="Filter JSON"
          oninput="window.searchJsonPayload('${escapeHtml(containerId)}', this.value)"
          onkeydown="window.handleJsonSearchKeydown(event, '${escapeHtml(containerId)}')" />
        <button type="button" class="json-search-nav" data-json-search-nav="prev"
          onclick="window.navigateJsonMatch('${escapeHtml(containerId)}', -1)"
          aria-label="Previous JSON match" title="Previous match" disabled>PREV</button>
        <span class="json-search-count" data-json-search-count>0 found</span>
        <button type="button" class="json-search-nav" data-json-search-nav="next"
          onclick="window.navigateJsonMatch('${escapeHtml(containerId)}', 1)"
          aria-label="Next JSON match" title="Next match" disabled>NEXT</button>
      </div>
    `;

    const contentHtml = typeof copyValue === "object" && copyValue !== null
      ? `<div id="${containerId}" class="json-tree-container">${renderJsonTree(copyValue)}</div>`
      : `<pre id="${containerId}" class="json-code">${escapeHtml(String(copyValue))}</pre>`;

    return `
      <div class="json-block" data-json-block="${containerId}">
        <div class="json-block-toolbar">${searchControls}${copyButton}</div>
        ${contentHtml}
      </div>
    `;
  }

  function jsonSearchTargets(container) {
    const targets = [...container.querySelectorAll(".json-tree-key, .json-tree-value, .json-code")];
    if (container.matches(".json-code")) targets.unshift(container);
    return targets;
  }

  function restoreJsonSearchTargets(container) {
    jsonSearchTargets(container).forEach((target) => {
      const originalText = target.dataset.jsonSearchText;
      if (originalText !== undefined) target.textContent = originalText;
    });
    container.querySelectorAll(".json-tree-node").forEach((node) => {
      node.classList.remove("search-dimmed");
    });
  }

  function expandJsonMatchParents(match) {
    let branch = match.closest(".json-tree-branch");
    while (branch) {
      branch.classList.remove("collapsed");
      const toggle = branch.querySelector(":scope > .json-tree-branch-header > .json-tree-toggle");
      if (toggle) toggle.textContent = "โ–ผ";
      branch = branch.parentElement.closest(".json-tree-branch");
    }
  }

  function updateJsonSearchUi(containerId) {
    const state = jsonSearchStates.get(containerId) || { matches: [], current: -1 };
    const container = document.getElementById(containerId);
    const block = container?.closest(".json-block");
    if (!block) return;

    const total = state.matches.length;
    const count = block.querySelector("[data-json-search-count]");
    if (count) {
      count.textContent = total > 0 ? `${state.current + 1} / ${total} found` : "0 found";
    }
    block.querySelectorAll("[data-json-search-nav]").forEach((button) => {
      button.disabled = total === 0;
    });
  }

  function focusJsonMatch(containerId, index) {
    const state = jsonSearchStates.get(containerId);
    if (!state || state.matches.length === 0) {
      updateJsonSearchUi(containerId);
      return;
    }

    state.matches.forEach((match) => match.classList.remove("is-current"));
    state.current = (index + state.matches.length) % state.matches.length;
    const current = state.matches[state.current];
    current.classList.add("is-current");
    expandJsonMatchParents(current);
    current.scrollIntoView({ block: "center", inline: "nearest" });
    updateJsonSearchUi(containerId);
  }

  window.searchJsonPayload = function (containerId, query) {
    const container = document.getElementById(containerId);
    if (!container) return;
    restoreJsonSearchTargets(container);

    const normalizedQuery = String(query || "").trim().toLowerCase();
    const matches = [];
    if (normalizedQuery) {
      jsonSearchTargets(container).forEach((target) => {
        const text = target.textContent;
        target.dataset.jsonSearchText = text;
        const lowerText = text.toLowerCase();
        let cursor = 0;
        let matchIndex = lowerText.indexOf(normalizedQuery, cursor);
        if (matchIndex === -1) return;

        const fragment = document.createDocumentFragment();
        while (matchIndex !== -1) {
          fragment.append(document.createTextNode(text.slice(cursor, matchIndex)));
          const highlight = document.createElement("span");
          highlight.className = "json-tree-highlight";
          highlight.textContent = text.slice(matchIndex, matchIndex + normalizedQuery.length);
          fragment.append(highlight);
          matches.push(highlight);
          cursor = matchIndex + normalizedQuery.length;
          matchIndex = lowerText.indexOf(normalizedQuery, cursor);
        }
        fragment.append(document.createTextNode(text.slice(cursor)));
        target.replaceChildren(fragment);
      });
    }

    if (matches.length > 0) {
      container.querySelectorAll(".json-tree-node").forEach((node) => {
        if (!node.querySelector(".json-tree-highlight")) {
          node.classList.add("search-dimmed");
        }
      });
    }

    jsonSearchStates.set(containerId, {
      current: matches.length > 0 ? 0 : -1,
      matches,
      query: normalizedQuery,
    });
    if (matches.length > 0) {
      focusJsonMatch(containerId, 0);
    } else {
      updateJsonSearchUi(containerId);
    }
  };

  window.navigateJsonMatch = function (containerId, delta) {
    const state = jsonSearchStates.get(containerId);
    if (!state || state.matches.length === 0) return;
    focusJsonMatch(containerId, state.current + delta);
  };

  window.handleJsonSearchKeydown = function (event, containerId) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.navigateJsonMatch(containerId, event.shiftKey ? -1 : 1);
  };

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

  window.copyJsonPayload = async function (containerId, button) {
    const text = jsonPayloads.get(containerId);
    if (text === undefined) return;

    const originalText = button ? button.textContent : "";
    if (button) button.disabled = true;
    try {
      await writeClipboardText(text);
      if (button) button.textContent = "COPIED";
    } catch (error) {
      console.error("Unable to copy JSON", error);
      if (button) button.textContent = "FAILED";
    } finally {
      if (button) {
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1200);
      }
    }
  };

  window.expandAllJson = function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.json-tree-branch').forEach(branch => {
      branch.classList.remove('collapsed');
      const toggle = branch.querySelector(':scope > .json-tree-branch-header > .json-tree-toggle');
      if (toggle) toggle.textContent = '▼';
    });
  };

  window.collapseAllJson = function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.json-tree-branch').forEach(branch => {
      branch.classList.add('collapsed');
      const toggle = branch.querySelector(':scope > .json-tree-branch-header > .json-tree-toggle');
      if (toggle) toggle.textContent = '▶';
    });
  };

  window.jumpToDbTable = function (tableName) {
    if (typeof window.setMode === "function" && typeof window.selectTable === "function") {
      window.setMode("database");
      window.selectTable(tableName);
    }
  };

  function renderDetail() {
    try {
      const host = st.ctx.els.detailContent;
      if (!st.selected || !st.graph || !st.graph.byId.has(st.selected)) { host.innerHTML = '<div class="empty-state">Select a process</div>'; return; }
      const n = st.graph.byId.get(st.selected);
      if (!n) { host.innerHTML = '<div class="empty-state">Select a process</div>'; return; }
      const env = curEnv();
      const portal = env ? `${env.consoleBase}/#/report/process/${n.requestId}?workspace=default` : "#";
      const activeTab = (st.ctx && st.ctx.state && st.ctx.state.activeTab) || "overview";

      // Parse tags dynamically
      let tagsHtml = "";
      const rawObj = n.raw || {};
      const processContext = P()?.getProcessContext(n) || {
        globalVariables: null,
        workflowInput: null,
      };
      let tags = {};
      const rawTags = rawObj.ProcessTags || rawObj.Tags || (rawObj.Request && (rawObj.Request.ProcessTags || rawObj.Request.Tags));
      if (Array.isArray(rawTags)) {
        rawTags.forEach(t => {
          if (t && t.Key && t.Value) tags[t.Key] = t.Value;
        });
      } else if (rawTags && typeof rawTags === "object") {
        tags = rawTags;
      }
      const req = rawObj.Request || {};
      if (req.ApplicationId) tags.ApplicationId = req.ApplicationId;
      if (req.OpLoansId) tags.OpLoansId = req.OpLoansId;

      const tagEntries = Object.entries(tags);
      if (tagEntries.length > 0) {
        tagsHtml = `<div class="live-detail-tags">` +
          tagEntries.map(([k, v]) => `<span class="live-tag-chip" title="${escapeHtml(k)}">${escapeHtml(k)}: ${escapeHtml(v)}</span>`).join("") +
          `</div>`;
      }

      // Build status badge
      let statusBadgeClass = "badge";
      if (n.status === "completed") {
        statusBadgeClass = "badge success";
      } else if (n.status === "failed") {
        statusBadgeClass = "badge danger";
      } else if (n.status === "running" || n.status === "pending" || n.status === "unknown") {
        statusBadgeClass = "badge warning";
      }
      const statusHtml = `<span class="${statusBadgeClass}" style="font-weight: bold; text-transform: uppercase;">${escapeHtml(n.status)}</span>`;

      const headerHtml = `
        <div class="live-detail-header" style="margin-bottom: 12px;">
          <h3 style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:0 0 8px 0;">
            <span>${escapeHtml(n.workflowName)}</span>
            <button onclick="window.jumpToStaticDiagram('${escapeHtml(n.workflowName)}')" class="live-run" style="padding:4px 8px; font-size:10px; display:inline-block; line-height:1.2; background:#475569; border:0; border-radius:4px; color:#fff; cursor:pointer;">Inspect Diagram 🔍</button>
            <button onclick="window.highlightExecutionPath('${escapeHtml(n.workflowName)}', '${escapeHtml(n.requestId)}')" class="live-run" style="padding:4px 8px; font-size:10px; display:inline-block; line-height:1.2; background:#ff9f00; border:0; border-radius:4px; color:#0f172a; cursor:pointer; font-weight:700;">Highlight Path 🎯</button>
          </h3>
          ${tagsHtml}
        </div>
      `;

      let tabContentHtml = "";
      const isLoading = st.loadingDetailId === n.requestId;

      if (activeTab === "overview") {
        // All Process Tags
        const allTagEntries = Object.entries(tags);
        let allTagsHtml = "";
        if (allTagEntries.length > 0) {
          allTagsHtml = `
            <div style="margin-top:12px; border-top:1px solid rgba(255,255,255,0.07); padding-top:10px;">
              <div style="font-size:10px; font-weight:700; color:#64748b; letter-spacing:.06em; text-transform:uppercase; margin-bottom:6px;">Process Tags</div>
              <div style="display:flex; flex-direction:column; gap:3px;">
                ${allTagEntries.map(([k, v]) => `<div class="kv" style="font-size:11px;"><span style="color:#94a3b8;">${escapeHtml(k)}</span><span style="word-break:break-all;">${escapeHtml(v)}</span></div>`).join("")}
              </div>
            </div>`;
        }

        tabContentHtml = `
          <div style="display:flex; flex-direction:column; gap:4px; margin-top:8px;">
            <div class="kv"><span>RequestId</span><span>${n.requestId}</span></div>
            <div class="kv"><span>Parent</span><span>${n.parentRequestId || "(root / none in set)"}</span></div>
            <div class="kv"><span>Status</span><span>${statusHtml}${n.error ? " — " + escapeHtml(n.error) : ""}</span></div>
            <div class="kv"><span>Started</span><span>${n.start ? formatDateTime(n.start) : "—"}</span></div>
            <div class="kv"><span>Ended</span><span>${n.end ? formatDateTime(n.end) : "—"}</span></div>
            <div class="kv"><span>Duration</span><span>${n.durationMs != null ? n.durationMs + "ms" : "?"}</span></div>
            <div class="kv"><span>Version</span><span>${n.version || ""}</span></div>
            <div class="kv"><span>Children</span><span>${n.children.length}</span></div>
          </div>
          ${allTagsHtml}
          <div style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 16px;">
            <a href="${portal}" target="_blank" rel="noopener" class="live-run" style="padding:6px 12px; font-size:11px; text-decoration:none; display:inline-block; line-height:1.2;">Open in portal ↗</a>
            <button id="copyJiraBtn" onclick="window.copyJiraReport()" class="live-run" style="padding:6px 12px; font-size:11px; background:#10b981; border:0; border-radius:4px; color:#fff; cursor:pointer; line-height:1.2;">Copy Jira Report 📋</button>
          </div>
        `;
      } else if (isLoading) {
        tabContentHtml = '<div class="empty-state" style="padding:40px 20px; text-align:center;">กำลังโหลดข้อมูล... ⟳</div>';
      } else if (st.detailError && st.loadingDetailId === null && !isDetailLoaded(n)) {
        tabContentHtml = `<div class="empty-state" style="color:var(--danger); padding:40px 20px; text-align:center;">${escapeHtml(st.detailError)}</div>`;
      } else if (!isDetailLoaded(n)) {
        tabContentHtml = '<div class="empty-state" style="padding:40px 20px; text-align:center;">ไม่มีข้อมูล</div>';
      } else if (activeTab === "node") {
        const staticWf = st.ctx && st.ctx.state && st.ctx.state.workflows.find(w => w.name === n.workflowName);
        let staticInputHtml = `<span class="dim" style="font-size:11px;">(No static metadata found for this workflow name)</span>`;
        if (staticWf) {
          const reqFields = staticWf.dataContext?.requiredFields || [];
          const inpFields = staticWf.dataContext?.inputFields || [];

          const reqText = reqFields.length ? `<div style="font-size:11px; margin-bottom:4px; color:var(--text, #17202a);"><strong>Required fields:</strong> ${escapeHtml(reqFields.join(", "))}</div>` : "";
          const inpBadges = inpFields.map(field => {
            const isRequired = reqFields.includes(field);
            const badgeClass = isRequired ? "badge warning" : "badge";
            return `<span class="${badgeClass}" style="margin: 0 4px 4px 0;">${escapeHtml(field)}${isRequired ? "*" : ""}</span>`;
          }).join("") || `<span class="dim" style="font-size:11px;">No input fields defined</span>`;

          staticInputHtml = `
            <div style="margin-top:4px;">
              ${reqText}
              <div style="display:flex; flex-wrap:wrap; margin-top:4px;">
                ${inpBadges}
              </div>
            </div>`;
        }

        const liveInput = extractPayload(rawObj, ["Input", "Variables", "WorkflowInputJson", "workflowInputJson"]);
        const liveOutput = extractPayload(rawObj, ["Output", "Result", "WorkflowOutputJson", "workflowOutputJson"]);
        const globalVariables = processContext.globalVariables;

        if (globalVariables === null && liveInput === null && liveOutput === null && (!staticWf || !staticWf.dataContext || !staticWf.dataContext.inputFields || staticWf.dataContext.inputFields.length === 0)) {
          tabContentHtml = '<div class="empty-state" style="padding:40px 20px; text-align:center;">ไม่มีข้อมูล</div>';
        } else {
          let globalVariablesHtml = "";
          if (globalVariables !== null) {
            globalVariablesHtml = `
              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:11px; color:var(--text-muted, #64748b); margin-bottom:8px;">Global Variables:</div>
                ${renderPayloadTable(globalVariables, "globalVarsTree")}
              </div>`;
          }

          let liveInputHtml = `<span class="dim" style="font-size:11px;">(No live input data available)</span>`;
          if (liveInput !== null) {
            liveInputHtml = renderPayloadTable(liveInput, "liveInputTree");
          }

          let liveOutputHtml = `<span class="dim" style="font-size:11px;">(No live output data available)</span>`;
          if (liveOutput !== null) {
            liveOutputHtml = renderPayloadTable(liveOutput, "liveOutputTree");
          }

          tabContentHtml = `
            <section class="detail-section" style="margin-bottom:16px;">
              ${globalVariablesHtml}
              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:11px; color:var(--text-muted, #64748b); margin-bottom:4px;">Expected Static Inputs:</div>
                ${staticInputHtml}
              </div>
              
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom: 1px solid var(--line); padding-bottom:8px;">
                <h4 style="margin:0;">Live Payloads</h4>
                <div class="json-tree-toolbar" style="display: flex; gap: 12px; font-size: 11px;">
                  <button type="button" class="json-tree-btn" onclick="window.expandAllJson('liveInputTree'); window.expandAllJson('liveOutputTree');" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-weight:600; font-family:inherit;">EXPAND ALL</button>
                  <button type="button" class="json-tree-btn" onclick="window.collapseAllJson('liveInputTree'); window.collapseAllJson('liveOutputTree');" style="background:none; border:0; color:#2563eb; cursor:pointer; padding:0; font-weight:600; font-family:inherit;">COLLAPSE ALL</button>
                </div>
              </div>
              
              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:11px; color:var(--text-muted, #64748b); margin-bottom:8px;">Live Input Payload:</div>
                ${liveInputHtml}
              </div>
              <div style="margin-bottom:16px;">
                <div style="font-weight:600; font-size:11px; color:var(--text-muted, #64748b); margin-bottom:8px;">Live Output Payload / Result:</div>
                ${liveOutputHtml}
              </div>
            </section>
          `;
        }
      } else if (activeTab === "db") {
        const staticWf = st.ctx && st.ctx.state && st.ctx.state.workflows.find(w => w.name === n.workflowName);
        const dbOps = (staticWf && staticWf.dbOperations) || [];
        const steps = getSteps(n);

        const parsedSteps = steps.map((step, idx) => {
          const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "(unnamed step)";
          const stepType = step.Type || step.StepType || step.ActivityType || step.NodeType || "Task";
          const stepNo = idx + 1;
          const nodeId = step.ActivityId || step.StepId || step.NodeId || step.ActivityName || stepName;
          return { stepName, stepType, stepNo, nodeId, step };
        });

        const matchedOps = [];
        dbOps.forEach(op => {
          const opNodeId = String(op.nodeId || "").toLowerCase();
          let matchedStep = null;
          if (opNodeId) {
            matchedStep = parsedSteps.find(s =>
              String(s.nodeId || "").toLowerCase() === opNodeId ||
              String(s.stepName || "").toLowerCase() === opNodeId ||
              opNodeId.includes(String(s.stepName || "").toLowerCase()) ||
              String(s.stepName || "").toLowerCase().includes(opNodeId)
            );
          }
          matchedOps.push({
            op,
            stepNo: matchedStep ? matchedStep.stepNo : null,
            stepName: matchedStep ? matchedStep.stepName : op.nodeId || "(unknown)",
            order: matchedStep ? matchedStep.stepNo : 99999
          });
        });

        matchedOps.sort((a, b) => a.order - b.order);

        if (matchedOps.length === 0) {
          tabContentHtml = '<div class="empty-state" style="padding:40px 20px; text-align:center;">ไม่มีข้อมูล</div>';
        } else {
          let rowsHtml = "";
          matchedOps.forEach(mo => {
            const stepNoText = mo.stepNo !== null ? `<strong>${mo.stepNo}</strong>` : `<span class="dim">-</span>`;
            const opStr = String(mo.op.operation || "").toUpperCase();
            let badgeClass = "badge";
            if (opStr === "SELECT") badgeClass = "badge accent";
            else if (opStr === "INSERT") badgeClass = "badge success";
            else if (opStr === "UPDATE" || opStr === "UPSERT") badgeClass = "badge warning";
            else if (opStr === "DELETE") badgeClass = "badge danger";

            const badgeHtml = `<span class="${badgeClass}" style="font-weight:600;">${escapeHtml(opStr)}</span>`;
            const tableLink = `<a href="#" onclick="window.jumpToDbTable('${escapeHtml(mo.op.table)}'); return false;" class="workflow-link" style="font-family:monospace; font-weight:600;">${escapeHtml(mo.op.table)}</a>`;

            rowsHtml += `
              <tr style="border-bottom: 1px solid var(--line); font-size:11px;">
                <td style="padding:8px 4px; text-align:center;">${stepNoText}</td>
                <td style="padding:8px 4px;">${tableLink}</td>
                <td style="padding:8px 4px;">${badgeHtml}</td>
                <td style="padding:8px 4px;" class="dim">${escapeHtml(mo.stepName)}</td>
              </tr>`;
          });

          tabContentHtml = `
            <section class="detail-section" style="margin-bottom:16px;">
              <h4 style="margin:0 0 8px 0;">Database Interventions</h4>
              <table class="live-db-table" style="width:100%; border-collapse:collapse; text-align:left; margin-top:8px;">
                <thead>
                  <tr style="border-bottom:2px solid var(--line); font-size:11px; font-weight:600; color:var(--text-muted, #64748b);">
                    <th style="padding:6px 4px; width:60px; text-align:center;">Step No</th>
                    <th style="padding:6px 4px;">Table Name</th>
                    <th style="padding:6px 4px; width:95px;">Operation</th>
                    <th style="padding:6px 4px;">Executed In</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </section>
          `;
        }
      } else if (activeTab === "inbound") {
        const steps = getSteps(n);
        if (steps.length === 0) {
          tabContentHtml = '<div class="empty-state" style="padding:40px 20px; text-align:center;">ไม่มีข้อมูล</div>';
        } else {
          const staticWf = st.ctx && st.ctx.state && st.ctx.state.workflows.find(w => w.name === n.workflowName);
          const dbOps = (staticWf && staticWf.dbOperations) || [];
          const stepDbMap = new Map();

          const parsedSteps = steps.map((step, idx) => {
            const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "(unnamed step)";
            const stepType = step.Type || step.StepType || step.ActivityType || step.NodeType || "Task";
            const start = step.RequestDateTime ? Date.parse(step.RequestDateTime) : (step.Start ? Date.parse(step.Start) : null);
            const end = step.ResponseDateTime ? Date.parse(step.ResponseDateTime) : (step.End ? Date.parse(step.End) : null);
            const duration = (step.DurationMs != null) ? step.DurationMs
              : (step.Duration != null) ? step.Duration
                : (start && end) ? (end - start) : null;
            const status = step.IsFailed ? "failed" : (step.IsCompleted ? "completed" : (step.Status || "completed"));
            const stepNo = idx + 1;
            const nodeId = step.ActivityId || step.StepId || step.NodeId || step.ActivityName || stepName;
            return { stepName, stepType, duration, status, stepNo, nodeId };
          });

          // Map dbOps to steps
          dbOps.forEach(op => {
            const opNodeId = String(op.nodeId || "").toLowerCase();
            if (opNodeId) {
              const matchedStep = parsedSteps.find(s =>
                String(s.nodeId || "").toLowerCase() === opNodeId ||
                String(s.stepName || "").toLowerCase() === opNodeId ||
                opNodeId.includes(String(s.stepName || "").toLowerCase()) ||
                String(s.stepName || "").toLowerCase().includes(opNodeId)
              );
              if (matchedStep) {
                if (!stepDbMap.has(matchedStep.stepNo)) {
                  stepDbMap.set(matchedStep.stepNo, []);
                }
                stepDbMap.get(matchedStep.stepNo).push(op);
              }
            }
          });

          const reversedSteps = [...parsedSteps].reverse();

          const rowsHtml = reversedSteps.map(s => {
            const durText = s.duration != null ? L().formatDuration(s.duration) : "0ms";
            const statusIcon = s.status === "failed"
              ? `<span style="color:var(--danger); font-weight:bold; margin-right:6px;">✗</span>`
              : `<span style="color:var(--success); font-weight:bold; margin-right:6px;">✓</span>`;

            // Build inline DB details if any
            let dbInfoHtml = "";
            if (st.showDbInterventions && stepDbMap.has(s.stepNo)) {
              const ops = stepDbMap.get(s.stepNo);
              const chips = ops.map(op => {
                const opStr = String(op.operation || "").toUpperCase();
                let badgeClass = "badge";
                if (opStr === "SELECT") badgeClass = "badge accent";
                else if (opStr === "INSERT") badgeClass = "badge success";
                else if (opStr === "UPDATE" || opStr === "UPSERT") badgeClass = "badge warning";
                else if (opStr === "DELETE") badgeClass = "badge danger";

                return `<span style="display:inline-flex; align-items:center; gap:4px; margin-right:8px; font-size:10px; background:rgba(255,255,255,0.03); padding:2px 6px; border-radius:4px; border: 1px solid rgba(255,255,255,0.05); margin-top:2px;">
                  <span onclick="window.jumpToDbTable('${escapeHtml(op.table)}'); event.stopPropagation(); return false;" style="font-family:monospace; font-weight:600; cursor:pointer; color:#3b82f6; text-decoration:underline;">${escapeHtml(op.table)}</span>
                  <span class="${badgeClass}" style="font-size:9px; padding:1px 3px; font-weight:bold;">${escapeHtml(opStr)}</span>
                </span>`;
              }).join("");
              dbInfoHtml = `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">${chips}</div>`;
            }

            return `
              <tr class="live-step-row-clickable" data-step-no="${s.stepNo}" style="border-bottom:1px solid var(--line); font-size:11px;">
                <td style="padding:8px 4px; text-align:center; font-weight:bold; color:var(--text);">${s.stepNo}</td>
                <td style="padding:8px 4px; font-family:monospace; color:var(--muted);">${escapeHtml(s.stepType)}</td>
                <td style="padding:8px 4px; font-weight:600; color:var(--text);">
                  <div>${escapeHtml(s.stepName)}</div>
                  ${dbInfoHtml}
                </td>
                <td style="padding:8px 4px; text-align:right; white-space:nowrap; vertical-align:top;">
                  ${statusIcon}
                  <span style="font-family:monospace; color:var(--text);">${escapeHtml(durText)}</span>
                </td>
              </tr>
            `;
          }).join("");

          const stepsContentHtml = `
            <table class="live-steps-table" style="width:100%; border-collapse:collapse; text-align:left; margin-top:8px;">
              <thead>
                <tr style="border-bottom:2px solid var(--line); font-size:11px; font-weight:600; color:var(--text-muted, #64748b); height: 28px;">
                  <th style="padding:6px 4px; width:45px; text-align:center;">NO</th>
                  <th style="padding:6px 4px; width:110px;">TYPE</th>
                  <th style="padding:6px 4px;">NAME</th>
                  <th style="padding:6px 4px; width:95px; text-align:right;">DURATION</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          `;

          tabContentHtml = `
            <section class="detail-section" style="margin-bottom:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <h4 style="margin:0;">Activity Steps</h4>
                <label style="font-size:11px; font-weight:normal; color:var(--text-muted, #94a3b8); display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none;">
                  <input type="checkbox" id="toggleDbInterventions" ${st.showDbInterventions ? "checked" : ""} style="margin:0; width:13px; height:13px; cursor:pointer;" />
                  Show Database Interventions
                </label>
              </div>
              ${stepsContentHtml}
            </section>
          `;
        }
      }

      host.innerHTML = headerHtml + tabContentHtml;

      // Attach toggle change listener
      const toggleBtn = host.querySelector("#toggleDbInterventions");
      if (toggleBtn) {
        toggleBtn.addEventListener("change", (e) => {
          st.showDbInterventions = e.target.checked;
          renderDetail();
        });
      }

      // Attach click listeners to step rows
      const stepRows = host.querySelectorAll(".live-step-row-clickable");
      stepRows.forEach(row => {
        row.addEventListener("click", () => {
          const stepNo = parseInt(row.dataset.stepNo, 10);
          const steps = getSteps(n);
          const step = steps[stepNo - 1];
          if (step) {
            window.showStepDetailModal(step, stepNo, steps);
          }
        });
      });
    } catch (e) {
      console.error(e);
      st.ctx.els.detailContent.innerHTML = `<div class="empty-state" style="color:var(--danger); padding:20px; text-align:center;">Error rendering detail: ${escapeHtml(e.message)}</div>`;
    }
  }

  // --- bridge feeder (Phase 4.x; wired here, hardened in Phase 4.x tasks) ---
  function runBridge() {
    const env = curEnv();
    if (!env) {
      document.getElementById("liveEnvUpload")?.click();
      return;
    }
    if (!st.bridgeWin || st.bridgeWin.closed) {
      st.bridgeWin = window.open(env.consoleBase, "liveConsole");
      setBridge("opened — click bookmarklet", false);
      return;
    }
    if (!st.token) {
      setBridge("no token — click bookmarklet", false);
      return;
    }
    configureBridge();

    const tag = collectTagFilter();
    const workflowRequestId = document.getElementById("liveWorkflowRequestId").value.trim();
    const workflowName = document.getElementById("liveWorkflowName").value.trim();
    const status = document.getElementById("liveStatus").value;
    const queryOpts = {
      workflowRequestId,
      workflowName,
      status,
      tagKey: tag.key,
      tagValue: tag.value,
    };
    if (!L().hasRequiredProcessFilter(queryOpts)) {
      window.alert("Enter at least one search filter: workflowRequestId, workflowName, or Tag Value.");
      document.getElementById("liveTagValue")?.focus();
      return;
    }
    st.autoFetchRelationships = document.getElementById("liveAutoRelationships").checked;
    st.lastAppId = tag.value || null;
    st.importedFileName = null;
    if (typeof window.updatePageTitle === "function") {
      window.updatePageTitle();
    }

    const fromVal = document.getElementById("liveFrom").value.trim();
    const toVal = document.getElementById("liveTo").value.trim();

    let fromUtc = "";
    if (fromVal) {
      const fromDate = parseDateTime(fromVal);
      if (!fromDate) {
        window.alert("Invalid 'From' date format. Please use DD/MM/YYYY HH:mm (e.g. 08/06/2026 22:16)");
        return;
      }
      fromUtc = fromDate.toISOString().replace(/\.\d+Z$/, ".000Z");
    }

    let toUtc = "";
    if (toVal) {
      const toDate = parseDateTime(toVal);
      if (!toDate) {
        window.alert("Invalid 'To' date format. Please use DD/MM/YYYY HH:mm (e.g. 08/06/2026 22:16)");
        return;
      }
      toUtc = toDate.toISOString().replace(/\.\d+Z$/, ".000Z");
    }

    queryOpts.fromDate = fromUtc;
    queryOpts.toDate = toUtc;
    lastQueryOpts = queryOpts;

    allCollectedItems = [];
    fetchedParents.clear();
    fetchedDetails.clear();
    requestQueue.length = 0;
    autoFetchCount = 0;
    activeAutoFetches = 1;
    st.stopRequested = false;
    st.loadAllMode = false;
    st.incrementalLoad = false;
    st.scrollBottomGap = null;
    st.allDirectItems = [];
    st.directTotal = null;
    st.effPageSize = 0;
    st.lastDirectPageCount = 0;
    st.directPagesFetched = 0;
    st.hasMorePages = false;
    st.nextDirectPage = 1;
    resetProgress();

    // Forward pagination: fetch page 1, then advance the cursor.
    const page = st.nextDirectPage;
    st.nextDirectPage += 1;
    pushProgressSegment("Page " + page);
    const url = L().buildProcessUrl(env.msBase, Object.assign({ pageIndex: page, pageSize: DIRECT_PAGE_SIZE }, queryOpts));

    st.bridgeWin.postMessage({ type: "BRIDGE_FETCH", reqId: "mainpage_" + page + "_" + Date.now(), url }, "*");
    setBridge("fetching… ⟳", true);
    enableButtons(false);
    renderPaginationControls();
  }

  window.addEventListener("message", (ev) => {
    const allowed = envList().map((e) => e.consoleBase);
    if (!allowed.includes(ev.origin)) return;
    const m = ev.data || {};
    if (st.stopRequested && m.type === "BRIDGE_RESULT") {
      return;
    }
    if (m.type === "BRIDGE_TOKEN") {
      st.token = m.token;
      st.bridgeWin = ev.source;
      configureBridge(ev.source);
      setBridge("connected", true);
    }
    else if (m.type === "BRIDGE_RESULT") {
      const isDirectPage = m.reqId && m.reqId.startsWith("mainpage_");
      const isChild = m.reqId && m.reqId.startsWith("child_");
      const isDetail = m.reqId && m.reqId.startsWith("detail_");
      const isUserDetail = m.reqId && m.reqId.startsWith("user_detail_");

      if (m.ok && m.json) {
        if (isDirectPage) {
          activeAutoFetches = Math.max(0, activeAutoFetches - 1); tickProgress();
          const response = L().normalizeResponse(m.json);
          const fetchedItems = response.items;

          // Merge forward, deduped by requestId.
          const existingIds = new Set(allCollectedItems.map(x => x.requestId));
          const newItems = fetchedItems.filter(x => x.requestId && !existingIds.has(x.requestId));
          newItems.forEach(item => { item.origin = "main"; });
          allCollectedItems.push(...newItems);
          st.allDirectItems.push(...newItems);

          // Effective page size is captured from the first page so that a
          // server-side cap (e.g. returns 25 for a request of 100) does not
          // make the "< pageSize = last page" test fire too early.
          if (st.effPageSize === 0) st.effPageSize = fetchedItems.length;
          st.lastDirectPageCount = fetchedItems.length;
          st.directPagesFetched = (st.directPagesFetched || 0) + 1;
          if (Number.isFinite(response.pagination?.totalItems)) {
            st.directTotal = response.pagination.totalItems;
          }
          // API metadata is authoritative when available. The item-count fallback
          // supports older responses, while the new-item guard prevents repeated
          // pages from making Load all loop forever.
          st.hasMorePages = L().hasMoreProcessPages(response, {
            loadedCount: st.allDirectItems.length,
            newItemCount: newItems.length,
            effectivePageSize: st.effPageSize,
            pagesFetched: st.directPagesFetched,
            maxPages: MAX_DIRECT_PAGES
          });

          // Re-render the hierarchy. For an incremental "Load earlier" page,
          // older rows prepend at the top — keep the viewport anchored.
          const canvas = st.ctx && st.ctx.els && st.ctx.els.diagramCanvas;
          loadGraph(allCollectedItems, true);
          if (st.incrementalLoad && canvas && st.scrollBottomGap != null) {
            canvas.scrollTop = Math.max(0, canvas.scrollHeight - st.scrollBottomGap);
          }

          // Relationship expansion is opt-in. Direct search results render first;
          // users can expand manually from the diagram header when auto-fetch is off.
          if (st.autoFetchRelationships) {
            fetchChildren(newItems);
          }
          updateLoadingState();
        } else if (isChild) {
          activeAutoFetches = Math.max(0, activeAutoFetches - 1); tickProgress();
          const fetchedItems = L().normalizeResponse(m.json).items;
          const existingIds = new Set(allCollectedItems.map(x => x.requestId));
          const newItems = fetchedItems.filter(x => x.requestId && !existingIds.has(x.requestId));
          newItems.forEach(item => { item.origin = "child"; });

          if (newItems.length > 0) {
            allCollectedItems.push(...newItems);
            // Use debounced graph rebuild instead of immediate rebuild
            scheduleGraphRebuild();
            fetchChildren(newItems);
          }

          // Paginate children: if this page came back full AND brought new items,
          // the parent has more children — fetch the next page. Stopping on a
          // non-full page OR zero-new-items page avoids missing children of
          // parents with >CHILD_PAGE_SIZE kids while guarding against loops.
          const cParts = m.reqId.split("_");
          const cParentId = cParts[1];
          const cPageIndex = parseInt(cParts[2], 10) || 1;
          if (cParentId && fetchedItems.length === CHILD_PAGE_SIZE && newItems.length > 0) {
            fetchChildPage(cParentId, cPageIndex + 1);
          }
          updateLoadingState();
        } else if (isDetail) {
          activeAutoFetches = Math.max(0, activeAutoFetches - 1); tickProgress();
          const detailObj = m.json;
          if (detailObj) {
            const env = curEnv();
            const parentId = getParentIdFromDetail(detailObj);

            const normalized = L().normalizeProcess(detailObj);
            if (normalized && normalized.requestId) {
              const existingIndex = allCollectedItems.findIndex(x => x.requestId === normalized.requestId);
              if (existingIndex === -1) {
                normalized.detailLoaded = true;
                normalized.origin = "parent";
                allCollectedItems.push(normalized);
              } else {
                if (!allCollectedItems[existingIndex].origin) {
                  allCollectedItems[existingIndex].origin = "parent";
                }
                allCollectedItems[existingIndex] = enrichWithDetail(allCollectedItems[existingIndex], detailObj);
              }
              // Use debounced graph rebuild instead of immediate rebuild
              scheduleGraphRebuild();
            }

            if (parentId && env && autoFetchCount < MAX_AUTO_FETCHES) {
              // Expand-down: fetch the immediate parent's children (siblings) once.
              if (!fetchedParents.has(parentId)) {
                fetchedParents.add(parentId);
                fetchChildPage(parentId, 1);
              } else {
                // Parent's sibling query already issued — a saved API call.
                st.progress.skipped++;
              }

              // Climb-up: walk the ancestor chain. Each ancestor whose detail we
              // already queried (this run) or already hold in full is a SAVED API
              // call (counted as "skipped"); only the first genuinely-missing
              // ancestor is fetched. fetchedDetails also breaks cycles.
              let climbId = parentId;
              while (climbId) {
                if (fetchedDetails.has(climbId)) {
                  // Its detail was already requested by an earlier child's climb.
                  st.progress.skipped++;
                  break;
                }
                fetchedDetails.add(climbId);
                const haveAncestor = allCollectedItems.find(
                  (x) => x.requestId === climbId && x.detailLoaded
                );
                if (!haveAncestor) {
                  autoFetchCount++;
                  activeAutoFetches++;
                  const urlDetail = env.msBase + "/runtime/api/report/process/" + climbId;
                  addToQueue(urlDetail, "detail_" + climbId + "_" + Date.now());
                  break;
                }
                // Already hold this ancestor in full — reuse it, keep walking up.
                st.progress.skipped++;
                climbId = haveAncestor.parentRequestId || null;
              }
            }
          }
          updateLoadingState();
        } else if (isUserDetail) {
          const prefixLen = "user_detail_".length;
          const lastUnderscore = m.reqId.lastIndexOf("_");
          const rid = m.reqId.substring(prefixLen, lastUnderscore);
          const detailObj = m.json;

          if (detailObj) {
            const existingIndex = allCollectedItems.findIndex(x => x.requestId === rid);
            if (existingIndex === -1) {
              const normalized = L().normalizeProcess(detailObj);
              if (normalized) {
                normalized.detailLoaded = true;
                allCollectedItems.push(normalized);
              }
            } else {
              allCollectedItems[existingIndex] = enrichWithDetail(allCollectedItems[existingIndex], detailObj);
            }
            // Update the node in the existing graph in-place instead of rebuilding everything
            // This prevents the process list from re-rendering and jumping around
            if (st.graph && st.graph.byId.has(rid)) {
              const existingNode = st.graph.byId.get(rid);
              const updatedItem = allCollectedItems.find(x => x.requestId === rid);
              if (existingNode && updatedItem) {
                // Preserve children array and graph-specific props
                const children = existingNode.children;
                const hasParentInSet = existingNode.hasParentInSet;
                Object.assign(existingNode, updatedItem, { children, hasParentInSet });
              }
            }
          }

          if (st.loadingDetailId === rid) {
            st.loadingDetailId = null;
          }
          renderDetail();
        }
      } else {
        if (isDirectPage) {
          activeAutoFetches = Math.max(0, activeAutoFetches - 1); tickProgress();
          st.hasMorePages = false;
          st.loadAllMode = false;
          setBridge("error HTTP " + m.status, false);
          updateLoadingState();
        } else if (isUserDetail) {
          const prefixLen = "user_detail_".length;
          const lastUnderscore = m.reqId.lastIndexOf("_");
          const rid = m.reqId.substring(prefixLen, lastUnderscore);
          if (st.loadingDetailId === rid) {
            st.loadingDetailId = null;
            st.detailError = "Error HTTP " + m.status;
          }
          renderDetail();
        } else {
          activeAutoFetches = Math.max(0, activeAutoFetches - 1); tickProgress();
          updateLoadingState();
        }
      }
    }
  });

  window.jumpToStaticDiagram = function (workflowName) {
    if (typeof window.setMode === "function" && typeof window.selectWorkflow === "function") {
      const searchInput = document.getElementById("searchInput");
      if (searchInput) searchInput.value = workflowName;
      window.setMode("zoral");
      window.selectWorkflow(workflowName);
    }
  };

  window.highlightExecutionPath = function (workflowName, requestId) {
    if (!st.graph) {
      console.warn("highlightExecutionPath: st.graph is not loaded.");
      return;
    }
    const n = st.graph.byId.get(requestId);
    if (!n) {
      console.warn("highlightExecutionPath: Process not found in graph:", requestId);
      return;
    }
    const steps = getSteps(n);
    if (steps.length === 0) {
      alert("No step execution details are loaded for this process. If you imported a JSON file, make sure it contains step details.");
      return;
    }

    const executedNames = new Set();
    steps.forEach(step => {
      const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName;
      if (stepName) {
        executedNames.add(stepName);
        executedNames.add(stepName.toLowerCase().trim());
      }
      const activityId = step.ActivityId || step.StepId || step.NodeId;
      if (activityId) {
        executedNames.add(activityId);
        executedNames.add(activityId.toLowerCase().trim());
      }
    });

    const staticWorkflows = (st.ctx && st.ctx.state && st.ctx.state.workflows) || [];
    const targetWf = staticWorkflows.find(
      (w) => w.name.toLowerCase() === workflowName.toLowerCase()
    );

    if (!targetWf) {
      alert(`Workflow "${workflowName}" was not found in the local Zoral index.\nEnsure the workflow files are indexed.`);
      return;
    }

    const entryNode = P()?.findWorkflowEntryNode(targetWf);
    if (entryNode) {
      executedNames.add(entryNode.id);
      executedNames.add(String(entryNode.id).toLowerCase().trim());
      if (entryNode.callName) {
        executedNames.add(entryNode.callName);
        executedNames.add(String(entryNode.callName).toLowerCase().trim());
      }
    }

    const canonicalName = targetWf.name;

    if (st.ctx && st.ctx.state && typeof window.setMode === "function" && typeof window.selectWorkflow === "function") {
      const searchInput = document.getElementById("searchInput");
      if (searchInput) searchInput.value = canonicalName;

      // Crucial: window.setMode("zoral") will internally call selectWorkflow(..., { restore: true })
      // which clears liveHighlightedWorkflow/liveExecutedNodes.
      // Therefore, we must invoke setMode first, and ONLY THEN populate the state highlights
      // before calling selectWorkflow with keepHighlights: true.
      window.setMode("zoral");

      st.ctx.state.liveHighlightedWorkflow = canonicalName;
      st.ctx.state.liveExecutedNodes = executedNames;

      window.selectWorkflow(canonicalName, { keepHighlights: true });
    }
  };


  window.copyJiraReport = function () {
    if (!st.selected || !st.graph) return;
    const n = st.graph.byId.get(st.selected);
    const steps = getSteps(n);

    let md = `h3. Workflow Trace: ${n.workflowName}\n`;
    md += `* *RequestId:* ${n.requestId}\n`;
    md += `* *Parent ID:* ${n.parentRequestId || "None"}\n`;
    md += `* *Status:* ${n.status.toUpperCase()}\n`;
    if (n.error) md += `* *Error:* ${n.error}\n`;
    md += `* *Duration:* ${n.durationMs != null ? n.durationMs + "ms" : "Unknown"}\n`;
    md += `* *Version:* ${n.version || "Unknown"}\n\n`;

    if (steps.length > 0) {
      md += `|| Step Name || Type || Duration || Status ||\n`;
      steps.forEach(step => {
        const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "(unnamed)";
        const stepType = step.ItemType || step.Type || step.StepType || step.ActivityType || step.NodeType || "Task";
        const start = step.RequestDateTime ? Date.parse(step.RequestDateTime) : (step.Start ? Date.parse(step.Start) : null);
        const end = step.ResponseDateTime ? Date.parse(step.ResponseDateTime) : (step.End ? Date.parse(step.End) : null);
        const duration = (step.DurationMs != null) ? step.DurationMs
          : (step.Duration != null) ? step.Duration
            : (start && end) ? (end - start) : null;
        const dur = duration != null ? L().formatDuration(duration) : "";
        const status = step.IsFailed ? "FAILED" : "COMPLETED";
        md += `| ${stepName} | ${stepType} | ${dur} | ${status} |\n`;
      });
    }

    navigator.clipboard.writeText(md).then(() => {
      const btn = document.getElementById("copyJiraBtn");
      if (btn) {
        const old = btn.textContent;
        btn.textContent = "Copied! ✓";
        btn.style.background = "#059669";
        setTimeout(() => {
          btn.textContent = old;
          btn.style.background = "";
        }, 2000);
      }
    });
  };

  window.showStepDetailModal = function (step, stepNo, stepsList) {
    let modal = document.getElementById("liveStepModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "liveStepModal";
      modal.className = "live-modal-overlay";
      document.body.appendChild(modal);
    }

    // Bind ESC key to close modal
    const onEsc = (e) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };

    const closeModal = () => {
      modal.classList.remove("active");
      document.removeEventListener("keydown", onEsc);
      setTimeout(() => {
        modal.innerHTML = "";
      }, 250);
    };

    // Helper to extract JSON/string payloads
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

    // Determine active step info
    const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "(unnamed step)";
    const stepType = step.Type || step.StepType || step.ActivityType || step.NodeType || "Task";
    const start = step.RequestDateTime || step.Start || "";
    const end = step.ResponseDateTime || step.End || "";
    const duration = step.DurationMs ?? step.Duration ?? (start && end ? (Date.parse(end) - Date.parse(start)) : null);
    const durText = duration != null ? L().formatDuration(duration) : "0ms";
    const status = step.IsFailed ? "failed" : "completed";

    // Render status badge inside header
    const statusClass = status === "failed" ? "badge danger" : "badge success";
    const statusBadge = `<span class="${statusClass}">${status.toUpperCase()}</span>`;

    // Prev/Next nav setup
    const hasPrev = stepNo > 1;
    const hasNext = stepNo < stepsList.length;

    // Build DB Table links if any
    let dbLinksHtml = "";
    const tableOpsMap = new Map();

    // Check static mappings if we have a table match or custom query
    const staticWf = st.ctx && st.ctx.state && st.ctx.state.workflows.find(w => w.name === st.graph.byId.get(st.selected).workflowName);
    const dbOps = (staticWf && staticWf.dbOperations) || [];
    const nodeId = step.ActivityId || step.StepId || step.NodeId || step.ActivityName || stepName;
    const nodeIdLower = String(nodeId || "").toLowerCase();

    dbOps.forEach(op => {
      const opNodeId = String(op.nodeId || "").toLowerCase();
      if (opNodeId && (opNodeId === nodeIdLower || opNodeId.includes(nodeIdLower) || nodeIdLower.includes(opNodeId))) {
        if (op.table) {
          if (!tableOpsMap.has(op.table)) {
            tableOpsMap.set(op.table, new Set());
          }
          if (op.operation) {
            tableOpsMap.get(op.table).add(op.operation.toUpperCase());
          }
        }
      }
    });

    // Check payload for table name keys (e.g. key confirm, table variables)
    if (inputJson && typeof inputJson === "object") {
      Object.entries(inputJson).forEach(([k, v]) => {
        if (typeof v === "string" && (k.toLowerCase().includes("table") || k.toLowerCase().includes("schema"))) {
          if (st.ctx.state.dbTables.some(t => t.name === v)) {
            if (!tableOpsMap.has(v)) {
              tableOpsMap.set(v, new Set());
            }
          }
        }
      });
    }

    if (tableOpsMap.size > 0) {
      dbLinksHtml = [...tableOpsMap.entries()].map(([tbl, opsSet]) => {
        const opsList = [...opsSet].sort();
        const opsSuffix = opsList.length > 0 ? ` [${opsList.join(", ")}]` : "";
        return `<a href="#" onclick="window.jumpToDbTable('${escapeHtml(tbl)}'); document.getElementById('liveStepModal').classList.remove('active'); return false;" class="live-modal-nav-btn" style="text-decoration:none; display:inline-block;">Table: ${escapeHtml(tbl)}${escapeHtml(opsSuffix)} 💾</a>`;
      }).join(" ");
    }

    // Build GQL Operation details if present
    let gqlInfoHtml = "";
    const resolvedGqlNames = [];
    const gqlOps = (staticWf && staticWf.graphqlOperations) || [];
    gqlOps.forEach(op => {
      const opNodeId = String(op.nodeId || "").toLowerCase();
      if (opNodeId && (opNodeId === nodeIdLower || opNodeId.includes(nodeIdLower) || nodeIdLower.includes(opNodeId))) {
        if (op.operationName && !resolvedGqlNames.includes(op.operationName)) {
          resolvedGqlNames.push(op.operationName);
        }
      }
    });

    if (resolvedGqlNames.length > 0) {
      gqlInfoHtml = resolvedGqlNames.map(opName =>
        `<span class="badge accent" style="font-family:monospace;">GQL: ${escapeHtml(opName)}</span>`
      ).join(" ");
    }

    // Diagnostics if failed
    let diagnosticsHtml = "";
    if (step.IsFailed || step.ErrorDescription || step.ErrorCode) {
      const errCode = step.ErrorCode || "ERROR";
      const errDesc = step.ErrorDescription || step.Error || "Unknown execution failure.";
      diagnosticsHtml = `
        <div class="live-modal-diagnostics">
          <h4>⚠️ Diagnostics (${escapeHtml(errCode)})</h4>
          <p>${escapeHtml(errDesc)}</p>
        </div>
      `;
    }

    // Modal tabs navigation HTML
    const tabsHtml = `
      <div class="live-modal-tabs">
        <button class="live-modal-tab active" data-modal-tab="payloads">Payloads</button>
        <button class="live-modal-tab" data-modal-tab="diff">Payload Diff</button>
      </div>
    `;

    // Render tree view or empty
    const renderPayloadView = (payload, title, treeId) => {
      const payloadHtml = renderPayloadTable(payload, treeId);
      return `
        <div class="live-modal-payload-header">
          <strong>${escapeHtml(title)}</strong>
          <div style="display:flex; align-items:center; gap:12px;">
            <button class="live-modal-nav-btn" onclick="window.expandAllJson('${treeId}')">Expand All</button>
            <button class="live-modal-nav-btn" onclick="window.collapseAllJson('${treeId}')">Collapse All</button>
          </div>
        </div>
        ${payloadHtml}
      `;
    };

    // Flat / deep diffing
    const diffHtml = renderPayloadDiff(inputJson, outputJson);

    modal.innerHTML = `
      <div class="live-modal-card">
        <div class="live-modal-header">
          <div class="live-modal-header-left">
            <h3 class="live-modal-title">${escapeHtml(stepName)}</h3>
            <span class="badge" style="font-weight:600; text-transform:uppercase;">${escapeHtml(stepType)}</span>
            <span class="badge" style="font-weight:bold;">Order #${stepNo}</span>
            ${statusBadge}
          </div>
          <div class="live-modal-nav-group">
            <button id="modalPrevBtn" class="live-modal-nav-btn" ${hasPrev ? "" : "disabled"}>◀ Prev</button>
            <button id="modalNextBtn" class="live-modal-nav-btn" ${hasNext ? "" : "disabled"}>Next ▶</button>
            <button id="modalCloseBtn" class="live-modal-close">&times;</button>
          </div>
        </div>
        
        <div class="live-modal-body">
          <div class="live-modal-metadata-grid">
            <div class="kv"><span>Start Time</span><span>${escapeHtml(formatDateTime(start))}</span></div>
            <div class="kv"><span>End Time</span><span>${escapeHtml(formatDateTime(end))}</span></div>
            <div class="kv"><span>Duration</span><span>${escapeHtml(durText)}</span></div>
            <div class="kv">
              <span>Integration Links</span>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${dbLinksHtml || '<span class="dim" style="font-size:11px;">(None)</span>'}
                ${gqlInfoHtml}
              </div>
            </div>
          </div>
          
          ${diagnosticsHtml}
          
          ${tabsHtml}
          
          <div id="modalPayloadsContent" class="live-modal-tab-content active">
            <div class="live-modal-split-row">
              <div class="live-modal-split-col">
                ${renderPayloadView(inputJson, "Input Payload Data", "modalInputTree")}
              </div>
              <div class="live-modal-split-col">
                ${renderPayloadView(outputJson, "Output Payload / Result", "modalOutputTree")}
              </div>
            </div>
          </div>
          <div id="modalDiffContent" class="live-modal-tab-content">
            <div class="live-modal-payload-header">
              <strong>Payload Difference (Input vs Output)</strong>
            </div>
            ${diffHtml}
          </div>
        </div>
      </div>
    `;

    // Show modal
    modal.classList.add("active");
    document.addEventListener("keydown", onEsc);

    // Event binding: close buttons
    modal.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    // Event binding: modal tabs
    const tabButtons = modal.querySelectorAll(".live-modal-tab");
    const tabContents = {
      payloads: modal.querySelector("#modalPayloadsContent"),
      diff: modal.querySelector("#modalDiffContent")
    };
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.modalTab;
        tabButtons.forEach(b => b.classList.toggle("active", b === btn));
        Object.entries(tabContents).forEach(([k, el]) => {
          if (el) el.classList.toggle("active", k === target);
        });
      });
    });

    // Navigation Prev/Next
    if (hasPrev) {
      modal.querySelector("#modalPrevBtn").addEventListener("click", () => {
        document.removeEventListener("keydown", onEsc);
        window.showStepDetailModal(stepsList[stepNo - 2], stepNo - 1, stepsList);
      });
    }
    if (hasNext) {
      modal.querySelector("#modalNextBtn").addEventListener("click", () => {
        document.removeEventListener("keydown", onEsc);
        window.showStepDetailModal(stepsList[stepNo], stepNo + 1, stepsList);
      });
    }

  };

  function renderPayloadDiff(input, output) {
    if ((input === null || input === undefined) && (output === null || output === undefined)) {
      return `<div class="empty-state" style="padding:20px; text-align:center;">ไม่มีข้อมูลเปรียบเทียบ</div>`;
    }

    const flatInput = flattenObject(input || {});
    const flatOutput = flattenObject(output || {});

    const allKeys = new Set([...Object.keys(flatInput), ...Object.keys(flatOutput)]);
    const sortedKeys = [...allKeys].sort();

    let rowsHtml = "";

    sortedKeys.forEach(k => {
      const inVal = flatInput[k];
      const outVal = flatOutput[k];

      const inStr = inVal !== undefined ? JSON.stringify(inVal) : "";
      const outStr = outVal !== undefined ? JSON.stringify(outVal) : "";

      if (inVal !== undefined && outVal === undefined) {
        rowsHtml += `
          <div class="diff-row diff-removed">
            <span class="diff-sign">-</span>
            <span class="diff-content">${escapeHtml(k)}: ${escapeHtml(inStr)}</span>
          </div>
        `;
      } else if (inVal === undefined && outVal !== undefined) {
        rowsHtml += `
          <div class="diff-row diff-added">
            <span class="diff-sign">+</span>
            <span class="diff-content">${escapeHtml(k)}: ${escapeHtml(outStr)}</span>
          </div>
        `;
      } else if (inStr !== outStr) {
        rowsHtml += `
          <div class="diff-row diff-modified">
            <span class="diff-sign">~</span>
            <span class="diff-content">${escapeHtml(k)}: ${escapeHtml(inStr)} ──► ${escapeHtml(outStr)}</span>
          </div>
        `;
      } else {
        rowsHtml += `
          <div class="diff-row diff-unchanged">
            <span class="diff-sign">&nbsp;</span>
            <span class="diff-content">${escapeHtml(k)}: ${escapeHtml(inStr)}</span>
          </div>
        `;
      }
    });

    if (!rowsHtml) {
      return `<div class="empty-state" style="padding:20px; text-align:center;">Payloads are identical</div>`;
    }

    return `
      <div class="json-diff-container">
        ${rowsHtml}
      </div>
    `;
  }

  function flattenObject(obj, prefix = "") {
    const res = {};
    if (typeof obj !== "object" || obj === null) {
      return { "": obj };
    }

    Object.entries(obj).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        Object.assign(res, flattenObject(v, key));
      } else {
        res[key] = v;
      }
    });
    return res;
  }

  window.exportTraceJson = async function () {
    if (!st.graph || activeAutoFetches > 0 || requestQueue.length > 0) return;

    const exportBtn = document.getElementById("liveExport");
    const primaryTag = collectTagFilter();
    const workflowRequestId = document.getElementById("liveWorkflowRequestId")?.value || "";
    const workflowName = document.getElementById("liveWorkflowName")?.value || "";
    const fileName = L().buildTraceExportFileName(
      (primaryTag.key && primaryTag.value) ? primaryTag.key : (workflowRequestId ? "workflowRequestId" : "workflowName"),
      primaryTag.value || workflowRequestId || workflowName,
      st.lastAppId || st.selected,
    );
    let objectUrl = null;

    if (exportBtn) exportBtn.disabled = true;
    showLoadingOverlay("Preparing trace data for download...", {
      title: "Exporting Trace JSON",
      stoppable: false
    });

    try {
      await new Promise((resolve) => {
        const schedule = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
        schedule(() => setTimeout(resolve, 0));
      });

      const json = JSON.stringify(st.graph.nodes, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      objectUrl = URL.createObjectURL(blob);

      const downloadLink = document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download = fileName;
      downloadLink.hidden = true;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
    } catch (error) {
      console.error("Unable to export trace JSON", error);
      window.alert("Unable to export trace JSON. Please try again.");
    } finally {
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      hideLoadingOverlay();
      if (exportBtn) exportBtn.disabled = false;
    }
  };

  // Event delegation for JSON tree toggling
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".json-tree-toggle");
    if (!toggle) return;
    const branch = toggle.closest(".json-tree-branch");
    if (!branch) return;
    branch.classList.toggle("collapsed");
    toggle.textContent = branch.classList.contains("collapsed") ? "▶" : "▼";
  });

  const api = {
    activate(ctx) {
      st.ctx = ctx;
      document.body.classList.add("live-active");
      ensureToolbar();
      L().onSelect = select;
      L().onCollapseToggle = () => renderView();
      st.wasResultsPaneOpen = ctx.state.panes.results;
      ctx.state.panes.results = false;
      if (typeof window.applyLayoutState === "function") {
        window.applyLayoutState();
      }
      // Restore the diagram title/subtitle to Live API state after returning from another mode
      if (ctx.els && ctx.els.workflowTitle) {
        ctx.els.workflowTitle.textContent = st.view === "gantt" ? "Process Timeline" : "Process Tree";
      }
      if (ctx.els && ctx.els.workflowSubtitle) {
        const g = st.graph;
        ctx.els.workflowSubtitle.textContent = g ? `${g.count} processes · ${g.roots.length} root(s)` : "";
      }
      renderResults(); renderView(); renderDetail(); renderPaginationControls();
    },
    deactivate() {
      clearTimeout(workflowSuggestTimer);
      hideWorkflowSuggestions();
      document.body.classList.remove("live-active");
      const pc = document.getElementById("livePaginationControls");
      if (pc) { pc.style.display = "none"; pc.innerHTML = ""; }

      if (L()) {
        L().onSelect = null;
        L().onCollapseToggle = null;
      }
      if (st.ctx && st.wasResultsPaneOpen !== undefined) {
        st.ctx.state.panes.results = st.wasResultsPaneOpen;
        if (typeof window.applyLayoutState === "function") {
          window.applyLayoutState();
        }
      }
    },
    getWorkflows() {
      return (st.ctx && st.ctx.state && st.ctx.state.workflows) || [];
    },
    getImportedFileName() {
      return st.importedFileName;
    },
    getLastAppId() {
      return st.lastAppId;
    },
    renderDetail: renderDetail,
    getSelectedProcessSteps() {
      if (!st.graph || !st.selected) return [];
      const n = st.graph.byId.get(st.selected);
      return getSteps(n);
    },
    getSelectedProcessNode() {
      if (!st.graph || !st.selected) return null;
      return st.graph.byId.get(st.selected);
    },
    renderPayloadTable: renderPayloadTable
  };
  root.WorkflowLive = Object.assign(root.WorkflowLive || {}, api);
})(window);
