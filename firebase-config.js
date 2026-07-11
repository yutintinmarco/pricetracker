(function (global) {
  "use strict";

  global.PRICE_TRACKER_FIREBASE_CONFIG = Object.freeze({
    enabled: false,

    firebase: Object.freeze({
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: ""
    }),

    auth: Object.freeze({
      provider: "google",
      persistence: "local"
    }),

    paths: Object.freeze({
      firestoreRoot: "users",
      storageRoot: "users"
    })
  });
})(window);
