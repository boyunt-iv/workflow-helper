(function (root) {
  "use strict";

  const SESSION_PASSPHRASE_KEY = "workflowHelper.indexPassphrase.v1";
  const gate = document.getElementById("indexGate");
  const gateForm = document.getElementById("indexGateForm");
  const fileInput = document.getElementById("indexFile");
  const passphraseInput = document.getElementById("indexPassphrase");
  const rememberInput = document.getElementById("rememberIndexPassphrase");
  const unlockButton = document.getElementById("unlockIndex");
  const gateStatus = document.getElementById("indexGateStatus");
  const selectedFile = document.getElementById("selectedIndexFile");
  let bootStarted = false;

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

  function restoreOptionalPassphrase() {
    try {
      const saved = sessionStorage.getItem(SESSION_PASSPHRASE_KEY);
      if (saved) {
        passphraseInput.value = saved;
        rememberInput.checked = true;
      }
    } catch {
      // Session storage is optional.
    }
  }

  function rememberPassphrase(passphrase) {
    try {
      if (rememberInput.checked) {
        sessionStorage.setItem(SESSION_PASSPHRASE_KEY, passphrase);
      } else {
        sessionStorage.removeItem(SESSION_PASSPHRASE_KEY);
      }
    } catch {
      // Continue without session storage.
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
      rememberPassphrase(passphrase);
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
  tryPlaintextDevelopmentBoot();
})(window);
