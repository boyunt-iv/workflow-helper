(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.AnalyzerNavigation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const HANDOFF_PARAM = "indexHandoff";

  function isHttps(locationLike) {
    return String(locationLike?.protocol || "").toLowerCase() === "https:";
  }

  function requestsNewTab(event) {
    return Boolean(event?.ctrlKey || event?.metaKey || event?.button === 1);
  }

  function shouldOpenNewTab(event, locationLike) {
    return isHttps(locationLike) && requestsNewTab(event);
  }

  function buildTargetUrl(currentHref, kind, name, handoffToken = "") {
    const url = new URL(currentHref);
    if (kind === "workflow") {
      url.searchParams.set("workflow", name);
      url.searchParams.delete("zbo");
    } else if (kind === "zbo") {
      url.searchParams.set("zbo", name);
      url.searchParams.delete("workflow");
    } else {
      throw new Error(`Unsupported analyzer navigation kind: ${kind}`);
    }

    if (handoffToken) {
      url.searchParams.set(HANDOFF_PARAM, handoffToken);
    } else {
      url.searchParams.delete(HANDOFF_PARAM);
    }
    return url.href;
  }

  function readTarget(currentHref) {
    const url = new URL(currentHref);
    const workflow = url.searchParams.get("workflow");
    if (workflow) return { kind: "workflow", name: workflow };
    const zbo = url.searchParams.get("zbo");
    if (zbo) return { kind: "zbo", name: zbo };
    return null;
  }

  function readHandoffToken(currentHref) {
    return new URL(currentHref).searchParams.get(HANDOFF_PARAM) || "";
  }

  function removeHandoffToken(currentHref) {
    const url = new URL(currentHref);
    url.searchParams.delete(HANDOFF_PARAM);
    return url.href;
  }

  return {
    HANDOFF_PARAM,
    buildTargetUrl,
    isHttps,
    readHandoffToken,
    readTarget,
    removeHandoffToken,
    requestsNewTab,
    shouldOpenNewTab,
  };
});
