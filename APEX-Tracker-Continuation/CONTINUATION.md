# APEX Monster Sales Tracker — continuation notes

Last updated: 2026-11-04

## Current state

The original artifact-based Monster Energy sales tracker has been adapted into a 64-bit Windows desktop application intended to work offline. Both an EXE installer and an MSI installer have been created. **The Windows installers and complete desktop app have not been run or verified on Windows.** The app's browser-side logic was exercised in a simulated environment; Windows testing is the most important next step.

The offline app is a separate copy, not a live connection to the original published artifact. It initializes from the supplied November 4, 2026 JSON snapshot only when no local data file exists. Changes made later to either copy do not synchronize with the other. Do not replace an existing data file with the snapshot without the user's informed consent.

## Files in this package

- `original/monster-sales.html` — the original artifact HTML, unchanged; it expects the artifact host's `claude.use("db")` and `claude.use("downloads")` capabilities.
- `original/data-snapshot.json` — original November 4 snapshot.
- `original/CONTINUATION.md` — earlier notes about the app, collections, business rules, and possible improvements.
- `desktop/installers/APEX-Monster-Setup.exe` — NSIS per-user installer; creates Start menu and desktop shortcuts.
- `desktop/installers/APEX-Monster-Setup.msi` — WiX/wixl MSI installer; creates a Start menu shortcut. Choose one installer, not both.
- `desktop/installers/README.txt` — user-facing installation, requirements, and backup instructions.
- `desktop/app/` — desktop application's HTML, JavaScript bridge, snapshot, compiled application executable, and the required WebView2 DLLs.
- `desktop/Program.cs` — C# WinForms host and local data/backup implementation.
- `desktop/setup.nsi` and `desktop/setup.wxs` — installer definitions.
- `desktop/tests/` — JavaScript simulated-browser smoke tests.
- `desktop/third-party/` — license and notice shipped with the Microsoft WebView2 package.

## Desktop architecture

- WinForms hosts the application using Microsoft Edge WebView2. Bundled assemblies and native x64 loader came from `Microsoft.Web.WebView2` NuGet package **1.0.2903.40**, net462 assemblies and win-x64 loader.
- Requires 64-bit Windows, Microsoft Edge WebView2 Runtime, and .NET Framework 4.7.2 or later. The runtime is not bundled. App operation is offline after prerequisites are available.
- `app/index.html` adapts the original HTML: it removes the network font stylesheet, adds backup/restore controls, a content security policy, and loads `bridge.js`. The UI falls back to installed system fonts.
- `app/bridge.js` emulates the limited artifact database/download APIs the original app uses. It sends messages to the host, serializes mutations, then refreshes snapshot listeners. It implements the collections/documents and operations used by this version, not a general-purpose database SDK.
- `Program.cs` stores the whole snapshot-like JSON locally, validates collections and document shape, writes a temporary file and replaces the current file while retaining `data.json.previous`, and shows backup, restore and CSV save dialogs. A per-user mutex prevents two application instances from writing simultaneously.
- Data location: `%LOCALAPPDATA%\ApexMonsterTracker\data.json`; browser profile is in the same directory under `Browser`. Uninstall does not intentionally delete the data folder. Use the app's **Back up all data** control to keep a separate copy. Restore replaces current records after confirmation; back up first.
- Local data is not encrypted and is per Windows user. The `.previous` file is only the previous write, not a substitute for independent backups. Backups can contain names and financial information.
- Installers and executable are unsigned. Windows SmartScreen may display a warning.

## Browser preview (no Windows needed)

`desktop/preview/server.js` serves `desktop/app/` as an ordinary web page so the UI can be inspected and clicked through in any browser, without Windows, WebView2, .NET or Mono. It is a development harness: the installers package individual files from `app/`, so `preview/` is never shipped.

```sh
cd desktop
node preview/server.js          # http://localhost:8080/ opens on the Tracker view
node preview/server.js 9090     # custom port
```

- The page's CSP sets `connect-src 'none'`, so the server injects one inline script setting `window.__APEX_SEED__` from `app/snapshot.json` before `bridge.js` loads. `app/index.html` on disk is not modified.
- `bridge.js` now detects its host: when `window.chrome && window.chrome.webview` exists (the Windows app) nothing changes; when it does not, a `localStorage`-backed stand-in handles `read`, `write`, `backup`, `restore` and `csv` so the UI is fully usable. Preview data lives under `apex-monster-preview-data` / `apex-monster-preview-backup`; open `/?reset=1` to clear it and reload the seed.
- `backup`, `restore` and CSV export work in the preview, but they touch browser storage and the browser's download folder — not `%LOCALAPPDATA%\ApexMonsterTracker`.
- `node preview/check.js` starts its own server on port 8099 and asserts the page loads without errors and that the Daily log matches the snapshot.
- **The preview does not validate the Windows build.** It exercises the same HTML/JS, so a rendering or logic bug will show up here, but WebView2 startup, native dialogs, file permissions, installers and data persistence on Windows still require testing on Windows.

## Supabase backend (cloud copy + archive)

A Supabase project now holds a cloud mirror of the tracker, plus a private storage bucket for
whole-file backups. It is a backup and reporting layer, **not a live sync** — the Windows app
still writes only to its local `data.json`.

- Project `apex-monster-tracker`, ref `qbhigtwejckzvocrwaqb`, region `ap-southeast-1`, org `ysiidev`.
- Tables mirror the collections 1:1 (`sales`, `restocks`, `refmoves`, `money`, `oct_batches`,
  `app_documents`, plus `snapshots` for whole-file archives). Only three column names change:
  `paidMethod`→`paid_method`, `paidFrom`→`paid_from`, `to`→`to_account`, `order`→`ord`.
- Seeded from the same 2026-11-04 snapshot: 10 sales (₱950), 14 restocks, 7 refmoves, 2 October
  batches, 2 documents, 1 snapshot archive. Verified against the app: same per-day totals,
  same stock-on-hand (73 cans) and the same Cash ₱855 / GCash ₱95 balances.
- Reporting views: `v_daily_log`, `v_daily_totals`, `v_flavor_mix`, `v_monthly_summary`,
  `v_stock_on_hand`, `v_account_balances`, `v_account_movements`, `v_sales_readable`.
- **RLS is on for every table with zero policies.** The publishable key can read nothing; all
  access needs the secret `service_role` key, which must stay in `supabase/.env` (git-ignored)
  and never inside `app/` or git.
- Schema is archived in `supabase/migrations/0001_init_tracker_schema.sql` (idempotent).
  Sync tooling is `tools/supabase-sync.mjs` (`push`, `pull`, `snapshot`, `verify`, `--dry-run`,
  `--prune`, `--force`); `tools/sync-selftest.mjs` round-trips a data file offline and must keep
  passing. Full details, limits and the security model: `supabase/README.md`.
- Caveat: the schema, seed and views were applied and queried through the Supabase API, but the
  `push`/`pull`/`snapshot` HTTP paths could not be exercised from this sandbox (no route to
  supabase.co). Their data mapping is covered by the offline self-test; the network calls are not.

## Data and business caveats

The snapshot now holds ten November sales — nine Cash and one GCash, ₱950 total — after the amendment described below, plus estimated October sales. It does not include starting account balances; verify these and the inventory before using the accounting figures. October case quantities in the earlier notes conflict with the JSON: each batch lists 10 cases, not 20. October's ₱1,365 figure subtracts the full cost of purchased stock and shipping, and is not necessarily profit on cans sold. See the original continuation notes for all collection fields and rules.

## Snapshot amendment (2026-11-04)

The exported snapshot held only four sales, all dated Nov 1–Nov 3, although it was labelled `taken: 2026-11-04`. Six recorded sales were missing from the export and have been added to **both** `original/data-snapshot.json` and `desktop/app/snapshot.json` (the two files are kept byte-identical):

| Day | Buyer | Flavor | Method | Time (PHT, reconstructed) |
|---|---|---|---|---|
| Nov 3 | Lou | Ultra White (White) | Cash | 15:41 |
| Nov 3 | Jester | Original Green (Black) | Cash | 17:52 |
| Nov 4 | Rebecca | Ultra Paradise (Green) | Cash | 09:12 |
| Nov 4 | Ash | Ultra Violet (Purple) | GCash | 11:35 |
| Nov 4 | JV | Original Green (Black) | Cash | 16:48 |
| Nov 4 | JV | Ultra White (White) | Cash | 16:52 |

Each added row uses `qty: 1`, `price: 95`, `cost: 54.17`, `paid: true`, and a synthetic 20-character `id` in the original style. **The times of day are invented** — the source list gave dates only — and they only affect ordering inside the Daily log and the date bucketing, not any total. Amounts, flavors, methods and buyers come from the supplied list. Existing records were not altered or removed.

Consequences worth knowing: November revenue is now ₱950 rather than ₱380, stock on hand drops by six cans, and the GCash balance rises by ₱95 (Ash). Because these are inserted into the snapshot, they seed a *fresh* install only; an existing `data.json` on a Windows machine is untouched and must not be replaced with this snapshot without the user's informed consent (see *Current state*).

## Validation completed

Using jsdom and a mocked WebView message host, tests checked that the snapshot loaded, the six app views appeared, a sale and restock could be entered, a money entry could be entered, a mocked backup and restore worked, and changed data persisted across a simulated browser restart. `tests/test-dailylog.js` additionally asserts that the Daily log renders every named-buyer sale exactly once, in ascending day groups, oldest first, and that rows under each day heading match the snapshot for that day. The three tests now derive record counts from the snapshot instead of asserting fixed numbers, so they keep working as data is added. All three passed on 2026-11-04 after the amendment. The resulting Windows PE and MSI installer formats were inspected on Linux. **This does not validate native WebView2 startup, dialogs, installation/uninstallation, data persistence on Windows, runtime prerequisites, MSI shortcuts, or all app workflows.**

## Priority next steps

1. On a 64-bit Windows PC with WebView2 Runtime and .NET Framework installed, test one installer and confirm the app opens with the original snapshot. Test in a disposable Windows profile or back up the real data first.
2. Verify all six views, dates, sales/add/edit/delete, debt payments, stock moves and adjustments, restocks, accounting, Money Manager, CSV export, settings, backup/restore, and closing/reopening the app. Test failures and ensure records are not lost.
3. Test each installer separately, including shortcuts and uninstall; uninstall should preserve user data. Check how Windows handles the unsigned files. Avoid installing both variants simultaneously.
4. Verify how starting balances and the October figures should be represented with the user. Consider clearer language for October cash vs. profit and add robust backup/import validation.
5. For distribution, consider code signing, prerequisite detection/installation, automatic backup strategy, and an upgrade path before claiming production readiness.

## Rebuilding on Linux

These commands describe the environment used for this package. From the `desktop` directory, install Mono's C# compiler and WinForms/System.Web.Extensions dependencies, NSIS (`makensis`), and `wixl`/msitools. The needed WebView2 DLLs are already under `app/`.

```sh
mkdir -p output
mcs -target:winexe -out:'app/Monster Sales Tracker.exe' \
  -r:System.Windows.Forms -r:System.Drawing -r:System.Web.Extensions \
  -r:app/Microsoft.Web.WebView2.Core.dll \
  -r:app/Microsoft.Web.WebView2.WinForms.dll Program.cs
makensis setup.nsi
wixl -o output/APEX-Monster-Setup.msi setup.wxs
```

The installer scripts write to `output/`, not the included `installers/` folder. Builds are unsigned. The MSI authoring is basic; validate installer upgrade behavior before releasing future versions. Do not assume that rebuilding alone proves Windows compatibility.

For the simulated JavaScript tests, install Node.js and `jsdom@24` in `desktop/` (`npm install` reads the included `package.json`), then run `node tests/test.js`, `node tests/test-more.js` and `node tests/test-dailylog.js` from `desktop/`. Run the daily-log test with `TZ=Asia/Manila` so calendar-day grouping matches the user's locale. These tests mock the native host and are not Windows integration tests.
