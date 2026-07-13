(function (global) {
  "use strict";

  function requireFunction(value, name) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
    return value;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);

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

  function checksum(value) {
    const text = JSON.stringify(canonicalize(value));
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function makeDeviceId() {
    if (global.crypto?.randomUUID) {
      return `device_${global.crypto.randomUUID()}`;
    }

    return `device_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function create(options = {}) {
    const storage = options.storage || global.localStorage;
    if (!storage) throw new Error("Local storage is not available");

    const storageKey = cleanString(
      options.storageKey || "barcode-price-tracker-cloud-sync-v1"
    );
    const deviceStorageKey = cleanString(
      options.deviceStorageKey || "barcode-price-tracker-device-id-v1"
    );

    const getData = requireFunction(options.getData, "getData");
    const applyData = requireFunction(options.applyData, "applyData");
    const normalizeData = requireFunction(options.normalizeData, "normalizeData");
    const createSafetyBackup = requireFunction(
      options.createSafetyBackup,
      "createSafetyBackup"
    );

    let attachment = null;
    let account = null;
    let accountKey = "";
    let listenerUnsubscribes = [];
    let flushTimer = 0;
    let flushInProgress = false;
    let attachToken = 0;

    const listeners = new Set();

    let state = {
      attached: false,
      phase: "detached",
      initialized: false,
      cloudInitialized: false,
      syncing: false,
      online: navigator.onLine,
      pendingCount: 0,
      localCounts: countData(getData()),
      cloudCounts: {
        products: 0,
        observations: 0,
        stores: 0
      },
      lastSyncAt: "",
      lastError: null,
      projectId: "",
      uid: "",
      deviceId: getDeviceId()
    };

    function getDeviceId() {
      const existing = cleanString(storage.getItem(deviceStorageKey));
      if (existing) return existing;

      const created = makeDeviceId();
      storage.setItem(deviceStorageKey, created);
      return created;
    }

    function defaultRoot() {
      return {
        version: 1,
        accounts: {}
      };
    }

    function loadRoot() {
      try {
        const parsed = JSON.parse(storage.getItem(storageKey) || "null");
        if (!parsed || typeof parsed !== "object") return defaultRoot();

        return {
          version: 1,
          accounts:
            parsed.accounts && typeof parsed.accounts === "object"
              ? parsed.accounts
              : {}
        };
      } catch (error) {
        return defaultRoot();
      }
    }

    function normalizeQueue(source) {
      return source && typeof source === "object" && !Array.isArray(source)
        ? source
        : {};
    }

    function normalizeShadow(source) {
      const value =
        source && typeof source === "object" && !Array.isArray(source)
          ? source
          : {};

      return {
        products:
          value.products && typeof value.products === "object"
            ? value.products
            : {},
        observations:
          value.observations && typeof value.observations === "object"
            ? value.observations
            : {},
        stores:
          value.stores && typeof value.stores === "object"
            ? value.stores
            : {},
        app: cleanString(value.app)
      };
    }

    function emptyShadow() {
      return {
        products: {},
        observations: {},
        stores: {},
        app: ""
      };
    }

    function loadAccount(key) {
      const root = loadRoot();
      const saved =
        root.accounts[key] &&
        typeof root.accounts[key] === "object" &&
        !Array.isArray(root.accounts[key])
          ? root.accounts[key]
          : {};

      return {
        initialized: saved.initialized === true,
        queue: normalizeQueue(saved.queue),
        shadow: normalizeShadow(saved.shadow),
        lastSyncAt: cleanString(saved.lastSyncAt),
        updatedAt: cleanString(saved.updatedAt)
      };
    }

    function persistAccount() {
      if (!accountKey || !account) return;

      const root = loadRoot();
      account.updatedAt = new Date().toISOString();
      root.accounts[accountKey] = account;
      storage.setItem(storageKey, JSON.stringify(root));
    }

    function snapshot() {
      return Object.freeze({
        ...state,
        localCounts: Object.freeze({ ...state.localCounts }),
        cloudCounts: Object.freeze({ ...state.cloudCounts }),
        lastError: state.lastError
          ? Object.freeze({ ...state.lastError })
          : null
      });
    }

    function emit(patch = {}) {
      state = {
        ...state,
        ...patch,
        online: navigator.onLine
      };

      const current = snapshot();
      listeners.forEach((listener) => {
        try {
          listener(current);
        } catch (error) {
          console.warn("Cloud sync listener failed:", error);
        }
      });

      return current;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Cloud sync listener must be a function");
      }

      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    function countData(source) {
      const data = source && typeof source === "object" ? source : {};
      return {
        products: Array.isArray(data.products) ? data.products.length : 0,
        observations: Array.isArray(data.observations)
          ? data.observations.length
          : 0,
        stores: Array.isArray(data.stores) ? data.stores.length : 0
      };
    }

    function totalCount(counts) {
      return (
        Number(counts?.products || 0) +
        Number(counts?.observations || 0) +
        Number(counts?.stores || 0)
      );
    }

    function arrayToMap(array, idField) {
      const result = new Map();

      (Array.isArray(array) ? array : []).forEach((record) => {
        const id = cleanString(record?.[idField]);
        if (!id) return;
        result.set(id, cloneJson(record));
      });

      return result;
    }

    function appRecordForData(source) {
      const data = source && typeof source === "object" ? source : {};

      return {
        schemaVersion: Number(data.schemaVersion || 1),
        meta:
          data.meta && typeof data.meta === "object"
            ? cloneJson(data.meta)
            : {},
        settings:
          data.settings && typeof data.settings === "object"
            ? cloneJson(data.settings)
            : {}
      };
    }

    function buildShadow(source) {
      const data = normalizeData(source);
      const products = arrayToMap(data.products, "id");
      const observations = arrayToMap(data.observations, "id");
      const stores = arrayToMap(data.stores, "storeId");

      return {
        products: Object.fromEntries(
          [...products].map(([id, record]) => [id, checksum(record)])
        ),
        observations: Object.fromEntries(
          [...observations].map(([id, record]) => [id, checksum(record)])
        ),
        stores: Object.fromEntries(
          [...stores].map(([id, record]) => [id, checksum(record)])
        ),
        app: checksum(appRecordForData(data))
      };
    }

    function accountPathKey(projectId, uid) {
      return `${cleanString(projectId)}::${cleanString(uid)}`;
    }

    function recordPath(type, id) {
      if (!attachment) throw new Error("Cloud sync is not attached");

      if (type === "app") {
        return `${attachment.basePath}/app/state`;
      }

      return `${attachment.basePath}/${type}/${id}`;
    }

    function recordKey(type, id) {
      return `${type}:${id}`;
    }

    function parseRecordKey(key) {
      const separator = String(key).indexOf(":");
      if (separator < 1) return null;

      return {
        type: key.slice(0, separator),
        id: key.slice(separator + 1)
      };
    }

    function queueOperation(type, id, operation, record = null) {
      if (!account) return;

      const key = recordKey(type, id);
      account.queue[key] = {
        key,
        type,
        id,
        operation,
        record: record === null ? null : cloneJson(record),
        queuedAt: new Date().toISOString(),
        token: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      };
    }

    function compareCollection(type, currentMap, nextShadow) {
      const previousShadow =
        account.shadow[type] && typeof account.shadow[type] === "object"
          ? account.shadow[type]
          : {};

      currentMap.forEach((record, id) => {
        const nextChecksum = checksum(record);
        nextShadow[id] = nextChecksum;

        if (previousShadow[id] !== nextChecksum) {
          queueOperation(type, id, "upsert", record);
        }
      });

      Object.keys(previousShadow).forEach((id) => {
        if (!currentMap.has(id)) {
          queueOperation(type, id, "delete", null);
        }
      });
    }

    function recordLocalData(source = getData()) {
      if (!attachment || !account?.initialized) return snapshot();

      const data = normalizeData(source);
      const nextShadow = {
        products: {},
        observations: {},
        stores: {},
        app: ""
      };

      compareCollection(
        "products",
        arrayToMap(data.products, "id"),
        nextShadow.products
      );
      compareCollection(
        "observations",
        arrayToMap(data.observations, "id"),
        nextShadow.observations
      );
      compareCollection(
        "stores",
        arrayToMap(data.stores, "storeId"),
        nextShadow.stores
      );

      const appRecord = appRecordForData(data);
      nextShadow.app = checksum(appRecord);

      if (account.shadow.app !== nextShadow.app) {
        queueOperation("app", "state", "upsert", appRecord);
      }

      account.shadow = nextShadow;
      persistAccount();

      emit({
        phase: navigator.onLine ? "pending" : "offline",
        pendingCount: Object.keys(account.queue).length,
        localCounts: countData(data),
        lastError: null
      });

      scheduleFlush();
      return snapshot();
    }

    function cloudWrapper(record, deleted = false) {
      const firestoreApi = attachment.services.modules.firestore;

      return {
        record: deleted ? null : cloneJson(record),
        deleted,
        updatedByDevice: state.deviceId,
        updatedAtClient: new Date().toISOString(),
        updatedAtCloud: firestoreApi.serverTimestamp()
      };
    }

    async function commitOperations(operations, chunkSize = 400) {
      const firestoreApi = attachment.services.modules.firestore;
      const firestore = attachment.services.firestore;

      for (let index = 0; index < operations.length; index += chunkSize) {
        const chunk = operations.slice(index, index + chunkSize);
        const batch = firestoreApi.writeBatch(firestore);

        chunk.forEach((operation) => {
          if (operation.action === "delete") {
            batch.delete(operation.ref);
          } else {
            batch.set(operation.ref, operation.data);
          }
        });

        await batch.commit();
      }
    }

    async function fetchCloudSnapshot() {
      if (!attachment) throw new Error("Cloud sync is not attached");

      const firestoreApi = attachment.services.modules.firestore;
      const firestore = attachment.services.firestore;
      const basePath = attachment.basePath;

      const productRef = firestoreApi.collection(
        firestore,
        `${basePath}/products`
      );
      const observationRef = firestoreApi.collection(
        firestore,
        `${basePath}/observations`
      );
      const storeRef = firestoreApi.collection(
        firestore,
        `${basePath}/stores`
      );
      const appRef = firestoreApi.doc(
        firestore,
        `${basePath}/app/state`
      );
      const metaRef = firestoreApi.doc(
        firestore,
        `${basePath}/sync/meta`
      );

      const [
        productSnapshot,
        observationSnapshot,
        storeSnapshot,
        appSnapshot,
        metaSnapshot
      ] = await Promise.all([
        firestoreApi.getDocs(productRef),
        firestoreApi.getDocs(observationRef),
        firestoreApi.getDocs(storeRef),
        firestoreApi.getDoc(appRef),
        firestoreApi.getDoc(metaRef)
      ]);

      function activeRecords(querySnapshot) {
        return querySnapshot.docs
          .map((documentSnapshot) => {
            const value = documentSnapshot.data() || {};
            if (value.deleted === true || !value.record) return null;
            return cloneJson(value.record);
          })
          .filter(Boolean);
      }

      const appWrapper = appSnapshot.exists()
        ? appSnapshot.data() || {}
        : {};
      const appRecord =
        appWrapper.deleted !== true &&
        appWrapper.record &&
        typeof appWrapper.record === "object"
          ? appWrapper.record
          : {};

      const source = normalizeData({
        schemaVersion: appRecord.schemaVersion,
        meta: appRecord.meta,
        settings: appRecord.settings,
        products: activeRecords(productSnapshot),
        observations: activeRecords(observationSnapshot),
        stores: activeRecords(storeSnapshot)
      });

      const counts = countData(source);
      const metaData = metaSnapshot.exists()
        ? metaSnapshot.data() || {}
        : {};
      const cloudInitialized =
        metaData.initialized === true || totalCount(counts) > 0;

      return {
        data: source,
        counts,
        cloudInitialized,
        allDocumentRefs: [
          ...productSnapshot.docs.map((item) => item.ref),
          ...observationSnapshot.docs.map((item) => item.ref),
          ...storeSnapshot.docs.map((item) => item.ref),
          ...(appSnapshot.exists() ? [appSnapshot.ref] : []),
          ...(metaSnapshot.exists() ? [metaSnapshot.ref] : [])
        ]
      };
    }

    async function inspect() {
      if (!attachment) return snapshot();

      emit({
        phase: "checking",
        syncing: false,
        lastError: null,
        localCounts: countData(getData())
      });

      try {
        const cloud = await fetchCloudSnapshot();

        emit({
          phase: account?.initialized && cloud.cloudInitialized
            ? "ready"
            : "setup-required",
          initialized:
            account?.initialized === true && cloud.cloudInitialized,
          cloudInitialized: cloud.cloudInitialized,
          cloudCounts: cloud.counts,
          pendingCount: Object.keys(account?.queue || {}).length,
          lastSyncAt: account?.lastSyncAt || "",
          lastError: null
        });

        return cloud;
      } catch (error) {
        if (wasInitialized) startListeners();
        emit({
          phase: "error",
          syncing: false,
          lastError: {
            code: cleanString(error?.code) || "cloud-sync/inspect-failed",
            message:
              cleanString(error?.message) ||
              "未能讀取雲端資料狀態。"
          }
        });
        throw error;
      }
    }

    function stopListeners() {
      listenerUnsubscribes.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.warn("Cloud sync listener cleanup failed:", error);
        }
      });

      listenerUnsubscribes = [];
    }

    function replaceCollectionRecord(data, type, id, wrapper) {
      const fieldByType = {
        products: "id",
        observations: "id",
        stores: "storeId"
      };
      const field = fieldByType[type];
      if (!field) return false;

      const collection = Array.isArray(data[type]) ? data[type] : [];
      const index = collection.findIndex(
        (record) => cleanString(record?.[field]) === id
      );

      if (wrapper.deleted === true || !wrapper.record) {
        if (index < 0) return false;
        collection.splice(index, 1);
        data[type] = collection;
        return true;
      }

      const nextRecord = cloneJson(wrapper.record);
      if (index >= 0) {
        if (checksum(collection[index]) === checksum(nextRecord)) return false;
        collection[index] = nextRecord;
      } else {
        collection.push(nextRecord);
      }

      data[type] = collection;
      return true;
    }

    function applyRemoteCollectionSnapshot(type, querySnapshot) {
      if (!attachment || !account?.initialized) return;

      const data = normalizeData(getData());
      let changed = false;

      querySnapshot.docChanges().forEach((change) => {
        const id = cleanString(change.doc.id);
        if (!id) return;

        const key = recordKey(type, id);
        const wrapper =
          change.type === "removed"
            ? { deleted: true, record: null }
            : change.doc.data() || {};

        if (account.queue[key]) return;

        if (wrapper.updatedByDevice === state.deviceId) {
          if (wrapper.deleted === true || !wrapper.record) {
            delete account.shadow[type][id];
          } else {
            account.shadow[type][id] = checksum(wrapper.record);
          }
          return;
        }

        if (replaceCollectionRecord(data, type, id, wrapper)) {
          changed = true;
        }

        if (wrapper.deleted === true || !wrapper.record) {
          delete account.shadow[type][id];
        } else {
          account.shadow[type][id] = checksum(wrapper.record);
        }
      });

      if (!changed) {
        persistAccount();
        return;
      }

      const normalized = normalizeData(data);
      account.lastSyncAt = new Date().toISOString();
      persistAccount();
      applyData(normalized, {
        source: "cloud",
        reason: `remote-${type}`
      });

      emit({
        phase: Object.keys(account.queue).length ? "pending" : "ready",
        localCounts: countData(normalized),
        cloudCounts: countData(normalized),
        lastSyncAt: account.lastSyncAt,
        pendingCount: Object.keys(account.queue).length,
        lastError: null
      });
    }

    function applyRemoteAppSnapshot(documentSnapshot) {
      if (!attachment || !account?.initialized) return;

      const key = recordKey("app", "state");
      if (account.queue[key]) return;

      const wrapper = documentSnapshot.exists()
        ? documentSnapshot.data() || {}
        : { deleted: true, record: null };

      if (wrapper.updatedByDevice === state.deviceId) {
        account.shadow.app =
          wrapper.deleted === true || !wrapper.record
            ? ""
            : checksum(wrapper.record);
        persistAccount();
        return;
      }

      if (wrapper.deleted === true || !wrapper.record) return;

      const current = normalizeData(getData());
      const appRecord = wrapper.record;
      const next = normalizeData({
        ...current,
        schemaVersion: appRecord.schemaVersion,
        meta: appRecord.meta,
        settings: appRecord.settings
      });

      const nextChecksum = checksum(appRecord);
      if (account.shadow.app === nextChecksum) return;

      account.shadow.app = nextChecksum;
      account.lastSyncAt = new Date().toISOString();
      persistAccount();

      applyData(next, {
        source: "cloud",
        reason: "remote-app"
      });

      emit({
        phase: Object.keys(account.queue).length ? "pending" : "ready",
        localCounts: countData(next),
        cloudCounts: countData(next),
        lastSyncAt: account.lastSyncAt,
        pendingCount: Object.keys(account.queue).length,
        lastError: null
      });
    }

    function handleListenerError(error) {
      emit({
        phase: "error",
        syncing: false,
        lastError: {
          code: cleanString(error?.code) || "cloud-sync/listener-failed",
          message:
            cleanString(error?.message) ||
            "雲端即時同步暫時中斷。"
        }
      });
    }

    function startListeners() {
      stopListeners();
      if (!attachment || !account?.initialized) return;

      const firestoreApi = attachment.services.modules.firestore;
      const firestore = attachment.services.firestore;
      const basePath = attachment.basePath;

      ["products", "observations", "stores"].forEach((type) => {
        const reference = firestoreApi.collection(
          firestore,
          `${basePath}/${type}`
        );

        listenerUnsubscribes.push(
          firestoreApi.onSnapshot(
            reference,
            { includeMetadataChanges: true },
            (querySnapshot) => {
              applyRemoteCollectionSnapshot(type, querySnapshot);
            },
            handleListenerError
          )
        );
      });

      const appRef = firestoreApi.doc(
        firestore,
        `${basePath}/app/state`
      );

      listenerUnsubscribes.push(
        firestoreApi.onSnapshot(
          appRef,
          { includeMetadataChanges: true },
          applyRemoteAppSnapshot,
          handleListenerError
        )
      );
    }

    async function initializeFromLocal() {
      if (!attachment || !account) {
        throw new Error("Cloud sync is not attached");
      }

      const wasInitialized = account.initialized === true;
      stopListeners();
      emit({
        phase: "initializing-upload",
        syncing: true,
        lastError: null
      });

      try {
        const existing = await fetchCloudSnapshot();
        const firestoreApi = attachment.services.modules.firestore;
        const firestore = attachment.services.firestore;
        const localData = normalizeData(getData());

        if (existing.cloudInitialized) {
          createSafetyBackup(existing.data, {
            reason: "before-cloud-replace-existing",
            createdAt: new Date().toISOString()
          });
        }
        createSafetyBackup(localData, {
          reason: "before-cloud-replace-local",
          createdAt: new Date().toISOString()
        });

        const operations = existing.allDocumentRefs.map((ref) => ({
          action: "delete",
          ref
        }));

        const recordGroups = [
          ["products", "id", localData.products],
          ["observations", "id", localData.observations],
          ["stores", "storeId", localData.stores]
        ];

        recordGroups.forEach(([type, idField, records]) => {
          (Array.isArray(records) ? records : []).forEach((record) => {
            const id = cleanString(record?.[idField]);
            if (!id) return;

            operations.push({
              action: "set",
              ref: firestoreApi.doc(
                firestore,
                recordPath(type, id)
              ),
              data: cloudWrapper(record, false)
            });
          });
        });

        operations.push({
          action: "set",
          ref: firestoreApi.doc(
            firestore,
            recordPath("app", "state")
          ),
          data: cloudWrapper(appRecordForData(localData), false)
        });

        operations.push({
          action: "set",
          ref: firestoreApi.doc(
            firestore,
            `${attachment.basePath}/sync/meta`
          ),
          data: {
            initialized: true,
            schemaVersion: Number(localData.schemaVersion || 1),
            initializedByDevice: state.deviceId,
            initializedAt: firestoreApi.serverTimestamp(),
            updatedAt: firestoreApi.serverTimestamp()
          }
        });

        await commitOperations(operations);

        account.initialized = true;
        account.queue = {};
        account.shadow = buildShadow(localData);
        account.lastSyncAt = new Date().toISOString();
        persistAccount();
        startListeners();

        return emit({
          phase: "ready",
          initialized: true,
          cloudInitialized: true,
          syncing: false,
          pendingCount: 0,
          localCounts: countData(localData),
          cloudCounts: countData(localData),
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });
      } catch (error) {
        emit({
          phase: "error",
          syncing: false,
          lastError: {
            code:
              cleanString(error?.code) ||
              "cloud-sync/upload-initialization-failed",
            message:
              cleanString(error?.message) ||
              "未能以上載方式建立雲端資料。"
          }
        });
        throw error;
      }
    }

    async function initializeFromCloud() {
      if (!attachment || !account) {
        throw new Error("Cloud sync is not attached");
      }

      const wasInitialized = account.initialized === true;
      stopListeners();
      emit({
        phase: "initializing-download",
        syncing: true,
        lastError: null
      });

      try {
        const cloud = await fetchCloudSnapshot();

        if (!cloud.cloudInitialized) {
          const error = new Error("雲端暫時冇可下載資料。");
          error.code = "cloud-sync/cloud-empty";
          throw error;
        }

        createSafetyBackup(getData(), {
          reason: "before-cloud-download",
          createdAt: new Date().toISOString()
        });

        const nextData = normalizeData(cloud.data);
        applyData(nextData, {
          source: "cloud",
          reason: "initial-download"
        });

        account.initialized = true;
        account.queue = {};
        account.shadow = buildShadow(nextData);
        account.lastSyncAt = new Date().toISOString();
        persistAccount();
        startListeners();

        return emit({
          phase: "ready",
          initialized: true,
          cloudInitialized: true,
          syncing: false,
          pendingCount: 0,
          localCounts: countData(nextData),
          cloudCounts: cloud.counts,
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });
      } catch (error) {
        if (wasInitialized) startListeners();
        emit({
          phase: "error",
          syncing: false,
          lastError: {
            code:
              cleanString(error?.code) ||
              "cloud-sync/download-initialization-failed",
            message:
              cleanString(error?.message) ||
              "未能由雲端設定此裝置。"
          }
        });
        throw error;
      }
    }

    async function flush() {
      if (
        !attachment ||
        !account?.initialized ||
        flushInProgress
      ) {
        return snapshot();
      }

      if (!navigator.onLine) {
        return emit({
          phase: "offline",
          syncing: false,
          pendingCount: Object.keys(account.queue).length
        });
      }

      const entries = Object.values(account.queue);
      if (!entries.length) {
        return emit({
          phase: "ready",
          syncing: false,
          pendingCount: 0,
          lastError: null
        });
      }

      flushInProgress = true;
      emit({
        phase: "syncing",
        syncing: true,
        pendingCount: entries.length,
        lastError: null
      });

      try {
        const firestoreApi = attachment.services.modules.firestore;
        const firestore = attachment.services.firestore;

        const operations = entries.map((entry) => ({
          action: "set",
          ref: firestoreApi.doc(
            firestore,
            recordPath(entry.type, entry.id)
          ),
          data: cloudWrapper(
            entry.record,
            entry.operation === "delete"
          )
        }));

        await commitOperations(operations);

        entries.forEach((entry) => {
          if (account.queue[entry.key]?.token === entry.token) {
            delete account.queue[entry.key];
          }
        });

        account.lastSyncAt = new Date().toISOString();
        persistAccount();

        emit({
          phase: Object.keys(account.queue).length ? "pending" : "ready",
          syncing: false,
          pendingCount: Object.keys(account.queue).length,
          localCounts: countData(getData()),
          cloudCounts: countData(getData()),
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });
      } catch (error) {
        emit({
          phase: navigator.onLine ? "error" : "offline",
          syncing: false,
          pendingCount: Object.keys(account.queue).length,
          lastError: {
            code:
              cleanString(error?.code) ||
              "cloud-sync/write-failed",
            message:
              cleanString(error?.message) ||
              "資料已保存在本機，稍後會自動再同步。"
          }
        });
      } finally {
        flushInProgress = false;
      }

      if (Object.keys(account.queue).length && navigator.onLine) {
        scheduleFlush(1200);
      }

      return snapshot();
    }

    function scheduleFlush(delay = 500) {
      global.clearTimeout(flushTimer);
      flushTimer = global.setTimeout(() => {
        flush().catch((error) => {
          console.warn("Cloud sync retry failed:", error);
        });
      }, delay);
    }

    async function attach(options = {}) {
      const token = ++attachToken;
      const projectId = cleanString(options.projectId);
      const uid = cleanString(options.uid);
      const basePath = cleanString(options.basePath);
      const services = options.services;

      if (
        !projectId ||
        !uid ||
        !basePath ||
        !services?.firestore ||
        !services?.modules?.firestore
      ) {
        throw new Error("Cloud sync attachment is incomplete");
      }

      const nextKey = accountPathKey(projectId, uid);
      if (
        attachment &&
        accountKey === nextKey &&
        attachment.basePath === basePath
      ) {
        return inspect();
      }

      stopListeners();
      global.clearTimeout(flushTimer);
      attachment = {
        projectId,
        uid,
        basePath,
        services
      };
      accountKey = nextKey;
      account = loadAccount(accountKey);

      emit({
        attached: true,
        phase: "checking",
        initialized: false,
        cloudInitialized: false,
        syncing: false,
        projectId,
        uid,
        pendingCount: Object.keys(account.queue).length,
        localCounts: countData(getData()),
        lastSyncAt: account.lastSyncAt,
        lastError: null
      });

      const cloud = await inspect();
      if (token !== attachToken) return snapshot();

      if (account.initialized && cloud.cloudInitialized) {
        if (
          !account.shadow.app &&
          !Object.keys(account.shadow.products).length &&
          !Object.keys(account.shadow.observations).length &&
          !Object.keys(account.shadow.stores).length
        ) {
          account.shadow = buildShadow(getData());
          persistAccount();
        }

        startListeners();
        emit({
          phase: Object.keys(account.queue).length
            ? navigator.onLine
              ? "pending"
              : "offline"
            : "ready",
          initialized: true,
          cloudInitialized: true,
          pendingCount: Object.keys(account.queue).length,
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });
        scheduleFlush(100);
      }

      return snapshot();
    }

    let deferredClearPatch = null;

    async function clearCloud(options = {}) {
      if (!attachment || !account) {
        throw new Error("Cloud sync is not attached");
      }

      const deferStatus = options.deferStatus === true;
      const wasInitialized = account.initialized === true;
      stopListeners();
      emit({
        phase: "clearing-cloud",
        syncing: true,
        lastError: null
      });

      try {
        const cloud = await fetchCloudSnapshot();
        const localData = normalizeData(getData());

        if (cloud.cloudInitialized) {
          createSafetyBackup(cloud.data, {
            reason: "before-cloud-clear-cloud-copy",
            createdAt: new Date().toISOString()
          });
        }
        createSafetyBackup(localData, {
          reason: "before-cloud-clear-local-copy",
          createdAt: new Date().toISOString()
        });

        await commitOperations(
          cloud.allDocumentRefs.map((ref) => ({
            action: "delete",
            ref
          }))
        );

        account.initialized = false;
        account.queue = {};
        account.shadow = emptyShadow();
        account.lastSyncAt = new Date().toISOString();
        persistAccount();

        deferredClearPatch = {
          phase: "setup-required",
          initialized: false,
          cloudInitialized: false,
          syncing: false,
          pendingCount: 0,
          localCounts: countData(localData),
          cloudCounts: {
            products: 0,
            observations: 0,
            stores: 0
          },
          lastSyncAt: account.lastSyncAt,
          lastError: null
        };

        if (!deferStatus) {
          const patch = deferredClearPatch;
          deferredClearPatch = null;
          return emit(patch);
        }

        return {
          deferred: true,
          cloudCounts: cloud.counts,
          localCounts: countData(localData)
        };
      } catch (error) {
        deferredClearPatch = null;
        if (wasInitialized) startListeners();
        emit({
          phase: "error",
          syncing: false,
          lastError: {
            code:
              cleanString(error?.code) ||
              "cloud-sync/clear-failed",
            message:
              cleanString(error?.message) ||
              "未能清空 Cloud 文字資料。"
          }
        });
        throw error;
      }
    }

    function finalizeClearCloud(lastError = null) {
      const patch = deferredClearPatch || {
        phase: "setup-required",
        initialized: false,
        cloudInitialized: false,
        syncing: false,
        pendingCount: 0,
        localCounts: countData(getData()),
        cloudCounts: {
          products: 0,
          observations: 0,
          stores: 0
        },
        lastSyncAt: account?.lastSyncAt || new Date().toISOString(),
        lastError: null
      };
      deferredClearPatch = null;

      if (lastError) {
        patch.lastError = {
          code:
            cleanString(lastError?.code) ||
            "cloud-sync/image-clear-incomplete",
          message:
            cleanString(lastError?.message) ||
            "Cloud 文字資料已清空，但部分舊圖片可能仍留在 Storage。"
        };
      }

      return emit(patch);
    }

    async function detach() {
      attachToken += 1;
      stopListeners();
      global.clearTimeout(flushTimer);
      attachment = null;
      account = null;
      accountKey = "";
      flushInProgress = false;

      return emit({
        attached: false,
        phase: "detached",
        initialized: false,
        cloudInitialized: false,
        syncing: false,
        pendingCount: 0,
        localCounts: countData(getData()),
        cloudCounts: {
          products: 0,
          observations: 0,
          stores: 0
        },
        lastSyncAt: "",
        lastError: null,
        projectId: "",
        uid: ""
      });
    }

    async function refresh() {
      const cloud = await inspect();

      if (account?.initialized && cloud.cloudInitialized) {
        startListeners();
        scheduleFlush(100);
      }

      return snapshot();
    }

    async function forceSync() {
      recordLocalData(getData());
      return flush();
    }

    global.addEventListener("online", () => {
      emit({
        phase:
          account?.initialized && Object.keys(account.queue).length
            ? "pending"
            : state.phase,
        online: true
      });
      scheduleFlush(100);
    });

    global.addEventListener("offline", () => {
      emit({
        phase: account?.initialized ? "offline" : state.phase,
        online: false,
        syncing: false
      });
    });

    return Object.freeze({
      attach,
      detach,
      inspect,
      refresh,
      initializeFromLocal,
      initializeFromCloud,
      clearCloud,
      finalizeClearCloud,
      recordLocalData,
      forceSync,
      flush,
      subscribe,
      getStatus: snapshot,
      getDeviceId: () => state.deviceId,
      countData
    });
  }

  global.PriceTrackerCloudSyncService = Object.freeze({ create });
})(window);
