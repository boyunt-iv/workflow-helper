(function (root) {
  "use strict";

  function buildProcessGraph(records, opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 10000;
    const valid = (records || []).filter((r) => r && r.requestId);
    const byId = new Map();
    for (const rec of valid) {
      if (byId.has(rec.requestId)) continue;
      if (byId.size >= maxNodes) break;
      byId.set(rec.requestId, Object.assign({}, rec, { children: [] }));
    }
    const nodes = [...byId.values()];
    for (const n of nodes) {
      if (n.parentRequestId && n.parentRequestId !== n.requestId && byId.has(n.parentRequestId)) {
        byId.get(n.parentRequestId).children.push(n.requestId);
        n.hasParentInSet = true;
      } else {
        n.hasParentInSet = false;
      }
    }
    const roots = nodes.filter((n) => !n.hasParentInSet).map((n) => n.requestId);
    const timeline = [...nodes].sort((a, b) => (a.start || 0) - (b.start || 0));
    const truncated = byId.size < dedupCount(valid);
    return { byId, nodes, roots, timeline, truncated, count: nodes.length };
  }

  function dedupCount(records) {
    const seen = new Set();
    for (const r of records) seen.add(r.requestId);
    return seen.size;
  }

  const api = { buildProcessGraph };
  root.WorkflowLive = Object.assign(root.WorkflowLive || {}, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
