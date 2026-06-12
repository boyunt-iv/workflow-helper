(function (root) {
  "use strict";

  // Legacy plaintext sessionStorage key from the tab-only scheme; cleared on load.
  const LEGACY_SESSION_PASSPHRASE_KEY = "workflowHelper.indexPassphrase.v1";
  // localStorage entry holding the AES-GCM ciphertext of the passphrase.
  const PASSPHRASE_STORE_KEY = "workflowHelper.indexPassphrase.v2";
  // IndexedDB vault holding the non-extractable wrapping key. The key object can
  // be used by this origin's scripts to encrypt/decrypt but cannot be exported,
  // so copying localStorage alone (sync, backup, manual paste) does not reveal
  // the passphrase. It does not defend against scripts running on this origin.
  const VAULT_DB_NAME = "workflowHelperVault";
  const VAULT_STORE_NAME = "keys";
  const VAULT_KEY_ID = "passphraseWrapKey";
  const HANDOFF_TTL_MS = 30_000;
  const gate = document.getElementById("indexGate");
  const gateForm = document.getElementById("indexGateForm");
  const fileInput = document.getElementById("indexFile");
  const passphraseInput = document.getElementById("indexPassphrase");
  const rememberInput = document.getElementById("rememberIndexPassphrase");
  const unlockButton = document.getElementById("unlockIndex");
  const gateStatus = document.getElementById("indexGateStatus");
  const selectedFile = document.getElementById("selectedIndexFile");
  const handoffEntries = new Map();
  let bootStarted = false;

  function createHandoffToken() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function issueHandoff() {
    if (root.location.protocol !== "https:" || !root.ANALYZER_INDEX) return "";
    const token = createHandoffToken();
    handoffEntries.set(token, {
      expiresAt: Date.now() + HANDOFF_TTL_MS,
      index: root.ANALYZER_INDEX,
    });
    root.setTimeout(() => handoffEntries.delete(token), HANDOFF_TTL_MS);
    return token;
  }

  function consumeHandoff(token) {
    const entry = handoffEntries.get(token);
    handoffEntries.delete(token);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.index;
  }

  root.WorkflowIndexHandoff = Object.freeze({
    consume: consumeHandoff,
    issue: issueHandoff,
  });

  function setStatus(message, kind = "") {
    gateStatus.textContent = message;
    gateStatus.className = `index-gate-status ${kind}`.trim();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${src}.`));
      document.body.appendChild(script);
    });
  }

  async function bootApplication() {
    if (bootStarted) return;
    bootStarted = true;
    try {
      await loadScript("assets/app.js");
      document.body.classList.remove("index-locked");
      gate.hidden = true;
    } catch (error) {
      bootStarted = false;
      throw error;
    }
  }

  function openVaultDb() {
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = root.indexedDB.open(VAULT_DB_NAME, 1);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        request.result.createObjectStore(VAULT_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function vaultRequest(db, mode, run) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VAULT_STORE_NAME, mode);
      const store = tx.objectStore(VAULT_STORE_NAME);
      const request = run(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Fetch the non-extractable AES-GCM wrapping key from the vault, generating
  // and persisting one on first use when create is true.
  async function getWrapKey(create) {
    const db = await openVaultDb();
    try {
      let key = await vaultRequest(db, "readonly", (store) => store.get(VAULT_KEY_ID));
      if (!key && create) {
        key = await root.crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false, // non-extractable: cannot be read back out of the browser
          ["encrypt", "decrypt"],
        );
        await vaultRequest(db, "readwrite", (store) => store.put(key, VAULT_KEY_ID));
      }
      return key || null;
    } finally {
      db.close();
    }
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary);
  }

  function base64ToBytes(text) {
    const binary = root.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function storePassphrase(passphrase) {
    const key = await getWrapKey(true);
    if (!key) throw new Error("Passphrase vault key unavailable.");
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await root.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(passphrase),
    );
    root.localStorage.setItem(
      PASSPHRASE_STORE_KEY,
      JSON.stringify({ iv: bytesToBase64(iv), ct: bytesToBase64(ciphertext) }),
    );
  }

  function clearStoredPassphrase() {
    try {
      root.localStorage.removeItem(PASSPHRASE_STORE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  async function loadStoredPassphrase() {
    const raw = root.localStorage.getItem(PASSPHRASE_STORE_KEY);
    if (!raw) return "";
    const key = await getWrapKey(false);
    if (!key) return "";
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      clearStoredPassphrase();
      return "";
    }
    if (!payload?.iv || !payload?.ct) return "";
    const plaintext = await root.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ct),
    );
    return new TextDecoder().decode(plaintext);
  }

  async function restoreOptionalPassphrase() {
    // Drop any plaintext passphrase left by the old tab-only sessionStorage scheme.
    try {
      sessionStorage.removeItem(LEGACY_SESSION_PASSPHRASE_KEY);
    } catch {
      // Ignore.
    }
    try {
      const saved = await loadStoredPassphrase();
      if (saved) {
        passphraseInput.value = saved;
        rememberInput.checked = true;
      }
    } catch {
      // A stored passphrase is optional; ignore vault/crypto/storage failures
      // and fall back to manual entry.
    }
  }

  async function rememberPassphrase(passphrase) {
    try {
      if (rememberInput.checked) {
        await storePassphrase(passphrase);
      } else {
        clearStoredPassphrase();
      }
    } catch {
      // Continue without persistence if the vault is unavailable.
    }
  }

  async function unlock() {
    const file = fileInput.files?.[0];
    const passphrase = passphraseInput.value;
    try {
      root.IndexCrypto.validatePassphrase(passphrase);
      if (!file) throw new Error("Select an encrypted index file.");
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    unlockButton.disabled = true;
    fileInput.disabled = true;
    passphraseInput.disabled = true;
    rememberInput.disabled = true;
    setStatus("Deriving key...", "working");

    try {
      const result = await root.IndexCrypto.decryptIndexFile(file, passphrase, {
        onProgress(progress) {
          setStatus(
            `Decrypting chunk ${progress.completed} of ${progress.total}...`,
            "working",
          );
        },
      });
      root.ANALYZER_INDEX = result.index;
      await rememberPassphrase(passphrase);
      passphraseInput.value = "";
      setStatus("Index unlocked. Starting analyzer...", "success");
      await bootApplication();
    } catch (error) {
      delete root.ANALYZER_INDEX;
      passphraseInput.value = "";
      setStatus(
        error?.name === "OperationError"
          ? "Incorrect passphrase or damaged encrypted index. Try again."
          : error.message || "Unable to unlock the encrypted index.",
        "error",
      );
      unlockButton.disabled = false;
      fileInput.disabled = false;
      passphraseInput.disabled = false;
      rememberInput.disabled = false;
      passphraseInput.focus();
    }
  }

  async function tryPlaintextDevelopmentBoot() {
    const params = new URLSearchParams(root.location.search);
    if (params.get("dev") !== "plaintext") return false;
    setStatus("Loading plaintext development index...", "working");
    try {
      await loadScript("data/analyzer-index.js");
      if (!root.ANALYZER_INDEX) {
        throw new Error("Plaintext development index did not define ANALYZER_INDEX.");
      }
      await bootApplication();
      return true;
    } catch (error) {
      setStatus(`${error.message} Use an encrypted index instead.`, "error");
      return false;
    }
  }

  async function tryHttpsHandoffBoot() {
    const navigation = root.AnalyzerNavigation;
    if (!navigation?.isHttps(root.location)) return false;
    const token = navigation.readHandoffToken(root.location.href);
    if (!token || !root.opener) return false;

    setStatus("Reusing unlocked index from the previous tab...", "working");
    try {
      if (root.opener.location.origin !== root.location.origin) {
        throw new Error("The previous tab is not on the same origin.");
      }
      const handedIndex = root.opener.WorkflowIndexHandoff?.consume(token);
      if (!handedIndex) {
        throw new Error("The index handoff expired or was already used.");
      }
      root.ANALYZER_INDEX = handedIndex;
      root.history.replaceState(
        root.history.state,
        "",
        navigation.removeHandoffToken(root.location.href),
      );
      setStatus("Index reused. Starting analyzer...", "success");
      await bootApplication();
      return true;
    } catch (error) {
      delete root.ANALYZER_INDEX;
      root.history.replaceState(
        root.history.state,
        "",
        navigation.removeHandoffToken(root.location.href),
      );
      setStatus(
        `${error.message} Select the encrypted index to continue.`,
        "error",
      );
      return false;
    }
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    selectedFile.textContent = file
      ? `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`
      : "No encrypted index selected.";
    setStatus("");
  });
  gateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    unlock();
  });

  restoreOptionalPassphrase();
  tryHttpsHandoffBoot().then((reused) => {
    if (!reused) tryPlaintextDevelopmentBoot();
  });
})(window);
