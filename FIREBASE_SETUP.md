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


## v68 — Clean Home toolbar

Build:

```text
v68-clean-home-toolbar
```

Changes:

- Removed the translucent outer panel, bottom border and shadow around the Home
  search and sort controls.
- Search and sort remain sticky directly below the navigation bar.
- Kept only a very subtle separator under the fixed topbar.


## v69 — Opaque sticky Home search

Build:

```text
v69-opaque-sticky-search
```

Changes:

- Kept the clean frameless Home search and sort area.
- Added a solid full-width backing layer matching the page background.
- Product rows can no longer show through the spaces around or between the
  sticky search and sort controls while scrolling.
- The backing layer does not add a border, shadow, blur panel or visible tray.


## v70 — Home transition text fix

Build:

```text
v70-home-transition-text-fix
```

The Home toolbar's opaque background uses an absolutely positioned
`::before` layer. In navigation snapshots the toolbar had been changed to
`position: static`, so that background layer expanded across the whole Home
screen and covered normal product text, while positioned image shells remained
visible.

v70 keeps the cloned toolbar in normal flow but makes it `position: relative`,
so the background is contained to the toolbar only. Home product text now
remains visible throughout forward and back page transitions.


## Task 4A — Cloud recovery and rebuild

Build:

```text
v71-task4a-cloud-recovery
```

The new **Settings → Cloud & Sync → Advanced Recovery** page provides four
non-merge operations:

1. Replace Cloud completely with this device, including text records and images.
2. Reset this device completely from Cloud, including rebuilding local image cache.
3. Rebuild only the local IndexedDB image cache from Cloud Storage.
4. Clear all Cloud text data and Cloud images while keeping this device's local data.

Safety behavior:

- Destructive operations require two confirmations.
- Text safety backups are created before Cloud replacement, device reset and Cloud clear.
- Local-authoritative Cloud replacement is blocked when any referenced image is
  missing from this device's cache.
- Cloud clear leaves local data intact and resets sync to the first-setup state.
- No operation merges datasets.


## v72 — Task 4A recovery safety fix

Build:

```text
v72-task4a-recovery-safety-fix
```

Fixes:

- Stops permanent retry loops when Firestore still references a Storage object
  that no longer exists.
- Detects remote-missing and fully broken image references separately.
- Adds a confirmed repair action that removes only unrecoverable image fields;
  products, stores and observations remain intact.
- Rebuilds local image cache without clearing it first. Existing cache is kept
  until every referenced Cloud object has downloaded successfully.
- Suspends background image upload/download during destructive recovery actions
  to prevent delete/upload races.
- Adds an immediate interaction lock so double taps cannot start overlapping
  recovery operations.
- Contains long Firebase error paths so a single account-specific error cannot
  widen or visually magnify the settings layout.


## v73 — Firestore Read Optimization

Build: `v73-firestore-read-optimization`

Normal startup now uses incremental listeners instead of reading every product,
observation and store twice. Existing v72 accounts perform one full reconciliation
on their first v73 launch to establish safe server-timestamp cursors. Later launches
listen only for documents changed after the last processed cursor.

The Firebase Web SDK also uses persistent multi-tab IndexedDB cache when the
browser supports it, with an automatic memory-cache fallback. The app's existing
localStorage/IndexedDB local-first UI remains unchanged. Manual refresh, first-device
setup and advanced recovery still use deliberate full scans because those operations
need authoritative counts and complete replacement safety.

Whole-cloud replacement writes a new generation token in `sync/meta`. Other
devices detect the generation change and perform one full rebase, so incremental
listeners do not miss records removed during a replace operation.

## v74 — Task 4B complete ZIP backup

Build:

```text
v74-task4b-full-zip-backup
```

Task 4B adds a complete, portable backup that is independent of Firebase.

### ZIP layout

```text
manifest.json
backup.json
images/products/<sha256-key>.<ext>
images/stores/<sha256-key>.<ext>
```

The manifest maps every archive image back to its permanent `imageKey` and
records its type, MIME type, byte size and SHA-256 checksum. `backup.json`
continues to use the validated v2 data envelope and also receives a SHA-256
checksum in the full-backup manifest.

### Export behaviour

- Exports products, observations, stores, settings, product images and store
  logos.
- Only images referenced by the exported data are included; orphaned local
  cache entries are excluded.
- If a referenced image is missing locally, the App asks the existing Cloud
  image service to download it before building the archive.
- If any referenced image still cannot be obtained, export stops instead of
  creating an incomplete backup.
- Images are stored without recompression; JSON files are deflated.

### Import behaviour

- Opens and checks the ZIP CRC, app id, full-backup version and safe paths.
- Validates `backup.json` through the existing schema migration and data
  validation pipeline.
- Verifies the SHA-256 checksum and byte size of every referenced image.
- Requires every image reference in the restored data to have a matching file.
- Replaces local text and IndexedDB images completely; no merge is performed.
- IndexedDB image replacement runs in one transaction. If the following text
  import fails, the previous image records are restored.
- Existing text data receives the normal pre-import safety backup.
- When Cloud sync is initialized, restored text and images are queued as the
  new local version and synchronized in the background.

The original JSON-only export/import remains available under the compatibility
section and still excludes images.

### Deployment

Two local runtime files were added:

```text
jszip.min.js
full-backup-service.js
```

Upload all 21 release files. Firebase rules are unchanged and do not need to
be published again.


## v75 — Task 5A Lite price analysis

Build:

```text
v75-task5a-lite-price-analysis
```

Product detail pages now include a local-only price analysis panel:

- latest comparable price versus the previous record;
- HKD-equivalent historical average;
- store and date of the lowest recorded comparable price;
- distance between the latest record and the historical low;
- an inline SVG trend chart when at least three comparable records exist; and
- a clear progress prompt when there is not yet enough history.

All calculations use the existing HKD-equivalent normalized unit price, so
foreign-currency records, bundle offers, buy-one-get-one offers and different
package sizes continue to use the same comparison basis as the existing app.
No new Firestore reads, writes, fields or Firebase rules are required.


## v76 — Item-price comparison model

Build:

```text
v76-item-price-comparison
```

Price comparison now follows the product identity rather than capacity-normalised
unit cost:

- Compare the effective promotional price per sales item (for example, per bottle).
- Convert foreign-currency item prices to HKD for cross-store comparison.
- Do not calculate or display per-100-mL or per-100-g comparison prices.
- Different capacities, such as 500 mL and 1 L, are separate products.
- An observation whose capacity/unit differs from the product specification is
  retained but excluded from low/high/average/trend and value-status analysis.
- No data migration, Firestore field, rule or backup-format change is required.


## v77 — Region, currency and current FX system

Build: `v77-region-currency-fx-system`

- Added user-managed regions and currencies under Settings.
- HKD remains the comparison base; each foreign currency stores a global current rate as `1 currency = x HKD`.
- Original prices and currencies remain unchanged. Home, detail, history and price analysis recalculate HKD equivalents from the latest global rate at render time.
- Existing observation exchange rates remain as historical snapshots and are not bulk rewritten.
- Schema v3 migration derives initial currencies and rates from existing stores and latest observation snapshots.
- Regions/currencies already referenced by stores or observations can be disabled but not deleted.
- Store picker now tracks iOS `visualViewport` so search results stay above the keyboard.
- Product detail store/date row uses one aligned flex baseline.
- Product variant field is relabelled as style/flavour/model.

Cloud format and rules are unchanged because regions/currencies are stored inside the existing `app/state.settings` document. Full ZIP and JSON backups automatically include the new settings.


## v78 — Barcode Backfill & Multi-barcode

Build:

```text
v78-barcode-backfill-multi-barcode
```

Changes:

- Data schema upgraded to v4. Existing `product.barcode` values migrate into a
  deduplicated `product.barcodes` array; `product.barcode` remains the primary
  compatibility value.
- Existing products can add a barcode by camera or manual entry.
- Unknown scanned barcodes can create a new product or link to an existing
  product.
- A product can have multiple market or packaging barcodes.
- The same barcode cannot be linked to two products.
- Product details show every linked barcode and allow safe removal.
- Removing a barcode never deletes the product or its price history.
- Product search and the main scanner recognize every linked barcode.
- No external barcode product database or paid API is used.


## v79 — Hierarchical product categories

Build:

```text
v79-hierarchical-category-system
```

Changes:

- Data schema v5 adds stable `categoryId` and `subcategoryId` fields to products.
- Product categories are managed as main categories with ordered subcategories.
- Existing flat categories migrate automatically; recognised labels are mapped to the new defaults, while unknown legacy labels are preserved under `其他`.
- `藥妝` is deliberately migrated to `其他 / 待整理（原藥妝）` because it describes a sales channel rather than one product type.
- Home product grouping, product forms, product detail, search, cloud sync, JSON backup, and full ZIP backup all use the hierarchy.
- Category renaming only changes the settings record because products reference stable IDs; it does not rewrite every product document.


## v80 — Category manager redesign

Build:

```text
v80-category-manager-redesign
```

Changes:

- Preserves the existing schema v5 category tree and every user-created category.
- Replaces the dense single-page editor with an iOS Settings-style hierarchy:
  - main-category overview;
  - one main-category detail page;
  - one subcategory product list.
- Normal screens show only names and counts.
- Rename, ordering, activation and deletion controls appear only in Edit mode.
- Main-category, subcategory and product reclassification forms use focused bottom sheets.
- Adds a dedicated "Uncategorized products" shortcut.
- Products can be reclassified directly from a subcategory product list.
- No Firestore rules, schema migration or backup-format change is required.


## v81 — Category drag reorder

Build:

```text
v81-category-drag-reorder
```

Changes:

- Main-category ordering moved to the category overview page.
- Added a real press-and-drag reorder handle for active main categories.
- Added real press-and-drag reordering for subcategories in edit mode.
- Kept up/down buttons as an accessible fallback.
- Main-category ordering controls were removed from the inside of a category.
- Dragged rows lift above the page, leave a visible placeholder, and auto-scroll
  near the top or bottom of the screen.
- Each completed drop saves the new order immediately and syncs it through the
  existing settings sync.
- Existing category data, custom categories, schema v5, Cloud Sync, JSON backup,
  and full ZIP backup are unchanged.


## v82 — Advanced Price Analysis

Build:

```text
v82-advanced-price-analysis
```

- Five-year analysis window with the latest record excluded from its own baseline.
- Median-based normal price benchmark.
- Bottom 20% + at least 4% below median = 抵買.
- Bottom 5% + at least 10% below median = 超抵買.
- Symmetric Top 20% / Top 5% expensive classifications.
- Stable-price protection when the robust normal range is within 5%.
- Same product/date/store duplicates: only the most recently updated record is analysed.
- General promotions, B1G1, bundles and member prices remain in the normal benchmark.
- Clearance prices can be classified and can set a historical low, but are excluded from future normal medians.
- Manual exclude option removes a record from analysis without deleting it.
- Anomaly confirmation appears after at least 8 normal baseline points when a new price differs from the median by at least 20% and has no nearby supporting price.
- Confidence, percentile position, historical-low tags and reason text are shown in Product Detail.
- Schema v6 adds `priceNature` to observations. Existing observations migrate to `standard`.


## v83 — Price entry and analysis UX fix

Build:

```text
v83-price-entry-analysis-ux-fix
```

Changes:

- Fixed the observation save failure caused by an undeclared `priceNature`
  variable in the submit path.
- Redesigned the promotion entry area around an automatic effective per-item
  price card. B1G1, bundle, second-item half-price and custom multi-item offers
  now clearly calculate the effective unit price without requiring users to
  type that value manually.
- Moved Notes into a collapsed disclosure panel.
- Added a sticky iOS-style Save dock above the tab bar and keyboard.
- Every historical price row is now independently classified against the five
  years preceding that observation, rather than only showing analysis on the
  latest row.
- Historical-low is an independent tag and can appear beside an analysis tag.
- Added restrained iOS-style semantic tag colors for value, expensive,
  historical-low, clearance and special-promotion states.
- No schema, Firebase Rules, Cloud Sync or backup format changes.


## v84 — Analysis labels and price-form fix

Build:

```text
v84-analysis-label-form-fix
```

Changes:

- Fixed Add/Edit Price pages hanging because v83 called an undefined
  `formatNumber()` helper.
- Historical-low now means the true full-period minimum rather than every
  rolling record low at that point in time.
- Later exact ties display `追平最低`.
- A historical-low row no longer also displays `抵買` or `超抵買`.
- Fewer than three effective points produce no row-level judgement badge.
- Three to four effective points are labelled `初步偏低`, `初步一般`,
  or `初步偏高`.
- Historical-row analysis is precomputed once per product, improving performance
  when a product has many price records.
- No schema, Firebase Rules, Cloud Sync or backup format changes.


## v85 — Navigation and analysis display fix

Build:

```text
v85-navigation-analysis-display-fix
```

Changes:

- Fixed forward navigation assigning both front and previous-page classes to
  the incoming screen. New pages no longer appear dim and then flash brighter.
- The outgoing page now receives the subtle depth overlay, while back navigation
  smoothly reveals the previous page without a brightness jump.
- Interactive edge-swipe back now fades the previous-page overlay with swipe
  progress.
- The history list no longer shows routine `一般價`, low-sample preliminary,
  slight-high/low, or insufficient-data badges.
- The full analysis and confidence explanation remain available in the product
  analysis card; the compact history list now highlights only meaningful
  exceptions and factual flags.
- No schema, Firebase Rules, Cloud Sync, or backup-format changes.


## v86 — Stable navigation surfaces

Build:

```text
v86-stable-navigation-surface-fix
```

Changes:

- Removed the v85 animated dark overlay and opacity transitions.
- Navigation now uses horizontal transforms only; the incoming page is never
  dimmed.
- Both page snapshots use one locked viewport rectangle so topbar measurement
  changes cannot create a 1–2 px vertical shift.
- The final internal scroll position is re-applied twice before the live page is
  revealed, preventing Safari from showing a small vertical jump at the end of
  the transition.
- Interactive swipe-back uses the same fixed viewport and no brightness effect.
- Analysis display, schema v6, Cloud Sync and backup behavior are unchanged.
