(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LiveEnvironment = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  "use strict";

  const SESSION_KEY = "workflowHelper.liveEnvironment.v1";

  function normalizeUrl(value, fieldName) {
    let url;
    try {
      url = new URL(String(value || ""));
    } catch {
      throw new Error(`${fieldName} must be a valid URL.`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`${fieldName} must use HTTPS.`);
    }
    return url.origin;
  }

  function normalizeTags(config) {
    const source = config?.liveApi?.tags;
    if (source === undefined) {
      return {
        defaultTag: "ApplicationId",
        tags: [{
          name: "ApplicationId",
          label: "ApplicationId",
          placeholder: "e.g. 2025130250930024",
        }],
      };
    }
    if (!Array.isArray(source)) {
      throw new Error("liveApi.tags must be an array.");
    }
    if (!source.length) {
      throw new Error("liveApi.tags must contain at least one tag.");
    }

    const names = new Set();
    const tags = source.map((tag, index) => {
      const name = String(tag?.name || "").trim();
      if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
        throw new Error(`liveApi.tags[${index}] has an invalid name.`);
      }
      const normalizedName = name.toLowerCase();
      if (names.has(normalizedName)) {
        throw new Error(`Live API tag "${name}" is duplicated.`);
      }
      names.add(normalizedName);
      return {
        name,
        label: String(tag?.label || name).trim() || name,
        placeholder: String(tag?.placeholder || "").trim(),
      };
    });

    const requestedDefault = String(config?.liveApi?.defaultTag || "").trim();
    const legacyDefault = source.find((tag) => tag?.is_show === true)?.name;
    const defaultTag = tags.find((tag) => tag.name === requestedDefault)?.name
      || tags.find((tag) => tag.name === legacyDefault)?.name
      || tags[0].name;
    return { defaultTag, tags };
  }

  function validate(config) {
    if (!config || !Array.isArray(config.environments) || !config.environments.length) {
      throw new Error("Environment JSON must contain a non-empty environments array.");
    }

    const keys = new Set();
    const environments = config.environments.map((environment, index) => {
      const key = String(environment?.key || "").trim().toLowerCase();
      const label = String(environment?.label || key).trim();
      if (!key || !/^[a-z0-9_-]+$/.test(key)) {
        throw new Error(`Environment ${index + 1} has an invalid key.`);
      }
      if (keys.has(key)) throw new Error(`Environment key "${key}" is duplicated.`);
      keys.add(key);
      return {
        key,
        label: label || key.toUpperCase(),
        msBase: normalizeUrl(environment.msBase, `${key}.msBase`),
        consoleBase: normalizeUrl(environment.consoleBase, `${key}.consoleBase`),
      };
    });

    const requestedDefault = String(config.defaultEnv || "").trim().toLowerCase();
    return {
      schemaVersion: Number(config.schemaVersion) || 1,
      defaultEnv: keys.has(requestedDefault) ? requestedDefault : environments[0].key,
      environments,
      liveApi: normalizeTags(config),
    };
  }

  function apply(config, options = {}) {
    const normalized = validate(config);
    root.ANALYZER_ENV = normalized;
    if (options.persist !== false) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
      } catch {
        // Session persistence is optional.
      }
    }
    if (typeof root.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
      root.dispatchEvent(
        new CustomEvent("workflow-helper-environment", { detail: normalized }),
      );
    }
    return normalized;
  }

  async function loadFile(file) {
    if (!file) throw new Error("Select an environment JSON file.");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("Environment file is not valid JSON.");
    }
    return apply(parsed);
  }

  function restore() {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (!saved) return null;
      return apply(JSON.parse(saved), { persist: false });
    } catch {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // Ignore unavailable session storage.
      }
      return null;
    }
  }

  function clear() {
    delete root.ANALYZER_ENV;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore unavailable session storage.
    }
  }

  restore();
  return { apply, clear, loadFile, restore, validate };
});
