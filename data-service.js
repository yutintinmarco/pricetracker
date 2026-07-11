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

    let data = null;
    let lastLoadError = null;

    function buildDefaultData() {
      return normalizeData(createDefaultData());
    }

    function load() {
      lastLoadError = null;

      try {
        const raw = storage.getItem(storageKey);
        data = raw ? normalizeData(JSON.parse(raw)) : buildDefaultData();
      } catch (error) {
        lastLoadError = error;
        data = buildDefaultData();
      }

      return data;
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

      storage.setItem(storageKey, JSON.stringify(data));
      return data;
    }

    function replace(nextData, options = {}) {
      const shouldNormalize = options.normalize !== false;
      data = shouldNormalize ? normalizeData(nextData) : nextData;

      if (options.persist === true) {
        persist();
      }

      return data;
    }

    function exportJson(source = getData(), spacing = 2) {
      return JSON.stringify(source, null, spacing);
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
      exportJson,
      findProductById,
      findProductByBarcode,
      findObservationById,
      findStoreById,
      findStoreByName,
      getProductObservations,
      addStore,
      getStorageKey: () => storageKey,
      getLastLoadError: () => lastLoadError
    });
  }

  global.PriceTrackerDataService = Object.freeze({ create });
})(window);
