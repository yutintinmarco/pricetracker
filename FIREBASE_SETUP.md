# Price Tracker — Firebase Setup

Task 3A adds the Firebase connection foundation only. The app remains local-first and cloud features stay disabled until `firebase-config.js` is completed.

## 1. Create and register the Firebase web app

1. Create a Firebase project.
2. Register a Web app.
3. Copy the Firebase configuration object.

## 2. Enable Firebase products

Enable:

- Authentication
- Google sign-in provider
- Cloud Firestore
- Cloud Storage

Add this authorized domain in Firebase Authentication:

- `yutintinmarco.github.io`

## 3. Configure the app

Edit `firebase-config.js`.

Change:

```js
enabled: false
```

to:

```js
enabled: true
```

Fill in:

```js
firebase: {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

Do not add a Firebase Admin service-account key to this web app.

## 4. Deploy security rules

Deploy:

- `firestore.rules`
- `storage.rules`

Both rule files restrict data to the signed-in Firebase user path:

```text
users/{uid}
```

## 5. Current Task 3A behaviour

- Existing localStorage data is unchanged.
- Existing IndexedDB product images and shop logos are unchanged.
- Firebase SDK files load only after `enabled: true`.
- No automatic upload, download, merge or deletion occurs yet.
- Task 3B will add the sign-in and cloud status interface.
- Task 3C will add Firestore data sync.
- Task 3D will add Cloud Storage image sync.
