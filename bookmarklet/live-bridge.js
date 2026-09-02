// Source of the Live Bridge bookmarklet. Runs in the console (Keycloak) origin.
// install.html turns this into a comment-free, single-line javascript: URL.
function liveBridge() {
  function findToken() {
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const v = store.getItem(store.key(i));
          if (!v || v.indexOf("access_token") < 0) continue;
          try { const o = JSON.parse(v); if (o && o.access_token) return o.access_token; } catch (e) {}
        }
      }
    } catch (e) {}
    if (window.keycloak && window.keycloak.token) return window.keycloak.token;
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = 0; i < store.length; i++) {
          const m = (store.getItem(store.key(i)) || "").match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
          if (m) return m[0];
        }
      }
    } catch (e) {}
    return null;
  }
  const opener = window.opener;
  if (!opener) { alert("Live Bridge: open the analyzer's console window FIRST, then click this."); return; }
  let token = findToken();
  let allowedOrigins = [];
  const origFetch = window.fetch.bind(window);
  const send = (t) => opener.postMessage({ type: "BRIDGE_TOKEN", token: t, origin: location.origin }, "*");
  if (token) send(token);
  window.fetch = function (input, init) {
    try {
      const h = (init && init.headers) || (input && input.headers);
      let auth = h && (h.get ? h.get("authorization") : (h.authorization || h.Authorization));
      if (auth && /Bearer /.test(auth)) { const t = auth.replace("Bearer ", ""); if (t !== token) { token = t; send(t); } }
    } catch (e) {}
    return origFetch(input, init);
  };
  window.addEventListener("message", async (ev) => {
    if (ev.source !== opener) return;
    const m = ev.data; if (!m) return;
    if (m.type === "BRIDGE_CONFIG") {
      allowedOrigins = Array.isArray(m.allowedOrigins)
        ? m.allowedOrigins.filter((origin) => {
          try {
            const parsed = new URL(origin);
            return parsed.protocol === "https:" && parsed.origin === origin;
          } catch (e) {
            return false;
          }
        })
        : [];
      return;
    }
    if (m.type !== "BRIDGE_FETCH") return;
    let requestOrigin = "";
    try { requestOrigin = new URL(m.url).origin; } catch (e) {}
    if (!allowedOrigins.includes(requestOrigin)) { ev.source.postMessage({ type: "BRIDGE_RESULT", reqId: m.reqId, ok: false, status: 0, error: "blocked host" }, "*"); return; }
    try {
      const r = await origFetch(m.url, { headers: { authorization: "Bearer " + token, accept: "application/json, text/plain, */*", zworkspace: "default" } });
      const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
      ev.source.postMessage({ type: "BRIDGE_RESULT", reqId: m.reqId, ok: r.ok, status: r.status, json, raw: json ? null : text }, "*");
    } catch (err) {
      ev.source.postMessage({ type: "BRIDGE_RESULT", reqId: m.reqId, ok: false, status: 0, error: String(err) }, "*");
    }
  });
  alert("Live Bridge active" + (token ? " (token captured)" : " (no token yet — click anything in the portal)"));
}
if (typeof module !== "undefined" && module.exports) module.exports = { liveBridge };
