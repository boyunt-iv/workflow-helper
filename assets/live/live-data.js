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
        total: json.length
      };
    }
    const items = json && Array.isArray(json.Items) ? json.Items.map(normalizeProcess) : [];
    const total = json && json.Metadata && typeof json.Metadata.TotalItems === "number"
      ? json.Metadata.TotalItems : items.length;
    return { items, total };
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
    if (opts.fromDate) p.set("fromDate", opts.fromDate);
    if (opts.toDate) p.set("toDate", opts.toDate);
    if (opts.parentRequestId) p.set("parentRequestId", opts.parentRequestId);
    return msBase.replace(/\/+$/, "") + "/runtime/api/report/process?" + p.toString();
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

  const api = { normalizeProcess, normalizeResponse, buildProcessUrl, buildTraceExportFileName };
  root.WorkflowLive = Object.assign(root.WorkflowLive || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
