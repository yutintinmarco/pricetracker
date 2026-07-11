(function (global) {
  "use strict";

  const VALID_MODES = new Set(["local", "shared", "own"]);

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function normalizeFirebaseConfig(source) {
    const value = source && typeof source === "object" ? source : {};

    return {
      apiKey: cleanString(value.apiKey),
      authDomain: cleanString(value.authDomain),
      projectId: cleanString(value.projectId),
      storageBucket: cleanString(value.storageBucket),
      messagingSenderId: cleanString(value.messagingSenderId),
      appId: cleanString(value.appId)
    };
  }

  function isCompleteFirebaseConfig(config) {
    const normalized = normalizeFirebaseConfig(config);
    return Object.values(normalized).every(Boolean);
  }

  function create(options = {}) {
    const storage = options.storage || global.localStorage;
    const storageKey = cleanString(
      options.storageKey || "barcode-price-tracker-cloud-profile-v1"
    );

    if (!storage) throw new Error("Local storage is not available");
    if (!storageKey) throw new Error("A cloud profile storage key is required");

    function hasSavedProfile() {
      return storage.getItem(storageKey) !== null;
    }

    function normalizeProfile(source) {
      const value = source && typeof source === "object" ? source : {};
      const mode = VALID_MODES.has(value.mode) ? value.mode : "local";

      return {
        version: 1,
        mode,
        ownFirebase: normalizeFirebaseConfig(value.ownFirebase),
        updatedAt: cleanString(value.updatedAt)
      };
    }

    function load() {
      try {
        const raw = storage.getItem(storageKey);
        if (!raw) return normalizeProfile({ mode: "local" });
        return normalizeProfile(JSON.parse(raw));
      } catch (error) {
        return normalizeProfile({ mode: "local" });
      }
    }

    function save(profile) {
      const normalized = normalizeProfile({
        ...profile,
        updatedAt: new Date().toISOString()
      });
      storage.setItem(storageKey, JSON.stringify(normalized));
      return normalized;
    }

    function saveLocal() {
      const current = load();
      return save({
        ...current,
        mode: "local"
      });
    }

    function saveShared() {
      const current = load();
      return save({
        ...current,
        mode: "shared"
      });
    }

    function saveOwn(firebaseConfig) {
      return save({
        mode: "own",
        ownFirebase: normalizeFirebaseConfig(firebaseConfig)
      });
    }

    return Object.freeze({
      load,
      save,
      saveLocal,
      saveShared,
      saveOwn,
      hasSavedProfile,
      normalizeFirebaseConfig,
      isCompleteFirebaseConfig,
      getStorageKey: () => storageKey
    });
  }

  global.PriceTrackerCloudProfileService = Object.freeze({ create });
})(window);
