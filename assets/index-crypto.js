(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.IndexCrypto = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  "use strict";

  const MIN_PASSPHRASE_LENGTH = 4;
  const KDF_ITERATIONS = 600_000;
  const HEADER_PREFIX_LENGTH = 8;
  const MAX_HEADER_LENGTH = 1024 * 1024;
  const MAGIC = new Uint8Array([87, 72, 73, 49]);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function validatePassphrase(passphrase) {
    if (Array.from(String(passphrase || "")).length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
  }

  function decodeBase64(value) {
    const binary = root.atob
      ? root.atob(value)
      : Buffer.from(value, "base64").toString("binary");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function chunkAdditionalData(index, total) {
    return textEncoder.encode(`index-container-v1:${index}:${total}`);
  }

  function validateManifest(manifest, fileSize, dataOffset) {
    if (!manifest || manifest.schemaVersion !== 1) {
      throw new Error("Unsupported encrypted index format.");
    }
    if (
      manifest.kdf?.name !== "PBKDF2-SHA-256" ||
      !Number.isInteger(manifest.kdf?.iterations) ||
      manifest.kdf.iterations !== KDF_ITERATIONS ||
      typeof manifest.kdf?.salt !== "string"
    ) {
      throw new Error("Invalid encrypted index key settings.");
    }
    if (
      !Number.isSafeInteger(manifest.total) ||
      manifest.total < 0 ||
      !Number.isSafeInteger(manifest.chunkSize) ||
      manifest.chunkSize < 1 ||
      !Array.isArray(manifest.chunks) ||
      manifest.chunks.length < 1
    ) {
      throw new Error("Invalid encrypted index manifest.");
    }

    let encryptedBytes = 0;
    for (const chunk of manifest.chunks) {
      if (
        typeof chunk?.iv !== "string" ||
        !Number.isSafeInteger(chunk?.len) ||
        chunk.len < 17
      ) {
        throw new Error("Invalid encrypted index chunk metadata.");
      }
      encryptedBytes += chunk.len;
    }
    if (dataOffset + encryptedBytes !== fileSize) {
      throw new Error("Encrypted index file is incomplete or has trailing data.");
    }
  }

  async function readManifest(file) {
    if (!file || typeof file.slice !== "function") {
      throw new Error("Select an encrypted index file.");
    }
    if (file.size < HEADER_PREFIX_LENGTH) {
      throw new Error("Encrypted index file is too small.");
    }

    const prefix = new Uint8Array(
      await file.slice(0, HEADER_PREFIX_LENGTH).arrayBuffer(),
    );
    for (let index = 0; index < MAGIC.length; index += 1) {
      if (prefix[index] !== MAGIC[index]) {
        throw new Error("This is not a supported encrypted index file.");
      }
    }

    const headerLength = new DataView(
      prefix.buffer,
      prefix.byteOffset,
      prefix.byteLength,
    ).getUint32(4, false);
    if (
      headerLength < 2 ||
      headerLength > MAX_HEADER_LENGTH ||
      HEADER_PREFIX_LENGTH + headerLength > file.size
    ) {
      throw new Error("Encrypted index header is invalid.");
    }

    const headerBytes = await file
      .slice(HEADER_PREFIX_LENGTH, HEADER_PREFIX_LENGTH + headerLength)
      .arrayBuffer();
    let manifest;
    try {
      manifest = JSON.parse(textDecoder.decode(headerBytes));
    } catch {
      throw new Error("Encrypted index header is not valid JSON.");
    }
    const dataOffset = HEADER_PREFIX_LENGTH + headerLength;
    validateManifest(manifest, file.size, dataOffset);
    return { manifest, dataOffset };
  }

  async function deriveKey(passphrase, manifest) {
    validatePassphrase(passphrase);
    if (!root.crypto?.subtle) {
      throw new Error("Web Crypto is not available in this browser.");
    }

    const passphraseBytes = textEncoder.encode(passphrase);
    try {
      const keyMaterial = await root.crypto.subtle.importKey(
        "raw",
        passphraseBytes,
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      return root.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt: decodeBase64(manifest.kdf.salt),
          iterations: manifest.kdf.iterations,
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
    } finally {
      passphraseBytes.fill(0);
    }
  }

  async function decryptIndexFile(file, passphrase, options = {}) {
    const { manifest, dataOffset } = await readManifest(file);
    const key = await deriveKey(passphrase, manifest);
    const plaintext = new Uint8Array(manifest.total);
    let encryptedOffset = dataOffset;
    let plaintextOffset = 0;

    try {
      for (let index = 0; index < manifest.chunks.length; index += 1) {
        const chunk = manifest.chunks[index];
        const encrypted = await file
          .slice(encryptedOffset, encryptedOffset + chunk.len)
          .arrayBuffer();
        const decrypted = await root.crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decodeBase64(chunk.iv),
            additionalData: chunkAdditionalData(index, manifest.total),
            tagLength: 128,
          },
          key,
          encrypted,
        );
        const decryptedBytes = new Uint8Array(decrypted);
        if (plaintextOffset + decryptedBytes.length > plaintext.length) {
          decryptedBytes.fill(0);
          throw new Error("Decrypted index exceeds the declared size.");
        }
        plaintext.set(decryptedBytes, plaintextOffset);
        plaintextOffset += decryptedBytes.length;
        encryptedOffset += chunk.len;
        decryptedBytes.fill(0);
        if (typeof options.onProgress === "function") {
          options.onProgress({
            completed: index + 1,
            total: manifest.chunks.length,
          });
        }
      }

      if (plaintextOffset !== manifest.total) {
        throw new Error("Decrypted index size does not match the manifest.");
      }

      let jsonText = textDecoder.decode(plaintext);
      try {
        return {
          index: JSON.parse(jsonText),
          manifest,
        };
      } finally {
        jsonText = "";
      }
    } finally {
      plaintext.fill(0);
    }
  }

  return {
    HEADER_PREFIX_LENGTH,
    KDF_ITERATIONS,
    MAGIC,
    MIN_PASSPHRASE_LENGTH,
    chunkAdditionalData,
    decryptIndexFile,
    readManifest,
    validatePassphrase,
  };
});
