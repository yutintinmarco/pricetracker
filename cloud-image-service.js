(function (global) {
  "use strict";

  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
      options.storageKey || "barcode-price-tracker-cloud-images-v1"
    );
    const deviceStorageKey = cleanString(
      options.deviceStorageKey || "barcode-price-tracker-device-id-v1"
    );

    const getData = requireFunction(options.getData, "getData");
    const getBlob = requireFunction(options.getBlob, "getBlob");
    const saveBlob = requireFunction(options.saveBlob, "saveBlob");
    const removeBlob = requireFunction(options.removeBlob, "removeBlob");
    const clearAllBlobs = requireFunction(
      options.clearAllBlobs,
      "clearAllBlobs"
    );
    const onCacheCleared =
      typeof options.onCacheCleared === "function"
        ? options.onCacheCleared
        : () => {};
    const onImageAvailable =
      typeof options.onImageAvailable === "function"
        ? options.onImageAvailable
        : () => {};

    let attachment = null;
    let account = null;
    let accountKey = "";
    let flushTimer = 0;
    let flushInProgress = false;
    let attachToken = 0;

    const listeners = new Set();

    let state = {
      attached: false,
      phase: "detached",
      syncing: false,
      online: navigator.onLine,
      referencedCount: 0,
      cachedCount: 0,
      missingLocalCount: 0,
      remoteCount: 0,
      remoteProductCount: 0,
      remoteStoreCount: 0,
      pendingCount: 0,
      uploadedCount: 0,
      downloadedCount: 0,
      deletedCount: 0,
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

    function normalizeMap(source) {
      return source && typeof source === "object" && !Array.isArray(source)
        ? source
        : {};
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
        queue: normalizeMap(saved.queue),
        references: normalizeMap(saved.references),
        synced: normalizeMap(saved.synced),
        lastSyncAt: cleanString(saved.lastSyncAt),
        uploadedCount: Number(saved.uploadedCount || 0),
        downloadedCount: Number(saved.downloadedCount || 0),
        deletedCount: Number(saved.deletedCount || 0),
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
          console.warn("Cloud image listener failed:", error);
        }
      });

      return current;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Cloud image listener must be a function");
      }

      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    function accountPathKey(projectId, uid) {
      return `${cleanString(projectId)}::${cleanString(uid)}`;
    }

    function referenceKey(type, imageKey) {
      return `${type}:${imageKey}`;
    }

    function normalizeType(type) {
      return type === "stores" ? "stores" : "products";
    }

    function buildReferences(source = getData()) {
      const data = source && typeof source === "object" ? source : {};
      const result = {};

      (Array.isArray(data.products) ? data.products : []).forEach((product) => {
        const imageKey = cleanString(
          product?.productImageKey || product?.imageKey
        );
        if (!imageKey) return;

        const type = "products";
        result[referenceKey(type, imageKey)] = {
          type,
          imageKey,
          version: cleanString(
            product?.productImageUpdatedAt || imageKey
          )
        };
      });

      (Array.isArray(data.stores) ? data.stores : []).forEach((store) => {
        const imageKey = cleanString(store?.logoKey);
        if (!imageKey) return;

        const type = "stores";
        result[referenceKey(type, imageKey)] = {
          type,
          imageKey,
          version: cleanString(store?.logoUpdatedAt || imageKey)
        };
      });

      return result;
    }

    function queueOperation(operation, reference) {
      if (!account) return;

      const type = normalizeType(reference.type);
      const imageKey = cleanString(reference.imageKey);
      if (!imageKey) return;

      const key = referenceKey(type, imageKey);
      account.queue[key] = {
        key,
        operation,
        type,
        imageKey,
        version: cleanString(reference.version || imageKey),
        queuedAt: new Date().toISOString(),
        token: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      };
    }

    function objectPath(type, imageKey) {
      if (!attachment) throw new Error("Cloud image sync is not attached");

      return `${attachment.basePath}/images/${normalizeType(type)}/${imageKey}`;
    }

    function isObjectNotFound(error) {
      return [
        "storage/object-not-found",
        "storage/object_not_found"
      ].includes(cleanString(error?.code));
    }

    function friendlyError(error, fallback) {
      const code = cleanString(error?.code) || "cloud-images/failed";
      let message = cleanString(error?.message) || fallback;

      if (code === "storage/unauthorized") {
        message =
          "Cloud Storage 未獲授權。請確認 Storage Rules 已發布，帳戶亦已獲批准。";
      } else if (
        code === "storage/bucket-not-found" ||
        code === "storage/unknown"
      ) {
        message =
          "Cloud Storage 尚未完成設定，或者 Storage bucket 暫時不可用。";
      } else if (code === "storage/quota-exceeded") {
        message = "Cloud Storage 配額已用完，圖片暫時只保存在本機。";
      }

      return { code, message };
    }

    async function countCached(references) {
      let cached = 0;

      for (const reference of Object.values(references)) {
        try {
          if (await getBlob(reference.imageKey)) cached += 1;
        } catch (error) {
          // A failed local lookup is treated as not cached.
        }
      }

      return cached;
    }

    async function inspectLocalReferences(references = buildReferences()) {
      let cachedCount = 0;
      const missing = [];

      for (const reference of Object.values(references)) {
        try {
          const blob = await getBlob(reference.imageKey);
          if (blob) cachedCount += 1;
          else missing.push(reference);
        } catch (error) {
          missing.push(reference);
        }
      }

      return {
        referencedCount: Object.keys(references).length,
        cachedCount,
        missingLocalCount: missing.length,
        missing
      };
    }

    async function listRemoteObjects() {
      if (!attachment) {
        throw new Error("Cloud image sync is not attached");
      }

      const storageApi = attachment.services.modules.storage;
      const storageService = attachment.services.storage;
      const result = {
        products: [],
        stores: [],
        all: []
      };

      for (const type of ["products", "stores"]) {
        const folderRef = storageApi.ref(
          storageService,
          `${attachment.basePath}/images/${type}`
        );
        const listing = await storageApi.listAll(folderRef);
        result[type] = Array.isArray(listing?.items)
          ? listing.items
          : [];
        result.all.push(...result[type]);
      }

      return result;
    }

    async function inspectCloud() {
      if (!attachment || !account) return snapshot();

      emit({
        phase: "inspecting",
        syncing: true,
        lastError: null
      });

      try {
        const references = buildReferences();
        const local = await inspectLocalReferences(references);
        const remote = await listRemoteObjects();

        return emit({
          phase: Object.keys(account.queue).length ? "pending" : "ready",
          syncing: false,
          referencedCount: local.referencedCount,
          cachedCount: local.cachedCount,
          missingLocalCount: local.missingLocalCount,
          remoteCount: remote.all.length,
          remoteProductCount: remote.products.length,
          remoteStoreCount: remote.stores.length,
          pendingCount: Object.keys(account.queue).length,
          lastError: null
        });
      } catch (error) {
        emit({
          phase: "error",
          syncing: false,
          lastError: friendlyError(
            error,
            "未能檢查 Cloud 圖片狀態。"
          )
        });
        throw error;
      }
    }

    async function uploadReference(reference, blob) {
      const storageApi = attachment.services.modules.storage;
      const storageService = attachment.services.storage;
      const objectRef = storageApi.ref(
        storageService,
        objectPath(reference.type, reference.imageKey)
      );

      await storageApi.uploadBytes(objectRef, blob, {
        contentType: blob.type || "application/octet-stream",
        customMetadata: {
          imageKey: reference.imageKey,
          imageType: reference.type,
          imageVersion: reference.version,
          updatedByDevice: state.deviceId
        }
      });
    }

    async function uploadAllFromLocal(options = {}) {
      if (!attachment || !account) {
        throw new Error("Cloud image sync is not attached");
      }

      const prune = options.prune === true;
      const references = buildReferences();
      const local = await inspectLocalReferences(references);

      if (local.missingLocalCount) {
        const error = new Error(
          `此裝置有 ${local.missingLocalCount} 張圖片未有本機快取，未能用作完整 Cloud 主版本。`
        );
        error.code = "cloud-images/local-images-missing";
        error.missingCount = local.missingLocalCount;
        throw error;
      }

      emit({
        phase: "recovery-uploading",
        syncing: true,
        referencedCount: local.referencedCount,
        cachedCount: local.cachedCount,
        missingLocalCount: 0,
        lastError: null
      });

      try {
        let uploaded = 0;
        for (const reference of Object.values(references)) {
          const blob = await getBlob(reference.imageKey);
          if (!blob) continue;
          if (blob.size > MAX_IMAGE_BYTES) {
            const error = new Error("圖片超過 2MB，未能上載。");
            error.code = "cloud-images/file-too-large";
            throw error;
          }
          await uploadReference(reference, blob);
          account.synced[referenceKey(reference.type, reference.imageKey)] = {
            version: reference.version,
            direction: "upload",
            syncedAt: new Date().toISOString()
          };
          uploaded += 1;
        }

        account.references = references;
        account.queue = {};
        account.uploadedCount += uploaded;
        account.lastSyncAt = new Date().toISOString();
        persistAccount();

        if (prune) await pruneCloudToLocal();
        else await inspectCloud();

        return snapshot();
      } catch (error) {
        emit({
          phase: "error",
          syncing: false,
          lastError: friendlyError(
            error,
            "未能完整上載此裝置圖片。"
          )
        });
        throw error;
      }
    }

    async function pruneCloudToLocal() {
      if (!attachment || !account) {
        throw new Error("Cloud image sync is not attached");
      }

      emit({
        phase: "recovery-pruning",
        syncing: true,
        lastError: null
      });

      try {
        const references = buildReferences();
        const desiredPaths = new Set(
          Object.values(references).map((reference) =>
            objectPath(reference.type, reference.imageKey)
          )
        );
        const remote = await listRemoteObjects();
        const storageApi = attachment.services.modules.storage;
        let deleted = 0;

        for (const item of remote.all) {
          const fullPath = cleanString(item?.fullPath || item?.path);
          if (desiredPaths.has(fullPath)) continue;
          await storageApi.deleteObject(item);
          deleted += 1;
        }

        account.references = references;
        account.queue = {};
        account.deletedCount += deleted;
        account.lastSyncAt = new Date().toISOString();
        persistAccount();
        return inspectCloud();
      } catch (error) {
        emit({
          phase: "error",
          syncing: false,
          lastError: friendlyError(
            error,
            "未能清理 Cloud 舊圖片。"
          )
        });
        throw error;
      }
    }

    async function rebuildLocalFromCloud() {
      if (!attachment || !account) {
        throw new Error("Cloud image sync is not attached");
      }

      const references = buildReferences();
      emit({
        phase: "recovery-downloading",
        syncing: true,
        referencedCount: Object.keys(references).length,
        cachedCount: 0,
        missingLocalCount: Object.keys(references).length,
        lastError: null
      });

      try {
        await clearAllBlobs();
        onCacheCleared();
        account.queue = {};
        account.references = references;
        account.synced = {};
        persistAccount();

        let downloaded = 0;
        for (const reference of Object.values(references)) {
          const key = referenceKey(reference.type, reference.imageKey);
          await processDownload({
            key,
            operation: "download",
            type: reference.type,
            imageKey: reference.imageKey,
            version: reference.version,
            token: `recovery_${Date.now()}_${downloaded}`
          });
          downloaded += 1;
        }

        account.queue = {};
        account.downloadedCount += 0;
        account.lastSyncAt = new Date().toISOString();
        persistAccount();
        await inspectCloud();
        return snapshot();
      } catch (error) {
        account.references = references;
        account.queue = {};
        Object.values(references).forEach((reference) => {
          queueOperation("download", reference);
        });
        persistAccount();
        emit({
          phase: "error",
          syncing: false,
          pendingCount: Object.keys(account.queue).length,
          lastError: friendlyError(
            error,
            "本機快取已清除，但部分圖片未能重新下載；恢復網絡後會再試。"
          )
        });
        scheduleFlush(10000);
        throw error;
      }
    }

    async function clearCloud() {
      if (!attachment || !account) {
        throw new Error("Cloud image sync is not attached");
      }

      emit({
        phase: "recovery-clearing",
        syncing: true,
        lastError: null
      });

      try {
        const remote = await listRemoteObjects();
        const storageApi = attachment.services.modules.storage;
        for (const item of remote.all) {
          await storageApi.deleteObject(item);
        }

        account.queue = {};
        account.references = {};
        account.synced = {};
        account.deletedCount += remote.all.length;
        account.lastSyncAt = new Date().toISOString();
        persistAccount();

        return emit({
          phase: "ready",
          syncing: false,
          referencedCount: 0,
          remoteCount: 0,
          remoteProductCount: 0,
          remoteStoreCount: 0,
          pendingCount: 0,
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });
      } catch (error) {
        emit({
          phase: "error",
          syncing: false,
          lastError: friendlyError(
            error,
            "未能清空 Cloud 圖片。"
          )
        });
        throw error;
      }
    }

    async function syncReferences(source = getData(), context = {}) {
      if (!attachment || !account) return snapshot();

      const nextReferences = buildReferences(source);
      const previousReferences = normalizeMap(account.references);
      const sourceIsCloud = context.source === "cloud";

      for (const [key, previous] of Object.entries(previousReferences)) {
        if (nextReferences[key]) continue;

        if (sourceIsCloud) {
          try {
            await removeBlob(previous.imageKey);
          } catch (error) {
            // Unreferenced local blobs are harmless.
          }
          delete account.synced[key];
          delete account.queue[key];
        } else {
          queueOperation("delete", previous);
        }
      }

      for (const [key, reference] of Object.entries(nextReferences)) {
        const previous = previousReferences[key];
        let localBlob = null;

        try {
          localBlob = await getBlob(reference.imageKey);
        } catch (error) {
          localBlob = null;
        }

        const synced = account.synced[key];
        const versionChanged =
          !previous ||
          cleanString(previous.version) !== cleanString(reference.version);
        const notSynced =
          !synced ||
          cleanString(synced.version) !== cleanString(reference.version);

        if (sourceIsCloud && versionChanged) {
          queueOperation("download", reference);
          continue;
        }

        if (localBlob && (versionChanged || notSynced)) {
          queueOperation("upload", reference);
        } else if (!localBlob) {
          queueOperation("download", reference);
        }
      }

      account.references = nextReferences;
      persistAccount();

      const localStatus = await inspectLocalReferences(nextReferences);

      emit({
        phase: Object.keys(account.queue).length
          ? navigator.onLine
            ? "pending"
            : "offline"
          : "ready",
        referencedCount: Object.keys(nextReferences).length,
        cachedCount: localStatus.cachedCount,
        missingLocalCount: localStatus.missingLocalCount,
        pendingCount: Object.keys(account.queue).length,
        uploadedCount: account.uploadedCount,
        downloadedCount: account.downloadedCount,
        deletedCount: account.deletedCount,
        lastSyncAt: account.lastSyncAt,
        lastError: null
      });

      scheduleFlush(120);
      return snapshot();
    }

    async function processUpload(entry) {
      const localBlob = await getBlob(entry.imageKey);
      if (!localBlob) {
        queueOperation("download", entry);
        return false;
      }

      if (localBlob.size > MAX_IMAGE_BYTES) {
        const error = new Error("圖片超過 2MB，未能上載。");
        error.code = "cloud-images/file-too-large";
        throw error;
      }

      const storageApi = attachment.services.modules.storage;
      const storageService = attachment.services.storage;
      const objectRef = storageApi.ref(
        storageService,
        objectPath(entry.type, entry.imageKey)
      );

      await storageApi.uploadBytes(objectRef, localBlob, {
        contentType: localBlob.type || "application/octet-stream",
        customMetadata: {
          imageKey: entry.imageKey,
          imageType: entry.type,
          imageVersion: entry.version,
          updatedByDevice: state.deviceId
        }
      });

      account.synced[entry.key] = {
        version: entry.version,
        direction: "upload",
        syncedAt: new Date().toISOString()
      };
      account.uploadedCount += 1;
      return true;
    }

    async function processDownload(entry) {
      const localBlob = await getBlob(entry.imageKey);
      const synced = account.synced[entry.key];

      if (
        localBlob &&
        synced &&
        cleanString(synced.version) === cleanString(entry.version)
      ) {
        return true;
      }

      const storageApi = attachment.services.modules.storage;
      const storageService = attachment.services.storage;
      const objectRef = storageApi.ref(
        storageService,
        objectPath(entry.type, entry.imageKey)
      );

      const downloadedBlob = await storageApi.getBlob(
        objectRef,
        MAX_IMAGE_BYTES
      );

      await saveBlob(entry.imageKey, downloadedBlob, {
        updatedAt: new Date().toISOString(),
        source: "cloud",
        imageType: entry.type,
        imageVersion: entry.version
      });

      account.synced[entry.key] = {
        version: entry.version,
        direction: "download",
        syncedAt: new Date().toISOString()
      };
      account.downloadedCount += 1;
      onImageAvailable(entry.type, entry.imageKey);
      return true;
    }

    async function processDelete(entry) {
      const storageApi = attachment.services.modules.storage;
      const storageService = attachment.services.storage;
      const objectRef = storageApi.ref(
        storageService,
        objectPath(entry.type, entry.imageKey)
      );

      try {
        await storageApi.deleteObject(objectRef);
      } catch (error) {
        if (!isObjectNotFound(error)) throw error;
      }

      try {
        await removeBlob(entry.imageKey);
      } catch (error) {
        // Remote deletion is the important part.
      }

      delete account.synced[entry.key];
      account.deletedCount += 1;
      return true;
    }

    async function processEntry(entry) {
      if (entry.operation === "delete") {
        return processDelete(entry);
      }

      if (entry.operation === "download") {
        return processDownload(entry);
      }

      return processUpload(entry);
    }

    async function flush() {
      if (
        !attachment ||
        !account ||
        flushInProgress
      ) {
        return snapshot();
      }

      const entries = Object.values(account.queue);
      if (!entries.length) {
        const cachedCount = await countCached(account.references);
        return emit({
          phase: "ready",
          syncing: false,
          cachedCount,
          pendingCount: 0,
          lastError: null
        });
      }

      if (!navigator.onLine) {
        return emit({
          phase: "offline",
          syncing: false,
          pendingCount: entries.length
        });
      }

      flushInProgress = true;
      emit({
        phase: "syncing",
        syncing: true,
        pendingCount: entries.length,
        lastError: null
      });

      let failed = null;

      for (const entry of entries) {
        try {
          const completed = await processEntry(entry);

          if (
            completed &&
            account.queue[entry.key]?.token === entry.token
          ) {
            delete account.queue[entry.key];
          }
        } catch (error) {
          failed = error;
          break;
        }
      }

      if (!failed) {
        account.lastSyncAt = new Date().toISOString();
      }

      persistAccount();
      const cachedCount = await countCached(account.references);

      if (failed) {
        emit({
          phase: navigator.onLine ? "error" : "offline",
          syncing: false,
          cachedCount,
          pendingCount: Object.keys(account.queue).length,
          uploadedCount: account.uploadedCount,
          downloadedCount: account.downloadedCount,
          deletedCount: account.deletedCount,
          lastSyncAt: account.lastSyncAt,
          lastError: friendlyError(
            failed,
            "圖片已保存在本機，稍後會自動再同步。"
          )
        });

        scheduleFlush(10000);
      } else {
        emit({
          phase: Object.keys(account.queue).length ? "pending" : "ready",
          syncing: false,
          cachedCount,
          pendingCount: Object.keys(account.queue).length,
          uploadedCount: account.uploadedCount,
          downloadedCount: account.downloadedCount,
          deletedCount: account.deletedCount,
          lastSyncAt: account.lastSyncAt,
          lastError: null
        });

        if (Object.keys(account.queue).length) scheduleFlush(500);
      }

      flushInProgress = false;
      return snapshot();
    }

    function scheduleFlush(delay = 500) {
      global.clearTimeout(flushTimer);
      flushTimer = global.setTimeout(() => {
        flush().catch((error) => {
          console.warn("Cloud image retry failed:", error);
        });
      }, delay);
    }

    async function ensureLocal(type, imageKey, version = "") {
      const cleanKey = cleanString(imageKey);
      if (!cleanKey) return null;

      const existing = await getBlob(cleanKey);
      if (existing) return existing;
      if (!attachment || !account) return null;

      const reference = {
        type: normalizeType(type),
        imageKey: cleanKey,
        version: cleanString(version || cleanKey)
      };

      queueOperation("download", reference);
      persistAccount();
      emit({
        phase: navigator.onLine ? "pending" : "offline",
        pendingCount: Object.keys(account.queue).length
      });

      await flush();
      return getBlob(cleanKey);
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
        !services?.storage ||
        !services?.modules?.storage
      ) {
        throw new Error("Cloud image attachment is incomplete");
      }

      const nextKey = accountPathKey(projectId, uid);
      if (
        attachment &&
        accountKey === nextKey &&
        attachment.basePath === basePath
      ) {
        return syncReferences(getData());
      }

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
        phase: "scanning",
        syncing: false,
        projectId,
        uid,
        referencedCount: 0,
        cachedCount: 0,
        missingLocalCount: 0,
        pendingCount: Object.keys(account.queue).length,
        uploadedCount: account.uploadedCount,
        downloadedCount: account.downloadedCount,
        deletedCount: account.deletedCount,
        lastSyncAt: account.lastSyncAt,
        lastError: null
      });

      await syncReferences(getData());
      if (token !== attachToken) return snapshot();

      scheduleFlush(100);
      return snapshot();
    }

    async function detach() {
      attachToken += 1;
      global.clearTimeout(flushTimer);
      attachment = null;
      account = null;
      accountKey = "";
      flushInProgress = false;

      return emit({
        attached: false,
        phase: "detached",
        syncing: false,
        referencedCount: 0,
        cachedCount: 0,
        missingLocalCount: 0,
        remoteCount: 0,
        remoteProductCount: 0,
        remoteStoreCount: 0,
        pendingCount: 0,
        uploadedCount: 0,
        downloadedCount: 0,
        deletedCount: 0,
        lastSyncAt: "",
        lastError: null,
        projectId: "",
        uid: ""
      });
    }

    async function forceSync() {
      await syncReferences(getData());
      return flush();
    }

    global.addEventListener("online", () => {
      emit({
        phase:
          account && Object.keys(account.queue).length
            ? "pending"
            : state.phase,
        online: true
      });
      scheduleFlush(100);
    });

    global.addEventListener("offline", () => {
      emit({
        phase: account ? "offline" : state.phase,
        online: false,
        syncing: false
      });
    });

    return Object.freeze({
      attach,
      detach,
      syncReferences,
      inspectCloud,
      uploadAllFromLocal,
      pruneCloudToLocal,
      rebuildLocalFromCloud,
      clearCloud,
      ensureLocal,
      forceSync,
      flush,
      subscribe,
      getStatus: snapshot
    });
  }

  global.PriceTrackerCloudImageService = Object.freeze({ create });
})(window);
