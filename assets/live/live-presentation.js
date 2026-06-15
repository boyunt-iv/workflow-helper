(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LivePresentation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  function parseMaybeJson(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  function extractPayload(raw, keys) {
    if (!raw) return null;
    for (const key of keys) {
      const value = raw[key] !== undefined ? raw[key] : raw.Request?.[key];
      if (value !== undefined && value !== null) {
        return parseMaybeJson(value);
      }
    }
    return null;
  }

  function getProcessContext(processNode) {
    const raw = processNode?.raw || processNode || {};
    return {
      globalVariables: extractPayload(raw, ["GlobalVariablesJson", "GlobalVariables"]),
      workflowInput: extractPayload(raw, [
        "Input",
        "Variables",
        "WorkflowInputJson",
        "workflowInputJson",
      ]),
    };
  }

  function findWorkflowEntryNode(workflow) {
    const nodes = workflow?.nodes || [];
    if (nodes.length === 0) return null;

    const explicitStart = nodes.find((node) => {
      const type = String(node.type || "").toLowerCase();
      const id = String(node.id || "").toLowerCase();
      return type === "start/message" || type === "startevent" || id.startsWith("start");
    });
    if (explicitStart) return explicitStart;

    const inboundNodeIds = new Set((workflow.edges || []).map((edge) => edge.to));
    return nodes.find((node) => !inboundNodeIds.has(node.id)) || nodes[0];
  }

  return {
    extractPayload,
    findWorkflowEntryNode,
    getProcessContext,
    parseMaybeJson,
  };
});
