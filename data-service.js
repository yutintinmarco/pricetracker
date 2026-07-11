(function (global) {
  "use strict";

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
    return value;
  }

  function create(options = {}) {
    const storageKey = String(options.storageKey || "").trim();
    if (!storageKey) throw new Error("A storageKey is required");

    const storage = options.storage || global.localStorage;
    if (!storage) throw new Error("Local storage is not available");

    const createDefaultData = requireFunction(
      options.createDefaultData,
      "createDefaultData"
    );
    const normalizeData = requireFunction(options.normalizeData, "normalizeData");
    const schema = options.schema || null;
    const migrationBackupPrefix = String(
      options.migrationBackupPrefix || `${storageKey}-migration-backup`
    ).trim();
    const maxMigrationBackups = Math.max(
      1,
      Number(options.maxMigrationBackups || 3)
    );

    let data = null;
    let lastLoadError = null;
    let lastMigrationReport = null;

    function normalizeCurrent(source) {
      return schema?.normalizeCurrent
        ? schema.normalizeCurrent(source)
        : normalizeData(source);
    }

    function prepare(source) {
      if (schema?.prepare) return schema.prepare(source);
      return {
        data: normalizeData(source),
        report: {
          sourceVersion: null,
          currentVersion: null,
          didMigrate: false,
          migratedAt: "",
          steps: []
        }
      };
    }

    function buildDefaultData() {
      return normalizeCurrent(createDefaultData());
    }

    function listMigrationBackupKeys() {
      const keys = [];
      const length = Number(storage.length || 0);

      for (let index = 0; index < length; index += 1) {
        const key = storage.key(index);
        if (key && key.startsWith(`${migrationBackupPrefix}-`)) {
          keys.push(key);
        }
      }

      return keys.sort();
    }

    function trimMigrationBackups() {
      const keys = listMigrationBackupKeys();
      const removeCount = Math.max(0, keys.length - maxMigrationBackups);

      keys.slice(0, removeCount).forEach((key) => {
        storage.removeItem(key);
      });
    }

    function createMigrationBackup(source, report) {
      const suffix = String(report.migratedAt || new Date().toISOString())
        .replace(/[:.]/g, "-");
      const backupKey =
        `${migrationBackupPrefix}-v${report.sourceVersion}` +
        `-to-v${report.currentVersion}-${suffix}`;

      const backup = {
        backupFormatVersion: 1,
        createdAt: report.migratedAt || new Date().toISOString(),
        sourceStorageKey: storageKey,
        fromSchemaVersion: report.sourceVersion,
        toSchemaVersion: report.currentVersion,
        data: source
      };

      storage.setItem(backupKey, JSON.stringify(backup));
      trimMigrationBackups();
      return backupKey;
    }

    function load() {
      lastLoadError = null;
      lastMigrationReport = null;

      try {
        const raw = storage.getItem(storageKey);

        if (!raw) {
          data = buildDefaultData();
          return data;
        }

        const parsed = JSON.parse(raw);
        const prepared = prepare(parsed);
        data = prepared.data;
        lastMigrationReport = prepared.report;

        if (prepared.report?.didMigrate) {
          const backupKey = createMigrationBackup(parsed, prepared.report);
          lastMigrationReport = {
            ...prepared.report,
            backupKey
          };
          storage.setItem(storageKey, JSON.stringify(data));
        }

        return data;
      } catch (error) {
        lastLoadError = error;
        data = buildDefaultData();
        return data;
      }
    }

    function reload() {
      return load();
    }

    function getData() {
      return data || load();
    }

    function persist(nextData) {
      if (arguments.length > 0) {
        data = nextData;
      }

      if (!data) {
        data = buildDefaultData();
      }

      data = normalizeCurrent(data);
      storage.setItem(storageKey, JSON.stringify(data));
      return data;
    }

    function replace(nextData, options = {}) {
      const shouldNormalize = options.normalize !== false;
      data = shouldNormalize ? normalizeCurrent(nextData) : nextData;

      if (options.persist === true) {
        persist();
      }

      return data;
    }

    function exportJson(source = getData(), spacing = 2) {
      return JSON.stringify(normalizeCurrent(source), null, spacing);
    }

    function findProductById(productId) {
      return getData().products.find((product) => product.id === productId) || null;
    }

    function findProductByBarcode(barcode, cleanBarcode) {
      const clean = requireFunction(cleanBarcode, "cleanBarcode");
      const cleanValue = clean(barcode);
      if (!cleanValue) return null;

      return getData().products.find(
        (product) => clean(product.barcode) === cleanValue
      ) || null;
    }

    function findObservationById(observationId) {
      return getData().observations.find(
        (observation) => observation.id === observationId
      ) || null;
    }

    function findStoreById(storeId) {
      return getData().stores.find((store) => store.storeId === storeId) || null;
    }

    function findStoreByName(name, normalizeName) {
      const normalize = requireFunction(normalizeName, "normalizeName");
      const normalized = normalize(name);
      if (!normalized) return null;

      return getData().stores.find((store) =>
        normalize(store.displayName) === normalized ||
        normalize(store.storeName) === normalized
      ) || null;
    }

    function getProductObservations(productId, compare) {
      const records = getData().observations.filter(
        (observation) => observation.productId === productId
      );
      return typeof compare === "function" ? records.sort(compare) : records;
    }

    function addStore(store) {
      getData().stores.push(store);
      return store;
    }

    return Object.freeze({
      load,
      reload,
      getData,
      persist,
      replace,
      prepare,
      exportJson,
      findProductById,
      findProductByBarcode,
      findObservationById,
      findStoreById,
      findStoreByName,
      getProductObservations,
      addStore,
      getStorageKey: () => storageKey,
      getLastLoadError: () => lastLoadError,
      getLastMigrationReport: () => lastMigrationReport,
      listMigrationBackupKeys
    });
  }

  global.PriceTrackerDataService = Object.freeze({ create });
})(window);
