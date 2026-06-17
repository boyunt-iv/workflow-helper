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

  function normalizeMatchValue(value) {
    return value == null ? "" : String(value).toLowerCase().trim();
  }

  function normalizeDecisionMatrixValue(value) {
    if (value === null || value === undefined) return "";
    let normalized = value;
    for (let i = 0; i < 2; i++) {
      if (typeof normalized !== "string") break;
      const trimmed = normalized.trim();
      if (!trimmed) return "";
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        try {
          normalized = JSON.parse(trimmed);
          continue;
        } catch (_) {
          normalized = trimmed.slice(1, -1);
          continue;
        }
      }
      break;
    }
    return typeof normalized === "string" ? normalized.trim() : normalized;
  }

  function normalizeDecisionMatrixComparable(value) {
    const normalized = normalizeDecisionMatrixValue(value);
    return typeof normalized === "string" ? normalized.toLowerCase() : String(normalized).toLowerCase();
  }

  function isDecisionMatrixWildcard(value) {
    const normalized = normalizeDecisionMatrixComparable(value);
    return normalized === "" || normalized === "-";
  }

  function decisionMatrixValuesEqual(actual, expected) {
    if (isDecisionMatrixWildcard(expected)) return true;
    return normalizeDecisionMatrixComparable(actual) === normalizeDecisionMatrixComparable(expected);
  }

  function findKeyValueRecursive(obj, searchKey) {
    if (obj === null || obj === undefined || typeof obj !== "object") return undefined;

    const keyLower = String(searchKey || "").toLowerCase();
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase() === keyLower) return obj[key];
    }

    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const value of values) {
      const found = findKeyValueRecursive(value, searchKey);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function getDecisionMatrixOutputPayload(liveOutputObj) {
    if (!liveOutputObj || typeof liveOutputObj !== "object") return liveOutputObj;
    const runtimeOutput = findKeyValueRecursive(liveOutputObj, "RuntimeOutput");
    return runtimeOutput && typeof runtimeOutput === "object" ? runtimeOutput : liveOutputObj;
  }

  function evaluateDecisionMatrixExpression(expr, context) {
    try {
      if (!expr || !String(expr).trim()) return false;
      const reservedWords = new Set([
        "break", "case", "catch", "class", "const", "continue", "debugger", "default",
        "delete", "do", "else", "export", "extends", "finally", "for", "function",
        "if", "import", "in", "instanceof", "let", "new", "return", "super",
        "switch", "this", "throw", "try", "typeof", "var", "void", "while",
        "with", "yield", "true", "false", "null", "undefined",
      ]);
      const keys = [];
      const vals = [];
      for (const [key, value] of Object.entries(context || {})) {
        const normalizedKey = key.toLowerCase();
        if (!/^[a-z_$][a-z0-9_$]*$/i.test(normalizedKey) || reservedWords.has(normalizedKey)) {
          continue;
        }
        keys.push(normalizedKey);
        vals.push(typeof value === "string" ? value.trim().toLowerCase() : value);
      }
      const normalized = String(expr)
        .toLowerCase()
        .replace(/\bor\b/g, " || ")
        .replace(/\band\b/g, " && ");
      return Boolean(new Function(...keys, `return (${normalized});`)(...vals));
    } catch (_) {
      return false;
    }
  }

  function buildDecisionMatrixContext(columns, liveOutputObj, liveInputObj, globalVarsObj) {
    const context = {};
    (columns || []).forEach((column) => {
      if (isDecisionMatrixOutputColumn(column)) return;
      let value = undefined;
      if (liveInputObj) value = findKeyValueRecursive(liveInputObj, column.id);
      if (value === undefined && globalVarsObj) value = findKeyValueRecursive(globalVarsObj, column.id);
      context[column.id] = normalizeDecisionMatrixValue(value);
    });
    return context;
  }

  function isDecisionMatrixOutputColumn(column) {
    const use = String(column?.use || "").toLowerCase();
    return use.includes("output") || use.includes("result");
  }

  function doesDecisionMatrixRowMatch(columns, row, liveOutputObj, liveInputObj, globalVarsObj) {
    if (!row || !Array.isArray(row.values)) return false;
    if (!liveInputObj && !globalVarsObj) return false;

    const context = buildDecisionMatrixContext(columns, liveOutputObj, liveInputObj, globalVarsObj);
    let inputChecked = false;
    let inputMatch = true;

    (columns || []).forEach((column) => {
      const cell = row.values.find((value) => value.column === column.id);
      if (!cell) return;

      if (isDecisionMatrixOutputColumn(column)) return;

      const cellValue = cell.expression || (cell.value ?? "");
      const normalizedCellValue = normalizeDecisionMatrixValue(cellValue);

      if (!liveInputObj && !globalVarsObj) return;
      inputChecked = true;
      if (isDecisionMatrixWildcard(normalizedCellValue)) return;
      if (cell.expression) {
        if (!evaluateDecisionMatrixExpression(cell.expression, context)) inputMatch = false;
        return;
      }
      let actualValue = liveInputObj ? findKeyValueRecursive(liveInputObj, column.id) : undefined;
      if (actualValue === undefined && globalVarsObj) actualValue = findKeyValueRecursive(globalVarsObj, column.id);
      if (actualValue === undefined || !decisionMatrixValuesEqual(actualValue, normalizedCellValue)) {
        inputMatch = false;
      }
    });

    if (!inputChecked) return false;
    return inputMatch;
  }

  function matchesWorkflowNodeStep(node, step) {
    if (!node || !step) return false;
    const nodeId = normalizeMatchValue(node.id);
    const callName = normalizeMatchValue(node.callName);
    const stepName = normalizeMatchValue(
      step.Name || step.StepName || step.ActivityName || step.NodeName,
    );
    const activityId = normalizeMatchValue(
      step.ActivityId || step.StepId || step.NodeId,
    );

    return (
      stepName === nodeId ||
      activityId === nodeId ||
      (callName && stepName === callName) ||
      (callName && activityId === callName)
    );
  }

  function getNodeExecutionCount(node, steps) {
    if (!node || !Array.isArray(steps)) return 0;
    return steps.reduce(
      (count, step) => count + (matchesWorkflowNodeStep(node, step) ? 1 : 0),
      0,
    );
  }

  return {
    extractPayload,
    decisionMatrixValuesEqual,
    doesDecisionMatrixRowMatch,
    evaluateDecisionMatrixExpression,
    findWorkflowEntryNode,
    findKeyValueRecursive,
    getDecisionMatrixOutputPayload,
    getNodeExecutionCount,
    getProcessContext,
    isDecisionMatrixWildcard,
    matchesWorkflowNodeStep,
    normalizeDecisionMatrixValue,
    parseMaybeJson,
  };
});
