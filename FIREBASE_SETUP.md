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


## v59 — iOS navigation and form polish

- Forward navigation slides in from the right.
- The top-left back button and a left-edge swipe return to the previous screen.
- Store selection uses an iOS-style searchable picker sheet instead of a long inline list.
- Observation date/capacity layout is responsive and prevents iOS date-input overflow.
- Promotion details appear only when a promotional price type is selected.
- Product and store images are larger across lists, detail pages, and edit forms.
- Product detail shows category and package capacity below the product name.
- Product deletion is kept only on the Edit Price Record screen.

Build: `v59-ios-navigation-ui-polish`


## v60 — Native navigation and form fixes

Build:

```text
v60-native-navigation-form-fixes
```

Changes:

- Forward and back transitions now render both the outgoing and incoming page
  at the same time, using a longer iOS-style full-width transition.
- An interactive edge swipe displays the previous page under the current page
  while the finger moves.
- The store picker is attached to the viewport body rather than the transformed
  app container, fixing the sheet appearing below the current scroll position.
- The observation form shows up to two recently used stores as one-tap choices.
- The purchase date uses a bounded visual control over the native date input,
  preventing iOS Safari from extending the field outside the screen.
- Product detail identity is displayed in the order: brand, product name,
  category, capacity.


## v61 — Swipe surface and tab animation fix

Build:

```text
v61-navigation-swipe-tabbar-fix
```

Changes:

- The App version shown inside Cloud settings now reads directly from the
  `app-build` meta tag, so it no longer remains stuck on an older hardcoded
  version.
- Interactive back-swipe snapshots now use the full viewport, with a centered
  560px app frame matching the real layout.
- Previous-page parallax was reduced from 28% to 12%, preventing the revealed
  page from looking cropped or partially missing.
- Snapshot layers remain visible until the destination page has completed two
  animation frames of layout, reducing the refresh-like jump at the end.
- Bottom-tab liquid indicator movement and active-tab colour transitions are
  slower and easier to see.


## v62 — Fixed iOS navigation shell

Build:

```text
v62-ios-navigation-shell
```

Changes:

- The browser window no longer scrolls. Each page scrolls inside the fixed
  content viewport below the single navigation bar.
- Navigation snapshots use the internal page scroll position, eliminating the
  vertical pull/jump that occurred when the browser window changed scroll
  position during a transition.
- Every screen uses one identical topbar geometry. The back-button slot remains
  reserved even on root screens, so title alignment and bar height do not
  change between Home, Product, Settings and detail screens.
- Back button and title animate independently inside the fixed topbar during
  forward, back and interactive edge-swipe navigation.
- Interactive edge swipe shows both the previous page and previous navigation
  title while the finger moves.
- Image viewer, store picker, pull-to-refresh and overscroll guards now use the
  internal page scroller.


## v63 — Full-bleed iOS document scroll

Build:

```text
v63-full-bleed-ios-scroll
```

Changes:

- Removed the v62 fixed middle scroll viewport.
- The page once again scrolls naturally as one full document.
- Background and content extend underneath the floating bottom tab bar.
- Bottom content has a scroll inset so the last row can still be brought above
  the tab bar.
- Removed the artificial 8px space below the fixed navigation bar.
- Retained the single consistent iOS-style topbar and interactive edge-swipe
  navigation.
- Navigation snapshots now use the visible viewport below the topbar and the
  real document scroll offset.
- Store picker and image viewer preserve and restore document scroll correctly.


## v64 — Full-screen scroll-view navigation fix

Build:

```text
v64-fullscreen-scrollview-navigation-fix
```

Changes:

- The browser document is permanently fixed and no longer scrolls.
- The actual page scroll view fills the entire screen behind both the topbar
  and floating bottom tab bar.
- Top and bottom spacing are content insets inside that full-screen scroll view;
  the background and moving content still extend behind the bars.
- Page changes update only the internal `scrollTop`, so iOS Safari no longer
  compresses the visual viewport and springs it back.
- Removed the topbar ResizeObserver and replaced it with an exact fixed
  safe-area calculation, preventing one-frame changes to the content inset.
- Navigation snapshots use the internal scroll position while preserving the
  stable single topbar and interactive edge swipe.


## v65 — Smoother navbar and fixed Home search

Build:

```text
v65-smooth-navbar-fixed-home-search
```

Changes:

- The outgoing topbar title is installed before the live title changes, removing
  the one-frame flash that made the title change look like a bug.
- Topbar and content transitions now use a slower 500ms iOS-style spring curve.
- Title travel distance is smaller, with a softer fade and matching back-button
  movement.
- Home search and sort controls are fixed immediately below the topbar.
- The product list scrolls underneath the fixed search controls.
- A measured spacer preserves the correct first-row position on different
  iPhone text and display sizes.
- Navigation snapshots convert the fixed Home toolbar into part of the moving
  page, so forward/back animations remain visually coherent.


## v66 — Navbar title overlap and Home toolbar width fix

Build:

```text
v66-navbar-title-home-search-fix
```

Changes:

- Long navigation titles no longer remain readable at the same time. The old
  title exits first, followed by the new title entering after a short staged
  delay.
- Interactive edge-swipe title opacity uses separate phases, preventing the
  two long titles from visually stacking on top of each other.
- Home search and sort controls now use a sticky toolbar inside the real app
  scroll view rather than a viewport-fixed element.
- The sticky toolbar stays directly below the fixed topbar, but keeps its exact
  page width during forward/back animation and after returning Home.
- Removed the cloned toolbar double inset and the delayed spacer measurement
  that caused the search bar to shrink and then refresh back to normal.


## v67 — Home toolbar position correction

Build:

```text
v67-home-toolbar-position-fix
```

The full-screen `#app` scroll view already applies the topbar safe-area inset
as top padding. v66 also applied the same inset to the sticky Home toolbar,
which doubled the offset after the transition finished.

v67 changes the sticky offset to `top: 0`, so the search and sort controls stay
directly below the fixed navigation bar both during and after page transitions.
