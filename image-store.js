(function (global) {
  "use strict";

  function create(options = {}) {
    const dbName = String(options.dbName || "").trim();
    const storeName = String(options.storeName || "").trim();
    const dbVersion = Number(options.dbVersion || 1);
    const keyPath = String(options.keyPath || "logoKey").trim();

    if (!dbName || !storeName || !keyPath) {
      throw new Error("dbName, storeName and keyPath are required");
    }

    function open() {
      return new Promise((resolve, reject) => {
        if (!global.indexedDB) {
          reject(new Error("IndexedDB is not available"));
          return;
        }

        const request = global.indexedDB.open(dbName, dbVersion);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath });
          }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          reject(request.error || new Error("Cannot open image database"));
        };
      });
    }

    async function run(mode, operation) {
      const db = await open();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let request;

        try {
          request = operation(store);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }

        transaction.oncomplete = () => {
          const result = request && "result" in request ? request.result : undefined;
          db.close();
          resolve(result);
        };

        transaction.onerror = () => {
          const error = transaction.error || request?.error || new Error("Image database error");
          db.close();
          reject(error);
        };

        transaction.onabort = () => {
          const error = transaction.error || new Error("Image database transaction aborted");
          db.close();
          reject(error);
        };
      });
    }

    function save(imageKey, blob, metadata = {}) {
      if (!imageKey) return Promise.reject(new Error("An image key is required"));
      if (!(blob instanceof Blob)) return Promise.reject(new Error("A Blob is required"));

      const record = {
        ...metadata,
        [keyPath]: imageKey,
        imageKey,
        blob,
        updatedAt: metadata.updatedAt || new Date().toISOString()
      };

      return run("readwrite", (store) => store.put(record));
    }

    async function getRecord(imageKey) {
      if (!imageKey) return null;
      return (await run("readonly", (store) => store.get(imageKey))) || null;
    }

    async function getBlob(imageKey) {
      const record = await getRecord(imageKey);
      return record?.blob || null;
    }

    function remove(imageKey) {
      if (!imageKey) return Promise.resolve();
      return run("readwrite", (store) => store.delete(imageKey));
    }

    function clearAll() {
      return run("readwrite", (store) => store.clear());
    }

    function count() {
      return run("readonly", (store) => store.count());
    }

    function getAllKeys() {
      return run("readonly", (store) => store.getAllKeys());
    }

    function getAllRecords() {
      return run("readonly", (store) => store.getAll());
    }

    function replaceAll(records = []) {
      const normalized = Array.isArray(records) ? records : [];
      return new Promise(async (resolve, reject) => {
        let db;
        try {
          db = await open();
        } catch (error) {
          reject(error);
          return;
        }

        const transaction = db.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);

        transaction.oncomplete = () => {
          db.close();
          resolve(normalized.length);
        };
        transaction.onerror = () => {
          const error = transaction.error || new Error("Image database error");
          db.close();
          reject(error);
        };
        transaction.onabort = () => {
          const error = transaction.error || new Error("Image database transaction aborted");
          db.close();
          reject(error);
        };

        try {
          store.clear();
          normalized.forEach((source) => {
            if (!source || !(source.blob instanceof Blob)) {
              throw new Error("Every image record must contain a Blob");
            }
            const imageKey = String(source[keyPath] || source.imageKey || "").trim();
            if (!imageKey) throw new Error("Every image record requires an image key");
            store.put({
              ...source,
              [keyPath]: imageKey,
              imageKey,
              updatedAt: source.updatedAt || new Date().toISOString()
            });
          });
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
    }

    return Object.freeze({
      save,
      getRecord,
      getBlob,
      remove,
      clearAll,
      count,
      getAllKeys,
      getAllRecords,
      replaceAll,
      getDatabaseName: () => dbName,
      getStoreName: () => storeName
    });
  }

  global.PriceTrackerImageStore = Object.freeze({ create });
})(window);
