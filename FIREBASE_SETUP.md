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
