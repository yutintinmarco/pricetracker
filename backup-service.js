(function (global) {
  "use strict";

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
    return value;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }

    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = canonicalize(value[key]);
          return result;
        }, {});
    }

    return value;
  }

  function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value));
  }

  function fnv1a32(value) {
    const text = String(value || "");
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function checksumForData(data) {
    return fnv1a32(canonicalStringify(data));
  }

  function countDuplicates(values) {
    const counts = new Map();
    values.forEach((value) => {
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([value, count]) => ({ value, count }));
  }

  function create(options = {}) {
    const appId = String(options.appId || "barcode-price-tracker").trim();
    const backupFormatVersion = Number(options.backupFormatVersion || 2);
    const prepareData = requireFunction(options.prepareData, "prepareData");
    const currentSchemaVersion = Number(options.currentSchemaVersion || 1);

    function validateData(data) {
      const errors = [];
      const warnings = [];

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        errors.push("備份資料根目錄必須是 object。");
        return { valid: false, errors, warnings, summary: null };
      }

      const products = Array.isArray(data.products) ? data.products : [];
      const observations = Array.isArray(data.observations) ? data.observations : [];
      const stores = Array.isArray(data.stores) ? data.stores : [];

      if (!Array.isArray(data.products)) errors.push("products 必須是 array。");
      if (!Array.isArray(data.observations)) errors.push("observations 必須是 array。");
      if (!Array.isArray(data.stores)) errors.push("stores 必須是 array。");
      if (!data.settings || typeof data.settings !== "object") {
        errors.push("settings 必須是 object。");
      }

      const productIds = products.map((product) => String(product?.id || "").trim());
      const observationIds = observations.map((observation) =>
        String(observation?.id || "").trim()
      );
      const storeIds = stores.map((store) => String(store?.storeId || "").trim());

      products.forEach((product, index) => {
        if (!productIds[index]) {
          errors.push(`第 ${index + 1} 個產品缺少 id。`);
        }
        if (!String(product?.name || "").trim()) {
          errors.push(`產品 ${productIds[index] || `#${index + 1}`} 缺少名稱。`);
        }
      });

      observations.forEach((observation, index) => {
        const id = observationIds[index] || `#${index + 1}`;
        const productId = String(observation?.productId || "").trim();

        if (!observationIds[index]) {
          errors.push(`第 ${index + 1} 筆價格記錄缺少 id。`);
        }
        if (!productId) {
          errors.push(`價格記錄 ${id} 缺少 productId。`);
        }
      });

      stores.forEach((store, index) => {
        if (!storeIds[index]) {
          errors.push(`第 ${index + 1} 間店舖缺少 storeId。`);
        }
      });

      countDuplicates(productIds).forEach(({ value, count }) => {
        errors.push(`產品 id「${value}」重複 ${count} 次。`);
      });
      countDuplicates(observationIds).forEach(({ value, count }) => {
        errors.push(`價格記錄 id「${value}」重複 ${count} 次。`);
      });
      countDuplicates(storeIds).forEach(({ value, count }) => {
        errors.push(`店舖 id「${value}」重複 ${count} 次。`);
      });

      const productIdSet = new Set(productIds.filter(Boolean));
      const storeIdSet = new Set(storeIds.filter(Boolean));

      observations.forEach((observation) => {
        const observationId = String(observation?.id || "").trim() || "未命名記錄";
        const productId = String(observation?.productId || "").trim();
        const storeId = String(observation?.storeId || "").trim();
        const displayedPrice = Number(
          observation?.displayedPrice ?? observation?.price
        );

        if (productId && !productIdSet.has(productId)) {
          errors.push(
            `價格記錄 ${observationId} 指向不存在的產品 ${productId}。`
          );
        }

        if (storeId && !storeIdSet.has(storeId)) {
          warnings.push(
            `價格記錄 ${observationId} 指向不存在的店舖 ${storeId}，將使用店名快照。`
          );
        }

        if (!Number.isFinite(displayedPrice) || displayedPrice <= 0) {
          warnings.push(`價格記錄 ${observationId} 的價格不是正數。`);
        }
      });

      const barcodeOwners = new Map();
      products.forEach((product) => {
        const productId = String(product?.id || "").trim() || "未命名產品";
        const candidates = [
          product?.barcode,
          ...(Array.isArray(product?.barcodes) ? product.barcodes : [])
        ];
        const seenForProduct = new Set();
        candidates.forEach((candidate) => {
          const barcode = String(candidate || "").replace(/\s+/g, "");
          if (!barcode || seenForProduct.has(barcode)) return;
          seenForProduct.add(barcode);
          if (!barcodeOwners.has(barcode)) barcodeOwners.set(barcode, new Set());
          barcodeOwners.get(barcode).add(productId);
        });
      });

      barcodeOwners.forEach((owners, barcode) => {
        if (owners.size > 1) {
          warnings.push(`條碼「${barcode}」出現在 ${owners.size} 個產品。`);
        }
      });

      const migrationHistory = Array.isArray(data.meta?.migrationHistory)
        ? data.meta.migrationHistory
        : [];

      const summary = {
        schemaVersion: Number(data.schemaVersion || currentSchemaVersion),
        products: products.length,
        observations: observations.length,
        stores: stores.length,
        migrationSteps: migrationHistory.length,
        errors: errors.length,
        warnings: warnings.length
      };

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        summary
      };
    }

    function createEnvelope(data, metadata = {}) {
      const validation = validateData(data);
      if (!validation.valid) {
        const error = new Error("Cannot export invalid data");
        error.code = "INVALID_EXPORT_DATA";
        error.validation = validation;
        throw error;
      }

      const exportedAt = String(
        metadata.exportedAt || new Date().toISOString()
      );

      return {
        appId,
        backupFormatVersion,
        exportedAt,
        schemaVersion: Number(data.schemaVersion || currentSchemaVersion),
        summary: {
          products: validation.summary.products,
          observations: validation.summary.observations,
          stores: validation.summary.stores,
          migrationSteps: validation.summary.migrationSteps
        },
        integrity: {
          algorithm: "fnv1a32-canonical-json",
          checksum: checksumForData(data)
        },
        data
      };
    }

    function stringifyEnvelope(data, spacing = 2, metadata = {}) {
      return JSON.stringify(createEnvelope(data, metadata), null, spacing);
    }

    function parseRaw(raw) {
      try {
        return JSON.parse(String(raw || ""));
      } catch (error) {
        const parseError = new Error("JSON 格式不正確。");
        parseError.code = "INVALID_JSON";
        parseError.cause = error;
        throw parseError;
      }
    }

    function unwrapBackup(parsed) {
      const isEnvelope =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "backupFormatVersion" in parsed &&
        "data" in parsed;

      if (!isEnvelope) {
        return {
          data: parsed,
          backupInfo: {
            formatVersion: 0,
            exportedAt: "",
            appId: "",
            legacy: true,
            integrityVerified: false
          }
        };
      }

      if (String(parsed.appId || "") !== appId) {
        const error = new Error("此 JSON 並非本 Price Tracker 的備份。");
        error.code = "WRONG_APP_BACKUP";
        throw error;
      }

      const formatVersion = Number(parsed.backupFormatVersion);
      if (!Number.isInteger(formatVersion) || formatVersion < 1) {
        const error = new Error("備份格式版本不正確。");
        error.code = "INVALID_BACKUP_FORMAT";
        throw error;
      }

      if (formatVersion > backupFormatVersion) {
        const error = new Error(
          `此備份格式 v${formatVersion} 較新，App 只支援至 v${backupFormatVersion}。`
        );
        error.code = "UNSUPPORTED_BACKUP_FORMAT";
        error.sourceVersion = formatVersion;
        error.currentVersion = backupFormatVersion;
        throw error;
      }

      let integrityVerified = false;
      if (parsed.integrity?.checksum) {
        const actualChecksum = checksumForData(parsed.data);
        if (actualChecksum !== parsed.integrity.checksum) {
          const error = new Error("備份完整性驗證失敗，內容可能已損壞或被修改。");
          error.code = "CHECKSUM_MISMATCH";
          error.expectedChecksum = parsed.integrity.checksum;
          error.actualChecksum = actualChecksum;
          throw error;
        }
        integrityVerified = true;
      }

      return {
        data: parsed.data,
        backupInfo: {
          formatVersion,
          exportedAt: String(parsed.exportedAt || ""),
          appId: String(parsed.appId || ""),
          legacy: false,
          integrityVerified
        }
      };
    }

    function prepareImport(raw) {
      const parsed = parseRaw(raw);
      const unwrapped = unwrapBackup(parsed);

      if (
        !unwrapped.data ||
        typeof unwrapped.data !== "object" ||
        Array.isArray(unwrapped.data)
      ) {
        const error = new Error("備份內容缺少有效 data object。");
        error.code = "INVALID_BACKUP_DATA";
        throw error;
      }

      if (
        !Array.isArray(unwrapped.data.products) ||
        !Array.isArray(unwrapped.data.observations)
      ) {
        const error = new Error("備份內容缺少 products 或 observations。");
        error.code = "MISSING_CORE_COLLECTIONS";
        throw error;
      }

      const prepared = prepareData(unwrapped.data);
      const validation = validateData(prepared.data);

      if (!validation.valid) {
        const error = new Error("備份資料完整性檢查不合格。");
        error.code = "DATA_VALIDATION_FAILED";
        error.validation = validation;
        throw error;
      }

      return {
        data: prepared.data,
        migrationReport: prepared.report,
        backupInfo: unwrapped.backupInfo,
        validation
      };
    }

    return Object.freeze({
      createEnvelope,
      stringifyEnvelope,
      prepareImport,
      validateData,
      checksumForData,
      getBackupFormatVersion: () => backupFormatVersion,
      getAppId: () => appId
    });
  }

  global.PriceTrackerBackupService = Object.freeze({ create });
})(window);
