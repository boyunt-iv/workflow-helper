(function (root) {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

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

  function hasKeyRecursive(obj, search) {
    if (!obj || typeof obj !== "object") return false;
    if (Array.isArray(obj)) {
      return obj.some(item => hasKeyRecursive(item, search));
    }
    for (const key in obj) {
      if (key.toLowerCase().includes(search)) return true;
      if (hasKeyRecursive(obj[key], search)) return true;
    }
    return false;
  }

  function hasValueRecursive(obj, search) {
    if (obj === null || obj === undefined) return false;
    if (typeof obj !== "object") {
      return String(obj).toLowerCase().includes(search);
    }
    if (Array.isArray(obj)) {
      return obj.some(item => hasValueRecursive(item, search));
    }
    for (const key in obj) {
      if (hasValueRecursive(obj[key], search)) return true;
    }
    return false;
  }

  const L = () => root.WorkflowLive || api;

  function renderGantt(graph, host) {
    host.innerHTML = "";
    const rows = graph.timeline.filter((n) => n.start != null);
    if (!rows.length) { host.innerHTML = '<div class="empty-state">No timeline data</div>'; return; }
    
    const t0 = Math.min(...rows.map((n) => n.start));
    const t1 = Math.max(...rows.map((n) => n.end || n.start));
    const span = Math.max(1, t1 - t0);

    const t0Str = formatTimeShort(t0);
    const t1Str = formatTimeShort(t1);
    const tMidStr = formatTimeShort(t0 + span / 2);

    let defaultWidth = "400px";
    if (host && host.clientWidth > 0) {
      defaultWidth = Math.floor(host.clientWidth / 2) + "px";
    }
    const savedWidth = window.liveTreeColWidth || defaultWidth;

    let html = `
      <div class="trace-viewer" style="--tree-col-width: ${savedWidth};">
        <div class="trace-header-row">
          <div class="trace-tree-col" style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
            <span>Workflow Hierarchy</span>
            <div style="display:flex; align-items:center; gap:3px;">
              <input type="text" class="trace-filter-input" placeholder="Filter..." style="width:78px; font-size:11px; padding:3px 6px; background:#0f1420; border:1px solid #2f3b54; color:#e6ebf5; border-radius:4px; outline:none; font-family:inherit;" />
              <select class="trace-filter-type" style="width:78px; font-size:11px; padding:3px 4px; background:#0f1420; border:1px solid #2f3b54; color:#e6ebf5; border-radius:4px; outline:none; font-family:inherit; cursor:pointer;">
                <option value="workflow">Workflow</option>
                <option value="step">Step Name</option>
                <option value="requestId">Request ID</option>
                <option value="table">Table</option>
                <option value="field">Field</option>
                <option value="input">Input</option>
                <option value="output">Output</option>
                <option value="value">Value</option>
              </select>
              <span class="trace-filter-count" title="matches"></span>
              <button type="button" class="trace-filter-nav trace-filter-prev" title="Previous match (Shift+Enter)" disabled>◀</button>
              <button type="button" class="trace-filter-nav trace-filter-next" title="Next match (Enter)" disabled>▶</button>
            </div>
          </div>
          <div class="trace-timeline-col">
            <div class="trace-time-axis">
              <span class="axis-tick start">${esc(t0Str)}</span>
              <span class="axis-tick mid">${esc(tMidStr)}</span>
              <span class="axis-tick end">${esc(t1Str)}</span>
            </div>
          </div>
        </div>
        <div class="trace-rows">`;

    const visited = new Set();

    function renderRow(nodeId, depth, isHidden) {
      if (visited.has(nodeId)) return;
      if (isHidden) return;
      visited.add(nodeId);
      const n = graph.byId.get(nodeId);
      if (!n) return;

      const startPct = ((n.start - t0) / span) * 100;
      const endVal = n.end || (n.start + 1);
      const durPct = ((endVal - n.start) / span) * 100;

      const durText = formatDuration(n.durationMs);

      let indentHtml = "";
      for (let j = 0; j < depth; j++) {
        indentHtml += `<div class="tree-line-indent"></div>`;
      }

      const activeClass = L().selectedId === n.requestId ? " active" : "";
      
      const hasChildren = n.children && n.children.length > 0;
      const isCollapsed = L().collapsedIds.has(nodeId);
      let caretHtml = "";
      if (hasChildren) {
        caretHtml = `<span class="trace-caret${isCollapsed ? " collapsed" : ""}" data-rid="${n.requestId}">${isCollapsed ? "▶" : "▼"}</span>`;
      } else {
        caretHtml = `<span class="trace-caret-placeholder"></span>`;
      }

      let errBadge = "";
      if (n.status === "failed" && n.error) {
        const shortErr = n.error.length > 20 ? n.error.slice(0, 20) + "..." : n.error;
        errBadge = `<span class="inline-error-badge" title="${esc(n.error)}">${esc(shortErr)}</span>`;
      }

      let originBadge = "";
      if (n.origin === "parent") {
        originBadge = `<span class="origin-badge parent-origin" title="ค้นหาต่อเนื่องแบบ Parent (Parent workflow crawled dynamically)">↱ P</span>`;
      } else if (n.origin === "child") {
        originBadge = `<span class="origin-badge child-origin" title="ค้นหาต่อเนื่องแบบ Sibling (Sibling/Child workflow crawled dynamically)">↳ S</span>`;
      }

      html += `
        <div class="trace-row${activeClass}" data-rid="${n.requestId}">
          <div class="trace-tree-col">
            ${indentHtml}
            ${caretHtml}
            <span class="status-bullet ${n.status}"></span>
            <span class="workflow-name" style="font-weight:600;">${esc(n.workflowName)}</span>
            ${originBadge}
            ${errBadge}
          </div>
          <div class="trace-timeline-col">
            <div class="trace-gantt-track">
              <div class="trace-bar ${n.status}" style="left: ${startPct}%; width: ${Math.max(0.6, durPct)}%;"></div>
              <span class="trace-dur-text" style="left: calc(${startPct + durPct}% + 8px);">${esc(durText)}</span>
            </div>
          </div>
        </div>`;

      if (n.children && n.children.length > 0) {
        const sortedChildren = n.children
          .map(cid => graph.byId.get(cid))
          .filter(Boolean)
          .sort((a, b) => (a.start || 0) - (b.start || 0));
        for (const child of sortedChildren) {
          renderRow(child.requestId, depth + 1, isHidden || isCollapsed);
        }
      }
    }

    const rootNodes = graph.roots
      .map(rid => graph.byId.get(rid))
      .filter(Boolean)
      .sort((a, b) => (a.start || 0) - (b.start || 0));

    let isFirstRoot = true;
    for (const rn of rootNodes) {
      isFirstRoot = false;
      renderRow(rn.requestId, 0, false);
    }

    for (const n of graph.nodes) {
      if (!visited.has(n.requestId)) {
        isFirstRoot = false;
        renderRow(n.requestId, 0, false);
      }
    }

    html += `
        </div>
      </div>`;

    host.innerHTML = html;

    if (L().selectedId) {
      setTimeout(() => {
        const activeRow = host.querySelector(`.trace-row.active`);
        if (activeRow) {
          activeRow.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        }
      }, 0);
    }

    // Ruler setup
    const viewer = host.querySelector(".trace-viewer");
    if (viewer) {
      const ruler = document.createElement("div");
      ruler.className = "trace-ruler";
      ruler.style.display = "none";
      
      const rulerLabel = document.createElement("span");
      rulerLabel.className = "trace-ruler-label";
      ruler.appendChild(rulerLabel);
      
      viewer.appendChild(ruler);
      
      viewer.addEventListener("mousemove", (e) => {
        const rect = viewer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const treeCol = viewer.querySelector(".trace-tree-col");
        const treeColWidth = treeCol ? treeCol.offsetWidth : 400;
        const timelineWidth = viewer.clientWidth - treeColWidth;
        
        if (x >= treeColWidth && timelineWidth > 0) {
          ruler.style.display = "block";
          ruler.style.left = x + "px";
          
          // Dynamically position the label below the sticky header based on scroll position
          const canvas = viewer.closest(".diagram-canvas");
          const scrollTop = canvas ? canvas.scrollTop : 0;
          rulerLabel.style.top = (scrollTop + 48) + "px";
          
          const relX = x - treeColWidth;
          const pct = Math.max(0, Math.min(1, relX / timelineWidth));
          const timeAtCursor = t0 + pct * span;
          rulerLabel.textContent = formatTimeShort(timeAtCursor);
          
          if (pct > 0.85) {
            rulerLabel.style.left = "auto";
            rulerLabel.style.right = "8px";
          } else {
            rulerLabel.style.left = "8px";
            rulerLabel.style.right = "auto";
          }
        } else {
          ruler.style.display = "none";
        }
      });
      
      viewer.addEventListener("mouseleave", () => {
        ruler.style.display = "none";
      });
      
      const headerTreeCol = viewer.querySelector(".trace-header-row .trace-tree-col");
      if (headerTreeCol && window.ResizeObserver) {
        // Only restore inline width if user previously resized
        if (window.liveTreeColWidth) {
          headerTreeCol.style.width = window.liveTreeColWidth;
        }

        const ro = new ResizeObserver((entries) => {
          for (let entry of entries) {
            // Only update if the user actually dragged the resize handle (which sets inline style.width)
            if (entry.target.style.width) {
              const newWidth = entry.target.style.width;
              window.liveTreeColWidth = newWidth;
              viewer.style.setProperty('--tree-col-width', newWidth);
            }
          }
        });
        ro.observe(headerTreeCol);
      }
    }

    // Caret click setup
    host.querySelectorAll(".trace-caret").forEach((c) => {
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        const rid = c.dataset.rid;
        if (L().collapsedIds.has(rid)) {
          L().collapsedIds.delete(rid);
        } else {
          L().collapsedIds.add(rid);
        }
        if (L().onCollapseToggle) L().onCollapseToggle();
      });
    });

    // Search filter input setup
    const filterInput = host.querySelector(".trace-filter-input");
    const filterTypeSelect = host.querySelector(".trace-filter-type");
    const countEl = host.querySelector(".trace-filter-count");
    const prevBtn = host.querySelector(".trace-filter-prev");
    const nextBtn = host.querySelector(".trace-filter-next");

    // Match navigation state (rebuilt on every applyFilter)
    let matchedRows = [];
    if (L().filterMatchIndex === undefined) {
      L().filterMatchIndex = -1;
    }

    function updateCount() {
      const total = matchedRows.length;
      const hasText = !!(L().filterText || "");
      if (prevBtn) prevBtn.disabled = total === 0;
      if (nextBtn) nextBtn.disabled = total === 0;
      if (!countEl) return;
      if (!hasText) { countEl.textContent = ""; return; }
      const cur = L().filterMatchIndex >= 0 ? L().filterMatchIndex + 1 : 0;
      countEl.textContent = `${cur}/${total}`;
      countEl.classList.toggle("no-match", total === 0);
    }

    function gotoMatch(dir) {
      if (matchedRows.length === 0) return;
      matchedRows.forEach((r) => r.classList.remove("filter-current"));
      if (L().filterMatchIndex === -1) {
        L().filterMatchIndex = dir > 0 ? 0 : matchedRows.length - 1;
      } else {
        L().filterMatchIndex = (L().filterMatchIndex + dir + matchedRows.length) % matchedRows.length;
      }
      const row = matchedRows[L().filterMatchIndex];
      row.classList.add("filter-current");
      // Scroll ONLY the diagram canvas — never use row.scrollIntoView(), which
      // bubbles up and scrolls the window, pushing the diagram header off-screen
      // (and the scroll persists across mode switches).
      const cRect = host.getBoundingClientRect();
      const rRect = row.getBoundingClientRect();
      const delta = (rRect.top - cRect.top) - (host.clientHeight / 2) + (rRect.height / 2);
      host.scrollTo({ top: Math.max(0, host.scrollTop + delta), behavior: "smooth" });
      updateCount();
    }

    function applyFilter() {
      const text = L().filterText || "";
      const type = L().filterType || "workflow";
      const rows = host.querySelectorAll(".trace-row");
      
      if (filterInput) {
        const placeholders = {
          workflow: "Filter workflows...",
          step: "Filter step names...",
          requestId: "Filter Request IDs...",
          table: "Filter tables...",
          field: "Filter fields...",
          input: "Filter inputs...",
          output: "Filter outputs...",
          value: "Filter values..."
        };
        filterInput.placeholder = placeholders[type] || "Filter...";
      }

      if (text !== (L().lastFilterText || "") || type !== (L().lastFilterType || "workflow")) {
        L().filterMatchIndex = -1;
        L().lastFilterText = text;
        L().lastFilterType = type;
      }

      matchedRows = [];
      const hasText = !!text;
      host.querySelectorAll(".trace-row.filter-current").forEach((r) => r.classList.remove("filter-current"));

      rows.forEach(row => {
        const rid = row.dataset.rid;
        const n = graph.byId.get(rid);
        if (!n) return;

        let match = false;
        if (!text) {
          match = true;
        } else {
          if (type === "workflow") {
            const name = n.workflowName ? n.workflowName.toLowerCase() : "";
            match = name.includes(text);
          } else if (type === "step") {
            const rawObj = n.raw || {};
            const r = rawObj.Request || {};
            const steps = rawObj.ProcessItems || r.ProcessItems || rawObj.Steps || r.Steps || rawObj.ActivitySteps || [];
            match = steps.some(step => {
              const stepName = step.Name || step.StepName || step.ActivityName || step.NodeName || "";
              const activityId = step.ActivityId || step.StepId || step.NodeId || "";
              return stepName.toLowerCase().includes(text) || activityId.toLowerCase().includes(text);
            });
          } else if (type === "requestId") {
            const reqId = n.requestId ? n.requestId.toLowerCase() : "";
            match = reqId.includes(text);
          } else if (type === "table") {
            const staticWfs = typeof L().getWorkflows === "function" ? L().getWorkflows() : [];
            const staticWf = staticWfs.find(w => w.name === n.workflowName);
            const dbOps = (staticWf && staticWf.dbOperations) || [];
            match = dbOps.some(op => op.table && op.table.toLowerCase().includes(text));
          } else if (type === "field") {
            const staticWfs = typeof L().getWorkflows === "function" ? L().getWorkflows() : [];
            const staticWf = staticWfs.find(w => w.name === n.workflowName);
            const inpFields = (staticWf && staticWf.dataContext && staticWf.dataContext.inputFields) || [];
            const reqFields = (staticWf && staticWf.dataContext && staticWf.dataContext.requiredFields) || [];
            let inStatic = inpFields.some(f => f.toLowerCase().includes(text)) || 
                           reqFields.some(f => f.toLowerCase().includes(text));
            
            if (inStatic) {
              match = true;
            } else {
              const liveInput = extractPayload(n.raw, ["Input", "Variables", "WorkflowInputJson", "workflowInputJson"]);
              const liveOutput = extractPayload(n.raw, ["Output", "Result", "WorkflowOutputJson", "workflowOutputJson"]);
              const globalVars = extractPayload(n.raw, ["GlobalVariablesJson", "GlobalVariables"]);
              match = hasKeyRecursive(liveInput, text) || hasKeyRecursive(liveOutput, text) || hasKeyRecursive(globalVars, text);
            }
          } else if (type === "input") {
            const liveInput = extractPayload(n.raw, ["Input", "Variables", "WorkflowInputJson", "workflowInputJson"]);
            if (liveInput !== null) {
              const inputStr = typeof liveInput === "string" ? liveInput : JSON.stringify(liveInput);
              match = inputStr.toLowerCase().includes(text);
            }
          } else if (type === "output") {
            const liveOutput = extractPayload(n.raw, ["Output", "Result", "WorkflowOutputJson", "workflowOutputJson"]);
            if (liveOutput !== null) {
              const outputStr = typeof liveOutput === "string" ? liveOutput : JSON.stringify(liveOutput);
              match = outputStr.toLowerCase().includes(text);
            }
          } else if (type === "value") {
            const liveInput = extractPayload(n.raw, ["Input", "Variables", "WorkflowInputJson", "workflowInputJson"]);
            const liveOutput = extractPayload(n.raw, ["Output", "Result", "WorkflowOutputJson", "workflowOutputJson"]);
            const globalVars = extractPayload(n.raw, ["GlobalVariablesJson", "GlobalVariables"]);
            
            let inPayloads = hasValueRecursive(liveInput, text) || hasValueRecursive(liveOutput, text) || hasValueRecursive(globalVars, text);
            
            let inTags = false;
            const rawObj = n.raw || {};
            const rawTags = rawObj.Tags || (rawObj.Request && rawObj.Request.Tags);
            if (Array.isArray(rawTags)) {
              inTags = rawTags.some(t => t && t.Value && String(t.Value).toLowerCase().includes(text));
            } else if (rawTags && typeof rawTags === "object") {
              inTags = Object.values(rawTags).some(v => String(v).toLowerCase().includes(text));
            }
            const req = rawObj.Request || {};
            if (req.ApplicationId && String(req.ApplicationId).toLowerCase().includes(text)) inTags = true;
            if (req.OpLoansId && String(req.OpLoansId).toLowerCase().includes(text)) inTags = true;
            
            const inError = n.error && n.error.toLowerCase().includes(text);
            
            match = inPayloads || inTags || inError;
          }
        }
        
        if (match) {
          row.classList.remove("dimmed");
          if (hasText) matchedRows.push(row);
        } else {
          row.classList.add("dimmed");
        }
      });

      if (hasText && L().filterMatchIndex >= 0 && L().filterMatchIndex < matchedRows.length) {
        const row = matchedRows[L().filterMatchIndex];
        row.classList.add("filter-current");
        // Scroll to it on initial restoration
        if (L().shouldScrollToMatch) {
          setTimeout(() => {
            const cRect = host.getBoundingClientRect();
            const rRect = row.getBoundingClientRect();
            const delta = (rRect.top - cRect.top) - (host.clientHeight / 2) + (rRect.height / 2);
            host.scrollTo({ top: Math.max(0, host.scrollTop + delta), behavior: "auto" });
          }, 50);
          L().shouldScrollToMatch = false;
        }
      }

      updateCount();
    }

    if (filterInput && filterTypeSelect) {
      filterInput.value = L().filterText || "";
      filterTypeSelect.value = L().filterType || "workflow";
      
      filterInput.addEventListener("input", (e) => {
        L().filterText = e.target.value.trim().toLowerCase();
        applyFilter();
      });
      
      filterTypeSelect.addEventListener("change", (e) => {
        L().filterType = e.target.value;
        applyFilter();
      });
      
      filterInput.addEventListener("click", (e) => e.stopPropagation());
      filterTypeSelect.addEventListener("click", (e) => e.stopPropagation());

      if (prevBtn) prevBtn.addEventListener("click", (e) => { e.stopPropagation(); gotoMatch(-1); });
      if (nextBtn) nextBtn.addEventListener("click", (e) => { e.stopPropagation(); gotoMatch(1); });
      // Enter = next match, Shift+Enter = previous match
      filterInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
      });

      // Focus/initial state restoration
      applyFilter();
      if (L().filterText) {
        filterInput.focus();
      }
    }
    
    host.querySelectorAll(".trace-row").forEach((r) => {
      r.addEventListener("click", () => {
        const clickedIndex = matchedRows.indexOf(r);
        if (clickedIndex >= 0) {
          L().filterMatchIndex = clickedIndex;
        } else {
          L().filterMatchIndex = -1;
        }
        host.querySelectorAll(".trace-row.filter-current").forEach((row) => row.classList.remove("filter-current"));
        r.classList.add("filter-current");
        L().onSelect && L().onSelect(r.dataset.rid);
      });
    });
  }

  function formatTimeShort(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
  }

  function formatDuration(ms) {
    if (ms == null) return "?";
    if (ms < 1000) return ms + "ms";
    const sec = ms / 1000;
    if (sec < 60) return sec.toFixed(1) + "s";
    const min = Math.floor(sec / 60);
    const remSec = Math.round(sec % 60);
    return min + "m " + remSec + "s";
  }

  function renderTree(graph, host) {
    host.innerHTML = "";
    if (!graph.nodes.length) { host.innerHTML = '<div class="empty-state">No process data</div>'; return; }
    // assign depth via BFS from roots; nodes unreachable from a root start at 0
    const depth = new Map();
    const queue = graph.roots.map((r) => [r, 0]);
    while (queue.length) {
      const [id, d] = queue.shift();
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const c of graph.byId.get(id).children) queue.push([c, d + 1]);
    }
    graph.nodes.forEach((n) => { if (!depth.has(n.requestId)) depth.set(n.requestId, 0); });
    // group by depth (column) and stack within a column (row)
    const cols = new Map();
    [...depth.entries()].sort((a, b) => a[1] - b[1]).forEach(([id, d]) => {
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d).push(id);
    });
    const COLW = 240, ROWH = 60, NW = 200, NH = 34, PAD = 20;
    const pos = new Map();
    let maxRows = 0;
    for (const [d, ids] of cols) { maxRows = Math.max(maxRows, ids.length);
      ids.forEach((id, i) => pos.set(id, { x: PAD + d * COLW, y: PAD + i * ROWH })); }
    const W = PAD * 2 + cols.size * COLW, H = PAD * 2 + maxRows * ROWH;
    let svg = `<svg class="diagram-svg live-tree-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`;
    // edges
    for (const n of graph.nodes) for (const c of n.children) {
      const p = pos.get(n.requestId), q = pos.get(c); if (!p || !q) continue;
      svg += `<path d="M${p.x + NW} ${p.y + NH / 2} H${(p.x + NW + q.x) / 2} V${q.y + NH / 2} H${q.x}" fill="none" stroke="#3a4a6b" stroke-width="1.5"/>`;
    }
    // nodes
    for (const n of graph.nodes) {
      const p = pos.get(n.requestId); if (!p) continue;
      const isSelected = L().selectedId === n.requestId;
      const isRoot = graph.roots.includes(n.requestId);
      let strokeColor = "#3a4a6b";
      let strokeWidth = "1";
      if (isSelected) {
        strokeColor = "#ff9f00";
        strokeWidth = "3";
      } else if (isRoot) {
        strokeColor = "#5fd38a";
        strokeWidth = "2";
      }
      svg += `<g class="live-tree-node${isSelected ? ' active' : ''}" data-rid="${esc(n.requestId)}">`;
      svg += `<title>${esc(n.workflowName)} — ${esc(n.status)}</title>`;
      svg += `<rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="6" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="#1e2740"/>`;
      svg += `<circle cx="${p.x + 12}" cy="${p.y + NH / 2}" r="4" fill="${n.status === "failed" ? "#c0392b" : "#2f9e62"}"/>`;
      svg += `<text x="${p.x + 24}" y="${p.y + 21}" fill="#cdd7ea" font-size="11">${esc(n.workflowName.slice(0, 24))}</text>`;
      svg += `</g>`;
    }
    svg += `</svg>`;
    host.innerHTML = svg;

    if (L().selectedId) {
      setTimeout(() => {
        const activeNode = host.querySelector(`.live-tree-node.active`);
        if (activeNode) {
          activeNode.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
        }
      }, 0);
    }

    host.querySelectorAll(".live-tree-node").forEach((g) =>
      g.addEventListener("click", () => L().onSelect && L().onSelect(g.dataset.rid)));
  }

  const api = {
    renderGantt,
    renderTree,
    onSelect: null,
    selectedId: null,
    formatDuration,
    collapsedIds: new Set(),
    onCollapseToggle: null,
    filterText: "",
    filterType: "workflow",
    filterMatchIndex: -1,
    lastFilterText: "",
    lastFilterType: "workflow",
    shouldScrollToMatch: true
  };
  root.WorkflowLive = Object.assign(root.WorkflowLive || {}, api);
})(window);
