(function (root) {
  "use strict";

  function normalizeProcess(item) {
    const r = (item && item.Request) || {};
    const reqStart = r.RequestDateTime ? Date.parse(r.RequestDateTime) : null;
    const reqEnd = r.ResponseDateTime ? Date.parse(r.ResponseDateTime) : null;
    
    const itemStart = item && item.RequestDateTime ? Date.parse(item.RequestDateTime) : null;
    const itemEnd = item && item.ResponseDateTime ? Date.parse(item.ResponseDateTime) : null;
    
    const start = Number.isFinite(reqStart) ? reqStart : (Number.isFinite(itemStart) ? itemStart : null);
    const end = Number.isFinite(reqEnd) ? reqEnd : (Number.isFinite(itemEnd) ? itemEnd : null);
    
    const ver = r.WorkflowConfigurationVersion !== undefined ? r.WorkflowConfigurationVersion : (item && item.WorkflowConfigurationVersion);
    const rev = r.WorkflowConfigurationRevision !== undefined ? r.WorkflowConfigurationRevision : (item && item.WorkflowConfigurationRevision);
    
    const steps = (item && (item.ProcessItems || item.Steps || item.ActivitySteps)) || (r && (r.ProcessItems || r.Steps)) || [];
    
    return {
      requestId: r.RequestId || (item && item.RequestId) || null,
      parentRequestId: r.ParentRequestId || (item && item.ParentRequestId) || null,
      workflowName: r.WorkflowName || (item && item.WorkflowName) || "(unknown)",
      workflowType: r.WorkflowType || (item && item.WorkflowType) || null,
      start: start,
      end: end,
      durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
      status: item && item.IsFailed ? "failed" : (item && item.IsCompleted ? "completed" : "unknown"),
      error: r.ErrorDescription || (item && item.ErrorDescription) || null,
      depth: typeof r.Depth === "number" ? r.Depth : (typeof (item && item.Depth) === "number" ? item.Depth : 0),
      version: ver != null && rev != null ? ver + "/" + rev : null,
      detailLoaded: steps.length > 0,
      raw: item || null,
    };
  }

  function normalizeResponse(json) {
    if (Array.isArray(json)) {
      return {
        items: json.map(x => {
          if (x && x.requestId && x.workflowName) {
            const steps = (x.raw && (x.raw.ProcessItems || x.raw.Steps || x.raw.ActivitySteps)) || [];
            return {
              requestId: x.requestId,
              parentRequestId: x.parentRequestId || null,
              workflowName: x.workflowName,
              workflowType: x.workflowType || null,
              start: typeof x.start === "number" ? x.start : (x.start ? Date.parse(x.start) : null),
              end: typeof x.end === "number" ? x.end : (x.end ? Date.parse(x.end) : null),
              durationMs: typeof x.durationMs === "number" ? x.durationMs : null,
              status: x.status || "unknown",
              error: x.error || null,
              depth: typeof x.depth === "number" ? x.depth : 0,
              version: x.version || null,
              detailLoaded: x.detailLoaded || steps.length > 0,
              raw: x.raw || x
            };
          }
          const raw = x.raw || x;
          const norm = normalizeProcess(raw);
          if (x.detailLoaded) {
            norm.detailLoaded = true;
          }
          return norm;
        }),
        total: json.length,
        pagination: {
          currentPage: null,
          pageSize: json.length,
          totalItems: null
        }
      };
    }
    const items = json && Array.isArray(json.Items) ? json.Items.map(normalizeProcess) : [];
    const metadata = (json && (json.Metadata || json.metadata)) || {};
    const numberOrNull = (value) => {
      if (value == null || value === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const totalItems = numberOrNull(metadata.TotalItems ?? metadata.totalItems);
    const currentPage = numberOrNull(metadata.CurrentPage ?? metadata.currentPage);
    const pageSize = numberOrNull(metadata.PageSize ?? metadata.pageSize);
    return {
      items,
      total: totalItems == null ? items.length : totalItems,
      pagination: { currentPage, pageSize, totalItems }
    };
  }

  function hasMoreProcessPages(response, options) {
    response = response || {};
    options = options || {};

    const newItemCount = Number(options.newItemCount) || 0;
    const pagesFetched = Number(options.pagesFetched) || 0;
    const maxPages = Number(options.maxPages) || Infinity;
    if (newItemCount <= 0 || pagesFetched >= maxPages) return false;

    const pagination = response.pagination || {};
    const totalItems = pagination.totalItems == null ? null : Number(pagination.totalItems);
    const currentPage = pagination.currentPage == null ? null : Number(pagination.currentPage);
    const pageSize = pagination.pageSize == null ? null : Number(pagination.pageSize);
    if (totalItems != null && Number.isFinite(totalItems)) {
      if (currentPage != null && pageSize != null
        && Number.isFinite(currentPage) && Number.isFinite(pageSize) && pageSize > 0) {
        return currentPage * pageSize < totalItems;
      }
      const loadedCount = Number(options.loadedCount) || 0;
      return loadedCount < totalItems;
    }

    const effectivePageSize = Number(options.effectivePageSize) || 0;
    return effectivePageSize > 0 && (response.items || []).length === effectivePageSize;
  }

  function buildProcessUrl(msBase, opts) {
    opts = opts || {};
    const p = new URLSearchParams({
      hierarchy: "All", includeWorkspace: "true",
      pageIndex: String(opts.pageIndex || 1), pageSize: String(opts.pageSize || 30),
      refreshId: opts.refreshId || Math.random().toString(36).slice(2, 11),
      workspace: opts.workspace || "default",
      useExternalIdFullMatch: "true", useWorkflowNameFullMatch: "true",
    });
    if (opts.tagKey && opts.tagValue) {
      p.set("tagKey", opts.tagKey);
      p.set("tagValue", opts.tagValue);
    } else if (opts.applicationId) {
      p.set("tagKey", "ApplicationId");
      p.set("tagValue", opts.applicationId);
    }
    if (opts.workflowRequestId) p.set("workflowRequestId", opts.workflowRequestId);
    if (opts.workflowName) p.set("workflowName", opts.workflowName);
    if (opts.status) p.set("status", opts.status);
    if (opts.fromDate) p.set("processItemDateFrom", opts.fromDate);
    if (opts.toDate) p.set("processItemDateTo", opts.toDate);
    if (opts.parentRequestId) p.set("parentRequestId", opts.parentRequestId);
    return msBase.replace(/\/+$/, "") + "/runtime/api/report/process?" + p.toString();
  }

  function hasRequiredProcessFilter(opts) {
    opts = opts || {};
    return Boolean(
      String(opts.workflowRequestId || "").trim()
      || String(opts.workflowName || "").trim()
      || (String(opts.tagKey || "").trim() && String(opts.tagValue || "").trim())
    );
  }

  function extractProcessTags(text) {
    const source = String(text || "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const tags = new Set();
    const addMatches = (pattern, group) => {
      let match;
      while ((match = pattern.exec(source))) {
        const tag = String(match[group] || "").trim();
        if (tag) tags.add(tag);
      }
    };

    addMatches(/\btags\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g, 1);
    addMatches(/\btags\s*\[\s*["']([^"']+)["']\s*\]\s*=/g, 1);

    let objectMatch;
    const objectPattern = /\btags\s*=\s*\{([\s\S]*?)\}/g;
    while ((objectMatch = objectPattern.exec(source))) {
      const body = objectMatch[1];
      const propertyPattern = /(?:^|,)\s*(?:["']([^"']+)["']|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/g;
      let propertyMatch;
      while ((propertyMatch = propertyPattern.exec(body))) {
        const tag = String(propertyMatch[1] || propertyMatch[2] || "").trim();
        if (tag) tags.add(tag);
      }
    }

    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  function getWorkflowProcessTags(workflow) {
    if (!workflow || typeof workflow !== "object") {
      return { known: false, tags: [] };
    }

    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const scripts = nodes.flatMap((node) => [
      node && node.inputScript,
      node && node.outputScript,
      node && node.conditionScript
    ]).filter(Boolean);
    return {
      known: nodes.length > 0,
      tags: extractProcessTags(scripts.join("\n"))
    };
  }

  function getWorkflowTagCompatibility(workflow, tagName) {
    const tagInfo = getWorkflowProcessTags(workflow);
    const wanted = String(tagName || "").trim().toLowerCase();
    return {
      known: tagInfo.known,
      supported: !wanted || tagInfo.tags.some((tag) => tag.toLowerCase() === wanted),
      tags: tagInfo.tags
    };
  }

  function findWorkflowSuggestions(workflows, query, limit) {
    const needle = String(query || "").trim().toLowerCase();
    if (needle.length < 3) return [];
    const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 12;
    return (Array.isArray(workflows) ? workflows : [])
      .map((workflow) => String(workflow && workflow.name || "").trim())
      .filter((name) => name && name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(needle);
        const bStarts = b.toLowerCase().startsWith(needle);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b);
      })
      .slice(0, max);
  }

  function buildTraceExportFileName(tagKey, tagValue, fallback) {
    const safePart = (value) => String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "");

    const key = safePart(tagKey);
    const value = safePart(tagValue);
    const fallbackValue = safePart(fallback) || "export";
    const suffix = key && value ? `${key}_${value}` : (value || fallbackValue);
    return `trace_${suffix}.json`;
  }

  const api = {
    normalizeProcess,
    normalizeResponse,
    hasMoreProcessPages,
    buildProcessUrl,
    hasRequiredProcessFilter,
    extractProcessTags,
    getWorkflowProcessTags,
    getWorkflowTagCompatibility,
    findWorkflowSuggestions,
    buildTraceExportFileName
  };
  root.WorkflowLive = Object.assign(root.WorkflowLive || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
