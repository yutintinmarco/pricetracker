# Price Tracker — Task 3B Firebase Setup

The web app remains hosted on GitHub Pages.

Task 3B adds three storage modes:

1. Local only
2. User's own Firebase
3. Price Tracker Cloud

Task 3B does not upload or download product data yet. Data transfer begins in Task 3C.

## Price Tracker Cloud project

Shared project:

```text
price-tracker-app-8
```

Authentication requirements:

- Google provider enabled
- Authorized domain: `yutintinmarco.github.io`

## Publish the invitation rules

For the shared Price Tracker Cloud project, publish:

```text
firestore.rules
```

This rule set provides:

- A user can read only their own approval record.
- A user can submit only their own access request.
- Product data under `users/{uid}` is accessible only after approval.
- Approval documents cannot be written by the web app.

## Approving a user

After a user signs in and submits a request:

1. Open Firestore in Firebase Console.
2. Open `accessRequests/{uid}`.
3. Review the email and display name.
4. Create `approvedUsers/{uid}`.
5. Add a Boolean field:

```text
enabled: true
```

The user can then tap “重新檢查批准狀態”.

## Own Firebase mode

Advanced users should deploy:

```text
firestore-own.rules
```

When Cloud Storage is enabled, deploy:

```text
storage-own.rules
```

They must also:

- Enable Google Authentication.
- Add `yutintinmarco.github.io` to Authorized domains.
- Register a Firebase Web App.
- Paste the six public Web App config values into the Price Tracker settings.

## Storage

Cloud Storage is not used in Task 3B.

Before Task 3D, publish one of:

- `storage.rules` for Price Tracker Cloud
- `storage-own.rules` for a user's own Firebase

## Important

Firebase Web App configuration is public project identification data. Never place an Admin SDK service-account JSON or private key in this app.


## v55 cache-safe release

This build versions every first-party JavaScript file and uses network-first
loading for app code. It prevents Safari from combining a new `index.html`
with an older cached `firebase-service.js`.

Expected diagnostics in Cloud settings:

```text
App 版本: v55-firebase-cache-safe-login
Firebase SDK: 12.15.0
```

Task 3B loads only Firebase App, Authentication and Firestore. Cloud Storage
is intentionally deferred until Task 3D.


## Task 3C — Cloud text-data synchronization

Task 3C stores text records under each approved user's private path:

```text
users/{uid}/products/{productId}
users/{uid}/observations/{observationId}
users/{uid}/stores/{storeId}
users/{uid}/app/state
users/{uid}/sync/meta
```

The existing `firestore.rules` already permits only the approved owner of that
UID path to read and write these records.

First device:

1. Sign in and obtain approval.
2. Open Settings → Cloud and Sync.
3. Choose “以上載本機資料建立 Cloud”.
4. This fully replaces any existing Cloud text data; it does not merge.

Additional device:

1. Sign in with the same Google account.
2. Choose “由 Cloud 設定此裝置”.
3. A local safety backup is created first.
4. Cloud text data then fully replaces the local text data; it does not merge.

After initialization:

- Every save is written to local storage immediately.
- Changes are queued in local storage.
- The queue is sent automatically to Firestore.
- Offline changes retry when the network returns.
- Realtime listeners update another signed-in device.
- Product images and store logos remain local until Task 3D.


## v57 startup fix

v56 created the Cloud Sync service before the application `state` object
existed. The service constructor immediately requested current data, causing a
JavaScript temporal-dead-zone error and leaving the page body blank.

v57 creates the state first, then creates the Cloud Sync service and attaches
its status to the state.

Expected build label:

```text
v57-task3c-startup-fix
```


## Task 3D — Product images and store logos

Task 3D stores image files under:

```text
users/{uid}/images/products/{productImageKey}
users/{uid}/images/stores/{logoKey}
```

The text records in Firestore remain the image manifest:

```text
products/{productId}.record.productImageKey
stores/{storeId}.record.logoKey
```

Image behavior:

- A new image is saved to IndexedDB first.
- It is then uploaded to Cloud Storage in the background.
- Another signed-in device downloads missing images automatically.
- Downloaded images are cached in IndexedDB for offline use.
- Replacing or deleting an image removes the old Cloud Storage object.
- Deleting a product also deletes its price history and product image.
- Images remain excluded from JSON backup.

### Required Cloud Storage setup

For the shared Price Tracker Cloud project:

1. Open Firebase Console → Storage.
2. Create the default Storage bucket.
3. Publish `storage.rules`.
4. Keep the existing `firestore.rules` published.

`storage.rules` restricts every user to their own UID path, requires approval,
and accepts image files up to 2MB.

For a user's own Firebase project, publish `storage-own.rules`.
