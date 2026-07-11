(function (global) {
  "use strict";

  const FIREBASE_SDK_VERSION = "12.15.0";
  const FIREBASE_BASE_URL =
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

  function cleanString(value) {
    return String(value ?? "").trim();
  }

  function hasRequiredFirebaseConfig(firebaseConfig) {
    if (!firebaseConfig || typeof firebaseConfig !== "object") return false;

    return [
      "apiKey",
      "authDomain",
      "projectId",
      "storageBucket",
      "messagingSenderId",
      "appId"
    ].every((key) => cleanString(firebaseConfig[key]));
  }

  function create(options = {}) {
    const config = options.config || {};
    const enabled = config.enabled === true;
    const firebaseConfig = config.firebase || {};

    let modules = null;
    let firebaseApp = null;
    let auth = null;
    let firestore = null;
    let storage = null;
    let initialized = false;
    let initializationPromise = null;
    let lastError = null;
    let currentUser = null;
    let unsubscribeAuth = null;

    const listeners = new Set();

    function getStatus() {
      return Object.freeze({
        enabled,
        configured: hasRequiredFirebaseConfig(firebaseConfig),
        initialized,
        online: navigator.onLine,
        authenticated: Boolean(currentUser),
        user: currentUser
          ? Object.freeze({
              uid: currentUser.uid,
              email: currentUser.email || "",
              displayName: currentUser.displayName || "",
              photoURL: currentUser.photoURL || ""
            })
          : null,
        lastError,
        sdkVersion: FIREBASE_SDK_VERSION
      });
    }

    function notify() {
      const status = getStatus();
      listeners.forEach((listener) => {
        try {
          listener(status);
        } catch (error) {
          console.warn("Firebase status listener failed:", error);
        }
      });
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Firebase listener must be a function");
      }

      listeners.add(listener);
      listener(getStatus());

      return () => listeners.delete(listener);
    }

    async function loadModules() {
      if (modules) return modules;

      const [
        appModule,
        authModule,
        firestoreModule,
        storageModule
      ] = await Promise.all([
        import(`${FIREBASE_BASE_URL}/firebase-app.js`),
        import(`${FIREBASE_BASE_URL}/firebase-auth.js`),
        import(`${FIREBASE_BASE_URL}/firebase-firestore.js`),
        import(`${FIREBASE_BASE_URL}/firebase-storage.js`)
      ]);

      modules = Object.freeze({
        app: appModule,
        auth: authModule,
        firestore: firestoreModule,
        storage: storageModule
      });

      return modules;
    }

    async function initialize() {
      if (initializationPromise) return initializationPromise;

      initializationPromise = (async () => {
        lastError = null;

        if (!enabled) {
          notify();
          return getStatus();
        }

        if (!hasRequiredFirebaseConfig(firebaseConfig)) {
          lastError = Object.freeze({
            code: "firebase/not-configured",
            message: "Firebase is enabled but its configuration is incomplete."
          });
          notify();
          return getStatus();
        }

        try {
          const loaded = await loadModules();

          firebaseApp = loaded.app.getApps().length
            ? loaded.app.getApp()
            : loaded.app.initializeApp(firebaseConfig);

          auth = loaded.auth.getAuth(firebaseApp);
          firestore = loaded.firestore.getFirestore(firebaseApp);
          storage = loaded.storage.getStorage(firebaseApp);

          if (config.auth?.persistence === "local") {
            await loaded.auth.setPersistence(
              auth,
              loaded.auth.browserLocalPersistence
            );
          }

          if (unsubscribeAuth) unsubscribeAuth();
          unsubscribeAuth = loaded.auth.onAuthStateChanged(
            auth,
            (user) => {
              currentUser = user || null;
              notify();
            },
            (error) => {
              lastError = Object.freeze({
                code: cleanString(error?.code) || "firebase/auth-state-error",
                message: cleanString(error?.message) || "Authentication state failed."
              });
              notify();
            }
          );

          initialized = true;
          notify();
          return getStatus();
        } catch (error) {
          initialized = false;
          lastError = Object.freeze({
            code: cleanString(error?.code) || "firebase/initialization-failed",
            message: cleanString(error?.message) || "Firebase initialization failed."
          });
          notify();
          return getStatus();
        }
      })();

      return initializationPromise;
    }

    async function requireReady() {
      await initialize();

      if (!enabled) {
        const error = new Error("Firebase is disabled.");
        error.code = "firebase/disabled";
        throw error;
      }

      if (!initialized || !auth || !firestore || !storage || !modules) {
        const error = new Error(
          lastError?.message || "Firebase is not ready."
        );
        error.code = lastError?.code || "firebase/not-ready";
        throw error;
      }

      return {
        modules,
        app: firebaseApp,
        auth,
        firestore,
        storage
      };
    }

    async function signInWithGoogle() {
      const ready = await requireReady();
      const provider = new ready.modules.auth.GoogleAuthProvider();

      try {
        return await ready.modules.auth.signInWithPopup(
          ready.auth,
          provider
        );
      } catch (error) {
        const popupFallbackCodes = new Set([
          "auth/popup-blocked",
          "auth/popup-closed-by-user",
          "auth/cancelled-popup-request",
          "auth/operation-not-supported-in-this-environment"
        ]);

        if (!popupFallbackCodes.has(error?.code)) throw error;

        await ready.modules.auth.signInWithRedirect(
          ready.auth,
          provider
        );
        return null;
      }
    }

    async function signOut() {
      const ready = await requireReady();
      await ready.modules.auth.signOut(ready.auth);
    }

    async function getRedirectResult() {
      const ready = await requireReady();
      return ready.modules.auth.getRedirectResult(ready.auth);
    }

    function getServices() {
      if (!initialized || !modules) return null;

      return Object.freeze({
        modules,
        app: firebaseApp,
        auth,
        firestore,
        storage
      });
    }

    function getUserDocumentPath(uid) {
      const cleanUid = cleanString(uid);
      if (!cleanUid) throw new Error("A Firebase uid is required.");

      const root = cleanString(config.paths?.firestoreRoot) || "users";
      return `${root}/${cleanUid}`;
    }

    function getUserStoragePath(uid) {
      const cleanUid = cleanString(uid);
      if (!cleanUid) throw new Error("A Firebase uid is required.");

      const root = cleanString(config.paths?.storageRoot) || "users";
      return `${root}/${cleanUid}`;
    }

    global.addEventListener("online", notify);
    global.addEventListener("offline", notify);

    return Object.freeze({
      initialize,
      subscribe,
      getStatus,
      getServices,
      getCurrentUser: () => currentUser,
      signInWithGoogle,
      signOut,
      getRedirectResult,
      getUserDocumentPath,
      getUserStoragePath,
      getSdkVersion: () => FIREBASE_SDK_VERSION
    });
  }

  global.PriceTrackerFirebaseService = Object.freeze({ create });
})(window);
