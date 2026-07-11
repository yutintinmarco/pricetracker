(function (global) {
  "use strict";

  const FIREBASE_SDK_VERSION = "12.15.0";
  const FIREBASE_BASE_URL =
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

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

  function hasRequiredFirebaseConfig(firebaseConfig) {
    return Object.values(normalizeFirebaseConfig(firebaseConfig)).every(Boolean);
  }

  function safeAppName(mode, projectId) {
    const safeProject = cleanString(projectId)
      .replace(/[^a-z0-9_-]/gi, "-")
      .slice(0, 48) || "project";
    return `price-tracker-${mode}-${safeProject}`;
  }

  function create() {
    let modules = null;
    let firebaseApp = null;
    let auth = null;
    let firestore = null;
    let storage = null;
    let currentUser = null;
    let unsubscribeAuth = null;
    let connectionToken = 0;

    let activeProfile = {
      mode: "local",
      firebaseConfig: null,
      requireApproval: false,
      approvedCollection: "approvedUsers",
      requestCollection: "accessRequests",
      firestoreRoot: "users",
      storageRoot: "users"
    };

    let state = {
      mode: "local",
      configured: true,
      connecting: false,
      initialized: false,
      online: navigator.onLine,
      authenticated: false,
      projectId: "",
      user: null,
      approval: "not-required",
      accessRequest: "none",
      lastError: null,
      sdkVersion: FIREBASE_SDK_VERSION
    };

    const listeners = new Set();

    function snapshot() {
      return Object.freeze({
        ...state,
        user: state.user ? Object.freeze({ ...state.user }) : null,
        lastError: state.lastError
          ? Object.freeze({ ...state.lastError })
          : null
      });
    }

    function setState(patch) {
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
          console.warn("Firebase status listener failed:", error);
        }
      });

      return current;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Firebase listener must be a function");
      }

      listeners.add(listener);
      listener(snapshot());
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

    async function detachCurrentConnection({ signOutCurrent = false } = {}) {
      if (unsubscribeAuth) {
        unsubscribeAuth();
        unsubscribeAuth = null;
      }

      if (signOutCurrent && auth && modules) {
        try {
          await modules.auth.signOut(auth);
        } catch (error) {
          console.warn("Firebase sign-out during switch failed:", error);
        }
      }

      currentUser = null;
      auth = null;
      firestore = null;
      storage = null;

      if (firebaseApp && modules) {
        try {
          await modules.app.deleteApp(firebaseApp);
        } catch (error) {
          console.warn("Firebase app cleanup failed:", error);
        }
      }

      firebaseApp = null;
    }

    async function connect(profile = {}) {
      const token = ++connectionToken;
      const mode = ["shared", "own"].includes(profile.mode)
        ? profile.mode
        : "local";

      if (mode === "local") {
        await detachCurrentConnection({ signOutCurrent: true });
        activeProfile = {
          mode: "local",
          firebaseConfig: null,
          requireApproval: false,
          approvedCollection: "approvedUsers",
          requestCollection: "accessRequests",
          firestoreRoot: "users",
          storageRoot: "users"
        };

        return setState({
          mode: "local",
          configured: true,
          connecting: false,
          initialized: false,
          authenticated: false,
          projectId: "",
          user: null,
          approval: "not-required",
          accessRequest: "none",
          lastError: null
        });
      }

      const firebaseConfig = normalizeFirebaseConfig(profile.firebaseConfig);
      if (!hasRequiredFirebaseConfig(firebaseConfig)) {
        activeProfile = {
          ...activeProfile,
          mode,
          firebaseConfig
        };

        return setState({
          mode,
          configured: false,
          connecting: false,
          initialized: false,
          authenticated: false,
          projectId: firebaseConfig.projectId,
          user: null,
          approval: profile.requireApproval ? "signed-out" : "not-required",
          accessRequest: "none",
          lastError: {
            code: "firebase/not-configured",
            message: "Firebase configuration is incomplete."
          }
        });
      }

      await detachCurrentConnection({ signOutCurrent: false });
      if (token !== connectionToken) return snapshot();

      activeProfile = {
        mode,
        firebaseConfig,
        requireApproval: profile.requireApproval === true,
        approvedCollection:
          cleanString(profile.approvedCollection) || "approvedUsers",
        requestCollection:
          cleanString(profile.requestCollection) || "accessRequests",
        firestoreRoot: cleanString(profile.firestoreRoot) || "users",
        storageRoot: cleanString(profile.storageRoot) || "users"
      };

      setState({
        mode,
        configured: true,
        connecting: true,
        initialized: false,
        authenticated: false,
        projectId: firebaseConfig.projectId,
        user: null,
        approval: activeProfile.requireApproval
          ? "signed-out"
          : "not-required",
        accessRequest: "none",
        lastError: null
      });

      try {
        const loaded = await loadModules();
        if (token !== connectionToken) return snapshot();

        const appName = safeAppName(mode, firebaseConfig.projectId);
        const existing = loaded.app
          .getApps()
          .find((app) => app.name === appName);

        firebaseApp = existing || loaded.app.initializeApp(
          firebaseConfig,
          appName
        );

        auth = loaded.auth.getAuth(firebaseApp);
        firestore = loaded.firestore.getFirestore(firebaseApp);
        storage = loaded.storage.getStorage(firebaseApp);

        await loaded.auth.setPersistence(
          auth,
          loaded.auth.browserLocalPersistence
        );

        unsubscribeAuth = loaded.auth.onAuthStateChanged(
          auth,
          async (user) => {
            if (token !== connectionToken) return;

            currentUser = user || null;
            setState({
              authenticated: Boolean(currentUser),
              user: currentUser
                ? {
                    uid: currentUser.uid,
                    email: currentUser.email || "",
                    displayName: currentUser.displayName || "",
                    photoURL: currentUser.photoURL || ""
                  }
                : null,
              approval: activeProfile.requireApproval
                ? currentUser
                  ? "checking"
                  : "signed-out"
                : "not-required",
              accessRequest: currentUser ? state.accessRequest : "none",
              lastError: null
            });

            if (currentUser && activeProfile.requireApproval) {
              await refreshApproval();
            }
          },
          (error) => {
            if (token !== connectionToken) return;
            setState({
              lastError: {
                code: cleanString(error?.code) || "firebase/auth-state-error",
                message:
                  cleanString(error?.message) ||
                  "Authentication state failed."
              }
            });
          }
        );

        try {
          await loaded.auth.getRedirectResult(auth);
        } catch (error) {
          setState({
            lastError: {
              code: cleanString(error?.code) || "firebase/redirect-error",
              message:
                cleanString(error?.message) ||
                "Google sign-in redirect failed."
            }
          });
        }

        if (token !== connectionToken) return snapshot();

        return setState({
          connecting: false,
          initialized: true,
          lastError: null
        });
      } catch (error) {
        if (token !== connectionToken) return snapshot();

        return setState({
          connecting: false,
          initialized: false,
          authenticated: false,
          user: null,
          approval: activeProfile.requireApproval
            ? "signed-out"
            : "not-required",
          lastError: {
            code:
              cleanString(error?.code) ||
              "firebase/initialization-failed",
            message:
              cleanString(error?.message) ||
              "Firebase initialization failed."
          }
        });
      }
    }

    async function disconnect(options = {}) {
      connectionToken += 1;
      await detachCurrentConnection({
        signOutCurrent: options.signOut !== false
      });

      activeProfile = {
        mode: "local",
        firebaseConfig: null,
        requireApproval: false,
        approvedCollection: "approvedUsers",
        requestCollection: "accessRequests",
        firestoreRoot: "users",
        storageRoot: "users"
      };

      return setState({
        mode: "local",
        configured: true,
        connecting: false,
        initialized: false,
        authenticated: false,
        projectId: "",
        user: null,
        approval: "not-required",
        accessRequest: "none",
        lastError: null
      });
    }

    async function requireReady() {
      if (!modules || !firebaseApp || !auth || !firestore) {
        const error = new Error(
          state.lastError?.message || "Firebase is not ready."
        );
        error.code = state.lastError?.code || "firebase/not-ready";
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
      provider.setCustomParameters({ prompt: "select_account" });

      try {
        return await ready.modules.auth.signInWithPopup(
          ready.auth,
          provider
        );
      } catch (error) {
        const redirectCodes = new Set([
          "auth/popup-blocked",
          "auth/cancelled-popup-request",
          "auth/operation-not-supported-in-this-environment",
          "auth/web-storage-unsupported"
        ]);

        if (!redirectCodes.has(error?.code)) throw error;

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

    async function refreshApproval() {
      if (!activeProfile.requireApproval) {
        return setState({
          approval: "not-required",
          accessRequest: "none"
        });
      }

      if (!currentUser) {
        return setState({
          approval: "signed-out",
          accessRequest: "none"
        });
      }

      const ready = await requireReady();
      setState({ approval: "checking", lastError: null });

      try {
        const approvedRef = ready.modules.firestore.doc(
          ready.firestore,
          activeProfile.approvedCollection,
          currentUser.uid
        );
        const requestRef = ready.modules.firestore.doc(
          ready.firestore,
          activeProfile.requestCollection,
          currentUser.uid
        );

        const [approvedSnapshot, requestSnapshot] = await Promise.all([
          ready.modules.firestore.getDoc(approvedRef),
          ready.modules.firestore.getDoc(requestRef)
        ]);

        const approved =
          approvedSnapshot.exists() &&
          approvedSnapshot.data()?.enabled === true;

        return setState({
          approval: approved ? "approved" : "not-approved",
          accessRequest: requestSnapshot.exists()
            ? "submitted"
            : "none",
          lastError: null
        });
      } catch (error) {
        return setState({
          approval: "error",
          lastError: {
            code:
              cleanString(error?.code) ||
              "firebase/approval-check-failed",
            message:
              cleanString(error?.message) ||
              "Approval check failed."
          }
        });
      }
    }

    async function requestSharedAccess() {
      if (!activeProfile.requireApproval) {
        const error = new Error("Approval is not required for this project.");
        error.code = "firebase/approval-not-required";
        throw error;
      }

      if (!currentUser) {
        const error = new Error("Please sign in before requesting access.");
        error.code = "firebase/not-authenticated";
        throw error;
      }

      const ready = await requireReady();
      const requestRef = ready.modules.firestore.doc(
        ready.firestore,
        activeProfile.requestCollection,
        currentUser.uid
      );

      await ready.modules.firestore.setDoc(
        requestRef,
        {
          uid: currentUser.uid,
          email: currentUser.email || "",
          displayName: currentUser.displayName || "",
          requestedAt:
            ready.modules.firestore.serverTimestamp(),
          status: "pending"
        },
        { merge: true }
      );

      return refreshApproval();
    }

    function getServices() {
      if (!modules || !firebaseApp) return null;

      return Object.freeze({
        modules,
        app: firebaseApp,
        auth,
        firestore,
        storage
      });
    }

    function getUserDocumentPath(uid = currentUser?.uid) {
      const cleanUid = cleanString(uid);
      if (!cleanUid) throw new Error("A Firebase uid is required.");
      return `${activeProfile.firestoreRoot}/${cleanUid}`;
    }

    function getUserStoragePath(uid = currentUser?.uid) {
      const cleanUid = cleanString(uid);
      if (!cleanUid) throw new Error("A Firebase uid is required.");
      return `${activeProfile.storageRoot}/${cleanUid}`;
    }

    global.addEventListener("online", () => setState({ online: true }));
    global.addEventListener("offline", () => setState({ online: false }));

    return Object.freeze({
      connect,
      disconnect,
      subscribe,
      getStatus: snapshot,
      getServices,
      getCurrentUser: () => currentUser,
      signInWithGoogle,
      signOut,
      refreshApproval,
      requestSharedAccess,
      getUserDocumentPath,
      getUserStoragePath,
      getSdkVersion: () => FIREBASE_SDK_VERSION,
      hasRequiredFirebaseConfig
    });
  }

  global.PriceTrackerFirebaseService = Object.freeze({ create });
})(window);
