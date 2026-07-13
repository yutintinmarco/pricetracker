(function (global) {
  "use strict";

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
    return value;
  }

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256ArrayBuffer(buffer) {
    if (!global.crypto?.subtle) {
      throw createError(
        "FULL_BACKUP_CRYPTO_UNAVAILABLE",
        "此瀏覽器未能使用安全 checksum，請更新瀏覽器後再試。"
      );
    }
    return bytesToHex(await global.crypto.subtle.digest("SHA-256", buffer));
  }

  async function sha256Blob(blob) {
    return sha256ArrayBuffer(await blob.arrayBuffer());
  }

  async function sha256Text(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    return sha256ArrayBuffer(bytes.buffer);
  }

  function extensionForMime(mimeType) {
    const type = cleanString(mimeType).toLowerCase();
    if (type === "image/png") return "png";
    if (type === "image/jpeg" || type === "image/jpg") return "jpg";
    if (type === "image/webp") return "webp";
    if (type === "image/gif") return "gif";
    if (type === "image/svg+xml") return "svg";
    if (type === "image/avif") return "avif";
    return "img";
  }

  async function detectImageMime(blob, allowDeclared = true) {
    const declared = cleanString(blob?.type).toLowerCase();
    if (allowDeclared && declared.startsWith("image/")) return declared;

    const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
    if (
      head.length >= 8 &&
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47
    ) return "image/png";

    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return "image/jpeg";
    }

    if (
      head.length >= 12 &&
      String.fromCharCode(...head.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...head.slice(8, 12)) === "WEBP"
    ) return "image/webp";

    if (head.length >= 6) {
      const signature = String.fromCharCode(...head.slice(0, 6));
      if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
    }

    const text = new TextDecoder("utf-8", { fatal: false })
      .decode(head)
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) {
      return "image/svg+xml";
    }

    return "";
  }

  function referenceId(type, imageKey) {
    return `${type}:${imageKey}`;
  }

  function buildReferences(data) {
    const references = new Map();
    const products = Array.isArray(data?.products) ? data.products : [];
    const stores = Array.isArray(data?.stores) ? data.stores : [];

    products.forEach((product) => {
      const imageKey = cleanString(product?.productImageKey || product?.imageKey);
      if (!imageKey) return;
      const type = "products";
      const id = referenceId(type, imageKey);
      if (!references.has(id)) {
        references.set(id, {
          type,
          imageKey,
          version: cleanString(product?.productImageUpdatedAt || imageKey)
        });
      }
    });

    stores.forEach((store) => {
      const imageKey = cleanString(store?.logoKey);
      if (!imageKey) return;
      const type = "stores";
      const id = referenceId(type, imageKey);
      if (!references.has(id)) {
        references.set(id, {
          type,
          imageKey,
          version: cleanString(store?.logoUpdatedAt || imageKey)
        });
      }
    });

    return [...references.values()];
  }

  function validateSafeArchivePath(path, type) {
    const cleanPath = cleanString(path);
    const expectedPrefix = `images/${type}/`;
    if (
      !cleanPath.startsWith(expectedPrefix) ||
      cleanPath.includes("..") ||
      cleanPath.includes("\\") ||
      cleanPath.startsWith("/")
    ) {
      throw createError(
        "FULL_BACKUP_UNSAFE_PATH",
        "完整備份包含不安全的圖片路徑。",
        { path: cleanPath }
      );
    }
    return cleanPath;
  }

  function create(options = {}) {
    const appId = cleanString(options.appId || "barcode-price-tracker");
    const formatVersion = Number(options.formatVersion || 1);
    const backupService = options.backupService;
    const getBlob = requireFunction(options.getBlob, "getBlob");
    const ensureLocalImage = requireFunction(
      options.ensureLocalImage || (async () => null),
      "ensureLocalImage"
    );
    const maxImageBytes = Math.max(1, Number(options.maxImageBytes || 2 * 1024 * 1024));
    const maxTotalImageBytes = Math.max(
      maxImageBytes,
      Number(options.maxTotalImageBytes || 250 * 1024 * 1024)
    );
    const maxArchiveBytes = Math.max(
      maxTotalImageBytes,
      Number(options.maxArchiveBytes || 300 * 1024 * 1024)
    );
    const maxImageCount = Math.max(1, Number(options.maxImageCount || 5000));

    if (!backupService?.stringifyEnvelope || !backupService?.prepareImport) {
      throw new TypeError("backupService is required");
    }

    function requireZip() {
      if (typeof global.JSZip !== "function") {
        throw createError(
          "FULL_BACKUP_ZIP_UNAVAILABLE",
          "完整 ZIP 模組未能載入，請重新整理 App。"
        );
      }
      return global.JSZip;
    }

    async function collectImages(data, onProgress) {
      const references = buildReferences(data);
      if (references.length > maxImageCount) {
        throw createError(
          "FULL_BACKUP_TOO_MANY_IMAGES",
          `圖片數量超過上限 ${maxImageCount} 張。`
        );
      }

      const images = [];
      let totalBytes = 0;
      let index = 0;

      for (const reference of references) {
        index += 1;
        onProgress?.({
          phase: "collecting-images",
          current: index,
          total: references.length,
          percent: references.length ? Math.round((index / references.length) * 60) : 60
        });

        let blob = await getBlob(reference.imageKey);
        if (!blob) {
          blob = await ensureLocalImage(
            reference.type,
            reference.imageKey,
            reference.version
          );
        }

        if (!(blob instanceof Blob)) {
          throw createError(
            "FULL_BACKUP_MISSING_IMAGE",
            `未能取得 ${reference.type === "stores" ? "店舖 Logo" : "產品圖片"}，完整備份已停止。`,
            { reference }
          );
        }

        if (blob.size <= 0 || blob.size > maxImageBytes) {
          throw createError(
            "FULL_BACKUP_IMAGE_SIZE_INVALID",
            `圖片 ${reference.imageKey} 大小不正確或超過上限。`,
            { reference, size: blob.size, maxImageBytes }
          );
        }

        totalBytes += blob.size;
        if (totalBytes > maxTotalImageBytes) {
          throw createError(
            "FULL_BACKUP_TOTAL_SIZE_EXCEEDED",
            "圖片總容量超過完整備份上限。",
            { totalBytes, maxTotalImageBytes }
          );
        }

        const mimeType = await detectImageMime(blob);
        if (!mimeType) {
          throw createError(
            "FULL_BACKUP_IMAGE_TYPE_INVALID",
            `圖片 ${reference.imageKey} 格式未能辨認。`,
            { reference }
          );
        }

        const keyHash = await sha256Text(referenceId(reference.type, reference.imageKey));
        const checksum = await sha256Blob(blob);
        const path = `images/${reference.type}/${keyHash}.${extensionForMime(mimeType)}`;

        images.push({
          ...reference,
          path,
          mimeType,
          size: blob.size,
          sha256: checksum,
          blob
        });
      }

      return { images, totalBytes };
    }

    async function exportArchive(data, metadata = {}, onProgress) {
      const JSZip = requireZip();
      const exportedAt = cleanString(metadata.exportedAt || new Date().toISOString());
      const backupText = backupService.stringifyEnvelope(data, 2, { exportedAt });
      const backupJsonSha256 = await sha256Text(backupText);
      const { images, totalBytes } = await collectImages(data, onProgress);

      const productImages = images.filter((item) => item.type === "products").length;
      const storeImages = images.filter((item) => item.type === "stores").length;
      const backupEnvelope = JSON.parse(backupText);

      const manifest = {
        appId,
        fullBackupFormatVersion: formatVersion,
        exportedAt,
        appBuild: cleanString(metadata.appBuild),
        backupJsonPath: "backup.json",
        dataSummary: {
          products: Number(backupEnvelope?.summary?.products || 0),
          observations: Number(backupEnvelope?.summary?.observations || 0),
          stores: Number(backupEnvelope?.summary?.stores || 0),
          schemaVersion: Number(backupEnvelope?.schemaVersion || 0),
          backupFormatVersion: Number(backupEnvelope?.backupFormatVersion || 0)
        },
        images: {
          products: productImages,
          stores: storeImages,
          total: images.length,
          totalBytes,
          entries: images.map(({ blob, ...entry }) => entry)
        },
        integrity: {
          algorithm: "sha-256",
          backupJsonSha256
        }
      };

      const zip = new JSZip();
      zip.file("backup.json", backupText, { compression: "DEFLATE" });
      zip.file("manifest.json", JSON.stringify(manifest, null, 2), {
        compression: "DEFLATE"
      });
      for (const image of images) {
        zip.file(image.path, await image.blob.arrayBuffer(), {
          binary: true,
          compression: "STORE"
        });
      }

      onProgress?.({ phase: "creating-zip", current: 0, total: 100, percent: 65 });
      const blob = await zip.generateAsync(
        {
          type: "blob",
          mimeType: "application/zip",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
          platform: "UNIX",
          streamFiles: true
        },
        (progress) => {
          const percent = 65 + Math.round((Number(progress.percent || 0) / 100) * 35);
          onProgress?.({ phase: "creating-zip", percent: Math.min(100, percent) });
        }
      );

      return {
        blob,
        manifest: cloneJson(manifest),
        filename: `barcode-price-full-backup-v${formatVersion}-${exportedAt.slice(0, 10)}.zip`
      };
    }

    async function loadTextFile(zip, path, code, message) {
      const entry = zip.file(path);
      if (!entry || entry.dir) throw createError(code, message, { path });
      return entry.async("string");
    }

    function validateManifest(manifest) {
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw createError("FULL_BACKUP_MANIFEST_INVALID", "完整備份 manifest 格式不正確。");
      }
      if (cleanString(manifest.appId) !== appId) {
        throw createError("FULL_BACKUP_WRONG_APP", "此 ZIP 並非本 Price Tracker 的完整備份。");
      }
      const sourceVersion = Number(manifest.fullBackupFormatVersion);
      if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
        throw createError("FULL_BACKUP_VERSION_INVALID", "完整備份版本不正確。");
      }
      if (sourceVersion > formatVersion) {
        throw createError(
          "FULL_BACKUP_VERSION_UNSUPPORTED",
          `此完整備份 v${sourceVersion} 較新，App 只支援至 v${formatVersion}。`,
          { sourceVersion, currentVersion: formatVersion }
        );
      }
      if (cleanString(manifest.backupJsonPath || "backup.json") !== "backup.json") {
        throw createError("FULL_BACKUP_DATA_PATH_INVALID", "完整備份的資料檔路徑不正確。");
      }
      if (!Array.isArray(manifest.images?.entries)) {
        throw createError("FULL_BACKUP_IMAGE_MANIFEST_INVALID", "完整備份缺少圖片清單。");
      }
      if (manifest.images.entries.length > maxImageCount) {
        throw createError("FULL_BACKUP_TOO_MANY_IMAGES", "完整備份圖片數量超過上限。");
      }
      return sourceVersion;
    }

    async function prepareImport(file, onProgress) {
      const JSZip = requireZip();
      if (!(file instanceof Blob)) {
        throw createError("FULL_BACKUP_FILE_REQUIRED", "請選擇 ZIP 備份檔案。");
      }
      if (file.size <= 0 || file.size > maxArchiveBytes) {
        throw createError(
          "FULL_BACKUP_ARCHIVE_SIZE_INVALID",
          "ZIP 備份檔案為空白或超過容量上限。",
          { size: file.size, maxArchiveBytes }
        );
      }

      onProgress?.({ phase: "opening-zip", percent: 5 });
      let zip;
      try {
        const zipInput = await file.arrayBuffer();
        zip = await JSZip.loadAsync(zipInput, {
          checkCRC32: true,
          createFolders: false
        });
      } catch (error) {
        throw createError(
          "FULL_BACKUP_ZIP_INVALID",
          "ZIP 備份未能開啟，檔案可能已損壞。",
          { cause: error }
        );
      }

      const fileEntries = Object.values(zip.files || {});
      if (fileEntries.length > maxImageCount + 10) {
        throw createError("FULL_BACKUP_TOO_MANY_FILES", "ZIP 內檔案數量異常，已停止匯入。");
      }

      const manifestText = await loadTextFile(
        zip,
        "manifest.json",
        "FULL_BACKUP_MANIFEST_MISSING",
        "ZIP 內找不到 manifest.json。"
      );
      let manifest;
      try {
        manifest = JSON.parse(manifestText);
      } catch (error) {
        throw createError("FULL_BACKUP_MANIFEST_INVALID", "manifest.json 格式不正確。", { cause: error });
      }
      const sourceVersion = validateManifest(manifest);

      const backupText = await loadTextFile(
        zip,
        "backup.json",
        "FULL_BACKUP_DATA_MISSING",
        "ZIP 內找不到 backup.json。"
      );
      const expectedBackupChecksum = cleanString(manifest.integrity?.backupJsonSha256);
      if (!expectedBackupChecksum) {
        throw createError("FULL_BACKUP_CHECKSUM_MISSING", "完整備份缺少資料 checksum。");
      }
      const actualBackupChecksum = await sha256Text(backupText);
      if (actualBackupChecksum !== expectedBackupChecksum) {
        throw createError("FULL_BACKUP_DATA_CHECKSUM_MISMATCH", "backup.json 完整性驗證失敗。");
      }

      const prepared = backupService.prepareImport(backupText);
      const expectedReferences = buildReferences(prepared.data);
      const expectedIds = new Set(expectedReferences.map((item) => referenceId(item.type, item.imageKey)));
      const manifestMap = new Map();

      manifest.images.entries.forEach((rawEntry) => {
        const type = rawEntry?.type === "stores" ? "stores" : rawEntry?.type === "products" ? "products" : "";
        const imageKey = cleanString(rawEntry?.imageKey);
        if (!type || !imageKey) {
          throw createError("FULL_BACKUP_IMAGE_MANIFEST_INVALID", "圖片清單包含無效項目。");
        }
        const id = referenceId(type, imageKey);
        if (manifestMap.has(id)) {
          throw createError("FULL_BACKUP_IMAGE_DUPLICATE", `圖片 ${imageKey} 在清單重複出現。`);
        }
        const path = validateSafeArchivePath(rawEntry.path, type);
        manifestMap.set(id, {
          type,
          imageKey,
          version: cleanString(rawEntry.version || imageKey),
          path,
          mimeType: cleanString(rawEntry.mimeType).toLowerCase(),
          size: Number(rawEntry.size || 0),
          sha256: cleanString(rawEntry.sha256).toLowerCase()
        });
      });

      const missingEntries = expectedReferences.filter(
        (reference) => !manifestMap.has(referenceId(reference.type, reference.imageKey))
      );
      if (missingEntries.length) {
        throw createError(
          "FULL_BACKUP_IMAGE_ENTRY_MISSING",
          `完整備份缺少 ${missingEntries.length} 張已被資料引用的圖片。`,
          { missingEntries }
        );
      }

      const extraEntries = [...manifestMap.keys()].filter((id) => !expectedIds.has(id));
      const images = [];
      let totalBytes = 0;
      let current = 0;

      for (const reference of expectedReferences) {
        current += 1;
        const id = referenceId(reference.type, reference.imageKey);
        const entry = manifestMap.get(id);
        const zipEntry = zip.file(entry.path);
        if (!zipEntry || zipEntry.dir) {
          throw createError(
            "FULL_BACKUP_IMAGE_FILE_MISSING",
            `ZIP 內找不到圖片 ${reference.imageKey}。`,
            { entry }
          );
        }

        const declaredUncompressed = Number(zipEntry?._data?.uncompressedSize || 0);
        if (declaredUncompressed > maxImageBytes) {
          throw createError("FULL_BACKUP_IMAGE_SIZE_INVALID", `圖片 ${reference.imageKey} 超過容量上限。`);
        }

        onProgress?.({
          phase: "verifying-images",
          current,
          total: expectedReferences.length,
          percent: 20 + Math.round((current / Math.max(1, expectedReferences.length)) * 75)
        });

        const rawBytes = await zipEntry.async("uint8array");
        const rawBlob = new Blob([rawBytes], { type: "application/octet-stream" });
        if (rawBlob.size <= 0 || rawBlob.size > maxImageBytes) {
          throw createError("FULL_BACKUP_IMAGE_SIZE_INVALID", `圖片 ${reference.imageKey} 大小不正確。`);
        }
        if (entry.size && rawBlob.size !== entry.size) {
          throw createError("FULL_BACKUP_IMAGE_SIZE_MISMATCH", `圖片 ${reference.imageKey} 容量驗證失敗。`);
        }

        totalBytes += rawBlob.size;
        if (totalBytes > maxTotalImageBytes) {
          throw createError("FULL_BACKUP_TOTAL_SIZE_EXCEEDED", "完整備份圖片總容量超過上限。");
        }

        const actualChecksum = await sha256Blob(rawBlob);
        if (!entry.sha256 || actualChecksum !== entry.sha256) {
          throw createError("FULL_BACKUP_IMAGE_CHECKSUM_MISMATCH", `圖片 ${reference.imageKey} 完整性驗證失敗。`);
        }

        const detectedMime = await detectImageMime(rawBlob, false);
        const mimeType = entry.mimeType || detectedMime;
        if (!mimeType || !mimeType.startsWith("image/")) {
          throw createError("FULL_BACKUP_IMAGE_TYPE_INVALID", `圖片 ${reference.imageKey} 格式不正確。`);
        }
        if (detectedMime && entry.mimeType && detectedMime !== entry.mimeType) {
          throw createError("FULL_BACKUP_IMAGE_TYPE_MISMATCH", `圖片 ${reference.imageKey} 格式驗證失敗。`);
        }

        images.push({
          type: reference.type,
          imageKey: reference.imageKey,
          version: reference.version,
          path: entry.path,
          mimeType,
          size: rawBlob.size,
          sha256: actualChecksum,
          blob: new Blob([rawBlob], { type: mimeType })
        });
      }

      const declaredTotal = Number(manifest.images?.total ?? manifest.images.entries.length);
      const declaredProducts = Number(manifest.images?.products ?? images.filter((item) => item.type === "products").length);
      const declaredStores = Number(manifest.images?.stores ?? images.filter((item) => item.type === "stores").length);
      const actualProducts = images.filter((item) => item.type === "products").length;
      const actualStores = images.filter((item) => item.type === "stores").length;
      const declaredBytes = Number(manifest.images?.totalBytes ?? totalBytes);
      if (
        declaredTotal !== manifest.images.entries.length ||
        declaredProducts !== actualProducts ||
        declaredStores !== actualStores ||
        declaredBytes !== totalBytes
      ) {
        throw createError("FULL_BACKUP_IMAGE_COUNT_MISMATCH", "完整備份圖片數量或容量驗證失敗。");
      }

      onProgress?.({ phase: "ready", percent: 100 });
      return {
        data: prepared.data,
        migrationReport: prepared.migrationReport,
        backupInfo: prepared.backupInfo,
        validation: prepared.validation,
        manifest: cloneJson(manifest),
        sourceVersion,
        images,
        summary: {
          products: prepared.validation.summary.products,
          observations: prepared.validation.summary.observations,
          stores: prepared.validation.summary.stores,
          productImages: images.filter((item) => item.type === "products").length,
          storeImages: images.filter((item) => item.type === "stores").length,
          totalImages: images.length,
          totalImageBytes: totalBytes,
          extraImagesIgnored: extraEntries.length,
          integrityVerified: true
        }
      };
    }

    return Object.freeze({
      exportArchive,
      prepareImport,
      buildReferences,
      getFormatVersion: () => formatVersion,
      getAppId: () => appId,
      getLimits: () => ({ maxImageBytes, maxTotalImageBytes, maxArchiveBytes, maxImageCount })
    });
  }

  global.PriceTrackerFullBackupService = Object.freeze({ create });
})(window);
