(function (global) {
  "use strict";

  global.PRICE_TRACKER_SHARED_FIREBASE_CONFIG = Object.freeze({
    label: "Price Tracker Cloud",

    firebase: Object.freeze({
      apiKey: "AIzaSyDI0fIjHGaC2dY0rtbSvgnmZVPs8j1poeE",
      authDomain: "price-tracker-app-8.firebaseapp.com",
      projectId: "price-tracker-app-8",
      storageBucket: "price-tracker-app-8.firebasestorage.app",
      messagingSenderId: "164637986590",
      appId: "1:164637986590:web:b125099c1e6bc21c20430f"
    }),

    approval: Object.freeze({
      required: true,
      approvedCollection: "approvedUsers",
      requestCollection: "accessRequests"
    }),

    paths: Object.freeze({
      firestoreRoot: "users",
      storageRoot: "users"
    })
  });
})(window);
